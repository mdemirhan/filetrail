import { basename, dirname, join } from "node:path";

import {
  type ItemId,
  type ItemKind,
  type ItemStamp,
  type UndoStep,
  type UndoUnit,
  describeCopyPasteError,
  errorCode,
  itemIdOf,
  kindOfStats,
  readItemStamp,
  sameItemId,
} from "@filetrail/core";

// What undoing one step does, and whether it can be done now. Nothing here changes the
// disk: undoExecution.ts does, checking each step again just before it runs.

// The reverse of a step, ready to run.
export type PlannedStep =
  // Moves the item at `from` to `to`: a rename or move back, or putting an item back from
  // the Trash (`putBack`). `parentId` is the folder `to` must still be the one it was.
  // `stamp` is how an item without a usable id looked when it went to the Trash.
  | {
      kind: "move";
      from: string;
      to: string;
      id: ItemId | null;
      itemKind: ItemKind | null;
      parentId: ItemId | null;
      putBack: boolean;
      stamp?: ItemStamp;
    }
  // Moves the item at `path` to the Trash: something an operation made, or put back from
  // the Trash (`putBack`). `unlock`: it may be locked by the app's own doing (a copy of a
  // locked item, or one put back locked), and is unlocked to go.
  | {
      kind: "trash";
      path: string;
      id: ItemId | null;
      stamp: ItemStamp | null;
      putBack: boolean;
      unlock: boolean;
    }
  // Renames each item at `from` back to the name in `to`, as one batch.
  | {
      kind: "batch";
      items: Array<{ from: string; to: string; id: ItemId | null; itemKind: ItemKind | null }>;
    };

export function reverseStep(step: UndoStep): PlannedStep {
  switch (step.kind) {
    case "moved":
      return step.fromTrash
        ? {
            kind: "trash",
            path: step.to,
            id: step.id,
            stamp: step.stamp ?? null,
            putBack: true,
            unlock: step.locked === true,
          }
        : {
            kind: "move",
            from: step.to,
            to: step.from,
            id: step.id,
            itemKind: step.itemKind,
            parentId: step.parentId,
            putBack: false,
          };
    case "created":
      return {
        kind: "trash",
        path: step.path,
        id: step.id,
        stamp: step.stamp,
        putBack: false,
        unlock: true,
      };
    case "trashed":
      return {
        kind: "move",
        from: step.trashPath,
        to: step.from,
        id: step.id,
        // The Trash never changes what is in it: only the very item goes back. Without an
        // id, it has to look as it did when it went.
        itemKind: step.stamp?.kind ?? null,
        parentId: step.parentId,
        putBack: true,
        ...(step.stamp ? { stamp: step.stamp } : {}),
      };
    case "batchRenamed":
      return {
        kind: "batch",
        items: step.items.map((item) => ({
          from: item.to,
          to: item.from,
          id: item.id,
          itemKind: item.itemKind,
        })),
      };
  }
}

type PlanStats = {
  dev?: number;
  ino?: number;
  size?: number;
  mtimeMs?: number;
  isFile?: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink?: () => boolean;
};

export type PlanFs = {
  lstat: (path: string) => Promise<PlanStats>;
  // For the folder an item goes back to, which may be reached through a link.
  stat: (path: string) => Promise<PlanStats>;
  readdir?: (path: string) => Promise<string[]>;
};

// Why a step can't be undone, said about the item. `missing` means nothing is left where
// the item was: no other item is in the way of the steps after it. `retry` means it can't
// be told now (the disk couldn't be read: no permission, an error, a share not answering):
// the step stays to be tried again, never dropped as if its item were gone.
export type Refusal = { reason: string; missing: boolean; retry?: true };

// `id` is the item's id now, when it has one.
export type MoveCheck =
  | {
      ok: true;
      nameTaken: boolean;
      renamesItself: boolean;
      isFolder: boolean;
      id: ItemId | null;
      kind: ItemKind;
    }
  | ({ ok: false } & Refusal);

export type TrashCheck =
  | { ok: true; changed: boolean; id: ItemId | null }
  | ({ ok: false } & Refusal);

