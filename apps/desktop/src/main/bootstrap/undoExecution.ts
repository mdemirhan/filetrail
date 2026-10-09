import { basename, dirname, join } from "node:path";

import type { UndoDirection, WriteOperationResult } from "@filetrail/contracts";
import {
  type ItemId,
  NO_TRASH_ERROR_CODE,
  type UndoStep,
  type UndoUnit,
  type WriteJournal,
  describeCopyPasteError,
  errorCode,
  findLockedRefusal,
  isPackageName,
  readFolderId,
  readItemRef,
  readItemStamp,
  stampWithoutId,
  unlockForMove,
} from "@filetrail/core";

import { movedItemsOf, numberedName, runBatchRename } from "./batchRenameExecution";
import type { ItemSize, RemovedItem } from "./folderSizeAdjust";
import {
  type MoveCheck,
  type PlannedStep,
  checkBatch,
  checkMove,
  checkTrash,
  missingReason,
  placeKey,
  reverseStep,
} from "./undoPlan";
import type { WriteOperationFs } from "./writeOperations";

// Runs an Undo (or a Redo): the reverse of each step, newest first, one at a time. Each is
// checked on disk just before it runs and skipped, never forced, when it no longer fits.
// Nothing is overwritten (every move refuses a taken name) and nothing is deleted: what
// an operation made goes to the Trash.
//
// What the person was asked first (see findQuestions) was all or nothing: an Undo they
// agreed to puts an item whose name is taken back with a number, and moves an item that
// changed since to the Trash, so it is never left half done by an answer.
//
// A step skipped because the disk check refused it (the item was changed, moved or removed
// outside the app) is dropped: there is nothing left to undo there. A step whose rename or
// Trash failed (no permission, a locked folder, the Trash refusing) stays to be undone, with
// the steps before it in its unit, so the next Undo tries it again rather than undoing an
// older operation instead.

type ResultItem = WriteOperationResult["items"][number];

export type UndoRun = {
  items: ResultItem[];
  // What was done, unit by unit in the order it was done: what the other direction undoes.
  done: UndoUnit[];
  // What is left to do, in the order the operation did it: what a stop didn't reach, and
  // what failed to be written.
  leftover: UndoUnit[];
  removedItems: RemovedItem[];
  completedItemCount: number;
  cancelled: boolean;
};

// Tries at a free numbered name ("a 2.txt") when the one found free is taken just then.
const KEEP_BOTH_ATTEMPTS = 3;
const MAX_ADDED_NUMBER = 10_000;

type StepOutcome =
  | { status: "done"; produced: UndoStep | null; items: ResultItem[]; removed: RemovedItem | null }
  // Refused by the disk check, or something outside the app got in the way.
  | { status: "skipped"; items: ResultItem[]; missing: boolean }
  // The write failed: what it did (a batch may have renamed some of its items), and what
  // is left of the step to try again.
  | { status: "failed"; produced: UndoStep | null; items: ResultItem[]; leftover: UndoStep }
  // A batch stopped part way: what it did, and what is left of the step.
  | {
      status: "stopped";
      produced: UndoStep | null;
      items: ResultItem[];
      leftover: UndoStep;
    };

