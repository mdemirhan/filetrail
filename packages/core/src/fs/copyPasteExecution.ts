import { basename, dirname } from "node:path";

import { isAbortError } from "@filetrail/contracts";

import { captureFingerprint, fingerprintsEqual } from "./copyPasteFingerprint";
import { type ResolvedCopyPasteNode, resolveSingleNodeWithAction } from "./copyPastePolicy";
import type {
  CopyPasteAnalysisReport,
  CopyPasteConflictClass,
  CopyPasteItemResult,
  CopyPasteMode,
  CopyPasteNodeKind,
  CopyPasteOperationResult,
  CopyPasteOperationStatus,
  CopyPastePolicy,
  CopyPasteProgressEvent,
  CopyPasteRuntimeConflict,
  CopyPasteRuntimeResolutionAction,
  NodeFingerprint,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

const NOT_STARTED_MESSAGE = "Not started because the operation was stopped.";

type ExecutionContext = {
  operationId: string;
  report: CopyPasteAnalysisReport;
  mode: CopyPasteMode;
  policy: CopyPastePolicy;
  fileSystem: WriteServiceFileSystem;
  signal: AbortSignal;
  emit: (event: CopyPasteProgressEvent) => void;
  requestResolution: (
    conflict: CopyPasteRuntimeConflict,
  ) => Promise<CopyPasteRuntimeResolutionAction | null>;
  autoResolve: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
  destinationDev: number | null;
  totalItemCount: number;
  totalBytes: number | null;
  // Shared by every step so progress survives an item that fails half way.
  progress: { completedItemCount: number; completedByteCount: number };
};

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
  // An answer already given for "the rest of this operation", used without asking again.
  autoResolve?: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
}): Promise<void> {
  const startedAt = args.now().toISOString();
  const destinationFingerprint = await captureFingerprint(
    args.fileSystem,
    args.report.destinationDirectoryPath,
  );
  const context: ExecutionContext = {
    operationId: args.operationId,
    report: args.report,
    mode: args.mode,
    policy: args.policy,
    fileSystem: args.fileSystem,
    signal: args.signal,
    emit: args.emit,
    requestResolution: args.requestResolution,
    autoResolve: args.autoResolve ?? (() => null),
    destinationDev: destinationFingerprint.dev,
    totalItemCount: countExecutableSteps(args.resolvedNodes),
    totalBytes: args.report.summary.totalBytes,
    progress: { completedItemCount: 0, completedByteCount: 0 },
  };
  const itemResults: CopyPasteItemResult[] = [];
  let encounteredError: Error | null = null;
  let cancelled = false;

  emitProgress(context, "running", null, null);

  const recordNotStarted = (nodes: ResolvedCopyPasteNode[]) => {
    for (const node of nodes) {
      itemResults.push(
        node.action === "skip"
          ? itemResult(node, "skipped", null, "planned_conflict_policy")
          : itemResult(node, "cancelled", NOT_STARTED_MESSAGE),
      );
    }
  };

  for (const [nodeIndex, node] of args.resolvedNodes.entries()) {
    if (args.signal.aborted) {
      cancelled = true;
      recordNotStarted(args.resolvedNodes.slice(nodeIndex));
      break;
    }
    try {
      const outcome = await executeResolvedNode(context, node);
      itemResults.push(
        itemResult(
          node,
          outcome.itemStatus,
          outcome.itemStatus === "skipped" ? null : outcome.error,
          outcome.skipReason,
        ),
      );
      // Surface non-success children (failed, skipped) so they appear in the action log
      itemResults.push(...outcome.childItems);
    } catch (error) {
      if (isAbortError(error) || args.signal.aborted) {
        cancelled = true;
        itemResults.push(itemResult(node, "cancelled", "Operation cancelled."));
        recordNotStarted(args.resolvedNodes.slice(nodeIndex + 1));
        break;
      }
      const message = describeCopyPasteError(error);
      encounteredError ??= error instanceof Error ? error : new Error(message);
      itemResults.push(itemResult(node, "failed", message));
      // Keep going: one failed item must not stop the rest of the operation.
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
    completedByteCount: context.progress.completedByteCount,
    totalBytes: context.totalBytes,
    items: itemResults,
    status,
    error:
      encounteredError !== null
        ? describeCopyPasteError(encounteredError)
        : cancelled
          ? "Operation cancelled."
          : null,
  });
  args.emit({
    operationId: args.operationId,
    analysisId: args.report.analysisId,
    mode: args.mode,
    status,
    completedItemCount: context.progress.completedItemCount,
    totalItemCount: context.totalItemCount,
    completedByteCount: context.progress.completedByteCount,
    totalBytes: context.totalBytes,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result,
  });
}

