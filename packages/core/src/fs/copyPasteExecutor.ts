import { dirname } from "node:path";

import type {
  CopyPasteItemResult,
  CopyPasteMode,
  CopyPasteOperationResult,
  CopyPasteOperationStatus,
  CopyPastePlan,
  CopyPasteProgressEvent,
  InternalCopyPastePlan,
  PlannedTopLevelItem,
  RequiredCopyPasteRequest,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

export async function executeCopyPasteOperation(args: {
  operationId: string;
  request: RequiredCopyPasteRequest;
  plan: InternalCopyPastePlan;
  publicPlan: CopyPastePlan;
  fileSystem: WriteServiceFileSystem;
  now: () => Date;
  signal: AbortSignal;
  emit: (event: CopyPasteProgressEvent) => void;
}): Promise<void> {
  const startedAt = args.now().toISOString();
  const skippedResults = args.plan.items
    .filter(
      (item) =>
        item.status === "conflict" && args.request.conflictResolution === "skip",
    )
    .map(
      (item): CopyPasteItemResult => ({
        sourcePath: item.sourcePath,
        destinationPath: item.destinationPath,
        status: "skipped",
        error: "Destination already exists.",
      }),
    );
  const executableItems = args.plan.items.filter((item) => item.status === "ready");
  const totalItemCount = executableItems.reduce((sum, item) => sum + item.itemCount, 0);
  const totalBytes = args.publicPlan.summary.totalBytes;

  if (!args.publicPlan.canExecute) {
    const result = createOperationResult({
      operationId: args.operationId,
      mode: args.request.mode,
      destinationDirectoryPath: args.request.destinationDirectoryPath,
      startedAt,
      finishedAt: args.now().toISOString(),
      totalItemCount,
      totalBytes,
      completedItemCount: 0,
      completedByteCount: 0,
      items: skippedResults,
      status:
        skippedResults.length > 0 &&
        args.publicPlan.issues.length === 0 &&
        args.publicPlan.conflicts.length > 0
          ? "partial"
          : "failed",
      error: resolvePlanError(args.publicPlan),
    });
    args.emit({
      operationId: args.operationId,
      mode: args.request.mode,
      status: result.status,
      completedItemCount: result.summary.completedItemCount,
      totalItemCount,
      completedByteCount: result.summary.completedByteCount,
      totalBytes,
      currentSourcePath: null,
      currentDestinationPath: null,
      result,
    });
    return;
  }

  let completedItemCount = 0;
  let completedByteCount = 0;
  const itemResults = [...skippedResults];
  let encounteredError: Error | null = null;
  let cancelled = false;

  args.emit({
    operationId: args.operationId,
    mode: args.request.mode,
    status: "running",
    completedItemCount,
    totalItemCount,
    completedByteCount,
    totalBytes,
    currentSourcePath: null,
    currentDestinationPath: null,
    result: null,
  });

  for (const item of executableItems) {
    if (args.signal.aborted) {
      cancelled = true;
      itemResults.push({
        sourcePath: item.sourcePath,
        destinationPath: item.destinationPath,
        status: "cancelled",
        error: "Operation cancelled.",
      });
      break;
    }
    try {
      const executionProgress = await executeTopLevelItem({
        item,
        signal: args.signal,
        operationId: args.operationId,
        mode: args.request.mode,
        totalItemCount,
        totalBytes,
        startingCompletedItemCount: completedItemCount,
        startingCompletedByteCount: completedByteCount,
        fileSystem: args.fileSystem,
        emit: args.emit,
      });
      completedItemCount = executionProgress.completedItemCount;
      completedByteCount = executionProgress.completedByteCount;
      itemResults.push({
        sourcePath: item.sourcePath,
        destinationPath: item.destinationPath,
        status: "completed",
        error: null,
      });
    } catch (error) {
      if (isAbortError(error) || args.signal.aborted) {
        cancelled = true;
        itemResults.push({
          sourcePath: item.sourcePath,
          destinationPath: item.destinationPath,
          status: "cancelled",
          error: "Operation cancelled.",
        });
        break;
      }
      const message = toErrorMessage(error);
      itemResults.push({
        sourcePath: item.sourcePath,
        destinationPath: item.destinationPath,
        status: "failed",
        error: message,
      });
      encounteredError = error instanceof Error ? error : new Error(message);
      break;
    }
  }

  if (!encounteredError && !cancelled && args.request.mode === "cut") {
    for (const item of executableItems) {
      if (args.signal.aborted) {
        cancelled = true;
        break;
      }
      try {
        await args.fileSystem.rm(item.sourcePath, { recursive: true, force: false });
      } catch (error) {
        const message = toErrorMessage(error);
        itemResults.push({
          sourcePath: item.sourcePath,
          destinationPath: item.destinationPath,
          status: "failed",
          error: `Copied but unable to remove source: ${message}`,
        });
        encounteredError = error instanceof Error ? error : new Error(message);
        break;
      }
    }
  }

  const terminalStatus = resolveTerminalStatus({
    cancelled,
    encounteredError,
    completedItemCount,
    skippedItemCount: itemResults.filter((item) => item.status === "skipped").length,
    cancelledItemCount: itemResults.filter((item) => item.status === "cancelled").length,
  });
  const result = createOperationResult({
    operationId: args.operationId,
    mode: args.request.mode,
    destinationDirectoryPath: args.request.destinationDirectoryPath,
    startedAt,
    finishedAt: args.now().toISOString(),
    totalItemCount,
    totalBytes,
    completedItemCount,
    completedByteCount,
    items: itemResults,
    status: terminalStatus,
    error: encounteredError ? toErrorMessage(encounteredError) : cancelled ? "Operation cancelled." : null,
  });
  args.emit({
    operationId: args.operationId,
    mode: args.request.mode,
    status: result.status,
    completedItemCount: result.summary.completedItemCount,
    totalItemCount,
    completedByteCount: result.summary.completedByteCount,
    totalBytes,
    currentSourcePath: null,
    currentDestinationPath: null,
    result,
  });
}

export function createOperationResult(args: {
  operationId: string;
  mode: CopyPasteMode;
  destinationDirectoryPath: string;
  startedAt: string;
  finishedAt: string;
  totalItemCount: number;
  totalBytes: number | null;
  completedItemCount: number;
  completedByteCount: number;
  items: CopyPasteItemResult[];
  status: CopyPasteOperationStatus;
  error: string | null;
}): CopyPasteOperationResult {
  return {
    operationId: args.operationId,
    mode: args.mode,
    status: args.status,
    destinationDirectoryPath: args.destinationDirectoryPath,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    summary: {
      topLevelItemCount: args.items.length,
      totalItemCount: args.totalItemCount,
      completedItemCount: args.completedItemCount,
      failedItemCount: args.items.filter((item) => item.status === "failed").length,
      skippedItemCount: args.items.filter((item) => item.status === "skipped").length,
      cancelledItemCount: args.items.filter((item) => item.status === "cancelled").length,
      completedByteCount: args.completedByteCount,
      totalBytes: args.totalBytes,
    },
    items: args.items,
    error: args.error,
  };
}

export function resolvePlanError(plan: CopyPastePlan): string {
  if (plan.issues.length > 0) {
    return plan.issues[0]?.message ?? "Copy/Paste plan failed.";
  }
  if (plan.conflicts.length > 0) {
    return "Destination contains conflicting items.";
  }
  return "Copy/Paste plan failed.";
}

export function resolveTerminalStatus(args: {
  cancelled: boolean;
  encounteredError: Error | null;
  completedItemCount: number;
  skippedItemCount: number;
  cancelledItemCount: number;
}): CopyPasteOperationStatus {
  if (args.cancelled) {
    return args.completedItemCount > 0 ? "partial" : "cancelled";
  }
  if (args.encounteredError) {
    return args.completedItemCount > 0 || args.skippedItemCount > 0 ? "partial" : "failed";
  }
  if (args.skippedItemCount > 0 || args.cancelledItemCount > 0) {
    return "partial";
  }
  return "completed";
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function executeTopLevelItem(args: {
  item: PlannedTopLevelItem;
  signal: AbortSignal;
  operationId: string;
  mode: CopyPasteMode;
  totalItemCount: number;
  totalBytes: number | null;
  startingCompletedItemCount: number;
  startingCompletedByteCount: number;
  fileSystem: WriteServiceFileSystem;
  emit: (event: CopyPasteProgressEvent) => void;
}): Promise<{
  completedItemCount: number;
  completedByteCount: number;
}> {
  let completedItemCount = args.startingCompletedItemCount;
  let completedByteCount = args.startingCompletedByteCount;

  for (const step of args.item.steps) {
    args.signal.throwIfAborted();
    if (step.type === "mkdir") {
      await args.fileSystem.mkdir(step.destinationPath, { recursive: true });
    } else if (step.type === "copy_file") {
      await args.fileSystem.copyFileStream(step.sourcePath, step.destinationPath, args.signal);
      completedByteCount += step.sizeBytes;
    } else {
      await args.fileSystem.mkdir(dirname(step.destinationPath), { recursive: true });
      await args.fileSystem.symlink(step.linkTarget, step.destinationPath);
    }
    completedItemCount += 1;
    args.emit({
      operationId: args.operationId,
      mode: args.mode,
      status: "running",
      completedItemCount,
      totalItemCount: args.totalItemCount,
      completedByteCount,
      totalBytes: args.totalBytes,
      currentSourcePath: step.sourcePath,
      currentDestinationPath: step.destinationPath,
      result: null,
    });
  }

  return {
    completedItemCount,
    completedByteCount,
  };
}