export async function runUndo(args: {
  direction: UndoDirection;
  units: readonly UndoUnit[];
  fs: WriteOperationFs;
  signal: AbortSignal;
  // The home folder's disk: an item from there lands in the home folder's Trash.
  homeDev: number | null;
  // Whether the disk holding a path has a Trash (createDiskHasTrash), to tell a Trash that
  // failed without saying why from a disk that has none.
  diskHasTrash?: ((path: string) => boolean) | undefined;
  // The items the person agreed to move to the Trash though they changed since. Another
  // that changed once the Undo started is left, and the next Undo asks about it.
  changedAgreed?: ReadonlySet<string>;
  // Where a rename of several writes down the items it moves aside (see writeJournal).
  journal?: WriteJournal | null | undefined;
  onStepStart?: (path: string, completedItemCount: number) => void;
}): Promise<UndoRun> {
  const run: UndoRun = {
    items: [],
    done: [],
    leftover: [],
    removedItems: [],
    completedItemCount: 0,
    cancelled: false,
  };
  const units = [...args.units];
  // The folders items are taken out of, by path: a run takes many items out of one folder.
  const folderIds = new Map<string, Promise<ItemId | null>>();
  const context: RunContext = {
    ...args,
    folderIdOf: (path) => {
      let id = folderIds.get(path);
      if (id === undefined) {
        id = readFolderId(args.fs.stat, path);
        folderIds.set(path, id);
      }
      return id;
    },
  };
  // What a stop didn't reach, and the units whose write failed, newest first.
  let notReached: UndoUnit[] = [];
  const failed: UndoUnit[] = [];
  eachUnit: for (let unitIndex = units.length - 1; unitIndex >= 0; unitIndex -= 1) {
    const unit = units[unitIndex] as UndoUnit;
    const doneSteps: UndoStep[] = [];
    // Once a step can't be undone, the ones before it in the unit aren't either: the old
    // item of a Replace isn't put back where the new one still is.
    let blocked = false;
    // A step done that can't be done again (the Trash didn't say where it put the item):
    // the unit's other steps aren't redone either, so Redo never does only part of it (a
    // Replace's old item moved to the Trash again with no new item in its place).
    let unrecorded = false;
    for (let stepIndex = unit.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
      const step = unit.steps[stepIndex] as UndoStep;
      const planned = reverseStep(step);
      if (blocked) {
        pushAll(run.items, blockedItems(planned, args.direction));
        continue;
      }
      if (args.signal.aborted) {
        run.cancelled = true;
        notReached = [...units.slice(0, unitIndex), { steps: unit.steps.slice(0, stepIndex + 1) }];
        pushDone(run, doneSteps, unrecorded);
        break eachUnit;
      }
      args.onStepStart?.(firstPathOf(planned), run.completedItemCount);
      const outcome = await runStep(planned, step, context);
      pushAll(run.items, outcome.items);
      for (const item of outcome.items) {
        if (item.status === "completed") {
          run.completedItemCount += 1;
        }
      }
      if (outcome.status !== "skipped" && outcome.produced) {
        doneSteps.push(outcome.produced);
      } else if (outcome.status === "done") {
        unrecorded = true;
      }
      if (outcome.status === "stopped") {
        run.cancelled = true;
        notReached = [
          ...units.slice(0, unitIndex),
          { steps: [...unit.steps.slice(0, stepIndex), outcome.leftover] },
        ];
        pushDone(run, doneSteps, unrecorded);
        break eachUnit;
      }
      if (outcome.status === "failed") {
        // It and the steps before it in the unit wait for the next try.
        failed.push({ steps: [...unit.steps.slice(0, stepIndex), outcome.leftover] });
        break;
      }
      if (outcome.status === "done") {
        if (outcome.removed) {
          run.removedItems.push(outcome.removed);
        }
      } else if (!outcome.missing) {
        blocked = true;
      }
    }
    pushDone(run, doneSteps, unrecorded);
  }
  run.leftover = [...notReached, ...failed.reverse()];
  return run;
}

// What a unit did goes to the other list, unless part of it can't be done again.
// What each step of a run is given: the run's arguments, and the id of a folder an item
// is taken out of, read once per run.
type RunContext = Parameters<typeof runUndo>[0] & {
  folderIdOf: (path: string) => Promise<ItemId | null>;
};

function pushDone(run: UndoRun, steps: UndoStep[], unrecorded: boolean): void {
  if (steps.length > 0 && !unrecorded) {
    run.done.push({ steps: [...steps] });
  }
}

