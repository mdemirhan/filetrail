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

export function createFolderSizeHandlers() {
  return {
    start(payload: IpcRequest<"folderSize:start">): IpcResponse<"folderSize:start"> {
      // Folder sizes are deferred for now because recursive sizing is much more expensive
      // than the rest of the metadata path and should not block basic inspection UI.
      const jobId = `folder-size-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      folderSizeJobs.set(jobId, {
        jobId,
        path: payload.path,
        status: "deferred",
        sizeBytes: null,
        error: null,
      });
      return { jobId, status: "deferred" };
    },
    getStatus(payload: IpcRequest<"folderSize:getStatus">): IpcResponse<"folderSize:getStatus"> {
      const job = folderSizeJobs.get(payload.jobId);
      return {
        jobId: payload.jobId,
        status: job?.status ?? "error",
        sizeBytes: job?.sizeBytes ?? null,
        error: job ? job.error : "Unknown folder size job.",
      };
    },
    cancel(payload: IpcRequest<"folderSize:cancel">): IpcResponse<"folderSize:cancel"> {
      const job = folderSizeJobs.get(payload.jobId);
      if (job) {
        folderSizeJobs.set(payload.jobId, {
          ...job,
          status: "cancelled",
        });
      }
      return { ok: true };
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
