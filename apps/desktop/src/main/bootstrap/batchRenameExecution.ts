import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import type { IpcRequest, WriteOperationResult } from "@filetrail/contracts";
import {
  type BatchRenameJournalEntry,
  type UndoStep,
  type WriteJournal,
  describeCopyPasteError,
  errorCode,
  fileIdOf,
  findLockedRefusal,
  readItemRef,
} from "@filetrail/core";

import { addNumberToName } from "../../shared/batchRename";

type Stats = { isDirectory(): boolean; dev?: number; ino?: number };

// What renaming several items needs of the file system (see WriteOperationFs).
export type BatchRenameFs = {
  lstat: (path: string) => Promise<Stats>;
  readdir?: (path: string) => Promise<string[]>;
  renameExclusive: (oldPath: string, newPath: string) => Promise<void>;
  rename: (oldPath: string, newPath: string) => Promise<void>;
  getFlags?: (path: string) => Promise<number>;
};

type ResultItem = WriteOperationResult["items"][number];

export type BatchRenameRun = {
  items: ResultItem[];
  completedItemCount: number;
  cancelled: boolean;
};

// A name taken during the rename gets the first free number up to this; past it, it fails.
const MAX_ADDED_NUMBER = 10_000;
// Attempts at a free temporary name before giving up on moving an item out of the way.
const TEMPORARY_NAME_ATTEMPTS = 10;

type PlannedItem = {
  index: number;
  sourcePath: string;
  folder: string;
  sourceName: string;
  destinationName: string;
  destinationPath: string;
  isFolder: boolean;
  /** Where the item waits while another item takes its name (a swap or a chain). */
  temporaryPath: string | null;
};

/**
 * Renames items to the names asked for, each in its own folder, one after another.
 *
 * Items may swap names or pass them along ("File 2" to "File 1" while "File 1" becomes
 * "File 2"): an item whose name another item wants is first moved to a hidden temporary
 * name in its folder, and takes its new name after the others. Every rename refuses to
 * replace what is already there (renamex_np with RENAME_EXCL); a name found taken is
 * handled as `onConflict` says: a number added, the item left as it is, or a failure.
 * Whatever happens, no item is left under a temporary name if it can be helped: an item
 * that can't take its new name is put back under its old one.
 */