// `items` added to the end of `target`, one by one: spread into a call, a batch of more
// than about 120,000 items would overflow the stack.
function pushAll<T>(target: T[], items: readonly T[]): void {
  for (const item of items) {
    target.push(item);
  }
}

function firstPathOf(planned: PlannedStep): string {
  switch (planned.kind) {
    case "move":
      return planned.from;
    case "trash":
      return planned.path;
    case "batch":
      return planned.items[0]?.from ?? "";
  }
}

function runStep(planned: PlannedStep, original: UndoStep, args: RunContext): Promise<StepOutcome> {
  switch (planned.kind) {
    case "move":
      return moveBack(planned, original, args);
    case "trash":
      return moveToTrash(planned, original, args);
    case "batch":
      return renameBack(planned, args);
  }
}

function skippedItem(
  sourcePath: string,
  destinationPath: string | null,
  reason: string,
): ResultItem {
  return { sourcePath, destinationPath, status: "skipped", error: reason, skipReason: null };
}

function failedItem(sourcePath: string, destinationPath: string | null, reason: string) {
  return {
    sourcePath,
    destinationPath,
    status: "failed" as const,
    error: reason,
    skipReason: null,
  };
}

function takenReason(path: string): string {
  return `An item named “${basename(path)}” is already in “${basename(dirname(path))}”.`;
}

async function describeFailure(
  fs: WriteOperationFs,
  error: unknown,
  paths: string[],
): Promise<string> {
  const locked = await findLockedRefusal(fs, error, paths);
  return locked?.message ?? describeCopyPasteError(error);
}

// What a write that failed means for its step:
// - "outside_change": the item went away, or another item took the name just then. Like a
//   change the disk check finds, the step is skipped, and dropped from the list.
// - "permanent": it would fail the same way every time (a disk with no Trash, a read-only
//   disk, another disk). Skipped and dropped too, and said, so older operations can still
//   be undone.
// - "retry": anything else (no permission, a lock, the Trash refusing for a reason it
//   didn't give). The step stays on the list, and the next Undo tries it.
export function classifyUndoWriteError(
  code: string | undefined,
): "outside_change" | "permanent" | "retry" {
  switch (code) {
    case "ENOENT":
    case "ENOTDIR":
    case "EEXIST":
      return "outside_change";
    case NO_TRASH_ERROR_CODE:
    case "EROFS":
    case "EXDEV":
      return "permanent";
    default:
      return "retry";
  }
}

// The code a failure of the write to the item at `path` counts as. "No Trash" only when the
// disk is known to have none: macOS said the Trash isn't supported there, or the disk is a
// network share; a Trash that failed without saying why may work next time.
function failureCode(
  error: unknown,
  path: string,
  diskHasTrash: ((path: string) => boolean) | undefined,
): string | undefined {
  const code = errorCode(error);
  if (code === NO_TRASH_ERROR_CODE) {
    const said = errorCode((error as { cause?: unknown }).cause);
    const noTrash = said === "ENOTSUP" || said === "EOPNOTSUPP" || diskHasTrash?.(path) === false;
    return noTrash ? code : undefined;
  }
  return code;
}

// Why a step can never be done, said about its item.
function permanentReason(code: string | undefined, path: string): string {
  const name = `“${basename(path)}”`;
  switch (code) {
    case NO_TRASH_ERROR_CODE:
      return `${name} couldn't be moved to the Trash because its disk has no Trash.`;
    case "EROFS":
      return `${name} is on a disk that can only be read.`;
    default:
      return `${name} is on another disk now.`;
  }
}

