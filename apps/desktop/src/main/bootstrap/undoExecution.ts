import { basename, dirname, join } from "node:path";

import type { UndoDirection, WriteOperationResult } from "@filetrail/contracts";
import {
  NO_TRASH_ERROR_CODE,
  type UndoStep,
  type UndoUnit,
  describeCopyPasteError,
  findLockedRefusal,
  readItemId,
  readItemRef,
  readItemStamp,
} from "@filetrail/core";

import { numberedName, runBatchRename } from "./batchRenameExecution";
import type { ItemSize, RemovedItem } from "./folderSizeAdjust";
import { type PlannedStep, checkBatch, checkMove, checkTrash, reverseStep } from "./undoPlan";
import type { WriteOperationFs } from "./writeOperations";

// Runs an Undo (or a Redo): the reverse of each step, newest first, one at a time. Each is
// checked on disk just before it runs and skipped, never forced, when it no longer fits.
// Nothing is overwritten (every move refuses a taken name) and nothing is deleted: what
// an operation made goes to the Trash.

// What the person answered before it started (see findQuestions).
export type UndoAnswers = {
  // An item's old name is taken by another item now: leave the item, or give it a number.
  nameTaken: "skip" | "keep_both";
  // An item that would go to the Trash has changed since: move it anyway, or leave it.
  changed: "trash" | "skip";
};

type ResultItem = WriteOperationResult["items"][number];

export type UndoRun = {
  items: ResultItem[];
  // What was done, unit by unit in the order it was done: what the other direction undoes.
  done: UndoUnit[];
  // What a stop left to do, in the order the operation did it.
  leftover: UndoUnit[];
  removedItems: RemovedItem[];
  completedItemCount: number;
  cancelled: boolean;
};

// Tries at a free numbered name ("a 2.txt") when the one found free is taken just then.
const KEEP_BOTH_ATTEMPTS = 3;
const MAX_ADDED_NUMBER = 10_000;

