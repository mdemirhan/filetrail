import { useCallback, useEffect, useRef, useState } from "react";

import { createChangeMatcher, pathsChangedByWrite } from "@filetrail/contracts";

import { isTerminalWriteStatus } from "../lib/explorerAppUtils";
import type { FiletrailClient } from "../lib/filetrailClient";

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

type ReadyEntry = Extract<FolderSizeEntry, { status: "ready" }>;

const POLL_INTERVAL_MS = 200;
// Views ask for the size of every folder they render; one not known is asked about again
// only after this cooldown so re-renders do not re-send the same question, while a later
// parent walk still shows up (folders inside a walk under way are asked about as it goes).
const PROBE_MISS_COOLDOWN_MS = 5_000;
// Every folder rendered gets probed, so cap the cache; evicted paths are simply
// probed again (a cheap main-process lookup) if they are shown later.
export const MAX_FOLDER_SIZE_CACHE_ENTRIES = 5_000;
// The most folders asked about in one request.
const MAX_PROBES_PER_REQUEST = 5_000;
// The window repaints for new sizes at most this often: while a walk runs, sizes come in
// with every poll.
export const FOLDER_SIZE_REPAINT_INTERVAL_MS = 100;

// "ask": a size the window doesn't know, or one that may have changed (kept on no answer).
// "refresh": one a write may have changed, forgotten when the main process no longer knows it.
type ProbeKind = "ask" | "refresh";

