import { basename, dirname } from "node:path";

import { isAbortError } from "@filetrail/contracts";

import { captureFingerprint, fingerprintsEqual } from "./copyPasteFingerprint";
import { type ResolvedCopyPasteNode, resolveSingleNodeWithAction } from "./copyPastePolicy";
import type {
  CopyPasteAnalysisReport,
  CopyPasteItemResult,
  CopyPasteMode,
  CopyPasteOperationResult,
  CopyPasteOperationStatus,
  CopyPastePolicy,
  CopyPasteProgressEvent,
  CopyPasteRuntimeConflict,
  CopyPasteRuntimeResolutionAction,
  NodeFingerprint,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

export async function executeCopyPasteFromAnalysis(args: {
  operationId: string;
  report: CopyPasteAnalysisReport;
  mode: CopyPasteMode;
  policy: CopyPastePolicy;
  fileSystem: WriteServiceFileSystem;
  now: () => Date;
  signal: AbortSignal;
  resolvedNodes: ResolvedCopyPasteNode[];
  emit: (event: CopyPasteProgressEvent) => void;
  requestResolution: (
    conflict: CopyPasteRuntimeConflict,
  ) => Promise<CopyPasteRuntimeResolutionAction | null>;
}): Promise<void> {
  const startedAt = args.now().toISOString();
  let completedItemCount = 0;
  let completedByteCount = 0;
  const totalItemCount = countExecutableSteps(args.resolvedNodes);
  const totalBytes = args.report.summary.totalBytes;
  const itemResults: CopyPasteItemResult[] = [];
  let encounteredError: Error | null = null;
  let cancelled = false;

  args.emit({
    operationId: args.operationId,
    analysisId: args.report.analysisId,
    mode: args.mode,
    status: "running",
    completedItemCount: 0,
    totalItemCount,
    completedByteCount: 0,
    totalBytes,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result: null,
  });

  for (const node of args.resolvedNodes) {
    if (args.signal.aborted) {
      cancelled = true;
      itemResults.push({
        sourcePath: node.node.sourcePath,
        destinationPath: node.destinationPath,
        status: "cancelled",
        error: "Operation cancelled.",
      });
      break;
    }
    try {
      const stepResult = await executeResolvedNode({
        resolvedNode: node,
        report: args.report,
        fileSystem: args.fileSystem,
        signal: args.signal,
        now: args.now,
        emit: args.emit,
        requestResolution: args.requestResolution,
        operationId: args.operationId,
        mode: args.mode,
        totalItemCount,
        totalBytes,
        completedItemCount,
        completedByteCount,
      });
      completedItemCount = stepResult.completedItemCount;
      completedByteCount = stepResult.completedByteCount;
      if (args.mode === "cut" && stepResult.itemStatus !== "skipped") {
        await cleanupMovedSourceNode(node, args.fileSystem);
      }
      itemResults.push({
        sourcePath: node.node.sourcePath,
        destinationPath: node.destinationPath,
        status: stepResult.itemStatus,
        error: stepResult.itemStatus === "skipped" ? "Skipped by conflict policy." : null,
      });
    } catch (error) {
      if (isAbortError(error) || args.signal.aborted) {
        cancelled = true;
        itemResults.push({
          sourcePath: node.node.sourcePath,
          destinationPath: node.destinationPath,
          status: "cancelled",
          error: "Operation cancelled.",
        });
      } else {
        const message = toErrorMessage(error);
        encounteredError = error instanceof Error ? error : new Error(message);
        itemResults.push({
          sourcePath: node.node.sourcePath,
          destinationPath: node.destinationPath,
          status: "failed",
          error: message,
        });
      }
      break;
    }
  }

  const status = resolveTerminalStatus({
    cancelled,
    encounteredError,
    itemResults,
  });
  const result = createOperationResult({
    operationId: args.operationId,
    report: args.report,
    mode: args.mode,
    startedAt,
    finishedAt: args.now().toISOString(),
    completedItemCount,
    completedByteCount,
    totalItemCount,
    totalBytes,
    items: itemResults,
    status,
    error:
      encounteredError !== null
        ? toErrorMessage(encounteredError)
        : cancelled
          ? "Operation cancelled."
          : null,
  });
  args.emit({
    operationId: args.operationId,
    analysisId: args.report.analysisId,
    mode: args.mode,
    status,
    completedItemCount,
    totalItemCount,
    completedByteCount,
    totalBytes,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result,
  });
}

async function executeResolvedNode(args: {
  resolvedNode: ResolvedCopyPasteNode;
  report: CopyPasteAnalysisReport;
  fileSystem: WriteServiceFileSystem;
  signal: AbortSignal;
  now: () => Date;
  emit: (event: CopyPasteProgressEvent) => void;
  requestResolution: (
    conflict: CopyPasteRuntimeConflict,
  ) => Promise<CopyPasteRuntimeResolutionAction | null>;
  operationId: string;
  mode: CopyPasteMode;
  totalItemCount: number;
  totalBytes: number | null;
  completedItemCount: number;
  completedByteCount: number;
}): Promise<{
  completedItemCount: number;
  completedByteCount: number;
  itemStatus: "completed" | "skipped";
}> {
  let currentNode = args.resolvedNode;
  if (currentNode.action === "skip") {
    return {
      completedItemCount: args.completedItemCount,
      completedByteCount: args.completedByteCount,
      itemStatus: "skipped",
    };
  }

  const runtimeConflict = await detectRuntimeConflict(
    currentNode,
    args.report.analysisId,
    args.fileSystem,
  );
  if (runtimeConflict) {
    args.emit({
      operationId: args.operationId,
      analysisId: args.report.analysisId,
      mode: args.mode,
      status: "awaiting_resolution",
      completedItemCount: args.completedItemCount,
      totalItemCount: args.totalItemCount,
      completedByteCount: args.completedByteCount,
      totalBytes: args.totalBytes,
      currentSourcePath: currentNode.node.sourcePath,
      currentDestinationPath: currentNode.destinationPath,
      runtimeConflict,
      result: null,
    });
    const resolution = await args.requestResolution(runtimeConflict);
    args.signal.throwIfAborted();
    if (!resolution) {
      throw new Error("Runtime conflict was not resolved.");
    }
    currentNode = await resolveSingleNodeWithAction({
      node: currentNode.node,
      action: resolution,
      fileSystem: args.fileSystem,
    });
    if (currentNode.action === "skip") {
      return {
        completedItemCount: args.completedItemCount,
        completedByteCount: args.completedByteCount,
        itemStatus: "skipped",
      };
    }
  }

  if (currentNode.node.sourceKind === "directory") {
    if (
      currentNode.action === "create" ||
      currentNode.action === "keep_both" ||
      currentNode.action === "overwrite"
    ) {
      if (currentNode.action === "overwrite") {
        await removeDestinationIfPresent(currentNode.destinationPath, args.fileSystem);
      }
      await args.fileSystem.mkdir(currentNode.destinationPath, { recursive: true });
      await preserveModeIfSupported(
        args.fileSystem,
        currentNode.destinationPath,
        currentNode.node.sourceFingerprint.mode,
      );
      args.completedItemCount += 1;
      args.emit({
        operationId: args.operationId,
        analysisId: args.report.analysisId,
        mode: args.mode,
        status: "running",
        completedItemCount: args.completedItemCount,
        totalItemCount: args.totalItemCount,
        completedByteCount: args.completedByteCount,
        totalBytes: args.totalBytes,
        currentSourcePath: currentNode.node.sourcePath,
        currentDestinationPath: currentNode.destinationPath,
        runtimeConflict: null,
        result: null,
      });
    }
    for (const child of currentNode.children) {
      const childResult = await executeResolvedNode({
        ...args,
        resolvedNode: child,
      });
      args.completedItemCount = childResult.completedItemCount;
      args.completedByteCount = childResult.completedByteCount;
    }
    return {
      completedItemCount: args.completedItemCount,
      completedByteCount: args.completedByteCount,
      itemStatus: "completed",
    };
  }

  if (currentNode.action === "overwrite") {
    await removeDestinationIfPresent(currentNode.destinationPath, args.fileSystem);
  }
  if (currentNode.node.sourceKind === "symlink") {
    const linkTarget = await args.fileSystem.readlink(currentNode.node.sourcePath);
    await args.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    await args.fileSystem.symlink(linkTarget, currentNode.destinationPath);
  } else {
    await args.fileSystem.copyFileStream(
      currentNode.node.sourcePath,
      currentNode.destinationPath,
      args.signal,
    );
    await preserveModeIfSupported(
      args.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mode,
    );
  }
  args.completedItemCount += 1;
  if (currentNode.node.sourceFingerprint.size !== null) {
    args.completedByteCount += currentNode.node.sourceFingerprint.size;
  }
  args.emit({
    operationId: args.operationId,
    analysisId: args.report.analysisId,
    mode: args.mode,
    status: "running",
    completedItemCount: args.completedItemCount,
    totalItemCount: args.totalItemCount,
    completedByteCount: args.completedByteCount,
    totalBytes: args.totalBytes,
    currentSourcePath: currentNode.node.sourcePath,
    currentDestinationPath: currentNode.destinationPath,
    runtimeConflict: null,
    result: null,
  });
  return {
    completedItemCount: args.completedItemCount,
    completedByteCount: args.completedByteCount,
    itemStatus: "completed",
  };
}

async function detectRuntimeConflict(
  resolvedNode: ResolvedCopyPasteNode,
  analysisId: string,
  fileSystem: WriteServiceFileSystem,
): Promise<CopyPasteRuntimeConflict | null> {
  const currentSourceFingerprint = await captureFingerprint(
    fileSystem,
    resolvedNode.node.sourcePath,
  );
  const currentDestinationFingerprint = await captureFingerprint(
    fileSystem,
    resolvedNode.destinationPath,
  );

  if (!fingerprintsEqual(resolvedNode.node.sourceFingerprint, currentSourceFingerprint)) {
    return {
      conflictId: `runtime-${resolvedNode.node.id}-source`,
      analysisId,
      sourcePath: resolvedNode.node.sourcePath,
      destinationPath: resolvedNode.destinationPath,
      sourceKind: resolvedNode.node.sourceKind,
      destinationKind: resolvedNode.node.destinationKind,
      conflictClass: resolvedNode.node.conflictClass ?? "file_conflict",
      reason: currentSourceFingerprint.exists ? "source_changed" : "source_deleted",
      sourceFingerprint: resolvedNode.node.sourceFingerprint,
      destinationFingerprint: resolvedNode.node.destinationFingerprint,
      currentSourceFingerprint,
      currentDestinationFingerprint,
    };
  }

  if (
    (resolvedNode.action === "create" || resolvedNode.action === "keep_both") &&
    currentDestinationFingerprint.exists &&
    currentDestinationFingerprint.kind !== "missing"
  ) {
    return {
      conflictId: `runtime-${resolvedNode.node.id}-destination`,
      analysisId,
      sourcePath: resolvedNode.node.sourcePath,
      destinationPath: resolvedNode.destinationPath,
      sourceKind: resolvedNode.node.sourceKind,
      destinationKind: currentDestinationFingerprint.kind,
      conflictClass:
        currentDestinationFingerprint.kind === "directory" &&
        resolvedNode.node.sourceKind === "directory"
          ? "directory_conflict"
          : currentDestinationFingerprint.kind === resolvedNode.node.sourceKind &&
              currentDestinationFingerprint.kind !== "directory"
            ? "file_conflict"
            : "type_mismatch",
      reason: "destination_created",
      sourceFingerprint: resolvedNode.node.sourceFingerprint,
      destinationFingerprint: resolvedNode.node.destinationFingerprint,
      currentSourceFingerprint,
      currentDestinationFingerprint,
    };
  }

  if (
    resolvedNode.node.conflictClass !== null &&
    resolvedNode.action !== "keep_both" &&
    !fingerprintsEqual(resolvedNode.node.destinationFingerprint, currentDestinationFingerprint)
  ) {
    return {
      conflictId: `runtime-${resolvedNode.node.id}-destination`,
      analysisId,
      sourcePath: resolvedNode.node.sourcePath,
      destinationPath: resolvedNode.destinationPath,
      sourceKind: resolvedNode.node.sourceKind,
      destinationKind: currentDestinationFingerprint.kind,
      conflictClass: resolvedNode.node.conflictClass,
      reason: !currentDestinationFingerprint.exists ? "destination_deleted" : "destination_changed",
      sourceFingerprint: resolvedNode.node.sourceFingerprint,
      destinationFingerprint: resolvedNode.node.destinationFingerprint,
      currentSourceFingerprint,
      currentDestinationFingerprint,
    };
  }
  return null;
}

async function removeDestinationIfPresent(
  destinationPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<void> {
  const destinationFingerprint = await captureFingerprint(fileSystem, destinationPath);
  if (!destinationFingerprint.exists) {
    return;
  }
  await fileSystem.rm(destinationPath, {
    recursive: destinationFingerprint.kind === "directory",
    force: true,
  });
}

async function cleanupMovedSourceNode(
  resolvedNode: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
): Promise<void> {
  if (resolvedNode.action === "skip") {
    return;
  }
  if (resolvedNode.node.sourceKind === "directory") {
    for (const child of resolvedNode.children) {
      await cleanupMovedSourceNode(child, fileSystem);
    }
    const currentSourceFingerprint = await captureFingerprint(
      fileSystem,
      resolvedNode.node.sourcePath,
    );
    if (
      !canRemoveMovedSourceDirectory(resolvedNode.node.sourceFingerprint, currentSourceFingerprint)
    ) {
      return;
    }
    try {
      const remainingEntries = await fileSystem.readdir(resolvedNode.node.sourcePath);
      if (remainingEntries.length > 0) {
        return;
      }
    } catch {
      return;
    }
    try {
      await fileSystem.rm(resolvedNode.node.sourcePath, {
        recursive: true,
        force: false,
      });
    } catch {
      // Preserve partially moved directories when skipped or changed children remain.
    }
    return;
  }
  const currentSourceFingerprint = await captureFingerprint(
    fileSystem,
    resolvedNode.node.sourcePath,
  );
  if (!fingerprintsEqual(resolvedNode.node.sourceFingerprint, currentSourceFingerprint)) {
    return;
  }
  await fileSystem.rm(resolvedNode.node.sourcePath, {
    recursive: false,
    force: false,
  });
}

function canRemoveMovedSourceDirectory(
  originalFingerprint: NodeFingerprint,
  currentFingerprint: NodeFingerprint,
): boolean {
  return (
    currentFingerprint.exists &&
    currentFingerprint.kind === "directory" &&
    originalFingerprint.kind === "directory" &&
    originalFingerprint.mode === currentFingerprint.mode &&
    originalFingerprint.symlinkTarget === currentFingerprint.symlinkTarget &&
    (originalFingerprint.ino === null ||
      currentFingerprint.ino === null ||
      originalFingerprint.ino === currentFingerprint.ino) &&
    (originalFingerprint.dev === null ||
      currentFingerprint.dev === null ||
      originalFingerprint.dev === currentFingerprint.dev)
  );
}

function countExecutableSteps(nodes: ResolvedCopyPasteNode[]): number {
  let total = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || node.action === "skip") {
      continue;
    }
    if (node.node.sourceKind === "directory") {
      if (node.action !== "merge") {
        total += 1;
      }
    } else {
      total += 1;
    }
    stack.push(...node.children);
  }
  return total;
}

