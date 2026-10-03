import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

import { isAbortError } from "@filetrail/contracts";

import { describeCopyPasteError, errorCode } from "./copyPasteErrors";
import { captureFingerprint, findSourceRelation, fingerprintsEqual } from "./copyPasteFingerprint";
import { fitName } from "./copyPasteNames";
import {
  type ResolvedCopyPasteNode,
  collectDestinationPathKeys,
  resolveSingleNodeWithAction,
} from "./copyPastePolicy";
import type {
  CopyPasteAnalysisReport,
  CopyPasteConflictClass,
  CopyPasteItemResult,
  CopyPasteMode,
  CopyPasteNodeKind,
  CopyPasteNodeOverride,
  CopyPasteOperationResult,
  CopyPasteOperationStatus,
  CopyPastePolicy,
  CopyPasteProgressEvent,
  CopyPasteRuntimeConflict,
  CopyPasteRuntimeResolutionAction,
  NodeFingerprint,
  ReplaceJournal,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

const NOT_STARTED_MESSAGE = "Not started because the operation was stopped.";
const CANCELLED_MESSAGE = "Operation cancelled.";
// How many times one item may run into something new at its destination before the
// paste gives up on it (each time asks, or applies a standing answer).
const MAX_RUNTIME_ATTEMPTS = 5;

type ExecutionContext = {
  operationId: string;
  report: CopyPasteAnalysisReport;
  mode: CopyPasteMode;
  policy: CopyPastePolicy;
  overrides: CopyPasteNodeOverride[];
  fileSystem: WriteServiceFileSystem;
  signal: AbortSignal;
  emit: (event: CopyPasteProgressEvent) => void;
  requestResolution: (
    conflict: CopyPasteRuntimeConflict,
  ) => Promise<CopyPasteRuntimeResolutionAction | null>;
  autoResolve: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
  destinationDev: number | null;
  caseSensitive: boolean;
  // Every destination this paste planned or has written so far (`destinationPathKey`),
  // so a runtime "Keep Both" never takes a name another item will use.
  reservedPaths: Set<string>;
  totalItemCount: number;
  totalBytes: number | null;
  // Shared by every step so progress survives an item that fails half way.
  progress: { completedItemCount: number; completedByteCount: number };
  // Maps a path being written to the path people know it by: while a Replace builds its
  // new item under a hidden name, progress and questions still show the final name.
  displayPath?: (path: string) => string;
  replaceJournal: ReplaceJournal | null;
};

// Something appeared at the destination while writing to it (EEXIST). Handled like a
// runtime conflict: the person decides what happens to the item.
class DestinationTakenError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
  }
}

// A stop inside a folder, carrying what was already done inside it for the result.
class CancelledWithItemsError extends Error {
  override name = "AbortError";
  constructor(readonly childItems: CopyPasteItemResult[]) {
    super(CANCELLED_MESSAGE);
  }
}

// Where an item was headed when it failed, when that differs from the plan (a runtime
// "Keep Both" picked another name).
const failedDestinations = new WeakMap<object, string>();

export async function executeCopyPasteFromAnalysis(args: {
  operationId: string;
  report: CopyPasteAnalysisReport;
  mode: CopyPasteMode;
  policy: CopyPastePolicy;
  // The review's per-item choices, applied again when an item is re-resolved at runtime.
  overrides?: CopyPasteNodeOverride[];
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
  replaceJournal?: ReplaceJournal;
}): Promise<void> {
  const startedAt = args.now().toISOString();
  const destinationFingerprint = await captureFingerprint(
    args.fileSystem,
    args.report.destinationDirectoryPath,
  );
  const caseSensitive = args.report.destinationCaseSensitive ?? false;
  const context: ExecutionContext = {
    operationId: args.operationId,
    report: args.report,
    mode: args.mode,
    policy: args.policy,
    overrides: args.overrides ?? [],
    fileSystem: args.fileSystem,
    signal: args.signal,
    emit: args.emit,
    requestResolution: args.requestResolution,
    autoResolve: args.autoResolve ?? (() => null),
    destinationDev: destinationFingerprint.dev,
    caseSensitive,
    reservedPaths: collectDestinationPathKeys(args.resolvedNodes, caseSensitive),
    totalItemCount: countExecutableSteps(args.resolvedNodes),
    totalBytes: args.report.summary.totalBytes,
    progress: { completedItemCount: 0, completedByteCount: 0 },
    replaceJournal: args.replaceJournal ?? null,
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
      itemResults.push(outcomeItemResult(node, outcome));
      // Surface children (files, and folders that failed) in the result.
      itemResults.push(...outcome.childItems);
    } catch (error) {
      if (isAbortError(error) || args.signal.aborted) {
        cancelled = true;
        itemResults.push(itemResult(node, "cancelled", CANCELLED_MESSAGE));
        if (error instanceof CancelledWithItemsError) {
          itemResults.push(...error.childItems);
        }
        recordNotStarted(args.resolvedNodes.slice(nodeIndex + 1));
        break;
      }
      const message = describeCopyPasteError(error);
      encounteredError ??= error instanceof Error ? error : new Error(message);
      itemResults.push(failedItemResult(node, error, message));
      // Keep going: one failed item must not stop the rest of the operation.
    }
  }

  const status = resolveTerminalStatus({ cancelled, itemResults });
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
          ? CANCELLED_MESSAGE
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
  // Where the item ended up (or was headed), after any runtime answer.
  destinationPath: string;
  // Children to surface in the result (files, and folders that failed themselves).
  childItems: CopyPasteItemResult[];
};

