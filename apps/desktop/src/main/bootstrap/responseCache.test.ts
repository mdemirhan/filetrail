import { describe, expect, it, vi } from "vitest";

import type { ExplorerWorkerClient } from "@filetrail/core";

import {
  clearResponseCaches,
  createFolderSizeHandlers,
  forgetFolderListings,
  getCachedMetadataBatch,
  getCachedResponse,
  getResponseCacheSizes,
  noteWriteEnded,
  noteWriteStarting,
  resetResponseCacheState,
  withTiming,
} from "./responseCache";

function createMockNative() {
  let resolveActive: ((value: string) => void) | null = null;
  let rejectActive: ((reason: unknown) => void) | null = null;
  let finishedActive: ((finishedJson: string) => void) | null = null;

  return {
    getFolderSize: vi.fn(
      (
        _path: string,
        onFinished?: (finishedJson: string) => void,
        _options?: { background: boolean },
      ) =>
        new Promise<string>((resolve, reject) => {
          resolveActive = resolve;
          rejectActive = reject;
          finishedActive = onFinished ?? null;
        }),
    ),
    cancelFolderSize: vi.fn(),
    // Folders the active walk has finished, handed over while it runs.
    finish(dirs: Record<string, [number, number, number, number]>, dev = 16) {
      finishedActive?.(JSON.stringify({ dev, dirs }));
    },
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

  it("answers a probe with the sizes it knows, measuring nothing", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    expect(handlers.probeMany({ paths: ["/test"] })).toEqual({ sizes: [] });
    expect(native.getFolderSize).not.toHaveBeenCalled();

    handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    expect(handlers.probeMany({ paths: ["/test", "/test/sub", "/elsewhere"] })).toEqual({
      sizes: [
        { path: "/test", sizeBytes: 1000, diskBytes: 1200, fileCount: 42, folderCount: 7 },
        { path: "/test/sub", sizeBytes: 500, diskBytes: 600, fileCount: 20, folderCount: 3 },
      ],
    });
    expect(native.getFolderSize).toHaveBeenCalledTimes(1);
  });

  // Each probe made a job, and over 256 of them between a window's polls pushed out the
  // finished job it was about to read: "Unknown folder size job."
  it("makes no job for a probe, so probes never push out a job a window waits on", async () => {
    resetResponseCacheState();
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    const measured = handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    for (let index = 0; index < 1_000; index++) {
      handlers.probeMany({ paths: [`/probe/${index}`, "/test/sub"] });
    }

    expect(getResponseCacheSizes().folderSizeJobs).toBe(1);
    expect(handlers.getStatus({ jobId: measured.jobId })).toMatchObject({
      status: "ready",
      sizeBytes: 1000,
    });
    resetResponseCacheState();
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

    expect(handlers.getCachedSize("/Users/demo/Project")).toBeUndefined();
    expect(handlers.getCachedSize("/Users/demo/Music")).toBe(1000);
  });

  // 100,000 cached sizes against 10,000 changed paths took 55 s, asked one pair at a time.
  it("forgets the sizes a large write touched quickly, however many are kept", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    const dirs: Record<string, [number, number, number, number]> = {};
    for (let index = 0; index < 50_000; index++) {
      dirs[`/Users/demo/Library/c${index % 500}/d${index}`] = [1, 1, 1, 0];
    }
    handlers.start({ path: "/Users/demo/Library" });
    native.resolveActive(JSON.stringify({ ...JSON.parse(sampleJson), dirs }));
    await new Promise((r) => setTimeout(r, 0));
    const changed = Array.from(
      { length: 5_000 },
      (_, index) => `/Users/demo/Library/c7/d${index * 500 + 7}/new.txt`,
    );

    const started = performance.now();
    clearResponseCaches(changed);
    // Well under 100 ms on a laptop; the bound only catches going back to every pair.
    expect(performance.now() - started).toBeLessThan(3_000);
    expect(handlers.getCachedSize("/Users/demo/Library/c7/d7")).toBeUndefined();
    expect(handlers.getCachedSize("/Users/demo/Library/c7")).toBeUndefined();
    expect(handlers.getCachedSize("/Users/demo/Library")).toBeUndefined();
    expect(handlers.getCachedSize("/Users/demo/Library/c8/d8")).toBe(1);
  });

  it("keeps the sizes used most recently, up to its limit", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers({ ...native, maxFolderSizes: 3 });
    handlers.start({ path: "/test" });
    native.finish({ "/test/a": [1, 1, 1, 0], "/test/b": [2, 2, 1, 0] });
    // Asked about, so kept over the one not asked about.
    handlers.probeMany({ paths: ["/test/a"] });
    native.resolveActive(
      JSON.stringify({ ...JSON.parse(sampleJson), dirs: { "/test/c": [3, 3, 1, 0] } }),
    );
    await new Promise((r) => setTimeout(r, 0));

    expect(handlers.getCachedSize("/test/b")).toBeUndefined();
    expect(handlers.getCachedSize("/test/a")).toBe(1);
    expect(handlers.getCachedSize("/test/c")).toBe(3);
    expect(handlers.getCachedSize("/test")).toBe(1000);
  });

  it("measures at a lower priority what the app measures by itself", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    handlers.start({ path: "/test/auto", automatic: true });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));
    handlers.start({ path: "/test/asked" });

    expect(native.getFolderSize.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ["/test/auto", { background: true }],
      ["/test/asked", { background: false }],
    ]);
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
        dirs: { "/Users/demo/Downloads": [600, 1_200, 6, 0] },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    clearResponseCaches([], [trashedZip]);

    expect(handlers.getCachedSize("/Users/demo")).toBe(800);
  });

  // Folder 100 MB holding Inner 50 MB; Inner grew to 80 MB and was measured again by
  // itself. Moving Inner to the Trash took 80 MB off Folder: 20 MB, where 50 MB remained.
  it("forgets a folder rather than take off what was measured again inside it", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
    handlers.start({ path: "/Users/demo/Folder" });
    native.resolveActive(
      JSON.stringify({
        total: 100,
        diskTotal: 100,
        fileCount: 2,
        folderCount: 1,
        dev: 16,
        dirs: { "/Users/demo/Folder/Inner": [50, 50, 1, 0] },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    handlers.start({ path: "/Users/demo/Folder/Inner", recalculate: true });
    native.resolveActive(
      JSON.stringify({ total: 80, diskTotal: 80, fileCount: 2, folderCount: 0, dev: 16, dirs: {} }),
    );
    await new Promise((r) => setTimeout(r, 0));

    clearResponseCaches(
      [],
      [
        {
          path: "/Users/demo/Folder/Inner",
          item: { kind: "folder", sizeBytes: 0, diskBytes: 0, dev: 16 },
          intoHomeTrash: false,
        },
      ],
    );

    expect(handlers.getCachedSize("/Users/demo/Folder")).toBeUndefined();
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

  it("stops a measurement a write has outdated, rather than let it finish for nothing", () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    handlers.start({ path: "/test" });

    clearResponseCaches(["/elsewhere/new.txt"]);
    expect(native.cancelFolderSize).not.toHaveBeenCalled();
    clearResponseCaches(["/test/new.txt"]);
    clearResponseCaches(["/test/another.txt"]);

    expect(native.cancelFolderSize).toHaveBeenCalledTimes(1);
  });

  it("measures again, under the same job, one stopped because a write outdated it", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    const { jobId } = handlers.start({ path: "/test" });
    clearResponseCaches(["/test/new.txt"]);
    native.rejectActive(Object.assign(new Error("cancelled"), { code: "ECANCELLED" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(native.getFolderSize).toHaveBeenCalledTimes(2);
    expect(handlers.getStatus({ jobId }).status).toBe("running");
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.getStatus({ jobId })).toMatchObject({ status: "ready", sizeBytes: 1000 });
  });

  // It was left "running" for good: the window showed Calculating… and polled forever.
  it("measures an outdated measurement again after another window's waiting one", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    const first = handlers.start({ path: "/test/a" }, 1);
    const second = handlers.start({ path: "/test/b" }, 2);
    clearResponseCaches(["/test/a/new.txt"]);
    // Finished before the stop reached it.
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    // The other window's measurement runs first; the outdated one waits behind it.
    expect(native.getFolderSize).toHaveBeenLastCalledWith(
      "/test/b",
      expect.any(Function),
      expect.anything(),
    );
    expect(handlers.getStatus({ jobId: first.jobId }).status).toBe("queued");
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.getStatus({ jobId: second.jobId }).status).toBe("ready");

    expect(native.getFolderSize).toHaveBeenLastCalledWith(
      "/test/a",
      expect.any(Function),
      expect.anything(),
    );
    expect(handlers.getStatus({ jobId: first.jobId }).status).toBe("running");
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.getStatus({ jobId: first.jobId })).toMatchObject({
      status: "ready",
      sizeBytes: 1000,
    });
  });

  it("takes a waiting measurement off the queue when it is stopped", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    handlers.start({ path: "/test/a" }, 1);
    const waiting = handlers.start({ path: "/test/b" }, 2);

    handlers.cancel({ jobId: waiting.jobId });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    expect(handlers.getStatus({ jobId: waiting.jobId }).status).toBe("cancelled");
    expect(native.getFolderSize).toHaveBeenCalledTimes(1);
  });

  it("learns the Trash was read from measuring the Trash itself", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
    handlers.start({ path: "/Users/demo/.Trash" });
    native.resolveActive(
      JSON.stringify({
        total: 50,
        diskTotal: 100,
        fileCount: 1,
        folderCount: 0,
        dev: 16,
        dirs: {},
      }),
    );
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

    clearResponseCaches([], [trashedZip]);

    expect(handlers.getCachedSize("/Users/demo/.Trash")).toBe(250);
    expect(handlers.getCachedSize("/Users/demo/Downloads")).toBe(400);
  });

  it("lets Stop end a measurement a write had outdated", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    const { jobId } = handlers.start({ path: "/test" });
    clearResponseCaches(["/test/new.txt"]);
    handlers.cancel({ jobId });
    native.rejectActive(Object.assign(new Error("cancelled"), { code: "ECANCELLED" }));
    await new Promise((r) => setTimeout(r, 0));

    expect(native.getFolderSize).toHaveBeenCalledTimes(1);
    expect(handlers.getStatus({ jobId }).status).toBe("cancelled");
  });

  // Only a running one was marked: a stopped walk that finished all the same kept what it
  // had seen of the change.
  it("keeps nothing of a stopped measurement that a write outdates before it ends", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    const { jobId } = handlers.start({ path: "/test" });
    handlers.cancel({ jobId });

    clearResponseCaches(["/test/sub/new.txt"]);
    // Still stopping: it finishes a folder, then the walk.
    native.finish({ "/test/sub": [5, 5, 1, 0] });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    expect(handlers.getCachedSize("/test/sub")).toBeUndefined();
    expect(handlers.getCachedSize("/test")).toBeUndefined();
    expect(native.getFolderSize).toHaveBeenCalledTimes(1);
    expect(handlers.getStatus({ jobId }).status).toBe("cancelled");
  });

  it("drops the finished jobs it keeps too many of when it measures again at once", async () => {
    resetResponseCacheState();
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    handlers.start({ path: "/test" }, 1);
    for (let index = 0; index < 300; index++) {
      handlers.cancel(handlers.start({ path: `/waiting/${index}` }, 2));
    }
    expect(getResponseCacheSizes().folderSizeJobs).toBe(301);

    clearResponseCaches(["/test/new.txt"]);
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    expect(native.getFolderSize).toHaveBeenCalledTimes(2);
    expect(getResponseCacheSizes().folderSizeJobs).toBe(257);
    resetResponseCacheState();
  });

  // 400,000 sizes took 7 s, one 10,000-folder take of a walk half a second: each size stored
  // looked for the oldest from the start of the cache, past all those let go before it.
  it("keeps up with a walk that stores far more sizes than it keeps", () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    handlers.start({ path: "/Users/demo" });
    const started = performance.now();
    for (let take = 0; take < 40; take++) {
      const dirs: Record<string, [number, number, number, number]> = {};
      for (let index = take * 10_000; index < (take + 1) * 10_000; index++) {
        dirs[`/Users/demo/Library/c${index % 400}/d${index}`] = [1, 1, 1, 0];
      }
      native.finish(dirs);
    }
    // About a second on a laptop; the bound only catches going back to one at a time.
    expect(performance.now() - started).toBeLessThan(6_000);
    expect(handlers.getCachedSize("/Users/demo/Library/c399/d399999")).toBe(1);
    expect(handlers.getCachedSize("/Users/demo/Library/c0/d0")).toBeUndefined();
  });

  describe("folders finished while measuring", () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));

    it("keeps each folder as it is finished, and counts them for the window", async () => {
      const native = createMockNative();
      const handlers = createFolderSizeHandlers(native);
      const { jobId } = handlers.start({ path: "/test" });

      native.finish({ "/test/a/deep": [100, 200, 1, 0], "/test/a": [150, 300, 2, 1] });

      expect(handlers.getStatus({ jobId })).toMatchObject({
        status: "running",
        measuredFolderCount: 2,
      });
      expect(handlers.getCachedSize("/test/a")).toBe(150);
      expect(handlers.probeMany({ paths: ["/test/a/deep"] }).sizes).toMatchObject([
        { sizeBytes: 100 },
      ]);

      // The rest come with the result.
      native.resolveActive(
        JSON.stringify({
          total: 500,
          diskTotal: 900,
          fileCount: 5,
          folderCount: 3,
          dev: 16,
          dirs: { "/test/b": [300, 500, 2, 0] },
        }),
      );
      await tick();
      expect(handlers.getStatus({ jobId })).toMatchObject({
        status: "ready",
        sizeBytes: 500,
        measuredFolderCount: 3,
      });
      expect(handlers.getCachedSize("/test/b")).toBe(300);
      expect(handlers.getCachedSize("/test/a")).toBe(150);
    });

    it("keeps the folders finished before a cancel", async () => {
      const native = createMockNative();
      const handlers = createFolderSizeHandlers(native);
      const { jobId } = handlers.start({ path: "/test" });
      native.finish({ "/test/a": [150, 300, 2, 1] });

      handlers.cancel({ jobId });
      // Finished before the walk stopped: handed over as it rejects.
      native.finish({ "/test/b": [70, 80, 1, 0] });
      native.rejectActive(Object.assign(new Error("cancelled"), { code: "ECANCELLED" }));
      await tick();

      expect(handlers.getStatus({ jobId }).status).toBe("cancelled");
      expect(handlers.getCachedSize("/test")).toBeUndefined();
      expect(handlers.getCachedSize("/test/a")).toBe(150);
      expect(handlers.getCachedSize("/test/b")).toBe(70);
    });

    it("stops keeping folders once a write has outdated the measurement, until it runs again", async () => {
      const native = createMockNative();
      const handlers = createFolderSizeHandlers(native);
      const { jobId } = handlers.start({ path: "/test" });
      native.finish({ "/test/a": [150, 300, 2, 1] });

      clearResponseCaches(["/test/b/new.txt"]);
      // May have been counted before or after the change.
      native.finish({ "/test/b": [70, 80, 1, 0] });
      expect(handlers.getCachedSize("/test/b")).toBeUndefined();
      // Untouched by the write.
      expect(handlers.getCachedSize("/test/a")).toBe(150);

      native.resolveActive(sampleJson);
      await tick();
      expect(native.getFolderSize).toHaveBeenCalledTimes(2);
      expect(handlers.getCachedSize("/test")).toBeUndefined();

      // Measured again: what it finishes is kept, and the count only goes up.
      native.finish({ "/test/b": [90, 100, 2, 0] });
      expect(handlers.getCachedSize("/test/b")).toBe(90);
      expect(handlers.getStatus({ jobId }).measuredFolderCount).toBe(2);
    });

    // A folder finished after a delete removed something from it already leaves it out:
    // taking it off again when the delete ends would count it twice.
    it("measures again, rather than adjusts, a folder stored while a delete was running", async () => {
      resetResponseCacheState();
      const native = createMockNative();
      const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
      handlers.start({ path: "/Users/demo/Work" });
      native.finish({ "/Users/demo/Work/old": [1_000, 2_000, 4, 0] });
      native.resolveActive(
        JSON.stringify({
          total: 5_000,
          diskTotal: 10_000,
          fileCount: 20,
          folderCount: 2,
          dev: 16,
          dirs: {},
        }),
      );
      await tick();

      noteWriteStarting();
      handlers.start({ path: "/Users/demo/Projects" });
      // Finished after the delete below had already taken a.txt out of it.
      native.finish({ "/Users/demo/Projects/app": [300, 600, 3, 0] });
      native.resolveActive(
        JSON.stringify({
          total: 800,
          diskTotal: 1_600,
          fileCount: 6,
          folderCount: 1,
          dev: 16,
          dirs: {},
        }),
      );
      await tick();
      const removedFile = (path: string) => ({
        path,
        item: { kind: "file" as const, sizeBytes: 100, diskBytes: 200, dev: 16 },
        intoHomeTrash: false,
      });
      clearResponseCaches(
        [],
        [removedFile("/Users/demo/Projects/app/a.txt"), removedFile("/Users/demo/Work/old/b.txt")],
      );

      expect(handlers.getCachedSize("/Users/demo/Projects/app")).toBeUndefined();
      expect(handlers.getCachedSize("/Users/demo/Projects")).toBeUndefined();
      // Stored before the delete started: adjusted as before.
      expect(handlers.getCachedSize("/Users/demo/Work/old")).toBe(900);
      expect(handlers.getCachedSize("/Users/demo/Work")).toBe(4_900);
      resetResponseCacheState();
    });

    // Every size stored after a write started was noted until the next one started.
    it("adjusts a folder stored while a write ran once that write's end is cleared", async () => {
      resetResponseCacheState();
      const native = createMockNative();
      const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
      noteWriteStarting();
      handlers.start({ path: "/Users/demo/Projects" });
      native.finish({ "/Users/demo/Projects/app": [300, 600, 3, 0] });
      native.resolveActive(
        JSON.stringify({
          total: 800,
          diskTotal: 1_600,
          fileCount: 6,
          folderCount: 1,
          dev: 16,
          dirs: {},
        }),
      );
      await tick();
      noteWriteEnded();

      clearResponseCaches(
        [],
        [
          {
            path: "/Users/demo/Projects/app/a.txt",
            item: { kind: "file", sizeBytes: 100, diskBytes: 200, dev: 16 },
            intoHomeTrash: false,
          },
        ],
      );

      expect(handlers.getCachedSize("/Users/demo/Projects/app")).toBe(200);
      expect(handlers.getCachedSize("/Users/demo/Projects")).toBe(700);
    });

    it("learns whether the Trash was read from the folders as they are finished", async () => {
      const native = createMockNative();
      const handlers = createFolderSizeHandlers({ ...native, homePath: "/Users/demo" });
      handlers.start({ path: "/Users" });
      native.finish({
        "/Users/demo/Downloads": [600, 1_200, 6, 0],
        "/Users/demo/.Trash": [50, 100, 1, 0],
      });
      native.finish({ "/Users/demo": [1_000, 2_000, 10, 3] });
      native.resolveActive(
        JSON.stringify({
          total: 1_000,
          diskTotal: 2_000,
          fileCount: 10,
          folderCount: 4,
          dev: 16,
          dirs: {},
        }),
      );
      await tick();

      clearResponseCaches([], [trashedZip]);

      // The Trash was counted, so the zip is still in the home folder.
      expect(handlers.getCachedSize("/Users/demo")).toBe(1_000);
      expect(handlers.getCachedSize("/Users/demo/.Trash")).toBe(250);
    });
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

  it("leaves another window's walk running and queues behind it", async () => {
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);

    const first = handlers.start({ path: "/test/a" }, 1);
    const second = handlers.start({ path: "/test/b" }, 2);
    expect(second.status).toBe("queued");
    expect(native.cancelFolderSize).not.toHaveBeenCalled();
    expect(handlers.getStatus({ jobId: first.jobId }).status).toBe("running");

    // The second window asks again: its own waiting job gives way, the first window's walk
    // still runs.
    const third = handlers.start({ path: "/test/c" }, 2);
    expect(handlers.getStatus({ jobId: second.jobId }).status).toBe("cancelled");
    expect(third.status).toBe("queued");
    expect(native.cancelFolderSize).not.toHaveBeenCalled();

    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.getStatus({ jobId: first.jobId }).status).toBe("ready");
    expect(native.getFolderSize).toHaveBeenLastCalledWith("/test/c", expect.any(Function), {
      background: false,
    });

    // The first window's next walk stops none of the second's.
    handlers.start({ path: "/test/d" }, 1);
    expect(native.cancelFolderSize).not.toHaveBeenCalled();
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
    expect(native.getFolderSize).toHaveBeenLastCalledWith("/test/b", expect.any(Function), {
      background: false,
    });
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

  it("keeps only the most recent finished jobs so repeated calculations do not grow without bound", async () => {
    resetResponseCacheState();
    const native = createMockNative();
    const handlers = createFolderSizeHandlers(native);
    handlers.start({ path: "/test" });
    native.resolveActive(sampleJson);
    await new Promise((r) => setTimeout(r, 0));

    const running = handlers.start({ path: "/walking" });
    // Known already: each answered by a job that is ready at once.
    const known = Array.from({ length: 1_000 }, () => handlers.start({ path: "/test/sub" }, 2));

    expect(getResponseCacheSizes().folderSizeJobs).toBe(257);
    expect(handlers.getStatus({ jobId: running.jobId }).status).toBe("running");
    expect(handlers.getStatus({ jobId: known.at(-1)?.jobId ?? "" }).status).toBe("ready");
    expect(handlers.getStatus({ jobId: known[0]?.jobId ?? "" }).error).toBe(
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

describe("forgetFolderListings", () => {
  const detailPaths = ["/p/a", "/p/a/x.txt", "/p/a/y.txt", "/p/b/z.txt"];

  // Fills the caches as windows showing /p, /p/a and /p/b would.
  async function fillCaches() {
    for (const path of ["/p", "/p/a", "/p/b"]) {
      await getCachedResponse("directory", { path, sortBy: "name" }, async () => "listing");
      await getCachedResponse("tree", { path }, async () => "children");
    }
    await getCachedResponse("directory", { path: "/p/a", sortBy: "size" }, async () => "by size");
    const workerClient = {
      request: async (_channel: string, payload: { paths: string[] }) => ({
        directoryPath: "/p",
        items: payload.paths.map((path) => ({ path })),
      }),
    } as unknown as ExplorerWorkerClient;
    await getCachedMetadataBatch(workerClient, {
      directoryPath: "/p",
      paths: detailPaths,
    } as Parameters<typeof getCachedMetadataBatch>[1]);
  }

  // Which of the cached answers are still handed out without reading the disk.
  async function stillCached(): Promise<string[]> {
    const kept: string[] = [];
    for (const path of ["/p", "/p/a", "/p/b"]) {
      let loaded = false;
      const load = async () => {
        loaded = true;
        return "read again";
      };
      await getCachedResponse("directory", { path, sortBy: "name" }, load);
      if (!loaded) {
        kept.push(`listing ${path}`);
      }
      loaded = false;
      await getCachedResponse("tree", { path }, load);
      if (!loaded) {
        kept.push(`children ${path}`);
      }
    }
    let readAgain: string[] = [];
    const workerClient = {
      request: async (_channel: string, payload: { paths: string[] }) => {
        readAgain = payload.paths;
        return { directoryPath: "/p", items: [] };
      },
    } as unknown as ExplorerWorkerClient;
    await getCachedMetadataBatch(workerClient, {
      directoryPath: "/p",
      paths: detailPaths,
    } as Parameters<typeof getCachedMetadataBatch>[1]);
    for (const path of detailPaths) {
      if (!readAgain.includes(path)) {
        kept.push(`details ${path}`);
      }
    }
    return kept;
  }

  it("lets go of the folder's listings and the details of the items that changed", async () => {
    resetResponseCacheState();
    await fillCaches();

    forgetFolderListings("/p/a", ["/p/a/x.txt"]);

    expect(await stillCached()).toEqual([
      "listing /p",
      "children /p",
      "listing /p/b",
      "children /p/b",
      "details /p/a",
      "details /p/a/y.txt",
      "details /p/b/z.txt",
    ]);
    // Read again however it is sorted.
    const load = vi.fn(async () => "read again");
    await getCachedResponse("directory", { path: "/p/a", sortBy: "size" }, load);
    expect(load).toHaveBeenCalledTimes(1);
    resetResponseCacheState();
  });

  it("lets go of all in the folder, and of the listing holding it, when anything may have changed", async () => {
    resetResponseCacheState();
    await fillCaches();

    // The folder itself may be gone, and the window then opens the folder above it.
    forgetFolderListings("/p/a", null);

    expect(await stillCached()).toEqual(["listing /p/b", "children /p/b", "details /p/b/z.txt"]);
    resetResponseCacheState();
  });

  it("doesn't keep a listing of the folder that was loading when it changed", async () => {
    resetResponseCacheState();
    let finishLoad: ((value: string) => void) | null = null;
    const pending = getCachedResponse(
      "directory",
      { path: "/p/a" },
      () =>
        new Promise<string>((resolveLoad) => {
          finishLoad = resolveLoad;
        }),
    );
    forgetFolderListings("/p/a", ["/p/a/x.txt"]);
    (finishLoad as ((value: string) => void) | null)?.("before the change");
    expect(await pending).toBe("before the change");

    const load = vi.fn(async () => "after the change");
    expect(await getCachedResponse("directory", { path: "/p/a" }, load)).toBe("after the change");
    expect(load).toHaveBeenCalledTimes(1);
    resetResponseCacheState();
  });
});

describe("withTiming", () => {
  it("logs only a slow load, with its label and path", async () => {
    const logger = { debug: vi.fn() };
    await expect(withTiming("fast", "/a", async () => 1, logger)).resolves.toBe(1);
    expect(logger.debug).not.toHaveBeenCalled();

    const now = vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(150);
    try {
      await expect(withTiming("slow", "/b", async () => 2, logger)).resolves.toBe(2);
    } finally {
      now.mockRestore();
    }
    expect(logger.debug).toHaveBeenCalledWith("[filetrail] slow /b 150ms");
  });
});
