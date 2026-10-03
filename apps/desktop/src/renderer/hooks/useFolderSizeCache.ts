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
  | { status: "ready"; sizeBytes: number; diskBytes: number; fileCount: number }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 200;
// Views probe every folder they render; a miss is retried only after this cooldown so
// re-renders do not re-send the same probe, while a later parent walk still shows up.
const PROBE_MISS_COOLDOWN_MS = 5_000;
// Every folder rendered gets probed, so cap the cache; evicted paths are simply
// probed again (a cheap main-process lookup) if they are shown later.
export const MAX_FOLDER_SIZE_CACHE_ENTRIES = 5_000;

export function useFolderSizeCache(client: FiletrailClient) {
  // The cache lives in a ref so reads are free (no re-renders). We bump a
  // version counter only when the UI needs to repaint — i.e. when a
  // user-visible entry changes (calculation completes, cancel, etc.).
  const cacheRef = useRef(new Map<string, FolderSizeEntry>());
  const [version, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const probedPaths = useRef(new Set<string>());
  const probeMissedAt = useRef(new Map<string, number>());
  // Set below, once probeCache exists: re-asks for the folders inside `path`.
  const refreshInsideRef = useRef<(path: string) => void>(() => undefined);

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
      const timer = setInterval(async () => {
        try {
          const result = await client.invoke("folderSize:getStatus", { jobId });
          if (result.status === "ready" && result.sizeBytes !== null) {
            stopPolling(path);
            updateEntry(path, {
              status: "ready",
              sizeBytes: result.sizeBytes,
              diskBytes: result.diskBytes ?? result.sizeBytes,
              fileCount: result.fileCount ?? 0,
            });
            refreshInsideRef.current(path);
          } else if (result.status === "error") {
            stopPolling(path);
            updateEntry(path, { status: "error", message: result.error ?? "Unknown error" });
          } else if (result.status === "cancelled") {
            stopPolling(path);
            updateEntry(path, { status: "idle" });
          }
        } catch {
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
    },
    [client, stopPolling, updateEntry],
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
            if (status.status === "ready" && status.sizeBytes !== null) {
              updateEntry(path, {
                status: "ready",
                sizeBytes: status.sizeBytes,
                diskBytes: status.diskBytes ?? status.sizeBytes,
                fileCount: status.fileCount ?? 0,
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

  // A finished file operation may have changed the sizes of the folders it touched: they
  // are forgotten (the main process forgets them too) and asked about again when shown.
  useEffect(
    () =>
      client.onWriteOperationProgress((event) => {
        if (!event.result || !isTerminalWriteStatus(event.status)) {
          return;
        }
        const changedPaths = pathsChangedByWrite(event.result);
        let forgotten = false;
        for (const [path, entry] of [...cacheRef.current]) {
          if (entry.status !== "calculating" && isAffectedByChange(path, changedPaths)) {
            cacheRef.current.delete(path);
            probedPaths.current.delete(path);
            probeMissedAt.current.delete(path);
            forgotten = true;
          }
        }
        if (forgotten) {
          bumpVersion();
        }
      }),
    [bumpVersion, client],
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

  // `version` changes whenever a cached entry does, for views that derive from the cache
  // (sorting by size).
  return { getEntry, calculateFolderSize, recalculateFolderSize, cancelFolderSize, version };
}
