import { describe, expect, it, vi } from "vitest";

import { createFolderSizeHandlers } from "./responseCache";

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
  dirs: {
    "/test/sub": [500, 600, 20],
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

  it("error job has null diskBytes and fileCount", async () => {
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
});
