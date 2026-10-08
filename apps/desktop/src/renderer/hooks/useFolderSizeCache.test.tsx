// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import type { DraggedAway, IpcRequestInput } from "@filetrail/contracts";

import type { FiletrailClient } from "../lib/filetrailClient";
import { createMockFiletrailClient } from "../test/mockFiletrailClient";
import {
  FOLDER_SIZE_REPAINT_INTERVAL_MS,
  MAX_FOLDER_SIZE_CACHE_ENTRIES,
  useFolderSizeCache,
} from "./useFolderSizeCache";

type ProbeRequest = IpcRequestInput<"folderSize:probeMany">;

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
    measuredFolderCount: 0,
    error: null,
  }));
  const cancelHandler = vi.fn(async () => ({ ok: true }));
  const probeHandler = vi.fn(async (_payload: ProbeRequest) => ({
    sizes: [] as Array<{
      path: string;
      sizeBytes: number;
      diskBytes: number;
      fileCount: number;
      folderCount: number;
    }>,
  }));

  return { startHandler, getStatusHandler, cancelHandler, probeHandler };
}

function createClient(handlers: ReturnType<typeof createHandlers>) {
  return createMockFiletrailClient({
    "folderSize:start": handlers.startHandler,
    "folderSize:getStatus": handlers.getStatusHandler,
    "folderSize:cancel": handlers.cancelHandler,
    "folderSize:probeMany": handlers.probeHandler,
  });
}

// What the main process knows of a folder, as a probe answers it.
function known(path: string, sizeBytes: number) {
  return { path, sizeBytes, diskBytes: sizeBytes, fileCount: 1, folderCount: 0 };
}