export async function runBatchRename(args: {
  request: IpcRequest<"writeOperation:batchRename">;
  fs: BatchRenameFs;
  signal: AbortSignal;
  /** Called as each item starts, with how many are done. */
  onItemStart?: (item: { sourcePath: string; destinationPath: string }, completed: number) => void;
  /** The hidden name an item waits under (tests give their own). */
  temporaryName?: (attempt: number) => string;
  /** Where the items moved aside are written down first, so a crash can't leave them
   *  under hidden names (see BatchRenameJournalEntry). */
  journal?: WriteJournal | null;
}): Promise<BatchRenameRun> {
  const { fs, signal, request } = args;
  const journal = args.journal ?? null;
  const temporaryName = args.temporaryName ?? defaultTemporaryName;
  const planned = request.items.map((item, index): PlannedItem => {
    const sourcePath = resolve(item.sourcePath);
    const folder = dirname(sourcePath);
    const destinationName = item.destinationName.trim();
    return {
      index,
      sourcePath,
      folder,
      sourceName: basename(sourcePath),
      destinationName,
      destinationPath: join(folder, destinationName),
      isFolder: item.isFolder,
      temporaryPath: null,
    };
  });
  const results: Array<ResultItem | null> = planned.map(() => null);
  let completedItemCount = 0;
  let cancelled = false;

  // Items another item wants the name of. Names are compared as a disk that ignores case
  // would: on one that doesn't, an item moved aside for nothing only costs a rename.
  const wantedNames = new Map<string, number[]>();
  for (const item of planned) {
    const key = `${item.folder}\0${looseKey(item.destinationName)}`;
    wantedNames.set(key, [...(wantedNames.get(key) ?? []), item.index]);
  }
  const isBlocker = (item: PlannedItem) =>
    (wantedNames.get(`${item.folder}\0${looseKey(item.sourceName)}`) ?? []).some(
      (wanting) => wanting !== item.index,
    );

  // A folder and items inside it may be renamed together (search results reach into
  // folders): the deepest items go first, so every path still leads where it did when it
  // is used, and a folder is renamed once what is inside it is done. Items in one folder
  // are at one depth, so names are swapped and passed along within a level.
  const levels = new Map<number, PlannedItem[]>();
  for (const item of planned) {
    const depth = item.sourcePath.split("/").length;
    const level = levels.get(depth);
    if (level) {
      level.push(item);
    } else {
      levels.set(depth, [item]);
    }
  }
  const deepestFirst = [...levels.entries()]
    .sort(([left], [right]) => right - left)
    .map(([, items]) => items);

  for (const level of deepestFirst) {
    const blockers = level.filter(isBlocker);
    // The hidden names the items in the way will wait under, written down before any moves.
    const entry: BatchRenameJournalEntry = {
      kind: "batch_rename",
      id: randomBytes(8).toString("hex"),
      items: blockers.map((item) => ({
        temporaryPath: join(item.folder, temporaryName(0)),
        originalPath: item.sourcePath,
        newPath: item.destinationPath,
      })),
    };
    if (journal !== null && blockers.length > 0) {
      try {
        await journal.add(entry);
      } catch (error) {
        // Nothing of this depth is renamed: an item moved aside now could be stranded.
        for (const item of level) {
          if (results[item.index] === null) {
            results[item.index] = failed(
              item,
              `It wasn't renamed, as File Trail couldn't write down what it was about to do. ${describeCopyPasteError(error)}`,
            );
          }
        }
        continue;
      }
    }

    // First, the items in the way move aside. Only when all of them have can the swaps go
    // on after a stop; stopped before, every item goes back as it was.
    let allMovedAside = true;
    for (const [position, item] of blockers.entries()) {
      if (signal.aborted) {
        cancelled = true;
        allMovedAside = false;
        break;
      }
      try {
        item.temporaryPath = await moveToTemporaryName(
          fs,
          item,
          temporaryName,
          entry.items[position]?.temporaryPath ?? null,
          async (temporaryPath) => {
            const written = entry.items[position];
            if (journal !== null && written) {
              written.temporaryPath = temporaryPath;
              await journal.add(entry);
            }
          },
        );
      } catch (error) {
        results[item.index] = failed(
          item,
          await describeRenameError(fs, error, item, item.sourcePath),
        );
      }
    }

    // Then every item takes its new name, in the order asked for. Stopped before any of
    // this depth has, they all go back as they were; stopped later, an item already moved
    // aside still takes its new name, so a swap under way is finished rather than left with
    // a name taken from it.
    let levelRenamed = false;
    for (const item of level) {
      if (results[item.index] !== null) {
        continue;
      }
      const finishesSwap = allMovedAside && levelRenamed && item.temporaryPath !== null;
      if ((cancelled || signal.aborted) && !finishesSwap) {
        cancelled = true;
        results[item.index] = await leaveUnrenamed(fs, item, {
          status: "cancelled",
          error: "Not started because the operation was stopped.",
          skipReason: null,
        });
        followFolderRename(results, item.sourcePath, results[item.index]?.destinationPath);
        continue;
      }
      // Saying how far it got must never stop it halfway, with items under hidden names.
      try {
        args.onItemStart?.(
          { sourcePath: item.sourcePath, destinationPath: item.destinationPath },
          completedItemCount,
        );
      } catch {}
      results[item.index] = await renameItem(fs, item, request);
      if (results[item.index]?.status === "completed") {
        completedItemCount += 1;
        levelRenamed = true;
      }
      // Renamed, or put back under another name ("sub 2"): what is inside goes along.
      followFolderRename(results, item.sourcePath, results[item.index]?.destinationPath);
      if (signal.aborted) {
        cancelled = true;
      }
    }
    // Every item of this depth is settled. One that could go nowhere else is still under
    // its hidden name (its result says so): it stays written down, for the next start.
    if (journal !== null && blockers.length > 0) {
      const stillHidden = new Set(
        level.flatMap((item) => {
          const at = results[item.index]?.destinationPath;
          return at && at === item.temporaryPath ? [at] : [];
        }),
      );
      entry.items = entry.items.filter((written) => stillHidden.has(written.temporaryPath));
      await (entry.items.length > 0 ? journal.add(entry) : journal.remove(entry.id)).catch(
        () => undefined,
      );
    }
  }

  // Every item has its result by now: the loops above give one to each.
  const items = results.filter((result): result is ResultItem => result !== null);
  // A stop that came as the last item finished stopped nothing.
  return {
    items,
    completedItemCount,
    cancelled: cancelled && items.some((item) => item.status === "cancelled"),
  };
}

