import { execFile } from "node:child_process";
import { lstat, mkdir, rename as renamePath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  app,
  clipboard,
  dialog,
  ipcMain,
  shell,
} from "electron";

import {
  type IpcRequest,
  type IpcResponse,
  type WriteOperationAction,
  type WriteOperationProgressEvent,
  type WriteOperationResult,
  writeOperationProgressEventSchema,
} from "@filetrail/contracts";
import { ExplorerWorkerClient, createWriteService, getPathSuggestions } from "@filetrail/core";
import type { AppPreferences } from "../shared/appPreferences";
import type { AppStateStore } from "./appStateStore";
import { resolveBundledFdBinaryPath } from "./fdBinary";
import { registerIpcHandlers, toErrorMessage } from "./ipc";
import { createWriteOperationLogger } from "./writeOperationLog";

let activeWorkerClient: ExplorerWorkerClient | null = null;
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
const writeOperationSenders = new Map<
  string,
  {
    send: (channel: string, payload: unknown) => void;
  }
>();
const copyPasteRequests = new Map<string, IpcRequest<"copyPaste:start">>();
const localWriteOperationControllers = new Map<string, AbortController>();
const writeOperationMetadata = new Map<
  string,
  {
    kind: string;
    action: string;
    sourcePaths: string[];
    targetPaths: string[];
    metadata?: Record<string, string | number | boolean | null>;
  }
