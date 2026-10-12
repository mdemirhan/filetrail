import { useEffect, useState, useSyncExternalStore } from "react";

import type { OpenWithApplication } from "../../shared/appPreferences";
import type { FiletrailClient } from "../lib/filetrailClient";
import type { OpenWithLookup } from "../lib/openWith";

// Answers already had, for each window's client, by the items and pinned apps asked about.
// Apps installed or removed while the window was in the background show the next time it
// comes forward.
type LookupCache = Map<string, Promise<OpenWithLookup | null>>;
const cachesByClient = new WeakMap<FiletrailClient, LookupCache>();
const caches = new Set<LookupCache>();
const LOOKUP_CACHE_MAX = 64;
let forgetsOnFocus = false;

function forgetAnswers() {
  for (const cache of caches) {
    cache.clear();
  }
}

function lookUp(
  client: FiletrailClient,
  paths: readonly string[],
  pinned: readonly OpenWithApplication[],
): Promise<OpenWithLookup | null> {
  if (!forgetsOnFocus && typeof window !== "undefined") {
    forgetsOnFocus = true;
    window.addEventListener("focus", forgetAnswers);
  }
  let lookups = cachesByClient.get(client);
  if (!lookups) {
    lookups = new Map();
    cachesByClient.set(client, lookups);
    caches.add(lookups);
  }
  const cache = lookups;
  const pinnedAppPaths = pinned.map((entry) => entry.appPath);
  const key = JSON.stringify([paths, pinnedAppPaths]);
  let lookup = lookups.get(key);
  if (!lookup) {
    if (lookups.size >= LOOKUP_CACHE_MAX) {
      const oldestKey = lookups.keys().next().value;
      if (oldestKey !== undefined) lookups.delete(oldestKey);
    }
    lookup = client
      .invoke("system:getOpenWithApplications", {
        paths: [...paths],
        pinnedAppPaths,
      })
      .catch(() => {
        cache.delete(key);
        return null;
      });
    lookups.set(key, lookup);
  }
  return lookup;
}

// Forgets every answer, as after Always Open With changed what a kind opens in; what is on
// screen asks again.
let generation = 0;
const generationListeners = new Set<() => void>();
export function forgetOpenWithLookups() {
  forgetAnswers();
  generation += 1;
  for (const listener of generationListeners) {
    listener();
  }
}
function subscribeToGeneration(listener: () => void) {
  generationListeners.add(listener);
  return () => generationListeners.delete(listener);
}

// What macOS says about the items for Open With, asked once `paths` is given (null asks
// nothing). `ready` is set when the answer comes, or when it is slow to come: the menu then
// shows what it has (the pinned apps and Other…) rather than nothing.
export function useOpenWithLookup(
  client: FiletrailClient,
  paths: readonly string[] | null,
  pinned: readonly OpenWithApplication[],
  { delayMs = 0, patienceMs = 250 }: { delayMs?: number; patienceMs?: number } = {},
): { lookup: OpenWithLookup | null; ready: boolean } {
  const [state, setState] = useState<{
    key: string | null;
    itemsKey: string | null;
    lookup: OpenWithLookup | null;
    ready: boolean;
  }>({ key: null, itemsKey: null, lookup: null, ready: false });
  const currentGeneration = useSyncExternalStore(subscribeToGeneration, () => generation);
  const itemsKey = paths && paths.length > 0 ? JSON.stringify([paths, pinned]) : null;
  const key = itemsKey === null ? null : `${currentGeneration}:${itemsKey}`;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `paths` and `pinned`.
  useEffect(() => {
    if (key === null || !paths) {
      setState({ key: null, itemsKey: null, lookup: null, ready: false });
      return;
    }
    let cancelled = false;
    // The same items asked about again (after Always Open With) keep the old answer on screen
    // until the new one comes; other items start with none.
    setState((current) =>
      current.key === key
        ? current
        : current.itemsKey === itemsKey && current.lookup !== null
          ? { ...current, key }
          : { key, itemsKey, lookup: null, ready: false },
    );
    const patience = window.setTimeout(() => {
      if (!cancelled) {
        setState((current) => (current.key === key ? { ...current, ready: true } : current));
      }
    }, delayMs + patienceMs);
    const start = window.setTimeout(() => {
      void lookUp(client, paths, pinned).then((lookup) => {
        if (!cancelled) {
          setState({ key, itemsKey, lookup, ready: true });
        }
      });
    }, delayMs);
    return () => {
      cancelled = true;
      window.clearTimeout(patience);
      window.clearTimeout(start);
    };
  }, [client, delayMs, key, patienceMs]);

  return key !== null && state.itemsKey === itemsKey && (state.key === key || state.lookup !== null)
    ? { lookup: state.lookup, ready: state.ready }
    : { lookup: null, ready: false };
}
