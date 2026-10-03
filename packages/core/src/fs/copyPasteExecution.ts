import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

import { isAbortError } from "@filetrail/contracts";

import { analyzeItemAgain, classifyConflict } from "./copyPasteAnalysis";
import {
  LOCK_FLAGS,
  NO_TRASH_ERROR_CODE,
  USER_LOCK_FLAGS,
  describeCopyPasteError,
  errorCode,
  findLockedRefusal,
  isLocked,
  lockedMessage,
} from "./copyPasteErrors";
import {
  captureFingerprint,
  captureFolderFingerprint,
  findSourceRelation,
  fingerprintsEqual,
  holdsAnyOf,
  realItemPaths,
} from "./copyPasteFingerprint";
import {
  destinationPathKey,
  fitName,
  isAppleDoubleCompanionName,
  isFolderViewFile,
  resolveDuplicateName,
} from "./copyPasteNames";
import {
  type ResolvedCopyPasteNode,
  collectDestinationPathKeys,
  resolveSingleNodeWithAction,
} from "./copyPastePolicy";
import type {
  CopyPasteAnalysisNode,
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
  // Every destination this paste has written so far (`destinationPathKey`).
  writtenPaths: Set<string>;
  pastedItemRealPaths?: Promise<string[]>;
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
  const destinationFingerprint = await captureFolderFingerprint(
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
    writtenPaths: new Set(),
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
    for (let question = 1; runtimeConflict; question += 1) {
      if (question > MAX_RUNTIME_ATTEMPTS) {
        throw new Error(
          `“${basename(currentNode.node.sourcePath)}” kept changing, so it was left.`,
        );
      }
      assertNotWrittenByThisPaste(context, currentNode, runtimeConflict);
      const resolution = await answerRuntimeConflict(context, currentNode, runtimeConflict);
      // An answer about the item being pasted changing says nothing about the destination:
      // if that changed too, it is asked about on its own, never replaced unseen.
      const aboutSource = isSourceSideConflict(runtimeConflict);
      currentNode = await resolveWithRuntimeAnswer(
        context,
        currentNode,
        runtimeConflict,
        resolution,
        aboutSource,
      );
      if (currentNode.action === "skip") {
        return skippedOutcome("runtime_conflict_resolution", currentNode.destinationPath);
      }
      runtimeConflict = aboutSource
        ? await detectRuntimeConflict(currentNode, context.report.analysisId, context.fileSystem)
        : null;
    }
    try {
      const outcome = await performNode(context, currentNode);
      if (outcome.itemStatus !== "skipped") {
        context.writtenPaths.add(
          destinationPathKey(outcome.destinationPath, context.caseSensitive),
        );
      }
      return outcome;
    } catch (caught) {
      if (!(caught instanceof DestinationTakenError)) {
        // "You don't have permission" is the wrong reason when an item is locked.
        const error =
          (await findLockedRefusal(context.fileSystem, caught, [
            currentNode.node.sourcePath,
            currentNode.destinationPath,
            dirname(currentNode.destinationPath),
            dirname(currentNode.node.sourcePath),
          ])) ?? caught;
        if (typeof error === "object" && error !== null && !failedDestinations.has(error)) {
          failedDestinations.set(error, currentNode.destinationPath);
        }
        throw error;
      }
      const error = caught;
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

// Where the paste's items really are, looked up once per paste.
function pastedItemRealPaths(context: ExecutionContext): Promise<string[]> {
  context.pastedItemRealPaths ??= realItemPaths(context.fileSystem, context.report.sourcePaths);
  return context.pastedItemRealPaths;
}

function isSourceSideConflict(conflict: CopyPasteRuntimeConflict): boolean {
  return conflict.reason === "source_changed" || conflict.reason === "source_deleted";
}

// On a disk that doesn't tell "A.txt" from "a.txt", two items from a disk that does would
// land on one name: the second is never allowed to replace the first, which this same
// paste just wrote (its original may already be gone, after a move).
function assertNotWrittenByThisPaste(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  conflict: CopyPasteRuntimeConflict,
): void {
  if (isSourceSideConflict(conflict) || conflict.reason === "trash_unavailable") {
    return;
  }
  if (!context.writtenPaths.has(destinationPathKey(node.destinationPath, context.caseSensitive))) {
    return;
  }
  throw new Error(sameNameMessage(node));
}

function sameNameMessage(node: ResolvedCopyPasteNode): string {
  return `“${basename(node.node.sourcePath)}” wasn't pasted because another item of this paste has the same name on this disk, which doesn't tell upper and lower case apart.`;
}

// Continues from what is on disk now, which is what the person just decided on. After a
// question about the item being pasted, the destination stays as planned, so a change
// there is still noticed and asked about.
async function resolveWithRuntimeAnswer(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  conflict: CopyPasteRuntimeConflict,
  resolution: CopyPasteRuntimeResolutionAction,
  keepPlannedDestination = false,
): Promise<ResolvedCopyPasteNode> {
  const currentDestination = keepPlannedDestination
    ? node.node.destinationFingerprint
    : conflict.currentDestinationFingerprint;
  const source =
    resolution !== "skip" && keepPlannedDestination && conflict.currentSourceFingerprint.exists
      ? await readChangedSourceAgain(context, node, conflict.currentSourceFingerprint)
      : {
          ...node.node,
          sourceFingerprint: conflict.currentSourceFingerprint.exists
            ? conflict.currentSourceFingerprint
            : node.node.sourceFingerprint,
        };
  const conflictClass = currentDestination.exists
    ? await conflictClassFor(
        context.fileSystem,
        { path: source.sourcePath, kind: source.sourceKind },
        { path: node.destinationPath, kind: currentDestination.kind },
      )
    : null;
  if (resolution === "merge" && conflictClass !== "directory_conflict") {
    throw new Error(
      `“${basename(node.node.sourcePath)}” is no longer a folder, so it can't be merged and was left.`,
    );
  }
  return resolveSingleNodeWithAction({
    node: {
      ...source,
      destinationPath: node.destinationPath,
      destinationFingerprint: currentDestination,
      destinationKind: currentDestination.kind,
      conflictClass,
    },
    action: resolution,
    policy: context.policy,
    overrides: context.overrides,
    fileSystem: context.fileSystem,
    caseSensitive: context.caseSensitive,
    reservedPaths: context.reservedPaths,
  });
}

// The item being pasted changed after the review. A file whose contents changed is still
// the same file; anything else (a file saved as a package, a package saved anew under a
// new identity, a folder turned into a file) is read again, or the paste would write what
// the review saw: an empty folder for a new package, or a package missing its new files.
async function readChangedSourceAgain(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  current: NodeFingerprint,
): Promise<CopyPasteAnalysisNode> {
  const planned = node.node;
  if (current.kind === planned.sourceKind && current.kind !== "directory") {
    return { ...planned, sourceFingerprint: current };
  }
  const fresh = await analyzeItemAgain({
    id: planned.id,
    sourcePath: planned.sourcePath,
    destinationPath: node.destinationPath,
    fileSystem: context.fileSystem,
    caseSensitive: context.caseSensitive,
    signal: context.signal,
  });
  const withPlannedDestinations = await keepPlannedDestinations(context, fresh, planned);
  context.totalItemCount += Math.max(0, fresh.totalNodeCount - planned.totalNodeCount);
  return {
    ...withPlannedDestinations,
    keepBothDestinationPath: planned.keepBothDestinationPath,
    replaceBlockedReason: planned.replaceBlockedReason,
  };
}

// Items inside a re-read folder that the review also saw keep the destination it saw:
// one that changed there since is then still asked about, never replaced unseen.
async function keepPlannedDestinations(
  context: ExecutionContext,
  fresh: CopyPasteAnalysisNode,
  planned: CopyPasteAnalysisNode,
): Promise<CopyPasteAnalysisNode> {
  const plannedChildren = new Map(
    planned.children.map((child) => [basename(child.sourcePath), child]),
  );
  const children: CopyPasteAnalysisNode[] = [];
  for (const child of fresh.children) {
    const plannedChild = plannedChildren.get(basename(child.sourcePath));
    children.push(
      plannedChild ? await keepPlannedDestinations(context, child, plannedChild) : child,
    );
  }
  return {
    ...fresh,
    destinationFingerprint: planned.destinationFingerprint,
    destinationKind: planned.destinationKind,
    destinationTotalNodeCount: planned.destinationTotalNodeCount,
    destinationOnly: planned.destinationOnly,
    conflictClass: planned.destinationFingerprint.exists
      ? await conflictClassFor(
          context.fileSystem,
          { path: fresh.sourcePath, kind: fresh.sourceKind },
          { path: fresh.destinationPath, kind: planned.destinationKind },
        )
      : null,
    disposition: planned.destinationFingerprint.exists ? "conflict" : "new",
    children,
  };
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

  // A move copies, then removes the original. An original that can't be removed isn't
  // copied either: that would leave it in both places.
  if (context.mode === "cut") {
    await assertRemovableAfterCopy(context, currentNode, { deep: false });
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

// What a move to another disk will have to remove after copying: the item, and for a
// folder what is inside it. Refused before anything is copied when it can't be: an item
// that is locked or in a locked folder, or a folder that doesn't let items be removed
// from it. `deep` checks everything inside a folder now (a Replace stages the whole folder
// before removing anything); otherwise each item is checked when its turn comes.
async function assertRemovableAfterCopy(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  options: { deep: boolean },
): Promise<void> {
  const { fileSystem } = context;
  const sourcePath = node.node.sourcePath;
  const parentPath = dirname(sourcePath);
  for (const path of [sourcePath, parentPath]) {
    if (await isLocked(fileSystem, path)) {
      throw new Error(lockedMessage(path));
    }
  }
  await assertCanRemoveFrom(fileSystem, parentPath, sourcePath);
  if (node.node.sourceKind !== "directory") {
    return;
  }
  await assertCanRemoveFrom(fileSystem, sourcePath, sourcePath);
  if (options.deep) {
    for (const child of node.children) {
      if (child.action !== "skip") {
        await assertRemovableAfterCopy(context, child, options);
      }
    }
  }
}

async function assertCanRemoveFrom(
  fileSystem: WriteServiceFileSystem,
  folderPath: string,
  itemPath: string,
): Promise<void> {
  if (!fileSystem.canModifyFolder) {
    return;
  }
  try {
    await fileSystem.canModifyFolder(folderPath);
  } catch (error) {
    const code = errorCode(error);
    if (code === "EROFS") {
      throw new Error(`“${basename(itemPath)}” wasn't moved, because its disk is read-only.`);
    }
    if (code === "EACCES" || code === "EPERM") {
      const what =
        folderPath === itemPath ? "what is inside it" : `it from “${basename(folderPath)}”`;
      throw new Error(
        `“${basename(itemPath)}” wasn't moved, because you don't have permission to remove ${what}.`,
      );
    }
    // Anything else (the folder just went away) is left for the move itself to report.
  }
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
    try {
      await context.fileSystem.symlink(linkTarget, targetPath);
    } catch (error) {
      throw errorCode(error) === "EEXIST"
        ? new DestinationTakenError(error)
        : await explainMissingFolder(context.fileSystem, targetPath, error);
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
  // A copy that worked isn't reported as failed over its mode or dates.
  await preserveModeIfSupported(
    context.fileSystem,
    targetPath,
    node.node.sourceFingerprint.mode,
  ).catch(() => undefined);
  await preserveTimestampsIfSupported(
    context.fileSystem,
    targetPath,
    node.node.sourceFingerprint.mtimeMs,
  ).catch(() => undefined);
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
    try {
      // Not recursive: a folder that appeared in the meantime must not be merged into
      // without asking, and one that was deleted (the folder pasted into) isn't made again.
      await context.fileSystem.mkdir(currentNode.destinationPath);
    } catch (error) {
      throw errorCode(error) === "EEXIST"
        ? new DestinationTakenError(error)
        : await explainMissingFolder(context.fileSystem, currentNode.destinationPath, error);
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
  // and a read-only or locked folder can't take new items. As for a file, a folder whose
  // items were written isn't reported as failed over its dates or permissions (some
  // network volumes refuse them), and what was done inside it is never dropped.
  if (createsDirectory) {
    await applyDirectoryMetadata(context, currentNode).catch(() => undefined);
  }
  let dirDeleteError: string | null = null;
  if (context.mode === "cut") {
    dirDeleteError = await tryRemoveEmptySourceDirectory(currentNode, context.fileSystem);
  } else {
    dirDeleteError = await describeAddedDuringCopy(currentNode, context.fileSystem);
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
  if (
    destination.kind === "directory" &&
    (await holdsAnyOf(fileSystem, finalPath, await pastedItemRealPaths(context)))
  ) {
    throw new Error(
      `Can't replace “${basename(finalPath)}” because it contains another item being pasted.`,
    );
  }
  // A locked item can't go to the Trash; found out now, before anything is written.
  if (await isLocked(fileSystem, finalPath)) {
    throw new Error(lockedMessage(finalPath));
  }

  if (!fileSystem.rename) {
    // Nothing can be swapped into place without rename: clear the way first instead.
    if ((await removeReplacedItem(context, currentNode, destination)) === "skipped") {
      return skippedOutcome("runtime_conflict_resolution", finalPath);
    }
    return performNode(context, { ...currentNode, action: "create" });
  }

  // A move that copies (to another disk) removes the originals only after the swap, and
  // the copy is staged as a plain copy: everything it will have to remove is checked now,
  // or the old item would go to the Trash for a move that leaves the original in place.
  if (context.mode === "cut" && !canRenameForCut(context, currentNode)) {
    await assertRemovableAfterCopy(context, currentNode, { deep: true });
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
    // An item inside that changed and was skipped would be in neither the new folder nor,
    // once the old one is in the Trash, where it was: the old folder is kept instead.
    const skippedInside = stagedChildItems.find(
      (item) => item.skipReason === "runtime_conflict_resolution",
    );
    if (stagedOutcome.itemStatus !== "failed" && skippedInside) {
      await undoStaging().catch(() => undefined);
      return {
        itemStatus: "failed",
        skipReason: null,
        error: `“${basename(finalPath)}” wasn't replaced because “${basename(skippedInside.sourcePath)}” in it changed and was skipped.`,
        destinationPath: finalPath,
        childItems: [],
      };
    }
    if (stagedOutcome.itemStatus !== "failed") {
      // Complete now: once the old item is in the Trash, this copy is the one to keep.
      try {
        await journal?.add({ ...journalEntry, staged: true });
      } catch (error) {
        await undoStaging().catch(() => undefined);
        throw error;
      }
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

  let oldItemRemoved = false;
  try {
    // A copy of a locked item is locked too, and a locked item can't be renamed: it is
    // unlocked for the swap and locked again after. Done before the old item goes.
    const stagedFlags = await unlockForMove(fileSystem, temporaryPath);
    if ((await removeReplacedItem(context, currentNode, destination)) === "skipped") {
      await undoStaging();
      return skippedOutcome("runtime_conflict_resolution", finalPath);
    }
    oldItemRemoved = true;
    try {
      await moveExclusive(fileSystem, temporaryPath, finalPath);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw error;
      }
      // The old item is in the Trash already: the new one must not be thrown away too.
      // It is kept under a visible name next to where it was going.
      const visiblePath = await resolveDuplicateName(
        basename(finalPath),
        dirname(finalPath),
        fileSystem,
        context.reservedPaths,
        {
          isDirectory: currentNode.node.sourceKind === "directory",
          caseSensitive: context.caseSensitive,
        },
      );
      await moveExclusive(fileSystem, temporaryPath, visiblePath);
      await journal?.remove(journalEntry.id).catch(() => undefined);
      return {
        itemStatus: "failed",
        skipReason: null,
        error: `The old “${basename(finalPath)}” was moved to the Trash, but the new one couldn't take its name, so it was saved as “${basename(visiblePath)}”. ${describeCopyPasteError(error)}`,
        destinationPath: visiblePath,
        childItems: stagedChildItems,
      };
    }
    if (stagedFlags !== null) {
      await fileSystem.setFlags?.(finalPath, stagedFlags).catch(() => undefined);
    }
  } catch (error) {
    if (oldItemRemoved && journal && errorCode(error) !== "EEXIST") {
      // Neither name could be used: the journal keeps the new item, and the next start
      // puts it in place.
      throw new Error(
        `The old “${basename(finalPath)}” was moved to the Trash, but the new one couldn't be put in its place. It will be put there the next time File Trail starts. ${describeCopyPasteError(error)}`,
      );
    }
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
    return tryRemoveEmptySourceDirectory(current, context.fileSystem);
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
    } catch (error) {
      // Only a disk that may have no Trash (a network or FAT volume) is asked about below;
      // any other reason stops this item, and nothing is deleted for good.
      if (errorCode(error) !== NO_TRASH_ERROR_CODE) {
        throw error;
      }
    }
  }
  const conflict: CopyPasteRuntimeConflict = {
    conflictId: `runtime-${node.node.id}-trash`,
    analysisId: context.report.analysisId,
    sourcePath: node.node.sourcePath,
    destinationPath: node.destinationPath,
    sourceKind: node.node.sourceKind,
    destinationKind: destination.kind,
    conflictClass: await conflictClassFor(
      fileSystem,
      { path: node.node.sourcePath, kind: node.node.sourceKind },
      { path: node.destinationPath, kind: destination.kind },
    ),
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
  // Deleting a folder for good stops at the first locked item inside, leaving it half
  // deleted: one is looked for first, and then nothing is deleted.
  if (destination.kind === "directory") {
    const locked = await findLockedInside(fileSystem, node.destinationPath);
    if (locked !== null) {
      throw new Error(lockedMessage(locked));
    }
  }
  await fileSystem.rm(node.destinationPath, {
    recursive: destination.kind === "directory",
    force: true,
  });
  return "removed";
}

// The first locked item inside a folder, at any depth, or null.
async function findLockedInside(
  fileSystem: WriteServiceFileSystem,
  folderPath: string,
): Promise<string | null> {
  if (!fileSystem.getFlags) {
    return null;
  }
  const names = await fileSystem.readdir(folderPath).catch(() => [] as string[]);
  for (const name of names) {
    const path = join(folderPath, name);
    if (await isLocked(fileSystem, path)) {
      return path;
    }
    const stats = await fileSystem.lstat(path).catch(() => null);
    if (stats?.isDirectory()) {
      const inside = await findLockedInside(fileSystem, path);
      if (inside !== null) {
        return inside;
      }
    }
  }
  return null;
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

// Clears the lock (Finder's "Locked") on an item about to be renamed, and returns the
// flags to put back once it has its new name; null when it wasn't locked. An item locked
// in a way its owner can't undo is refused here, before anything else changes.
export async function unlockForMove(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<number | null> {
  if (!fileSystem.getFlags || !fileSystem.setFlags) {
    return null;
  }
  const flags = await fileSystem.getFlags(path).catch(() => 0);
  if ((flags & LOCK_FLAGS) === 0) {
    return null;
  }
  if ((flags & LOCK_FLAGS & ~USER_LOCK_FLAGS) !== 0) {
    throw new Error(lockedMessage(path));
  }
  await fileSystem.setFlags(path, flags & ~USER_LOCK_FLAGS);
  return flags;
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
    if ((code !== "EACCES" && code !== "EPERM") || (!fileSystem.chmod && !fileSystem.setFlags)) {
      throw error;
    }
  }
  await makeFoldersWritable(fileSystem, path);
  await fileSystem.rm(path, { recursive: true, force: true });
}

// Opens up a hidden copy so it can be removed: locked items (a copy of a locked item is
// locked too) are unlocked and read-only folders made writable.
async function makeFoldersWritable(fileSystem: WriteServiceFileSystem, path: string) {
  if (fileSystem.getFlags && fileSystem.setFlags) {
    const flags = await fileSystem.getFlags(path).catch(() => 0);
    if ((flags & USER_LOCK_FLAGS) !== 0) {
      await fileSystem.setFlags(path, flags & ~USER_LOCK_FLAGS).catch(() => undefined);
    }
  }
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

// A file is written under a hidden name next to its place, and takes its name only once it
// is complete: quitting, a crash or a disk that stops answering part way never leaves a
// cut-short file under the real name, where it would pass for the whole one.
async function copyFileContents(
  context: ExecutionContext,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const { fileSystem } = context;
  if (!fileSystem.renameExclusive && !fileSystem.rename) {
    await writeFileContents(context, sourcePath, targetPath);
    return;
  }
  if ((await captureFingerprint(fileSystem, targetPath)).exists) {
    throw new DestinationTakenError(
      Object.assign(new Error(`EEXIST: ${targetPath}`), { code: "EEXIST", path: targetPath }),
    );
  }
  const partialPath = await temporarySiblingPath(fileSystem, targetPath);
  await writeFileContents(context, sourcePath, partialPath);
  try {
    // A copy of a locked file is locked too, and a locked file can't be renamed.
    const flags = await unlockForMove(fileSystem, partialPath);
    await moveExclusive(fileSystem, partialPath, targetPath);
    if (flags !== null) {
      await fileSystem.setFlags?.(targetPath, flags).catch(() => undefined);
    }
  } catch (error) {
    await removeStagedItem(fileSystem, partialPath).catch(() => undefined);
    throw errorCode(error) === "EEXIST"
      ? new DestinationTakenError(error)
      : await explainMissingFolder(fileSystem, targetPath, error);
  }
}

async function writeFileContents(
  context: ExecutionContext,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  const before = await captureFingerprint(context.fileSystem, targetPath);
  try {
    if (context.fileSystem.copyFile) {
      await context.fileSystem.copyFile(sourcePath, targetPath, context.signal);
    } else {
      await context.fileSystem.copyFileStream(sourcePath, targetPath, context.signal);
    }
  } catch (error) {
    if (errorCode(error) === "EEXIST") {
      throw new DestinationTakenError(error);
    }
    if (errorCode(error) === "ENOENT") {
      throw await explainMissingFolder(context.fileSystem, targetPath, error);
    }
    if (errorCode(error) === "ENOTSUP" || errorCode(error) === "EOPNOTSUPP") {
      const source = await context.fileSystem.lstat(sourcePath).catch(() => null);
      if (source && !source.isFile() && !source.isDirectory() && !source.isSymbolicLink()) {
        throw new Error(
          `“${basename(sourcePath)}” is a special file (such as a pipe or a socket), which can't be copied.`,
        );
      }
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
    throw code === "EEXIST"
      ? new DestinationTakenError(error)
      : await explainMissingFolder(context.fileSystem, currentNode.destinationPath, error);
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

// ENOENT while writing an item can mean the item being pasted is gone, or the folder it
// was going into is (deleted while the paste ran; it is never made again). The second is
// said as such, naming the folder.
async function explainMissingFolder(
  fileSystem: WriteServiceFileSystem,
  targetPath: string,
  error: unknown,
): Promise<unknown> {
  if (errorCode(error) !== "ENOENT") {
    return error;
  }
  const folder = await captureFingerprint(fileSystem, dirname(targetPath));
  return folder.exists
    ? error
    : new Error(`The folder “${basename(dirname(targetPath))}” no longer exists.`);
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

// The clash an item has with what is at its destination, as the review would classify
// it (two packages are replaced whole, never merged).
async function conflictClassFor(
  fileSystem: WriteServiceFileSystem,
  source: { path: string; kind: Exclude<CopyPasteNodeKind, "missing"> },
  destination: { path: string; kind: CopyPasteNodeKind },
): Promise<CopyPasteConflictClass> {
  return (await classifyConflict(fileSystem, source, destination)) ?? "type_mismatch";
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
            await conflictClassFor(
              fileSystem,
              { path: resolvedNode.node.sourcePath, kind: resolvedNode.node.sourceKind },
              { path: resolvedNode.destinationPath, kind: currentDestinationFingerprint.kind },
            ),
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
      // .DS_Store just by showing it), so for folders their identity counts, and what is
      // inside them: an item added after the review would go to the Trash unseen.
      const unchanged =
        planned.kind === "directory" && currentDestinationFingerprint.kind === "directory"
          ? sameItemIdentity(planned, currentDestinationFingerprint) &&
            (resolvedNode.node.destinationTotalNodeCount === null ||
              (await countItemsInside(fileSystem, resolvedNode.destinationPath)) ===
                resolvedNode.node.destinationTotalNodeCount)
          : fingerprintsEqual(planned, currentDestinationFingerprint);
      return unchanged
        ? null
        : conflict(
            planned.exists ? "destination_changed" : "destination_created",
            await conflictClassFor(
              fileSystem,
              { path: resolvedNode.node.sourcePath, kind: resolvedNode.node.sourceKind },
              { path: resolvedNode.destinationPath, kind: currentDestinationFingerprint.kind },
            ),
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

// How many items a folder holds at every depth, counted as the review counted them
// (`countDirectoryItems`); null when some of it can't be read.
async function countItemsInside(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<number | null> {
  let entries: string[];
  try {
    entries = await fileSystem.readdir(path);
  } catch {
    return null;
  }
  let count = 0;
  for (const entry of entries) {
    if (isFolderViewFile(entry)) {
      continue;
    }
    count += 1;
    const stats = await fileSystem.lstat(join(path, entry)).catch(() => null);
    if (stats === null) {
      return null;
    }
    if (stats.isDirectory()) {
      const nested = await countItemsInside(fileSystem, join(path, entry));
      if (nested === null) {
        return null;
      }
      count += nested;
    }
  }
  return count;
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
  node: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
): Promise<string | null> {
  const sourcePath = node.node.sourcePath;
  const currentFingerprint = await captureFingerprint(fileSystem, sourcePath);
  if (!currentFingerprint.exists) {
    return null;
  }
  if (!canRemoveMovedSourceDirectory(node.node.sourceFingerprint, currentFingerprint)) {
    // Its permissions changed, or it was swapped for another folder: it isn't removed, and
    // "moved" mustn't hide that it is still there.
    return `Its items were moved, but the original “${basename(sourcePath)}” changed during the move, so it was kept.`;
  }
  try {
    // rmdir only removes an empty folder, so anything left inside (skipped items, or
    // something added in the meantime) keeps the folder in place.
    await fileSystem.rmdir(sourcePath);
    return null;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return null;
    }
    if (code === "ENOTEMPTY" || code === "EEXIST") {
      return describeLeftInMovedFolder(node, fileSystem);
    }
    return `Its items were moved, but the original folder couldn't be removed. ${describeCopyPasteError(error)}`;
  }
}

// A moved folder that isn't empty afterwards: items this move left on purpose (skipped,
// failed) are reported on their own; items added to it while it was being moved were
// never part of the move, and are named here so "moved" doesn't hide them.
async function describeLeftInMovedFolder(
  node: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
): Promise<string | null> {
  const plannedNames = new Set(node.children.map((child) => basename(child.node.sourcePath)));
  const entries = await fileSystem.readdir(node.node.sourcePath).catch(() => [] as string[]);
  // Nobody's items: what Finder wrote to show the folder, and the AppleDouble files of
  // items that were moved (FAT, exFAT, SMB).
  const isLeftover = (entry: string) =>
    isFolderViewFile(entry) || isAppleDoubleCompanionName(entry, plannedNames);
  if (entries.length > 0 && entries.every(isLeftover)) {
    // They go with the folder. Only when nothing else keeps it: a folder that stays
    // (skipped or failed items in it) keeps its view settings too.
    for (const entry of entries) {
      await fileSystem
        .rm(join(node.node.sourcePath, entry), { force: true })
        .catch(() => undefined);
    }
    await fileSystem.rmdir(node.node.sourcePath).catch(() => undefined);
    return null;
  }
  const newItems = entries.filter((entry) => !plannedNames.has(entry) && !isLeftover(entry));
  if (newItems.length === 0) {
    return null;
  }
  const folder = basename(node.node.sourcePath);
  const named = newItems.length === 1 ? `“${newItems[0]}” was` : `${newItems.length} items were`;
  return `${named} added to “${folder}” while it was being moved, so ${newItems.length === 1 ? "it was" : "they were"} left in the original “${folder}”.`;
}

// Items put into a folder after the review were never part of the copy: they are named,
// as for a move, so "copied" doesn't claim a folder whose copy lacks them.
async function describeAddedDuringCopy(
  node: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
): Promise<string | null> {
  const newItems = await findItemsAddedSinceReview(node, fileSystem);
  if (newItems.length === 0) {
    return null;
  }
  const folder = basename(node.node.sourcePath);
  const named = newItems.length === 1 ? `“${newItems[0]}” was` : `${newItems.length} items were`;
  return `${named} added to “${folder}” after the copy began, so ${newItems.length === 1 ? "it wasn't" : "they weren't"} copied.`;
}

async function findItemsAddedSinceReview(
  node: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
): Promise<string[]> {
  // A folder the review couldn't read has no plan to compare with.
  if (node.node.issueCode === "source_unreadable") {
    return [];
  }
  const plannedNames = new Set(node.children.map((child) => basename(child.node.sourcePath)));
  const entries = await fileSystem.readdir(node.node.sourcePath).catch(() => [] as string[]);
  return entries.filter(
    (entry) =>
      !plannedNames.has(entry) &&
      !isFolderViewFile(entry) &&
      !isAppleDoubleCompanionName(entry, plannedNames),
  );
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
  // The items picked, not what is inside the folders among them ("Photos", not "Photos and
  // 3 more" for one folder holding three files).
  const pickedPaths = new Set(args.report.nodes.map((node) => node.sourcePath));
  const topLevelItemCount = args.items.filter((item) => pickedPaths.has(item.sourcePath)).length;
  return {
    operationId: args.operationId,
    mode: args.mode,
    status: args.status,
    destinationDirectoryPath: args.report.destinationDirectoryPath,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    summary: {
      topLevelItemCount,
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
