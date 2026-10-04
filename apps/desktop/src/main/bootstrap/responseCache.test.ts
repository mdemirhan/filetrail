import { describe, expect, it, vi } from "vitest";

import type { ExplorerWorkerClient } from "@filetrail/core";

import {
  clearResponseCaches,
  createFolderSizeHandlers,
  getCachedMetadataBatch,
  getCachedResponse,
  getResponseCacheSizes,
  resetResponseCacheState,
} from "./responseCache";

function createMockNative() {
  let resolveActive: ((value: string) => void) | null = null;
  let rejectActive: ((reason: unknown) => void) | null = null;

  return {
    getFolderSize: vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          resolveActive = resolve;
          rejectActive = reject;
        }),
    ),
    cancelFolderSize: vi.fn(),
    resolveActive(json: string) {
      resolveActive?.(json);
      resolveActive = null;
      rejectActive = null;
    },
    rejectActive(err: Error) {
      rejectActive?.(err);
      resolveActive = null;
      rejectActive = null;
    },
  };
}

const sampleJson = JSON.stringify({
  total: 1000,
  diskTotal: 1200,
  fileCount: 42,
  folderCount: 7,
  dirs: {
    "/test/sub": [500, 600, 20, 3],
  },
});

describe("createFolderSizeHandlers", () => {
  it("start returns running and job transitions to ready with all three fields", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const startResult = handlers.start({ path: "/test" });
    expect(startResult.status).toBe("running");

    native.resolveActive(sampleJson);
    // Wait for microtask
    await new Promise((r) => setTimeout(r, 0));

    const status = handlers.getStatus({ jobId: startResult.jobId });
    expect(status.status).toBe("ready");
    expect(status.sizeBytes).toBe(1000);
    expect(status.diskBytes).toBe(1200);
    expect(status.fileCount).toBe(42);
    expect(status.folderCount).toBe(7);
    expect(status.error).toBeNull();
  });

  it("start with cache hit returns ready immediately with all fields", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    // Populate cache
    const first = handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    // Second request should hit cache
    const second = handlers.start({ path: "/test" });
    expect(second.status).toBe("ready");

    const status = handlers.getStatus({ jobId: second.jobId });
    expect(status.sizeBytes).toBe(1000);
    expect(status.diskBytes).toBe(1200);
    expect(status.fileCount).toBe(42);
    expect(status.folderCount).toBe(7);
  });

  it("start with probeOnly returns deferred when not cached", () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const result = handlers.start({ path: "/test", probeOnly: true });
    expect(result.status).toBe("deferred");
    expect(native.getFolderSize).not.toHaveBeenCalled();
  });

  it("start with probeOnly returns ready when cached", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    // Populate cache
    handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    const result = handlers.start({ path: "/test", probeOnly: true });
    expect(result.status).toBe("ready");
  });

  // A trashed 5 GB folder replaced by an empty one of the same name showed 5 GB.
  it("forgets the sizes of the folders a write touched, and keeps the others", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    for (const path of ["/Users/demo/Project", "/Users/demo/Music"]) {
      handlers.start({ path });
      native.resolveActive(sampleJson);
      await new Promise((r) => setTimeout(r, 0));
    }

    clearResponseCaches(["/Users/demo/Project/src/old.txt"]);

    expect(handlers.start({ path: "/Users/demo/Project", probeOnly: true }).status).not.toBe(
      "ready",
    );
    expect(handlers.start({ path: "/Users/demo/Music", probeOnly: true }).status).toBe("ready");
  });

  // Measuring the home folder, whose walk reached its Trash or was refused it.
  async function measureHome(trashReadable: boolean) {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
    handlers.start({ path: "/Users/demo" });
    native.resolveActive(
      JSON.stringify({
        total: 1_000,
        diskTotal: 2_000,
        fileCount: 10,
        folderCount: 3,
        dev: 16,
        dirs: {
          "/Users/demo/Downloads": [600, 1_200, 6, 0],
          ...(trashReadable ? { "/Users/demo/.Trash": [50, 100, 1, 0] } : {}),
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    return { native, handlers };
  }

  const trashedZip = {
    path: "/Users/demo/Downloads/a.zip",
    item: { kind: "file" as const, sizeBytes: 200, diskBytes: 400, dev: 16 },
    intoHomeTrash: true,
  };

  it("takes what went to the Trash off the folders that held it, as measured", async () => {
    const readable = await measureHome(true);
    clearResponseCaches([], [trashedZip]);
    expect(readable.handlers.getCachedSize("/Users/demo/Downloads")).toBe(400);
    // Still in the home folder, in its Trash, which its measurement counted.
    expect(readable.handlers.getCachedSize("/Users/demo")).toBe(1_000);
    expect(readable.handlers.getCachedSize("/Users/demo/.Trash")).toBe(250);

    const unreadable = await measureHome(false);
    clearResponseCaches([], [trashedZip]);
    expect(unreadable.handlers.getCachedSize("/Users/demo/Downloads")).toBe(400);
    expect(unreadable.handlers.getCachedSize("/Users/demo")).toBe(800);
  });

  it("learns that the Trash can't be read from measuring the Trash itself", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
    handlers.start({ path: "/Users/demo/.Trash" });
    native.rejectActive(Object.assign(new Error("denied"), { code: "EPERM" }));
    await new Promise((r) => setTimeout(r, 0));
    handlers.start({ path: "/Users/demo/Downloads" });
    native.resolveActive(
      JSON.stringify({
        total: 600,
        diskTotal: 1_200,
        fileCount: 6,
        folderCount: 0,
        dev: 16,
        dirs: {},
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    handlers.start({ path: "/Users/demo" });
    native.resolveActive(
      JSON.stringify({
        total: 1_000,
        diskTotal: 2_000,
        fileCount: 10,
        folderCount: 3,
        dev: 16,
        dirs: {},
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    clearResponseCaches([], [trashedZip]);

    expect(handlers.getCachedSize("/Users/demo")).toBe(800);
  });

  it("measures again a folder a write changed while it was being measured", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
    const { jobId } = handlers.start({ path: "/Users/demo/Project" });

    clearResponseCaches([], [{ ...trashedZip, path: "/Users/demo/Project/a.zip" }]);
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    // The first answer may have seen part of the change: the same job measures again.
    expect(native.getFolderSize).toHaveBeenCalledTimes(2);
    expect(handlers.getStatus({ jobId }).status).toBe("running");
    expect(handlers.getCachedSize("/Users/demo/Project")).toBeUndefined();
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.getStatus({ jobId })).toMatchObject({ status: "ready", sizeBytes: 1000 });
    expect(handlers.getCachedSize("/Users/demo/Project")).toBe(1000);
  });

  it("start with recalculate clears cache", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    // Populate cache
    handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    // Recalculate should not return ready from cache
    const result = handlers.start({ path: "/test", recalculate: true });
    expect(result.status).toBe("running");
  });

  it("cancel marks job as cancelled and calls native cancel", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const start = handlers.start({ path: "/test" });
    const cancelResult = handlers.cancel({ jobId: start.jobId });
    expect(cancelResult.ok).toBe(true);
    expect(native.cancelFolderSize).toHaveBeenCalled();

    const status = handlers.getStatus({ jobId: start.jobId });
    expect(status.status).toBe("cancelled");
  });

  it("getStatus returns correct fields for unknown job", () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const status = handlers.getStatus({ jobId: "nonexistent" });
    expect(status.status).toBe("error");
    expect(status.sizeBytes).toBeNull();
    expect(status.diskBytes).toBeNull();
    expect(status.fileCount).toBeNull();
    expect(status.folderCount).toBeNull();
    expect(status.error).toBe("Unknown folder size job.");
  });

  it("new start while active cancels previous and queues", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const first = handlers.start({ path: "/test/a" });
    expect(first.status).toBe("running");

    const second = handlers.start({ path: "/test/b" });
    expect(second.status).toBe("queued");
    expect(native.cancelFolderSize).toHaveBeenCalledTimes(1);

    // First job was cancelled
    const firstStatus = handlers.getStatus({ jobId: first.jobId });
    expect(firstStatus.status).toBe("cancelled");
  });

  it("sub-folder cache population from walk results", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    // Sub-folder should be cached from the walk
    expect(handlers.getCachedSize("/test/sub")).toBe(500);

    // Its counts come along: asking for it afterwards is a cache hit.
    const sub = handlers.start({ path: "/test/sub" });
    expect(sub.status).toBe("ready");
    const status = handlers.getStatus({ jobId: sub.jobId });
    expect(status.fileCount).toBe(20);
    expect(status.folderCount).toBe(3);
  });

  it("queued job starts after active finishes", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    handlers.start({ path: "/test/a" });
    const second = handlers.start({ path: "/test/b" });
    expect(second.status).toBe("queued");

    // Complete first job (cancel resolves with error)
    const cancelErr = new Error("ECANCELLED");
    (cancelErr as unknown as { code: string }).code = "ECANCELLED";
    native.rejectActive(cancelErr);
    await new Promise((r) => setTimeout(r, 0));

    // Second job should now be running
    expect(native.getFolderSize).toHaveBeenCalledTimes(2);
    expect(native.getFolderSize).toHaveBeenLastCalledWith("/test/b");
  });

  it("error job has null diskBytes and counts", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const start = handlers.start({ path: "/test" });
    native.rejectActive(new Error("ENOENT: not found"));
    await new Promise((r) => setTimeout(r, 0));

    const status = handlers.getStatus({ jobId: start.jobId });
    expect(status.status).toBe("error");
    expect(status.sizeBytes).toBeNull();
    expect(status.diskBytes).toBeNull();
    expect(status.fileCount).toBeNull();
    expect(status.folderCount).toBeNull();
    expect(status.error).toBe("ENOENT: not found");
  });

  it("clearCache empties the folder size cache", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    expect(handlers.getCachedSize("/test")).toBe(1000);
    handlers.clearCache();
    expect(handlers.getCachedSize("/test")).toBeUndefined();
  });

  it("keeps only the most recent finished jobs so repeated probes do not grow without bound", async () => {
    resetResponseCacheState();
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const running = handlers.start({ path: "/walking" });
    const probes = Array.from({ length: 1_000 }, (_, index) =>
      handlers.start({ path: `/probe/${index}`, probeOnly: true }),
    );

    expect(getResponseCacheSizes().folderSizeJobs).toBe(257);
    expect(handlers.getStatus({ jobId: running.jobId }).status).toBe("running");
    expect(handlers.getStatus({ jobId: probes.at(-1)?.jobId ?? "" }).status).toBe("deferred");
    expect(handlers.getStatus({ jobId: probes[0]?.jobId ?? "" }).error).toBe(
      "Unknown folder size job.",
    );

    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.getStatus({ jobId: running.jobId }).status).toBe("ready");
    resetResponseCacheState();
  });
});

