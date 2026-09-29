import { useCallback, useEffect, useRef } from "react";

import type { IpcRequest } from "@filetrail/contracts";

import type { FiletrailClient } from "../lib/filetrailClient";

export type PreferencesPatch = IpcRequest<"app:updatePreferences">["preferences"];

const PREFERENCES_PERSIST_DEBOUNCE_MS = 300;

// Keys whose value differs (by identity) from the last synced snapshot.
export function diffPreferencesPatch(
  synced: PreferencesPatch,
  next: PreferencesPatch,
): PreferencesPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as Array<keyof PreferencesPatch>) {
    if (!Object.is(synced[key], next[key])) {
      patch[key] = next[key];
    }
  }
  return patch as PreferencesPatch;
}

// Keeps a window's preferences in sync with the main process. Only keys that changed since
// the last sync are written, so two windows (explorer and Settings) never overwrite each
// other's edits with stale values; edits made elsewhere arrive through `onRemotePatch`.
export function usePreferencesSync({
  client,
  ready,
  payload,
  onRemotePatch,
}: {
  client: FiletrailClient;
  ready: boolean;
  payload: PreferencesPatch;
  onRemotePatch: (patch: PreferencesPatch) => void;
}) {
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const syncedRef = useRef<PreferencesPatch>({});
  const queuedRef = useRef<PreferencesPatch | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRemotePatchRef = useRef(onRemotePatch);
  onRemotePatchRef.current = onRemotePatch;

  const flush = useCallback(() => {
    timerRef.current = null;
    queuedRef.current = null;
    const patch = diffPreferencesPatch(syncedRef.current, payloadRef.current);
    if (Object.keys(patch).length === 0) {
      return;
    }
    syncedRef.current = { ...syncedRef.current, ...patch };
    void client.invoke("app:updatePreferences", { preferences: patch });
  }, [client]);

  // Called once persisted preferences are loaded so hydration itself is not written back.
  const markSynced = useCallback((preferences: PreferencesPatch) => {
    syncedRef.current = { ...preferences };
  }, []);

  // Trailing debounce: bursts of changes collapse into one write with the latest values.
  useEffect(() => {
    if (!ready) {
      return;
    }
    const queued = queuedRef.current;
    if (queued !== null && Object.keys(diffPreferencesPatch(queued, payload)).length === 0) {
      return;
    }
    if (
      queued === null &&
      Object.keys(diffPreferencesPatch(syncedRef.current, payload)).length === 0
    ) {
      return;
    }
    queuedRef.current = payload;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(flush, PREFERENCES_PERSIST_DEBOUNCE_MS);
  });

  useEffect(() => {
    const unsubscribe = client.onPreferencesChanged?.((patch) => {
      syncedRef.current = { ...syncedRef.current, ...patch };
      onRemotePatchRef.current(patch);
    });
    return () => unsubscribe?.();
  }, [client]);

  // Flush a pending write on unmount so the latest values win.
  useEffect(
    () => () => {
      if (timerRef.current === null) {
        return;
      }
      clearTimeout(timerRef.current);
      flush();
    },
    [flush],
  );

  return { markSynced };
}
