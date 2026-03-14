import type { IpcRequest, IpcResponse } from "@filetrail/contracts";
import type { ExplorerWorkerClient } from "@filetrail/core";

const CACHE_TTL_MS = 3_000;
const directorySnapshotCache = new Map<string, { expiresAt: number; value: unknown }>();
const directoryMetadataCache = new Map<string, { expiresAt: number; value: unknown }>();
const treeChildrenCache = new Map<string, { expiresAt: number; value: unknown }>();
const folderSizeJobs = new Map<
  string,
  {
    jobId: string;
    path: string;
    status: "queued" | "running" | "deferred" | "ready" | "cancelled" | "error";
    sizeBytes: number | null;
    diskBytes: number | null;
    fileCount: number | null;
    error: string | null;
  }
>();
const debugTimingsEnabled = process.env.FILETRAIL_DEBUG_TIMINGS === "1";

export function clearResponseCaches(): void {
  directorySnapshotCache.clear();
  directoryMetadataCache.clear();
  treeChildrenCache.clear();
}

export function resetResponseCacheState(): void {
  clearResponseCaches();
  folderSizeJobs.clear();
}

export function createFolderSizeHandlers(native: {
  getFolderSize: (path: string) => Promise<string>;
  cancelFolderSize: () => void;
}) {
  const folderSizeCache = new Map<string, { sizeBytes: number; diskBytes: number; fileCount: number }>();
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
    folderSizeJobs.set(jobId, {
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
        folderSizeJobs.set(jobId, {
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
          folderSizeJobs.set(jobId, {
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
        folderSizeJobs.set(jobId, {
          jobId,
          path: payload.path,
          status: "ready",
          sizeBytes: cached.sizeBytes,
          diskBytes: cached.diskBytes,
          fileCount: cached.fileCount,
          error: null,
        });
        return { jobId, status: "ready" };
      }

      // probeOnly: return deferred without starting a walk. Used by the
      // renderer to check the main-process cache without side effects.
      if (payload.probeOnly) {
        const jobId = generateJobId();
        folderSizeJobs.set(jobId, {
          jobId,
          path: payload.path,
          status: "deferred",
          sizeBytes: null,
          diskBytes: null,
          fileCount: null,
          error: null,
        });
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
          folderSizeJobs.set(activeJobId, { ...activeJob, status: "cancelled" });
        }

        if (queuedJobId) {
          const oldQueued = folderSizeJobs.get(queuedJobId);
          if (oldQueued) {
            folderSizeJobs.set(queuedJobId, { ...oldQueued, status: "cancelled" });
          }
        }
        queuedJobId = jobId;
        folderSizeJobs.set(jobId, {
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
        folderSizeJobs.set(payload.jobId, { ...job, status: "cancelled" });
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
    const cached = directoryMetadataCache.get(path);
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
    const response = await workerClient.request("directory:getMetadataBatch", {
      ...payload,
      paths: missingPaths,
    });
    for (const item of response.items) {
      directoryMetadataCache.set(item.path, {
        expiresAt: now + CACHE_TTL_MS,
        value: item,
      });
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
  cache: Map<string, { expiresAt: number; value: unknown }>,
  payload: TPayload,
  load: () => Promise<TResponse>,
): Promise<TResponse> {
  // Payload serialization keeps variants like includeHidden/sort mode isolated in cache.
  const cacheKey = JSON.stringify(payload);
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value as TResponse;
  }
  const value = await load();
  cache.set(cacheKey, {
    expiresAt: now + CACHE_TTL_MS,
    value,
  });
  return value;
}