// A step whose write (the rename, the Trash, or unlocking the item for them) failed:
// skipped, or kept to be tried again, as classifyUndoWriteError says.
async function writeFailed(
  error: unknown,
  step: { original: UndoStep; from: string; to: string | null; around: string[] },
  args: RunContext,
): Promise<StepOutcome> {
  const { fs } = args;
  const code = failureCode(error, step.from, args.diskHasTrash);
  const kind = classifyUndoWriteError(code);
  if (kind === "retry") {
    const reason = await describeFailure(fs, error, [step.from, ...step.around]);
    return failedStep(step.original, step.from, step.to, reason);
  }
  const reason =
    kind === "permanent"
      ? permanentReason(code, step.from)
      : code === "EEXIST" && step.to !== null
        ? takenReason(step.to)
        : await missingReason(fs, step.from);
  return { status: "skipped", items: [skippedItem(step.from, step.to, reason)], missing: false };
}

// A rename or move back, or an item put back from the Trash.
async function moveBack(
  planned: Extract<PlannedStep, { kind: "move" }>,
  original: UndoStep,
  args: RunContext,
): Promise<StepOutcome> {
  const { fs } = args;
  const check = await checkMove(fs, planned);
  if (!check.ok && check.retry) {
    return failedStep(original, planned.from, planned.to, check.reason);
  }
  if (!check.ok) {
    return {
      status: "skipped",
      items: [skippedItem(planned.from, planned.to, check.reason)],
      missing: check.missing,
    };
  }
  // An item put back from the Trash is the very item that went there (its id was checked).
  // What kept the Trash from taking it was taken off when an Undo moved it there (a lock,
  // a folder that can't be written to, a rule against deleting it), and is again to move
  // it out, then put back once it is back.
  let lifted: Lifted = NOTHING_LIFTED;
  if (planned.putBack && check.id !== null) {
    try {
      lifted = await liftRestrictions(fs, planned.from);
    } catch (error) {
      return writeFailed(error, { original, from: planned.from, to: planned.to, around: [] }, args);
    }
  }
  const renamed = await renameInto(planned, check, original, args);
  const restored = await restoreRestrictions(
    fs,
    renamed.status === "renamed" ? renamed.target : planned.from,
    lifted,
  );
  if (renamed.status !== "renamed") {
    return restored ? renamed : { ...renamed, items: notLockedAgain(renamed.items) };
  }
  const target = renamed.target;
  // A rename keeps the item's id: it is the one the check just read.
  const produced: UndoStep = {
    kind: "moved",
    from: planned.from,
    to: target,
    id: check.id,
    itemKind: check.kind,
    parentId: await args.folderIdOf(dirname(planned.from)),
    ...(planned.putBack ? { fromTrash: true, stamp: await readItemStamp(fs, target) } : {}),
    ...(liftedAny(lifted) && restored ? { locked: true } : {}),
  };
  return {
    status: "done",
    produced,
    items: [doneItem(planned.from, target, restored ? null : lostLockNote(target))],
    removed: null,
  };
}

// What keeps an item from being moved to the Trash or out of it, taken off an item the
// operation made (its id was checked) to move it, and put back after: its lock, a folder's
// read-only mode (renaming it into another folder needs it writable), and an access rule
// against deleting it (a copy of ~/Documents has one).
type Lifted = { flags: number | null; mode: number | null; acl: string | null };

const NOTHING_LIFTED: Lifted = { flags: null, mode: null, acl: null };

function liftedAny(lifted: Lifted): boolean {
  return lifted.flags !== null || lifted.mode !== null || lifted.acl !== null;
}

async function liftRestrictions(fs: WriteOperationFs, path: string): Promise<Lifted> {
  // A locked item's mode and access rules can't be changed: its lock comes off first.
  const flags = await unlockForMove(fs, path);
  const lifted: Lifted = { flags, mode: null, acl: null };
  try {
    const stats = await fs.lstat(path).catch(() => null);
    const mode = typeof stats?.mode === "number" ? stats.mode & 0o7777 : null;
    if (fs.chmod && stats?.isDirectory() && mode !== null && (mode & 0o200) === 0) {
      await fs.chmod(path, mode | 0o200);
      lifted.mode = mode;
    }
    const acl = fs.getAcl ? await fs.getAcl(path).catch(() => null) : null;
    if (fs.setAcl && acl !== null && /:deny:/u.test(acl)) {
      await fs.setAcl(path, null);
      lifted.acl = acl;
    }
  } catch (error) {
    // Left as it was: what was taken off goes back on.
    await restoreRestrictions(fs, path, lifted);
    throw error;
  }
  return lifted;
}

