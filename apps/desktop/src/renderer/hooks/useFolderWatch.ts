import { useCallback, useEffect, useRef } from "react";

import type { FiletrailClient } from "../lib/filetrailClient";

// A folder still being read when a change arrives is tried again this much later.
const RETRY_MS = 250;
// More changed items than this are read again as "anything may have changed".
const MAX_CHANGED_PATHS = 1_000;

type PendingChange = { path: string; changedPaths: Set<string> | null };

// Keeps the folder on screen up to date with changes made outside the app. The main process
// watches `path` (null watches nothing) and tells of each change; `reload` reads the folder
// again. While `held` (a rename being typed, a menu or a sheet open, a file operation
// running), changes wait and are read once it ends. `reload` resolves to false when it
// can't read the folder yet; it is asked again shortly.
export function useFolderWatch({
  client,
  path,
  held,
  reload,
}: {
  client: FiletrailClient;
  path: string | null;
  held: boolean;
  reload: (changedPaths: readonly string[] | null) => Promise<boolean>;
}): void {
  const latestRef = useRef({ path, held, reload });
  latestRef.current = { path, held, reload };
  const pendingRef = useRef<PendingChange | null>(null);
  const runningRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  const addPending = useCallback((change: PendingChange) => {
    const pending = pendingRef.current;
    if (!pending || pending.path !== change.path) {
      pendingRef.current = change;
      return;
    }
    if (pending.changedPaths === null || change.changedPaths === null) {
      pending.changedPaths = null;
      return;
    }
    for (const changedPath of change.changedPaths) {
      pending.changedPaths.add(changedPath);
    }
    if (pending.changedPaths.size > MAX_CHANGED_PATHS) {
      pending.changedPaths = null;
    }
  }, []);

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    const latest = latestRef.current;
    if (runningRef.current || retryTimerRef.current !== null || !pending || latest.held) {
      return;
    }
    pendingRef.current = null;
    // Changes to a folder no longer on screen don't matter.
    if (pending.path !== latest.path) {
      return;
    }
    runningRef.current = true;
    let done = true;
    try {
      done = await latest.reload(pending.changedPaths === null ? null : [...pending.changedPaths]);
    } catch {
      // A folder that can't be read shows its error the way any read does.
    } finally {
      runningRef.current = false;
    }
    if (!done) {
      addPending(pending);
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void flush();
      }, RETRY_MS);
      return;
    }
    // Changes that came in while it was read.
    void flush();
  }, [addPending]);

  useEffect(() => {
    void client.invoke("folder:watch", { path }).catch(() => undefined);
  }, [client, path]);

  useEffect(() => {
    const unsubscribe = client.onFolderChanged?.((change) => {
      if (change.path !== latestRef.current.path) {
        return;
      }
      addPending({
        path: change.path,
        changedPaths: change.changedPaths === null ? null : new Set(change.changedPaths),
      });
      void flush();
    });
    return () => {
      unsubscribe?.();
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      void client.invoke("folder:watch", { path: null }).catch(() => undefined);
    };
  }, [client, addPending, flush]);

  useEffect(() => {
    if (!held) {
      void flush();
    }
  }, [held, flush]);
}
