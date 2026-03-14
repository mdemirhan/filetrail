import { useCallback, useRef, useState } from "react";

import type { FiletrailClient } from "../lib/filetrailClient";

export type FolderSizeEntry =
  | { status: "idle" }
  | { status: "calculating"; jobId: string }
  | { status: "ready"; sizeBytes: number; diskBytes: number; fileCount: number }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 200;

export function useFolderSizeCache(client: FiletrailClient) {
  // The cache lives in a ref so reads are free (no re-renders). We bump a
  // version counter only when the UI needs to repaint — i.e. when a
  // user-visible entry changes (calculation completes, cancel, etc.).
  const cacheRef = useRef(new Map<string, FolderSizeEntry>());
  const [, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const probedPaths = useRef(new Set<string>());

  const updateEntry = useCallback(
    (path: string, entry: FolderSizeEntry) => {
      cacheRef.current.set(path, entry);
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
      void (async () => {
        try {
          const result = await client.invoke("folderSize:start", { path, probeOnly: true });
          if (result.status === "ready") {
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

  return { getEntry, calculateFolderSize, recalculateFolderSize, cancelFolderSize };
}
