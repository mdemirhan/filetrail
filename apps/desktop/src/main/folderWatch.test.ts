import { createFolderWatches } from "./folderWatch";

function setup() {
  const listeners = new Map<string, (name: string | null) => void>();
  const failures = new Map<string, () => void>();
  const stopped: string[] = [];
  // Folders a watch can't be started on.
  const unwatchable = new Set<string>();
  let started = 0;
  const modifiedTimes = new Map<string, number | null>();
  // Reads of the modification time held back until the test lets them go.
  let heldReads: Array<() => void> | null = null;
  const onFolderChanged = vi.fn();
  const forgetCachedListings = vi.fn();
  const watches = createFolderWatches({
    watchFolder: (path, onChange, onFail) => {
      if (unwatchable.has(path)) {
        return null;
      }
      started += 1;
      listeners.set(path, onChange);
      failures.set(path, onFail);
      return () => {
        listeners.delete(path);
        stopped.push(path);
      };
    },
    readModifiedTime: async (path) => {
      if (heldReads) {
        await new Promise<void>((resolve) => heldReads?.push(resolve));
      }
      return modifiedTimes.get(path) ?? null;
    },
    onFolderChanged,
    forgetCachedListings,
  });
  return {
    watches,
    onFolderChanged,
    forgetCachedListings,
    stopped,
    started: () => started,
    watched: () => [...listeners.keys()],
    change: (path: string, name: string | null) => listeners.get(path)?.(name),
    // The watch stops by itself, as Node closes one on its first error.
    fail: (path: string) => {
      listeners.delete(path);
      failures.get(path)?.();
    },
    setUnwatchable: (path: string, value: boolean) =>
      value ? unwatchable.add(path) : unwatchable.delete(path),
    setModifiedTime: (path: string, time: number | null) => modifiedTimes.set(path, time),
    holdReads: () => {
      heldReads = [];
    },
    releaseReads: () => {
      const reads = heldReads ?? [];
      heldReads = null;
      for (const release of reads) {
        release();
      }
    },
  };
}

