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
  isAnyOf,
  realItemPaths,
} from "./copyPasteFingerprint";
import {
  destinationPathKey,
  fitName,
  isAppleDoubleCompanionName,
  isFolderViewFile,
  isPackageFolder,
  resolveDuplicateName,
} from "./copyPasteNames";
import {
  type ResolvedCopyPasteNode,
  collectDestinationPathKeys,
  resolveSingleNodeWithAction,
} from "./copyPastePolicy";
import {
  type CantUndoReason,
  type ItemId,
  type ItemKind,
  type UndoLog,
  type UndoStep,
  type UndoUnit,
  itemIdOf,
  readFolderIdOnce,
  readItemId,
  readItemIdAndStamp,
  stampWithoutId,
} from "./undoLog";
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
  ReplaceJournalEntry,
  WriteJournal,
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
  writeJournal: WriteJournal | null;
  // Folder listings read once per paste (see readFolderListing).
  folderListings: Map<string, FolderListing>;
  // What this paste did, for Undo. Shared by every step, like `progress`.
  undo: UndoRecorder;
  // The ids of the folders items were in, read once per paste (see readFolderIdOnce).
  folderIds: Map<string, Promise<ItemId | null>>;
  // False while a Replace builds its new item under a hidden name: that isn't a step
  // anyone could undo, only the swap that follows is.
  recordsUndo: boolean;
  // While an item is built under a hidden name (a Replace's new item, or a folder copied
  // or moved to another disk, see executeStagedDirectory): what the paste is ("cut" for a
  // move). What is inside is then written straight in, never built aside again.
  stagingFor: CopyPasteMode | null;
  // The folder being built under a hidden name, whose own metadata waits until it has its
  // real name: a copied rule against deleting it (a copy of ~/Documents has one) would keep
  // it from being renamed into place.
  metadataLaterFor: string | null;
  // The folder made already, under a name of its own reserved for it (see
  // reserveStagingFolder): it is filled, not made again.
  folderMadeAt: string | null;
  // Where the items a Replace moved out of the way went in the Trash, which they changed.
  // Shared by every step, like `progress`.
  trashedPaths: string[];
  replacedPaths: string[];
  // The files and links a move to another disk copied under a hidden name, by the path of
  // their original: each original is removed only once its copy is checked (see
  // removeMovedSources). Shared by every step, like `progress`.
  copiedForMove: Map<string, CopiedItem>;
  // The folders a move copied whose own metadata (tags, flags, ACLs) the copy couldn't take,
  // by the path of their original: the original keeps it, so it isn't removed.
  metadataNotCopied: Set<string>;
};

// An item a move to another disk copied: where (`path`), and the copy as it was written. The
// copy must still be that item, as large, before its original goes. `source` is the original
// as it was copied, a change the person agreed to go on with included.
type CopiedItem = { path: string; written: NodeFingerprint; source: NodeFingerprint };

// Steps are kept only for the items the person picked: undoing one undoes everything
// inside it. A merge, a move to another disk or a permanent delete anywhere makes the
// whole paste one that can't be undone, but only once it has changed something: a merge
// whose items were all there already leaves Undo as it was.
type UndoRecorder = {
  topLevelNodeIds: ReadonlySet<string>;
  // The steps of the picked item being worked on, or null between items.
  unit: RecordingStep[] | null;
  units: UndoUnit[];
  cantUndo: CantUndoReason | null;
  // Why the picked item being worked on can't be undone, should it change anything.
  pendingCantUndo: CantUndoReason | null;
};

// A step of the picked item being worked on. A file it made has its id read when the item
// is done, in the same look as its stamp (see closeUndoUnit).
type RecordingStep = UndoStep | { kind: "createdFile"; path: string };

// Part of an item being built under a hidden name couldn't be cleared away (an incomplete
// package inside it): the whole hidden copy is given up, never put in place.
class StagingCleanupError extends Error {
  constructor(readonly original: unknown) {
    super(describeCopyPasteError(original));
  }
}

// Something appeared at the destination while writing to it (EEXIST). Handled like a
// runtime conflict: the person decides what happens to the item.
class DestinationTakenError extends Error {
  constructor(readonly original: unknown) {
    super(original instanceof Error ? original.message : String(original));
  }
}

// What was done inside a folder, for the result: its items, with the lists of the folders
// in it kept as they are, so a deep item isn't copied again at every folder above it. Made
// one list once, at the end (see appendItems).
type ItemList = (CopyPasteItemResult | ItemList)[];

// A stop inside a folder, carrying what was already done inside it for the result.
class CancelledWithItemsError extends Error {
  override name = "AbortError";
  constructor(readonly childItems: ItemList) {
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
  writeJournal?: WriteJournal;
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
    writeJournal: args.writeJournal ?? null,
    stagingFor: null,
    metadataLaterFor: null,
    folderMadeAt: null,
    folderListings: new Map(),
    undo: {
      topLevelNodeIds: new Set(args.resolvedNodes.map((node) => node.node.id)),
      unit: null,
      units: [],
      cantUndo: null,
      pendingCantUndo: null,
    },
    folderIds: new Map(),
    recordsUndo: true,
    trashedPaths: [],
    replacedPaths: [],
    copiedForMove: new Map(),
    metadataNotCopied: new Set(),
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
    context.undo.unit = [];
    try {
      const outcome = await executeResolvedNode(context, node);
      itemResults.push(outcomeItemResult(node, outcome));
      // Surface children (files, and folders that failed) in the result.
      appendItems(itemResults, outcome.childItems);
    } catch (error) {
      if (isAbortError(error) || args.signal.aborted) {
        cancelled = true;
        itemResults.push(itemResult(node, "cancelled", CANCELLED_MESSAGE));
        if (error instanceof CancelledWithItemsError) {
          appendItems(itemResults, error.childItems);
        }
        recordNotStarted(args.resolvedNodes.slice(nodeIndex + 1));
        break;
      }
      const message = describeCopyPasteError(error);
      encounteredError ??= error instanceof Error ? error : new Error(message);
      itemResults.push(failedItemResult(node, error, message));
      // Keep going: one failed item must not stop the rest of the operation.
    } finally {
      // What was done for this item counts, even when it then failed or was stopped.
      await closeUndoUnit(context);
    }
  }

  const status = resolveTerminalStatus({ cancelled, itemResults });
  const undoLog: UndoLog =
    context.undo.cantUndo !== null
      ? { undoable: false, reason: context.undo.cantUndo }
      : { undoable: true, units: context.undo.units };
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
    result: {
      ...result,
      ...(context.trashedPaths.length > 0 ? { trashedPaths: context.trashedPaths } : {}),
      ...(context.replacedPaths.length > 0 ? { replacedPaths: context.replacedPaths } : {}),
      undoLog,
    },
  });
}

// Ends the steps of the picked item just worked on. What it made is looked at now, once
// all of it is in place (a folder's date is set last), for Undo to tell if it changes.
async function closeUndoUnit(context: ExecutionContext): Promise<void> {
  const steps = context.undo.unit;
  context.undo.unit = null;
  context.undo.pendingCantUndo = null;
  if (steps === null || steps.length === 0) {
    return;
  }
  const stamped: UndoStep[] = [];
  for (const step of steps) {
    if (step.kind === "created" || step.kind === "createdFile") {
      const now = await readItemIdAndStamp(context.fileSystem, step.path);
      stamped.push({
        kind: "created",
        path: step.path,
        id: step.kind === "created" ? step.id : now.id,
        stamp: now.stamp,
      });
    } else {
      stamped.push(step);
    }
  }
  context.undo.units.push({ steps: stamped });
}

function markCantUndo(context: ExecutionContext, reason: CantUndoReason): void {
  context.undo.cantUndo ??= reason;
}