// Puts back on the item at `path` what liftRestrictions took off; whether all of it could be
// (said in the result).
async function restoreRestrictions(
  fs: WriteOperationFs,
  path: string,
  lifted: Lifted,
): Promise<boolean> {
  let restored = true;
  if (lifted.acl !== null) {
    restored = await succeeds(fs.setAcl?.(path, lifted.acl));
  }
  if (lifted.mode !== null) {
    restored = (await succeeds(fs.chmod?.(path, lifted.mode))) && restored;
  }
  if (lifted.flags !== null) {
    restored = (await lockAgain(fs, path, lifted.flags)) && restored;
  }
  return restored;
}

// Whether `write` was made and went through.
async function succeeds(write: Promise<void> | undefined): Promise<boolean> {
  if (write === undefined) {
    return false;
  }
  try {
    await write;
    return true;
  } catch {
    return false;
  }
}

// Puts back the lock taken off an item to move it; whether it could be (said in the result).
async function lockAgain(fs: WriteOperationFs, path: string, flags: number): Promise<boolean> {
  try {
    await fs.setFlags?.(path, flags);
    return true;
  } catch {
    return false;
  }
}

// An item an Undo moved that had its lock or permissions taken off, which couldn't be put
// back: said, though the move is done and nothing is left to do.
function lostLockNote(path: string): string {
  return `“${basename(path)}” was moved, but its lock or permissions couldn't be put back. Set them in Finder's Get Info.`;
}

// A done item, with a note when there is something to know about it.
function doneItem(
  sourcePath: string,
  destinationPath: string | null,
  note: string | null,
): ResultItem {
  return {
    sourcePath,
    destinationPath,
    status: "completed",
    error: note,
    skipReason: null,
    ...(note === null ? {} : { note: true as const }),
  };
}

// Items left where they were, now unlocked: said too.
function notLockedAgain(items: ResultItem[]): ResultItem[] {
  return items.map((item) =>
    item.sourcePath === null
      ? item
      : {
          ...item,
          error:
            `${item.error ?? ""} “${basename(item.sourcePath)}” couldn't be locked again. Lock it in Finder's Get Info.`.trim(),
        },
  );
}

// Renames the item of a move step to where it goes back, with a number when its name is
// taken; where it went, or why it didn't.
async function renameInto(
  planned: Extract<PlannedStep, { kind: "move" }>,
  check: Extract<MoveCheck, { ok: true }>,
  original: UndoStep,
  args: RunContext,
): Promise<{ status: "renamed"; target: string } | StepOutcome> {
  const { fs } = args;
  let target = planned.to;
  let numberedAsFolder: boolean | null = null;
  for (let attempt = 1; ; attempt += 1) {
    if (check.nameTaken || attempt > 1) {
      numberedAsFolder ??= await numbersAsFolder(fs, planned.from, check.isFolder);
      target = await freeNumberedPath(fs, planned.to, numberedAsFolder);
    }
    try {
      if (check.renamesItself && target === planned.to) {
        await fs.rename(planned.from, target);
      } else {
        await fs.renameExclusive(planned.from, target);
      }
      return { status: "renamed", target };
    } catch (error) {
      // Another item took the name just then: the next number is tried, a few times.
      if (errorCode(error) === "EEXIST" && attempt < KEEP_BOTH_ATTEMPTS) {
        continue;
      }
      return writeFailed(
        error,
        {
          original,
          from: planned.from,
          to: target,
          around: [dirname(planned.from), dirname(target)],
        },
        args,
      );
    }
  }
}

