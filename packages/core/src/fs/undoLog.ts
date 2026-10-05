import { fileIdOf } from "./copyPasteFingerprint";

// What an operation did to the disk, step by step, so it can be undone later. Kept in the
// main process only: it never goes to the window.

// Which item a step was about: the disk's device number and the item's file id. Null when
// the disk doesn't give a usable id (FAT and exFAT, for empty files).
export type ItemId = { dev: number; ino: number };

// How an item that an operation made looked just after: Undo asks before moving one to
// the Trash that has changed since. For a folder only the folder itself is looked at (its
// date and how many items it holds), not what is deeper inside.
export type ItemStamp = {
  kind: "file" | "directory" | "symlink" | "other";
  size: number | null;
  mtimeMs: number | null;
  entryCount: number | null;
};

export type UndoStep =
  // A rename, or a move on one disk. `parentId` is the folder `from` was in, so Undo moves
  // the item back only into that same folder. `fromTrash` marks putting an item back from
  // the Trash, whose reverse is a fresh move to the Trash, not a rename into it.
  | {
      kind: "moved";
      from: string;
      to: string;
      id: ItemId | null;
      parentId: ItemId | null;
      fromTrash?: boolean;
    }
  // An item the operation made: a copy, a duplicate, a new folder.
  | { kind: "created"; path: string; id: ItemId | null; stamp: ItemStamp | null }
  // An item moved to the Trash: what was asked for, or an item a Replace pushed out.
  | {
      kind: "trashed";
      from: string;
      trashPath: string;
      id: ItemId | null;
      parentId: ItemId | null;
    }
  // Several items renamed at once, undone as one batch.
  | { kind: "batchRenamed"; items: Array<{ from: string; to: string; id: ItemId | null }> };

// The steps for one item the person picked, in the order they happened. They are undone
// together, in reverse; when one can't be, the ones before it in the unit aren't either.
export type UndoUnit = { steps: UndoStep[] };

// Why an operation can't be undone.
export type CantUndoReason =
  // A folder was merged into one that was already there (Add Missing).
  | "merge"
  // Something was deleted for good: Delete Immediately, Empty Trash, or a Replace on a
  // disk without a Trash.
  | "deleted_for_good"
  // Copies were made on a disk without a Trash: undoing them would mean deleting them.
  | "no_trash"
  // A move to another disk (copied there, then the original deleted).
  | "other_disk_move";

export type UndoLog =
  | { undoable: true; units: UndoUnit[] }
  | { undoable: false; reason: CantUndoReason };

type IdStats = { dev?: number; ino?: number };

// The id of what `stats` describes, or null when the disk gives none usable.
export function itemIdOf(stats: IdStats): ItemId | null {
  const ino = fileIdOf(stats.ino);
  return typeof stats.dev === "number" && ino !== null ? { dev: stats.dev, ino } : null;
}

// The id of the item at `path` now, or null when it can't be read or has no usable id.
export async function readItemId(
  lstat: (path: string) => Promise<IdStats>,
  path: string,
): Promise<ItemId | null> {
  try {
    return itemIdOf(await lstat(path));
  } catch {
    return null;
  }
}

type StampStats = IdStats & {
  size?: number;
  mtimeMs?: number;
  isFile?: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink?: () => boolean;
};

// How the item at `path` looks now, or null when it can't be read.
export async function readItemStamp(
  fileSystem: {
    lstat: (path: string) => Promise<StampStats>;
    readdir?: (path: string) => Promise<string[]>;
  },
  path: string,
): Promise<ItemStamp | null> {
  let stats: StampStats;
  try {
    stats = await fileSystem.lstat(path);
  } catch {
    return null;
  }
  const kind = stats.isSymbolicLink?.()
    ? "symlink"
    : stats.isDirectory()
      ? "directory"
      : (stats.isFile?.() ?? true)
        ? "file"
        : "other";
  const entryCount =
    kind === "directory" && fileSystem.readdir
      ? await fileSystem.readdir(path).then(
          (entries) => entries.length,
          () => null,
        )
      : null;
  return {
    kind,
    size: kind === "file" && typeof stats.size === "number" ? stats.size : null,
    mtimeMs: typeof stats.mtimeMs === "number" ? stats.mtimeMs : null,
    entryCount,
  };
}

// The same item, by id, when both ids are known.
export function sameItemId(left: ItemId | null, right: ItemId | null): boolean {
  return left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;
}