// The picked item can't be undone if it goes on to change anything (see noteChanged).
function expectCantUndo(context: ExecutionContext, reason: CantUndoReason): void {
  context.undo.pendingCantUndo ??= reason;
}

// Something was written or removed for the picked item. Not while a Replace builds its
// new item under a hidden name: that is taken away again if the Replace doesn't happen.
function noteChanged(context: ExecutionContext): void {
  if (context.recordsUndo && context.undo.pendingCantUndo !== null) {
    markCantUndo(context, context.undo.pendingCantUndo);
  }
}

// Adds a step to the picked item's steps. Steps inside it (a file in a copied folder) are
// left out: undoing the item undoes them.
function recordUndoStep(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  step: RecordingStep,
): void {
  if (
    context.recordsUndo &&
    context.undo.unit !== null &&
    context.undo.topLevelNodeIds.has(node.node.id)
  ) {
    context.undo.unit.push(step);
  }
}

async function recordCreated(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  path: string,
): Promise<void> {
  if (!context.recordsUndo || !context.undo.topLevelNodeIds.has(node.node.id)) {
    return;
  }
  // A folder's id is read now: filling it can take long, and what is at its path once it
  // is done may by then be another item. A file is done right away.
  recordUndoStep(
    context,
    node,
    node.node.sourceKind === "directory"
      ? { kind: "created", path, id: await readItemId(context.fileSystem.lstat, path), stamp: null }
      : { kind: "createdFile", path },
  );
}

// `moved` is the item as the check just before the move saw it: a move on one disk keeps
// the item's id, so it isn't read again at its new place.
async function recordMoved(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  to: string,
  moved: NodeFingerprint,
): Promise<void> {
  if (!context.recordsUndo || !context.undo.topLevelNodeIds.has(node.node.id)) {
    return;
  }
  const from = node.node.sourcePath;
  recordUndoStep(context, node, {
    kind: "moved",
    from,
    to,
    id: fingerprintId(moved),
    itemKind: fingerprintItemKind(moved),
    parentId: await readFolderIdOnce(context.folderIds, context.fileSystem.stat, dirname(from)),
  });
}

function fingerprintId(fingerprint: NodeFingerprint): ItemId | null {
  return fingerprint.dev !== null && fingerprint.ino !== null
    ? { dev: fingerprint.dev, ino: fingerprint.ino }
    : null;
}

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;

// The kind as kindOfStats reads it: a fingerprint takes anything that isn't a folder or a
// link (a FIFO, a socket) for a file; its mode says what it really is.
function fingerprintItemKind(fingerprint: NodeFingerprint): ItemKind | null {
  if (fingerprint.kind === "missing") {
    return null;
  }
  const type = (fingerprint.mode ?? 0) & S_IFMT;
  return fingerprint.kind === "file" && type !== 0 && type !== S_IFREG ? "other" : fingerprint.kind;
}