// `homePath` locates the home folder's Trash, where a move to the Trash puts things.
export function useFolderSizeCache(client: FiletrailClient, homePath = "") {
  // The cache lives in a ref so reads are free (no re-renders). We bump a
  // version counter only when the UI needs to repaint — i.e. when a
  // user-visible entry changes (calculation completes, cancel, etc.).
  const cacheRef = useRef(new Map<string, FolderSizeEntry>());
  const [version, setVersion] = useState(0);
  // A repaint asked for within the interval after the last one waits for its end, and
  // stands for all asked for meanwhile.
  const lastRepaintAt = useRef(Number.NEGATIVE_INFINITY);
  const repaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpVersion = useCallback(() => {
    if (repaintTimer.current !== null) {
      return;
    }
    const repaint = () => {
      repaintTimer.current = null;
      lastRepaintAt.current = Date.now();
      setVersion((v) => v + 1);
    };
    const wait = lastRepaintAt.current + FOLDER_SIZE_REPAINT_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      repaint();
    } else {
      repaintTimer.current = setTimeout(repaint, wait);
    }
  }, []);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  // The measurement each polled folder waits for, and a look at it now, for when the main
  // process says it has ended.
  const pollJobs = useRef(new Map<string, string>());
  const lookNow = useRef(new Map<string, () => void>());
  // Measurements that ended before the window began waiting for them (a small folder can
  // be measured before the answer to its start is in): looked at as soon as it begins.
  const settledEarly = useRef(new Set<string>());
  // Calculations a run of several folders waits for, told how each ended (ready, error, or
  // idle when stopped).
  const finishWaiters = useRef(new Map<string, Array<(entry: FolderSizeEntry) => void>>());
  // Bumped to stop a run of several folders after the one being measured.
  const folderRunRef = useRef(0);
  // Calculations asked for whose start hasn't answered yet, each marked when stopped
  // meanwhile, before there was a job to stop.
  const pendingStarts = useRef(new Map<string, { stopped: boolean }>());
  // The folders asked about that the main process didn't know (or being asked about), and
  // when, oldest first: asked about again after the cooldown when shown, and at once when a
  // walk measures what holds them.
  const probeMissedAt = useRef(new Map<string, number>());
  // The questions for the next request, sent once the current render is done.
  const probeQueue = useRef(new Map<string, ProbeKind>());
  const probeFlushQueued = useRef(false);

  useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      for (const timer of timers.values()) {
        clearInterval(timer);
      }
      timers.clear();
      if (repaintTimer.current !== null) {
        clearTimeout(repaintTimer.current);
        repaintTimer.current = null;
      }
    };
  }, []);

  // Stores an entry without repainting; the caller repaints once for all it stored.
  const setEntry = useCallback((path: string, entry: FolderSizeEntry) => {
    const cache = cacheRef.current;
    cache.delete(path);
    cache.set(path, entry);
    // Never drop an in-flight calculation; its poller still reports into it.
    trimOldest(cache, (cachedEntry) => cachedEntry.status === "calculating");
    if (entry.status !== "calculating") {
      const waiters = finishWaiters.current.get(path);
      finishWaiters.current.delete(path);
      for (const resolve of waiters ?? []) {
        resolve(entry);
      }
    }
  }, []);

  const updateEntry = useCallback(
    (path: string, entry: FolderSizeEntry) => {
      setEntry(path, entry);
      bumpVersion();
    },
    [bumpVersion, setEntry],
  );

  const noteProbeMiss = useCallback((path: string) => {
    const missedAt = probeMissedAt.current;
    missedAt.delete(path);
    missedAt.set(path, Date.now());
    trimOldest(missedAt, () => false);
  }, []);

  // Sends the questions queued, as few requests as fit, and stores the answers: a folder
  // being calculated meanwhile is left to report its own size. One repaint for all.
  const flushProbes = useCallback(async () => {
    probeFlushQueued.current = false;
    const queued = [...probeQueue.current];
    probeQueue.current.clear();
    let changed = false;
    for (let start = 0; start < queued.length; start += MAX_PROBES_PER_REQUEST) {
      const batch = queued.slice(start, start + MAX_PROBES_PER_REQUEST);
      let known: Map<string, ReadyEntry> | null = null;
      try {
        const response = await client.invoke("folderSize:probeMany", {
          paths: batch.map(([path]) => path),
        });
        known = new Map(
          response.sizes.map((size) => [
            size.path,
            {
              status: "ready" as const,
              sizeBytes: size.sizeBytes,
              diskBytes: size.diskBytes,
              fileCount: size.fileCount,
              folderCount: size.folderCount,
            },
          ]),
        );
      } catch {
        // Nothing learned: sizes asked about stay as they were, those a write may have
        // changed are forgotten and asked about again when shown.
      }
      for (const [path, kind] of batch) {
        const current = cacheRef.current.get(path);
        if (current?.status === "calculating") {
          continue;
        }
        const size = known?.get(path);
        if (size) {
          probeMissedAt.current.delete(path);
          if (!current || !isSameSize(current, size)) {
            setEntry(path, size);
            changed = true;
          }
        } else if (kind === "refresh") {
          probeMissedAt.current.delete(path);
          if (current) {
            cacheRef.current.delete(path);
            changed = true;
          }
        } else if (!current) {
          noteProbeMiss(path);
        }
      }
    }
    if (changed) {
      bumpVersion();
    }
  }, [bumpVersion, client, noteProbeMiss, setEntry]);

  const queueProbes = useCallback(
    (paths: Iterable<string>, kind: ProbeKind) => {
      for (const path of paths) {
        // A refresh is the stronger question: a size it can't confirm is forgotten.
        if (probeQueue.current.get(path) !== "refresh") {
          probeQueue.current.set(path, kind);
        }
      }
      if (probeQueue.current.size > 0 && !probeFlushQueued.current) {
        probeFlushQueued.current = true;
        queueMicrotask(() => void flushProbes());
      }
    },
    [flushProbes],
  );

  // The folders inside `path` without a size, or all of them (`includeKnown`), asked about
  // again at once: a walk of `path` measured some or all of them.
  const askAgainInside = useCallback(
    (path: string, includeKnown: boolean) => {
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const inside: string[] = [];
      for (const missedPath of probeMissedAt.current.keys()) {
        if (missedPath.startsWith(prefix)) {
          inside.push(missedPath);
        }
      }
      for (const [cachedPath, cachedEntry] of cacheRef.current) {
        if (
          cachedPath.startsWith(prefix) &&
          cachedEntry.status !== "calculating" &&
          // A folder whose own calculation was stopped or failed shows no size either.
          (includeKnown || cachedEntry.status === "idle" || cachedEntry.status === "error")
        ) {
          inside.push(cachedPath);
        }
      }
      queueProbes(inside, "ask");
    },
    [queueProbes],
  );

  const stopPolling = useCallback((path: string) => {
    const timer = pollTimers.current.get(path);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(path);
    }
    const jobId = pollJobs.current.get(path);
    if (jobId !== undefined) {
      pollJobs.current.delete(path);
      lookNow.current.delete(jobId);
    }
  }, []);

  const startPolling = useCallback(
    (path: string, jobId: string) => {
      stopPolling(path);
      // The folders inside measured so far, as last seen: more are asked about as they come.
      let measuredFolderCount = 0;
      // One look at a time: the timer and the main process's word may come together.
      let looking = false;
      const look = async () => {
        if (looking) {
          return;
        }
        looking = true;
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
            // Known sizes inside are asked about too: they may have changed.
            askAgainInside(path, true);
          } else if (result.status === "error") {
            stopPolling(path);
            updateEntry(path, { status: "error", message: result.error ?? "Unknown error" });
            askAgainInside(path, false);
          } else if (result.status === "cancelled") {
            stopPolling(path);
            updateEntry(path, { status: "idle" });
            askAgainInside(path, false);
          } else if (result.measuredFolderCount > measuredFolderCount) {
            measuredFolderCount = result.measuredFolderCount;
            askAgainInside(path, false);
          }
        } catch {
          if (pollTimers.current.get(path) !== timer) {
            return;
          }
          stopPolling(path);
          updateEntry(path, { status: "error", message: "Failed to poll folder size status" });
        } finally {
          looking = false;
        }
      };
      const timer = setInterval(() => void look(), POLL_INTERVAL_MS);
      pollTimers.current.set(path, timer);
      pollJobs.current.set(path, jobId);
      lookNow.current.set(jobId, () => void look());
      if (settledEarly.current.delete(jobId)) {
        void look();
      }
    },
    [askAgainInside, client, stopPolling, updateEntry],
  );

  // `automatic` for a measurement the app starts by itself (the Info panel's), which the
  // main process runs at a lower priority.
  const calculateFolderSize = useCallback(
    async (path: string, recalculate = false, options: { automatic?: boolean } = {}) => {
      const pending = { stopped: false };
      pendingStarts.current.set(path, pending);
      // An earlier calculation of the folder gives way to this one.
      stopPolling(path);
      updateEntry(path, { status: "calculating", jobId: "" });
      try {
        const result = await client.invoke("folderSize:start", {
          path,
          recalculate,
          ...(options.automatic ? { automatic: true } : {}),
        });
        if (pendingStarts.current.get(path) === pending) {
          pendingStarts.current.delete(path);
        } else if (!pending.stopped) {
          // Started again meanwhile: the main process stopped this one for it.
          return;
        }
        if (pending.stopped) {
          // Stop was pressed before there was a job to stop.
          if (result.status !== "ready") {
            await client.invoke("folderSize:cancel", { jobId: result.jobId }).catch(() => {
              // Best effort
            });
          }
          return;
        }
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
            askAgainInside(path, true);
          } else {
            updateEntry(path, { status: "calculating", jobId: result.jobId });
            startPolling(path, result.jobId);
          }
        } else {
          updateEntry(path, { status: "calculating", jobId: result.jobId });
          startPolling(path, result.jobId);
        }
      } catch {
        if (pendingStarts.current.get(path) === pending) {
          pendingStarts.current.delete(path);
        }
        if (!pending.stopped) {
          updateEntry(path, {
            status: "error",
            message: "Failed to start folder size calculation",
          });
        }
      }
    },
    [askAgainInside, client, startPolling, stopPolling, updateEntry],
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
      if (entry?.status === "calculating") {
        stopPolling(path);
        const pending = pendingStarts.current.get(path);
        if (pending) {
          // Not started yet: stopped once its start answers.
          pending.stopped = true;
          pendingStarts.current.delete(path);
        } else if (entry.jobId) {
          try {
            await client.invoke("folderSize:cancel", { jobId: entry.jobId });
          } catch {
            // Best effort
          }
        }
      }
      updateEntry(path, { status: "idle" });
      // The folders inside it measured before it stopped keep their sizes.
      askAgainInside(path, false);
    },
    [askAgainInside, client, stopPolling, updateEntry],
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

  // Changed items may have changed the sizes of the folders holding them. The main process
  // has taken what a delete removed off the sizes it could, and forgotten the rest: each is
  // asked about again. A move to the Trash changes the Trash too.
  const forgetChangedSizes = useCallback(
    (changedPaths: readonly string[], options: { intoTrash: boolean }) => {
      const changes = createChangeMatcher(changedPaths);
      // Where the Trash is, the folders holding it may have changed; the Trash itself too.
      const trashPath = options.intoTrash ? homeTrashPath(homePath) : null;
      const trash = trashPath === null ? null : createChangeMatcher([trashPath]);
      const toRefresh: string[] = [];
      let forgotten = false;
      for (const [path, entry] of cacheRef.current) {
        if (entry.status === "calculating") {
          continue;
        }
        if (changes.holdsChange(path) || path === trashPath || trash?.holdsChange(path)) {
          toRefresh.push(path);
        } else if (changes.isAtOrInsideChange(path)) {
          // What changed, and what is inside it: the main process forgot these.
          cacheRef.current.delete(path);
          forgotten = true;
        }
      }
      for (const missedPath of probeMissedAt.current.keys()) {
        if (changes.isAffected(missedPath)) {
          probeMissedAt.current.delete(missedPath);
        }
      }
      queueProbes(toRefresh, "refresh");
      if (forgotten) {
        bumpVersion();
      }
    },
    [bumpVersion, homePath, queueProbes],
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

  // A measurement this window waits for has ended: it is looked at now, not at the next
  // poll, so measuring many small folders one after another isn't held up between them.
  useEffect(
    () =>
      client.onFolderSizeSettled?.((jobId) => {
        const lookAtIt = lookNow.current.get(jobId);
        if (lookAtIt) {
          lookAtIt();
          return;
        }
        settledEarly.current.add(jobId);
        // Only the few that came just before their wait began are of use.
        if (settledEarly.current.size > 64) {
          const oldest = settledEarly.current.values().next().value;
          if (oldest !== undefined) {
            settledEarly.current.delete(oldest);
          }
        }
      }),
    [client],
  );

  // Items a drag out of another window took away: this window's sizes of what held them.
  useEffect(
    () =>
      client.onDraggedAway?.((change) =>
        forgetChangedSizes(change.gone, { intoTrash: change.intoTrash }),
      ),
    [client, forgetChangedSizes],
  );

  // The Trash emptied, from this window or another: its size and what holds it are asked
  // about again, and what was in it is forgotten.
  useEffect(
    () =>
      client.onTrashEmptied?.(() => {
        const trashPath = homeTrashPath(homePath);
        forgetChangedSizes(trashPath === null ? [] : [trashPath], { intoTrash: true });
      }),
    [client, forgetChangedSizes, homePath],
  );

  // A folder's size, or idle when it isn't known: then the main process is asked (all the
  // folders a render asks about, in one request), unless it was asked lately.
  const getEntry = useCallback(
    (path: string): FolderSizeEntry => {
      const entry = cacheRef.current.get(path);
      if (entry) {
        return entry;
      }
      const missedAt = probeMissedAt.current.get(path);
      if (missedAt === undefined || Date.now() - missedAt >= PROBE_MISS_COOLDOWN_MS) {
        // Marked at once, so the rest of the render doesn't ask again.
        noteProbeMiss(path);
        queueProbes([path], "ask");
      }
      return { status: "idle" };
    },
    [noteProbeMiss, queueProbes],
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

// The home folder's Trash; null while the home folder isn't known.
function homeTrashPath(homePath: string): string | null {
  return homePath.length > 0 ? `${homePath.replace(/\/+$/u, "")}/.Trash` : null;
}

// Over the limit, the oldest go but those `mustKeep` keeps, a tenth at a time: one at a
// time, each entry stored would walk past the places of all those let go before it.
function trimOldest<Value>(map: Map<string, Value>, mustKeep: (value: Value) => boolean): void {
  if (map.size <= MAX_FOLDER_SIZE_CACHE_ENTRIES) {
    return;
  }
  let over = map.size - Math.ceil(MAX_FOLDER_SIZE_CACHE_ENTRIES * 0.9);
  const oldest: string[] = [];
  for (const [path, value] of map) {
    if (over === 0) {
      break;
    }
    if (!mustKeep(value)) {
      oldest.push(path);
      over -= 1;
    }
  }
  for (const path of oldest) {
    map.delete(path);
  }
}

function isSameSize(entry: FolderSizeEntry, size: ReadyEntry): boolean {
  return (
    entry.status === "ready" &&
    entry.sizeBytes === size.sizeBytes &&
    entry.diskBytes === size.diskBytes &&
    entry.fileCount === size.fileCount &&
    entry.folderCount === size.folderCount
  );
}