function itemResult(
  node: ResolvedCopyPasteNode,
  status: CopyPasteItemResult["status"],
  error: string | null,
  skipReason: CopyPasteItemResult["skipReason"] = null,
  destinationPath: string = node.destinationPath,
): CopyPasteItemResult {
  return {
    sourcePath: node.node.sourcePath,
    destinationPath,
    sourceKind: node.node.sourceKind,
    status,
    error,
    skipReason,
  };
}

function outcomeItemResult(
  node: ResolvedCopyPasteNode,
  outcome: ExecuteNodeResult,
): CopyPasteItemResult {
  const result = itemResult(
    node,
    outcome.itemStatus,
    outcome.itemStatus === "skipped" ? null : outcome.error,
    outcome.skipReason,
    outcome.destinationPath,
  );
  const childFailureCount = outcome.childItems.filter((item) => item.status === "failed").length;
  return node.node.sourceKind === "directory" && childFailureCount > 0
    ? { ...result, childFailureCount }
    : result;
}

function failedItemResult(
  node: ResolvedCopyPasteNode,
  error: unknown,
  message: string,
): CopyPasteItemResult {
  const destinationPath =
    typeof error === "object" && error !== null ? failedDestinations.get(error) : undefined;
  return itemResult(node, "failed", message, null, destinationPath ?? node.destinationPath);
}

function skippedOutcome(
  skipReason: ExecuteNodeResult["skipReason"],
  destinationPath: string,
): ExecuteNodeResult {
  return { itemStatus: "skipped", skipReason, error: null, destinationPath, childItems: [] };
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
    currentDestinationPath: node ? displayPath(node.destinationPath) : null,
    runtimeConflict: runtimeConflict ? displayConflict(runtimeConflict) : null,
    result: null,
  });

  function displayPath(path: string): string {
    return context.displayPath ? context.displayPath(path) : path;
  }
  function displayConflict(conflict: CopyPasteRuntimeConflict): CopyPasteRuntimeConflict {
    return { ...conflict, destinationPath: displayPath(conflict.destinationPath) };
  }
}

