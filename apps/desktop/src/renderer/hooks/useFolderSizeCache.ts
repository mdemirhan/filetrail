import { useCallback, useEffect, useRef, useState } from "react";

import { isAffectedByChange, pathsChangedByWrite } from "@filetrail/contracts";

import type { FiletrailClient } from "../lib/filetrailClient";

function isTerminalWriteStatus(status: string): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "partial"
  );
}

export type FolderSizeEntry =
  | { status: "idle" }
  | { status: "calculating"; jobId: string }
  | {
      status: "ready";
      sizeBytes: number;
      diskBytes: number;
      fileCount: number;
      folderCount: number;
    }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 200;
// Views probe every folder they render; a miss is retried only after this cooldown so
// re-renders do not re-send the same probe, while a later parent walk still shows up.
const PROBE_MISS_COOLDOWN_MS = 5_000;
// Every folder rendered gets probed, so cap the cache; evicted paths are simply
// probed again (a cheap main-process lookup) if they are shown later.
export const MAX_FOLDER_SIZE_CACHE_ENTRIES = 5_000;

// `homePath` locates the home folder's Trash, where a move to the Trash puts things.
export function useFolderSizeCache(client: FiletrailClient, homePath = "") {
  // The cache lives in a ref so reads are free (no re-renders). We bump a
  // version counter only when the UI needs to repaint — i.e. when a
  // user-visible entry changes (calculation completes, cancel, etc.).
  const cacheRef = useRef(new Map<string, FolderSizeEntry>());
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  // Calculations a run of several folders waits for, told how each ended (ready, error, or
  // idle when stopped).
  const finishWaiters = useRef(new Map<string, Array<(entry: FolderSizeEntry) => void>>());
  // Bumped to stop a run of several folders after the one being measured.
  const folderRunRef = useRef(0);
  const probedPaths = useRef(new Set<string>());
  const probeMissedAt = useRef(new Map<string, number>());
  // Set below, once probeCache exists: re-asks for the folders inside `path`, all of them
  // (refreshInside) or only those without a size (askAgainInside).
  const refreshInsideRef = useRef<(path: string) => void>(() => undefined);
  const askAgainInsideRef = useRef<(path: string) => void>(() => undefined);

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearInterval(timer);
      }
      timers.clear();
    };
  }, []);

  const updateEntry = useCallback(
    (path: string, entry: FolderSizeEntry) => {
      const cache = cacheRef.current;
      cache.delete(path);
      cache.set(path, entry);
      for (const [cachedPath, cachedEntry] of cache) {
        if (cache.size <= MAX_FOLDER_SIZE_CACHE_ENTRIES) {
          break;
        }
        // Never drop an in-flight calculation; its poller still reports into it.
        if (cachedEntry.status === "calculating") {
          continue;
        }
        cache.delete(cachedPath);
        probedPaths.current.delete(cachedPath);
      }
      if (entry.status !== "calculating") {
        const waiters = finishWaiters.current.get(path);
        finishWaiters.current.delete(path);
        for (const resolve of waiters ?? []) {
          resolve(entry);
        }
      }
      bumpVersion();
    },
    [bumpVersion],
  );

  const stopPolling = useCallback((path: string) => {
    const timer = pollTimers.current.get(path);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(path);
    }
  }, []);

  const startPolling = useCallback(
    (path: string, jobId: string) => {
      stopPolling(path);
      // The folders inside measured so far, as last seen: more are asked about as they come.
      let measuredFolderCount = 0;
      const timer = setInterval(async () => {
        try {
          const result = await client.invoke("folderSize:getStatus", { jobId });
          // Another calculation of this folder took over meanwhile.
          if (pollTimers.current.get(path) !== timer) {
            return;
          }
          if (result.status === "ready" && result.sizeBytes !== null) {
            stopPolling(path);
            updateEntry(path, {
              status: "ready",
              sizeBytes: result.sizeBytes,
              diskBytes: result.diskBytes ?? result.sizeBytes,
              fileCount: result.fileCount ?? 0,
              folderCount: result.folderCount ?? 0,
            });
            refreshInsideRef.current(path);
          } else if (result.status === "error") {
            stopPolling(path);
            updateEntry(path, { status: "error", message: result.error ?? "Unknown error" });
            askAgainInsideRef.current(path);
          } else if (result.status === "cancelled") {
            stopPolling(path);
            updateEntry(path, { status: "idle" });
            askAgainInsideRef.current(path);
          } else if (result.measuredFolderCount > measuredFolderCount) {
            measuredFolderCount = result.measuredFolderCount;
            askAgainInsideRef.current(path);
          }
        } catch {
          if (pollTimers.current.get(path) !== timer) {
            return;
          }
          stopPolling(path);
          updateEntry(path, { status: "error", message: "Failed to poll folder size status" });
        }
      }, POLL_INTERVAL_MS);
      pollTimers.current.set(path, timer);
    },
    [client, stopPolling, updateEntry],
  );

  const calculateFolderSize = useCallback(
    async (path: string, recalculate = false) => {
      updateEntry(path, { status: "calculating", jobId: "" });
      try {
        const result = await client.invoke("folderSize:start", { path, recalculate });
        if (result.status === "ready") {
          const status = await client.invoke("folderSize:getStatus", { jobId: result.jobId });
          if (status.status === "ready" && status.sizeBytes !== null) {
            updateEntry(path, {
              status: "ready",
              sizeBytes: status.sizeBytes,
              diskBytes: status.diskBytes ?? status.sizeBytes,
              fileCount: status.fileCount ?? 0,
              folderCount: status.folderCount ?? 0,
            });
            refreshInsideRef.current(path);
          } else {
            updateEntry(path, { status: "calculating", jobId: result.jobId });
            startPolling(path, result.jobId);
          }
        } else {
          updateEntry(path, { status: "calculating", jobId: result.jobId });
          startPolling(path, result.jobId);
        }
      } catch {
        updateEntry(path, { status: "error", message: "Failed to start folder size calculation" });
      }
    },
    [client, startPolling, updateEntry],
  );

  const recalculateFolderSize = useCallback(
    (path: string) => void calculateFolderSize(path, true),
    [calculateFolderSize],
  );

  // Several folders, one after another: the main process measures one at a time, and a
  // new calculation stops the one under way. With `recalculate` false, folders whose size
  // is known or being calculated are left alone. A folder stopped part way (by Stop, or by
  // another calculation started meanwhile) stops the run.
  const calculateFolderSizes = useCallback(
    async (paths: readonly string[], recalculate = false) => {
      const run = ++folderRunRef.current;
      for (const path of paths) {
        if (folderRunRef.current !== run) {
          return;
        }
        const status = cacheRef.current.get(path)?.status;
        if (!recalculate && (status === "ready" || status === "calculating")) {
          continue;
        }
        const finished = new Promise<FolderSizeEntry>((resolve) => {
          finishWaiters.current.set(path, [...(finishWaiters.current.get(path) ?? []), resolve]);
        });
        void calculateFolderSize(path, recalculate);
        const entry = await finished;
        if (entry.status === "idle") {
          return;
        }
      }
    },
    [calculateFolderSize],
  );

  const cancelFolderSize = useCallback(
    async (path: string) => {
      const entry = cacheRef.current.get(path);
      if (entry?.status === "calculating" && entry.jobId) {
        stopPolling(path);
        try {
          await client.invoke("folderSize:cancel", { jobId: entry.jobId });
        } catch {
          // Best effort
        }
      }
      updateEntry(path, { status: "idle" });
      // The folders inside it measured before it stopped keep their sizes.
      askAgainInsideRef.current(path);
    },
    [client, stopPolling, updateEntry],
  );

  // Stops a run of several folders, and the one of them being measured.
  const cancelFolderSizes = useCallback(
    (paths: readonly string[]) => {
      folderRunRef.current += 1;
      for (const path of paths) {
        if (cacheRef.current.get(path)?.status === "calculating") {
          void cancelFolderSize(path);
        }
      }
    },
    [cancelFolderSize],
  );

  /**
   * Probe the main process cache for a path. Fires immediately as a
   * fire-and-forget IPC call. The probeOnly flag makes this a cheap Map
   * lookup in the main process (no filesystem walk). The ref-backed cache
   * ensures probe results don't cause re-render cascades.
   *
   * Only marks a path as "probed" on cache hit. Paths that returned
   * "deferred" stay eligible so a later parent walk can populate them.
   */
  const probeCache = useCallback(
    (path: string) => {
      if (probedPaths.current.has(path)) return;
      const missedAt = probeMissedAt.current.get(path);
      if (missedAt !== undefined && Date.now() - missedAt < PROBE_MISS_COOLDOWN_MS) return;
      // Mark in flight so concurrent renders do not probe the same path again.
      probeMissedAt.current.set(path, Date.now());
      void (async () => {
        try {
          const result = await client.invoke("folderSize:start", { path, probeOnly: true });
          if (result.status === "ready") {
            probeMissedAt.current.delete(path);
            probedPaths.current.add(path);
            const status = await client.invoke("folderSize:getStatus", { jobId: result.jobId });
            // A calculation of the folder started meanwhile is left to report its own size.
            if (
              status.status === "ready" &&
              status.sizeBytes !== null &&
              cacheRef.current.get(path)?.status !== "calculating"
            ) {
              updateEntry(path, {
                status: "ready",
                sizeBytes: status.sizeBytes,
                diskBytes: status.diskBytes ?? status.sizeBytes,
                fileCount: status.fileCount ?? 0,
                folderCount: status.folderCount ?? 0,
              });
            }
          }
        } catch {
          // Silently ignore probe failures.
        }
      })();
    },
    [client, updateEntry],
  );

  // Calculating a folder also measures every folder inside it (the main process keeps
  // those sizes). Folders already on screen asked before that and are waiting out their
  // retry cooldown, so ask again for everything inside right away; known sizes inside
  // are refreshed too, since they may have changed.
  refreshInsideRef.current = (path: string) => {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    for (const missedPath of [...probeMissedAt.current.keys()]) {
      if (missedPath.startsWith(prefix)) {
        probeMissedAt.current.delete(missedPath);
      }
    }
    for (const [cachedPath, cachedEntry] of cacheRef.current) {
      if (cachedPath.startsWith(prefix) && cachedEntry.status !== "calculating") {
        probedPaths.current.delete(cachedPath);
        probeCache(cachedPath);
      }
    }
    // Repaint so folders on screen without a size ask again now.
    bumpVersion();
  };

  // While a calculation runs, each folder inside it is measured as soon as everything
  // inside that folder is: the folders inside without a size are asked about again. Those
  // on screen waiting out their retry cooldown ask again on the repaint; the rest wait
  // until they are shown.
  askAgainInsideRef.current = (path: string) => {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    let waiting = false;
    for (const missedPath of [...probeMissedAt.current.keys()]) {
      if (missedPath.startsWith(prefix)) {
        probeMissedAt.current.delete(missedPath);
        waiting = true;
      }
    }
    // A folder whose own calculation was stopped or failed shows no size either.
    for (const [cachedPath, cachedEntry] of cacheRef.current) {
      if (
        cachedPath.startsWith(prefix) &&
        (cachedEntry.status === "idle" || cachedEntry.status === "error")
      ) {
        probedPaths.current.delete(cachedPath);
        probeCache(cachedPath);
      }
    }
    if (waiting) {
      bumpVersion();
    }
  };

  // Asks the main process again for a size it may have changed: the size shown stays until
  // the answer comes, then is replaced, or forgotten if the main process forgot it too.
  const refreshEntry = useCallback(
    (path: string) => {
      void (async () => {
        try {
          const result = await client.invoke("folderSize:start", { path, probeOnly: true });
          if (cacheRef.current.get(path)?.status === "calculating") {
            return;
          }
          const status =
            result.status === "ready"
              ? await client.invoke("folderSize:getStatus", { jobId: result.jobId })
              : null;
          if (cacheRef.current.get(path)?.status === "calculating") {
            return;
          }
          if (status?.status === "ready" && status.sizeBytes !== null) {
            probedPaths.current.add(path);
            updateEntry(path, {
              status: "ready",
              sizeBytes: status.sizeBytes,
              diskBytes: status.diskBytes ?? status.sizeBytes,
              fileCount: status.fileCount ?? 0,
              folderCount: status.folderCount ?? 0,
            });
            return;
          }
        } catch {
          // Forgotten below, and asked about again when shown.
        }
        if (cacheRef.current.get(path)?.status === "calculating") {
          return;
        }
        cacheRef.current.delete(path);
        probedPaths.current.delete(path);
        probeMissedAt.current.delete(path);
        bumpVersion();
      })();
    },
    [bumpVersion, client, updateEntry],
  );

  // Changed items may have changed the sizes of the folders holding them. The main process
  // has taken what a delete removed off the sizes it could, and forgotten the rest: each is
  // asked about again. A move to the Trash changes the Trash too.
  const forgetChangedSizes = useCallback(
    (changedPaths: readonly string[], options: { intoTrash: boolean }) => {
      // Where the Trash is, the folders holding it may have changed; the Trash itself too.
      const trashPath =
        options.intoTrash && homePath.length > 0 ? `${homePath.replace(/\/+$/u, "")}/.Trash` : null;
      let forgotten = false;
      for (const [path, entry] of [...cacheRef.current]) {
        if (entry.status === "calculating") {
          continue;
        }
        if (isAffectedByChange(path, changedPaths) && !holdsAny(path, changedPaths)) {
          // What changed, and what is inside it: the main process forgot these.
          cacheRef.current.delete(path);
          probedPaths.current.delete(path);
          probeMissedAt.current.delete(path);
          forgotten = true;
        } else if (
          holdsAny(path, changedPaths) ||
          (trashPath !== null && (trashPath === path || holdsAny(path, [trashPath])))
        ) {
          refreshEntry(path);
        }
      }
      if (forgotten) {
        bumpVersion();
      }
    },
    [bumpVersion, homePath, refreshEntry],
  );

  useEffect(
    () =>
      client.onWriteOperationProgress((event) => {
        if (!event.result || !isTerminalWriteStatus(event.status)) {
          return;
        }
        forgetChangedSizes(pathsChangedByWrite(event.result), {
          intoTrash: event.action === "trash" || event.action === "undo" || event.action === "redo",
        });
      }),
    [client, forgetChangedSizes],
  );

  const getEntry = useCallback(
    (path: string): FolderSizeEntry => {
      const entry = cacheRef.current.get(path);
      if (!entry) {
        probeCache(path);
        return { status: "idle" };
      }
      return entry;
    },
    [probeCache],
  );

  // Whether any folder is being measured. The main process measures one at a time and a
  // new calculation stops the one under way.
  const isCalculating = useCallback(() => {
    for (const entry of cacheRef.current.values()) {
      if (entry.status === "calculating") {
        return true;
      }
    }
    return false;
  }, []);

  // `version` changes whenever a cached entry does, for views that derive from the cache
  // (sorting by size).
  return {
    getEntry,
    isCalculating,
    calculateFolderSize,
    recalculateFolderSize,
    cancelFolderSize,
    calculateFolderSizes,
    cancelFolderSizes,
    forgetChangedSizes,
    version,
  };
}

// Whether the folder at `path` holds any of `paths` (somewhere inside it).
function holdsAny(path: string, paths: readonly string[]): boolean {
  const prefix = path.endsWith("/") ? path : `${path}/`;
  return paths.some((candidate) => candidate.startsWith(prefix));
}
