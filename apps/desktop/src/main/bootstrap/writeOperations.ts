import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { shell } from "electron";

import {
  type ActionLogRuntimeConflict,
  type IpcRequest,
  type WriteOperationAction,
  type WriteOperationInitiator,
  type WriteOperationProgressEvent,
  type WriteOperationResult,
  isAbortError,
  writeOperationProgressEventSchema,
} from "@filetrail/contracts";
import { WRITE_OPERATION_BUSY_ERROR, type WriteService } from "@filetrail/core";
import { toErrorMessage } from "../ipc";

// Filesystem operations used by write operations (rename, mkdir, path checks).
// Callers inject an original-fs backed implementation to bypass Electron's ASAR
// patching, which would otherwise misreport .asar files as directories.
type WriteOperationFs = {
  lstat: (path: string) => Promise<{ isDirectory(): boolean }>;
  stat: (path: string) => Promise<{ isDirectory(): boolean }>;
  mkdir: (path: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
};

type WriteOperationSender = {
  send: (channel: string, payload: unknown) => void;
  isDestroyed?: () => boolean;
};

// The Electron WebContents events that mean the page that started an operation is gone:
// its renderer crashed, its window closed, or it was replaced by a reload. "did-navigate"
// only fires for a committed main-frame load (not in-page navigations, and not navigation
// attempts that will-navigate blocks), which is exactly when the old page disappears.
const SENDER_GONE_EVENTS = ["render-process-gone", "destroyed", "did-navigate"] as const;
type SenderGoneEvent = (typeof SENDER_GONE_EVENTS)[number];
type SenderLifecycleEvents = {
  on?: (event: SenderGoneEvent, listener: () => void) => unknown;
  removeListener?: (event: SenderGoneEvent, listener: () => void) => unknown;
};

const WRITE_OPERATION_PROGRESS_CHANNEL = "filetrail:writeOperationProgress";

// Answer returned to a request that isn't allowed to act on an operation (unknown id, or
// asked by a window other than the one that started it).
const REJECTED_REQUEST = { ok: false } as const;

// Holds the single write slot while a local operation is still being prepared.
const PREPARING_WRITE_OPERATION_ID = "preparing-write-operation";

type PreparedRenameOperation = {
  sourcePath: string;
  destinationPath: string;
};

type PreparedCreateFolderOperation = {
  destinationPath: string;
};

export function createWriteOperationCoordinator(
  writeService: WriteService,
  fs: WriteOperationFs,
  options: {
    recordWriteOperation?: (args: {
      action: WriteOperationAction;
      operationId: string;
      result: WriteOperationResult;
      sourcePaths: string[];
      destinationPaths: string[];
      initiator?: WriteOperationInitiator | null;
      requestedDestinationPath?: string | null;
      runtimeConflicts?: ActionLogRuntimeConflict[];
      metadata?: Record<string, string | number | boolean | null>;
    }) => Promise<void>;
  } = {},
) {
  const writeOperationSenders = new Map<string, WriteOperationSender>();
  const senderDetachers = new Map<string, () => void>();
  const copyPasteRequests = new Map<string, IpcRequest<"copyPaste:start">>();
  const localWriteOperationControllers = new Map<string, AbortController>();
  const writeOperationMetadata = new Map<
    string,
    {
      kind: string;
      action: WriteOperationAction;
      sourcePaths: string[];
      targetPaths: string[];
      initiator: WriteOperationInitiator | null;
      requestedDestinationPath: string | null;
      runtimeConflicts: Map<string, ActionLogRuntimeConflict>;
      metadata?: Record<string, string | number | boolean | null>;
    }
  >();
  let activeWriteOperationId: string | null = null;
  let localWriteOperationSequence = 0;

  // ~/.Trash is a protected system directory — it must never be deleted, renamed,
  // moved, or trashed.  Items *inside* Trash are fine; this only guards the
  // top-level Trash folder itself.
  const trashPath = resolve(homedir(), ".Trash");
  function assertNotProtectedPath(paths: readonly string[]): void {
    for (const path of paths) {
      if (resolve(path) === trashPath) {
        throw new Error("The Trash folder is a protected system directory and cannot be modified.");
      }
    }
  }

  const writeServiceUnsubscribe = writeService.subscribe((event) => {
    const request = copyPasteRequests.get(event.operationId);
    const action = request?.action ?? "paste";
    const metadata = writeOperationMetadata.get(event.operationId);
    if (event.runtimeConflict && metadata) {
      metadata.runtimeConflicts.set(
        event.runtimeConflict.conflictId,
        mergeRuntimeConflictRecord(
          metadata.runtimeConflicts.get(event.runtimeConflict.conflictId) ?? null,
          event.runtimeConflict,
        ),
      );
    }
    // A conflict answered by an earlier "do the same for the rest" never reaches the user,
    // but it still belongs in the Action Log together with the answer that was applied.
    const autoResolved = event.autoResolvedRuntimeConflict ?? null;
    if (autoResolved && metadata) {
      metadata.runtimeConflicts.set(autoResolved.conflict.conflictId, {
        ...mergeRuntimeConflictRecord(
          metadata.runtimeConflicts.get(autoResolved.conflict.conflictId) ?? null,
          autoResolved.conflict,
        ),
        resolution: autoResolved.resolution,
      });
    }
    if (isTerminalStatus(event.status)) {
      const logMetadata =
        metadata?.metadata ??
        (request
          ? {
              transferMode: event.mode,
            }
          : null);
      if (event.result && options.recordWriteOperation) {
        void options.recordWriteOperation({
          action: metadata?.action ?? action,
          operationId: event.operationId,
          result: {
            operationId: event.result.operationId,
            action,
            status: event.result.status,
            targetPath: event.result.destinationDirectoryPath,
            startedAt: event.result.startedAt,
            finishedAt: event.result.finishedAt,
            summary: event.result.summary,
            items: event.result.items,
            error: event.result.error,
          },
          sourcePaths:
            metadata?.sourcePaths ??
            (request && "sourcePaths" in request ? request.sourcePaths : []),
          destinationPaths:
            metadata?.targetPaths ??
            (request && "destinationDirectoryPath" in request
              ? [request.destinationDirectoryPath]
              : []),
          initiator: metadata?.initiator ?? request?.initiator ?? null,
          requestedDestinationPath:
            metadata?.requestedDestinationPath ??
            (request && "destinationDirectoryPath" in request
              ? request.destinationDirectoryPath
              : null),
          runtimeConflicts: metadata ? Array.from(metadata.runtimeConflicts.values()) : [],
          ...(logMetadata ? { metadata: logMetadata } : {}),
        });
      }
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
    try {
      sendProgress(
        sender,
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
          runtimeConflict: event.runtimeConflict,
          autoResolvedRuntimeConflict: autoResolved,
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
    } finally {
      if (isTerminalStatus(event.status)) {
        detachSender(event.operationId);
      }
    }
  });

  function createLocalWriteOperationId(): string {
    localWriteOperationSequence += 1;
    return `write-op-${localWriteOperationSequence}`;
  }

  function ensureNoWriteOperationInFlight(): void {
    if (activeWriteOperationId !== null) {
      throw new Error("Another write operation is already running.");
    }
  }

  // Claims the write slot before async preparation so a second request arriving
  // meanwhile is rejected instead of running alongside this one.
  async function prepareWithReservedSlot<T>(prepare: () => Promise<T>): Promise<T> {
    ensureNoWriteOperationInFlight();
    activeWriteOperationId = PREPARING_WRITE_OPERATION_ID;
    try {
      return await prepare();
    } finally {
      if (activeWriteOperationId === PREPARING_WRITE_OPERATION_ID) {
        activeWriteOperationId = null;
      }
    }
  }

  // An operation whose page crashed, closed, or reloaded can never be answered or finished
  // from the UI, so it is cancelled instead of holding the write slot forever. Listeners
  // are added only now, after the start request arrived, so a reload that happened before
  // this operation began can't reach it: an operation started by the reloaded page is safe.
  function attachSender(operationId: string, sender: WriteOperationSender): void {
    writeOperationSenders.set(operationId, sender);
    if (isSenderDestroyed(sender)) {
      // The window closed while the start request was in flight; nothing will ever
      // answer this operation.
      cancelWriteOperation(operationId);
      return;
    }
    const events = sender as SenderLifecycleEvents;
    if (typeof events.on !== "function" || typeof events.removeListener !== "function") {
      return;
    }
    const cancel = () => {
      cancelWriteOperation(operationId);
    };
    for (const eventName of SENDER_GONE_EVENTS) {
      events.on.call(sender, eventName, cancel);
    }
    senderDetachers.set(operationId, () => {
      for (const eventName of SENDER_GONE_EVENTS) {
        events.removeListener?.call(sender, eventName, cancel);
      }
    });
  }

  function detachSender(operationId: string): void {
    writeOperationSenders.delete(operationId);
    senderDetachers.get(operationId)?.();
    senderDetachers.delete(operationId);
  }

  // Cancel and conflict answers are only taken from the window that started the
  // operation; another window (such as Settings) shares the same preload API.
  function isOperationOwner(operationId: string, requester: unknown): boolean {
    const owner = writeOperationSenders.get(operationId);
    return owner !== undefined && owner === requester;
  }

  // A window can be destroyed between our check and the send, and Electron then throws
  // "Object has been destroyed". Losing a progress update for a window that's gone is fine;
  // letting the throw skip the operation's cleanup is not.
  function sendProgress(sender: WriteOperationSender, payload: WriteOperationProgressEvent): void {
    if (isSenderDestroyed(sender)) {
      return;
    }
    try {
      sender.send(WRITE_OPERATION_PROGRESS_CHANNEL, payload);
    } catch {
      // The window went away mid-send; there is no one left to tell.
    }
  }

  function queueLocalWriteOperation(args: {
    action: WriteOperationAction;
    kind: string;
    sourcePaths: string[];
    targetPaths: string[];
    metadata: Record<string, string | number | boolean | null> | null;
    sender: WriteOperationSender;
    execute: (operationId: string, controller: AbortController) => Promise<void>;
  }): { operationId: string; status: "queued" } {
    const operationId = createLocalWriteOperationId();
    const controller = new AbortController();
    activeWriteOperationId = operationId;
    localWriteOperationControllers.set(operationId, controller);
    attachSender(operationId, args.sender);
    writeOperationMetadata.set(operationId, {
      kind: args.kind,
      action: args.action,
      sourcePaths: args.sourcePaths,
      targetPaths: args.targetPaths,
      initiator: null,
      requestedDestinationPath: args.targetPaths[0] ?? null,
      runtimeConflicts: new Map(),
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
    void args
      .execute(operationId, controller)
      .catch((error: unknown) => {
        console.error("[filetrail] local write operation failed unexpectedly", error);
      })
      .finally(() => {
        // Normally the terminal event already released everything; this only matters if
        // the operation stopped without reaching one, which would otherwise lock writes.
        releaseLocalWriteOperation(operationId);
      });
    return {
      operationId,
      status: "queued",
    };
  }

  function releaseLocalWriteOperation(operationId: string): void {
    detachSender(operationId);
    writeOperationMetadata.delete(operationId);
    localWriteOperationControllers.delete(operationId);
    if (activeWriteOperationId === operationId) {
      activeWriteOperationId = null;
    }
  }

  function emitLocalWriteOperationEvent(event: WriteOperationProgressEvent): void {
    const sender = writeOperationSenders.get(event.operationId);
    // Release the operation before telling the window, so a failed send can't leave the
    // write slot held and a renderer reacting to the final event can start the next write.
    if (isTerminalStatus(event.status)) {
      const metadata = writeOperationMetadata.get(event.operationId);
      if (event.result && options.recordWriteOperation) {
        void options.recordWriteOperation({
          action: metadata?.action ?? event.action,
          operationId: event.operationId,
          result: event.result,
          sourcePaths: metadata?.sourcePaths ?? [],
          destinationPaths: metadata?.targetPaths ?? [],
          initiator: metadata?.initiator ?? null,
          requestedDestinationPath: metadata?.requestedDestinationPath ?? null,
          runtimeConflicts: metadata ? Array.from(metadata.runtimeConflicts.values()) : [],
          ...(metadata?.metadata ? { metadata: metadata.metadata } : {}),
        });
      }
      releaseLocalWriteOperation(event.operationId);
    }
    if (sender) {
      sendProgress(sender, writeOperationProgressEventSchema.parse(event));
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
    items: WriteOperationResult["items"];
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
      await fs.rename(sourcePath, destinationPath);
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
            skipReason: null,
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
            skipReason: null,
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
    assertNotProtectedPath([sourcePath]);
    const destinationName = payload.destinationName.trim();
    const destinationPath = join(dirname(sourcePath), destinationName);
    await fs.lstat(sourcePath);
    if (destinationPath === sourcePath) {
      throw new Error("Choose a different name.");
    }
    if (await pathExists(destinationPath, fs.lstat)) {
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
      await fs.mkdir(destinationPath);
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
            skipReason: null,
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
            skipReason: null,
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
    const parentStats = await fs.stat(parentDirectoryPath);
    if (!parentStats.isDirectory()) {
      throw new Error("Folder destination must be an existing directory.");
    }
    if (await pathExists(destinationPath, fs.lstat)) {
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
          skipReason: null,
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
          skipReason: null,
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
            skipReason: null,
          });
        } else {
          items.push({
            sourcePath: path,
            destinationPath: null,
            status: "failed",
            error: toErrorMessage(error),
            skipReason: null,
          });
        }
        for (const remainingPath of paths.slice(index + 1)) {
          items.push({
            sourcePath: remainingPath,
            destinationPath: null,
            status: "cancelled",
            error: "Operation stopped before this item was processed.",
            skipReason: null,
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
            ? (items.find((item) => item.status === "failed")?.error ?? "Trash failed.")
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

  async function executeDeleteImmediatelyOperation(
    payload: IpcRequest<"writeOperation:deleteImmediately">,
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
          skipReason: null,
        });
        break;
      }
      emitLocalWriteOperationEvent({
        operationId,
        action: "delete_immediately",
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
        await fs.rm(path, { recursive: true, force: true });
        completedItemCount += 1;
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "completed",
          error: null,
          skipReason: null,
        });
      } catch (error) {
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
          skipReason: null,
        });
      }
    }
    const failedItemCount = items.filter((item) => item.status === "failed").length;
    const status: WriteOperationResult["status"] = cancelled
      ? "cancelled"
      : failedItemCount === paths.length
        ? "failed"
        : failedItemCount > 0
          ? "partial"
          : "completed";
    const result: WriteOperationResult = createLocalWriteOperationResult({
      operationId,
      action: "delete_immediately",
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
            ? (items.find((item) => item.status === "failed")?.error ?? "Delete failed.")
            : null,
    });
    emitLocalWriteOperationEvent({
      operationId,
      action: "delete_immediately",
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

  function cancelWriteOperation(operationId: string): { ok: boolean } {
    const localController = localWriteOperationControllers.get(operationId);
    if (localController) {
      localController.abort();
      return { ok: true };
    }
    return writeService.cancelOperation(operationId);
  }

  return {
    handlers: {
      "copyPaste:analyzeStart": (payload: IpcRequest<"copyPaste:analyzeStart">) => {
        if (payload.mode === "cut") {
          assertNotProtectedPath(payload.sourcePaths);
        }
        ensureNoWriteOperationInFlight();
        return writeService.startCopyPasteAnalysis({
          mode: payload.mode,
          sourcePaths: payload.sourcePaths,
          destinationDirectoryPath: payload.destinationDirectoryPath,
        });
      },
      "copyPaste:analyzeGetUpdate": (payload: IpcRequest<"copyPaste:analyzeGetUpdate">) =>
        writeService.getCopyPasteAnalysisUpdate(payload.analysisId),
      "copyPaste:analyzeCancel": (payload: IpcRequest<"copyPaste:analyzeCancel">) =>
        writeService.cancelCopyPasteAnalysis(payload.analysisId),
      "copyPaste:plan": (payload: IpcRequest<"copyPaste:plan">) => {
        if (payload.mode === "cut") {
          assertNotProtectedPath(payload.sourcePaths);
        }
        return writeService.planCopyPaste({
          mode: payload.mode,
          sourcePaths: payload.sourcePaths,
          destinationDirectoryPath: payload.destinationDirectoryPath,
          conflictResolution: payload.conflictResolution,
        });
      },
      "copyPaste:start": (
        payload: IpcRequest<"copyPaste:start">,
        event: { sender: WriteOperationSender },
      ) => {
        if ("sourcePaths" in payload && payload.mode === "cut") {
          assertNotProtectedPath(payload.sourcePaths);
        }
        ensureNoWriteOperationInFlight();
        const handle =
          "analysisId" in payload
            ? writeService.startCopyPaste({
                analysisId: payload.analysisId,
                policy: payload.policy,
                ...(payload.overrides ? { overrides: payload.overrides } : {}),
              })
            : writeService.startCopyPaste({
                mode: payload.mode,
                sourcePaths: payload.sourcePaths,
                destinationDirectoryPath: payload.destinationDirectoryPath,
                conflictResolution: payload.conflictResolution,
              });
        const transferMode =
          "analysisId" in payload
            ? (writeService.getCopyPasteAnalysisUpdate(payload.analysisId).report?.mode ?? null)
            : payload.mode;
        activeWriteOperationId = handle.operationId;
        copyPasteRequests.set(handle.operationId, payload);
        writeOperationMetadata.set(handle.operationId, {
          kind: "copyPaste",
          action: payload.action,
          sourcePaths: "sourcePaths" in payload ? payload.sourcePaths : [],
          targetPaths:
            "destinationDirectoryPath" in payload ? [payload.destinationDirectoryPath] : [],
          initiator: payload.initiator ?? null,
          requestedDestinationPath:
            "destinationDirectoryPath" in payload
              ? payload.destinationDirectoryPath
              : (writeService.getCopyPasteAnalysisUpdate(payload.analysisId).report
                  ?.destinationDirectoryPath ?? null),
          runtimeConflicts: new Map(),
          metadata: {
            transferMode,
          },
        });
        attachSender(handle.operationId, event.sender);
        return handle;
      },
      "copyPaste:cancel": (
        payload: IpcRequest<"copyPaste:cancel">,
        event: { sender: WriteOperationSender },
      ) =>
        isOperationOwner(payload.operationId, event.sender)
          ? cancelWriteOperation(payload.operationId)
          : REJECTED_REQUEST,
      "copyPaste:resolveConflict": (
        payload: IpcRequest<"copyPaste:resolveConflict">,
        event: { sender: WriteOperationSender },
      ) => {
        if (!isOperationOwner(payload.operationId, event.sender)) {
          return REJECTED_REQUEST;
        }
        const response = writeService.resolveRuntimeConflict(
          payload.operationId,
          payload.conflictId,
          payload.resolution,
          payload.applyToRemaining ?? false,
        );
        // Only an answer the service accepted was applied, so only that one is logged.
        const metadata = writeOperationMetadata.get(payload.operationId);
        const currentConflict = metadata?.runtimeConflicts.get(payload.conflictId) ?? null;
        if (response.ok && metadata && currentConflict) {
          metadata.runtimeConflicts.set(payload.conflictId, {
            ...currentConflict,
            resolution: payload.resolution,
          });
        }
        return response;
      },
      "writeOperation:rename": async (
        payload: IpcRequest<"writeOperation:rename">,
        event: { sender: WriteOperationSender },
      ) => {
        const operation = await prepareWithReservedSlot(() => prepareRenameOperation(payload));
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
      "writeOperation:createFolder": async (
        payload: IpcRequest<"writeOperation:createFolder">,
        event: { sender: WriteOperationSender },
      ) => {
        const operation = await prepareWithReservedSlot(() =>
          prepareCreateFolderOperation(payload),
        );
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
      "writeOperation:trash": (
        payload: IpcRequest<"writeOperation:trash">,
        event: { sender: WriteOperationSender },
      ) => {
        assertNotProtectedPath(payload.paths);
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
      "writeOperation:deleteImmediately": (
        payload: IpcRequest<"writeOperation:deleteImmediately">,
        event: { sender: WriteOperationSender },
      ) => {
        assertNotProtectedPath(payload.paths);
        ensureNoWriteOperationInFlight();
        return queueLocalWriteOperation({
          action: "delete_immediately",
          kind: "deleteImmediately",
          sourcePaths: payload.paths,
          targetPaths: [],
          metadata: null,
          sender: event.sender,
          execute: (operationId, controller) =>
            executeDeleteImmediatelyOperation(payload, operationId, controller),
        });
      },
      "writeOperation:cancel": (
        payload: IpcRequest<"writeOperation:cancel">,
        event: { sender: WriteOperationSender },
      ) =>
        isOperationOwner(payload.operationId, event.sender)
          ? cancelWriteOperation(payload.operationId)
          : REJECTED_REQUEST,
    },
    shutdown() {
      writeServiceUnsubscribe();
      for (const detach of senderDetachers.values()) {
        detach();
      }
      senderDetachers.clear();
      writeOperationSenders.clear();
      copyPasteRequests.clear();
      localWriteOperationControllers.clear();
      writeOperationMetadata.clear();
      activeWriteOperationId = null;
    },
  };
}

function mergeRuntimeConflictRecord(
  current: ActionLogRuntimeConflict | null,
  runtimeConflict: NonNullable<WriteOperationProgressEvent["runtimeConflict"]>,
): ActionLogRuntimeConflict {
  return {
    conflictId: runtimeConflict.conflictId,
    sourcePath: runtimeConflict.sourcePath,
    destinationPath: runtimeConflict.destinationPath,
    sourceKind: runtimeConflict.sourceKind,
    destinationKind: runtimeConflict.destinationKind,
    conflictClass: runtimeConflict.conflictClass,
    reason: runtimeConflict.reason,
    resolution: current?.resolution ?? null,
  };
}

function isSenderDestroyed(sender: WriteOperationSender): boolean {
  try {
    return sender.isDestroyed?.() === true;
  } catch {
    return true;
  }
}

async function pathExists(path: string, lstatFn: WriteOperationFs["lstat"]): Promise<boolean> {
  try {
    await lstatFn(path);
    return true;
  } catch {
    return false;
  }
}

function isTerminalStatus(
  status: WriteOperationProgressEvent["status"] | WriteOperationResult["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "partial"
  );
}
