import type { FolderVisitKind } from "../../shared/visitedFolders";

// How long a folder must stay on screen for opening it to count as a visit. Clicking or
// arrowing through folders on the way to another takes less.
export const FOLDER_STAY_MS = 5000;

type Timer = {
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
};

export type FolderVisitTracker = {
  /** A folder was gone to; `viaGoTo` when it was picked in the Go To box. */
  arrive: (path: string, viaGoTo: boolean) => void;
  /** The folder on screen is now `path` (Back, another tab…): a different one was left. */
  showing: (path: string) => void;
  /** Something was done in the folder on screen (a file opened, a paste): it was wanted. */
  use: () => void;
  /** The window goes away: a folder still being decided on was only passed through. */
  dispose: () => void;
};

// Decides how much opening a folder counts for the Go To box. Picked in Go To, it counts
// at once and most. Opened another way, it counts once it has stayed on screen a few
// seconds or been used; left before that, it was only passed through.
export function createFolderVisitTracker(
  record: (path: string, kind: FolderVisitKind) => void,
  // Called through arrows: the browser's timers throw when called as another object's methods.
  timer: Timer = {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: (handle) => clearTimeout(handle),
  },
): FolderVisitTracker {
  let pending: { path: string; timer: ReturnType<typeof setTimeout> } | null = null;

  function settle(kind: FolderVisitKind): void {
    if (!pending) {
      return;
    }
    const { path } = pending;
    timer.clearTimeout(pending.timer);
    pending = null;
    record(path, kind);
  }

  return {
    arrive(path, viaGoTo) {
      settle("passThrough");
      if (viaGoTo) {
        record(path, "goTo");
        return;
      }
      pending = { path, timer: timer.setTimeout(() => settle("stay"), FOLDER_STAY_MS) };
    },
    showing(path) {
      if (pending && pending.path !== path) {
        settle("passThrough");
      }
    },
    use() {
      settle("stay");
    },
    dispose() {
      settle("passThrough");
    },
  };
}
