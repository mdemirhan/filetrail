import { basename, dirname } from "node:path";

import {
  type ItemId,
  type ItemKind,
  type ItemStamp,
  type UndoStep,
  type UndoUnit,
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
  | {
      kind: "move";
      from: string;
      to: string;
      id: ItemId | null;
      itemKind: ItemKind | null;
      parentId: ItemId | null;
      putBack: boolean;
    }
  // Moves the item at `path` to the Trash: something an operation made, or put back.
  | { kind: "trash"; path: string; id: ItemId | null; stamp: ItemStamp | null }
  // Renames each item at `from` back to the name in `to`, as one batch.
  | {
      kind: "batch";
      items: Array<{ from: string; to: string; id: ItemId | null; itemKind: ItemKind | null }>;
    };

export function reverseStep(step: UndoStep): PlannedStep {
  switch (step.kind) {
    case "moved":
      return step.fromTrash
        ? { kind: "trash", path: step.to, id: step.id, stamp: step.stamp ?? null }
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
      return { kind: "trash", path: step.path, id: step.id, stamp: step.stamp };
    case "trashed":
      return {
        kind: "move",
        from: step.trashPath,
        to: step.from,
        id: step.id,
        // The Trash never changes what is in it: only the very item goes back.
        itemKind: null,
        parentId: step.parentId,
        putBack: true,
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
  readdir?: (path: string) => Promise<string[]>;
};

// Why a step can't be undone, said about the item. `missing` means nothing is left where
// the item was: no other item is in the way of the steps after it.
export type Refusal = { reason: string; missing: boolean };

export type MoveCheck =
  | { ok: true; nameTaken: boolean; renamesItself: boolean; isFolder: boolean }
  | ({ ok: false } & Refusal);

export type TrashCheck = { ok: true; changed: boolean } | ({ ok: false } & Refusal);

async function lstatOrNull(fs: PlanFs, path: string): Promise<PlanStats | null> {
  try {
    return await fs.lstat(path);
  } catch {
    return null;
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
async function missingReason(fs: PlanFs, path: string): Promise<string> {
  const disk = /^\/Volumes\/([^/]+)\//u.exec(path)?.[1];
  if (disk !== undefined && (await lstatOrNull(fs, `/Volumes/${disk}`)) === null) {
    return `“${basename(path)}” is on “${disk}”, which isn't connected.`;
  }
  return `“${basename(path)}” is no longer in “${basename(dirname(path))}”.`;
}

function replacedReason(path: string): string {
  return `The “${basename(path)}” in “${basename(dirname(path))}” is another item now.`;
}

// Whether `step` can be done now. `vacated` holds paths that steps before it in the same
// unit will have emptied by then (a Replace puts its old item back where the new one was).
export async function checkMove(
  fs: PlanFs,
  step: Extract<PlannedStep, { kind: "move" }>,
  vacated: ReadonlySet<string> = new Set(),
): Promise<MoveCheck> {
  const item = await lstatOrNull(fs, step.from);
  if (item === null) {
    return { ok: false, reason: await missingReason(fs, step.from), missing: true };
  }
  if (!isExpectedItem(item, step.id, step.itemKind, !step.putBack)) {
    return { ok: false, reason: replacedReason(step.from), missing: false };
  }
  const folderPath = dirname(step.to);
  const folder = await lstatOrNull(fs, folderPath);
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
      reason: `Its folder “${basename(folderPath)}” was replaced by another folder.`,
      missing: false,
    };
  }
  const isFolder = kindOfStats(item) === "directory";
  const there = await lstatOrNull(fs, step.to);
  if (there === null || vacated.has(step.to)) {
    return { ok: true, nameTaken: false, renamesItself: false, isFolder };
  }
  // On a disk that ignores case, "notes.txt" finds "Notes.txt": the item itself.
  const itemId = itemIdOf(item);
  const renamesItself = itemId !== null && sameItemId(itemId, itemIdOf(there));
  return { ok: true, nameTaken: !renamesItself, renamesItself, isFolder };
}

export async function checkTrash(
  fs: PlanFs,
  step: Extract<PlannedStep, { kind: "trash" }>,
): Promise<TrashCheck> {
  const item = await lstatOrNull(fs, step.path);
  if (item === null) {
    return { ok: false, reason: await missingReason(fs, step.path), missing: true };
  }
  if (!isExpectedItem(item, step.id, step.stamp?.kind ?? null, false)) {
    return { ok: false, reason: replacedReason(step.path), missing: false };
  }
  if (step.stamp === null) {
    return { ok: true, changed: false };
  }
  const now = await readItemStamp(fs, step.path);
  return { ok: true, changed: now === null || !sameStamp(step.stamp, now) };
}

// A folder is the same when it holds as many items: its date changes with every item
// added or taken out, so a file moved into a new folder and back out (two Undos) would
// otherwise make it look changed.
function sameStamp(left: ItemStamp, right: ItemStamp): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "directory") {
    return left.entryCount === right.entryCount;
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
  const vacated = new Set(step.items.map((item) => item.from));
  const checks: BatchItemCheck[] = [];
  for (const item of step.items) {
    const stats = await lstatOrNull(fs, item.from);
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
        refusal: { reason: replacedReason(item.from), missing: false },
        nameTaken: false,
        isFolder: false,
      });
      continue;
    }
    // The name it goes back to, in the folder it is in now (its folder may be renamed back
    // in the same batch, after it).
    const target = `${dirname(item.from)}/${basename(item.to)}`;
    const there = vacated.has(target) ? null : await lstatOrNull(fs, target);
    const itemId = itemIdOf(stats);
    checks.push({
      item,
      refusal: null,
      nameTaken: there !== null && !(itemId !== null && sameItemId(itemId, itemIdOf(there))),
      isFolder: kindOfStats(stats) === "directory",
    });
  }
  return checks;
}

// What to ask before undoing `units`: the names that are taken where items would go back,
// and the items that would go to the Trash though they changed since. Checked as things
// will be by then: a step after one that can't be done isn't looked at, and a path a step
// before it empties counts as free.
export async function findQuestions(
  fs: PlanFs,
  units: readonly UndoUnit[],
): Promise<{ nameTaken: string[]; changed: string[] }> {
  const nameTaken: string[] = [];
  const changed: string[] = [];
  for (const unit of [...units].reverse()) {
    const vacated = new Set<string>();
    for (const step of [...unit.steps].reverse()) {
      const planned = reverseStep(step);
      if (planned.kind === "move") {
        const check = await checkMove(fs, planned, vacated);
        if (!check.ok) {
          if (check.missing) {
            continue;
          }
          break;
        }
        if (check.nameTaken) {
          nameTaken.push(basename(planned.to));
        }
        vacated.add(planned.from);
      } else if (planned.kind === "trash") {
        const check = await checkTrash(fs, planned);
        if (!check.ok) {
          if (check.missing) {
            continue;
          }
          break;
        }
        if (check.changed) {
          changed.push(basename(planned.path));
        }
        vacated.add(planned.path);
      } else {
        for (const check of await checkBatch(fs, planned)) {
          if (check.nameTaken) {
            nameTaken.push(basename(check.item.to));
          }
        }
      }
    }
  }
  return { nameTaken, changed };
}