describe("folder watches", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows each window from folder to folder, and stops when asked", () => {
    const { watches, watched, stopped } = setup();
    watches.watch(1, "/a");
    watches.watch(2, "/b");
    expect(watched()).toEqual(["/a", "/b"]);

    // The same folder again keeps the watch it has.
    watches.watch(1, "/a");
    expect(stopped).toEqual([]);

    watches.watch(1, "/c");
    expect(stopped).toEqual(["/a"]);
    watches.watch(2, null);
    expect(watched()).toEqual(["/c"]);

    watches.stopAll();
    expect(watched()).toEqual([]);
  });

  it("tells of a burst of changes once, when it settles, naming what changed", () => {
    const { watches, change, onFolderChanged, forgetCachedListings } = setup();
    watches.watch(7, "/a");
    change("/a", "one.txt");
    vi.advanceTimersByTime(100);
    change("/a", "two.txt");
    change("/a", "one.txt");
    vi.advanceTimersByTime(200);
    expect(onFolderChanged).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(forgetCachedListings).toHaveBeenCalledTimes(1);
    expect(forgetCachedListings).toHaveBeenCalledWith("/a", ["/a/one.txt", "/a/two.txt"]);
    expect(onFolderChanged).toHaveBeenCalledTimes(1);
    expect(onFolderChanged).toHaveBeenCalledWith(7, {
      path: "/a",
      changedPaths: ["/a/one.txt", "/a/two.txt"],
    });
  });

  it("tells of a folder that keeps changing once a second", () => {
    const { watches, change, onFolderChanged } = setup();
    watches.watch(1, "/a");
    for (let elapsed = 0; elapsed < 2_000; elapsed += 100) {
      change("/a", "download.part");
      vi.advanceTimersByTime(100);
    }
    expect(onFolderChanged).toHaveBeenCalledTimes(2);
  });

  it("says anything may have changed when a change has no name", () => {
    const { watches, change, onFolderChanged } = setup();
    watches.watch(1, "/a");
    change("/a", "one.txt");
    change("/a", null);
    vi.advanceTimersByTime(250);
    expect(onFolderChanged).toHaveBeenCalledWith(1, { path: "/a", changedPaths: null });

    // The next burst names its items again.
    change("/a", "two.txt");
    vi.advanceTimersByTime(250);
    expect(onFolderChanged).toHaveBeenLastCalledWith(1, {
      path: "/a",
      changedPaths: ["/a/two.txt"],
    });
  });

  it("drops a change still settling when the window moves on", () => {
    const { watches, change, onFolderChanged } = setup();
    watches.watch(1, "/a");
    change("/a", "one.txt");
    watches.watch(1, "/b");
    vi.advanceTimersByTime(1_000);
    expect(onFolderChanged).not.toHaveBeenCalled();
  });

  it("catches a change the watch missed by the folder's modification time", async () => {
    const { watches, onFolderChanged, setModifiedTime } = setup();
    setModifiedTime("/share", 100);
    watches.watch(1, "/share");
    await vi.advanceTimersByTimeAsync(0);

    watches.checkForMissedChanges(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFolderChanged).not.toHaveBeenCalled();

    setModifiedTime("/share", 200);
    watches.checkForMissedChanges(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFolderChanged).toHaveBeenCalledWith(1, { path: "/share", changedPaths: null });

    // Told once: the time it was told at is the one compared to next.
    watches.checkForMissedChanges(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFolderChanged).toHaveBeenCalledTimes(1);
  });

  it("tells of a folder gone when the window comes back", async () => {
    const { watches, onFolderChanged, setModifiedTime } = setup();
    setModifiedTime("/a", 100);
    watches.watch(1, "/a");
    await vi.advanceTimersByTimeAsync(0);

    setModifiedTime("/a", null);
    watches.checkForMissedChanges(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(onFolderChanged).toHaveBeenCalledWith(1, { path: "/a", changedPaths: null });
  });

  it("tells of a change to the folder itself as anything may have changed", () => {
    const { watches, change, onFolderChanged, forgetCachedListings } = setup();
    watches.watch(1, "/a/Project");
    // The folder renamed or removed is told of by its own name.
    change("/a/Project", "Project");
    vi.advanceTimersByTime(250);
    expect(onFolderChanged).toHaveBeenCalledWith(1, { path: "/a/Project", changedPaths: null });
    expect(forgetCachedListings).toHaveBeenCalledWith("/a/Project", null);
  });

  it("starts a watch again when the window asks for the folder after it failed", () => {
    const { watches, fail, onFolderChanged, started, watched } = setup();
    watches.watch(1, "/a");
    fail("/a");
    // The window is told, so it reads the folder again.
    vi.advanceTimersByTime(250);
    expect(onFolderChanged).toHaveBeenCalledWith(1, { path: "/a", changedPaths: null });
    expect(watched()).toEqual([]);

    watches.watch(1, "/a");
    expect(started()).toBe(2);
    expect(watched()).toEqual(["/a"]);
  });

  it("starts a watch again that could not start, once the folder can be watched", () => {
    const { watches, setUnwatchable, started, watched } = setup();
    setUnwatchable("/a", true);
    watches.watch(1, "/a");
    expect(watched()).toEqual([]);

    setUnwatchable("/a", false);
    watches.watch(1, "/a");
    expect(started()).toBe(1);
    expect(watched()).toEqual(["/a"]);
  });

  it("starts a failed watch again when the window comes back to the front", async () => {
    const { watches, fail, change, onFolderChanged, watched, setModifiedTime } = setup();
    setModifiedTime("/a", 100);
    watches.watch(1, "/a");
    fail("/a");
    await vi.advanceTimersByTimeAsync(250);
    onFolderChanged.mockClear();

    watches.checkForMissedChanges(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(watched()).toEqual(["/a"]);
    change("/a", "one.txt");
    vi.advanceTimersByTime(250);
    expect(onFolderChanged).toHaveBeenCalledWith(1, { path: "/a", changedPaths: ["/a/one.txt"] });
  });

  it("tells of a change once when the window comes to the front while it is still noted", async () => {
    const { watches, change, onFolderChanged, setModifiedTime, holdReads, releaseReads } = setup();
    setModifiedTime("/a", 100);
    watches.watch(1, "/a");
    await vi.advanceTimersByTimeAsync(0);

    setModifiedTime("/a", 200);
    holdReads();
    change("/a", "one.txt");
    vi.advanceTimersByTime(250);
    expect(onFolderChanged).toHaveBeenCalledTimes(1);
    // The folder's new time is still being read when the window comes to the front.
    watches.checkForMissedChanges(1);
    releaseReads();
    await vi.advanceTimersByTimeAsync(0);
    releaseReads();
    await vi.advanceTimersByTimeAsync(0);
    expect(onFolderChanged).toHaveBeenCalledTimes(1);
  });
});