async function executeResolvedNode(
  context: ExecutionContext,
  resolvedNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult> {
  let currentNode = resolvedNode;
  if (currentNode.action === "skip") {
    return skippedOutcome("planned_conflict_policy", currentNode.destinationPath);
  }

  let runtimeConflict = await detectRuntimeConflict(
    currentNode,
    context.report.analysisId,
    context.fileSystem,
  );
  for (let attempt = 1; ; attempt += 1) {
    if (runtimeConflict) {
      const resolution = await answerRuntimeConflict(context, currentNode, runtimeConflict);
      currentNode = await resolveWithRuntimeAnswer(
        context,
        currentNode,
        runtimeConflict,
        resolution,
      );
      if (currentNode.action === "skip") {
        return skippedOutcome("runtime_conflict_resolution", currentNode.destinationPath);
      }
    }
    try {
      return await performNode(context, currentNode);
    } catch (error) {
      if (!(error instanceof DestinationTakenError)) {
        if (typeof error === "object" && error !== null && !failedDestinations.has(error)) {
          failedDestinations.set(error, currentNode.destinationPath);
        }
        throw error;
      }
      if (attempt >= MAX_RUNTIME_ATTEMPTS) {
        throw error.original;
      }
      // Something took the name while this item was being written: decide again from
      // what is there now.
      runtimeConflict = await detectRuntimeConflict(
        currentNode,
        context.report.analysisId,
        context.fileSystem,
      );
    }
  }
}

// Asks about a conflict, unless an earlier "apply to the rest" answer covers it.
async function answerRuntimeConflict(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  conflict: CopyPasteRuntimeConflict,
): Promise<CopyPasteRuntimeResolutionAction> {
  const standing = context.autoResolve(conflict);
  if (standing !== null) {
    return standing;
  }
  // Asked for before the question goes out, so an answer given right away isn't lost.
  const answer = context.requestResolution(conflict);
  emitProgress(context, "awaiting_resolution", node, conflict);
  const resolution = await answer;
  context.signal.throwIfAborted();
  if (!resolution) {
    throw new Error("Runtime conflict was not resolved.");
  }
  return resolution;
}

// Continues from what is on disk now, which is what the person just decided on.
async function resolveWithRuntimeAnswer(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  conflict: CopyPasteRuntimeConflict,
  resolution: CopyPasteRuntimeResolutionAction,
): Promise<ResolvedCopyPasteNode> {
  const currentDestination = conflict.currentDestinationFingerprint;
  return resolveSingleNodeWithAction({
    node: {
      ...node.node,
      destinationPath: node.destinationPath,
      sourceFingerprint: conflict.currentSourceFingerprint.exists
        ? conflict.currentSourceFingerprint
        : node.node.sourceFingerprint,
      destinationFingerprint: currentDestination,
      destinationKind: currentDestination.kind,
      conflictClass: currentDestination.exists
        ? conflictClassFor(node.node.sourceKind, currentDestination.kind)
        : null,
    },
    action: resolution,
    policy: context.policy,
    overrides: context.overrides,
    fileSystem: context.fileSystem,
    caseSensitive: context.caseSensitive,
    reservedPaths: context.reservedPaths,
  });
}

async function performNode(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult> {
  if (currentNode.action === "overwrite") {
    const destination = await captureFingerprint(context.fileSystem, currentNode.destinationPath);
    // Gone already: nothing is left to replace, so this simply becomes a copy.
    if (destination.exists) {
      return executeReplace(context, currentNode, destination);
    }
  }

  // Same-filesystem rename fast path: use rename(2) for cut operations when
  // source and destination are on the same device. Skipped for merge actions
  // (can't atomically rename a directory into an existing one).
  if (canRenameForCut(context, currentNode)) {
    const renameResult = await tryRenameForCut(context, currentNode);
    if (renameResult) {
      return renameResult;
    }
    // EXDEV fallback: rename failed, fall through to copy+delete path
  }

  if (currentNode.node.sourceKind === "directory") {
    // A folder whose contents couldn't be read is left where it is; the rest goes on.
    if (currentNode.node.issueCode === "source_unreadable") {
      throw new Error(unreadableFolderMessage(context.mode, currentNode.node.issueMessage));
    }
    return executeDirectoryNode(context, currentNode);
  }
  return executeLeafNode(context, currentNode);
}

function unreadableFolderMessage(mode: CopyPasteMode, reason: string | null): string {
  const done = mode === "cut" ? "moved" : "copied";
  return `This folder couldn't be read, so it wasn't ${done}.${reason ? ` ${reason}` : ""}`;
}

function canRenameForCut(context: ExecutionContext, node: ResolvedCopyPasteNode): boolean {
  return (
    context.mode === "cut" &&
    context.fileSystem.rename !== undefined &&
    context.destinationDev !== null &&
    node.node.sourceFingerprint.dev === context.destinationDev &&
    node.action !== "merge"
  );
}

// A file or symlink written to its destination.
async function executeLeafNode(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult> {
  await writeLeaf(context, currentNode, currentNode.destinationPath);
  countLeafProgress(context, currentNode);
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
    destinationPath: currentNode.destinationPath,
    childItems: [],
  };
}

function countLeafProgress(context: ExecutionContext, node: ResolvedCopyPasteNode): void {
  context.progress.completedItemCount += 1;
  if (node.node.sourceFingerprint.size !== null) {
    context.progress.completedByteCount += node.node.sourceFingerprint.size;
  }
}

async function writeLeaf(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  targetPath: string,
): Promise<void> {
  if (node.node.sourceKind === "symlink") {
    const linkTarget = await context.fileSystem.readlink(node.node.sourcePath);
    await context.fileSystem.mkdir(dirname(targetPath), { recursive: true });
    try {
      await context.fileSystem.symlink(linkTarget, targetPath);
    } catch (error) {
      throw errorCode(error) === "EEXIST" ? new DestinationTakenError(error) : error;
    }
    await preserveSymlinkTimestampsIfSupported(
      context.fileSystem,
      targetPath,
      node.node.sourceFingerprint.mtimeMs,
    );
    return;
  }
  await copyFileContents(context, node.node.sourcePath, targetPath);
  if (context.fileSystem.copyFile) {
    await restoreDroppedFileMetadata(context.fileSystem, targetPath, node.node.sourceFingerprint);
    return;
  }
  await preserveModeIfSupported(context.fileSystem, targetPath, node.node.sourceFingerprint.mode);
  await preserveTimestampsIfSupported(
    context.fileSystem,
    targetPath,
    node.node.sourceFingerprint.mtimeMs,
  );
}

// Native copyFile (copyfile(3) COPYFILE_ALL) carries the mode, flags and dates, but some
// volumes drop them: only what didn't arrive is set again. Setting it when it did arrive
// would fail on a locked file (its copy is locked too), and a copy that worked is never
// reported as failed over its metadata.
async function restoreDroppedFileMetadata(
  fileSystem: WriteServiceFileSystem,
  targetPath: string,
  source: NodeFingerprint,
): Promise<void> {
  const copied = await captureFingerprint(fileSystem, targetPath);
  if (source.mode !== null && copied.mode !== source.mode) {
    await preserveModeIfSupported(fileSystem, targetPath, source.mode).catch(() => undefined);
  }
  if (source.mtimeMs !== null && copied.mtimeMs !== source.mtimeMs) {
    await preserveTimestampsIfSupported(fileSystem, targetPath, source.mtimeMs).catch(
      () => undefined,
    );
  }
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
    await context.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    try {
      // Not recursive: a folder that appeared in the meantime must not be merged into
      // without asking.
      await context.fileSystem.mkdir(currentNode.destinationPath);
    } catch (error) {
      throw errorCode(error) === "EEXIST" ? new DestinationTakenError(error) : error;
    }
    // The folder's own mode and flags come last (see below): a read-only or locked folder
    // couldn't be filled in otherwise.
    context.progress.completedItemCount += 1;
    emitProgress(context, "running", currentNode, null);
  }
  let hasChildFailure = false;
  const bubbledChildItems: CopyPasteItemResult[] = [];
  for (const child of currentNode.children) {
    if (context.signal.aborted) {
      // Keep what was already done inside this folder in the result.
      throw new CancelledWithItemsError(bubbledChildItems);
    }
    let childResult: ExecuteNodeResult;
    try {
      childResult = await executeResolvedNode(context, child);
    } catch (error) {
      if (isAbortError(error) || context.signal.aborted) {
        const nestedItems = error instanceof CancelledWithItemsError ? error.childItems : [];
        const inProgress =
          child.node.sourceKind !== "directory" && !(error instanceof CancelledWithItemsError)
            ? [itemResult(child, "cancelled", CANCELLED_MESSAGE)]
            : [];
        throw new CancelledWithItemsError([...bubbledChildItems, ...inProgress, ...nestedItems]);
      }
      // A failed item inside a folder is recorded and the rest of the folder continues.
      const destinationPath =
        typeof error === "object" && error !== null ? failedDestinations.get(error) : undefined;
      childResult = {
        itemStatus: "failed",
        skipReason: null,
        error: describeCopyPasteError(error),
        destinationPath: destinationPath ?? child.destinationPath,
        childItems: [],
      };
    }
    if (childResult.itemStatus === "failed") {
      hasChildFailure = true;
    }
    // Bubble up file items, and folders that failed themselves, into the result.
    if (child.node.sourceKind !== "directory" || childResult.error !== null) {
      bubbledChildItems.push(outcomeItemResult(child, childResult));
    }
    bubbledChildItems.push(...childResult.childItems);
  }
  // The folder's metadata goes on once its items are in: writing them changes its dates,
  // and a read-only or locked folder can't take new items.
  if (createsDirectory) {
    await applyDirectoryMetadata(context, currentNode);
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
    destinationPath: currentNode.destinationPath,
    childItems: bubbledChildItems,
  };
}

async function applyDirectoryMetadata(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
): Promise<void> {
  const { fileSystem } = context;
  const { sourcePath, sourceFingerprint } = node.node;
  if (fileSystem.copyMetadata) {
    try {
      // Tags, the custom-icon flag, ACLs and flags along with the mode and dates.
      await fileSystem.copyMetadata(sourcePath, node.destinationPath);
      if (context.mode === "cut") {
        // Moving the items out changed the source folder's dates; put back the ones it
        // had before. Only the date is lost if this fails (a locked folder refuses it).
        await preserveTimestampsIfSupported(
          fileSystem,
          node.destinationPath,
          sourceFingerprint.mtimeMs,
        ).catch(() => undefined);
      }
      return;
    } catch {
      // For example a volume that refuses some attribute: carry over what can be.
    }
  }
  await preserveModeIfSupported(fileSystem, node.destinationPath, sourceFingerprint.mode);
  await preserveTimestampsIfSupported(fileSystem, node.destinationPath, sourceFingerprint.mtimeMs);
}

// Replace, without ever leaving the person with neither item: the new item is first
// written (or, for a move on the same volume, moved) to a hidden name next to the
// existing one, then the existing item goes to the Trash and the new one takes its
// name. If anything fails before the swap, only the hidden copy is removed.
async function executeReplace(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
  destination: NodeFingerprint,
): Promise<ExecuteNodeResult> {
  const { fileSystem } = context;
  const finalPath = currentNode.destinationPath;
  await assertDestinationDoesNotContainSource(currentNode, destination, fileSystem);

  if (!fileSystem.rename) {
    // Nothing can be swapped into place without rename: clear the way first instead.
    if ((await removeReplacedItem(context, currentNode, destination)) === "skipped") {
      return skippedOutcome("runtime_conflict_resolution", finalPath);
    }
    return performNode(context, { ...currentNode, action: "create" });
  }

  const temporaryPath = await temporarySiblingPath(fileSystem, finalPath);
  // Written down before anything is staged, so a crash can't leave the item under the
  // hidden name: the next start finishes or undoes the Replace.
  const journal = context.replaceJournal;
  const journalEntry = {
    id: randomBytes(8).toString("hex"),
    stagingPath: temporaryPath,
    finalPath,
    sourcePath: currentNode.node.sourcePath,
    moved: false,
    staged: false,
  };
  let movedByRename = false;
  if (canRenameForCut(context, currentNode)) {
    await journal?.add({ ...journalEntry, moved: true, staged: true });
    try {
      await moveExclusive(fileSystem, currentNode.node.sourcePath, temporaryPath);
      movedByRename = true;
    } catch (error) {
      if (errorCode(error) !== "EXDEV") {
        await journal?.remove(journalEntry.id).catch(() => undefined);
        throw error;
      }
    }
  }
  if (!movedByRename) {
    await journal?.add(journalEntry);
  }
  // Puts things back the way they were before this item started.
  const undoStaging = async () => {
    if (movedByRename) {
      await moveExclusive(fileSystem, temporaryPath, currentNode.node.sourcePath);
    } else {
      await removeStagedItem(fileSystem, temporaryPath);
    }
    await journal?.remove(journalEntry.id);
  };

  let stagedChildItems: CopyPasteItemResult[] = [];
  if (movedByRename) {
    context.progress.completedItemCount += countExecutableSteps([currentNode]);
    context.progress.completedByteCount += sumSubtreeBytes([currentNode]);
  } else {
    const staged = rebaseResolvedNode(
      { ...currentNode, action: "create" },
      finalPath,
      temporaryPath,
    );
    let stagedOutcome: ExecuteNodeResult;
    try {
      // Sources stay in place until the swap is done, even for a move.
      stagedOutcome = await performNode(
        {
          ...context,
          mode: "copy",
          displayPath: (path) =>
            (context.displayPath ?? ((value: string) => value))(
              rebasePath(path, temporaryPath, finalPath),
            ),
        },
        staged,
      );
    } catch (error) {
      await undoStaging().catch(() => undefined);
      if (isAbortError(error) || context.signal.aborted) {
        // What was written went away with the hidden copy.
        throw new CancelledWithItemsError([]);
      }
      throw error instanceof DestinationTakenError ? error.original : error;
    }
    stagedChildItems = rebaseItemResults(stagedOutcome.childItems, temporaryPath, finalPath);
    if (stagedOutcome.itemStatus !== "failed") {
      // Complete now: once the old item is in the Trash, this copy is the one to keep.
      await journal?.add({ ...journalEntry, staged: true });
    }
    if (stagedOutcome.itemStatus === "failed") {
      await undoStaging().catch(() => undefined);
      return {
        itemStatus: "failed",
        skipReason: null,
        error: `“${basename(finalPath)}” wasn't replaced because some items inside couldn't be copied.`,
        destinationPath: finalPath,
        // Only the failures: everything else went away with the hidden copy.
        childItems: stagedChildItems.filter((item) => item.status === "failed"),
      };
    }
  }

  try {
    if ((await removeReplacedItem(context, currentNode, destination)) === "skipped") {
      await undoStaging();
      return skippedOutcome("runtime_conflict_resolution", finalPath);
    }
    await moveExclusive(fileSystem, temporaryPath, finalPath);
  } catch (error) {
    await undoStaging().catch(() => undefined);
    throw errorCode(error) === "EEXIST" ? new DestinationTakenError(error) : error;
  }
  await journal?.remove(journalEntry.id).catch(() => undefined);

  let ownError: string | null = null;
  let childItems = stagedChildItems;
  if (context.mode === "cut" && !movedByRename) {
    const cleanup = await removeMovedSources(context, currentNode, stagedChildItems);
    ownError = cleanup.error;
    childItems = cleanup.childItems;
  }
  emitProgress(context, "running", currentNode, null);
  const failed = ownError !== null || childItems.some((item) => item.status === "failed");
  return {
    itemStatus: failed ? "failed" : "completed",
    skipReason: null,
    error: ownError,
    destinationPath: finalPath,
    childItems,
  };
}

// After a replacing move was copied into place, removes the sources that were copied.
// Anything changed in the meantime stays, as in the per-file move flow.
async function removeMovedSources(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  childItems: CopyPasteItemResult[],
): Promise<{ error: string | null; childItems: CopyPasteItemResult[] }> {
  if (node.node.sourceKind !== "directory") {
    return {
      error: await tryDeleteMovedSource(
        node.node.sourcePath,
        node.node.sourceFingerprint,
        context.fileSystem,
      ),
      childItems,
    };
  }
  const itemsBySource = new Map(childItems.map((item) => [item.sourcePath, item]));
  const updatedItems = new Map<string, CopyPasteItemResult>();
  const nestedFolderFailures: CopyPasteItemResult[] = [];
  const removeTree = async (current: ResolvedCopyPasteNode): Promise<string | null> => {
    if (current.node.sourceKind !== "directory") {
      if (itemsBySource.get(current.node.sourcePath)?.status !== "completed") {
        return null;
      }
      const error = await tryDeleteMovedSource(
        current.node.sourcePath,
        current.node.sourceFingerprint,
        context.fileSystem,
      );
      if (error !== null) {
        const item = itemsBySource.get(current.node.sourcePath);
        if (item) {
          updatedItems.set(current.node.sourcePath, { ...item, status: "failed", error });
        }
      }
      return error;
    }
    for (const child of current.children) {
      const childError = await removeTree(child);
      if (childError !== null && child.node.sourceKind === "directory") {
        nestedFolderFailures.push(itemResult(child, "failed", childError));
      }
    }
    return tryRemoveEmptySourceDirectory(
      current.node.sourcePath,
      current.node.sourceFingerprint,
      context.fileSystem,
    );
  };
  const error = await removeTree(node);
  return {
    error,
    childItems: [
      ...childItems.map((item) => updatedItems.get(item.sourcePath) ?? item),
      ...nestedFolderFailures,
    ],
  };
}

// Moves the item being replaced out of the way: to the Trash, or, when there is no
// Trash here, deleted permanently only if the person agrees.
async function removeReplacedItem(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  destination: NodeFingerprint,
): Promise<"removed" | "skipped"> {
  const { fileSystem } = context;
  if (fileSystem.trash) {
    try {
      await fileSystem.trash(node.destinationPath);
      return "removed";
    } catch {
      // For example a network or FAT volume without a Trash: ask below.
    }
  }
  const conflict: CopyPasteRuntimeConflict = {
    conflictId: `runtime-${node.node.id}-trash`,
    analysisId: context.report.analysisId,
    sourcePath: node.node.sourcePath,
    destinationPath: node.destinationPath,
    sourceKind: node.node.sourceKind,
    destinationKind: destination.kind,
    conflictClass: conflictClassFor(node.node.sourceKind, destination.kind),
    reason: "trash_unavailable",
    sourceFingerprint: node.node.sourceFingerprint,
    destinationFingerprint: node.node.destinationFingerprint,
    currentSourceFingerprint: await captureFingerprint(fileSystem, node.node.sourcePath),
    currentDestinationFingerprint: destination,
  };
  const resolution = await answerRuntimeConflict(context, node, conflict);
  if (resolution !== "overwrite") {
    return "skipped";
  }
  await fileSystem.rm(node.destinationPath, {
    recursive: destination.kind === "directory",
    force: true,
  });
  return "removed";
}

// A hidden name next to `finalPath` for building the replacement, within the volume's
// name length limit.
async function temporarySiblingPath(
  fileSystem: WriteServiceFileSystem,
  finalPath: string,
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tag = `.filetrail-${randomBytes(4).toString("hex")}`;
    const candidate = join(dirname(finalPath), fitName(`.${basename(finalPath)}`, tag, ""));
    if (!(await captureFingerprint(fileSystem, candidate)).exists) {
      return candidate;
    }
  }
  throw new Error(`Couldn't find a free temporary name next to “${basename(finalPath)}”.`);
}