type ExecuteNodeResult = {
  itemStatus: "completed" | "skipped" | "failed";
  skipReason: "planned_conflict_policy" | "runtime_conflict_resolution" | null;
  error: string | null;
  /** Non-success child items to surface in the action log (failed, skipped). */
  childItems: CopyPasteItemResult[];
};

function itemResult(
  node: ResolvedCopyPasteNode,
  status: CopyPasteItemResult["status"],
  error: string | null,
  skipReason: CopyPasteItemResult["skipReason"] = null,
): CopyPasteItemResult {
  return {
    sourcePath: node.node.sourcePath,
    destinationPath: node.destinationPath,
    sourceKind: node.node.sourceKind,
    status,
    error,
    skipReason,
  };
}

function emitProgress(
  context: ExecutionContext,
  status: "running" | "awaiting_resolution",
  node: ResolvedCopyPasteNode | null,
  runtimeConflict: CopyPasteRuntimeConflict | null,
): void {
  context.emit({
    operationId: context.operationId,
    analysisId: context.report.analysisId,
    mode: context.mode,
    status,
    completedItemCount: context.progress.completedItemCount,
    totalItemCount: context.totalItemCount,
    completedByteCount: context.progress.completedByteCount,
    totalBytes: context.totalBytes,
    currentSourcePath: node?.node.sourcePath ?? null,
    currentDestinationPath: node?.destinationPath ?? null,
    runtimeConflict,
    result: null,
  });
}