>();
let activeWriteOperationId: string | null = null;
let localWriteOperationSequence = 0;

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
  writeServiceUnsubscribe?.();
  writeServiceUnsubscribe = writeService.subscribe((event) => {
    const request = copyPasteRequests.get(event.operationId);
    const action = request?.action ?? "paste";
    const metadata = writeOperationMetadata.get(event.operationId);
    if (isTerminalStatus(event.status)) {
      const logMetadata =
        metadata?.metadata ??
        (request
          ? {
              conflictResolution: request.conflictResolution,
              transferMode: request.mode,
            }
          : null);
      writeOperationLogger.log({
        phase: "finished",
        kind: metadata?.kind ?? "copyPaste",
        action: metadata?.action ?? event.mode,
        operationId: event.operationId,
        sourcePaths: metadata?.sourcePaths ?? request?.sourcePaths ?? [],
        targetPaths: metadata?.targetPaths ?? (request ? [request.destinationDirectoryPath] : []),
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
        ...(logMetadata ? { metadata: logMetadata } : {}),
      });
      copyPasteRequests.delete(event.operationId);
      writeOperationMetadata.delete(event.operationId);
      if (activeWriteOperationId === event.operationId) {
        activeWriteOperationId = null;
      }
    }
    const sender = writeOperationSenders.get(event.operationId);
    if (!sender) {
      return;
    }
    sender.send(
      "filetrail:writeOperationProgress",
      writeOperationProgressEventSchema.parse({
        operationId: event.operationId,
        action,
        status: event.status,
        completedItemCount: event.completedItemCount,
        totalItemCount: event.totalItemCount,
        completedByteCount: event.completedByteCount,
        totalBytes: event.totalBytes,
        currentSourcePath: event.currentSourcePath,
        currentDestinationPath: event.currentDestinationPath,
        result: event.result
          ? {
              operationId: event.result.operationId,
              action,
              status: event.result.status,
              targetPath: event.result.destinationDirectoryPath,
              startedAt: event.result.startedAt,
              finishedAt: event.result.finishedAt,
              summary: event.result.summary,
              items: event.result.items,
              error: event.result.error,
            }
          : null,
      }),
    );
    if (isTerminalStatus(event.status)) {
      writeOperationSenders.delete(event.operationId);
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
    "copyPaste:plan": (payload) =>
      writeService.planCopyPaste({
        mode: payload.mode,
        sourcePaths: payload.sourcePaths,
        destinationDirectoryPath: payload.destinationDirectoryPath,
        conflictResolution: payload.conflictResolution,
      }),
    "copyPaste:start": (payload, event) => {
      ensureNoWriteOperationInFlight();
      const handle = writeService.startCopyPaste({
        mode: payload.mode,
        sourcePaths: payload.sourcePaths,
        destinationDirectoryPath: payload.destinationDirectoryPath,
        conflictResolution: payload.conflictResolution,
      });
      activeWriteOperationId = handle.operationId;
      copyPasteRequests.set(handle.operationId, payload);
      writeOperationMetadata.set(handle.operationId, {
        kind: "copyPaste",
        action: payload.action,
        sourcePaths: payload.sourcePaths,
        targetPaths: [payload.destinationDirectoryPath],
        metadata: {
          conflictResolution: payload.conflictResolution ?? "error",
          transferMode: payload.mode,
        },
      });
      writeOperationLogger.log({
        phase: "started",
        kind: "copyPaste",
        action: payload.action,
        operationId: handle.operationId,
        sourcePaths: payload.sourcePaths,
        targetPaths: [payload.destinationDirectoryPath],
        metadata: {
          conflictResolution: payload.conflictResolution ?? "error",
          transferMode: payload.mode,
        },
      });
      writeOperationSenders.set(handle.operationId, event.sender);
      return handle;
    },
    "copyPaste:cancel": (payload) => {
      return cancelWriteOperation(payload.operationId, writeService);
    },
    "writeOperation:rename": async (payload, event) => {
      ensureNoWriteOperationInFlight();
      const operation = await prepareRenameOperation(payload);
      return queueLocalWriteOperation({
        action: "rename",
        kind: "rename",
        sourcePaths: [operation.sourcePath],
        targetPaths: [operation.destinationPath],
        metadata: null,
        sender: event.sender,
        execute: (operationId, controller) =>
          executeRenameOperation(operation, operationId, controller),
      });
    },
    "writeOperation:createFolder": async (payload, event) => {
      ensureNoWriteOperationInFlight();
      const operation = await prepareCreateFolderOperation(payload);
      return queueLocalWriteOperation({
        action: "new_folder",
        kind: "newFolder",
        sourcePaths: [],
        targetPaths: [operation.destinationPath],
        metadata: null,
        sender: event.sender,
        execute: (operationId, controller) =>
          executeCreateFolderOperation(operation, operationId, controller),
      });
    },
    "writeOperation:trash": (payload, event) => {
      ensureNoWriteOperationInFlight();
      return queueLocalWriteOperation({
        action: "trash",
        kind: "trash",
        sourcePaths: payload.paths,
        targetPaths: [],
        metadata: null,
        sender: event.sender,
        execute: (operationId, controller) =>
          executeTrashOperation(payload, operationId, controller),
      });
    },
    "writeOperation:cancel": (payload) => {
      return cancelWriteOperation(payload.operationId, writeService);
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
    "system:pickApplication": (_payload, event) => pickApplication(event),
    "system:pickDirectory": (payload, event) => pickDirectory(payload, event),
    "system:openPathsWithApplication": (payload) => openPathsWithApplication(payload),
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
  writeServiceUnsubscribe?.();
  writeServiceUnsubscribe = null;
  clearCaches();
  folderSizeJobs.clear();
  writeOperationSenders.clear();
  copyPasteRequests.clear();
  localWriteOperationControllers.clear();
  writeOperationMetadata.clear();
  activeWriteOperationId = null;
  await workerClient.close();
}

function resolveExplorerWorkerUrl(): URL {
  return new URL("./explorerWorker.js", import.meta.url);
}

function createLocalWriteOperationId(): string {
  localWriteOperationSequence += 1;
  return `write-op-${localWriteOperationSequence}`;
}

function ensureNoWriteOperationInFlight(): void {
  if (activeWriteOperationId !== null) {
    throw new Error("Another write operation is already running.");
  }
}

function queueLocalWriteOperation(args: {
  action: WriteOperationAction;
  kind: string;
  sourcePaths: string[];
  targetPaths: string[];
  metadata: Record<string, string | number | boolean | null> | null;
  sender: { send: (channel: string, payload: unknown) => void };
  execute: (operationId: string, controller: AbortController) => Promise<void>;
}): { operationId: string; status: "queued" } {
  const operationId = createLocalWriteOperationId();
  const controller = new AbortController();
  activeWriteOperationId = operationId;
  localWriteOperationControllers.set(operationId, controller);
  writeOperationSenders.set(operationId, args.sender);
  writeOperationMetadata.set(operationId, {
    kind: args.kind,
    action: args.action,
    sourcePaths: args.sourcePaths,
    targetPaths: args.targetPaths,
    ...(args.metadata ? { metadata: args.metadata } : {}),
  });
  writeOperationLogger.log({
    phase: "started",
    kind: args.kind,
    action: args.action,
    operationId,
    sourcePaths: args.sourcePaths,
    targetPaths: args.targetPaths,
    ...(args.metadata ? { metadata: args.metadata } : {}),
  });
  emitLocalWriteOperationEvent({
    operationId,
    action: args.action,
    status: "queued",
    completedItemCount: 0,
    totalItemCount: 0,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    result: null,
  });
  void args.execute(operationId, controller);
  return {
    operationId,
    status: "queued",
  };
}

function emitLocalWriteOperationEvent(
  event: WriteOperationProgressEvent,
): void {
  const sender = writeOperationSenders.get(event.operationId);
  if (sender) {
    sender.send("filetrail:writeOperationProgress", writeOperationProgressEventSchema.parse(event));
  }
  if (isTerminalStatus(event.status)) {
    const metadata = writeOperationMetadata.get(event.operationId);
    writeOperationLogger.log({
      phase: "finished",
      kind: metadata?.kind ?? event.action,
      action: metadata?.action ?? event.action,
      operationId: event.operationId,
      sourcePaths: metadata?.sourcePaths ?? [],
      targetPaths: metadata?.targetPaths ?? [],
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
      ...(metadata?.metadata ? { metadata: metadata.metadata } : {}),
    });
    writeOperationSenders.delete(event.operationId);
    writeOperationMetadata.delete(event.operationId);
    localWriteOperationControllers.delete(event.operationId);
    if (activeWriteOperationId === event.operationId) {
      activeWriteOperationId = null;
    }
  }
}

function createLocalWriteOperationResult(args: {
  operationId: string;
  action: WriteOperationAction;
  targetPath: string | null;
  startedAt: string;
  finishedAt: string;
  totalItemCount: number;
  completedItemCount: number;
  items: Array<{
    sourcePath: string | null;
    destinationPath: string | null;
    status: "completed" | "skipped" | "failed" | "cancelled";
    error: string | null;
  }>;
  status: "completed" | "failed" | "cancelled" | "partial";
  error: string | null;
}): WriteOperationResult {
  return {
    operationId: args.operationId,
    action: args.action,
    status: args.status,
    targetPath: args.targetPath,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    summary: {
      topLevelItemCount: args.items.length,
      totalItemCount: args.totalItemCount,
      completedItemCount: args.completedItemCount,
      failedItemCount: args.items.filter((item) => item.status === "failed").length,
      skippedItemCount: args.items.filter((item) => item.status === "skipped").length,
      cancelledItemCount: args.items.filter((item) => item.status === "cancelled").length,
      completedByteCount: 0,
      totalBytes: null,
    },
    items: args.items,
    error: args.error,
  };
}

type PreparedRenameOperation = {
  sourcePath: string;
  destinationPath: string;
};

type PreparedCreateFolderOperation = {
  destinationPath: string;
};

function resolveLocalTerminalStatus(args: {
  cancelled: boolean;
  completedItemCount: number;
  failedItemCount: number;
}): "completed" | "failed" | "cancelled" | "partial" {
  if (args.cancelled) {
    return args.completedItemCount > 0 ? "partial" : "cancelled";
  }
  if (args.failedItemCount > 0) {
    return args.completedItemCount > 0 ? "partial" : "failed";
  }
  return "completed";
}

async function executeRenameOperation(
  operation: PreparedRenameOperation,
  operationId: string,
  controller: AbortController,
): Promise<void> {
  const { sourcePath, destinationPath } = operation;
  const startedAt = new Date().toISOString();
  try {
    controller.signal.throwIfAborted();
    emitLocalWriteOperationEvent({
      operationId,
      action: "rename",
      status: "running",
      completedItemCount: 0,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: sourcePath,
      currentDestinationPath: destinationPath,
      result: null,
    });
    controller.signal.throwIfAborted();
    await renamePath(sourcePath, destinationPath);
    const result = createLocalWriteOperationResult({
      operationId,
      action: "rename",
      targetPath: destinationPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: 1,
      completedItemCount: 1,
      items: [
        {
          sourcePath,
          destinationPath,
          status: "completed",
          error: null,
        },
      ],
      status: "completed",
      error: null,
    });
    emitLocalWriteOperationEvent({
      operationId,
      action: "rename",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: sourcePath,
      currentDestinationPath: destinationPath,
      result,
    });
  } catch (error) {
    const cancelled = isAbortError(error) || controller.signal.aborted;
    const result = createLocalWriteOperationResult({
      operationId,
      action: "rename",
      targetPath: destinationPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: 1,
      completedItemCount: 0,
      items: [
        {
          sourcePath,
          destinationPath,
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? "Operation cancelled." : toErrorMessage(error),
        },
      ],
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? "Operation cancelled." : toErrorMessage(error),
    });
    emitLocalWriteOperationEvent({
      operationId,
      action: "rename",
      status: result.status,
      completedItemCount: 0,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: sourcePath,
      currentDestinationPath: destinationPath,
      result,
    });
  }
}

async function prepareRenameOperation(
  payload: IpcRequest<"writeOperation:rename">,
): Promise<PreparedRenameOperation> {
  const sourcePath = resolve(payload.sourcePath);
  const destinationName = payload.destinationName.trim();
  const destinationPath = join(dirname(sourcePath), destinationName);
  await lstat(sourcePath);
  if (destinationPath === sourcePath) {
    throw new Error("Choose a different name.");
  }
  if (await pathExists(destinationPath)) {
    throw new Error(`An item named "${destinationName}" already exists.`);
  }
  return {
    sourcePath,
    destinationPath,
  };
}

async function executeCreateFolderOperation(
  operation: PreparedCreateFolderOperation,
  operationId: string,
  controller: AbortController,
): Promise<void> {
  const { destinationPath } = operation;
  const startedAt = new Date().toISOString();
  try {
    controller.signal.throwIfAborted();
    emitLocalWriteOperationEvent({
      operationId,
      action: "new_folder",
      status: "running",
      completedItemCount: 0,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: destinationPath,
      result: null,
    });
    controller.signal.throwIfAborted();
    await mkdir(destinationPath);
    const result = createLocalWriteOperationResult({
      operationId,
      action: "new_folder",
      targetPath: destinationPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: 1,
      completedItemCount: 1,
      items: [
        {
          sourcePath: null,
          destinationPath,
          status: "completed",
          error: null,
        },
      ],
      status: "completed",
      error: null,
    });
    emitLocalWriteOperationEvent({
      operationId,
      action: "new_folder",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: destinationPath,
      result,
    });
  } catch (error) {
    const cancelled = isAbortError(error) || controller.signal.aborted;
    const result = createLocalWriteOperationResult({
      operationId,
      action: "new_folder",
      targetPath: destinationPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: 1,
      completedItemCount: 0,
      items: [
        {
          sourcePath: null,
          destinationPath,
          status: cancelled ? "cancelled" : "failed",
          error: cancelled ? "Operation cancelled." : toErrorMessage(error),
        },
      ],
      status: cancelled ? "cancelled" : "failed",
      error: cancelled ? "Operation cancelled." : toErrorMessage(error),
    });
    emitLocalWriteOperationEvent({
      operationId,
      action: "new_folder",
      status: result.status,
      completedItemCount: 0,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: destinationPath,
      result,
    });
  }
}

async function prepareCreateFolderOperation(
  payload: IpcRequest<"writeOperation:createFolder">,
): Promise<PreparedCreateFolderOperation> {
  const parentDirectoryPath = resolve(payload.parentDirectoryPath);
  const folderName = payload.folderName.trim();
  const destinationPath = join(parentDirectoryPath, folderName);
  const parentStats = await stat(parentDirectoryPath);
  if (!parentStats.isDirectory()) {
    throw new Error("Folder destination must be an existing directory.");
  }
  if (await pathExists(destinationPath)) {
    throw new Error(`An item named "${folderName}" already exists.`);
  }
  return { destinationPath };
}

async function executeTrashOperation(
  payload: IpcRequest<"writeOperation:trash">,
  operationId: string,
  controller: AbortController,
): Promise<void> {
  const paths = payload.paths.map((path) => resolve(path));
  const startedAt = new Date().toISOString();
  const items: WriteOperationResult["items"] = [];
  let completedItemCount = 0;
  let cancelled = false;
  for (const [index, path] of paths.entries()) {
    if (controller.signal.aborted) {
      cancelled = true;
      items.push({
        sourcePath: path,
        destinationPath: null,
        status: "cancelled",
        error: "Operation cancelled.",
      });
      break;
    }
    emitLocalWriteOperationEvent({
      operationId,
      action: "trash",
      status: "running",
      completedItemCount,
      totalItemCount: paths.length,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: path,
      currentDestinationPath: null,
      result: null,
    });
    try {
      await shell.trashItem(path);
      completedItemCount += 1;
      items.push({
        sourcePath: path,
        destinationPath: null,
        status: "completed",
        error: null,
      });
    } catch (error) {
      const isCancelled = isAbortError(error) || controller.signal.aborted;
      if (isCancelled) {
        cancelled = true;
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "cancelled",
          error: "Operation cancelled.",
        });
      } else {
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "failed",
          error: toErrorMessage(error),
        });
      }
      for (const remainingPath of paths.slice(index + 1)) {
        items.push({
          sourcePath: remainingPath,
          destinationPath: null,
          status: "cancelled",
          error: "Operation stopped before this item was processed.",
        });
      }
      break;
    }
  }
  const failedItemCount = items.filter((item) => item.status === "failed").length;
  const status = resolveLocalTerminalStatus({
    cancelled,
    completedItemCount,
    failedItemCount,
  });
  const result = createLocalWriteOperationResult({
    operationId,
    action: "trash",
    targetPath: null,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalItemCount: paths.length,
    completedItemCount,
    items,
    status,
    error:
      status === "cancelled"
        ? "Operation cancelled."
        : failedItemCount > 0
          ? items.find((item) => item.status === "failed")?.error ?? "Trash failed."
          : null,
  });
  emitLocalWriteOperationEvent({
    operationId,
    action: "trash",
    status,
    completedItemCount,
    totalItemCount: paths.length,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    result,
  });
}

