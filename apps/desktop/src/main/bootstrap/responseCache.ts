import { type IpcRequest, type IpcResponse, isAffectedByChange } from "@filetrail/contracts";
import type { ExplorerWorkerClient } from "@filetrail/core";

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
type FolderSizeJobStatus = "queued" | "running" | "deferred" | "ready" | "cancelled" | "error";
type FolderSizeJob = {
  jobId: string;
  path: string;
  status: FolderSizeJobStatus;
  sizeBytes: number | null;
  diskBytes: number | null;
  fileCount: number | null;
  error: string | null;
};
const folderSizeJobs = new Map<string, FolderSizeJob>();
const debugTimingsEnabled = process.env.FILETRAIL_DEBUG_TIMINGS === "1";

// Counts the clears. A load that started before a clear may have read a folder as it was
// before a write changed it: its answer is still returned to whoever asked, but it is only
// kept if no clear happened while it was loading.
let cacheGeneration = 0;

// Each folder-size cache, told what a write changed.
const folderSizeForgetters = new Set<(changedPaths: readonly string[]) => void>();

// After a write: listings are read again, and the sizes of the folders it touched (what
// holds them, and what is inside them) are measured again when next asked for.
export function clearResponseCaches(changedPaths: readonly string[] = []): void {
  cacheGeneration += 1;
  directorySnapshotCache.entries.clear();
  directoryMetadataCache.entries.clear();
  treeChildrenCache.entries.clear();
  if (changedPaths.length > 0) {
    for (const forget of folderSizeForgetters) {
      forget(changedPaths);
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
}

export function createFolderSizeHandlers(native: {
  getFolderSize: (path: string) => Promise<string>;
  cancelFolderSize: () => void;
}) {
  const folderSizeCache = new Map<
    string,
    { sizeBytes: number; diskBytes: number; fileCount: number }
  >();
  folderSizeForgetters.add((changedPaths) => {
    for (const path of [...folderSizeCache.keys()]) {
      if (isAffectedByChange(path, changedPaths)) {
        folderSizeCache.delete(path);
      }
    }
  });
  let activeJobId: string | null = null;
  let queuedJobId: string | null = null;

  function generateJobId(): string {
    return `folder-size-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function processQueue(): void {
    if (!queuedJobId) return;
    const nextJobId = queuedJobId;
    queuedJobId = null;
    const job = folderSizeJobs.get(nextJobId);
    if (job && job.status === "queued") {
      runJob(nextJobId, job.path);
    }
  }

  function runJob(jobId: string, path: string): void {
    activeJobId = jobId;
    setFolderSizeJob(jobId, {
      jobId,
      path,
      status: "running",
      sizeBytes: null,
      diskBytes: null,
      fileCount: null,
      error: null,
    });

    native
      .getFolderSize(path)
      .then((jsonString) => {
        const result = JSON.parse(jsonString) as {
          total: number;
          diskTotal: number;
          fileCount: number;
          dirs: Record<string, [number, number, number]>;
        };
        folderSizeCache.set(path, {
          sizeBytes: result.total,
          diskBytes: result.diskTotal,
          fileCount: result.fileCount,
        });
        for (const [dirPath, dirStats] of Object.entries(result.dirs)) {
          folderSizeCache.set(dirPath, {
            sizeBytes: dirStats[0],
            diskBytes: dirStats[1],
            fileCount: dirStats[2],
          });
        }
        setFolderSizeJob(jobId, {
          jobId,
          path,
          status: "ready",
          sizeBytes: result.total,
          diskBytes: result.diskTotal,
          fileCount: result.fileCount,
          error: null,
        });
      })
      .catch((err: unknown) => {
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
            error: message,
          });
        }
      })
      .finally(() => {
        if (activeJobId === jobId) {
          activeJobId = null;
        }
        pruneFinishedFolderSizeJobs();
        processQueue();
      });
  }

  return {
    start(payload: IpcRequest<"folderSize:start">): IpcResponse<"folderSize:start"> {
      if (payload.recalculate) {
        folderSizeCache.delete(payload.path);
      }

      const cached = folderSizeCache.get(payload.path);
      if (cached !== undefined) {
        const jobId = generateJobId();
        setFolderSizeJob(jobId, {
          jobId,
          path: payload.path,
          status: "ready",
          sizeBytes: cached.sizeBytes,
          diskBytes: cached.diskBytes,
          fileCount: cached.fileCount,
          error: null,
        });
        pruneFinishedFolderSizeJobs();
        return { jobId, status: "ready" };
      }

      // probeOnly: return deferred without starting a walk. Used by the
      // renderer to check the main-process cache without side effects.
      if (payload.probeOnly) {
        const jobId = generateJobId();
        setFolderSizeJob(jobId, {
          jobId,
          path: payload.path,
          status: "deferred",
          sizeBytes: null,
          diskBytes: null,
          fileCount: null,
          error: null,
        });
        pruneFinishedFolderSizeJobs();
        return { jobId, status: "deferred" };
      }

      const jobId = generateJobId();

      if (activeJobId) {
        // Cancel the active walk so the new one can start promptly.
        // The native cancel sets a volatile flag checked each fts_read
        // iteration, so the active walk aborts quickly. We queue the new
        // job and it will be picked up in the active job's .finally().
        native.cancelFolderSize();
        const activeJob = folderSizeJobs.get(activeJobId);
        if (activeJob) {
          setFolderSizeJob(activeJobId, { ...activeJob, status: "cancelled" });
        }

        if (queuedJobId) {
          const oldQueued = folderSizeJobs.get(queuedJobId);
          if (oldQueued) {
            setFolderSizeJob(queuedJobId, { ...oldQueued, status: "cancelled" });
          }
        }
        queuedJobId = jobId;
        setFolderSizeJob(jobId, {
          jobId,
          path: payload.path,
          status: "queued",
          sizeBytes: null,
          diskBytes: null,
          fileCount: null,
          error: null,
        });
        return { jobId, status: "queued" };
      }

      runJob(jobId, payload.path);
      return { jobId, status: "running" };
    },

    getStatus(payload: IpcRequest<"folderSize:getStatus">): IpcResponse<"folderSize:getStatus"> {
      const job = folderSizeJobs.get(payload.jobId);
      return {
        jobId: payload.jobId,
        status: job?.status ?? "error",
        sizeBytes: job?.sizeBytes ?? null,
        diskBytes: job?.diskBytes ?? null,
        fileCount: job?.fileCount ?? null,
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
        if (job.jobId === queuedJobId) {
          queuedJobId = null;
        }
      }
      return { ok: true };
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