// A step whose write failed: it stays to be tried again.
function failedStep(
  original: UndoStep,
  sourcePath: string,
  destinationPath: string | null,
  reason: string,
): StepOutcome {
  return {
    status: "failed",
    produced: null,
    items: [failedItem(sourcePath, destinationPath, reason)],
    leftover: original,
  };
}

// Whether the item at `path` takes a number at the end of its whole name ("Photos 2"): a
// folder does, a package ("Tool.app") takes it before its extension, as a file does.
async function numbersAsFolder(
  fs: WriteOperationFs,
  path: string,
  isFolder: boolean,
): Promise<boolean> {
  if (!isFolder) {
    return false;
  }
  const isPackage = fs.isPackage ? await fs.isPackage(path).catch(() => null) : null;
  return !(isPackage ?? isPackageName(basename(path)));
}

// "a 2.txt", "a 3.txt"… next to `path`: the first name that is free.
async function freeNumberedPath(
  fs: WriteOperationFs,
  path: string,
  numberedAsFolder: boolean,
): Promise<string> {
  const folder = dirname(path);
  for (let number = 2; number <= MAX_ADDED_NUMBER; number += 1) {
    const candidate = join(folder, numberedName(basename(path), numberedAsFolder, " ", number));
    try {
      await fs.lstat(candidate);
    } catch {
      return candidate;
    }
  }
  return path;
}

// What an operation made (or put back) goes to the Trash; never deleted, even on a disk
// without one.
async function moveToTrash(
  planned: Extract<PlannedStep, { kind: "trash" }>,
  original: UndoStep,
  args: RunContext,
): Promise<StepOutcome> {
  const { fs } = args;
  const check = await checkTrash(fs, planned);
  if (!check.ok && check.retry) {
    return failedStep(original, planned.path, null, check.reason);
  }
  if (!check.ok) {
    return {
      status: "skipped",
      items: [skippedItem(planned.path, null, check.reason)],
      missing: check.missing,
    };
  }
  if (check.changed && !args.changedAgreed?.has(planned.path)) {
    const reason = `“${basename(planned.path)}” was changed after ${args.direction === "undo" ? "Undo" : "Redo"} was chosen, so it was left as it is.`;
    return failedStep(original, planned.path, null, reason);
  }
  const id = check.id;
  const parentId = await args.folderIdOf(dirname(planned.path));
  const looks = await stampWithoutId(fs, planned.path, id);
  const before: ItemSize | null = fs.itemSize
    ? await fs.itemSize(planned.path).catch(() => null)
    : null;
  // What an operation made is its own (its id was checked): a copy of a locked item is
  // locked too, a copy of a read-only folder read-only, and a copy of ~/Documents has a rule
  // against deleting it; the Trash refuses all of them. It goes there without them,
  // without asking, and they are put back on it there. So does a copy put back by a Redo.
  let lifted: Lifted = NOTHING_LIFTED;
  if (planned.unlock && check.id !== null) {
    try {
      lifted = await liftRestrictions(fs, planned.path);
    } catch (error) {
      return writeFailed(error, { original, from: planned.path, to: null, around: [] }, args);
    }
  }
  let trashPath: string | null;
  try {
    trashPath = await fs.trash(planned.path);
  } catch (error) {
    const restored = await restoreRestrictions(fs, planned.path, lifted);
    const outcome = await writeFailed(
      error,
      { original, from: planned.path, to: null, around: [dirname(planned.path)] },
      args,
    );
    return restored ? outcome : { ...outcome, items: notLockedAgain(outcome.items) };
  }
  const restored = trashPath === null || (await restoreRestrictions(fs, trashPath, lifted));
  return {
    status: "done",
    // In the Trash, but the Trash didn't say where: done, and nothing to do it again from.
    produced:
      trashPath === null
        ? null
        : { kind: "trashed", from: planned.path, trashPath, id, parentId, ...looks },
    items: [doneItem(planned.path, null, restored ? null : lostLockNote(planned.path))],
    removed: {
      path: planned.path,
      item: before,
      intoHomeTrash: before === null || args.homeDev === null ? null : before.dev === args.homeDev,
    },
  };
}