// Removes a hidden copy built for a Replace. A read-only folder inside it can't have its
// items removed, so folders are opened up first when that is what stopped it.
export async function removeStagedItem(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<void> {
  try {
    await fileSystem.rm(path, { recursive: true, force: true });
    return;
  } catch (error) {
    const code = errorCode(error);
    if ((code !== "EACCES" && code !== "EPERM") || !fileSystem.chmod) {
      throw error;
    }
  }
  await makeFoldersWritable(fileSystem, path);
  await fileSystem.rm(path, { recursive: true, force: true });
}

async function makeFoldersWritable(fileSystem: WriteServiceFileSystem, path: string) {
  const fingerprint = await captureFingerprint(fileSystem, path);
  if (fingerprint.kind !== "directory") {
    return;
  }
  await fileSystem.chmod?.(path, 0o700).catch(() => undefined);
  const entries = await fileSystem.readdir(path).catch(() => [] as string[]);
  for (const entry of entries) {
    await makeFoldersWritable(fileSystem, join(path, entry));
  }
}

function rebaseResolvedNode(
  node: ResolvedCopyPasteNode,
  fromPath: string,
  toPath: string,
): ResolvedCopyPasteNode {
  const destinationPath = rebasePath(node.destinationPath, fromPath, toPath);
  return {
    ...node,
    destinationPath,
    node: {
      ...node.node,
      destinationPath,
      disposition: "new",
      conflictClass: null,
      destinationKind: "missing",
      destinationFingerprint: MISSING_FINGERPRINT,
    },
    children: node.children.map((child) => rebaseResolvedNode(child, fromPath, toPath)),
  };
}

function rebaseItemResults(
  items: CopyPasteItemResult[],
  fromPath: string,
  toPath: string,
): CopyPasteItemResult[] {
  return items.map((item) => ({
    ...item,
    destinationPath: rebasePath(item.destinationPath, fromPath, toPath),
  }));
}

function rebasePath(path: string, fromPath: string, toPath: string): string {
  if (path === fromPath) {
    return toPath;
  }
  return path.startsWith(`${fromPath}/`) ? `${toPath}${path.slice(fromPath.length)}` : path;
}

const MISSING_FINGERPRINT: NodeFingerprint = {
  exists: false,
  kind: "missing",
  size: null,
  mtimeMs: null,
  mode: null,
  ino: null,
  dev: null,
  symlinkTarget: null,
};

async function copyFileContents(
  context: ExecutionContext,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const before = await captureFingerprint(context.fileSystem, targetPath);
  try {
    if (context.fileSystem.copyFile) {
      await context.fileSystem.mkdir(dirname(targetPath), { recursive: true });
      await context.fileSystem.copyFile(sourcePath, targetPath);
    } else {
      await context.fileSystem.copyFileStream(sourcePath, targetPath, context.signal);
    }
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new DestinationTakenError(error);
    }
    // Leave no half-written file behind, but only one this copy created: an item that
    // was already there, or something other than a file, belongs to someone else.
    if (!before.exists) {
      const after = await captureFingerprint(context.fileSystem, targetPath);
      if (after.exists && after.kind === "file") {
        await context.fileSystem
          .rm(targetPath, { recursive: false, force: true })
          .catch(() => undefined);
      }
    }
    throw error;
  }
}

