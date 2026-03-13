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
  const destinationFingerprint = await captureFingerprint(
    args.fileSystem,
    args.report.destinationDirectoryPath,
  );
  const destinationDev = destinationFingerprint.dev;
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
        sourceKind: node.node.sourceKind,
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
        destinationDev,
        totalItemCount,
        totalBytes,
        completedItemCount,
        completedByteCount,
      });
      completedItemCount = stepResult.completedItemCount;
      completedByteCount = stepResult.completedByteCount;
      itemResults.push({
        sourcePath: node.node.sourcePath,
        destinationPath: node.destinationPath,
        sourceKind: node.node.sourceKind,
        status: stepResult.itemStatus,
        error: stepResult.itemStatus === "skipped" ? null : stepResult.error,
        skipReason: stepResult.skipReason,
      });
      // Surface non-success children (failed, skipped) so they appear in the action log
      itemResults.push(...stepResult.childItems);
    } catch (error) {
      if (isAbortError(error) || args.signal.aborted) {
        cancelled = true;
        itemResults.push({
          sourcePath: node.node.sourcePath,
          destinationPath: node.destinationPath,
          sourceKind: node.node.sourceKind,
          status: "cancelled",
          error: "Operation cancelled.",
          skipReason: null,
        });
      } else {
        const message = toErrorMessage(error);
        encounteredError = error instanceof Error ? error : new Error(message);
        itemResults.push({
          sourcePath: node.node.sourcePath,
          destinationPath: node.destinationPath,
          sourceKind: node.node.sourceKind,
          status: "failed",
          error: message,
          skipReason: null,
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
    completedByteCount,
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

type ExecuteNodeResult = {
  completedItemCount: number;
  completedByteCount: number;
  itemStatus: "completed" | "skipped" | "failed";
  skipReason: "planned_conflict_policy" | "runtime_conflict_resolution" | null;
  error: string | null;
  /** Non-success child items to surface in the action log (failed, skipped). */
  childItems: CopyPasteItemResult[];
};

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
  destinationDev: number | null;
  totalItemCount: number;
  totalBytes: number | null;
  completedItemCount: number;
  completedByteCount: number;
}): Promise<ExecuteNodeResult> {
  let currentNode = args.resolvedNode;
  if (currentNode.action === "skip") {
    return {
      completedItemCount: args.completedItemCount,
      completedByteCount: args.completedByteCount,
      itemStatus: "skipped",
      skipReason: "planned_conflict_policy",
      error: null,
      childItems: [],
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
        skipReason: "runtime_conflict_resolution",
        error: null,
        childItems: [],
      };
    }
  }

  // Same-filesystem rename fast path: use rename(2) for cut operations when
  // source and destination are on the same device. Skipped for merge actions
  // (can't atomically rename a directory into an existing one).
  const canRename =
    args.mode === "cut" &&
    args.fileSystem.rename &&
    args.destinationDev !== null &&
    currentNode.node.sourceFingerprint.dev === args.destinationDev &&
    currentNode.action !== "merge";
  if (canRename) {
    const renameResult = await tryRenameForCut(currentNode, args);
    if (renameResult) {
      return renameResult;
    }
    // EXDEV fallback: rename failed, fall through to copy+delete path
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
    let hasChildFailure = false;
    const bubbledChildItems: CopyPasteItemResult[] = [];
    for (const child of currentNode.children) {
      args.signal.throwIfAborted();
      const childResult = await executeResolvedNode({
        ...args,
        resolvedNode: child,
      });
      args.completedItemCount = childResult.completedItemCount;
      args.completedByteCount = childResult.completedByteCount;
      if (childResult.itemStatus === "failed") {
        hasChildFailure = true;
      }
      // Bubble up all child items so they appear in the action log
      if (child.node.sourceKind !== "directory") {
        bubbledChildItems.push({
          sourcePath: child.node.sourcePath,
          destinationPath: child.destinationPath,
          sourceKind: child.node.sourceKind,
          status: childResult.itemStatus,
          error: childResult.itemStatus === "skipped" ? null : childResult.error,
          skipReason: childResult.skipReason,
        });
      }
      // Also bubble up any grandchild items
      bubbledChildItems.push(...childResult.childItems);
    }
    // Preserve directory timestamps AFTER children are processed, since writing
    // children into the directory updates its mtime on the real filesystem.
    if (
      currentNode.action === "create" ||
      currentNode.action === "keep_both" ||
      currentNode.action === "overwrite"
    ) {
      await preserveTimestampsIfSupported(
        args.fileSystem,
        currentNode.destinationPath,
        currentNode.node.sourceFingerprint.mtimeMs,
      );
    }
    let dirDeleteError: string | null = null;
    if (args.mode === "cut") {
      dirDeleteError = await tryRemoveEmptySourceDirectory(
        currentNode.node.sourcePath,
        currentNode.node.sourceFingerprint,
        args.fileSystem,
      );
    }
    return {
      completedItemCount: args.completedItemCount,
      completedByteCount: args.completedByteCount,
      itemStatus: dirDeleteError !== null || hasChildFailure ? "failed" : "completed",
      skipReason: null,
      error: dirDeleteError,
      childItems: bubbledChildItems,
    };
  }

  if (currentNode.action === "overwrite") {
    await removeDestinationIfPresent(currentNode.destinationPath, args.fileSystem);
  }
  if (currentNode.node.sourceKind === "symlink") {
    const linkTarget = await args.fileSystem.readlink(currentNode.node.sourcePath);
    await args.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    await args.fileSystem.symlink(linkTarget, currentNode.destinationPath);
    await preserveSymlinkTimestampsIfSupported(
      args.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mtimeMs,
    );
  } else if (args.fileSystem.copyFile) {
    await args.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    await args.fileSystem.copyFile(
      currentNode.node.sourcePath,
      currentNode.destinationPath,
    );
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
    await preserveTimestampsIfSupported(
      args.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mtimeMs,
    );
  }
  args.completedItemCount += 1;
  if (currentNode.node.sourceFingerprint.size !== null) {
    args.completedByteCount += currentNode.node.sourceFingerprint.size;
  }
  let deleteError: string | null = null;
  if (args.mode === "cut") {
    deleteError = await tryDeleteMovedSource(
      currentNode.node.sourcePath,
      currentNode.node.sourceFingerprint,
      args.fileSystem,
    );
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
    itemStatus: deleteError !== null ? "failed" : "completed",
    skipReason: null,
    error: deleteError,
    childItems: [],
  };
}

async function tryRenameForCut(
  currentNode: ResolvedCopyPasteNode,
  args: {
    fileSystem: WriteServiceFileSystem;
    signal: AbortSignal;
    report: CopyPasteAnalysisReport;
    operationId: string;
    mode: CopyPasteMode;
    emit: (event: CopyPasteProgressEvent) => void;
    totalItemCount: number;
    totalBytes: number | null;
    completedItemCount: number;
    completedByteCount: number;
  },
): Promise<ExecuteNodeResult | null> {
  try {
    if (currentNode.action === "overwrite") {
      await removeDestinationIfPresent(currentNode.destinationPath, args.fileSystem);
    }
    await args.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    await args.fileSystem.rename!(currentNode.node.sourcePath, currentNode.destinationPath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EXDEV") {
      return null; // Fall through to copy+delete path
    }
    throw error;
  }
  // Rename succeeded — count all items in the subtree as completed
  const subtreeItemCount = countExecutableSteps([currentNode]);
  args.completedItemCount += subtreeItemCount;
  args.completedByteCount += sumSubtreeBytes([currentNode]);
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
    skipReason: null,
    error: null,
    childItems: [],
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

/** Attempts to delete the source after a successful copy in cut mode.
 *  Returns null on success, or an error message if deletion failed. */
async function tryDeleteMovedSource(
  sourcePath: string,
  originalFingerprint: NodeFingerprint,
  fileSystem: WriteServiceFileSystem,
): Promise<string | null> {
  const currentFingerprint = await captureFingerprint(fileSystem, sourcePath);
  if (!currentFingerprint.exists) {
    // Source was already deleted externally — nothing to do.
    return null;
  }
  if (!fingerprintsEqual(originalFingerprint, currentFingerprint)) {
    // Source was modified since analysis — preserve it.
    return "Source was modified after copy — preserved at source.";
  }
  try {
    await fileSystem.rm(sourcePath, { recursive: false, force: false });
    return null;
  } catch (error) {
    return `Failed to remove source after copy: ${toErrorMessage(error)}`;
  }
}

/** Attempts to remove an empty source directory after its children were moved.
 *  Returns null on success or intentional skip, or an error message if rm failed. */
async function tryRemoveEmptySourceDirectory(
  sourcePath: string,
  originalFingerprint: NodeFingerprint,
  fileSystem: WriteServiceFileSystem,
): Promise<string | null> {
  const currentFingerprint = await captureFingerprint(fileSystem, sourcePath);
  if (!currentFingerprint.exists) {
    return null;
  }
  if (!canRemoveMovedSourceDirectory(originalFingerprint, currentFingerprint)) {
    return null;
  }
  const remainingEntries = await fileSystem.readdir(sourcePath);
  if (remainingEntries.length > 0) {
    return null;
  }
  try {
    await fileSystem.rm(sourcePath, { recursive: true, force: false });
    return null;
  } catch (error) {
    return `Failed to remove empty source directory: ${toErrorMessage(error)}`;
  }
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

function sumSubtreeBytes(nodes: ResolvedCopyPasteNode[]): number {
  let total = 0;
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || node.action === "skip") {
      continue;
    }
    if (node.node.sourceFingerprint.size !== null && node.node.sourceKind !== "directory") {
      total += node.node.sourceFingerprint.size;
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
  completedByteCount: number;
  totalBytes: number | null;
  items: CopyPasteItemResult[];
  status: Exclude<CopyPasteOperationStatus, "queued" | "running" | "awaiting_resolution">;
  error: string | null;
}): CopyPasteOperationResult {
  const completedItemCount = args.items.filter((item) => item.status === "completed").length;
  const failedItemCount = args.items.filter((item) => item.status === "failed").length;
  const skippedItemCount = args.items.filter((item) => item.status === "skipped").length;
  const cancelledItemCount = args.items.filter((item) => item.status === "cancelled").length;
  return {
    operationId: args.operationId,
    mode: args.mode,
    status: args.status,
    destinationDirectoryPath: args.report.destinationDirectoryPath,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    summary: {
      topLevelItemCount: args.items.length,
      totalItemCount: completedItemCount + failedItemCount + skippedItemCount + cancelledItemCount,
      completedItemCount,
      failedItemCount,
      skippedItemCount,
      cancelledItemCount,
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
  if (args.itemResults.some((item) => item.status === "skipped" || item.status === "failed")) {
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

async function preserveTimestampsIfSupported(
  fileSystem: WriteServiceFileSystem,
  destinationPath: string,
  mtimeMs: number | null | undefined,
): Promise<void> {
  if (!fileSystem.utimes || mtimeMs == null) {
    return;
  }
  try {
    await fileSystem.utimes(destinationPath, mtimeMs, mtimeMs);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOTSUP" || nodeError.code === "EOPNOTSUPP") {
      return;
    }
    throw error;
  }
}

async function preserveSymlinkTimestampsIfSupported(
  fileSystem: WriteServiceFileSystem,
  destinationPath: string,
  mtimeMs: number | null | undefined,
): Promise<void> {
  if (!fileSystem.lutimes || mtimeMs == null) {
    return;
  }
  try {
    await fileSystem.lutimes(destinationPath, mtimeMs, mtimeMs);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOTSUP" || nodeError.code === "EOPNOTSUPP") {
      return;
    }
    throw error;
  }
}