// A folder that just changed its name (renamed, or put back under another) takes along the
// items inside it, which were all settled before it:
// their paths say where they are now, under the folder's new name, renamed or not.
function followFolderRename(
  results: Array<ResultItem | null>,
  from: string,
  to: string | null | undefined,
): void {
  if (!to || to === from) {
    return;
  }
  const prefix = `${from}/`;
  results.forEach((result, index) => {
    // Only what was inside this very item: another item may have its old name by now, with
    // items of its own under it. Only this item has moved them since they were settled, and
    // a folder's items stay in it, so their paths still start where it was.
    const at = result?.destinationPath ?? result?.sourcePath;
    if (result?.sourcePath?.startsWith(prefix) && at?.startsWith(prefix)) {
      results[index] = { ...result, destinationPath: `${to}/${at.slice(prefix.length)}` };
    }
  });
}

async function renameItem(
  fs: BatchRenameFs,
  item: PlannedItem,
  request: IpcRequest<"writeOperation:batchRename">,
): Promise<ResultItem> {
  const from = item.temporaryPath ?? item.sourcePath;
  if (item.temporaryPath === null && (await renamesItself(fs, item))) {
    // "notes" to "Notes" on a disk that ignores case: the new name is the item's own.
    try {
      await fs.rename(item.sourcePath, item.destinationPath);
      return completed(item, item.destinationPath);
    } catch (error) {
      return failed(item, await describeRenameError(fs, error, item, from));
    }
  }
  let destinationPath = item.destinationPath;
  for (let number = 2; ; number += 1) {
    try {
      await fs.renameExclusive(from, destinationPath);
      return completed(item, destinationPath);
    } catch (error) {
      const taken = errorCode(error) === "EEXIST";
      if (taken && request.onConflict === "number" && number <= MAX_ADDED_NUMBER) {
        destinationPath = join(
          item.folder,
          numberedName(item.destinationName, item.isFolder, request.numberSeparator, number),
        );
        continue;
      }
      if (taken && request.onConflict === "skip") {
        return leaveUnrenamed(fs, item, {
          status: "skipped",
          error: `An item named “${basename(destinationPath)}” already exists.`,
          skipReason: "runtime_conflict_resolution",
        });
      }
      return leaveUnrenamed(fs, item, {
        status: "failed",
        error: await describeRenameError(fs, error, item, from, basename(destinationPath)),
        skipReason: null,
      });
    }
  }
}

// An item that won't take its new name: if it was moved aside, it goes back under its old
// one. When another item has taken that meanwhile, it gets the old name with a number
// ("b 2"), and only if even that fails is it left under the hidden name, and said so.
async function leaveUnrenamed(
  fs: BatchRenameFs,
  item: PlannedItem,
  outcome: {
    status: "failed" | "skipped" | "cancelled";
    error: string;
    skipReason: ResultItem["skipReason"];
  },
): Promise<ResultItem> {
  if (item.temporaryPath !== null) {
    const restoredPath = await restoreFromTemporaryName(fs, item, item.temporaryPath);
    if (restoredPath !== item.sourcePath) {
      return {
        sourcePath: item.sourcePath,
        destinationPath: restoredPath,
        status: outcome.status === "skipped" ? "failed" : outcome.status,
        error: `${outcome.error} Another item has its old name now, so it is named “${basename(
          restoredPath,
        )}”${restoredPath === item.temporaryPath ? " (hidden)" : ""}.`,
        skipReason: null,
      };
    }
  }
  return {
    sourcePath: item.sourcePath,
    destinationPath: null,
    status: outcome.status,
    error: outcome.error,
    skipReason: outcome.skipReason ?? null,
  };
}