async function tryRenameForCut(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult | null> {
  try {
    await context.fileSystem.mkdir(dirname(currentNode.destinationPath), { recursive: true });
    // Exclusive: an item that appeared at the destination is asked about, never replaced.
    await moveExclusive(
      context.fileSystem,
      currentNode.node.sourcePath,
      currentNode.destinationPath,
    );
  } catch (error) {
    const code = errorCode(error);
    if (code === "EXDEV") {
      return null; // Fall through to copy+delete path
    }
    throw code === "EEXIST" ? new DestinationTakenError(error) : error;
  }
  // Rename succeeded — count all items in the subtree as completed
  context.progress.completedItemCount += countExecutableSteps([currentNode]);
  context.progress.completedByteCount += sumSubtreeBytes([currentNode]);
  emitProgress(context, "running", currentNode, null);
  return {
    itemStatus: "completed",
    skipReason: null,
    error: null,
    destinationPath: currentNode.destinationPath,
    childItems: [],
  };
}

// rename(2) that never replaces anything at `to`: fails with EEXIST instead.
export async function moveExclusive(
  fileSystem: WriteServiceFileSystem,
  from: string,
  to: string,
): Promise<void> {
  if (fileSystem.renameExclusive) {
    await fileSystem.renameExclusive(from, to);
    return;
  }
  if (!fileSystem.rename) {
    throw new Error("Moving items isn't supported here.");
  }
  // Without an exclusive rename, check first: that leaves only a tiny window.
  if ((await captureFingerprint(fileSystem, to)).exists) {
    throw Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST", path: to });
  }
  await fileSystem.rename(from, to);
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
      // A folder's timestamps change whenever anything inside it does (Finder writes
      // .DS_Store just by showing it), so for folders only their identity counts.
      const unchanged =
        planned.kind === "directory" && currentDestinationFingerprint.kind === "directory"
          ? sameItemIdentity(planned, currentDestinationFingerprint)
          : fingerprintsEqual(planned, currentDestinationFingerprint);
      return unchanged
        ? null
        : conflict(
            planned.exists ? "destination_changed" : "destination_created",
            conflictClassFor(resolvedNode.node.sourceKind, currentDestinationFingerprint.kind),
            "destination",
          );
    }
    case "merge":
      if (!destinationExists) {
        // The folder to merge into was removed: recreating it silently would bring back
        // a folder someone just deleted.
        return conflict("destination_deleted", "directory_conflict", "destination");
      }
      return currentDestinationFingerprint.kind !== "directory"
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

// Refuses to replace an item that is, or contains, the item being pasted: removing it
// would destroy the source too (pasting "foo/foo" over "foo", or the same folder reached
// through a symlink or a different letter case).
async function assertDestinationDoesNotContainSource(
  currentNode: ResolvedCopyPasteNode,
  destination: NodeFingerprint,
  fileSystem: WriteServiceFileSystem,
): Promise<void> {
  const name = basename(currentNode.destinationPath);
  const relation = await findSourceRelation(
    fileSystem,
    currentNode.node.sourcePath,
    currentNode.destinationPath,
    destination,
  );
  if (relation === "same") {
    throw new Error(`“${name}” is the item being pasted, so it can't replace itself.`);
  }
  if (relation === "contains") {
    throw new Error(`Can't replace “${name}” because it contains the item being pasted.`);
  }
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
    return "It changed while it was being moved, so the original was kept.";
  }
  try {
    await fileSystem.rm(sourcePath, { recursive: false, force: false });
    return null;
  } catch (error) {
    return `It was copied, but the original couldn't be removed. ${describeCopyPasteError(error)}`;
  }
}

