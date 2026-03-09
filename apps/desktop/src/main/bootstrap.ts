import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { app, clipboard, ipcMain, shell } from "electron";

import {
  copyPasteProgressEventSchema,
  type IpcRequest,
  type IpcResponse,
} from "@filetrail/contracts";
import { ExplorerWorkerClient, createWriteService, getPathSuggestions } from "@filetrail/core";
import type { AppPreferences } from "../shared/appPreferences";
import type { AppStateStore } from "./appStateStore";
import { resolveBundledFdBinaryPath } from "./fdBinary";
import { registerIpcHandlers } from "./ipc";
import { createWriteOperationLogger } from "./writeOperationLog";

let activeWorkerClient: ExplorerWorkerClient | null = null;
let activeWriteService: ReturnType<typeof createWriteService> | null = null;
let writeServiceUnsubscribe: (() => void) | null = null;
const execFileAsync = promisify(execFile);
// These caches are short-lived UI accelerators, not durable state. They smooth repeated
// reads while navigating without hiding filesystem changes for long.
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
const writeOperationLogger = createWriteOperationLogger();
const copyPasteSenders = new Map<
  string,
  {
    send: (channel: string, payload: unknown) => void;
  }
>();
const copyPasteRequests = new Map<string, IpcRequest<"copyPaste:start">>();

export async function bootstrapMainProcess(
  appStateStore: AppStateStore,
  launchContext: { startupFolderPath: string | null } = { startupFolderPath: null },
  onPreferencesChanged?: (preferences: AppPreferences) => void,
): Promise<void> {
  // Main owns the worker client so the renderer only ever talks through the IPC contract.
  const workerClient = new ExplorerWorkerClient(resolveExplorerWorkerUrl(), {
    fdBinaryPath: resolveBundledFdBinaryPath(),
  });
  const writeService = createWriteService();
  activeWorkerClient = workerClient;
  activeWriteService = writeService;
  writeServiceUnsubscribe?.();
  writeServiceUnsubscribe = writeService.subscribe((event) => {
    if (
      event.status === "completed" ||
      event.status === "failed" ||
      event.status === "cancelled" ||
      event.status === "partial"
    ) {
      const request = copyPasteRequests.get(event.operationId);
      writeOperationLogger.log({
        phase: "finished",
        kind: "copyPaste",
        action: event.mode,
        operationId: event.operationId,
        sourcePaths: request?.sourcePaths ?? [],
        targetPaths: request ? [request.destinationDirectoryPath] : [],
        result: event.result
          ? {
              status: event.result.status,
              completedItemCount: event.result.summary.completedItemCount,
              failedItemCount: event.result.summary.failedItemCount,
              skippedItemCount: event.result.summary.skippedItemCount,
              cancelledItemCount: event.result.summary.cancelledItemCount,
              error: event.result.error,
            }
          : {
              status: event.status,
            },
        ...(request
          ? {
              metadata: {
                conflictResolution: request.conflictResolution,
              },
            }
          : {}),
      });
      copyPasteRequests.delete(event.operationId);
    }
    const sender = copyPasteSenders.get(event.operationId);
    if (!sender) {
      return;
    }
    sender.send("filetrail:copyPasteProgress", copyPasteProgressEventSchema.parse(event));
    if (
      event.status === "completed" ||
      event.status === "failed" ||
      event.status === "cancelled" ||
      event.status === "partial"
    ) {
      copyPasteSenders.delete(event.operationId);
    }
  });

  registerIpcHandlers(ipcMain, {
    "app:getHomeDirectory": () => ({
      path: app.getPath("home"),
    }),
    "app:getPreferences": () => ({
      preferences: appStateStore.getPreferences(),
    }),
    "app:getLaunchContext": () => launchContext,
    "app:updatePreferences": (payload) => {
      const preferences = appStateStore.updatePreferences(toPreferencePatch(payload.preferences));
      onPreferencesChanged?.(preferences);
      return { preferences };
    },
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
        getCachedMetadataBatch(workerClient, payload),
      ),
    "item:getProperties": (payload) =>
      withTiming("item:getProperties", payload.path, () =>
        workerClient.request("item:getProperties", payload),
      ),
    "path:getSuggestions": (payload) =>
      withTiming("path:getSuggestions", payload.inputPath, () =>
        getPathSuggestions(payload.inputPath, payload.includeHidden, payload.limit),
      ),
    "path:resolve": (payload) =>
      withTiming("path:resolve", payload.path, () => workerClient.request("path:resolve", payload)),
    "search:start": (payload) =>
      withTiming("search:start", payload.rootPath, () =>
        workerClient.request("search:start", payload),
      ),
    "search:getUpdate": (payload) => workerClient.request("search:getUpdate", payload),
    "search:cancel": (payload) => workerClient.request("search:cancel", payload),
    "copyPaste:plan": (payload) => writeService.planCopyPaste(payload),
    "copyPaste:start": (payload, event) => {
      const handle = writeService.startCopyPaste(payload);
      copyPasteRequests.set(handle.operationId, payload);
      writeOperationLogger.log({
        phase: "started",
        kind: "copyPaste",
        action: payload.mode,
        operationId: handle.operationId,
        sourcePaths: payload.sourcePaths,
        targetPaths: [payload.destinationDirectoryPath],
        metadata: {
          conflictResolution: payload.conflictResolution ?? "error",
        },
      });
      copyPasteSenders.set(handle.operationId, event.sender);
      return handle;
    },
    "copyPaste:cancel": (payload) => {
      const request = copyPasteRequests.get(payload.operationId);
      writeOperationLogger.log({
        phase: "cancel_requested",
        kind: "copyPaste",
        action: request?.mode ?? "unknown",
        operationId: payload.operationId,
        sourcePaths: request?.sourcePaths ?? [],
        targetPaths: request ? [request.destinationDirectoryPath] : [],
        ...(request
          ? {
              metadata: {
                conflictResolution: request.conflictResolution ?? "error",
              },
            }
          : {}),
      });
      return writeService.cancelOperation(payload.operationId);
    },
    "folderSize:start": (payload) => {
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
    "system:openInTerminal": (payload) =>
      openInTerminal(payload, appStateStore.getPreferences().terminalApp),
    "system:copyText": (payload) => {
      clipboard.writeText(payload.text);
      return { ok: true };
    },
  });
}