function cancelWriteOperation(
  operationId: string,
  writeService: ReturnType<typeof createWriteService>,
): { ok: boolean } {
  const metadata = writeOperationMetadata.get(operationId);
  if (metadata) {
    writeOperationLogger.log({
      phase: "cancel_requested",
      kind: metadata.kind,
      action: metadata.action,
      operationId,
      sourcePaths: metadata.sourcePaths,
      targetPaths: metadata.targetPaths,
      ...(metadata.metadata ? { metadata: metadata.metadata } : {}),
    });
  }
  const localController = localWriteOperationControllers.get(operationId);
  if (localController) {
    localController.abort();
    return { ok: true };
  }
  return writeService.cancelOperation(operationId);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
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

async function pickApplication(
  event: Pick<IpcMainInvokeEvent, "sender">,
): Promise<IpcResponse<"system:pickApplication">> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions: OpenDialogOptions = {
    title: "Choose Application",
    buttonLabel: "Choose App",
    defaultPath: "/Applications",
    properties: ["openFile"],
    filters: [
      {
        name: "Applications",
        extensions: ["app"],
      },
    ],
  };
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  const appPath = result.canceled ? null : (result.filePaths[0] ?? null);
  const appName = appPath ? resolveApplicationDisplayName(appPath) : null;
  return {
    canceled: result.canceled,
    appPath,
    appName,
  };
}