// What the steps before one in the same unit will have done by the time it runs (a Replace
// moves its new item away before it puts the old one back): the items they move away, by
// id (and by place, for an item without one: only FAT and exFAT, which ignore case), and
// the places they move items into.
export type UnitChanges = {
  movedAwayIds: Set<string>;
  movedAwayPaths: Set<string>;
  filledPlaces: Set<string>;
};

export function noUnitChanges(): UnitChanges {
  return { movedAwayIds: new Set(), movedAwayPaths: new Set(), filledPlaces: new Set() };
}

function idKey(id: ItemId): string {
  return `${id.dev}:${id.ino}`;
}

// A place compared as a disk that ignores case and accent encoding does, as the Mac's disks
// do: on one that minds case, two names that differ only in case are at worst asked about
// though only one of them is taken.
export function placeKey(path: string): string {
  return path.normalize("NFD").toLowerCase();
}

// The item at `path` leaves before the step runs. It is found by id, so "x.txt" finds the
// "X.TXT" a step before moved away, on a disk that takes them for one name.
function leavesBefore(stats: PlanStats, path: string, changes: UnitChanges): boolean {
  const id = itemIdOf(stats);
  return id !== null
    ? changes.movedAwayIds.has(idKey(id))
    : changes.movedAwayPaths.has(placeKey(path));
}

function noteMovedAway(changes: UnitChanges, path: string, id: ItemId | null): void {
  if (id !== null) {
    changes.movedAwayIds.add(idKey(id));
  }
  changes.movedAwayPaths.add(placeKey(path));
  changes.filledPlaces.delete(placeKey(path));
}

async function lstatOrNull(fs: PlanFs, path: string): Promise<PlanStats | null> {
  try {
    return await fs.lstat(path);
  } catch {
    return null;
  }
}

// What is at `path`: an item, nothing at all, or an error that hides whether there is one.
type LookedUp = { stats: PlanStats } | { missing: true } | { unreadable: Refusal };

async function lookUp(
  fs: PlanFs,
  path: string,
  look: (path: string) => Promise<PlanStats> = fs.lstat,
): Promise<LookedUp> {
  try {
    return { stats: await look(path) };
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { missing: true };
    }
    return {
      unreadable: {
        reason: `“${basename(path)}” couldn't be checked: ${describeCopyPasteError(error)}`,
        missing: false,
        retry: true,
      },
    };
  }
}

// Whether the item at `path` is the one a step was about. Its id must match; when moving
// or renaming it back (`relaxed`), an item of the same kind under the same name is taken
// too, since apps save a document by replacing its file, which gives it a new id. Without
// a usable id (FAT, exFAT), the kind is all there is to go by.
function isExpectedItem(
  stats: PlanStats,
  id: ItemId | null,
  itemKind: ItemKind | null,
  relaxed: boolean,
): boolean {
  const currentId = itemIdOf(stats);
  if (id !== null && currentId !== null) {
    if (sameItemId(id, currentId)) {
      return true;
    }
    return relaxed && itemKind !== null && kindOfStats(stats) === itemKind;
  }
  return itemKind === null || kindOfStats(stats) === itemKind;
}

// An item that isn't where it was: gone, or on a disk that is no longer connected.
export async function missingReason(fs: PlanFs, path: string): Promise<string> {
  const disk = /^\/Volumes\/([^/]+)\//u.exec(path)?.[1];
  if (disk !== undefined && (await lstatOrNull(fs, `/Volumes/${disk}`)) === null) {
    return `“${basename(path)}” is on “${disk}”, which isn't connected.`;
  }
  return `“${basename(path)}” is no longer in “${basename(dirname(path))}”.`;
}

// The item at `path` isn't the one a step was about (`expected`): another item, or the
// same one on a disk that was ejected and connected again, which gives it another device
// number (and Undo can't tell it is the same disk).
function replacedReason(path: string, expected: ItemId | null, stats: PlanStats): string {
  if (reconnected(expected, itemIdOf(stats))) {
    return `“${basename(path)}” is on a disk that was disconnected since, so it is left as it is.`;
  }
  return `The “${basename(path)}” in “${basename(dirname(path))}” is another item now.`;
}