export async function shutdownMainProcess(): Promise<void> {
  if (!activeWorkerClient) {
    return;
  }
  const workerClient = activeWorkerClient;
  activeWorkerClient = null;
  activeWriteService = null;
  writeServiceUnsubscribe?.();
  writeServiceUnsubscribe = null;
  clearCaches();
  folderSizeJobs.clear();
  copyPasteSenders.clear();
  copyPasteRequests.clear();
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

async function openInTerminal(
  payload: IpcRequest<"system:openInTerminal">,
  terminalApp: string | null,
): Promise<IpcResponse<"system:openInTerminal">> {
  try {
    // Files open Terminal in their containing directory; directories open directly.
    const targetPath = await resolveTerminalTargetPath(payload.path);
    await execFileAsync("open", ["-a", resolveTerminalApplicationName(terminalApp), targetPath]);
    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  }
}

function clearCaches(): void {
  directorySnapshotCache.clear();
  directoryMetadataCache.clear();
  treeChildrenCache.clear();
}

async function resolveTerminalTargetPath(path: string): Promise<string> {
  try {
    const stats = await stat(path);
    return stats.isDirectory() ? path : dirname(path);
  } catch {
    return dirname(path);
  }
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

async function getCachedMetadataBatch(
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
    // Only fetch misses so preloaded metadata and visible-row requests compose cheaply.
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

async function withTiming<T>(label: string, path: string, load: () => Promise<T>): Promise<T> {
  // Slow-path logging is enough for production debugging without flooding the console.
  const start = performance.now();
  const value = await load();
  const elapsedMs = performance.now() - start;
  if (debugTimingsEnabled || elapsedMs >= 120) {
    console.log(`[filetrail] ${label} ${path} ${Math.round(elapsedMs)}ms`);
  }
  return value;
}

export function toPreferencePatch(
  value: IpcRequest<"app:updatePreferences">["preferences"],
): Partial<AppPreferences> {
  // Map fields explicitly so new preference keys are added intentionally rather than
  // silently flowing through as unchecked transport payload.
  const patch: Partial<AppPreferences> = {};
  if (value.theme !== undefined) {
    patch.theme = value.theme;
  }
  if (value.accent !== undefined) {
    patch.accent = value.accent;
  }
  if (value.accentToolbarButtons !== undefined) {
    patch.accentToolbarButtons = value.accentToolbarButtons;
  }
  if (value.zoomPercent !== undefined) {
    patch.zoomPercent = value.zoomPercent;
  }
  if (value.uiFontFamily !== undefined) {
    patch.uiFontFamily = value.uiFontFamily;
  }
  if (value.uiFontSize !== undefined) {
    patch.uiFontSize = value.uiFontSize;
  }
  if (value.uiFontWeight !== undefined) {
    patch.uiFontWeight = value.uiFontWeight;
  }
  if (value.textPrimaryOverride !== undefined) {
    patch.textPrimaryOverride = value.textPrimaryOverride;
  }
  if (value.textSecondaryOverride !== undefined) {
    patch.textSecondaryOverride = value.textSecondaryOverride;
  }
  if (value.textMutedOverride !== undefined) {
    patch.textMutedOverride = value.textMutedOverride;
  }
  if (value.viewMode !== undefined) {
    patch.viewMode = value.viewMode;
  }
  if (value.foldersFirst !== undefined) {
    patch.foldersFirst = value.foldersFirst;
  }
  if (value.compactListView !== undefined) {
    patch.compactListView = value.compactListView;
  }
  if (value.compactDetailsView !== undefined) {
    patch.compactDetailsView = value.compactDetailsView;
  }
  if (value.compactTreeView !== undefined) {
    patch.compactTreeView = value.compactTreeView;
  }
  if (value.detailColumns !== undefined) {
    patch.detailColumns = value.detailColumns;
  }
  if (value.detailColumnWidths !== undefined) {
    patch.detailColumnWidths = value.detailColumnWidths;
  }
  if (value.tabSwitchesExplorerPanes !== undefined) {
    patch.tabSwitchesExplorerPanes = value.tabSwitchesExplorerPanes;
  }
  if (value.typeaheadEnabled !== undefined) {
    patch.typeaheadEnabled = value.typeaheadEnabled;
  }
  if (value.typeaheadDebounceMs !== undefined) {
    patch.typeaheadDebounceMs = value.typeaheadDebounceMs;
  }
  if (value.notificationsEnabled !== undefined) {
    patch.notificationsEnabled = value.notificationsEnabled;
  }
  if (value.notificationDurationSeconds !== undefined) {
    patch.notificationDurationSeconds = value.notificationDurationSeconds;
  }
  if (value.propertiesOpen !== undefined) {
    patch.propertiesOpen = value.propertiesOpen;
  }
  if (value.detailRowOpen !== undefined) {
    patch.detailRowOpen = value.detailRowOpen;
  }
  if (value.terminalApp !== undefined) {
    patch.terminalApp = value.terminalApp;
  }
  if (value.includeHidden !== undefined) {
    patch.includeHidden = value.includeHidden;
  }
  if (value.searchPatternMode !== undefined) {
    patch.searchPatternMode = value.searchPatternMode;
  }
  if (value.searchMatchScope !== undefined) {
    patch.searchMatchScope = value.searchMatchScope;
  }
  if (value.searchRecursive !== undefined) {
    patch.searchRecursive = value.searchRecursive;
  }
  if (value.searchIncludeHidden !== undefined) {
    patch.searchIncludeHidden = value.searchIncludeHidden;
  }
  if (value.searchResultsSortBy !== undefined) {
    patch.searchResultsSortBy = value.searchResultsSortBy;
  }
  if (value.searchResultsSortDirection !== undefined) {
    patch.searchResultsSortDirection = value.searchResultsSortDirection;
  }
  if (value.searchResultsFilterScope !== undefined) {
    patch.searchResultsFilterScope = value.searchResultsFilterScope;
  }
  if (value.treeWidth !== undefined) {
    patch.treeWidth = value.treeWidth;
  }
  if (value.inspectorWidth !== undefined) {
    patch.inspectorWidth = value.inspectorWidth;
  }
  if (value.restoreLastVisitedFolderOnStartup !== undefined) {
    patch.restoreLastVisitedFolderOnStartup = value.restoreLastVisitedFolderOnStartup;
  }
  if (value.treeRootPath !== undefined) {
    patch.treeRootPath = value.treeRootPath;
  }
  if (value.lastVisitedPath !== undefined) {
    patch.lastVisitedPath = value.lastVisitedPath;
  }
  return patch;
}

export function resolveTerminalApplicationName(terminalApp: string | null): string {
  return terminalApp && terminalApp.trim().length > 0 ? terminalApp.trim() : "Terminal";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
