import { fileIdOf } from "./copyPasteFingerprint";

// What an operation did to the disk, step by step, so it can be undone later. Kept in the
// main process only: it never goes to the window.

// Which item a step was about: the disk's device number and the item's file id. Null when
// the disk doesn't give a usable id (FAT and exFAT, for empty files).
export type ItemId = { dev: number; ino: number };

// How an item that an operation made looked just after: Undo asks before moving one to
// the Trash that has changed since. For a folder only how many items it holds counts, not
// what is deeper inside, nor its date (which changes with every item in or out).
export type ItemKind = "file" | "directory" | "symlink" | "other";

export type ItemStamp = {
  kind: ItemKind;
  size: number | null;
  mtimeMs: number | null;
  entryCount: number | null;
};

export type UndoStep =
  // A rename, or a move on one disk. `parentId` is the folder `from` was in, so Undo moves
  // the item back only into that same folder. `itemKind` lets Undo still move back a file
  // that an app saved under a new id. `fromTrash` marks putting an item back from the
  // Trash, whose reverse is a fresh move to the Trash (not a rename into it), and `stamp`
  // how the item looked once back, for asking before trashing it again if it changed.
  // `locked` marks an item put back locked (a locked copy an Undo moved to the Trash): it
  // was unlocked to be moved, and is again to go back to the Trash.
  | {
      kind: "moved";
      from: string;
      to: string;
      id: ItemId | null;
      itemKind: ItemKind | null;
      parentId: ItemId | null;
      fromTrash?: boolean;
      stamp?: ItemStamp | null;
      locked?: boolean;
    }
  // An item the operation made: a copy, a duplicate, a new folder.
  | { kind: "created"; path: string; id: ItemId | null; stamp: ItemStamp | null }
  // An item moved to the Trash: what was asked for, or an item a Replace pushed out.
  // `stamp` is how it looked when it went, kept only for an item without a usable id (FAT,
  // exFAT): it is the one way to tell it is still what is at `trashPath`.
  | {
      kind: "trashed";
      from: string;
      trashPath: string;
      id: ItemId | null;
      parentId: ItemId | null;
      stamp?: ItemStamp;
    }
  // Several items renamed at once, undone as one batch.
  | {
      kind: "batchRenamed";
      items: Array<{ from: string; to: string; id: ItemId | null; itemKind: ItemKind | null }>;
    };

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
  // Copies, or a new folder, were made on a disk without a Trash: undoing them would mean
  // deleting them.
  | "no_trash"
  // A move to another disk (copied there, then the original deleted).
  | "other_disk_move"
  // An item went to the Trash, but the Trash didn't say where: it can't be put back.
  | "trash_location_unknown";

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

// The id of the folder at `path`, a link to a folder followed (`stat`): a folder opened
// through a link keeps the link's path (~/Projects for /Volumes/Data/Projects), and the
// folder an item is in is the one the link leads to.
export function readFolderId(
  stat: (path: string) => Promise<IdStats>,
  path: string,
): Promise<ItemId | null> {
  return readItemId(stat, path);
}

// readFolderId, each folder read once for `known` (one operation's): an operation's items
// are mostly in one folder, and they then share one id.
export function readFolderIdOnce(
  known: Map<string, Promise<ItemId | null>>,
  stat: (path: string) => Promise<IdStats>,
  path: string,
): Promise<ItemId | null> {
  let id = known.get(path);
  if (id === undefined) {
    id = readFolderId(stat, path);
    known.set(path, id);
  }
  return id;
}

// The id and kind of the item at `path` now; both null when it can't be read.
export async function readItemRef(
  lstat: (path: string) => Promise<KindStats>,
  path: string,
): Promise<{ id: ItemId | null; kind: ItemKind | null }> {
  try {
    const stats = await lstat(path);
    return { id: itemIdOf(stats), kind: kindOfStats(stats) };
  } catch {
    return { id: null, kind: null };
  }
}

type KindStats = IdStats & {
  isFile?: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink?: () => boolean;
};

export function kindOfStats(stats: KindStats): ItemKind {
  if (stats.isSymbolicLink?.()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  return (stats.isFile?.() ?? true) ? "file" : "other";
}

type StampStats = IdStats & {
  size?: number;
  mtimeMs?: number;
  isFile?: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink?: () => boolean;
};

type StampFileSystem = {
  lstat: (path: string) => Promise<StampStats>;
  readdir?: (path: string) => Promise<string[]>;
};

// How the item at `path` looks now, or null when it can't be read.
export async function readItemStamp(
  fileSystem: StampFileSystem,
  path: string,
): Promise<ItemStamp | null> {
  return (await readItemIdAndStamp(fileSystem, path)).stamp;
}

// The id of the item at `path` and how it looks now, from one look at it; both null when
// it can't be read.
export async function readItemIdAndStamp(
  fileSystem: StampFileSystem,
  path: string,
): Promise<{ id: ItemId | null; stamp: ItemStamp | null }> {
  let stats: StampStats;
  try {
    stats = await fileSystem.lstat(path);
  } catch {
    return { id: null, stamp: null };
  }
  const kind = kindOfStats(stats);
  const entryCount =
    kind === "directory" && fileSystem.readdir
      ? await fileSystem.readdir(path).then(
          (entries) => entries.filter((name) => !isFinderBookkeeping(name)).length,
          () => null,
        )
      : null;
  return {
    id: itemIdOf(stats),
    stamp: {
      kind,
      size: kind === "file" && typeof stats.size === "number" ? stats.size : null,
      mtimeMs: typeof stats.mtimeMs === "number" ? stats.mtimeMs : null,
      entryCount,
    },
  };
}

// Files Finder writes into a folder on its own when it is opened or copied to some disks:
// its view settings (.DS_Store) and AppleDouble files ("._name"). They aren't the
// person's work, so a new folder holding only them is still empty.
function isFinderBookkeeping(name: string): boolean {
  return name === ".DS_Store" || name.startsWith("._");
}

// For a `trashed` step: how the item at `path` looks, when it has no usable `id` (FAT,
// exFAT), so it can be told apart in the Trash; nothing when it has one.
export async function stampWithoutId(
  fileSystem: Parameters<typeof readItemStamp>[0],
  path: string,
  id: ItemId | null,
): Promise<{ stamp?: ItemStamp }> {
  const stamp = id === null ? await readItemStamp(fileSystem, path) : null;
  return stamp ? { stamp } : {};
}

// The same item, by id, when both ids are known.
export function sameItemId(left: ItemId | null, right: ItemId | null): boolean {
  return left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;
}
