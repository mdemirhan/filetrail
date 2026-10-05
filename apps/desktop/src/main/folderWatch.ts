import { join } from "node:path";

import type { FolderChange } from "@filetrail/contracts";

// The folder each window has on screen, watched so a change made outside the app (another
// app, Terminal, a download finishing) shows without a refresh. Only the folder in front is
// watched: a tab in the background reads its folder again when it comes back.
//
// On macOS a folder watch is an FSEvents stream: cheap to start and stop, so it simply
// follows the window from folder to folder.

// A burst of changes (an unzip, a build, a big copy) is told of once, when it settles…
const SETTLE_MS = 250;
// …or once a second while it goes on, so a folder that keeps changing still updates.
const MAX_WAIT_MS = 1_000;
// More changed items than this are told of as "anything may have changed".
const MAX_CHANGED_PATHS = 1_000;

export type FolderWatchDeps = {
  // Calls `onChange` with the name of the item that changed, or null when that isn't known
  // (the watch failed, say); returns a function that stops watching.
  watchFolder: (path: string, onChange: (name: string | null) => void) => () => void;
  // The folder's modification time, or null when it can't be read.
  readModifiedTime: (path: string) => Promise<number | null>;
  onFolderChanged: (windowId: number, change: FolderChange) => void;
  // Lets go of a listing the window might otherwise be handed again, before it is told.
  forgetCachedListings: () => void;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type FolderWatches = {
  // Watches `path` for the window, in place of what it watched before; null stops.
  watch: (windowId: number, path: string | null) => void;
  // The window came back to the front: a change the watch could not see (on a network
  // share, say) is caught by the folder's modification time.
  checkForMissedChanges: (windowId: number) => void;
  stopAll: () => void;
};

type Watch = {
  path: string;
  stop: () => void;
  timer: unknown;
  burstStartedAt: number | null;
  // Null once more changed than is worth naming.
  changedNames: Set<string> | null;
  modifiedTime: number | null;
};

export function createFolderWatches(deps: FolderWatchDeps): FolderWatches {
  const now = deps.now ?? Date.now;
  const schedule = deps.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel =
    deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const watches = new Map<number, Watch>();

  const recordModifiedTime = (windowId: number, watch: Watch) => {
    void deps.readModifiedTime(watch.path).then((modifiedTime) => {
      if (watches.get(windowId) === watch) {
        watch.modifiedTime = modifiedTime;
      }
    });
  };

  const tell = (windowId: number, watch: Watch) => {
    if (watch.timer !== null) {
      cancel(watch.timer);
    }
    watch.timer = null;
    watch.burstStartedAt = null;
    const names = watch.changedNames;
    watch.changedNames = new Set();
    recordModifiedTime(windowId, watch);
    deps.forgetCachedListings();
    deps.onFolderChanged(windowId, {
      path: watch.path,
      changedPaths: names === null ? null : [...names].map((name) => join(watch.path, name)),
    });
  };

  const noteChange = (windowId: number, watch: Watch, name: string | null) => {
    if (watches.get(windowId) !== watch) {
      return;
    }
    if (watch.changedNames !== null) {
      if (name === null || name.length === 0 || watch.changedNames.size >= MAX_CHANGED_PATHS) {
        watch.changedNames = null;
      } else {
        watch.changedNames.add(name);
      }
    }
    const time = now();
    watch.burstStartedAt ??= time;
    if (watch.timer !== null) {
      cancel(watch.timer);
    }
    const wait = Math.max(0, Math.min(SETTLE_MS, watch.burstStartedAt + MAX_WAIT_MS - time));
    watch.timer = schedule(() => tell(windowId, watch), wait);
  };

  const stop = (windowId: number) => {
    const watch = watches.get(windowId);
    if (!watch) {
      return;
    }
    watches.delete(windowId);
    if (watch.timer !== null) {
      cancel(watch.timer);
    }
    watch.stop();
  };

  return {
    watch: (windowId, path) => {
      if (path !== null && watches.get(windowId)?.path === path) {
        return;
      }
      stop(windowId);
      if (path === null) {
        return;
      }
      const watch: Watch = {
        path,
        stop: () => undefined,
        timer: null,
        burstStartedAt: null,
        changedNames: new Set(),
        modifiedTime: null,
      };
      watches.set(windowId, watch);
      watch.stop = deps.watchFolder(path, (name) => noteChange(windowId, watch, name));
      recordModifiedTime(windowId, watch);
    },
    checkForMissedChanges: (windowId) => {
      const watch = watches.get(windowId);
      if (!watch) {
        return;
      }
      const known = watch.modifiedTime;
      void deps.readModifiedTime(watch.path).then((modifiedTime) => {
        // A change already on its way is told of anyway.
        if (watches.get(windowId) !== watch || watch.timer !== null) {
          return;
        }
        // Not read yet when the watch started (or unreadable then): nothing to compare to.
        if (known === null) {
          watch.modifiedTime = modifiedTime;
          return;
        }
        if (modifiedTime === known) {
          return;
        }
        watch.changedNames = null;
        tell(windowId, watch);
      });
    },
    stopAll: () => {
      for (const windowId of [...watches.keys()]) {
        stop(windowId);
      }
    },
  };
}