// The same file id on another device number: the disk was ejected and connected again.
function reconnected(expected: ItemId | null, now: ItemId | null): boolean {
  return expected !== null && now !== null && expected.dev !== now.dev && expected.ino === now.ino;
}

// Whether `step` can be done now, or once the steps before it in the same unit have made
// `changes` (a Replace puts its old item back where the new one was).
export async function checkMove(
  fs: PlanFs,
  step: Extract<PlannedStep, { kind: "move" }>,
  changes: UnitChanges = noUnitChanges(),
): Promise<MoveCheck> {
  const found = await lookUp(fs, step.from);
  if ("unreadable" in found) {
    return { ok: false, ...found.unreadable };
  }
  if ("missing" in found) {
    return { ok: false, reason: await missingReason(fs, step.from), missing: true };
  }
  const item = found.stats;
  if (!isExpectedItem(item, step.id, step.itemKind, !step.putBack)) {
    return { ok: false, reason: replacedReason(step.from, step.id, item), missing: false };
  }
  // In the Trash without an id to go by: only an item that looks as it did is taken.
  if (step.stamp && (step.id === null || itemIdOf(item) === null)) {
    const now = await readItemStamp(fs, step.from);
    if (now === null) {
      // Found a moment ago: it couldn't be read just now, which says nothing about it.
      const again = await lookUp(fs, step.from);
      if ("missing" in again) {
        return { ok: false, reason: await missingReason(fs, step.from), missing: true };
      }
      return {
        ok: false,
        ...("unreadable" in again
          ? again.unreadable
          : {
              reason: `“${basename(step.from)}” couldn't be checked.`,
              missing: false,
              retry: true as const,
            }),
      };
    }
    if (!sameStamp(step.stamp, now)) {
      return { ok: false, reason: replacedReason(step.from, null, item), missing: false };
    }
  }
  const folderPath = dirname(step.to);
  // Through a link, as when the step was recorded (see readFolderId).
  const foundFolder = await lookUp(fs, folderPath, fs.stat);
  if ("unreadable" in foundFolder) {
    return { ok: false, ...foundFolder.unreadable };
  }
  const folder = "stats" in foundFolder ? foundFolder.stats : null;
  if (folder === null || !folder.isDirectory()) {
    return {
      ok: false,
      reason: `Its folder “${basename(folderPath)}” no longer exists.`,
      missing: false,
    };
  }
  const folderId = itemIdOf(folder);
  if (step.parentId !== null && folderId !== null && !sameItemId(step.parentId, folderId)) {
    return {
      ok: false,
      reason: reconnected(step.parentId, folderId)
        ? `Its folder “${basename(folderPath)}” is on a disk that was disconnected since, so it is left as it is.`
        : `Its folder “${basename(folderPath)}” was replaced by another folder.`,
      missing: false,
    };
  }
  const kind = kindOfStats(item);
  const isFolder = kind === "directory";
  const itemId = itemIdOf(item);
  const foundThere = await lookUp(fs, step.to);
  if ("unreadable" in foundThere) {
    return { ok: false, ...foundThere.unreadable };
  }
  const there = "stats" in foundThere ? foundThere.stats : null;
  if (there === null || leavesBefore(there, step.to, changes)) {
    // Free by then, unless a step before puts another item there.
    const nameTaken = changes.filledPlaces.has(placeKey(step.to));
    return { ok: true, nameTaken, renamesItself: false, isFolder, id: itemId, kind };
  }
  const renamesItself = await findsItself(fs, step, itemId, itemIdOf(there));
  return { ok: true, nameTaken: !renamesItself, renamesItself, isFolder, id: itemId, kind };
}

