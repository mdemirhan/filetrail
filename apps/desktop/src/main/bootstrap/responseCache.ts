import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type IpcRequest, type IpcResponse, isAffectedByChange } from "@filetrail/contracts";
import type { ExplorerWorkerClient } from "@filetrail/core";
import { type RemovedItem, adjustForRemovals } from "./folderSizeAdjust";
import { FolderSizeCache } from "./folderSizeCache";

const CACHE_TTL_MS = 3_000;
// Entries expire after a few seconds. Inserts also sweep expired entries and cap
// each cache (oldest first) so browsing many directories cannot grow memory
// without bound.
const MAX_DIRECTORY_SNAPSHOT_ENTRIES = 64;
const MAX_TREE_CHILDREN_ENTRIES = 256;
const MAX_DIRECTORY_METADATA_ENTRIES = 5_000;
// Finished folder-size jobs are kept so repeated status polls stay answerable,
// but only the most recent ones; queued and running jobs are never evicted.
const MAX_FINISHED_FOLDER_SIZE_JOBS = 256;
// Measuring the home folder stores the size of every folder in it, often hundreds of
// thousands. The sizes used least recently go first: those a measurement finished first
// are the deepest, and the folders near the top, finished last, are the ones shown.
export const MAX_FOLDER_SIZES = 100_000;

type TtlCacheEntry = { expiresAt: number; value: unknown };
type TtlCache = { entries: Map<string, TtlCacheEntry>; maxEntries: number };

const directorySnapshotCache: TtlCache = {
  entries: new Map(),
  maxEntries: MAX_DIRECTORY_SNAPSHOT_ENTRIES,
};
const directoryMetadataCache: TtlCache = {
  entries: new Map(),
  maxEntries: MAX_DIRECTORY_METADATA_ENTRIES,
};
const treeChildrenCache: TtlCache = { entries: new Map(), maxEntries: MAX_TREE_CHILDREN_ENTRIES };
type FolderSizeJobStatus = "queued" | "running" | "ready" | "cancelled" | "error";
type FolderSizeJob = {
  jobId: string;
  path: string;
  status: FolderSizeJobStatus;
  sizeBytes: number | null;
  diskBytes: number | null;
  fileCount: number | null;
  folderCount: number | null;
  // The folders inside it whose sizes it has stored so far: the window asks again for the
  // sizes it is waiting on when this goes up.
  measuredFolderCount: number;
  error: string | null;
};
const folderSizeJobs = new Map<string, FolderSizeJob>();
const debugTimingsEnabled = process.env.FILETRAIL_DEBUG_TIMINGS === "1";

// Counts the clears. A load that started before a clear may have read a folder as it was
// before a write changed it: its answer is still returned to whoever asked, but it is only
// kept if no clear happened while it was loading.
let cacheGeneration = 0;

// Each folder-size cache, told what a write changed, and when one starts and ends: a size
// stored while a write runs may have been measured after it had already removed something,
// so taking the removal off it when the write ends could count the removal twice.
type FolderSizeListener = {
  forget: (changedPaths: readonly string[], removedItems: readonly RemovedItem[]) => void;
  writeStarting: () => void;
  writeEnded: () => void;
};
const folderSizeListeners = new Set<FolderSizeListener>();

// Called as a write starts changing what is on disk.
export function noteWriteStarting(): void {
  for (const listener of folderSizeListeners) {
    listener.writeStarting();
  }
}

// Called once what a write changed has been cleared (clearResponseCaches), or when it
// ended without saying.
export function noteWriteEnded(): void {
  for (const listener of folderSizeListeners) {
    listener.writeEnded();
  }
}

// After a write: listings are read again, and the sizes of the folders it touched (what
// holds them, and what is inside them) are measured again when next asked for. Items a
// delete removed are taken off the sizes of the folders that held them instead, where
// that can be done exactly (see adjustForRemovals).
export function clearResponseCaches(
  changedPaths: readonly string[] = [],
  removedItems: readonly RemovedItem[] = [],
): void {
  cacheGeneration += 1;
  directorySnapshotCache.entries.clear();
  directoryMetadataCache.entries.clear();
  treeChildrenCache.entries.clear();
  if (changedPaths.length > 0 || removedItems.length > 0) {
    for (const listener of folderSizeListeners) {
      listener.forget(changedPaths, removedItems);
    }
  }
}

