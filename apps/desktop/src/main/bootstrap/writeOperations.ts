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
};

type WriteOperationSender = {
  send: (channel: string, payload: unknown) => void;
};

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
        runtimeConflict: event.runtimeConflict,
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
    sender: WriteOperationSender;
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
    void args.execute(operationId, controller);
    return {
      operationId,
      status: "queued",
    };
  }

  function emitLocalWriteOperationEvent(event: WriteOperationProgressEvent): void {
    const sender = writeOperationSenders.get(event.operationId);
    if (sender) {
      sender.send(
        "filetrail:writeOperationProgress",
        writeOperationProgressEventSchema.parse(event),
      );
    }
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
      "copyPaste:plan": (payload: IpcRequest<"copyPaste:plan">) =>
        writeService.planCopyPaste({
          mode: payload.mode,
          sourcePaths: payload.sourcePaths,
          destinationDirectoryPath: payload.destinationDirectoryPath,
          conflictResolution: payload.conflictResolution,
        }),
      "copyPaste:start": (
        payload: IpcRequest<"copyPaste:start">,
        event: { sender: WriteOperationSender },
      ) => {
        ensureNoWriteOperationInFlight();
        const handle =
          "analysisId" in payload
            ? writeService.startCopyPaste({
                analysisId: payload.analysisId,
                policy: payload.policy,
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
        writeOperationSenders.set(handle.operationId, event.sender);
        return handle;
      },
      "copyPaste:cancel": (payload: IpcRequest<"copyPaste:cancel">) =>
        cancelWriteOperation(payload.operationId),
      "copyPaste:resolveConflict": (payload: IpcRequest<"copyPaste:resolveConflict">) => {
        const metadata = writeOperationMetadata.get(payload.operationId);
        const currentConflict = metadata?.runtimeConflicts.get(payload.conflictId) ?? null;
        if (metadata && currentConflict) {
          metadata.runtimeConflicts.set(payload.conflictId, {
            ...currentConflict,
            resolution: payload.resolution,
          });
        }
        return writeService.resolveRuntimeConflict(
          payload.operationId,
          payload.conflictId,
          payload.resolution,
        );
      },
      "writeOperation:rename": async (
        payload: IpcRequest<"writeOperation:rename">,
        event: { sender: WriteOperationSender },
      ) => {
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
      "writeOperation:createFolder": async (
        payload: IpcRequest<"writeOperation:createFolder">,
        event: { sender: WriteOperationSender },
      ) => {
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
      "writeOperation:trash": (
        payload: IpcRequest<"writeOperation:trash">,
        event: { sender: WriteOperationSender },
      ) => {
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
      "writeOperation:cancel": (payload: IpcRequest<"writeOperation:cancel">) =>
        cancelWriteOperation(payload.operationId),
    },
    shutdown() {
      writeServiceUnsubscribe();
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