// On a disk that ignores case, "notes.txt" finds "Notes.txt": the item itself, not another
// in the way. As for a rename: the names match ignoring case and accent encoding, the ids
// are the same or there is none to go by (FAT, exFAT), and the folder doesn't list the
// name as it is spelled. Two hard links to one file, under two names, are two items.
async function findsItself(
  fs: PlanFs,
  step: Extract<PlannedStep, { kind: "move" }>,
  itemId: ItemId | null,
  thereId: ItemId | null,
): Promise<boolean> {
  if (placeKey(step.from) !== placeKey(step.to)) {
    return false;
  }
  if (itemId !== null && thereId !== null && !sameItemId(itemId, thereId)) {
    return false;
  }
  const entries = fs.readdir ? await fs.readdir(dirname(step.to)).catch(() => null) : null;
  return !(entries?.includes(basename(step.to)) ?? false);
}

export async function checkTrash(
  fs: PlanFs,
  step: Extract<PlannedStep, { kind: "trash" }>,
): Promise<TrashCheck> {
  const found = await lookUp(fs, step.path);
  if ("unreadable" in found) {
    return { ok: false, ...found.unreadable };
  }
  if ("missing" in found) {
    return { ok: false, reason: await missingReason(fs, step.path), missing: true };
  }
  const item = found.stats;
  if (!isExpectedItem(item, step.id, step.stamp?.kind ?? null, false)) {
    return { ok: false, reason: replacedReason(step.path, step.id, item), missing: false };
  }
  const id = itemIdOf(item);
  if (step.stamp === null) {
    return { ok: true, changed: false, id };
  }
  const now = await readItemStamp(fs, step.path);
  return { ok: true, changed: now === null || !sameStamp(step.stamp, now), id };
}

// A folder is the same when it holds the same items, by name: its date changes with every
// item added or taken out, so a file moved into a new folder and back out (two Undos) would
// otherwise make it look changed; its items' names don't.
function sameStamp(left: ItemStamp, right: ItemStamp): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "directory") {
    return (
      left.entryCount === right.entryCount &&
      (left.entryNames === undefined ||
        right.entryNames === undefined ||
        left.entryNames === right.entryNames)
    );
  }
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export type BatchItemCheck = {
  item: Extract<PlannedStep, { kind: "batch" }>["items"][number];
  refusal: Refusal | null;
  nameTaken: boolean;
  isFolder: boolean;
};

// Each item of a batch on its own. Items of the batch make way for each other (a swap),
// so a name held by another item of it isn't taken.
export async function checkBatch(
  fs: PlanFs,
  step: Extract<PlannedStep, { kind: "batch" }>,
): Promise<BatchItemCheck[]> {
  // Places the batch's own items leave, compared as the disk compares names, and the items
  // themselves: on a disk that ignores case, "B" finds the batch's own item now at "b".
  const vacated = new Set(step.items.map((item) => item.from));
  // Each item of the batch by id, with where it is: found under another spelling of that
  // place it is the item itself; elsewhere (a hard link to it) it is another entry.
  const ownPlaces = new Map(
    step.items.flatMap((item) =>
      item.id === null ? [] : [[idKey(item.id), placeKey(item.from)] as const],
    ),
  );
  const checks: BatchItemCheck[] = [];
  for (const item of step.items) {
    const found = await lookUp(fs, item.from);
    if ("unreadable" in found) {
      checks.push({ item, refusal: found.unreadable, nameTaken: false, isFolder: false });
      continue;
    }
    const stats = "stats" in found ? found.stats : null;
    if (stats === null) {
      checks.push({
        item,
        refusal: { reason: await missingReason(fs, item.from), missing: true },
        nameTaken: false,
        isFolder: false,
      });
      continue;
    }
    if (!isExpectedItem(stats, item.id, item.itemKind, true)) {
      checks.push({
        item,
        refusal: { reason: replacedReason(item.from, item.id, stats), missing: false },
        nameTaken: false,
        isFolder: false,
      });
      continue;
    }
    // The name it goes back to, in the folder it is in now (its folder may be renamed back
    // in the same batch, after it).
    const target = `${dirname(item.from)}/${basename(item.to)}`;
    const foundThere = vacated.has(target) ? null : await lookUp(fs, target);
    if (foundThere !== null && "unreadable" in foundThere) {
      checks.push({ item, refusal: foundThere.unreadable, nameTaken: false, isFolder: false });
      continue;
    }
    const there = foundThere !== null && "stats" in foundThere ? foundThere.stats : null;
    const itemId = itemIdOf(stats);
    checks.push({
      item,
      refusal: null,
      nameTaken: there !== null && !isOwn(there, target, itemId, ownPlaces),
      isFolder: kindOfStats(stats) === "directory",
    });
  }
  return checks;
}

