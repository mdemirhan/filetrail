import { basename, join } from "node:path";

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
  // Calls `onChange` with the name of the item that changed, or null when that isn't known,
  // and `onFail` when the watch stops by itself (Node closes a watch on its first error).
  // Returns a function that stops watching, or null when the watch can't start.
  watchFolder: (
    path: string,
    onChange: (name: string | null) => void,
    onFail: () => void,
  ) => (() => void) | null;
  // The folder's modification time, or null when it can't be read.
  readModifiedTime: (path: string) => Promise<number | null>;
  onFolderChanged: (windowId: number, change: FolderChange) => void;
  // Lets go of the listings of `path` the window might otherwise be handed again, and of
  // the details of `changedPaths` in it (null: anything in it, or the folder itself, may
  // have changed), before it is told.
  forgetCachedListings: (path: string, changedPaths: readonly string[] | null) => void;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
};

export type FolderWatches = {
  // Watches `path` for the window, in place of what it watched before; null stops.
  watch: (windowId: number, path: string | null) => void;
  // The window came back to the front: a change the watch could not see (on a network
  // share, say) is caught by the folder's modification time, and a watch that failed is
  // started again.
  checkForMissedChanges: (windowId: number) => void;
  stopAll: () => void;
};

type Watch = {
  path: string;
  // Null while not watching: the watch failed, or could not start.
  stop: (() => void) | null;
  timer: unknown;
  burstStartedAt: number | null;
  // Null once more changed than is worth naming.
  changedNames: Set<string> | null;
  modifiedTime: number | null;
  // The modification time being read after the window was told of a change.
  modifiedTimeRead: Promise<void> | null;
};

export function createFolderWatches(deps: FolderWatchDeps): FolderWatches {
  const now = deps.now ?? Date.now;
  const schedule = deps.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel =
    deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const watches = new Map<number, Watch>();

  const recordModifiedTime = (windowId: number, watch: Watch) => {
    const read = deps.readModifiedTime(watch.path).then((modifiedTime) => {
      if (watches.get(windowId) === watch) {
        watch.modifiedTime = modifiedTime;
      }
      if (watch.modifiedTimeRead === read) {
        watch.modifiedTimeRead = null;
      }
    });
    watch.modifiedTimeRead = read;
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
    const changedPaths = names === null ? null : [...names].map((name) => join(watch.path, name));
    deps.forgetCachedListings(watch.path, changedPaths);
    deps.onFolderChanged(windowId, { path: watch.path, changedPaths });
  };

  const noteChange = (windowId: number, watch: Watch, name: string | null) => {
    if (watches.get(windowId) !== watch) {
      return;
    }
    if (watch.changedNames !== null) {
      if (
        name === null ||
        name.length === 0 ||
        // The folder itself renamed or removed is told of by its own name. An item inside it
        // with the same name can't be told apart, and is read again with everything else.
        name === basename(watch.path) ||
        watch.changedNames.size >= MAX_CHANGED_PATHS
      ) {
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

  const start = (windowId: number, watch: Watch) => {
    watch.stop = deps.watchFolder(
      watch.path,
      (name) => noteChange(windowId, watch, name),
      () => {
        // Started again when the window next asks for the folder or comes to the front;
        // meanwhile it reads the folder again, which may be gone.
        watch.stop = null;
        noteChange(windowId, watch, null);
      },
    );
  };

  const compareModifiedTime = async (windowId: number, watch: Watch) => {
    // The time read after the latest change was told of is the one compared to: compared
    // to the one before, that change would be told of twice.
    await watch.modifiedTimeRead;
    const known = watch.modifiedTime;
    const modifiedTime = await deps.readModifiedTime(watch.path);
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
    watch.stop?.();
  };

  return {
    watch: (windowId, path) => {
      const current = watches.get(windowId);
      if (path !== null && current?.path === path) {
        if (current.stop === null) {
          start(windowId, current);
        }
        return;
      }
      stop(windowId);
      if (path === null) {
        return;
      }
      const watch: Watch = {
        path,
        stop: null,
        timer: null,
        burstStartedAt: null,
        changedNames: new Set(),
        modifiedTime: null,
        modifiedTimeRead: null,
      };
      watches.set(windowId, watch);
      start(windowId, watch);
      recordModifiedTime(windowId, watch);
    },
    checkForMissedChanges: (windowId) => {
      const watch = watches.get(windowId);
      if (!watch) {
        return;
      }
      if (watch.stop === null) {
        start(windowId, watch);
      }
      void compareModifiedTime(windowId, watch);
    },
    stopAll: () => {
      for (const windowId of [...watches.keys()]) {
        stop(windowId);
      }
    },
  };
}