// After a change made outside the app to the folder at `folderPath`: its listings are read
// again, and the details of `changedPaths` in it. Null says anything in it may have changed,
// or the folder itself (renamed or removed): the details of all in it are read again, and the
// listing of the folder holding it too. The listings of other folders, which other windows
// may be showing, are kept: a file growing in one folder doesn't slow every window.
export function forgetFolderListings(
  folderPath: string,
  changedPaths: readonly string[] | null,
): void {
  cacheGeneration += 1;
  const parentPath = dirname(folderPath);
  const listedPaths = new Set(
    changedPaths === null && parentPath !== folderPath ? [folderPath, parentPath] : [folderPath],
  );
  for (const cache of [directorySnapshotCache, treeChildrenCache]) {
    for (const key of [...cache.entries.keys()]) {
      // Each is keyed by the request, which names the folder.
      const { path } = JSON.parse(key) as { path: string };
      if (listedPaths.has(path)) {
        cache.entries.delete(key);
      }
    }
  }
  if (changedPaths !== null) {
    for (const path of changedPaths) {
      directoryMetadataCache.entries.delete(path);
    }
    return;
  }
  for (const path of [...directoryMetadataCache.entries.keys()]) {
    if (path === folderPath || dirname(path) === folderPath) {
      directoryMetadataCache.entries.delete(path);
    }
  }
}

export function getResponseCacheSizes(): {
  directorySnapshots: number;
  directoryMetadata: number;
  treeChildren: number;
  folderSizeJobs: number;
} {
  return {
    directorySnapshots: directorySnapshotCache.entries.size,
    directoryMetadata: directoryMetadataCache.entries.size,
    treeChildren: treeChildrenCache.entries.size,
    folderSizeJobs: folderSizeJobs.size,
  };
}

function storeCacheEntry(cache: TtlCache, key: string, value: unknown, now: number): void {
  // Re-inserting moves the key to the newest position so eviction stays oldest-first.
  cache.entries.delete(key);
  cache.entries.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  if (cache.entries.size <= cache.maxEntries) {
    return;
  }
  for (const [entryKey, entry] of cache.entries) {
    if (entry.expiresAt <= now) {
      cache.entries.delete(entryKey);
    }
  }
  for (const entryKey of cache.entries.keys()) {
    if (cache.entries.size <= cache.maxEntries) {
      break;
    }
    cache.entries.delete(entryKey);
  }
}

function setFolderSizeJob(jobId: string, job: FolderSizeJob): void {
  // Re-inserting moves the job to the newest position, so a long walk that just
  // finished is not the first finished job evicted before its result is polled.
  folderSizeJobs.delete(jobId);
  folderSizeJobs.set(jobId, job);
}

function isFinishedFolderSizeJob(status: FolderSizeJobStatus): boolean {
  return status !== "queued" && status !== "running";
}

function pruneFinishedFolderSizeJobs(): void {
  let finishedCount = 0;
  for (const job of folderSizeJobs.values()) {
    if (isFinishedFolderSizeJob(job.status)) {
      finishedCount += 1;
    }
  }
  for (const [jobId, job] of folderSizeJobs) {
    if (finishedCount <= MAX_FINISHED_FOLDER_SIZE_JOBS) {
      break;
    }
    if (isFinishedFolderSizeJob(job.status)) {
      folderSizeJobs.delete(jobId);
      finishedCount -= 1;
    }
  }
}

export function resetResponseCacheState(): void {
  clearResponseCaches();
  folderSizeJobs.clear();
  noteWriteEnded();
}

type MeasuredFolders = {
  dev?: number;
  dirs: Record<string, [number, number, number, number]>;
};

