import { useCallback, useRef, useState } from "react";

import type { FiletrailClient } from "../lib/filetrailClient";

export type FolderSizeEntry =
  | { status: "idle" }
  | { status: "calculating"; jobId: string }
  | { status: "ready"; sizeBytes: number; diskBytes: number; fileCount: number }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 200;
const PROBE_DEBOUNCE_MS = 150;

export function useFolderSizeCache(client: FiletrailClient) {
  // The cache lives in a ref so reads are free (no re-renders). We bump a
  // version counter only when the UI needs to repaint — i.e. when a
  // user-visible entry changes (calculation completes, cancel, etc.).
  const cacheRef = useRef(new Map<string, FolderSizeEntry>());
  const [, setVersion] = useState(0);
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), []);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const probedPaths = useRef(new Set<string>());
  const pendingProbes = useRef(new Set<string>());
  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
   * Probe the main process cache for paths. Paths are collected into a
   * pending set and flushed in a single debounced batch. This avoids
   * firing an IPC call per directory during rapid keyboard navigation
   * while still probing every unique path eventually.
   */
  const flushProbes = useCallback(() => {
    const paths = [...pendingProbes.current];
    pendingProbes.current.clear();
    for (const path of paths) {
      void (async () => {
        try {
          const result = await client.invoke("folderSize:start", { path, probeOnly: true });
          if (result.status === "ready") {
            // Cache hit — mark as probed so we don't re-probe.
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
          // If "deferred" — don't mark as probed. The main process may
          // populate the cache later (e.g. from a parent folder walk),
          // so the next getEntry call should try again.
        } catch {
          // Silently ignore probe failures.
        }
      })();
    }
  }, [client, updateEntry]);

  const scheduleProbe = useCallback(
    (path: string) => {
      if (probedPaths.current.has(path) || pendingProbes.current.has(path)) return;
      pendingProbes.current.add(path);
      if (probeTimer.current) clearTimeout(probeTimer.current);
      probeTimer.current = setTimeout(flushProbes, PROBE_DEBOUNCE_MS);
    },
    [flushProbes],
  );

  const getEntry = useCallback(
    (path: string): FolderSizeEntry => {
      const entry = cacheRef.current.get(path);
      if (!entry) {
        scheduleProbe(path);
        return { status: "idle" };
      }
      return entry;
    },
    [scheduleProbe],
  );

  return { getEntry, calculateFolderSize, recalculateFolderSize, cancelFolderSize };
}