type StepOutcome =
  | { status: "done"; produced: UndoStep; items: ResultItem[]; removed: RemovedItem | null }
  | { status: "skipped"; items: ResultItem[]; missing: boolean }
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
  answers: UndoAnswers;
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
        run.leftover = [
          ...units.slice(0, unitIndex),
          { steps: unit.steps.slice(0, stepIndex + 1) },
        ];
        pushDone(run, doneSteps);
        break eachUnit;
      }
      args.onStepStart?.(firstPathOf(planned), run.completedItemCount);
      const outcome = await runStep(planned, step, args);
      run.items.push(...outcome.items);
      run.completedItemCount += outcome.items.filter((item) => item.status === "completed").length;
      if (outcome.status === "stopped") {
        if (outcome.produced) {
          doneSteps.push(outcome.produced);
        }
        run.cancelled = true;
        run.leftover = [
          ...units.slice(0, unitIndex),
          { steps: [...unit.steps.slice(0, stepIndex), outcome.leftover] },
        ];
        pushDone(run, doneSteps);
        break eachUnit;
      }
      if (outcome.status === "done") {
        doneSteps.push(outcome.produced);
        if (outcome.removed) {
          run.removedItems.push(outcome.removed);
        }
      } else if (!outcome.missing) {
        blocked = true;
      }
    }
    pushDone(run, doneSteps);
  }
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
      return moveBack(planned, args);
    case "trash":
      return moveToTrash(planned, args);
    case "batch":
      return renameBack(planned, original, args);
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
  if (check.nameTaken && args.answers.nameTaken === "skip") {
    return {
      status: "skipped",
      items: [skippedItem(planned.from, planned.to, takenReason(planned.to))],
      missing: false,
    };
  }
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
      break;
    } catch (error) {
      const taken = errorCode(error) === "EEXIST";
      if (taken && args.answers.nameTaken === "keep_both" && attempt < KEEP_BOTH_ATTEMPTS) {
        continue;
      }
      if (taken) {
        return {
          status: "skipped",
          items: [skippedItem(planned.from, planned.to, takenReason(target))],
          missing: false,
        };
      }
      const reason = await describeFailure(fs, error, [
        planned.from,
        dirname(planned.from),
        dirname(target),
      ]);
      return {
        status: "skipped",
        items: [failedItem(planned.from, target, reason)],
        missing: false,
      };
    }
  }
  const moved = await readItemRef(fs.lstat, target);
  const produced: UndoStep = {
    kind: "moved",
    from: planned.from,
    to: target,
    id: moved.id,
    itemKind: moved.kind,
    parentId: await readItemId(fs.lstat, dirname(planned.from)),
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
  if (check.changed && args.answers.changed === "skip") {
    return {
      status: "skipped",
      items: [
        skippedItem(
          planned.path,
          null,
          `“${basename(planned.path)}” has changed since, so it was left where it is.`,
        ),
      ],
      missing: false,
    };
  }
  const id = await readItemId(fs.lstat, planned.path);
  const parentId = await readItemId(fs.lstat, dirname(planned.path));
  const before: ItemSize | null = fs.itemSize
    ? await fs.itemSize(planned.path).catch(() => null)
    : null;
  let trashPath: string;
  try {
    trashPath = await fs.trash(planned.path);
  } catch (error) {
    const reason =
      errorCode(error) === NO_TRASH_ERROR_CODE
        ? `“${basename(planned.path)}” couldn't be moved to the Trash because its disk has no Trash.`
        : await describeFailure(fs, error, [planned.path, dirname(planned.path)]);
    return { status: "skipped", items: [failedItem(planned.path, null, reason)], missing: false };
  }
  return {
    status: "done",
    produced: { kind: "trashed", from: planned.path, trashPath, id, parentId },
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
  original: UndoStep,
  args: Parameters<typeof runUndo>[0],
): Promise<StepOutcome> {
  const { fs } = args;
  const items: ResultItem[] = [];
  const toRename: Array<{ sourcePath: string; destinationName: string; isFolder: boolean }> = [];
  for (const check of await checkBatch(fs, planned)) {
    if (check.refusal) {
      items.push(skippedItem(check.item.from, check.item.to, check.refusal.reason));
    } else if (check.nameTaken && args.answers.nameTaken === "skip") {
      items.push(skippedItem(check.item.from, check.item.to, takenReason(check.item.to)));
    } else {
      toRename.push({
        sourcePath: check.item.from,
        destinationName: basename(check.item.to),
        isFolder: check.isFolder,
      });
    }
  }
  const renamed: Extract<UndoStep, { kind: "batchRenamed" }>["items"] = [];
  let cancelled = false;
  if (toRename.length > 0) {
    const batch = await runBatchRename({
      request: {
        items: toRename,
        onConflict: args.answers.nameTaken === "keep_both" ? "number" : "skip",
        numberSeparator: " ",
      },
      fs,
      signal: args.signal,
    });
    cancelled = batch.cancelled;
    for (const item of batch.items) {
      items.push(item);
      if (
        item.status === "completed" &&
        item.sourcePath !== null &&
        item.destinationPath !== null &&
        item.destinationPath !== item.sourcePath
      ) {
        const now = await readItemRef(fs.lstat, item.destinationPath);
        renamed.push({
          from: item.sourcePath,
          to: item.destinationPath,
          id: now.id,
          itemKind: now.kind,
        });
      }
    }
  }
  const produced: UndoStep | null =
    renamed.length > 0 ? { kind: "batchRenamed", items: renamed } : null;
  if (cancelled && original.kind === "batchRenamed") {
    // The items not reached keep their place in the history, as the operation named them.
    const reached = new Set(
      items.filter((item) => item.status !== "cancelled").map((item) => item.sourcePath),
    );
    return {
      status: "stopped",
      produced,
      items: items.filter((item) => item.status !== "cancelled"),
      leftover: {
        kind: "batchRenamed",
        items: original.items.filter((item) => !reached.has(item.to)),
      },
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

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