export function createFolderSizeHandlers(native: {
  // `onFinished` is handed the folders inside `path` measured so far, as they finish. A
  // `background` walk runs at a lower priority.
  getFolderSize: (
    path: string,
    onFinished?: (finishedJson: string) => void,
    options?: { background: boolean },
  ) => Promise<string>;
  cancelFolderSize: () => void;
  // Where the home folder is (tests use their own): its Trash is where deleted items go.
  homePath?: string;
  // How many folder sizes are kept (tests use fewer).
  maxFolderSizes?: number;
}) {
  // Only a store adds a size, so none goes while removals are taken off. What was stored
  // while a write ran is noted there, until its end has been cleared.
  const folderSizeCache = new FolderSizeCache(native.maxFolderSizes ?? MAX_FOLDER_SIZES);
  // Each measurement run stores its sizes under a number of its own (see FolderSizeStats).
  let measurementCount = 0;
  const homePath = native.homePath ?? homedir();
  const homeTrashPath = join(homePath, ".Trash");
  // Whether a measurement that reached the home folder's Trash could read it, and so
  // counted what is in it (only an app with Full Disk Access can): what a move to the
  // Trash does to the sizes of the folders holding the Trash. Learned by measuring, and
  // kept apart from the sizes, which are forgotten when the Trash changes.
  let homeTrashCounted: boolean | null = null;
  // A measurement under way when a write changes what it walks may have seen part of the
  // change: it is stopped and run again rather than kept.
  const outdatedJobIds = new Set<string>();
  folderSizeListeners.add({
    forget: (changedPaths, removedItems) => {
      folderSizeCache.forgetAffected(changedPaths);
      forgetStoredDuringWrite(removedItems);
      adjustForRemovals(folderSizeCache, removedItems, {
        path: homeTrashPath,
        counted: homeTrashCounted,
      });
      const activeJob = activeJobId ? folderSizeJobs.get(activeJobId) : undefined;
      const touchedPaths = [
        ...changedPaths,
        ...removedItems.flatMap((removed) =>
          removed.intoHomeTrash === false ? [removed.path] : [removed.path, homeTrashPath],
        ),
      ];
      // Cancelled but still stopping, it may yet finish: what it stores then is outdated too.
      if (
        activeJobId &&
        activeJob &&
        !outdatedJobIds.has(activeJobId) &&
        isAffectedByChange(activeJob.path, touchedPaths)
      ) {
        outdatedJobIds.add(activeJobId);
        if (activeJob.status === "running") {
          // Stopped now rather than left to finish a walk that is thrown away.
          native.cancelFolderSize();
        }
      }
    },
    writeStarting: () => folderSizeCache.startRecording(),
    writeEnded: () => folderSizeCache.stopRecording(),
  });
  let activeJobId: string | null = null;
  // Measurements waiting for the one that runs, in the order they run. Each window has at
  // most one here: asking again replaces it.
  let queuedJobIds: string[] = [];
  // The window that asked for each job. A window's new measurement stops its own earlier
  // one, never another window's: that one finishes, and the new one waits for it.
  const jobOwners = new Map<string, number | null>();
  // The jobs the app started itself, which walk at a lower priority.
  const backgroundJobIds = new Set<string>();

  function cancelQueuedJobsOf(owner: number | null): void {
    queuedJobIds = queuedJobIds.filter((queuedId) => {
      if (jobOwners.get(queuedId) !== owner) {
        return true;
      }
      forgetJob(queuedId);
      const queued = folderSizeJobs.get(queuedId);
      if (queued) {
        setFolderSizeJob(queuedId, { ...queued, status: "cancelled" });
      }
      return false;
    });
  }

  function forgetJob(jobId: string): void {
    jobOwners.delete(jobId);
    backgroundJobIds.delete(jobId);
  }

  // The sizes stored since the write started of the folders whose totals its removals
  // change (those that held a removed item, and the Trash and those holding it when it went
  // there): they may already leave the item out, so they are measured again instead.
  function forgetStoredDuringWrite(removedItems: readonly RemovedItem[]): void {
    if (removedItems.length === 0) {
      return;
    }
    folderSizeCache.forgetRecordedHolding(
      removedItems.map((item) => item.path),
      false,
    );
    if (removedItems.some((item) => item.intoHomeTrash !== false)) {
      folderSizeCache.forgetRecordedHolding([homeTrashPath], true);
    }
  }

  function generateJobId(): string {
    return `folder-size-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function processQueue(): void {
    while (queuedJobIds.length > 0) {
      const nextJobId = queuedJobIds.shift() as string;
      const job = folderSizeJobs.get(nextJobId);
      if (job && job.status === "queued") {
        runJob(nextJobId, job.path);
        return;
      }
    }
  }

  function runJob(jobId: string, path: string): void {
    activeJobId = jobId;
    measurementCount += 1;
    const measurement = measurementCount;
    setFolderSizeJob(jobId, {
      jobId,
      path,
      status: "running",
      sizeBytes: null,
      diskBytes: null,
      fileCount: null,
      folderCount: null,
      // Kept when measured again, so the window never sees it go down.
      measuredFolderCount: folderSizeJobs.get(jobId)?.measuredFolderCount ?? 0,
      error: null,
    });

    // Whether this measurement walked the home folder's Trash: a folder is finished only
    // after the folders inside it, so the Trash comes before the home folder.
    let homeTrashWalked = false;
    const noteWalked = (dirs: MeasuredFolders["dirs"]) => {
      if (homeTrashPath in dirs) {
        homeTrashWalked = true;
      }
      if (homePath in dirs) {
        homeTrashCounted = homeTrashWalked;
      }
    };
    // Every folder a measurement walks is on the disk it started on.
    const storeMeasured = (measured: MeasuredFolders): number => {
      const dev = measured.dev ?? null;
      let count = 0;
      for (const [dirPath, dirStats] of Object.entries(measured.dirs)) {
        folderSizeCache.store(dirPath, {
          sizeBytes: dirStats[0],
          diskBytes: dirStats[1],
          fileCount: dirStats[2],
          folderCount: dirStats[3],
          dev,
          measurement,
        });
        count += 1;
      }
      return count;
    };
    // The folders inside `path` are stored as each is finished, even once the measurement
    // is cancelled or fails (each was finished whole), but not once a write has made it
    // outdated: they may have seen part of the change, and it is run again.
    const onFinished = (finishedJson: string) => {
      const measured = JSON.parse(finishedJson) as MeasuredFolders;
      noteWalked(measured.dirs);
      if (outdatedJobIds.has(jobId)) {
        return;
      }
      const stored = storeMeasured(measured);
      const job = folderSizeJobs.get(jobId);
      if (job) {
        setFolderSizeJob(jobId, {
          ...job,
          measuredFolderCount: job.measuredFolderCount + stored,
        });
      }
    };

    let runAgain = false;
    native
      .getFolderSize(path, onFinished, { background: backgroundJobIds.has(jobId) })
      .then((jsonString) => {
        const result = JSON.parse(jsonString) as MeasuredFolders & {
          total: number;
          diskTotal: number;
          fileCount: number;
          folderCount: number;
        };
        noteWalked(result.dirs);
        if (path === homeTrashPath) {
          homeTrashCounted = true;
        } else if (path === homePath) {
          homeTrashCounted = homeTrashWalked;
        }
        if (outdatedJobIds.delete(jobId)) {
          runAgain = true;
          return;
        }
        folderSizeCache.store(path, {
          sizeBytes: result.total,
          diskBytes: result.diskTotal,
          fileCount: result.fileCount,
          folderCount: result.folderCount,
          dev: result.dev ?? null,
          measurement,
        });
        const stored = storeMeasured(result);
        setFolderSizeJob(jobId, {
          jobId,
          path,
          status: "ready",
          sizeBytes: result.total,
          diskBytes: result.diskTotal,
          fileCount: result.fileCount,
          folderCount: result.folderCount,
          measuredFolderCount: (folderSizeJobs.get(jobId)?.measuredFolderCount ?? 0) + stored,
          error: null,
        });
      })
      .catch((err: unknown) => {
        // Stopped because a write outdated it (or failing after one did): run again.
        if (outdatedJobIds.delete(jobId)) {
          runAgain = true;
          return;
        }
        const code = (err as { code?: unknown } | null)?.code;
        if (path === homeTrashPath && (code === "EPERM" || code === "EACCES")) {
          homeTrashCounted = false;
        }
        const job = folderSizeJobs.get(jobId);
        if (job && job.status === "cancelled") {
          // Already marked as cancelled by the cancel handler
        } else {
          const message = err instanceof Error ? err.message : "Unknown error";
          setFolderSizeJob(jobId, {
            jobId,
            path,
            status: "error",
            sizeBytes: null,
            diskBytes: null,
            fileCount: null,
            folderCount: null,
            measuredFolderCount: job?.measuredFolderCount ?? 0,
            error: message,
          });
        }
      })
      .finally(() => {
        if (activeJobId === jobId) {
          activeJobId = null;
        }
        // Measured again under the same job, which the window is still waiting on: at once,
        // or after the measurements other windows asked for meanwhile. One this window asked
        // for meanwhile has taken its place (and cancelled it).
        const job = folderSizeJobs.get(jobId);
        if (runAgain && job?.status === "running") {
          if (queuedJobIds.length === 0) {
            pruneFinishedFolderSizeJobs();
            runJob(jobId, path);
            return;
          }
          setFolderSizeJob(jobId, { ...job, status: "queued" });
          queuedJobIds = [...queuedJobIds, jobId];
        } else {
          forgetJob(jobId);
        }
        pruneFinishedFolderSizeJobs();
        processQueue();
      });
  }

  return {
    // `owner` is the window asking (its web contents id).
    start(
      payload: IpcRequest<"folderSize:start">,
      owner: number | null = null,
    ): IpcResponse<"folderSize:start"> {
      if (payload.recalculate) {
        folderSizeCache.delete(payload.path);
      }

      const cached = folderSizeCache.use(payload.path);
      if (cached !== undefined) {
        const jobId = generateJobId();
        setFolderSizeJob(jobId, {
          jobId,
          path: payload.path,
          status: "ready",
          sizeBytes: cached.sizeBytes,
          diskBytes: cached.diskBytes,
          fileCount: cached.fileCount,
          folderCount: cached.folderCount,
          measuredFolderCount: 0,
          error: null,
        });
        pruneFinishedFolderSizeJobs();
        return { jobId, status: "ready" };
      }

      const jobId = generateJobId();

      jobOwners.set(jobId, owner);
      if (payload.automatic) {
        backgroundJobIds.add(jobId);
      }

      if (activeJobId) {
        cancelQueuedJobsOf(owner);
        if (jobOwners.get(activeJobId) === owner) {
          // Cancel this window's active walk so the new one can start promptly. The
          // native cancel sets a flag its walkers check before each listing, so the walk
          // stops quickly; the new job, queued first, starts in the active job's
          // .finally().
          native.cancelFolderSize();
          const activeJob = folderSizeJobs.get(activeJobId);
          if (activeJob) {
            setFolderSizeJob(activeJobId, { ...activeJob, status: "cancelled" });
          }
          queuedJobIds = [jobId, ...queuedJobIds];
        } else {
          // Another window's walk goes on; this one waits its turn.
          queuedJobIds = [...queuedJobIds, jobId];
        }
        setFolderSizeJob(jobId, {
          jobId,
          path: payload.path,
          status: "queued",
          sizeBytes: null,
          diskBytes: null,
          fileCount: null,
          folderCount: null,
          measuredFolderCount: 0,
          error: null,
        });
        return { jobId, status: "queued" };
      }

      runJob(jobId, payload.path);
      return { jobId, status: "running" };
    },

    // The sizes known of `paths`, answered from what is stored: nothing is measured, and no
    // job is made, so asking about every folder on screen costs one lookup each.
    probeMany(payload: IpcRequest<"folderSize:probeMany">): IpcResponse<"folderSize:probeMany"> {
      const sizes: IpcResponse<"folderSize:probeMany">["sizes"] = [];
      for (const path of payload.paths) {
        const stats = folderSizeCache.use(path);
        if (stats) {
          sizes.push({
            path,
            sizeBytes: stats.sizeBytes,
            diskBytes: stats.diskBytes,
            fileCount: stats.fileCount,
            folderCount: stats.folderCount,
          });
        }
      }
      return { sizes };
    },

    getStatus(payload: IpcRequest<"folderSize:getStatus">): IpcResponse<"folderSize:getStatus"> {
      const job = folderSizeJobs.get(payload.jobId);
      return {
        jobId: payload.jobId,
        status: job?.status ?? "error",
        sizeBytes: job?.sizeBytes ?? null,
        diskBytes: job?.diskBytes ?? null,
        fileCount: job?.fileCount ?? null,
        folderCount: job?.folderCount ?? null,
        measuredFolderCount: job?.measuredFolderCount ?? 0,
        error: job ? job.error : "Unknown folder size job.",
      };
    },

    cancel(payload: IpcRequest<"folderSize:cancel">): IpcResponse<"folderSize:cancel"> {
      const job = folderSizeJobs.get(payload.jobId);
      if (job) {
        setFolderSizeJob(payload.jobId, { ...job, status: "cancelled" });
        if (job.jobId === activeJobId) {
          native.cancelFolderSize();
        }
        if (queuedJobIds.includes(job.jobId)) {
          queuedJobIds = queuedJobIds.filter((queuedId) => queuedId !== job.jobId);
          forgetJob(job.jobId);
        }
      }
      return { ok: true };
    },

    // A window closed, or loading its page again: its measurements are stopped, those
    // waiting and the one under way, and none is run again for it.
    forgetOwner(owner: number): void {
      cancelQueuedJobsOf(owner);
      const activeJob = activeJobId ? folderSizeJobs.get(activeJobId) : undefined;
      if (activeJob?.status === "running" && jobOwners.get(activeJob.jobId) === owner) {
        setFolderSizeJob(activeJob.jobId, { ...activeJob, status: "cancelled" });
        native.cancelFolderSize();
      }
    },

    clearCache(): void {
      folderSizeCache.clear();
    },

    getCachedSize(path: string): number | undefined {
      return folderSizeCache.get(path)?.sizeBytes;
    },
  };
}

export async function getCachedResponse<TPayload extends object, TResponse>(
  cache: "tree" | "directory",
  payload: TPayload,
  load: () => Promise<TResponse>,
): Promise<TResponse> {
  const targetCache = cache === "tree" ? treeChildrenCache : directorySnapshotCache;
  return withCachedResponse(targetCache, payload, load);
}

export async function getCachedMetadataBatch(
  workerClient: ExplorerWorkerClient,
  payload: IpcRequest<"directory:getMetadataBatch">,
): Promise<IpcResponse<"directory:getMetadataBatch">> {
  // Metadata is cached per path instead of per request because the renderer asks for
  // overlapping visible ranges as the user scrolls and changes layouts.
  const now = Date.now();
  const cachedItemsByPath = new Map<
    string,
    IpcResponse<"directory:getMetadataBatch">["items"][number]
  >();
  const missingPaths: string[] = [];

  for (const path of payload.paths) {
    const cached = directoryMetadataCache.entries.get(path);
    if (cached && cached.expiresAt > now) {
      cachedItemsByPath.set(
        path,
        cached.value as IpcResponse<"directory:getMetadataBatch">["items"][number],
      );
      continue;
    }
    missingPaths.push(path);
  }

  if (missingPaths.length > 0) {
    const generation = cacheGeneration;
    const response = await workerClient.request("directory:getMetadataBatch", {
      ...payload,
      paths: missingPaths,
    });
    for (const item of response.items) {
      if (generation === cacheGeneration) {
        storeCacheEntry(directoryMetadataCache, item.path, item, now);
      }
      cachedItemsByPath.set(item.path, item);
    }
  }

  return {
    directoryPath: payload.directoryPath,
    items: payload.paths.flatMap((path) => {
      const item = cachedItemsByPath.get(path);
      return item ? [item] : [];
    }),
  };
}

export async function withTiming<T>(
  label: string,
  path: string,
  load: () => Promise<T>,
  logger: Pick<Console, "debug"> = console,
): Promise<T> {
  // Slow-path logging is enough for production debugging without flooding the console.
  const start = performance.now();
  const value = await load();
  const elapsedMs = performance.now() - start;
  if (debugTimingsEnabled || elapsedMs >= 120) {
    logger.debug(`[filetrail] ${label} ${path} ${Math.round(elapsedMs)}ms`);
  }
  return value;
}

async function withCachedResponse<TPayload extends object, TResponse>(
  cache: TtlCache,
  payload: TPayload,
  load: () => Promise<TResponse>,
): Promise<TResponse> {
  // Payload serialization keeps variants like includeHidden/sort mode isolated in cache.
  const cacheKey = JSON.stringify(payload);
  const now = Date.now();
  const cached = cache.entries.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value as TResponse;
  }
  const generation = cacheGeneration;
  const value = await load();
  if (generation === cacheGeneration) {
    storeCacheEntry(cache, cacheKey, value, now);
  }
  return value;
}
