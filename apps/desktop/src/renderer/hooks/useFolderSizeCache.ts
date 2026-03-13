import { useCallback, useRef, useState } from "react";

import type { FiletrailClient } from "../lib/filetrailClient";

export type FolderSizeEntry =
  | { status: "idle" }
  | { status: "calculating"; jobId: string }
  | { status: "ready"; sizeBytes: number }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 200;

export function useFolderSizeCache(client: FiletrailClient) {
  const [cache, setCache] = useState<Map<string, FolderSizeEntry>>(() => new Map());
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Track paths that have already been probed so we don't re-probe on every render.
  const probedPaths = useRef<Set<string>>(new Set());

  const stopPolling = useCallback((path: string) => {
    const timer = pollTimers.current.get(path);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(path);
    }
  }, []);

  const updateEntry = useCallback((path: string, entry: FolderSizeEntry) => {
    setCache((prev) => {
      const next = new Map(prev);
      next.set(path, entry);
      return next;
    });
  }, []);

  const startPolling = useCallback(
    (path: string, jobId: string) => {
      stopPolling(path);
      const timer = setInterval(async () => {
        try {
          const result = await client.invoke("folderSize:getStatus", { jobId });
          if (result.status === "ready" && result.sizeBytes !== null) {
            stopPolling(path);
            updateEntry(path, { status: "ready", sizeBytes: result.sizeBytes });
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
            updateEntry(path, { status: "ready", sizeBytes: status.sizeBytes });
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
      const entry = cache.get(path);
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
    [cache, client, stopPolling, updateEntry],
  );

  /**
   * Probe the main process cache for a path. If a cached size exists (e.g.
   * from a parent folder walk), the renderer cache is populated immediately
   * without starting a new calculation. Called once per unique path.
   */
  const probeCache = useCallback(
    (path: string) => {
      if (probedPaths.current.has(path)) return;
      probedPaths.current.add(path);

      // Fire-and-forget: ask the main process if it already has this size
      // cached (e.g. from a parent folder walk). probeOnly ensures no real
      // calculation is started — it only reads the cache.
      void (async () => {
        try {
          const result = await client.invoke("folderSize:start", { path, probeOnly: true });
          if (result.status === "ready") {
            const status = await client.invoke("folderSize:getStatus", { jobId: result.jobId });
            if (status.status === "ready" && status.sizeBytes !== null) {
              updateEntry(path, { status: "ready", sizeBytes: status.sizeBytes });
            }
          }
          // If not ready (deferred), do nothing — user can click Calculate.
        } catch {
          // Silently ignore probe failures.
        }
      })();
    },
    [client, updateEntry],
  );

  const getEntry = useCallback(
    (path: string): FolderSizeEntry => {
      const entry = cache.get(path);
      if (!entry) {
        // First time seeing this path — probe the main process cache.
        probeCache(path);
        return { status: "idle" };
      }
      return entry;
    },
    [cache, probeCache],
  );

  return { getEntry, calculateFolderSize, recalculateFolderSize, cancelFolderSize };
}