type ExecuteNodeResult = {
  itemStatus: "completed" | "skipped" | "failed";
  skipReason: "planned_conflict_policy" | "runtime_conflict_resolution" | null;
  error: string | null;
  // Where the item ended up (or was headed), after any runtime answer.
  destinationPath: string;
  // Children to surface in the result (files, and folders that failed themselves).
  childItems: ItemList;
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
  const childFailureCount = countFailedItems(outcome.childItems);
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

  let check = await detectRuntimeConflict(
    currentNode,
    context.report.analysisId,
    context.fileSystem,
  );
  for (let attempt = 1; ; attempt += 1) {
    for (let question = 1; check.conflict; question += 1) {
      const runtimeConflict = check.conflict;
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
      check = aboutSource
        ? await detectRuntimeConflict(currentNode, context.report.analysisId, context.fileSystem)
        : { ...check, conflict: null };
    }
    try {
      const outcome = await performNode(context, currentNode, check.source);
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
      check = await detectRuntimeConflict(
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

// Where the paste's items really are, looked up once per paste. The items the review
// planned, as it decided which items Replace can't take: one left out of the paste (moved
// into the folder it is in already) isn't pasted.
function pastedItemRealPaths(context: ExecutionContext): Promise<string[]> {
  context.pastedItemRealPaths ??= realItemPaths(
    context.fileSystem,
    context.report.nodes.map((node) => node.sourcePath),
  );
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

// `source` is the item being pasted as the check just before saw it.
async function performNode(
  context: ExecutionContext,
  resolvedNode: ResolvedCopyPasteNode,
  source: NodeFingerprint,
): Promise<ExecuteNodeResult> {
  let currentNode = resolvedNode;
  if (currentNode.action === "overwrite") {
    const destination = await captureFingerprint(context.fileSystem, currentNode.destinationPath);
    if (destination.exists) {
      return executeReplace(context, currentNode, destination, source);
    }
    // Gone already: nothing is left to replace, so this simply becomes a copy (or a move),
    // made the way any other is.
    currentNode = { ...currentNode, action: "create" };
  }

  // Same-filesystem rename fast path: use rename(2) for cut operations when
  // source and destination are on the same device. Skipped for merge actions
  // (can't atomically rename a directory into an existing one).
  if (canRenameForCut(context, currentNode)) {
    const renameResult = await tryRenameForCut(context, currentNode, source);
    if (renameResult) {
      return renameResult;
    }
    // EXDEV fallback: rename failed, fall through to copy+delete path
  }

  // A move copies, then removes the original. An original that can't be removed isn't
  // copied either: that would leave it in both places.
  if (context.mode === "cut") {
    await assertRemovableAfterCopy(context, currentNode, { deep: false });
    // A folder merged into isn't copied itself: its items are, each moved as its own disk
    // allows.
    if (currentNode.action !== "merge") {
      expectCantUndo(context, "other_disk_move");
    }
  }

  if (currentNode.node.sourceKind === "directory") {
    // A folder whose contents couldn't be read is left where it is; the rest goes on.
    if (currentNode.node.issueCode === "source_unreadable") {
      throw new Error(unreadableFolderMessage(context.mode, currentNode.node.issueMessage));
    }
    if (
      context.stagingFor === null &&
      (currentNode.action === "create" || currentNode.action === "keep_both") &&
      (context.fileSystem.renameExclusive !== undefined || context.fileSystem.rename !== undefined)
    ) {
      return executeStagedDirectory(context, currentNode);
    }
    return executeDirectoryNode(context, currentNode);
  }
  return executeLeafNode(context, currentNode);
}

// A folder copied, or moved to another disk, is built whole under a hidden name next to
// where it goes (written down, for a crash), then given its name: stopped, or a move that
// couldn't copy everything, leaves nothing half done in either place, and a move removes
// the originals only once the folder is in place. A copy of an ordinary folder that
// couldn't copy everything is put in place with what it has, its failures named; a package
// (a Keynote document, an app) is put in place whole or not at all.
async function executeStagedDirectory(
  context: ExecutionContext,
  currentNode: ResolvedCopyPasteNode,
): Promise<ExecuteNodeResult> {
  const { fileSystem } = context;
  const finalPath = currentNode.destinationPath;
  const name = basename(finalPath);
  // Everything it will remove is checked before anything is copied: a move that couldn't
  // remove its originals would leave them in both places.
  if (context.mode === "cut") {
    await assertRemovableAfterCopy(context, currentNode, { deep: true });
  }
  // Made now, under a name nothing else has: only what this paste made is ever removed.
  const reserved = await reserveStagingFolder(fileSystem, finalPath);
  const temporaryPath = reserved.path;
  const journal = context.writeJournal;
  const journalEntry = {
    id: randomBytes(8).toString("hex"),
    stagingPath: temporaryPath,
    finalPath,
    sourcePath: currentNode.node.sourcePath,
    moved: false,
    staged: false,
    ...(reserved.id ? { stagingId: reserved.id } : {}),
    ...(reserved.bornMs !== null ? { stagingBornMs: reserved.bornMs } : {}),
    ...(sourceIdOf(currentNode) ? { sourceId: sourceIdOf(currentNode) as ItemId } : {}),
    ...(context.mode === "cut" ? { movingCopy: true as const } : {}),
  };
  try {
    await journal?.add(journalEntry);
  } catch (error) {
    await removeOwnStaging(fileSystem, temporaryPath, reserved.id).catch(() => undefined);
    throw error;
  }
  // Whether the record says the hidden copy is complete, which the next start puts in place.
  let recordedComplete = false;
  // Its record goes only once it is gone: one that can't be removed now (its disk went
  // away) is removed at the next start.
  const discard = async () => {
    if (!(await recordIncomplete(journal, journalEntry, recordedComplete))) {
      return;
    }
    recordedComplete = false;
    try {
      await removeOwnStaging(fileSystem, temporaryPath, reserved.id);
    } catch {
      return;
    }
    await journal?.remove(journalEntry.id).catch(() => undefined);
  };

  let outcome: ExecuteNodeResult;
  try {
    outcome = await executeDirectoryNode(
      {
        ...context,
        mode: "copy",
        recordsUndo: false,
        stagingFor: context.mode,
        metadataLaterFor: temporaryPath,
        folderMadeAt: temporaryPath,
        displayPath: (path) =>
          (context.displayPath ?? ((value: string) => value))(
            rebasePath(path, temporaryPath, finalPath),
          ),
      },
      rebaseResolvedNode(currentNode, finalPath, temporaryPath),
    );
  } catch (error) {
    await discard();
    if (isAbortError(error) || context.signal.aborted) {
      // What was copied went away with the hidden copy; the originals are where they were.
      throw new CancelledWithItemsError([]);
    }
    throw error instanceof DestinationTakenError ? error.original : error;
  }
  // Stopped as the last of it was written: it goes, like any stopped part way.
  if (context.signal.aborted) {
    await discard();
    throw new CancelledWithItemsError([]);
  }
  const childItems = rebaseItemResults(
    appendItems([], outcome.childItems),
    temporaryPath,
    finalPath,
  );
  const failedItems = childItems.filter((item) => item.status === "failed");
  const incompleteItems = childItems.filter((item) => item.status !== "completed");
  const isPackage =
    incompleteItems.length > 0 && (await isPackageFolder(fileSystem, currentNode.node.sourcePath));
  if ((context.mode === "cut" && failedItems.length > 0) || isPackage) {
    await discard();
    return {
      itemStatus: "failed",
      skipReason: null,
      error: isPackage
        ? incompletePackageMessage(currentNode, context.mode)
        : `“${name}” wasn't moved because some items in it couldn't be copied. Nothing in it was moved.`,
      destinationPath: finalPath,
      // Only what wasn't done: everything else went away with the hidden copy.
      childItems: incompleteItems,
    };
  }

  // Another app could have put something else under the hidden name: only the copy this
  // paste built is put in place, and only then are originals removed.
  if (!(await isStillOurs(fileSystem, temporaryPath, reserved.id))) {
    await discard();
    return copyChangedOutcome(name, finalPath, context.mode);
  }
  try {
    // Complete now: a crash from here on puts it in place at the next start. Counted as
    // written before it is: a write that failed may still have reached the disk.
    recordedComplete = true;
    await journal?.add({ ...journalEntry, staged: true });
    // A copy of a locked or read-only folder is locked or read-only too, and can't always
    // be renamed: it is opened for the move and closed again after.
    const flags = await unlockForMove(fileSystem, temporaryPath);
    const mode = await openForMove(fileSystem, temporaryPath);
    await moveExclusive(fileSystem, temporaryPath, finalPath);
    await restoreAfterMove(fileSystem, finalPath, mode, flags);
  } catch (error) {
    await discard();
    throw errorCode(error) === "EEXIST" ? new DestinationTakenError(error) : error;
  }
  // Its own metadata now that it has its name (see metadataLaterFor).
  await applyDirectoryMetadata({ ...context, stagingFor: context.mode }, currentNode).catch(
    () => undefined,
  );
  await journal?.remove(journalEntry.id).catch(() => undefined);
  noteChanged(context);
  if (context.mode === "copy") {
    await recordCreated(context, currentNode, finalPath);
  }

  let error = outcome.error;
  let items = childItems;
  if (context.mode === "cut" && !(await isStillOurs(fileSystem, finalPath, reserved.id))) {
    error = hiddenCopyChangedMessage(name, context.mode);
  } else if (context.mode === "cut") {
    const cleanup = await removeMovedSources(
      context,
      currentNode,
      childItems,
      temporaryPath,
      finalPath,
    );
    error = cleanup.error;
    items = cleanup.childItems;
  }
  return {
    itemStatus:
      error !== null || items.some((item) => item.status === "failed") ? "failed" : "completed",
    skipReason: null,
    error,
    destinationPath: finalPath,
    childItems: items,
  };
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
  noteChanged(context);
  if (context.mode === "copy") {
    await recordCreated(context, currentNode, currentNode.destinationPath);
  }
  countLeafProgress(context, currentNode);
  let deleteError: string | null = null;
  if (context.stagingFor === "cut") {
    context.copiedForMove.set(currentNode.node.sourcePath, {
      path: currentNode.destinationPath,
      written: await captureFingerprint(context.fileSystem, currentNode.destinationPath),
      source: currentNode.node.sourceFingerprint,
    });
  }
  if (context.mode === "cut") {
    const copy = await captureFingerprint(context.fileSystem, currentNode.destinationPath);
    deleteError = copyMatchesSource(copy, currentNode.node.sourceFingerprint)
      ? await tryDeleteMovedSource(
          currentNode.node.sourcePath,
          currentNode.node.sourceFingerprint,
          context.fileSystem,
        )
      : COPY_NOT_WHOLE_MESSAGE;
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
    if (context.fileSystem.copyFile) {
      // copyfile(3) makes the link itself (never what it points to), with its tags, flags
      // and dates: a link made anew would have none of them, and a move would lose them.
      try {
        await context.fileSystem.copyFile(node.node.sourcePath, targetPath, context.signal);
      } catch (error) {
        throw errorCode(error) === "EEXIST"
          ? new DestinationTakenError(error)
          : await explainMissingFolder(context.fileSystem, targetPath, error);
      }
      return;
    }
    const linkTarget = await context.fileSystem.readlink(node.node.sourcePath);
    try {
      await context.fileSystem.symlink(linkTarget, targetPath);
    } catch (error) {
      throw errorCode(error) === "EEXIST"
        ? new DestinationTakenError(error)
        : await explainMissingFolder(context.fileSystem, targetPath, error);
    }
    await preserveSymlinkTimestamps(
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
      if (currentNode.destinationPath !== context.folderMadeAt) {
        await context.fileSystem.mkdir(currentNode.destinationPath);
      }
    } catch (error) {
      throw errorCode(error) === "EEXIST"
        ? new DestinationTakenError(error)
        : await explainMissingFolder(context.fileSystem, currentNode.destinationPath, error);
    }
    noteChanged(context);
    if (context.mode === "copy") {
      await recordCreated(context, currentNode, currentNode.destinationPath);
    }
    // The folder's own mode and flags come last (see below): a read-only or locked folder
    // couldn't be filled in otherwise.
    context.progress.completedItemCount += 1;
    emitProgress(context, "running", currentNode, null);
  }
  if (currentNode.action === "merge") {
    expectCantUndo(context, "merge");
  }
  let hasChildFailure = false;
  // Anything inside not done (failed, skipped): a package is then not put in place at all.
  let hasIncomplete = false;
  const bubbledChildItems: ItemList = [];
  // Items this folder's move leaves where they are (skipped, failed): never cleared away
  // with the folder, whatever their names.
  const keptNames = new Set<string>();
  for (const child of currentNode.children) {
    if (context.signal.aborted) {
      // Keep what was already done inside this folder in the result.
      throw new CancelledWithItemsError(bubbledChildItems);
    }
    let childResult: ExecuteNodeResult;
    try {
      childResult = await executeResolvedNode(context, child);
    } catch (error) {
      // An incomplete package that couldn't be cleared away: nothing around it is put in
      // place either.
      if (error instanceof StagingCleanupError) {
        throw error;
      }
      if (isAbortError(error) || context.signal.aborted) {
        const nestedItems = error instanceof CancelledWithItemsError ? error.childItems : [];
        const inProgress =
          child.node.sourceKind !== "directory" && !(error instanceof CancelledWithItemsError)
            ? [itemResult(child, "cancelled", CANCELLED_MESSAGE)]
            : [];
        throw new CancelledWithItemsError([bubbledChildItems, inProgress, nestedItems]);
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
    if (childResult.itemStatus !== "completed") {
      hasIncomplete = true;
      keptNames.add(basename(child.node.sourcePath));
    } else if (hasItemNotDone(childResult.childItems)) {
      // A folder inside done, with something deeper in it not done (skipped).
      hasIncomplete = true;
    }
    // Bubble up file items, and folders that failed themselves or were skipped (a move
    // leaves those where they are), into the result.
    if (
      child.node.sourceKind !== "directory" ||
      childResult.error !== null ||
      childResult.itemStatus === "skipped"
    ) {
      bubbledChildItems.push(outcomeItemResult(child, childResult));
    }
    if (childResult.childItems.length > 0) {
      bubbledChildItems.push(childResult.childItems);
    }
  }
  // The folder's metadata goes on once its items are in: writing them changes its dates,
  // and a read-only or locked folder can't take new items. As for a file, a folder whose
  // items were written isn't reported as failed over its dates or permissions (some
  // network volumes refuse them), and what was done inside it is never dropped.
  // A package (an app, a Keynote document) inside a folder built under a hidden name is
  // whole or not at all: an incomplete copy of one would look whole, and not open.
  if (
    hasIncomplete &&
    context.stagingFor !== null &&
    createsDirectory &&
    currentNode.destinationPath !== context.folderMadeAt &&
    (await isPackageFolder(context.fileSystem, currentNode.node.sourcePath))
  ) {
    // Should it stay (the disk refused), the folder it is in isn't put in place either: the
    // error goes up and the whole hidden copy goes.
    try {
      await removeStagedItem(context.fileSystem, currentNode.destinationPath);
    } catch (error) {
      throw new StagingCleanupError(error);
    }
    return {
      itemStatus: "failed",
      skipReason: null,
      error: incompletePackageMessage(currentNode),
      destinationPath: currentNode.destinationPath,
      childItems: appendItems([], bubbledChildItems).filter((item) => item.status !== "completed"),
    };
  }
  if (createsDirectory && currentNode.destinationPath !== context.metadataLaterFor) {
    await applyDirectoryMetadata(context, currentNode).catch(() => undefined);
  }
  let dirDeleteError: string | null = null;
  if (context.mode === "cut") {
    dirDeleteError =
      metadataKeptMessage(context, currentNode) ??
      (await tryRemoveEmptySourceDirectory(currentNode, context.fileSystem, keptNames, () =>
        noteChanged(context),
      ));
  } else if (context.stagingFor !== "cut") {
    // (Built aside for a move, what was added meanwhile is named once the originals go.)
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
  const moving = context.mode === "cut" || context.stagingFor === "cut";
  if (fileSystem.copyMetadata) {
    try {
      // Tags, the custom-icon flag, ACLs and flags along with the mode and dates.
      await fileSystem.copyMetadata(sourcePath, node.destinationPath);
      if (context.mode === "cut" || context.stagingFor === "cut") {
        // Moving the items out (or anything written into it meanwhile, as Finder's view
        // settings) changed the source folder's dates; put back the ones it had before.
        // Only the date is lost if this fails (a locked folder refuses it).
        await preserveTimestampsIfSupported(
          fileSystem,
          node.destinationPath,
          sourceFingerprint.mtimeMs,
        ).catch(() => undefined);
      }
      return;
    } catch {
      // For example a volume that refuses some attribute: carry over what can be. A move
      // keeps the original folder then, with what its copy couldn't take.
      if (moving) {
        context.metadataNotCopied.add(sourcePath);
      }
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
  source: NodeFingerprint,
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
  // Pasting "/x/a.txt" over "/d/a.txt" while "/d/a.txt" is pasted too (search results):
  // replacing it would take away an item this paste still has to paste, or just pasted.
  if (await isAnyOf(fileSystem, finalPath, await pastedItemRealPaths(context))) {
    throw new Error(
      `Can't replace “${basename(finalPath)}” because it is another item being pasted.`,
    );
  }
  // A locked item can't go to the Trash; found out now, before anything is written.
  if (await isLocked(fileSystem, finalPath)) {
    throw new Error(lockedMessage(finalPath));
  }
  // What the old item holds now (an answer to a question about it may have taken in a
  // change), to tell when it is about to go whether anything was added to it since.
  const replaced: ReplacedItem = {
    fingerprint: destination,
    itemCount:
      destination.kind === "directory" ? await countItemsInside(fileSystem, finalPath) : null,
  };

  if (!fileSystem.rename) {
    // Nothing can be swapped into place without rename: clear the way first instead.
    if ((await removeReplacedItem(context, currentNode, replaced)) === "skipped") {
      return skippedOutcome("runtime_conflict_resolution", finalPath);
    }
    return performNode(context, { ...currentNode, action: "create" }, source);
  }

  // A move that copies (to another disk) removes the originals only after the swap, and
  // the copy is staged as a plain copy: everything it will have to remove is checked now,
  // or the old item would go to the Trash for a move that leaves the original in place.
  if (context.mode === "cut" && !canRenameForCut(context, currentNode)) {
    await assertRemovableAfterCopy(context, currentNode, { deep: true });
  }

  let temporaryPath = await temporarySiblingPath(fileSystem, finalPath);
  // Written down before anything is staged, so a crash can't leave the item under the
  // hidden name: the next start finishes or undoes the Replace.
  const journal = context.writeJournal;
  const journalEntry: ReplaceJournalEntry = {
    id: randomBytes(8).toString("hex"),
    stagingPath: temporaryPath,
    finalPath,
    sourcePath: currentNode.node.sourcePath,
    moved: false,
    staged: false,
  };
  // Whether what is at the hidden name is this paste's own: only then is it ever removed.
  // A folder is made there first, under a name nothing else has; a file is its own once
  // copied there (a copy that fails leaves nothing there).
  let stagingIsOurs = false;
  let stagingId: ItemId | null = null;
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
    if (context.mode === "cut") {
      expectCantUndo(context, "other_disk_move");
    }
    if (currentNode.node.sourceKind === "directory") {
      const reserved = await reserveStagingFolder(fileSystem, finalPath);
      temporaryPath = reserved.path;
      stagingId = reserved.id;
      stagingIsOurs = true;
      journalEntry.stagingPath = temporaryPath;
      if (reserved.id) {
        journalEntry.stagingId = reserved.id;
      }
      if (reserved.bornMs !== null) {
        journalEntry.stagingBornMs = reserved.bornMs;
      }
      const sourceId = sourceIdOf(currentNode);
      if (sourceId) {
        journalEntry.sourceId = sourceId;
      }
    }
    try {
      await journal?.add(journalEntry);
    } catch (error) {
      if (stagingIsOurs) {
        await removeOwnStaging(fileSystem, temporaryPath, stagingId).catch(() => undefined);
      }
      throw error;
    }
  }
  // What the swap takes off the staged item to move it (its lock, a read-only folder's
  // mode), put back wherever it ends up.
  let stagedFlags: number | null = null;
  let stagedMode: number | null = null;
  // Whether the record says the hidden copy is complete (see executeStagedDirectory).
  let recordedComplete = false;
  // Puts things back the way they were before this item started.
  const undoStaging = async () => {
    if (movedByRename) {
      await moveExclusive(fileSystem, temporaryPath, currentNode.node.sourcePath);
      await restoreAfterMove(fileSystem, currentNode.node.sourcePath, stagedMode, stagedFlags);
    } else if (stagingIsOurs) {
      if (!(await recordIncomplete(journal, journalEntry, recordedComplete))) {
        throw new Error(`The copy of “${basename(finalPath)}” couldn't be cleared away yet.`);
      }
      recordedComplete = false;
      await removeOwnStaging(fileSystem, temporaryPath, stagingId);
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
          recordsUndo: false,
          stagingFor: context.mode,
          metadataLaterFor: temporaryPath,
          folderMadeAt: stagingIsOurs ? temporaryPath : null,
          displayPath: (path) =>
            (context.displayPath ?? ((value: string) => value))(
              rebasePath(path, temporaryPath, finalPath),
            ),
        },
        staged,
        source,
      );
    } catch (error) {
      await undoStaging().catch(() => undefined);
      if (isAbortError(error) || context.signal.aborted) {
        // What was written went away with the hidden copy.
        throw new CancelledWithItemsError([]);
      }
      throw error instanceof DestinationTakenError ? error.original : error;
    }
    stagingIsOurs = true;
    stagedChildItems = rebaseItemResults(
      appendItems([], stagedOutcome.childItems),
      temporaryPath,
      finalPath,
    );
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
        recordedComplete = true;
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
    // Another app could have put something else under the hidden name: nothing is done to
    // it, and the old item goes only for the copy this paste built.
    const stillOurs = () =>
      movedByRename ? Promise.resolve(true) : isStillOurs(fileSystem, temporaryPath, stagingId);
    if (!(await stillOurs())) {
      await undoStaging();
      return copyChangedOutcome(basename(finalPath), finalPath, context.mode);
    }
    stagedFlags = await unlockForMove(fileSystem, temporaryPath);
    stagedMode = await openForMove(fileSystem, temporaryPath);
    const removal = await removeReplacedItem(context, currentNode, replaced, stillOurs);
    if (removal === "skipped") {
      await undoStaging();
      return skippedOutcome("runtime_conflict_resolution", finalPath);
    }
    if (removal === "changed") {
      await undoStaging();
      return copyChangedOutcome(basename(finalPath), finalPath, context.mode);
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
          isPackage:
            currentNode.node.sourceKind === "directory" &&
            (await isPackageFolder(fileSystem, currentNode.node.sourcePath)),
          caseSensitive: context.caseSensitive,
        },
      );
      await moveExclusive(fileSystem, temporaryPath, visiblePath);
      await restoreAfterMove(fileSystem, visiblePath, stagedMode, stagedFlags);
      await applyStagedFolderMetadata(context, currentNode, visiblePath, movedByRename);
      await recordReplacement(context, currentNode, visiblePath, movedByRename, source);
      await journal?.remove(journalEntry.id).catch(() => undefined);
      return {
        itemStatus: "failed",
        skipReason: null,
        error: `The old “${basename(finalPath)}” was moved to the Trash, but the new one couldn't take its name, so it was saved as “${basename(visiblePath)}”. ${describeCopyPasteError(error)}`,
        destinationPath: visiblePath,
        childItems: stagedChildItems,
      };
    }
    await restoreAfterMove(fileSystem, finalPath, stagedMode, stagedFlags);
    await applyStagedFolderMetadata(context, currentNode, finalPath, movedByRename);
    await recordReplacement(context, currentNode, finalPath, movedByRename, source);
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
  if (
    context.mode === "cut" &&
    !movedByRename &&
    !(await isStillOurs(fileSystem, finalPath, stagingId))
  ) {
    ownError = hiddenCopyChangedMessage(basename(finalPath), context.mode);
  } else if (context.mode === "cut" && !movedByRename) {
    const cleanup = await removeMovedSources(
      context,
      currentNode,
      stagedChildItems,
      temporaryPath,
      finalPath,
    );
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

// A folder a Replace built under a hidden name gets its own metadata once it has its name
// (see metadataLaterFor); one moved there on its disk kept its own.
async function applyStagedFolderMetadata(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  path: string,
  movedByRename: boolean,
): Promise<void> {
  if (movedByRename || node.node.sourceKind !== "directory") {
    return;
  }
  await applyDirectoryMetadata(
    { ...context, stagingFor: context.mode },
    { ...node, destinationPath: path },
  ).catch(() => undefined);
}

// The new item a Replace put in place: moved there on its disk, or copied there.
async function recordReplacement(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  path: string,
  movedByRename: boolean,
  source: NodeFingerprint,
): Promise<void> {
  if (movedByRename) {
    await recordMoved(context, node, path, source);
  } else if (context.mode === "copy") {
    await recordCreated(context, node, path);
  }
}

// After a move to another disk was copied into place (built under `stagingPath`, now at
// `finalPath`), removes the sources that were copied. Anything changed in the meantime
// stays, as in the per-file move flow, and so does an original whose copy went away,
// changed or was cut short since it was written.
async function removeMovedSources(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  childItems: CopyPasteItemResult[],
  stagingPath: string,
  finalPath: string,
): Promise<{ error: string | null; childItems: CopyPasteItemResult[] }> {
  const removeCopied = async (current: ResolvedCopyPasteNode): Promise<string | null> => {
    const copied = context.copiedForMove.get(current.node.sourcePath);
    context.copiedForMove.delete(current.node.sourcePath);
    if (
      copied === undefined ||
      !(await copyStillWhole(
        context.fileSystem,
        rebasePath(copied.path, stagingPath, finalPath),
        copied,
      ))
    ) {
      return COPY_NOT_WHOLE_MESSAGE;
    }
    return tryDeleteMovedSource(current.node.sourcePath, copied.source, context.fileSystem);
  };
  if (node.node.sourceKind !== "directory") {
    return { error: await removeCopied(node), childItems };
  }
  const itemsBySource = new Map(childItems.map((item) => [item.sourcePath, item]));
  const updatedItems = new Map<string, CopyPasteItemResult>();
  const nestedFolderFailures: CopyPasteItemResult[] = [];
  const removeTree = async (current: ResolvedCopyPasteNode): Promise<string | null> => {
    if (current.node.sourceKind !== "directory") {
      if (itemsBySource.get(current.node.sourcePath)?.status !== "completed") {
        return null;
      }
      const error = await removeCopied(current);
      if (error !== null) {
        const item = itemsBySource.get(current.node.sourcePath);
        if (item) {
          updatedItems.set(current.node.sourcePath, { ...item, status: "failed", error });
        }
      }
      return error;
    }
    const keptNames = new Set<string>();
    for (const child of current.children) {
      // A folder skipped (or stopped) wasn't copied: it and everything in it stay.
      const childStatus = itemsBySource.get(child.node.sourcePath)?.status;
      if (
        child.node.sourceKind === "directory" &&
        (childStatus === "skipped" || childStatus === "cancelled")
      ) {
        keptNames.add(basename(child.node.sourcePath));
        continue;
      }
      const childError = await removeTree(child);
      if (childError !== null) {
        keptNames.add(basename(child.node.sourcePath));
        if (child.node.sourceKind === "directory") {
          nestedFolderFailures.push(itemResult(child, "failed", childError));
        }
      }
    }
    return (
      metadataKeptMessage(context, current) ??
      tryRemoveEmptySourceDirectory(current, context.fileSystem, keptNames)
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
// `stillOurs` says whether the new item built under a hidden name is still the one this
// paste made: asked last, just before the old item goes (a question about deleting it for
// good may have been open a while). "changed" when it isn't: the old item stays.
async function removeReplacedItem(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  replaced: ReplacedItem,
  stillOurs?: () => Promise<boolean>,
): Promise<"removed" | "skipped" | "changed"> {
  const { fileSystem } = context;
  const destination = replaced.fingerprint;
  if (fileSystem.trash) {
    try {
      // Staging a large copy takes a while: the item replaced must still be the one that
      // was there, never one an app saved in its place meanwhile.
      const current = await assertReplacedItemUnchanged(context, node, replaced);
      // On a disk that ignores case, "X.TXT" may have found "x.txt": Undo puts the old item
      // back under the name it really had.
      const records = context.recordsUndo && context.undo.topLevelNodeIds.has(node.node.id);
      const from = records
        ? await spelledAsOnDisk(context, node.destinationPath, current)
        : node.destinationPath;
      const id =
        current.dev !== null && current.ino !== null
          ? itemIdOf({ dev: current.dev, ino: current.ino })
          : null;
      const looks = records ? await stampWithoutId(fileSystem, node.destinationPath, id) : {};
      if (stillOurs && !(await stillOurs())) {
        return "changed";
      }
      const trashPath = await fileSystem.trash(node.destinationPath);
      noteChanged(context);
      context.replacedPaths.push(node.destinationPath);
      if (trashPath !== null) {
        context.trashedPaths.push(trashPath);
      }
      if (trashPath === null) {
        // In the Trash, but the Trash didn't say where: it can't be put back.
        markCantUndo(context, "trash_location_unknown");
      } else if (records) {
        recordUndoStep(context, node, {
          kind: "trashed",
          from,
          trashPath,
          id,
          parentId: await readFolderIdOnce(
            context.folderIds,
            fileSystem.stat,
            dirname(node.destinationPath),
          ),
          ...looks,
        });
      }
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
  // The question may have been open a while: what is deleted is what it was about.
  // Deleting a folder for good stops at the first locked item inside, leaving it half
  // deleted: one is looked for first, and then nothing is deleted.
  if (destination.kind === "directory") {
    const locked = await findLockedInside(fileSystem, node.destinationPath);
    if (locked !== null) {
      throw new Error(lockedMessage(locked));
    }
  }
  // Last, after the long look inside: the question may have been open a while, and what
  // is deleted is what it was about.
  await assertReplacedItemUnchanged(context, node, replaced);
  if (stillOurs && !(await stillOurs())) {
    return "changed";
  }
  markCantUndo(context, "deleted_for_good");
  noteChanged(context);
  // Named before deleting: a delete that fails part way has still removed some of it.
  context.replacedPaths.push(node.destinationPath);
  await fileSystem.rm(node.destinationPath, {
    recursive: destination.kind === "directory",
    force: true,
  });
  return "removed";
}

// The item a Replace removes, as it was when the Replace began: `itemCount` is how many
// items a folder held at every depth (null for a file, or when it couldn't be counted).
type ReplacedItem = { fingerprint: NodeFingerprint; itemCount: number | null };

// The item a Replace is about to remove is still the one it began with: the same file
// unchanged, or the same folder holding as many items. Throws (nothing removed) when
// another item is there or it changed; returns what is there.
async function assertReplacedItemUnchanged(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
  replaced: ReplacedItem,
): Promise<NodeFingerprint> {
  const destination = replaced.fingerprint;
  const current = await captureFingerprint(context.fileSystem, node.destinationPath);
  let unchanged: boolean;
  if (destination.kind === "directory" && current.kind === "directory") {
    // Counting a large folder takes a while: it must still be the same folder once counted.
    unchanged =
      sameItemIdentity(destination, current) &&
      (replaced.itemCount === null ||
        (await countItemsInside(context.fileSystem, node.destinationPath)) ===
          replaced.itemCount) &&
      sameItemIdentity(
        destination,
        await captureFingerprint(context.fileSystem, node.destinationPath),
      );
  } else {
    unchanged = current.exists && fingerprintsEqual(destination, current);
  }
  if (!unchanged) {
    throw new Error(
      `“${basename(node.destinationPath)}” changed while it was being replaced, so it was kept and nothing was replaced.`,
    );
  }
  return current;
}

// `path` as its folder spells the item `fingerprint` describes ("x.txt" for "X.TXT" on a
// disk that ignores case), or `path` itself when that can't be told.
async function spelledAsOnDisk(
  context: ExecutionContext,
  path: string,
  fingerprint: NodeFingerprint,
): Promise<string> {
  const folder = dirname(path);
  const name = basename(path);
  for (let reread = false; ; reread = true) {
    const read = await readFolderListing(context, folder, reread);
    if (read === null) {
      return path;
    }
    if (read.listing.names.has(name)) {
      return path;
    }
    for (const spelled of read.listing.byFoldedName.get(foldedName(name)) ?? []) {
      const candidate = join(folder, spelled);
      const found = await captureFingerprint(context.fileSystem, candidate);
      if (found.ino !== null && found.ino === fingerprint.ino && found.dev === fingerprint.dev) {
        return candidate;
      }
    }
    // Not in a listing read earlier in this paste: the item came since, so the folder is
    // read again, once.
    if (read.fresh) {
      return path;
    }
  }
}

type FolderListing = { names: Set<string>; byFoldedName: Map<string, string[]> };

// A folder's entries, read once per paste: replacing many items in a big folder would read
// it whole for each one otherwise. Each item looked up is the one about to be replaced,
// which was there before this paste began or is found by reading the folder again (see
// spelledAsOnDisk); what the paste itself writes there never takes an item's name in
// another spelling (assertNotWrittenByThisPaste).
async function readFolderListing(
  context: ExecutionContext,
  folder: string,
  reread: boolean,
): Promise<{ listing: FolderListing; fresh: boolean } | null> {
  const cached = reread ? undefined : context.folderListings.get(folder);
  if (cached) {
    return { listing: cached, fresh: false };
  }
  let entries: string[];
  try {
    entries = await context.fileSystem.readdir(folder);
  } catch {
    return null;
  }
  const listing: FolderListing = { names: new Set(entries), byFoldedName: new Map() };
  for (const entry of entries) {
    const key = foldedName(entry);
    listing.byFoldedName.set(key, [...(listing.byFoldedName.get(key) ?? []), entry]);
  }
  context.folderListings.set(folder, listing);
  return { listing, fresh: true };
}

function foldedName(name: string): string {
  return name.normalize("NFD").toLowerCase();
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
  fileSystem: Pick<WriteServiceFileSystem, "getFlags" | "setFlags">,
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

// A folder that can't be written to can't always be renamed: macOS 14 refuses it. The
// hidden copy of a read-only folder is made writable for the swap, and given its mode
// back by restoreAfterMove.
async function openForMove(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<number | null> {
  if (!fileSystem.chmod) {
    return null;
  }
  const fingerprint = await captureFingerprint(fileSystem, path);
  if (fingerprint.kind !== "directory" || fingerprint.mode === null) {
    return null;
  }
  const mode = fingerprint.mode & 0o7777;
  if ((mode & 0o200) !== 0) {
    return null;
  }
  await fileSystem.chmod(path, mode | 0o200);
  return mode;
}

// Puts back what openForMove and unlockForMove took off, the mode before the lock (a
// locked item can't have its mode changed).
async function restoreAfterMove(
  fileSystem: WriteServiceFileSystem,
  path: string,
  mode: number | null,
  flags: number | null,
): Promise<void> {
  if (mode !== null) {
    await fileSystem.chmod?.(path, mode).catch(() => undefined);
  }
  if (flags !== null) {
    await fileSystem.setFlags?.(path, flags).catch(() => undefined);
  }
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
    if (
      (code !== "EACCES" && code !== "EPERM") ||
      (!fileSystem.chmod && !fileSystem.setFlags && !fileSystem.setAcl)
    ) {
      throw error;
    }
  }
  await makeFoldersWritable(fileSystem, path);
  await fileSystem.rm(path, { recursive: true, force: true });
}

// Opens up a hidden copy so it can be removed: locked items (a copy of a locked item is
// locked too) are unlocked, rules against deleting them (a copy of ~/Documents has one)
// taken off, and read-only folders made writable.
async function makeFoldersWritable(fileSystem: WriteServiceFileSystem, path: string) {
  if (fileSystem.getFlags && fileSystem.setFlags) {
    const flags = await fileSystem.getFlags(path).catch(() => 0);
    if ((flags & USER_LOCK_FLAGS) !== 0) {
      await fileSystem.setFlags(path, flags & ~USER_LOCK_FLAGS).catch(() => undefined);
    }
  }
  await fileSystem.setAcl?.(path, null).catch(() => undefined);
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

// Adds the items of `items` to `target` in order, the lists of folders in it included.
// One at a time: spreading 125,000 items or more into one call overflows the stack.
function appendItems(target: CopyPasteItemResult[], items: ItemList): CopyPasteItemResult[] {
  for (const item of items) {
    if (Array.isArray(item)) {
      appendItems(target, item);
    } else {
      target.push(item);
    }
  }
  return target;
}

function countFailedItems(items: ItemList): number {
  let count = 0;
  for (const item of items) {
    if (Array.isArray(item)) {
      count += countFailedItems(item);
    } else if (item.status === "failed") {
      count += 1;
    }
  }
  return count;
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
  // A large file is written down first: cut short by a crash, the part copied would take
  // up space under a hidden name, unseen, until the next start removes it. Small ones
  // aren't, for speed (two writes to the journal for each file).
  const journal = context.writeJournal;
  const journaled =
    journal !== null &&
    ((await fileSystem.lstat(sourcePath).catch(() => null))?.size ?? 0) >= JOURNALED_FILE_BYTES;
  // Written down, the part is copied into a folder made for it under a hidden name, known
  // by its id from before anything is copied: the next start removes only that folder,
  // never another item that came to have the name. A disk that gives no ids gets the part
  // next to its place, as small files do.
  let partialFolder = journaled ? await reserveStagingFolder(fileSystem, targetPath) : null;
  if (partialFolder !== null && partialFolder.id === null) {
    await removeOwnStaging(fileSystem, partialFolder.path, null).catch(() => undefined);
    partialFolder = null;
  }
  const partialPath =
    partialFolder !== null
      ? join(partialFolder.path, PARTIAL_FILE_NAME)
      : await temporarySiblingPath(fileSystem, targetPath);
  // What is left behind should the copy be cut short: the folder, or the part itself.
  const leftoverPath = partialFolder?.path ?? partialPath;
  const journalId = journaled ? randomBytes(8).toString("hex") : null;
  if (journal !== null && journalId !== null) {
    try {
      await journal.add({
        kind: "partial_file",
        id: journalId,
        partialPath,
        finalPath: targetPath,
        ...(partialFolder?.id ? { folderId: partialFolder.id } : {}),
        ...(partialFolder !== null && partialFolder.bornMs !== null
          ? { folderBornMs: partialFolder.bornMs }
          : {}),
      });
    } catch (error) {
      if (partialFolder !== null) {
        await removeOwnStaging(fileSystem, partialFolder.path, partialFolder.id).catch(
          () => undefined,
        );
      }
      throw error;
    }
  }
  try {
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
  } finally {
    if (partialFolder !== null) {
      await removeOwnStaging(fileSystem, partialFolder.path, partialFolder.id).catch(
        () => undefined,
      );
    }
    // Complete under its name, or cleared away: nothing is left to recover. A part that
    // couldn't be cleared away (its disk went away) stays written down for the next start.
    if (journal !== null && journalId !== null && (await isGone(fileSystem, leftoverPath))) {
      await journal.remove(journalId).catch(() => undefined);
    }
  }
}

// The name a large file is copied under inside the hidden folder made for it.
const PARTIAL_FILE_NAME = "part";

// Whether nothing is at `path` for certain: not merely unreadable, and not on a disk gone
// away (its folder is still there).
async function isGone(fileSystem: WriteServiceFileSystem, path: string): Promise<boolean> {
  try {
    await fileSystem.lstat(path);
    return false;
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      return false;
    }
  }
  try {
    return (await fileSystem.lstat(dirname(path))).isDirectory();
  } catch {
    return false;
  }
}

// Whether any item in `items` (at any depth) wasn't done.
function hasItemNotDone(items: ItemList): boolean {
  for (const item of items) {
    if (Array.isArray(item) ? hasItemNotDone(item) : item.status !== "completed") {
      return true;
    }
  }
  return false;
}

function incompletePackageMessage(
  node: ResolvedCopyPasteNode,
  mode: CopyPasteMode = "copy",
): string {
  const name = basename(node.node.sourcePath);
  return mode === "cut"
    ? `“${name}” wasn't moved because some items in it were skipped or couldn't be copied. Nothing in it was moved.`
    : `“${name}” wasn't copied because some items in it were skipped or couldn't be copied.`;
}

// The id of the item being pasted, as the review found it; null when its disk gives none.
function sourceIdOf(node: ResolvedCopyPasteNode): ItemId | null {
  const { dev, ino } = node.node.sourceFingerprint;
  return dev !== null && ino !== null ? { dev, ino } : null;
}

// A folder made under a hidden name next to `finalPath` for an item to be built in, with
// its id: made exclusively (a name found taken is passed over), so it is this paste's own.
async function reserveStagingFolder(
  fileSystem: WriteServiceFileSystem,
  finalPath: string,
): Promise<{ path: string; id: ItemId | null; bornMs: number | null }> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const path = await temporarySiblingPath(fileSystem, finalPath);
    try {
      await fileSystem.mkdir(path);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        continue;
      }
      throw await explainMissingFolder(fileSystem, path, error);
    }
    const made = await captureFingerprint(fileSystem, path);
    const bornMs = await fileSystem.lstat(path).then(
      (stats) => (typeof stats.birthtimeMs === "number" ? stats.birthtimeMs : null),
      () => null,
    );
    return {
      path,
      id: made.dev !== null && made.ino !== null ? { dev: made.dev, ino: made.ino } : null,
      bornMs,
    };
  }
  throw new Error(`Couldn't find a free temporary name next to “${basename(finalPath)}”.`);
}

// Whether the item at `path` is still the folder a paste built under a hidden name (`id`,
// when the disk gives one), found by its id: renaming it into place keeps it.
async function isStillOurs(
  fileSystem: WriteServiceFileSystem,
  path: string,
  id: ItemId | null,
): Promise<boolean> {
  if (id === null) {
    return true;
  }
  const there = await captureFingerprint(fileSystem, path);
  return there.dev === id.dev && there.ino === id.ino;
}

function copyChangedOutcome(
  name: string,
  destinationPath: string,
  mode: CopyPasteMode,
): ExecuteNodeResult {
  return {
    itemStatus: "failed",
    skipReason: null,
    error: hiddenCopyChangedMessage(name, mode),
    destinationPath,
    childItems: [],
  };
}

function hiddenCopyChangedMessage(name: string, mode: CopyPasteMode): string {
  return mode === "cut"
    ? `“${name}” wasn't moved because another app changed its copy while it was being made. The original is where it was.`
    : `“${name}” wasn't copied because another app changed the copy while it was being made.`;
}

// A hidden copy written down as complete is put in place at the next start: before any of
// it is removed, its record says it isn't, or a removal stopped part way (a disk error)
// would have what is left of it put in place as if whole. False when that can't be written
// down: the copy is then left whole, for the next start to put in place.
async function recordIncomplete(
  journal: WriteJournal | null,
  entry: ReplaceJournalEntry,
  recordedComplete: boolean,
): Promise<boolean> {
  if (!recordedComplete || journal === null) {
    return true;
  }
  try {
    await journal.add({ ...entry, staged: false });
    return true;
  } catch {
    return false;
  }
}

// Removes what a paste built under a hidden name, only when the item there is still the one
// it made (`id`, when the disk gives one): another item that took the name is left alone.
async function removeOwnStaging(
  fileSystem: WriteServiceFileSystem,
  path: string,
  id: ItemId | null,
): Promise<void> {
  if (await isGone(fileSystem, path)) {
    return;
  }
  // Read for certain (an error here is thrown: the record of it then stays).
  const there = await fileSystem.lstat(path);
  if (id !== null && (there.dev !== id.dev || there.ino !== id.ino)) {
    return;
  }
  await removeStagedItem(fileSystem, path);
}

// Files at least this large are written down in the journal while they are copied.
export const JOURNALED_FILE_BYTES = 32 * 1024 * 1024;

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
  source: NodeFingerprint,
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
  noteChanged(context);
  await recordMoved(context, currentNode, currentNode.destinationPath, source);
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

// What changed since the review, if anything, along with the item being pasted as it is now.
async function detectRuntimeConflict(
  resolvedNode: ResolvedCopyPasteNode,
  analysisId: string,
  fileSystem: WriteServiceFileSystem,
): Promise<{ conflict: CopyPasteRuntimeConflict | null; source: NodeFingerprint }> {
  const source = await captureFingerprint(fileSystem, resolvedNode.node.sourcePath);
  return {
    conflict: await findRuntimeConflict(resolvedNode, analysisId, fileSystem, source),
    source,
  };
}

async function findRuntimeConflict(
  resolvedNode: ResolvedCopyPasteNode,
  analysisId: string,
  fileSystem: WriteServiceFileSystem,
  currentSourceFingerprint: NodeFingerprint,
): Promise<CopyPasteRuntimeConflict | null> {
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

const COPY_NOT_WHOLE_MESSAGE =
  "Its copy went away or changed before the original was removed, so the original was kept.";

// Whether a move's copy is what it copied: the same kind, as large, and for a link the same
// target. Sizes don't prove the contents, but a copy cut short or replaced is caught.
function copyMatchesSource(copy: NodeFingerprint, source: NodeFingerprint): boolean {
  return (
    copy.exists &&
    copy.kind === source.kind &&
    (source.size === null || copy.size === source.size) &&
    copy.symlinkTarget === source.symlinkTarget
  );
}

// Whether the copy at `path` is still the one written (`copied`), as it was written, and
// still matches its original.
async function copyStillWhole(
  fileSystem: WriteServiceFileSystem,
  path: string,
  copied: CopiedItem,
): Promise<boolean> {
  const now = await captureFingerprint(fileSystem, path);
  return (
    sameItemIdentity(copied.written, now) &&
    now.size === copied.written.size &&
    copyMatchesSource(now, copied.source)
  );
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

// A moved folder whose copy couldn't take all of its own metadata (its tags, say) is kept
// where it was, so nothing of it is lost: the message saying so, or null.
function metadataKeptMessage(
  context: ExecutionContext,
  node: ResolvedCopyPasteNode,
): string | null {
  if (!context.metadataNotCopied.has(node.node.sourcePath)) {
    return null;
  }
  return `Its items were moved, but the folder's own information (such as its tags) couldn't all be copied, so the original “${basename(node.node.sourcePath)}” was kept.`;
}

/** Attempts to remove an empty source directory after its children were moved.
 *  Returns null on success or intentional skip, or an error message if removal failed.
 *  `keptNames` are the planned items the move left in it; `onRemoved` is told when this
 *  removed it. */
async function tryRemoveEmptySourceDirectory(
  node: ResolvedCopyPasteNode,
  fileSystem: WriteServiceFileSystem,
  keptNames: ReadonlySet<string>,
  onRemoved: () => void = () => undefined,
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
    onRemoved();
    return null;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") {
      return null;
    }
    if (code === "ENOTEMPTY" || code === "EEXIST") {
      return describeLeftInMovedFolder(node, fileSystem, keptNames, onRemoved);
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
  keptNames: ReadonlySet<string>,
  onRemoved: () => void,
): Promise<string | null> {
  const plannedNames = new Set(node.children.map((child) => basename(child.node.sourcePath)));
  const entries = await fileSystem.readdir(node.node.sourcePath).catch(() => [] as string[]);
  // Nobody's items: what Finder wrote to show the folder, and the AppleDouble files of
  // items that were moved, on a disk that keeps attributes in them (FAT, exFAT, SMB). An
  // item the move left on purpose is never one, nor is a "._name" file that is an item of
  // its own (on APFS, or one that isn't AppleDouble data).
  const leftovers = new Set<string>();
  for (const entry of entries) {
    if (keptNames.has(entry)) {
      continue;
    }
    if (
      isFolderViewFile(entry) ||
      (isAppleDoubleCompanionName(entry, plannedNames) &&
        !plannedNames.has(entry) &&
        (await isAppleDoubleFile(fileSystem, join(node.node.sourcePath, entry))))
    ) {
      leftovers.add(entry);
    }
  }
  const isLeftover = (entry: string) => leftovers.has(entry);
  if (entries.length > 0 && entries.every(isLeftover)) {
    // They go with the folder. Only when nothing else keeps it: a folder that stays
    // (skipped or failed items in it) keeps its view settings too.
    for (const entry of entries) {
      await fileSystem
        .rm(join(node.node.sourcePath, entry), { force: true })
        .catch(() => undefined);
    }
    await fileSystem.rmdir(node.node.sourcePath).then(onRemoved, () => undefined);
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

async function isAppleDoubleFile(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<boolean> {
  try {
    return (await fileSystem.isAppleDouble?.(path)) ?? false;
  } catch {
    return false;
  }
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
  const added: string[] = [];
  for (const entry of entries) {
    if (plannedNames.has(entry) || isFolderViewFile(entry)) {
      continue;
    }
    // A planned item's attributes on a disk that keeps them in "._name" files went with
    // the item; any other "._name" file is an item of its own.
    if (
      isAppleDoubleCompanionName(entry, plannedNames) &&
      (await isAppleDoubleFile(fileSystem, join(node.node.sourcePath, entry)))
    ) {
      continue;
    }
    added.push(entry);
  }
  return added;
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
    for (const child of node.children) {
      stack.push(child);
    }
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
    for (const child of node.children) {
      stack.push(child);
    }
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

// A copied link's dates, set on the link itself. As for a file, a link that was made isn't
// reported as failed over its dates (a move would then leave it in both places): a disk
// that refuses them leaves them as it made them.
async function preserveSymlinkTimestamps(
  fileSystem: WriteServiceFileSystem,
  destinationPath: string,
  mtimeMs: number | null | undefined,
): Promise<void> {
  if (!fileSystem.lutimes || mtimeMs == null) {
    return;
  }
  await fileSystem.lutimes(destinationPath, mtimeMs, mtimeMs).catch(() => undefined);
}