describe("getCachedResponse", () => {
  it("caps cached directory snapshots and evicts the oldest first", async () => {
    resetResponseCacheState();
    for (let index = 0; index < 200; index += 1) {
      await getCachedResponse("directory", { path: `/dir/${index}` }, async () => index);
    }
    expect(getResponseCacheSizes().directorySnapshots).toBe(64);

    const load = vi.fn(async () => -1);
    expect(await getCachedResponse("directory", { path: "/dir/199" }, load)).toBe(199);
    expect(await getCachedResponse("directory", { path: "/dir/0" }, load)).toBe(-1);
    expect(load).toHaveBeenCalledTimes(1);
    resetResponseCacheState();
  });

  it("doesn't keep an answer that was loading when the caches were cleared", async () => {
    resetResponseCacheState();
    let finishLoad: ((value: string) => void) | null = null;
    const pending = getCachedResponse(
      "directory",
      { path: "/dir" },
      () =>
        new Promise<string>((resolveLoad) => {
          finishLoad = resolveLoad;
        }),
    );
    // A write finishes while the folder is still being read: what the read returns may be
    // from before the write.
    clearResponseCaches();
    (finishLoad as ((value: string) => void) | null)?.("before the write");
    expect(await pending).toBe("before the write");

    const load = vi.fn(async () => "after the write");
    expect(await getCachedResponse("directory", { path: "/dir" }, load)).toBe("after the write");
    expect(load).toHaveBeenCalledTimes(1);
    // A load that started after the clear is kept as usual.
    expect(await getCachedResponse("directory", { path: "/dir" }, load)).toBe("after the write");
    expect(load).toHaveBeenCalledTimes(1);
    resetResponseCacheState();
  });

  it("doesn't keep item details that were loading when the caches were cleared", async () => {
    resetResponseCacheState();
    let finishRequest: (() => void) | null = null;
    const request = vi.fn(
      (_channel: string, payload: { paths: string[] }) =>
        new Promise((resolveRequest) => {
          finishRequest = () =>
            resolveRequest({
              directoryPath: "/dir",
              items: payload.paths.map((path) => ({ path, stale: true })),
            });
        }),
    );
    const workerClient = { request } as unknown as ExplorerWorkerClient;
    const payload = { directoryPath: "/dir", paths: ["/dir/a.txt"] } as Parameters<
      typeof getCachedMetadataBatch
    >[1];

    const pending = getCachedMetadataBatch(workerClient, payload);
    clearResponseCaches();
    (finishRequest as (() => void) | null)?.();
    await pending;

    expect(getResponseCacheSizes().directoryMetadata).toBe(0);
    const next = getCachedMetadataBatch(workerClient, payload);
    expect(request).toHaveBeenCalledTimes(2);
    (finishRequest as (() => void) | null)?.();
    await next;
    expect(getResponseCacheSizes().directoryMetadata).toBe(1);
    resetResponseCacheState();
  });
});