// Lets the probes queued by a render go out and their answers come back.
async function settle() {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

// What a row on screen does on each render.
async function show(getEntry: (path: string) => unknown, ...paths: string[]) {
  act(() => {
    for (const path of paths) {
      getEntry(path);
    }
  });
  await settle();
}

function probedPaths(probeHandler: { mock: { calls: Array<[ProbeRequest]> } }): string[] {
  return probeHandler.mock.calls.flatMap(([payload]) => payload.paths);
}

describe("useFolderSizeCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("getEntry returns idle for unknown paths", () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));
    expect(result.current.getEntry("/test").status).toBe("idle");
  });

  it("calculateFolderSize transitions idle to calculating to ready", async () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });
    expect(result.current.getEntry("/test").status).toBe("calculating");

    // The polling interval fires and checks status
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await settle();

    expect(result.current.getEntry("/test")).toEqual({
      status: "ready",
      sizeBytes: 1000,
      diskBytes: 1200,
      fileCount: 42,
      folderCount: 3,
    });
  });

  it("calculateFolderSize with cache hit goes straight to ready", async () => {
    const handlers = createHandlers({ status: "ready" });
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });

    expect(result.current.getEntry("/test")).toEqual({
      status: "ready",
      sizeBytes: 1000,
      diskBytes: 1200,
      fileCount: 42,
      folderCount: 3,
    });
  });

  it("asks the main process to measure at a lower priority what the app measures by itself", async () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      await result.current.calculateFolderSize("/auto", false, { automatic: true });
      await result.current.calculateFolderSize("/asked");
    });

    expect(handlers.startHandler.mock.calls).toEqual([
      [{ path: "/auto", recalculate: false, automatic: true }],
      [{ path: "/asked", recalculate: false }],
    ]);
  });

  it("cancelFolderSize stops polling and resets to idle", async () => {
    const handlers = createHandlers();
    handlers.getStatusHandler.mockImplementation(async () => ({
      jobId: "job-1",
      status: "running" as never,
      sizeBytes: null as never,
      diskBytes: null as never,
      fileCount: null as never,
      folderCount: null as never,
      measuredFolderCount: 0,
      error: null,
    }));
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });
    expect(result.current.getEntry("/test").status).toBe("calculating");

    await act(async () => {
      await result.current.cancelFolderSize("/test");
    });

    expect(result.current.getEntry("/test").status).toBe("idle");
    expect(handlers.cancelHandler).toHaveBeenCalledWith({ jobId: "job-1" });
  });

  // Stop before the start had answered sent nothing, and the answer then showed the folder
  // calculating again, with a walk nobody could stop.
  it("stops a calculation stopped before its start had answered", async () => {
    const handlers = createHandlers();
    let answerStart: (() => void) | null = null;
    handlers.startHandler.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerStart = () => resolve({ jobId: "job-1", status: "running" as const });
        }),
    );
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    let started: Promise<void> = Promise.resolve();
    act(() => {
      started = result.current.calculateFolderSize("/test");
    });
    expect(result.current.getEntry("/test").status).toBe("calculating");
    await act(async () => {
      await result.current.cancelFolderSize("/test");
    });
    expect(result.current.getEntry("/test").status).toBe("idle");

    await act(async () => {
      answerStart?.();
      await started;
    });

    expect(handlers.cancelHandler).toHaveBeenCalledWith({ jobId: "job-1" });
    expect(result.current.getEntry("/test").status).toBe("idle");
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(handlers.getStatusHandler).not.toHaveBeenCalled();
  });

  it("tells whether any folder is being measured", async () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));
    expect(result.current.isCalculating()).toBe(false);

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });
    expect(result.current.isCalculating()).toBe(true);
  });

  it("shows an error when a calculation can't start, or its progress can't be read", async () => {
    const handlers = createHandlers();
    handlers.startHandler.mockRejectedValueOnce(new Error("gone"));
    handlers.getStatusHandler.mockRejectedValue(new Error("gone"));
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      await result.current.calculateFolderSize("/a");
    });
    expect(result.current.getEntry("/a")).toEqual({
      status: "error",
      message: "Failed to start folder size calculation",
    });

    await act(async () => {
      await result.current.calculateFolderSize("/b");
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await settle();
    expect(result.current.getEntry("/b")).toEqual({
      status: "error",
      message: "Failed to poll folder size status",
    });
  });

  it("polls a known size the main process hasn't finished reporting", async () => {
    const handlers = createHandlers({ status: "ready" });
    handlers.getStatusHandler.mockResolvedValueOnce({
      jobId: "job-1",
      status: "running" as never,
      sizeBytes: null as never,
      diskBytes: null as never,
      fileCount: null as never,
      folderCount: null as never,
      measuredFolderCount: 0,
      error: null,
    });
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });
    expect(result.current.getEntry("/test")).toEqual({ status: "calculating", jobId: "job-1" });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await settle();
    expect(result.current.getEntry("/test")).toMatchObject({ status: "ready", sizeBytes: 1000 });
  });

  it("asks at once about a folder not known when a write changed it", async () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers), "/Users/demo"));
    await show(result.current.getEntry, "/Users/demo/Work");

    act(() => {
      result.current.forgetChangedSizes(["/Users/demo/Work/new.txt"], { intoTrash: false });
    });
    await show(result.current.getEntry, "/Users/demo/Work");

    expect(probedPaths(handlers.probeHandler)).toEqual(["/Users/demo/Work", "/Users/demo/Work"]);
  });

  it("keeps the sizes it has when the main process can't be asked, and forgets those a write changed", async () => {
    const sizes = new Map([
      ["/Users/demo/Project", 1_000],
      ["/Users/demo/Music", 500],
    ]);
    const { client, finishWrite } = createWriteClient(sizes);
    const { result } = renderHook(() => useFolderSizeCache(client, "/Users/demo"));
    await calculateAll(result, sizes.keys());
    const failing = client as { invoke: FiletrailClient["invoke"] };
    failing.invoke = vi.fn(async () => {
      throw new Error("gone");
    }) as never;

    await finishWrite("delete_immediately", ["/Users/demo/Project/a.txt"]);

    expect(result.current.getEntry("/Users/demo/Project").status).toBe("idle");
    expect(result.current.getEntry("/Users/demo/Music")).toMatchObject({ sizeBytes: 500 });
  });

  it("recalculateFolderSize passes recalculate flag", async () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      result.current.recalculateFolderSize("/test");
      await Promise.resolve();
    });

    expect(handlers.startHandler).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/test", recalculate: true }),
    );
  });

  it("asks once for every folder a render shows, and shows the sizes known", async () => {
    const handlers = createHandlers();
    handlers.probeHandler.mockImplementation(async ({ paths }: ProbeRequest) => ({
      sizes: paths.filter((path) => path !== "/b").map((path) => known(path, 10)),
    }));
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await show(result.current.getEntry, "/a", "/b", "/c", "/a");

    expect(handlers.probeHandler.mock.calls).toEqual([[{ paths: ["/a", "/b", "/c"] }]]);
    expect(result.current.getEntry("/a")).toMatchObject({ status: "ready", sizeBytes: 10 });
    expect(result.current.getEntry("/b").status).toBe("idle");
  });

  it("asks again about a folder not known only after a while", async () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await show(result.current.getEntry, "/test");
    // Re-renders inside the cooldown do not ask again.
    await show(result.current.getEntry, "/test");
    expect(handlers.probeHandler).toHaveBeenCalledTimes(1);

    // Measured elsewhere meanwhile.
    handlers.probeHandler.mockImplementation(async () => ({ sizes: [known("/test", 5000)] }));
    vi.advanceTimersByTime(5_001);
    await show(result.current.getEntry, "/test");

    expect(result.current.getEntry("/test")).toMatchObject({ status: "ready", sizeBytes: 5000 });
  });

  it("shows the sizes of folders inside right after calculating their parent", async () => {
    const handlers = createHandlers({ status: "ready" });
    let parentCalculated = false;
    handlers.startHandler.mockImplementation(async () => {
      parentCalculated = true;
      return { jobId: "job-1", status: "ready" as never };
    });
    // The parent's walk measures the folders inside it too.
    handlers.probeHandler.mockImplementation(async ({ paths }: ProbeRequest) => ({
      sizes: parentCalculated ? paths.map((path) => known(path, 400)) : [],
    }));
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    // The row for a folder inside asks once and learns nothing yet.
    await show(result.current.getEntry, "/out/FileTrail-darwin-arm64");
    expect(result.current.getEntry("/out/FileTrail-darwin-arm64").status).toBe("idle");

    await act(async () => {
      await result.current.calculateFolderSize("/out");
    });
    await settle();

    // Well inside the retry cooldown: asked again at once, without a render.
    expect(result.current.getEntry("/out/FileTrail-darwin-arm64")).toMatchObject({
      status: "ready",
      sizeBytes: 400,
    });
  });

  // A main process measuring "/out", where the test finishes the folders inside one by one.
  function createMeasuringClient() {
    const measured = new Map<string, number>();
    const state = { done: false, cancelled: false };
    const probes: string[] = [];
    const calls = { probeMany: 0, getStatus: 0 };
    const client = createMockFiletrailClient({
      "folderSize:start": vi.fn(async (payload: { path: string }) => ({
        jobId: `walk:${payload.path}`,
        status: "running" as const,
      })),
      "folderSize:probeMany": vi.fn(async ({ paths }: ProbeRequest) => {
        calls.probeMany += 1;
        probes.push(...paths);
        return {
          sizes: paths.flatMap((path) => {
            const size = measured.get(path);
            return size === undefined ? [] : [known(path, size)];
          }),
        };
      }),
      "folderSize:getStatus": vi.fn(async ({ jobId }: { jobId: string }) => {
        calls.getStatus += 1;
        const status = state.cancelled
          ? ("cancelled" as const)
          : state.done
            ? ("ready" as const)
            : ("running" as const);
        const size = state.done ? 9_000 : null;
        return {
          jobId,
          status,
          sizeBytes: size,
          diskBytes: size,
          fileCount: size === null ? null : 1,
          folderCount: size === null ? null : 0,
          measuredFolderCount: measured.size,
          error: null,
        };
      }),
      "folderSize:cancel": vi.fn(async () => {
        state.cancelled = true;
        return { ok: true };
      }),
    });
    const poll = async () => {
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      await settle();
    };
    return { client, measured, state, probes, calls, poll };
  }

  it("shows each folder inside, at any depth, as soon as it is measured", async () => {
    const { client, measured, probes, poll } = createMeasuringClient();
    const { result } = renderHook(() => useFolderSizeCache(client));
    await show(result.current.getEntry, "/out/a", "/out/a/deep", "/out/b");
    await act(async () => {
      await result.current.calculateFolderSize("/out");
    });

    measured.set("/out/a/deep", 100);
    measured.set("/out/a", 400);
    const versionBefore = result.current.version;
    await poll();
    expect(result.current.version).toBeGreaterThan(versionBefore);

    expect(result.current.getEntry("/out")).toMatchObject({ status: "calculating" });
    expect(result.current.getEntry("/out/a")).toMatchObject({ status: "ready", sizeBytes: 400 });
    expect(result.current.getEntry("/out/a/deep")).toMatchObject({
      status: "ready",
      sizeBytes: 100,
    });
    expect(result.current.getEntry("/out/b").status).toBe("idle");

    // Nothing new measured: the folder still waiting isn't asked about again.
    const asked = probes.filter((path) => path === "/out/b").length;
    await poll();
    await show(result.current.getEntry, "/out/b");
    expect(probes.filter((path) => path === "/out/b")).toHaveLength(asked);

    measured.set("/out/b", 700);
    await poll();
    expect(result.current.getEntry("/out/b")).toMatchObject({ status: "ready", sizeBytes: 700 });
  });

  it("doesn't repaint for folders measured elsewhere", async () => {
    const { client, measured, poll } = createMeasuringClient();
    const { result } = renderHook(() => useFolderSizeCache(client));
    await show(result.current.getEntry, "/elsewhere/x", "/out/waiting");
    await act(async () => {
      await result.current.calculateFolderSize("/out");
    });
    await poll();
    const versionBefore = result.current.version;

    measured.set("/out/a", 400);
    await poll();

    expect(result.current.version).toBe(versionBefore);
  });

  // Each poll repainted the whole window at least once, and once more for every folder on
  // screen whose size came in, each asked about with two requests of its own.
  it("measuring under a listing of 1,000 folders repaints and asks only as sizes come in", async () => {
    const { client, measured, calls, poll } = createMeasuringClient();
    const folders = Array.from({ length: 1_000 }, (_, index) => `/out/f${index}`);
    let renders = 0;
    // A listing sorted by size asks about every folder on each render.
    const { result } = renderHook(() => {
      renders += 1;
      const sizes = useFolderSizeCache(client);
      for (const path of folders) {
        sizes.getEntry(path);
      }
      return sizes;
    });
    await settle();
    await act(async () => {
      await result.current.calculateFolderSize("/out");
    });
    // The repaint for the calculation started.
    await act(async () => {
      vi.advanceTimersByTime(FOLDER_SIZE_REPAINT_INTERVAL_MS);
    });
    const rendersBefore = renders;
    calls.probeMany = 0;
    calls.getStatus = 0;

    // 10 polls, each finding 100 more folders measured.
    for (let poll_ = 0; poll_ < 10; poll_++) {
      for (const path of folders.slice(poll_ * 100, poll_ * 100 + 100)) {
        measured.set(path, 1);
      }
      await poll();
    }
    // 3 polls with nothing new.
    await poll();
    await poll();
    await poll();

    expect(folders.every((path) => result.current.getEntry(path).status === "ready")).toBe(true);
    expect(calls.getStatus).toBe(13);
    // One request a poll that found more, for all the folders still waiting.
    expect(calls.probeMany).toBe(10);
    // A repaint a poll that brought sizes, at most.
    expect(renders - rendersBefore).toBeLessThanOrEqual(10);
  });

  it("repaints at most once per interval, for every change made meanwhile", async () => {
    const handlers = createHandlers({ status: "ready" });
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));
    const versionBefore = result.current.version;

    await act(async () => {
      await result.current.calculateFolderSize("/a");
      await result.current.calculateFolderSize("/b");
      await result.current.calculateFolderSize("/c");
    });
    // The first change at once, the rest together at the end of the interval.
    expect(result.current.version).toBe(versionBefore + 1);
    await act(async () => {
      vi.advanceTimersByTime(FOLDER_SIZE_REPAINT_INTERVAL_MS);
    });
    expect(result.current.version).toBe(versionBefore + 2);
  });

  it("keeps the sizes of the folders inside measured before Stop", async () => {
    const { client, measured } = createMeasuringClient();
    const { result } = renderHook(() => useFolderSizeCache(client));
    await show(result.current.getEntry, "/out/a");
    await act(async () => {
      await result.current.calculateFolderSize("/out");
    });

    measured.set("/out/a", 400);
    await act(async () => {
      await result.current.cancelFolderSize("/out");
    });
    await settle();

    expect(result.current.getEntry("/out").status).toBe("idle");
    expect(result.current.getEntry("/out/a")).toMatchObject({ status: "ready", sizeBytes: 400 });
  });

  it("gives a folder whose own calculation was stopped the size its parent measured", async () => {
    const { client, measured, state, poll } = createMeasuringClient();
    const { result } = renderHook(() => useFolderSizeCache(client));
    await act(async () => {
      await result.current.calculateFolderSize("/out/a");
    });
    await act(async () => {
      await result.current.cancelFolderSize("/out/a");
    });
    expect(result.current.getEntry("/out/a").status).toBe("idle");

    state.cancelled = false;
    await act(async () => {
      await result.current.calculateFolderSize("/out");
    });
    measured.set("/out/a", 400);
    await poll();

    expect(result.current.getEntry("/out/a")).toMatchObject({ status: "ready", sizeBytes: 400 });
  });

  it("leaves a calculation started meanwhile alone when an earlier answer comes in", async () => {
    const { client, measured } = createMeasuringClient();
    const { result } = renderHook(() => useFolderSizeCache(client));
    measured.set("/out/a", 400);
    // The row asks; before the answer arrives, the folder's own calculation starts.
    act(() => {
      result.current.getEntry("/out/a");
      void result.current.calculateFolderSize("/out/a");
    });
    await settle();

    expect(result.current.getEntry("/out/a").status).toBe("calculating");
  });

  it("ignores a late answer about a calculation that was started again", async () => {
    let jobCount = 0;
    let answerFirst: (() => void) | null = null;
    const status = (jobId: string, ready: boolean) => ({
      jobId,
      status: ready ? ("ready" as const) : ("cancelled" as const),
      sizeBytes: ready ? 500 : null,
      diskBytes: ready ? 500 : null,
      fileCount: ready ? 1 : null,
      folderCount: ready ? 0 : null,
      measuredFolderCount: 0,
      error: null,
    });
    const client = createMockFiletrailClient({
      "folderSize:start": vi.fn(async () => {
        jobCount += 1;
        return { jobId: `job-${jobCount}`, status: "running" as const };
      }),
      "folderSize:probeMany": vi.fn(async () => ({ sizes: [] })),
      "folderSize:getStatus": vi.fn(({ jobId }: { jobId: string }) =>
        jobId === "job-1"
          ? // The first job's answer is slow, and by then it was replaced.
            new Promise<ReturnType<typeof status>>((resolve) => {
              answerFirst = () => resolve(status(jobId, false));
            })
          : Promise.resolve(status(jobId, true)),
      ),
      "folderSize:cancel": vi.fn(async () => ({ ok: true })),
    });
    const { result } = renderHook(() => useFolderSizeCache(client));
    await act(async () => {
      await result.current.calculateFolderSize("/x");
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await act(async () => {
      result.current.recalculateFolderSize("/x");
      await Promise.resolve();
    });
    await act(async () => {
      answerFirst?.();
      await Promise.resolve();
    });
    expect(result.current.getEntry("/x").status).toBe("calculating");

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await settle();
    expect(result.current.getEntry("/x")).toMatchObject({ status: "ready", sizeBytes: 500 });
  });

  it("polling stops on error status", async () => {
    const handlers = createHandlers();
    let callCount = 0;
    handlers.getStatusHandler.mockImplementation(async () => {
      callCount++;
      return {
        jobId: "job-1",
        status: (callCount >= 2 ? "error" : "running") as never,
        sizeBytes: null as never,
        diskBytes: null as never,
        fileCount: null as never,
        folderCount: null as never,
        measuredFolderCount: 0,
        error: (callCount >= 2 ? "Disk error" : null) as never,
      };
    });
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));

    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });
    // First poll: running; second: error.
    for (let poll = 0; poll < 2; poll++) {
      await act(async () => {
        vi.advanceTimersByTime(250);
        await Promise.resolve();
      });
    }

    expect(result.current.getEntry("/test")).toEqual({ status: "error", message: "Disk error" });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(callCount).toBe(2);
  });

  it("stops polling when the hook unmounts", async () => {
    const handlers = createHandlers();
    const { result, unmount } = renderHook(() => useFolderSizeCache(createClient(handlers)));
    await act(async () => {
      await result.current.calculateFolderSize("/test");
    });
    unmount();

    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(handlers.getStatusHandler).not.toHaveBeenCalled();
  });

  it("caps cached entries and re-probes evicted paths", async () => {
    const handlers = createHandlers({ status: "ready" });
    const { result } = renderHook(() => useFolderSizeCache(createClient(handlers)));
    for (let index = 0; index <= MAX_FOLDER_SIZE_CACHE_ENTRIES; index += 1) {
      await act(async () => {
        await result.current.calculateFolderSize(`/dir/${index}`);
      });
    }

    expect(result.current.getEntry(`/dir/${MAX_FOLDER_SIZE_CACHE_ENTRIES}`).status).toBe("ready");
    handlers.probeHandler.mockClear();
    await show(result.current.getEntry, "/dir/0");
    expect(result.current.getEntry("/dir/0").status).toBe("idle");
    expect(probedPaths(handlers.probeHandler)).toEqual(["/dir/0"]);
  });

  // A main process holding the sizes in `sizes`, which a test changes as a write would.
  function createWriteClient(sizes: Map<string, number>) {
    let emit: ((event: unknown) => void) | null = null;
    let emitDraggedAway: ((change: DraggedAway) => void) | null = null;
    const probes: string[] = [];
    const client: FiletrailClient = {
      ...createMockFiletrailClient({
        "folderSize:start": vi.fn(async (payload: { path: string }) => ({
          jobId: payload.path,
          status: "ready" as const,
        })),
        "folderSize:probeMany": vi.fn(async ({ paths }: ProbeRequest) => {
          probes.push(...paths);
          return {
            sizes: paths.flatMap((path) => {
              const size = sizes.get(path);
              return size === undefined ? [] : [known(path, size)];
            }),
          };
        }),
        "folderSize:getStatus": vi.fn(async (payload: { jobId: string }) => ({
          jobId: payload.jobId,
          status: "ready" as const,
          sizeBytes: sizes.get(payload.jobId) ?? null,
          diskBytes: sizes.get(payload.jobId) ?? null,
          fileCount: 1,
          folderCount: 0,
          measuredFolderCount: 0,
          error: null,
        })),
        "folderSize:cancel": vi.fn(async () => ({ ok: true })),
      }),
      onWriteOperationProgress: (listener) => {
        emit = listener as (event: unknown) => void;
        return () => undefined;
      },
      onDraggedAway: (listener) => {
        emitDraggedAway = listener;
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
      await settle();
    };
    // Another window's drag out, which another app or the Dock's Trash took.
    const dragAwayElsewhere = async (change: DraggedAway) => {
      probes.length = 0;
      await act(async () => {
        emitDraggedAway?.(change);
      });
      await settle();
    };
    return { client, probes, finishWrite, dragAwayElsewhere };
  }

  async function calculateAll(
    result: { current: ReturnType<typeof useFolderSizeCache> },
    paths: Iterable<string>,
  ) {
    await act(async () => {
      for (const path of paths) {
        await result.current.calculateFolderSize(path);
      }
    });
    await settle();
  }

  it("asks again for the folders a file operation changed, keeping what the main process kept", async () => {
    const sizes = new Map([
      ["/Users/demo/Project", 1_000],
      ["/Users/demo/Project/src", 300],
      ["/Users/demo/Music", 500],
    ]);
    const { client, probes, finishWrite } = createWriteClient(sizes);
    const { result } = renderHook(() => useFolderSizeCache(client, "/Users/demo"));
    await calculateAll(result, sizes.keys());

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
    await calculateAll(result, sizes.keys());

    sizes.clear();
    await finishWrite("trash", ["/Users/demo/Old"]);

    expect(probes).not.toContain("/Users/demo/Old/inner");
    expect(result.current.getEntry("/Users/demo/Old").status).toBe("idle");
  });

  it("asks again for the Trash after a move to the Trash", async () => {
    const sizes = new Map([
      ["/Users/demo/.Trash", 50],
      ["/opt/tools", 300],
    ]);
    const { client, finishWrite } = createWriteClient(sizes);
    const { result } = renderHook(() => useFolderSizeCache(client, "/Users/demo"));
    await calculateAll(result, sizes.keys());

    sizes.set("/Users/demo/.Trash", 150);
    sizes.set("/opt/tools", 200);
    await finishWrite("trash", ["/opt/tools/old"]);

    expect(result.current.getEntry("/Users/demo/.Trash")).toMatchObject({ sizeBytes: 150 });
    expect(result.current.getEntry("/opt/tools")).toMatchObject({ sizeBytes: 200 });
  });

  it("forgets the sizes another window's drag to the Trash changed, the Trash's too", async () => {
    const sizes = new Map([
      ["/Users/demo", 5_000],
      ["/Users/demo/.Trash", 50],
      ["/Users/demo/Downloads", 600],
      ["/Users/demo/Downloads/old", 100],
      ["/Users/demo/Music", 500],
    ]);
    const { client, probes, dragAwayElsewhere } = createWriteClient(sizes);
    const { result } = renderHook(() => useFolderSizeCache(client, "/Users/demo"));
    await calculateAll(result, sizes.keys());

    // The main process forgot what the drag changed.
    for (const path of ["/Users/demo", "/Users/demo/.Trash", "/Users/demo/Downloads"]) {
      sizes.delete(path);
    }
    sizes.delete("/Users/demo/Downloads/old");
    await dragAwayElsewhere({ gone: ["/Users/demo/Downloads/old"], intoTrash: true });

    for (const path of [
      "/Users/demo",
      "/Users/demo/.Trash",
      "/Users/demo/Downloads",
      "/Users/demo/Downloads/old",
    ]) {
      expect(result.current.getEntry(path).status, path).toBe("idle");
    }
    expect(result.current.getEntry("/Users/demo/Music")).toMatchObject({ sizeBytes: 500 });
    expect(probes).not.toContain("/Users/demo/Music");
  });

  // A main process that measures folders one at a time, each until the test finishes it.
  function createOneAtATimeClient() {
    const started: string[] = [];
    const finished = new Set<string>();
    const client = createMockFiletrailClient({
      "folderSize:start": vi.fn(async (payload: { path: string }) => {
        started.push(payload.path);
        return { jobId: payload.path, status: "running" as const };
      }),
      "folderSize:probeMany": vi.fn(async () => ({ sizes: [] })),
      "folderSize:getStatus": vi.fn(async (payload: { jobId: string }) => ({
        jobId: payload.jobId,
        status: finished.has(payload.jobId) ? ("ready" as const) : ("running" as const),
        sizeBytes: finished.has(payload.jobId) ? 100 : null,
        diskBytes: finished.has(payload.jobId) ? 100 : null,
        fileCount: finished.has(payload.jobId) ? 1 : null,
        folderCount: finished.has(payload.jobId) ? 0 : null,
        measuredFolderCount: 0,
        error: null,
      })),
      "folderSize:cancel": vi.fn(async () => ({ ok: true })),
    });
    const finish = async (path: string) => {
      finished.add(path);
      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      await settle();
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