/** Attempts to remove an empty source directory after its children were moved.
 *  Returns null on success or intentional skip, or an error message if removal failed. */
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
  try {
    // rmdir only removes an empty folder, so anything left inside (skipped items, or
    // something added in the meantime) keeps the folder in place.
    await fileSystem.rmdir(sourcePath);
    return null;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOENT") {
      return null;
    }
    return `Its items were moved, but the original folder couldn't be removed. ${describeCopyPasteError(error)}`;
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

// `itemResults` holds the top-level items and the items surfaced from inside folders, so
// "nothing succeeded" also covers a folder whose every item failed.
function resolveTerminalStatus(args: {
  cancelled: boolean;
  itemResults: CopyPasteItemResult[];
}): Exclude<CopyPasteOperationStatus, "queued" | "running" | "awaiting_resolution"> {
  const anyCompleted = args.itemResults.some((item) => item.status === "completed");
  if (args.cancelled) {
    return anyCompleted ? "partial" : "cancelled";
  }
  if (args.itemResults.some((item) => item.status === "failed")) {
    return anyCompleted ? "partial" : "failed";
  }
  if (args.itemResults.some((item) => item.status === "skipped")) {
    return "partial";
  }
  return "completed";
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
    const code = errorCode(error);
    if (code === "ENOTSUP" || code === "EOPNOTSUPP") {
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
    const code = errorCode(error);
    if (code === "ENOTSUP" || code === "EOPNOTSUPP") {
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
    const code = errorCode(error);
    if (code === "ENOTSUP" || code === "EOPNOTSUPP") {
      return;
    }
    throw error;
  }
}