// Where an item moved aside ends up: its old path, else its old name with the first free
// number, else (nothing else could be done) the temporary path it is still at.
async function restoreFromTemporaryName(
  fs: BatchRenameFs,
  item: PlannedItem,
  temporaryPath: string,
): Promise<string> {
  let candidate = item.sourcePath;
  for (let number = 2; ; number += 1) {
    try {
      await fs.renameExclusive(temporaryPath, candidate);
      return candidate;
    } catch (error) {
      if (errorCode(error) !== "EEXIST" || number > MAX_ADDED_NUMBER) {
        return temporaryPath;
      }
      candidate = join(item.folder, numberedName(item.sourceName, item.isFolder, " ", number));
    }
  }
}

// `written` is the hidden name already written down for it; another (that one was taken)
// is written down by `rewrite` before the item moves there.
async function moveToTemporaryName(
  fs: BatchRenameFs,
  item: PlannedItem,
  temporaryName: (attempt: number) => string,
  written: string | null,
  rewrite: (temporaryPath: string) => Promise<void>,
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < TEMPORARY_NAME_ATTEMPTS; attempt += 1) {
    const temporaryPath =
      attempt === 0 && written !== null ? written : join(item.folder, temporaryName(attempt));
    if (temporaryPath !== written) {
      await rewrite(temporaryPath);
    }
    try {
      await fs.renameExclusive(item.sourcePath, temporaryPath);
      return temporaryPath;
    } catch (error) {
      lastError = error;
      if (errorCode(error) !== "EEXIST") {
        throw error;
      }
    }
  }
  throw lastError;
}

// Whether the new name is the item's own name spelled differently: only its case (or how
// an accented letter is encoded) changes, and the disk finds the item itself under it, not
// another item spelled exactly so.
async function renamesItself(fs: BatchRenameFs, item: PlannedItem): Promise<boolean> {
  if (looseKey(item.sourceName) !== looseKey(item.destinationName)) {
    return false;
  }
  const [source, destination] = await Promise.all([
    fs.lstat(item.sourcePath).catch(() => null),
    fs.lstat(item.destinationPath).catch(() => null),
  ]);
  if (!source || !destination) {
    return false;
  }
  const sameItem =
    source.dev !== undefined &&
    fileIdOf(source.ino) !== null &&
    source.dev === destination.dev &&
    source.ino === destination.ino;
  const idsUnusable = fileIdOf(source.ino) === null || fileIdOf(destination.ino) === null;
  if (!sameItem && !idsUnusable) {
    return false;
  }
  const entries = fs.readdir ? await fs.readdir(item.folder).catch(() => null) : null;
  return !(entries?.includes(item.destinationName) ?? false);
}

/**
 * What a batch rename moved, for Undo: each item that is somewhere else than it was, and
 * still there. That is every item renamed, and an item that couldn't take its new name and
 * was left under another name than its own ("b 2", or the hidden name it waited under).
 * An item that kept its name (skipped, or failed) but is elsewhere only because its folder
 * was renamed isn't one: undoing the folder's rename takes it back.
 */
export async function movedItemsOf(
  lstat: BatchRenameFs["lstat"],
  items: readonly ResultItem[],
): Promise<Extract<UndoStep, { kind: "batchRenamed" }>["items"]> {
  const moved: Extract<UndoStep, { kind: "batchRenamed" }>["items"] = [];
  for (const item of items) {
    if (
      item.sourcePath === null ||
      item.destinationPath === null ||
      item.destinationPath === item.sourcePath ||
      basename(item.destinationPath) === basename(item.sourcePath)
    ) {
      continue;
    }
    const now = await readItemRef(lstat, item.destinationPath);
    if (now.kind !== null) {
      moved.push({
        from: item.sourcePath,
        to: item.destinationPath,
        id: now.id,
        itemKind: now.kind,
      });
    }
  }
  return moved;
}

