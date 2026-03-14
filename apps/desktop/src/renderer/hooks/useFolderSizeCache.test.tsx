// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { createMockFiletrailClient } from "../test/mockFiletrailClient";
import { useFolderSizeCache } from "./useFolderSizeCache";

function createHandlers(overrides: Record<string, unknown> = {}) {
  const startHandler = vi.fn(async () => ({
    jobId: "job-1",
    status: "running" as const,
    ...overrides,
  }));
  const getStatusHandler = vi.fn(async () => ({
    jobId: "job-1",
    status: "ready" as const,
    sizeBytes: 1000,
    diskBytes: 1200,
    fileCount: 42,
    error: null,
  }));
  const cancelHandler = vi.fn(async () => ({ ok: true }));

  return { startHandler, getStatusHandler, cancelHandler };
}

describe("useFolderSizeCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getEntry returns idle for unknown paths", () => {
    const { startHandler, getStatusHandler, cancelHandler } = createHandlers();
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));
    // First call to getEntry triggers probeCache; the entry is idle initially
    const entry = result.current.getEntry("/test");
    expect(entry.status).toBe("idle");
  });

  it("calculateFolderSize transitions idle to calculating to ready", async () => {
    const { startHandler, getStatusHandler, cancelHandler } = createHandlers();
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    // Start calculation
    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });

    // The polling interval fires and checks status
    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    // Allow microtasks from polling
    await act(async () => {
      await Promise.resolve();
    });

    const entry = result.current.getEntry("/test");
    expect(entry.status).toBe("ready");
    if (entry.status === "ready") {
      expect(entry.sizeBytes).toBe(1000);
      expect(entry.diskBytes).toBe(1200);
      expect(entry.fileCount).toBe(42);
    }
  });

  it("calculateFolderSize with cache hit goes straight to ready", async () => {
    const { getStatusHandler, cancelHandler } = createHandlers();
    // start returns ready (cache hit)
    const startHandler = vi.fn(async () => ({
      jobId: "job-1",
      status: "ready" as const,
    }));
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });

    const entry = result.current.getEntry("/test");
    expect(entry.status).toBe("ready");
    if (entry.status === "ready") {
      expect(entry.sizeBytes).toBe(1000);
      expect(entry.diskBytes).toBe(1200);
      expect(entry.fileCount).toBe(42);
    }
  });

  it("cancelFolderSize stops polling and resets to idle", async () => {
    const { startHandler, cancelHandler } = createHandlers();
    // getStatus returns running (not yet ready)
    const getStatusHandler = vi.fn(async () => ({
      jobId: "job-1",
      status: "running" as const,
      sizeBytes: null,
      diskBytes: null,
      fileCount: null,
      error: null,
    }));
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });

    // Entry is calculating
    expect(result.current.getEntry("/test").status).toBe("calculating");

    // Cancel
    await act(async () => {
      await result.current.cancelFolderSize("/test");
    });

    expect(result.current.getEntry("/test").status).toBe("idle");
    expect(cancelHandler).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  it("recalculateFolderSize passes recalculate flag", async () => {
    const { startHandler, getStatusHandler, cancelHandler } = createHandlers();
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    await act(async () => {
      result.current.recalculateFolderSize("/test");
      await Promise.resolve();
    });

    expect(startHandler).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/test", recalculate: true }),
    );
  });

  it("probeCache fires after debounce on first getEntry for unknown path", async () => {
    const startHandler = vi.fn(async () => ({
      jobId: "probe-1",
      status: "deferred" as const,
    }));
    const getStatusHandler = vi.fn(async () => ({
      jobId: "probe-1",
      status: "deferred" as const,
      sizeBytes: null,
      diskBytes: null,
      fileCount: null,
      error: null,
    }));
    const cancelHandler = vi.fn(async () => ({ ok: true }));
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    act(() => {
      result.current.getEntry("/test");
    });

    // Probe is debounced — not fired yet
    expect(startHandler).not.toHaveBeenCalled();

    // Advance past the debounce delay
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(startHandler).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/test", probeOnly: true }),
    );
  });

  it("debounced probe batches all paths during rapid navigation", async () => {
    const startHandler = vi.fn(async () => ({
      jobId: "probe-1",
      status: "deferred" as const,
    }));
    const getStatusHandler = vi.fn(async () => ({
      jobId: "probe-1",
      status: "deferred" as const,
      sizeBytes: null,
      diskBytes: null,
      fileCount: null,
      error: null,
    }));
    const cancelHandler = vi.fn(async () => ({ ok: true }));
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    // Simulate rapid keyboard navigation through 3 directories
    act(() => {
      result.current.getEntry("/dir-a");
      result.current.getEntry("/dir-b");
      result.current.getEntry("/dir-c");
    });

    // No probes fired yet (debounced)
    expect(startHandler).not.toHaveBeenCalled();

    // Advance past debounce — all 3 paths get probed in one batch
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    const probeCalls = startHandler.mock.calls.filter(
      (call: unknown[]) => (call[0] as { probeOnly?: boolean }).probeOnly === true,
    );
    expect(probeCalls).toHaveLength(3);
    const probedPaths = probeCalls.map((call: unknown[]) => (call[0] as { path: string }).path);
    expect(probedPaths).toContain("/dir-a");
    expect(probedPaths).toContain("/dir-b");
    expect(probedPaths).toContain("/dir-c");
  });

  it("polling stops on error status", async () => {
    const { startHandler, cancelHandler } = createHandlers();
    let callCount = 0;
    const getStatusHandler = vi.fn(async () => {
      callCount++;
      if (callCount >= 2) {
        return {
          jobId: "job-1",
          status: "error" as const,
          sizeBytes: null,
          diskBytes: null,
          fileCount: null,
          error: "Disk error",
        };
      }
      return {
        jobId: "job-1",
        status: "running" as const,
        sizeBytes: null,
        diskBytes: null,
        fileCount: null,
        error: null,
      };
    });
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });

    // First poll: running
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    // Second poll: error
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });

    const entry = result.current.getEntry("/test");
    expect(entry.status).toBe("error");
    if (entry.status === "error") {
      expect(entry.message).toBe("Disk error");
    }
  });
});
