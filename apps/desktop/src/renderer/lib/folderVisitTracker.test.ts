import type { FolderVisitKind } from "../../shared/visitedFolders";
import { FOLDER_STAY_MS, createFolderVisitTracker } from "./folderVisitTracker";

// A tracker whose timers only run when the test says so, with the visits it records.
function createTracker() {
  const recorded: Array<[string, FolderVisitKind]> = [];
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  let nextTimerId = 1;
  const tracker = createFolderVisitTracker((path, kind) => recorded.push([path, kind]), {
    setTimeout: (callback, delayMs) => {
      timers.set(nextTimerId, { callback, delayMs });
      return nextTimerId++ as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as number);
    },
  });
  return {
    tracker,
    recorded,
    pendingDelays: () => [...timers.values()].map((timer) => timer.delayMs),
    runTimers: () => {
      for (const [id, timer] of [...timers]) {
        if (timers.delete(id)) {
          timer.callback();
        }
      }
    },
  };
}

describe("folder visit tracker", () => {
  it("counts a folder picked in Go To at once", () => {
    const { tracker, recorded, pendingDelays } = createTracker();
    tracker.arrive("/a", true);
    expect(recorded).toEqual([["/a", "goTo"]]);
    expect(pendingDelays()).toEqual([]);
  });

  it("counts a folder opened another way once it has stayed on screen", () => {
    const { tracker, recorded, pendingDelays, runTimers } = createTracker();
    tracker.arrive("/a", false);
    expect(recorded).toEqual([]);
    expect(pendingDelays()).toEqual([FOLDER_STAY_MS]);
    // Still on screen: nothing is decided yet.
    tracker.showing("/a");
    runTimers();
    expect(recorded).toEqual([["/a", "stay"]]);
    // Decided once: leaving it later changes nothing.
    tracker.showing("/b");
    expect(recorded).toEqual([["/a", "stay"]]);
  });

  it("only passes through a folder left before it stayed", () => {
    const { tracker, recorded, pendingDelays } = createTracker();
    // Going on to another folder.
    tracker.arrive("/a", false);
    tracker.arrive("/a/b", false);
    expect(recorded).toEqual([["/a", "passThrough"]]);
    // Back, or another tab.
    tracker.showing("/a");
    expect(recorded).toEqual([
      ["/a", "passThrough"],
      ["/a/b", "passThrough"],
    ]);
    // Going on through Go To.
    tracker.arrive("/c", false);
    tracker.arrive("/d", true);
    expect(recorded.slice(2)).toEqual([
      ["/c", "passThrough"],
      ["/d", "goTo"],
    ]);
    expect(pendingDelays()).toEqual([]);
  });

  it("counts a folder used before it stayed", () => {
    const { tracker, recorded, pendingDelays } = createTracker();
    tracker.arrive("/a", false);
    tracker.use();
    expect(recorded).toEqual([["/a", "stay"]]);
    expect(pendingDelays()).toEqual([]);
    // Used again, or with nothing being decided: no second visit.
    tracker.use();
    expect(recorded).toEqual([["/a", "stay"]]);
  });

  it("passes through a folder still being decided on when the window goes", () => {
    const { tracker, recorded, pendingDelays } = createTracker();
    tracker.arrive("/a", false);
    tracker.dispose();
    expect(recorded).toEqual([["/a", "passThrough"]]);
    expect(pendingDelays()).toEqual([]);
  });
});