/** "Lisbon 2.jpg": the number before the extension, or at the end of a folder's name. */
export function numberedName(
  name: string,
  isFolder: boolean,
  separator: string,
  number: number,
): string {
  return addNumberToName(name, isFolder, separator, number).name;
}

function completed(item: PlannedItem, destinationPath: string): ResultItem {
  return {
    sourcePath: item.sourcePath,
    destinationPath,
    status: "completed",
    error: null,
    skipReason: null,
  };
}

// An item that couldn't be renamed and is still where it was: it has no new path.
function failed(item: PlannedItem, error: string): ResultItem {
  return {
    sourcePath: item.sourcePath,
    destinationPath: null,
    status: "failed",
    error,
    skipReason: null,
  };
}

async function describeRenameError(
  fs: BatchRenameFs,
  error: unknown,
  item: PlannedItem,
  from: string,
  takenName: string = item.destinationName,
): Promise<string> {
  const code = errorCode(error);
  if (code === "ENOENT" && from === item.sourcePath) {
    return `“${item.sourceName}” no longer exists.`;
  }
  if (code === "EEXIST") {
    return `An item named “${takenName}” already exists.`;
  }
  const locked = await findLockedRefusal(fs, error, [from, item.folder]);
  return locked?.message ?? describeCopyPasteError(error);
}

// Names compared as a disk that ignores case and accent encoding does.
function looseKey(name: string): string {
  return name.normalize("NFD").toLowerCase();
}

function defaultTemporaryName(): string {
  return `.filetrail-rename-${randomBytes(6).toString("hex")}`;
}

// Where an item found under its hidden name goes, in order of preference.
function* placesToPutBack(
  written: BatchRenameJournalEntry["items"][number],
  isFolder: boolean,
): Generator<string> {
  yield written.originalPath;
  yield written.newPath;
  const folder = dirname(written.originalPath);
  for (let number = 2; number <= MAX_ADDED_NUMBER; number += 1) {
    yield join(folder, numberedName(basename(written.originalPath), isFolder, " ", number));
  }
}

// The hidden names a rename of several gives items (defaultTemporaryName).
const TEMPORARY_NAME_PATTERN = /^\.filetrail-rename-[0-9a-f]{12}$/u;

export type BatchRenameRecovery = {
  // Each item found under its hidden name, and where it is now.
  restored: Array<{ originalPath: string; path: string }>;
  // What stays written down: its disk can't be read, or the item couldn't be moved.
  remaining: BatchRenameJournalEntry["items"];
};

/**
 * Puts back the items a crash left under hidden names in a rename of several: under the
 * old name when it is free, else the new one asked for, else the old one with a number.
 * Never replaces anything, and moves only what has this app's hidden naming.
 */
export async function recoverBatchRename(
  entry: BatchRenameJournalEntry,
  fs: Pick<BatchRenameFs, "lstat" | "renameExclusive">,
): Promise<BatchRenameRecovery> {
  const recovery: BatchRenameRecovery = { restored: [], remaining: [] };
  for (const written of entry.items) {
    if (!TEMPORARY_NAME_PATTERN.test(basename(written.temporaryPath))) {
      continue;
    }
    let isFolder: boolean;
    try {
      isFolder = (await fs.lstat(written.temporaryPath)).isDirectory();
    } catch (error) {
      // Gone: it took its name before the crash. Unreadable: its disk may be away.
      const folderThere = await fs.lstat(dirname(written.temporaryPath)).then(
        (stats) => stats.isDirectory(),
        () => false,
      );
      if (errorCode(error) !== "ENOENT" || !folderThere) {
        recovery.remaining.push(written);
      }
      continue;
    }
    let path: string | null = null;
    for (const candidate of placesToPutBack(written, isFolder)) {
      try {
        await fs.renameExclusive(written.temporaryPath, candidate);
        path = candidate;
        break;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") {
          break;
        }
      }
    }
    if (path === null) {
      recovery.remaining.push(written);
    } else {
      recovery.restored.push({ originalPath: written.originalPath, path });
    }
  }
  return recovery;
}
