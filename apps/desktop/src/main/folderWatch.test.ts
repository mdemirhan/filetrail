import { createFolderWatches } from "./folderWatch";

function setup() {
  const listeners = new Map<string, (name: string | null) => void>();
  const stopped: string[] = [];
  const modifiedTimes = new Map<string, number | null>();
  const onFolderChanged = vi.fn();
  const forgetCachedListings = vi.fn();
  const watches = createFolderWatches({
    watchFolder: (path, onChange) => {
      listeners.set(path, onChange);
      return () => {
        listeners.delete(path);
        stopped.push(path);
      };
    },
    readModifiedTime: async (path) => modifiedTimes.get(path) ?? null,
    onFolderChanged,
    forgetCachedListings,
  });
  return {
    watches,
    onFolderChanged,
    forgetCachedListings,
    stopped,
    watched: () => [...listeners.keys()],
    change: (path: string, name: string | null) => listeners.get(path)?.(name),
    setModifiedTime: (path: string, time: number | null) => modifiedTimes.set(path, time),
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
});
