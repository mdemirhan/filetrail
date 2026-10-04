// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { createMockFiletrailClient } from "../test/mockFiletrailClient";
import { MAX_FOLDER_SIZE_CACHE_ENTRIES, useFolderSizeCache } from "./useFolderSizeCache";

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
    folderCount: 3,
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
      expect(entry.folderCount).toBe(3);
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
      expect(entry.folderCount).toBe(3);
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
      folderCount: null,
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

  it("probeCache fires immediately on first getEntry for unknown path", async () => {
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
      folderCount: null,
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

    await act(async () => {
      await Promise.resolve();
    });

    expect(startHandler).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/test", probeOnly: true }),
    );
  });

  it("re-probes paths that previously returned deferred", async () => {
    let callCount = 0;
    const startHandler = vi.fn(async () => {
      callCount++;
      // First probe: deferred (not cached yet). Second probe: ready (parent walk populated cache).
      return callCount === 1
        ? { jobId: "probe-1", status: "deferred" as const }
        : { jobId: "probe-2", status: "ready" as const };
    });
    const getStatusHandler = vi.fn(async () => ({
      jobId: "probe-2",
      status: "ready" as const,
      sizeBytes: 5000,
      diskBytes: 6000,
      fileCount: 10,
      folderCount: 3,
      error: null,
    }));
    const cancelHandler = vi.fn(async () => ({ ok: true }));
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));

    // First probe — returns deferred
    act(() => {
      result.current.getEntry("/test");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.getEntry("/test").status).toBe("idle");
    // Re-renders inside the miss cooldown do not re-send the probe.
    expect(startHandler).toHaveBeenCalledTimes(1);

    // Second probe after the cooldown — returns ready (simulating parent walk completed)
    act(() => {
      vi.advanceTimersByTime(5_001);
      result.current.getEntry("/test");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const entry = result.current.getEntry("/test");
    expect(entry.status).toBe("ready");
    // At least 2 probes: first returned deferred, second returned ready.
    // The third getEntry above may fire another probe (a no-op since the
    // entry is now in the renderer cache from the second probe's result).
    expect(
      startHandler.mock.calls.filter(
        (c: unknown[]) => (c[0] as { probeOnly?: boolean }).probeOnly === true,
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("shows the sizes of folders inside right after calculating their parent", async () => {
    let parentCalculated = false;
    const startHandler = vi.fn(
      async (payload: { path: string; probeOnly?: boolean | undefined }) => {
        if (!payload.probeOnly) {
          parentCalculated = true;
          return { jobId: `walk:${payload.path}`, status: "ready" as const };
        }
        // The parent's walk measures the folders inside it too.
        return parentCalculated
          ? { jobId: `probe:${payload.path}`, status: "ready" as const }
          : { jobId: `probe:${payload.path}`, status: "deferred" as const };
      },
    );
    const getStatusHandler = vi.fn(async ({ jobId }: { jobId: string }) => ({
      jobId,
      status: "ready" as const,
      sizeBytes: jobId.endsWith("/out") ? 1000 : 400,
      diskBytes: 0,
      fileCount: 1,
      folderCount: 3,
      error: null,
    }));
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": vi.fn(async () => ({ ok: true })),
    });
    const { result } = renderHook(() => useFolderSizeCache(client));

    // The row for a folder inside asks once and learns nothing yet.
    act(() => {
      result.current.getEntry("/out/FileTrail-darwin-arm64");
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.getEntry("/out/FileTrail-darwin-arm64").status).toBe("idle");

    await act(async () => {
      await result.current.calculateFolderSize("/out");
    });
    // Well inside the 5 s retry cooldown: the next render asks again at once.
    act(() => {
      result.current.getEntry("/out/FileTrail-darwin-arm64");
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.getEntry("/out/FileTrail-darwin-arm64")).toMatchObject({
      status: "ready",
      sizeBytes: 400,
    });
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
          folderCount: null,
          error: "Disk error",
        };
      }
      return {
        jobId: "job-1",
        status: "running" as const,
        sizeBytes: null,
        diskBytes: null,
        fileCount: null,
        folderCount: null,
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

  it("stops polling when the hook unmounts", async () => {
    const { startHandler, getStatusHandler, cancelHandler } = createHandlers();
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result, unmount } = renderHook(() => useFolderSizeCache(client));
    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(getStatusHandler).not.toHaveBeenCalled();
  });

  it("caps cached entries and re-probes evicted paths", async () => {
    const { startHandler, getStatusHandler, cancelHandler } = createHandlers({ status: "ready" });
    const client = createMockFiletrailClient({
      "folderSize:start": startHandler,
      "folderSize:getStatus": getStatusHandler,
      "folderSize:cancel": cancelHandler,
    });

    const { result } = renderHook(() => useFolderSizeCache(client));
    for (let index = 0; index <= MAX_FOLDER_SIZE_CACHE_ENTRIES; index += 1) {
      await act(async () => {
        await result.current.calculateFolderSize(`/dir/${index}`);
      });
    }

    expect(result.current.getEntry(`/dir/${MAX_FOLDER_SIZE_CACHE_ENTRIES}`).status).toBe("ready");
    startHandler.mockClear();
    expect(result.current.getEntry("/dir/0").status).toBe("idle");
    expect(startHandler).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/dir/0", probeOnly: true }),
    );
  });

  // A main process holding the sizes in `sizes`, which a test changes as a write would.
  function createWriteClient(sizes: Map<string, number>) {
    let emit: ((event: unknown) => void) | null = null;
    const probes: string[] = [];
    const client = {
      ...createMockFiletrailClient({
        "folderSize:start": vi.fn(
          async (payload: { path: string; probeOnly?: boolean | undefined }) => {
            if (payload.probeOnly) {
              probes.push(payload.path);
            }
            return sizes.has(payload.path)
              ? { jobId: payload.path, status: "ready" as const }
              : { jobId: payload.path, status: "deferred" as const };
          },
        ),
        "folderSize:getStatus": vi.fn(async (payload: { jobId: string }) => ({
          jobId: payload.jobId,
          status: "ready" as const,
          sizeBytes: sizes.get(payload.jobId) ?? null,
          diskBytes: sizes.get(payload.jobId) ?? null,
          fileCount: 1,
          folderCount: 0,
          error: null,
        })),
        "folderSize:cancel": vi.fn(async () => ({ ok: true })),
      }),
      onWriteOperationProgress: (listener: (event: unknown) => void) => {
        emit = listener;
        return () => undefined;
      },
    };
    const finishWrite = async (action: string, sourcePaths: string[]) => {
      probes.length = 0;
      await act(async () => {
        emit?.({
          operationId: "op-1",
          action,
          status: "completed",
          result: {
            targetPath: null,
            items: sourcePaths.map((sourcePath) => ({ sourcePath, destinationPath: null })),
          },
        });
      });
      await act(async () => {
        await Promise.resolve();
      });
    };
    return { client: client as never, probes, finishWrite };
  }

  it("asks again for the folders a file operation changed, keeping what the main process kept", async () => {
    const sizes = new Map([
      ["/Users/demo/Project", 1_000],
      ["/Users/demo/Project/src", 300],
      ["/Users/demo/Music", 500],
    ]);
    const { client, probes, finishWrite } = createWriteClient(sizes);
    const { result } = renderHook(() => useFolderSizeCache(client, "/Users/demo"));
    await act(async () => {
      for (const path of sizes.keys()) {
        await result.current.calculateFolderSize(path);
      }
    });

    // The main process took the deleted file off Project, and forgot src, which held it.
    sizes.set("/Users/demo/Project", 400);
    sizes.delete("/Users/demo/Project/src");
    await finishWrite("delete_immediately", ["/Users/demo/Project/src/big.bin"]);

    expect(result.current.getEntry("/Users/demo/Project")).toMatchObject({
      status: "ready",
      sizeBytes: 400,
    });
    expect(result.current.getEntry("/Users/demo/Project/src").status).toBe("idle");
    expect(result.current.getEntry("/Users/demo/Music")).toMatchObject({ sizeBytes: 500 });
    // Only the folders holding what changed are asked about; Music isn't.
    expect(probes).not.toContain("/Users/demo/Music");
  });

  it("drops the sizes of what a file operation removed without asking", async () => {
    const sizes = new Map([
      ["/Users/demo/Old", 700],
      ["/Users/demo/Old/inner", 200],
    ]);
    const { client, probes, finishWrite } = createWriteClient(sizes);
    const { result } = renderHook(() => useFolderSizeCache(client, "/Users/demo"));
    await act(async () => {
      for (const path of sizes.keys()) {
        await result.current.calculateFolderSize(path);
      }
    });

    sizes.clear();
    await finishWrite("trash", ["/Users/demo/Old"]);

    expect(result.current.getEntry("/Users/demo/Old").status).toBe("idle");
    expect(probes).not.toContain("/Users/demo/Old/inner");
  });

  it("asks again for the Trash after a move to the Trash", async () => {
    const sizes = new Map([
      ["/Users/demo/.Trash", 50],
      ["/opt/tools", 300],
    ]);
    const { client, finishWrite } = createWriteClient(sizes);
    const { result } = renderHook(() => useFolderSizeCache(client, "/Users/demo"));
    await act(async () => {
      for (const path of sizes.keys()) {
        await result.current.calculateFolderSize(path);
      }
    });

    sizes.set("/Users/demo/.Trash", 150);
    sizes.set("/opt/tools", 200);
    await finishWrite("trash", ["/opt/tools/old"]);

    expect(result.current.getEntry("/Users/demo/.Trash")).toMatchObject({ sizeBytes: 150 });
    expect(result.current.getEntry("/opt/tools")).toMatchObject({ sizeBytes: 200 });
  });

  // A main process that measures folders one at a time, each until the test finishes it.
  function createOneAtATimeClient() {
    const started: string[] = [];
    const finished = new Set<string>();
    const client = createMockFiletrailClient({
      "folderSize:start": vi.fn(
        async (payload: { path: string; probeOnly?: boolean | undefined }) => {
          if (payload.probeOnly) {
            return { jobId: `probe:${payload.path}`, status: "deferred" as const };
          }
          started.push(payload.path);
          return { jobId: payload.path, status: "running" as const };
        },
      ),
      "folderSize:getStatus": vi.fn(async (payload: { jobId: string }) => ({
        jobId: payload.jobId,
        status: finished.has(payload.jobId) ? ("ready" as const) : ("running" as const),
        sizeBytes: finished.has(payload.jobId) ? 100 : null,
        diskBytes: finished.has(payload.jobId) ? 100 : null,
        fileCount: finished.has(payload.jobId) ? 1 : null,
        folderCount: finished.has(payload.jobId) ? 0 : null,
        error: null,
      })),
      "folderSize:cancel": vi.fn(async () => ({ ok: true })),
    });
    const finish = async (path: string) => {
      finished.add(path);
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await act(async () => {
        await Promise.resolve();
      });
    };
    return { client, started, finish };
  }

  it("measures several folders one after another, leaving those already known", async () => {
    const { client, started, finish } = createOneAtATimeClient();
    const { result } = renderHook(() => useFolderSizeCache(client));
    await act(async () => {
      await result.current.calculateFolderSize("/b");
    });
    await finish("/b");
    expect(result.current.getEntry("/b").status).toBe("ready");

    await act(async () => {
      void result.current.calculateFolderSizes(["/a", "/b", "/c"]);
    });
    // One at a time: a second walk would stop the first in the main process.
    expect(started).toEqual(["/b", "/a"]);

    await finish("/a");
    expect(started).toEqual(["/b", "/a", "/c"]);
    await finish("/c");
    expect(["/a", "/b", "/c"].map((path) => result.current.getEntry(path).status)).toEqual([
      "ready",
      "ready",
      "ready",
    ]);
  });

  it("stops measuring several folders when told to", async () => {
    const { client, started, finish } = createOneAtATimeClient();
    const { result } = renderHook(() => useFolderSizeCache(client));

    await act(async () => {
      void result.current.calculateFolderSizes(["/a", "/c"]);
    });
    await act(async () => {
      result.current.cancelFolderSizes(["/a", "/c"]);
    });
    await finish("/a");

    expect(result.current.getEntry("/a").status).toBe("idle");
    expect(result.current.getEntry("/c").status).toBe("idle");
    expect(started).toEqual(["/a"]);
  });
});