// Whether the item found where a batch item goes back is the batch's own: the item itself,
// or another of its items (which makes way for it).
function isOwn(
  there: PlanStats,
  target: string,
  itemId: ItemId | null,
  ownPlaces: ReadonlyMap<string, string>,
): boolean {
  const thereId = itemIdOf(there);
  if (thereId === null) {
    return false;
  }
  if (itemId !== null && sameItemId(itemId, thereId)) {
    return true;
  }
  return ownPlaces.get(idKey(thereId)) === placeKey(target);
}

// An item an Undo would move to the Trash though it changed since: one that was put back
// from the Trash, the new item of a Replace, or one the operation made. The window is told
// its name; `path` tells it from another item of that name in another folder.
export type ChangedItem = { name: string; path: string; putBack: boolean; replaced: boolean };

// A place an item goes back to that another item has taken.
export type TakenName = { name: string; path: string };

export type UndoQuestions = { nameTaken: TakenName[]; changed: ChangedItem[] };

// What to ask before undoing `units`: the names that are taken where items would go back,
// and the items that would go to the Trash though they changed since. Checked as things
// will be by then: a step after one that can't be done isn't looked at, a place a step
// before it empties counts as free, and one a step before it fills as taken.
export async function findQuestions(
  fs: PlanFs,
  units: readonly UndoUnit[],
): Promise<UndoQuestions> {
  // Units don't depend on each other, so several are looked at at once: an Undo of
  // thousands of items would otherwise wait for each item's disk reads in turn.
  const perUnit = await mapAtMost(QUESTION_CHECKS_AT_ONCE, [...units].reverse(), (unit) =>
    unitQuestions(fs, unit),
  );
  return {
    nameTaken: perUnit.flatMap((questions) => questions.nameTaken),
    changed: perUnit.flatMap((questions) => questions.changed),
  };
}

// How many units findQuestions looks at at once.
const QUESTION_CHECKS_AT_ONCE = 16;

// `run` for each of `items`, at most `limit` at a time; the results in the items' order.
export async function mapAtMost<T, R>(
  limit: number,
  items: readonly T[],
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function unitQuestions(fs: PlanFs, unit: UndoUnit): Promise<UndoQuestions> {
  const nameTaken: TakenName[] = [];
  const changed: ChangedItem[] = [];
  const changes = noUnitChanges();
  for (const step of [...unit.steps].reverse()) {
    const planned = reverseStep(step);
    if (planned.kind === "move") {
      const check = await checkMove(fs, planned, changes);
      if (!check.ok) {
        if (check.missing) {
          continue;
        }
        break;
      }
      if (check.nameTaken) {
        nameTaken.push({ name: basename(planned.to), path: planned.to });
      }
      noteMovedAway(changes, planned.from, check.id);
      changes.filledPlaces.add(placeKey(planned.to));
    } else if (planned.kind === "trash") {
      const check = await checkTrash(fs, planned);
      if (!check.ok) {
        if (check.missing) {
          continue;
        }
        break;
      }
      if (check.changed) {
        changed.push({
          name: basename(planned.path),
          path: planned.path,
          putBack: planned.putBack,
          // A Replace's unit also has its old item's trip to the Trash.
          replaced: !planned.putBack && unit.steps.some((other) => other.kind === "trashed"),
        });
      }
      noteMovedAway(changes, planned.path, check.id);
    } else {
      for (const check of await checkBatch(fs, planned)) {
        if (check.nameTaken) {
          const target = join(dirname(check.item.from), basename(check.item.to));
          nameTaken.push({ name: basename(target), path: target });
        }
      }
    }
  }
  return { nameTaken, changed };
}