async function executeResolvedNode(
  context: ExecutionContext,
  resolvedNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult> {
  let currentNode = resolvedNode;
  if (currentNode.action === "skip") {
    return {
      itemStatus: "skipped",
      skipReason: "planned_conflict_policy",
      error: null,
      childItems: [],
    };
  }

  const runtimeConflict = await detectRuntimeConflict(
    currentNode,
    context.report.analysisId,
    context.fileSystem,
  );
  if (runtimeConflict) {
    let resolution = context.autoResolve(runtimeConflict);
    if (resolution === null) {
      emitProgress(context, "awaiting_resolution", currentNode, runtimeConflict);
      resolution = await context.requestResolution(runtimeConflict);
    }
    context.signal.throwIfAborted();
    if (!resolution) {
      throw new Error("Runtime conflict was not resolved.");
    }
    // Continue from what is on disk now, which is what the person just decided on.
    const currentDestination = runtimeConflict.currentDestinationFingerprint;
    currentNode = await resolveSingleNodeWithAction({
      node: {
        ...currentNode.node,
        destinationPath: currentNode.destinationPath,
        sourceFingerprint: runtimeConflict.currentSourceFingerprint.exists
          ? runtimeConflict.currentSourceFingerprint
          : currentNode.node.sourceFingerprint,
        destinationFingerprint: currentDestination,
        destinationKind: currentDestination.kind,
        conflictClass: currentDestination.exists
          ? conflictClassFor(currentNode.node.sourceKind, currentDestination.kind)
          : null,
      },
      action: resolution,
      policy: context.policy,
      fileSystem: context.fileSystem,
    });
    if (currentNode.action === "skip") {
      return {
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
    context.mode === "cut" &&
    context.fileSystem.rename &&
    context.destinationDev !== null &&
    currentNode.node.sourceFingerprint.dev === context.destinationDev &&
    currentNode.action !== "merge";
  if (canRename) {
    const renameResult = await tryRenameForCut(context, currentNode);
    if (renameResult) {
      return renameResult;
    }
    // EXDEV fallback: rename failed, fall through to copy+delete path
  }

  if (currentNode.node.sourceKind === "directory") {
    return executeDirectoryNode(context, currentNode);
  }

  if (currentNode.action === "overwrite") {
    await replaceDestination(currentNode, context.fileSystem);
  }
  if (currentNode.node.sourceKind === "symlink") {
    const linkTarget = await context.fileSystem.readlink(currentNode.node.sourcePath);
    await context.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    await context.fileSystem.symlink(linkTarget, currentNode.destinationPath);
    await preserveSymlinkTimestampsIfSupported(
      context.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mtimeMs,
    );
  } else {
    await copyFileContents(context, currentNode);
    // Applied after both copy paths. Native copyFile (copyfile(3) COPYFILE_ALL)
    // already carries metadata, so chmod/utimes simply re-apply the same values.
    await preserveModeIfSupported(
      context.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mode,
    );
    await preserveTimestampsIfSupported(
      context.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mtimeMs,
    );
  }
  context.progress.completedItemCount += 1;
  if (currentNode.node.sourceFingerprint.size !== null) {
    context.progress.completedByteCount += currentNode.node.sourceFingerprint.size;
  }
  let deleteError: string | null = null;
  if (context.mode === "cut") {
    deleteError = await tryDeleteMovedSource(
      currentNode.node.sourcePath,
      currentNode.node.sourceFingerprint,
      context.fileSystem,
    );
  }
  emitProgress(context, "running", currentNode, null);
  return {
    itemStatus: deleteError !== null ? "failed" : "completed",
    skipReason: null,
    error: deleteError,
    childItems: [],
  };
}

async function executeDirectoryNode(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult> {
  const createsDirectory =
    currentNode.action === "create" ||
    currentNode.action === "keep_both" ||
    currentNode.action === "overwrite";
  if (createsDirectory) {
    if (currentNode.action === "overwrite") {
      await replaceDestination(currentNode, context.fileSystem);
    }
    await context.fileSystem.mkdir(currentNode.destinationPath, { recursive: true });
    await preserveModeIfSupported(
      context.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mode,
    );
    context.progress.completedItemCount += 1;
    emitProgress(context, "running", currentNode, null);
  }
  let hasChildFailure = false;
  const bubbledChildItems: CopyPasteItemResult[] = [];
  for (const child of currentNode.children) {
    context.signal.throwIfAborted();
    let childResult: ExecuteNodeResult;
    try {
      childResult = await executeResolvedNode(context, child);
    } catch (error) {
      if (isAbortError(error) || context.signal.aborted) {
        throw error;
      }
      // A failed item inside a folder is recorded and the rest of the folder continues.
      childResult = {
        itemStatus: "failed",
        skipReason: null,
        error: describeCopyPasteError(error),
        childItems: [],
      };
    }
    if (childResult.itemStatus === "failed") {
      hasChildFailure = true;
    }
    // Bubble up file items, and folders that failed themselves, for the action log.
    if (child.node.sourceKind !== "directory" || childResult.error !== null) {
      bubbledChildItems.push(
        itemResult(
          child,
          childResult.itemStatus,
          childResult.itemStatus === "skipped" ? null : childResult.error,
          childResult.skipReason,
        ),
      );
    }
    bubbledChildItems.push(...childResult.childItems);
  }
  // Preserve directory timestamps AFTER children are processed, since writing
  // children into the directory updates its mtime on the real filesystem.
  if (createsDirectory) {
    await preserveTimestampsIfSupported(
      context.fileSystem,
      currentNode.destinationPath,
      currentNode.node.sourceFingerprint.mtimeMs,
    );
  }
  let dirDeleteError: string | null = null;
  if (context.mode === "cut") {
    dirDeleteError = await tryRemoveEmptySourceDirectory(
      currentNode.node.sourcePath,
      currentNode.node.sourceFingerprint,
      context.fileSystem,
    );
  }
  return {
    itemStatus: dirDeleteError !== null || hasChildFailure ? "failed" : "completed",
    skipReason: null,
    error: dirDeleteError,
    childItems: bubbledChildItems,
  };
}

async function copyFileContents(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
): Promise<void> {
  try {
    if (context.fileSystem.copyFile) {
      await context.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
      await context.fileSystem.copyFile(currentNode.node.sourcePath, currentNode.destinationPath);
    } else {
      await context.fileSystem.copyFileStream(
        currentNode.node.sourcePath,
        currentNode.destinationPath,
        context.signal,
      );
    }
  } catch (error) {
    // Leave no half-written file behind, unless the name was taken by someone else.
    if ((error as NodeJS.ErrnoException | null)?.code !== "EEXIST") {
      await context.fileSystem
        .rm(currentNode.destinationPath, { recursive: false, force: true })
        .catch(() => undefined);
    }
    throw error;
  }
}

async function tryRenameForCut(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult | null> {
  try {
    const rename = context.fileSystem.rename;
    if (!rename) {
      return null;
    }
    if (currentNode.action === "overwrite") {
      await prepareRenameDestination(currentNode, context.fileSystem);
    }
    await context.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    await rename(currentNode.node.sourcePath, currentNode.destinationPath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "EXDEV") {
      return null; // Fall through to copy+delete path
    }
    throw error;
  }
  // Rename succeeded — count all items in the subtree as completed
  context.progress.completedItemCount += countExecutableSteps([currentNode]);
  context.progress.completedByteCount += sumSubtreeBytes([currentNode]);
  emitProgress(context, "running", currentNode, null);
  return {
    itemStatus: "completed",
    skipReason: null,
    error: null,
    childItems: [],
  };
}

function conflictClassFor(
  sourceKind: Exclude<CopyPasteNodeKind, "missing">,
  destinationKind: CopyPasteNodeKind,
): CopyPasteConflictClass {
  if (sourceKind === "directory" && destinationKind === "directory") {
    return "directory_conflict";
  }
  if (sourceKind !== "directory" && destinationKind === sourceKind) {
    return "file_conflict";
  }
  return "type_mismatch";
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
  const conflict = (
    reason: CopyPasteRuntimeConflict["reason"],
    conflictClass: CopyPasteConflictClass,
    side: "source" | "destination",
  ): CopyPasteRuntimeConflict => ({
    conflictId: `runtime-${resolvedNode.node.id}-${side}`,
    analysisId,
    sourcePath: resolvedNode.node.sourcePath,
    destinationPath: resolvedNode.destinationPath,
    sourceKind: resolvedNode.node.sourceKind,
    destinationKind:
      side === "source" ? resolvedNode.node.destinationKind : currentDestinationFingerprint.kind,
    conflictClass,
    reason,
    sourceFingerprint: resolvedNode.node.sourceFingerprint,
    destinationFingerprint: resolvedNode.node.destinationFingerprint,
    currentSourceFingerprint,
    currentDestinationFingerprint,
  });

  // A folder's own timestamps change whenever anything inside it changes; its items are
  // checked one by one, so only its identity matters here.
  const sourceChanged =
    resolvedNode.node.sourceKind === "directory"
      ? !sameItemIdentity(resolvedNode.node.sourceFingerprint, currentSourceFingerprint)
      : !fingerprintsEqual(resolvedNode.node.sourceFingerprint, currentSourceFingerprint);
  if (sourceChanged) {
    return conflict(
      currentSourceFingerprint.exists ? "source_changed" : "source_deleted",
      resolvedNode.node.conflictClass ??
        (resolvedNode.node.sourceKind === "directory" ? "directory_conflict" : "file_conflict"),
      "source",
    );
  }

  const destinationExists =
    currentDestinationFingerprint.exists && currentDestinationFingerprint.kind !== "missing";
  switch (resolvedNode.action) {
    case "create":
    case "keep_both":
      return destinationExists
        ? conflict(
            "destination_created",
            conflictClassFor(resolvedNode.node.sourceKind, currentDestinationFingerprint.kind),
            "destination",
          )
        : null;
    case "overwrite": {
      // Gone already: nothing is left to replace, so this simply becomes a copy.
      if (!destinationExists) {
        return null;
      }
      const planned = resolvedNode.node.destinationFingerprint;
      return fingerprintsEqual(planned, currentDestinationFingerprint)
        ? null
        : conflict(
            planned.exists ? "destination_changed" : "destination_created",
            conflictClassFor(resolvedNode.node.sourceKind, currentDestinationFingerprint.kind),
            "destination",
          );
    }
    case "merge":
      // A missing folder is recreated; only a folder that became something else matters.
      return destinationExists && currentDestinationFingerprint.kind !== "directory"
        ? conflict("destination_changed", "type_mismatch", "destination")
        : null;
    default:
      return null;
  }
}

function sameItemIdentity(planned: NodeFingerprint, current: NodeFingerprint): boolean {
  return (
    planned.exists === current.exists &&
    planned.kind === current.kind &&
    (planned.ino === null || current.ino === null || planned.ino === current.ino) &&
    (planned.dev === null || current.dev === null || planned.dev === current.dev)
  );
}

function isSameExistingItem(left: NodeFingerprint, right: NodeFingerprint): boolean {
  return (
    left.exists &&
    right.exists &&
    left.ino !== null &&
    left.dev !== null &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

// Refuses to replace an item that is, or contains, the item being pasted: removing it
// would destroy the source too (pasting "foo/foo" over "foo", or the same folder reached
// through a symlink or a different letter case).
async function assertDestinationDoesNotContainSource(
  currentNode: ResolvedCopyPasteNode,
  destination: NodeFingerprint,
  fileSystem: WriteServiceFileSystem,
): Promise<void> {
  const destinationPath = currentNode.destinationPath;
  const sourcePath = currentNode.node.sourcePath;
  const name = basename(destinationPath);
  const source = await captureFingerprint(fileSystem, sourcePath);
  if (sourcePath === destinationPath || isSameExistingItem(source, destination)) {
    throw new Error(`“${name}” is the item being pasted, so it can't replace itself.`);
  }
  if (destination.kind !== "directory") {
    return;
  }
  if (sourcePath.startsWith(`${destinationPath}/`)) {
    throw new Error(`Can't replace “${name}” because it contains the item being pasted.`);
  }
  for (let ancestor = dirname(sourcePath); ; ancestor = dirname(ancestor)) {
    if (isSameExistingItem(await captureFingerprint(fileSystem, ancestor), destination)) {
      throw new Error(`Can't replace “${name}” because it contains the item being pasted.`);
    }
    if (dirname(ancestor) === ancestor) {
      return;
    }
  }
}

// Removes the item a paste replaces: to the Trash when available, so a replace can be
// undone and nothing is lost if the copy that follows fails.
async function replaceDestination(
  currentNode: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
): Promise<void> {
  const destination = await captureFingerprint(fileSystem, currentNode.destinationPath);
  if (!destination.exists) {
    return;
  }
  await assertDestinationDoesNotContainSource(currentNode, destination, fileSystem);
  if (fileSystem.trash) {
    await trashReplacedItem(currentNode.destinationPath, fileSystem.trash);
    return;
  }
  await fileSystem.rm(currentNode.destinationPath, {
    recursive: destination.kind === "directory",
    force: true,
  });
}

/** Clears the way for a rename over an existing item. With a Trash the existing item is
 *  always trashed. Without one it is pre-deleted only when rename(2) cannot atomically
 *  replace it: a non-empty destination directory, or a cross-type replacement
 *  (file over directory / directory over file). */
async function prepareRenameDestination(
  currentNode: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
): Promise<void> {
  const destinationFingerprint = await captureFingerprint(fileSystem, currentNode.destinationPath);
  if (!destinationFingerprint.exists) {
    return;
  }
  await assertDestinationDoesNotContainSource(currentNode, destinationFingerprint, fileSystem);
  if (fileSystem.trash) {
    await trashReplacedItem(currentNode.destinationPath, fileSystem.trash);
    return;
  }
  const sourceIsDirectory = currentNode.node.sourceKind === "directory";
  const destinationIsDirectory = destinationFingerprint.kind === "directory";
  if (!sourceIsDirectory && !destinationIsDirectory) {
    return;
  }
  if (sourceIsDirectory && destinationIsDirectory) {
    const destinationEntries = await fileSystem.readdir(currentNode.destinationPath);
    if (destinationEntries.length === 0) {
      return;
    }
  }
  await fileSystem.rm(currentNode.destinationPath, {
    recursive: destinationIsDirectory,
    force: true,
  });
}

async function trashReplacedItem(
  path: string,
  trash: (path: string) => Promise<void>,
): Promise<void> {
  try {
    await trash(path);
  } catch (error) {
    throw new Error(
      `Couldn't move the existing “${basename(path)}” to the Trash: ${describeCopyPasteError(error)}`,
    );
  }
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  ENOSPC: "There isn't enough free space on the destination disk.",
  EDQUOT: "The destination's storage quota is full.",
  EACCES: "You don't have permission to access this item.",
  EPERM: "You don't have permission to access this item.",
  EROFS: "The destination is read-only.",
  ENAMETOOLONG: "The name is too long.",
  ENOENT: "The item no longer exists.",
  EEXIST: "An item with this name already exists.",
  ENOTEMPTY: "The folder isn't empty.",
  EBUSY: "The item is in use.",
  EIO: "A disk error occurred.",
};

/** A readable, path-free reason for a failed item (the item itself is shown next to it). */
export function describeCopyPasteError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code === "string" && ERROR_CODE_MESSAGES[code]) {
    return ERROR_CODE_MESSAGES[code];
  }
  return toErrorMessage(error);
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
