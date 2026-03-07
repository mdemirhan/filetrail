import { app, ipcMain, shell } from "electron";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";
import { ExplorerWorkerClient } from "@filetrail/core";
import { registerIpcHandlers } from "./ipc";

let activeWorkerClient: ExplorerWorkerClient | null = null;
const CACHE_TTL_MS = 3_000;
const directorySnapshotCache = new Map<string, { expiresAt: number; value: unknown }>();
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

export async function bootstrapMainProcess(): Promise<void> {
  const workerClient = new ExplorerWorkerClient(resolveExplorerWorkerUrl());
  activeWorkerClient = workerClient;

  registerIpcHandlers(ipcMain, {
    "app:getHomeDirectory": () => ({
      path: app.getPath("home"),
    }),
    "app:clearCaches": () => {
      clearCaches();
      return { ok: true };
    },
    "tree:getChildren": (payload) =>
      withCachedResponse(treeChildrenCache, payload, () =>
        withTiming("tree:getChildren", payload.path, () =>
          workerClient.request("tree:getChildren", payload),
        ),
      ),
    "directory:getSnapshot": (payload) =>
      withCachedResponse(directorySnapshotCache, payload, () =>
        withTiming("directory:getSnapshot", payload.path, () =>
          workerClient.request("directory:getSnapshot", payload),
        ),
      ),
    "directory:getMetadataBatch": (payload) =>
      withTiming("directory:getMetadataBatch", payload.directoryPath, () =>
        workerClient.request("directory:getMetadataBatch", payload),
      ),
    "item:getProperties": (payload) =>
      withTiming("item:getProperties", payload.path, () =>
        workerClient.request("item:getProperties", payload),
      ),
    "path:getSuggestions": (payload) =>
      withTiming("path:getSuggestions", payload.inputPath, () =>
        workerClient.request("path:getSuggestions", payload),
      ),
    "path:resolve": (payload) =>
      withTiming("path:resolve", payload.path, () => workerClient.request("path:resolve", payload)),
    "folderSize:start": (payload) => {
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
    "folderSize:getStatus": (payload) => {
      const job = folderSizeJobs.get(payload.jobId);
      return {
        jobId: payload.jobId,
        status: job?.status ?? "error",
        sizeBytes: job?.sizeBytes ?? null,
        error: job ? job.error : "Unknown folder size job.",
      };
    },
    "folderSize:cancel": (payload) => {
      const job = folderSizeJobs.get(payload.jobId);
      if (job) {
        folderSizeJobs.set(payload.jobId, {
          ...job,
          status: "cancelled",
        });
      }
      return { ok: true };
    },
    "system:openPath": (payload) => openPath(payload),
  });
}

export async function shutdownMainProcess(): Promise<void> {
  if (!activeWorkerClient) {
    return;
  }
  const workerClient = activeWorkerClient;
  activeWorkerClient = null;
  clearCaches();
  folderSizeJobs.clear();
  await workerClient.close();
}

function resolveExplorerWorkerUrl(): URL {
  return new URL("./explorerWorker.js", import.meta.url);
}

async function openPath(
  payload: IpcRequest<"system:openPath">,
): Promise<IpcResponse<"system:openPath">> {
  const error = await shell.openPath(payload.path);
  return {
    ok: error.length === 0,
    error: error.length === 0 ? null : error,
  };
}

function clearCaches(): void {
  directorySnapshotCache.clear();
  treeChildrenCache.clear();
}

async function withCachedResponse<TPayload extends object, TResponse>(
  cache: Map<string, { expiresAt: number; value: unknown }>,
  payload: TPayload,
  load: () => Promise<TResponse>,
): Promise<TResponse> {
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

async function withTiming<T>(label: string, path: string, load: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const value = await load();
  const elapsedMs = performance.now() - start;
  if (debugTimingsEnabled || elapsedMs >= 120) {
    console.log(`[filetrail] ${label} ${path} ${Math.round(elapsedMs)}ms`);
  }
  return value;
}
