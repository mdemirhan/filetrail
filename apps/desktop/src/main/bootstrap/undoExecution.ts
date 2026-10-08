import { basename, dirname, join } from "node:path";

import type { UndoDirection, WriteOperationResult } from "@filetrail/contracts";
import {
  NO_TRASH_ERROR_CODE,
  type UndoStep,
  type UndoUnit,
  describeCopyPasteError,
  errorCode,
  findLockedRefusal,
  readFolderId,
  readItemId,
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
  // What a stop didn't reach, and the units whose write failed, newest first.
  let notReached: UndoUnit[] = [];
  const failed: UndoUnit[] = [];
  eachUnit: for (let unitIndex = units.length - 1; unitIndex >= 0; unitIndex -= 1) {
    const unit = units[unitIndex] as UndoUnit;
    const doneSteps: UndoStep[] = [];
    // Once a step can't be undone, the ones before it in the unit aren't either: the old
    // item of a Replace isn't put back where the new one still is.
    let blocked = false;
    for (let stepIndex = unit.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
      const step = unit.steps[stepIndex] as UndoStep;
      const planned = reverseStep(step);
      if (blocked) {
        run.items.push(...blockedItems(planned, args.direction));
        continue;
      }
      if (args.signal.aborted) {
        run.cancelled = true;
        notReached = [...units.slice(0, unitIndex), { steps: unit.steps.slice(0, stepIndex + 1) }];
        pushDone(run, doneSteps);
        break eachUnit;
      }
      args.onStepStart?.(firstPathOf(planned), run.completedItemCount);
      const outcome = await runStep(planned, step, args);
      run.items.push(...outcome.items);
      run.completedItemCount += outcome.items.filter((item) => item.status === "completed").length;
      if (outcome.status !== "skipped" && outcome.produced) {
        doneSteps.push(outcome.produced);
      }
      if (outcome.status === "stopped") {
        run.cancelled = true;
        notReached = [
          ...units.slice(0, unitIndex),
          { steps: [...unit.steps.slice(0, stepIndex), outcome.leftover] },
        ];
        pushDone(run, doneSteps);
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
    pushDone(run, doneSteps);
  }
  run.leftover = [...notReached, ...failed.reverse()];
  return run;
}

function pushDone(run: UndoRun, steps: UndoStep[]): void {
  if (steps.length > 0) {
    run.done.push({ steps: [...steps] });
    steps.length = 0;
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

function runStep(
  planned: PlannedStep,
  original: UndoStep,
  args: Parameters<typeof runUndo>[0],
): Promise<StepOutcome> {
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

// A rename or move back, or an item put back from the Trash.
async function moveBack(
  planned: Extract<PlannedStep, { kind: "move" }>,
  original: UndoStep,
  args: Parameters<typeof runUndo>[0],
): Promise<StepOutcome> {
  const { fs } = args;
  const check = await checkMove(fs, planned);
  if (!check.ok) {
    return {
      status: "skipped",
      items: [skippedItem(planned.from, planned.to, check.reason)],
      missing: check.missing,
    };
  }
  // An item put back from the Trash is the very item that went there (its id was checked).
  // One that is locked (a locked copy an Undo moved there) is unlocked to be moved, and
  // locked again once back.
  let flags: number | null = null;
  if (planned.putBack && check.id !== null) {
    try {
      flags = await unlockForMove(fs, planned.from);
    } catch (error) {
      return failedStep(original, planned.from, planned.to, await describeFailure(fs, error, []));
    }
  }
  const renamed = await renameInto(fs, planned, check, original);
  if (flags !== null) {
    const at = renamed.status === "renamed" ? renamed.target : planned.from;
    await fs.setFlags?.(at, flags).catch(() => undefined);
  }
  if (renamed.status !== "renamed") {
    return renamed;
  }
  const target = renamed.target;
  const moved = await readItemRef(fs.lstat, target);
  const produced: UndoStep = {
    kind: "moved",
    from: planned.from,
    to: target,
    id: moved.id,
    itemKind: moved.kind,
    parentId: await readFolderId(fs.stat, dirname(planned.from)),
    ...(planned.putBack ? { fromTrash: true, stamp: await readItemStamp(fs, target) } : {}),
  };
  return {
    status: "done",
    produced,
    items: [
      {
        sourcePath: planned.from,
        destinationPath: target,
        status: "completed",
        error: null,
        skipReason: null,
      },
    ],
    removed: null,
  };
}

// Renames the item of a move step to where it goes back, with a number when its name is
// taken; where it went, or why it didn't.
async function renameInto(
  fs: WriteOperationFs,
  planned: Extract<PlannedStep, { kind: "move" }>,
  check: Extract<MoveCheck, { ok: true }>,
  original: UndoStep,
): Promise<{ status: "renamed"; target: string } | StepOutcome> {
  let target = planned.to;
  for (let attempt = 1; ; attempt += 1) {
    if (check.nameTaken || attempt > 1) {
      target = await freeNumberedPath(fs, planned.to, check.isFolder);
    }
    try {
      if (check.renamesItself && target === planned.to) {
        await fs.rename(planned.from, target);
      } else {
        await fs.renameExclusive(planned.from, target);
      }
      return { status: "renamed", target };
    } catch (error) {
      const taken = errorCode(error) === "EEXIST";
      if (taken && attempt < KEEP_BOTH_ATTEMPTS) {
        continue;
      }
      // Other items kept taking the name, or the item (or its folder) went away just then:
      // changes outside the app, like those the check finds.
      if (taken) {
        return {
          status: "skipped",
          items: [skippedItem(planned.from, planned.to, takenReason(target))],
          missing: false,
        };
      }
      if (errorCode(error) === "ENOENT") {
        return {
          status: "skipped",
          items: [skippedItem(planned.from, planned.to, await missingReason(fs, planned.from))],
          missing: false,
        };
      }
      const reason = await describeFailure(fs, error, [
        planned.from,
        dirname(planned.from),
        dirname(target),
      ]);
      return failedStep(original, planned.from, target, reason);
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

// "a 2.txt", "a 3.txt"… next to `path`: the first name that is free.
async function freeNumberedPath(
  fs: WriteOperationFs,
  path: string,
  isFolder: boolean,
): Promise<string> {
  const folder = dirname(path);
  for (let number = 2; number <= MAX_ADDED_NUMBER; number += 1) {
    const candidate = join(folder, numberedName(basename(path), isFolder, " ", number));
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
  args: Parameters<typeof runUndo>[0],
): Promise<StepOutcome> {
  const { fs } = args;
  const check = await checkTrash(fs, planned);
  if (!check.ok) {
    return {
      status: "skipped",
      items: [skippedItem(planned.path, null, check.reason)],
      missing: check.missing,
    };
  }
  const id = await readItemId(fs.lstat, planned.path);
  const parentId = await readFolderId(fs.stat, dirname(planned.path));
  const looks = await stampWithoutId(fs, planned.path, id);
  const before: ItemSize | null = fs.itemSize
    ? await fs.itemSize(planned.path).catch(() => null)
    : null;
  // What an operation made is its own (its id was checked): a copy of a locked item is
  // locked too, and the Trash refuses a locked item. It goes there unlocked, without asking,
  // and is locked again there.
  let flags: number | null = null;
  if (!planned.putBack && check.id !== null) {
    try {
      flags = await unlockForMove(fs, planned.path);
    } catch (error) {
      return failedStep(original, planned.path, null, await describeFailure(fs, error, []));
    }
  }
  let trashPath: string | null;
  try {
    trashPath = await fs.trash(planned.path);
  } catch (error) {
    if (flags !== null) {
      await fs.setFlags?.(planned.path, flags).catch(() => undefined);
    }
    const reason =
      errorCode(error) === NO_TRASH_ERROR_CODE
        ? `“${basename(planned.path)}” couldn't be moved to the Trash because its disk has no Trash.`
        : await describeFailure(fs, error, [planned.path, dirname(planned.path)]);
    return failedStep(original, planned.path, null, reason);
  }
  if (flags !== null && trashPath !== null) {
    await fs.setFlags?.(trashPath, flags).catch(() => undefined);
  }
  return {
    status: "done",
    // In the Trash, but the Trash didn't say where: done, and nothing to do it again from.
    produced:
      trashPath === null
        ? null
        : { kind: "trashed", from: planned.path, trashPath, id, parentId, ...looks },
    items: [
      {
        sourcePath: planned.path,
        destinationPath: null,
        status: "completed",
        error: null,
        skipReason: null,
      },
    ],
    removed: {
      path: planned.path,
      item: before,
      intoHomeTrash: before === null || args.homeDev === null ? null : before.dev === args.homeDev,
    },
  };
}

// The items of a batch rename get their names back, as one batch again: that handles
// swaps ("a" and "b" trading names) and a folder renamed with items inside it.
async function renameBack(
  planned: Extract<PlannedStep, { kind: "batch" }>,
  args: Parameters<typeof runUndo>[0],
): Promise<StepOutcome> {
  const { fs } = args;
  const items: ResultItem[] = [];
  const toRename: Array<{ sourcePath: string; destinationName: string; isFolder: boolean }> = [];
  for (const check of await checkBatch(fs, planned)) {
    if (check.refusal) {
      items.push(skippedItem(check.item.from, check.item.to, check.refusal.reason));
    } else {
      toRename.push({
        sourcePath: check.item.from,
        destinationName: basename(check.item.to),
        isFolder: check.isFolder,
      });
    }
  }
  let renamed: Extract<UndoStep, { kind: "batchRenamed" }>["items"] = [];
  let cancelled = false;
  if (toRename.length > 0) {
    const batch = await runBatchRename({
      request: {
        items: toRename,
        onConflict: "number",
        numberSeparator: " ",
      },
      fs,
      signal: args.signal,
    });
    cancelled = batch.cancelled;
    items.push(...batch.items);
    renamed = await movedItemsOf(fs.lstat, batch.items);
  }
  const produced: UndoStep | null =
    renamed.length > 0 ? { kind: "batchRenamed", items: renamed } : null;
  // What is left of the step, as the operation named it: the items `keep` takes.
  const leftOf = (keep: (from: string) => boolean): UndoStep => ({
    kind: "batchRenamed",
    items: planned.items
      .filter((item) => keep(item.from))
      .map((item) => ({ from: item.to, to: item.from, id: item.id, itemKind: item.itemKind })),
  });
  // Items whose rename failed and which are still where they were: they are tried again.
  const failedInPlace = new Set<string>();
  for (const item of items) {
    if (
      item.status === "failed" &&
      item.sourcePath !== null &&
      item.destinationPath === null &&
      (await readItemRef(fs.lstat, item.sourcePath)).kind !== null
    ) {
      failedInPlace.add(item.sourcePath);
    }
  }
  if (cancelled) {
    // The items not reached keep their place in the history, as the operation named them.
    // (An item not reached that still had to be moved aside is somewhere else now: it is
    // in what was done.)
    const reached = new Set(
      items
        .filter((item) => item.status !== "cancelled" || item.destinationPath !== null)
        .map((item) => item.sourcePath),
    );
    return {
      status: "stopped",
      produced,
      items: items.filter((item) => item.status !== "cancelled"),
      leftover: leftOf((from) => !reached.has(from) || failedInPlace.has(from)),
    };
  }
  if (failedInPlace.size > 0) {
    return {
      status: "failed",
      produced,
      items,
      leftover: leftOf((from) => failedInPlace.has(from)),
    };
  }
  return produced
    ? { status: "done", produced, items, removed: null }
    : { status: "skipped", items, missing: false };
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