// The items of a batch rename get their names back, as one batch again: that handles
// swaps ("a" and "b" trading names) and a folder renamed with items inside it.
//
// What is recorded says exactly where each item went, so either list can always put it
// back: an item that moved is done from where it was to where it is now, and an item not
// yet back under its name is left to do from where it is now. That is so for an item that
// took a number only because the name it goes back to is still held by an item of the
// batch that wasn't renamed (two that swap names, one of them locked): it waits under the
// number, and is tried again with the other.
async function renameBack(
  planned: Extract<PlannedStep, { kind: "batch" }>,
  args: RunContext,
): Promise<StepOutcome> {
  const { fs } = args;
  const items: ResultItem[] = [];
  const running: BatchItem[] = [];
  const toRename: Array<{ sourcePath: string; destinationName: string; isFolder: boolean }> = [];
  const checks = await checkBatch(fs, planned);
  // An item that couldn't be checked leaves the whole batch to be tried again: its items
  // may swap names with each other.
  const unreadable = checks.find((check) => check.refusal?.retry);
  if (unreadable?.refusal) {
    return {
      status: "failed",
      produced: null,
      items: [failedItem(unreadable.item.from, unreadable.item.to, unreadable.refusal.reason)],
      // The whole step as the operation named it (see the end of this function).
      leftover: {
        kind: "batchRenamed",
        items: planned.items.map((item) => ({
          from: item.to,
          to: item.from,
          id: item.id,
          itemKind: item.itemKind,
        })),
      },
    };
  }
  for (const check of checks) {
    if (check.refusal) {
      items.push(skippedItem(check.item.from, check.item.to, check.refusal.reason));
    } else {
      running.push(check.item);
      toRename.push({
        sourcePath: check.item.from,
        destinationName: basename(check.item.to),
        // Says where a number goes when the name is taken: a package's before its extension.
        isFolder: await numbersAsFolder(fs, check.item.from, check.isFolder),
      });
    }
  }
  if (running.length === 0) {
    return { status: "skipped", items, missing: false };
  }
  const errors = recordingErrors(fs);
  const batch = await runBatchRename({
    request: { items: toRename, onConflict: "number", numberSeparator: " " },
    fs: errors.fs,
    signal: args.signal,
    journal: args.journal ?? null,
  });
  // Every item has a result, in the order asked for. Names are compared in the folder the
  // item was in: a folder renamed in the same batch takes its items' paths along.
  const outcomes = batch.items.map((result, index) => {
    const from = result.sourcePath ?? "";
    return {
      item: running[index] as BatchItem,
      result,
      from,
      wanted: join(dirname(from), toRename[index]?.destinationName ?? ""),
      at: result.destinationPath ?? from,
      // Left to do, though it moved: numbered while it waits for another item.
      waits: false,
    };
  });
  // The names still held by items that weren't renamed.
  const held = new Set<string>();
  for (const { result, from, at } of outcomes) {
    if (result.status !== "completed" && basename(at) === basename(from)) {
      held.add(placeKey(from));
    }
  }
  for (const outcome of outcomes) {
    const { result, from, wanted } = outcome;
    if (
      result.status !== "completed" ||
      basename(outcome.at) === basename(wanted) ||
      !held.has(placeKey(wanted))
    ) {
      continue;
    }
    // Under the number for now: done from where it was to there, and left to do from there.
    outcome.waits = true;
    items.push(
      failedItem(
        from,
        outcome.at,
        `“${basename(from)}” is named “${basename(outcome.at)}” for now, because “${basename(wanted)}” couldn't be renamed out of its way.`,
      ),
    );
  }
  const moves: ResultItem[] = [];
  const leftover: BatchItem[] = [];
  for (const outcome of outcomes) {
    const { item, result, from, at } = outcome;
    const moved = basename(at) !== basename(from);
    if (moved) {
      moves.push({ ...result, destinationPath: at });
    }
    if (result.status === "completed" && moved && !outcome.waits) {
      items.push(result);
      continue;
    }
    if (outcome.waits) {
      // Still under the number: said so above.
      leftover.push({ ...item, from: at });
      continue;
    }
    if ((await readItemRef(fs.lstat, at)).kind === null) {
      // Gone while it was being renamed: like an item the check finds gone.
      items.push(skippedItem(from, item.to, await missingReason(fs, from)));
      continue;
    }
    if (result.status === "failed") {
      const code = failureCode({ code: errors.codeOf(from) }, at, args.diskHasTrash);
      const kind = classifyUndoWriteError(code);
      if (kind !== "retry") {
        const reason = kind === "permanent" ? permanentReason(code, from) : result.error;
        items.push(skippedItem(from, item.to, reason ?? takenReason(item.to)));
        continue;
      }
    }
    if (result.status !== "cancelled") {
      items.push(result);
    }
    leftover.push({ ...item, from: at });
  }
  const renamed = await movedItemsOf(fs.lstat, moves);
  const produced: UndoStep | null =
    renamed.length > 0 ? { kind: "batchRenamed", items: renamed } : null;
  // What is left of the step, as the operation named it, each item where it is now.
  const left: UndoStep = {
    kind: "batchRenamed",
    items: leftover.map((item) => ({
      from: item.to,
      to: item.from,
      id: item.id,
      itemKind: item.itemKind,
    })),
  };
  if (leftover.length > 0) {
    return { status: batch.cancelled ? "stopped" : "failed", produced, items, leftover: left };
  }
  return produced
    ? { status: "done", produced, items, removed: null }
    : { status: "skipped", items, missing: false };
}