async function pickDirectory(
  payload: IpcRequest<"system:pickDirectory">,
  event: Pick<IpcMainInvokeEvent, "sender">,
): Promise<IpcResponse<"system:pickDirectory">> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions: OpenDialogOptions = {
    title: "Choose Folder",
    buttonLabel: "Choose Folder",
    properties: ["openDirectory", "createDirectory"],
  };
  if (payload.defaultPath) {
    dialogOptions.defaultPath = payload.defaultPath;
  }
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  return {
    canceled: result.canceled,
    path: result.canceled ? null : (result.filePaths[0] ?? null),
  };
}

export async function openPathsWithApplication(
  payload: IpcRequest<"system:openPathsWithApplication">,
  runOpenCommand: (applicationPath: string, paths: string[]) => Promise<void> = (
    applicationPath,
    paths,
  ) => execFileAsync("open", ["-a", applicationPath, ...paths]).then(() => undefined),
): Promise<IpcResponse<"system:openPathsWithApplication">> {
  try {
    await runOpenCommand(payload.applicationPath, [...payload.paths]);
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

async function openInTerminal(
  payload: IpcRequest<"system:openInTerminal">,
  terminalApp: { appPath: string; appName: string } | null,
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
  if (value.highlightHoveredItems !== undefined) {
    patch.highlightHoveredItems = value.highlightHoveredItems;
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
  if (value.defaultTextEditor !== undefined) {
    patch.defaultTextEditor = value.defaultTextEditor;
  }
  if (value.openWithApplications !== undefined) {
    patch.openWithApplications = value.openWithApplications;
  }
  if (value.fileActivationAction !== undefined) {
    patch.fileActivationAction = value.fileActivationAction;
  }
  if (value.openItemLimit !== undefined) {
    patch.openItemLimit = value.openItemLimit;
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

export function resolveTerminalApplicationName(
  terminalApp: { appPath: string; appName: string } | null,
): string {
  if (!terminalApp) {
    return "Terminal";
  }
  const appPath = terminalApp.appPath.trim();
  return appPath.length > 0 ? appPath : "Terminal";
}

export function resolveApplicationDisplayName(applicationPath: string): string {
  const trimmed = applicationPath.trim();
  const bundleName = basename(trimmed);
  return bundleName.toLowerCase().endsWith(".app")
    ? bundleName.slice(0, -4) || trimmed
    : bundleName || trimmed;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

function isTerminalStatus(
  status: WriteOperationProgressEvent["status"] | WriteOperationResult["status"],
): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "partial"
  );
}
