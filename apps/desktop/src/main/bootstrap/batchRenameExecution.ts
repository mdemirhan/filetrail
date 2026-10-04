import { randomBytes } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";

import type { IpcRequest, WriteOperationResult } from "@filetrail/contracts";
import { describeCopyPasteError, fileIdOf, findLockedRefusal } from "@filetrail/core";

import { splitItemName } from "../../shared/batchRename";

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
}): Promise<BatchRenameRun> {
  const { fs, signal, request } = args;
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
  const blockers = planned.filter((item) =>
    (wantedNames.get(`${item.folder}\0${looseKey(item.sourceName)}`) ?? []).some(
      (wanting) => wanting !== item.index,
    ),
  );

  // First, the items in the way move aside.
  for (const item of blockers) {
    if (signal.aborted) {
      cancelled = true;
      break;
    }
    try {
      item.temporaryPath = await moveToTemporaryName(fs, item, temporaryName);
    } catch (error) {
      results[item.index] = {
        sourcePath: item.sourcePath,
        destinationPath: item.destinationPath,
        status: "failed",
        error: await describeRenameError(fs, error, item, item.sourcePath),
        skipReason: null,
      };
    }
  }

  // Then every item takes its new name, in the order asked for. Stopped before any has, they
  // all go back as they were; stopped later, an item already moved aside still takes its
  // new name, so a swap under way is finished rather than left with a name taken from it.
  let anyRenamed = false;
  for (const item of planned) {
    if (results[item.index] !== null) {
      continue;
    }
    const finishesSwap = anyRenamed && item.temporaryPath !== null;
    if ((cancelled || signal.aborted) && !finishesSwap) {
      cancelled = true;
      results[item.index] = await leaveUnrenamed(fs, item, {
        status: "cancelled",
        error: "Not started because the operation was stopped.",
        skipReason: null,
      });
      continue;
    }
    args.onItemStart?.(
      { sourcePath: item.sourcePath, destinationPath: item.destinationPath },
      completedItemCount,
    );
    results[item.index] = await renameItem(fs, item, request);
    if (results[item.index]?.status === "completed") {
      completedItemCount += 1;
      anyRenamed = true;
    }
    if (signal.aborted) {
      cancelled = true;
    }
  }

  // Every item has its result by now: the loop above gives one to each.
  return {
    items: results.filter((result): result is ResultItem => result !== null),
    completedItemCount,
    cancelled,
  };
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
    destinationPath: item.destinationPath,
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

async function moveToTemporaryName(
  fs: BatchRenameFs,
  item: PlannedItem,
  temporaryName: (attempt: number) => string,
): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < TEMPORARY_NAME_ATTEMPTS; attempt += 1) {
    const temporaryPath = join(item.folder, temporaryName(attempt));
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

/** "Lisbon 2.jpg": the number before the extension, or at the end of a folder's name. */
export function numberedName(
  name: string,
  isFolder: boolean,
  separator: string,
  number: number,
): string {
  const { stem, extension } = splitItemName(name, isFolder);
  return `${stem}${separator}${number}${extension === null ? "" : `.${extension}`}`;
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

function failed(item: PlannedItem, error: string): ResultItem {
  return {
    sourcePath: item.sourcePath,
    destinationPath: item.destinationPath,
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

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