type BatchItem = Extract<PlannedStep, { kind: "batch" }>["items"][number];

// `fs` for a batch rename, keeping the error each item's rename failed with, by where the
// item was before it: an item moved aside under a hidden name keeps its own. A name found
// taken is kept only when nothing else went wrong (the batch numbers it).
function recordingErrors(fs: WriteOperationFs): {
  fs: WriteOperationFs;
  codeOf: (path: string) => string | undefined;
} {
  const startedAt = new Map<string, string>();
  const codes = new Map<string, string | undefined>();
  const recording =
    (rename: WriteOperationFs["rename"]) =>
    async (from: string, to: string): Promise<void> => {
      const item = startedAt.get(from) ?? from;
      try {
        await rename(from, to);
        startedAt.set(to, item);
      } catch (error) {
        const code = errorCode(error);
        if (code !== "EEXIST" || !codes.has(item)) {
          codes.set(item, code);
        }
        throw error;
      }
    };
  return {
    fs: { ...fs, rename: recording(fs.rename), renameExclusive: recording(fs.renameExclusive) },
    codeOf: (path) => codes.get(path),
  };
}

// A step not run because the one before it in the same unit couldn't be.
function blockedItems(planned: PlannedStep, direction: UndoDirection): ResultItem[] {
  const verb = direction === "undo" ? "undone" : "redone";
  switch (planned.kind) {
    case "move":
      return [
        skippedItem(
          planned.from,
          planned.to,
          planned.putBack
            ? `“${basename(planned.to)}” was left in the Trash, because the item in its place couldn't be moved away.`
            : `“${basename(planned.from)}” was left as it is, because the step before it couldn't be ${verb}.`,
        ),
      ];
    case "trash":
      return [
        skippedItem(
          planned.path,
          null,
          `“${basename(planned.path)}” was left as it is, because the step before it couldn't be ${verb}.`,
        ),
      ];
    case "batch":
      return [];
  }
}