function createOperationResult(args: {
  operationId: string;
  report: CopyPasteAnalysisReport;
  mode: CopyPasteMode;
  startedAt: string;
  finishedAt: string;
  completedItemCount: number;
  completedByteCount: number;
  totalItemCount: number;
  totalBytes: number | null;
  items: CopyPasteItemResult[];
  status: Exclude<CopyPasteOperationStatus, "queued" | "running" | "awaiting_resolution">;
  error: string | null;
}): CopyPasteOperationResult {
  return {
    operationId: args.operationId,
    mode: args.mode,
    status: args.status,
    destinationDirectoryPath: args.report.destinationDirectoryPath,
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

function resolveTerminalStatus(args: {
  cancelled: boolean;
  encounteredError: Error | null;
  itemResults: CopyPasteItemResult[];
}): Exclude<CopyPasteOperationStatus, "queued" | "running" | "awaiting_resolution"> {
  if (args.cancelled) {
    return args.itemResults.some((item) => item.status === "completed") ? "partial" : "cancelled";
  }
  if (args.encounteredError) {
    return args.itemResults.some((item) => item.status === "completed" || item.status === "skipped")
      ? "partial"
      : "failed";
  }
  if (args.itemResults.some((item) => item.status === "skipped")) {
    return "partial";
  }
  return "completed";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function preserveModeIfSupported(
  fileSystem: WriteServiceFileSystem,
  destinationPath: string,
  mode: number | null,
): Promise<void> {
  if (!fileSystem.chmod || mode === null) {
    return;
  }
  try {
    await fileSystem.chmod(destinationPath, mode);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOTSUP" || nodeError.code === "EOPNOTSUPP") {
      return;
    }
    throw error;
  }
}
