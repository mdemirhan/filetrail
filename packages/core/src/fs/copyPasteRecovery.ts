import { basename, dirname } from "node:path";

import { describeCopyPasteError, errorCode } from "./copyPasteErrors";
import { moveExclusive, removeStagedItem, unlockForMove } from "./copyPasteExecution";
import { captureFingerprint } from "./copyPasteFingerprint";
import { isPackageFolder, resolveDuplicateName } from "./copyPasteNames";
import type {
  PartialFileJournalEntry,
  ReplaceJournalEntry,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

export type ReplaceRecoveryOutcome =
  // The Replace had finished, or had been undone: nothing was left behind.
  | { entry: ReplaceJournalEntry; outcome: "nothing_left" }
  // The old item was already in the Trash, so the new one was put in its place.
  | { entry: ReplaceJournalEntry; outcome: "finished"; path: string }
  // A moved item went back where it came from.
  | { entry: ReplaceJournalEntry; outcome: "restored"; path: string }
  // Both places were taken: the item was given a visible name next to the old one.
  | { entry: ReplaceJournalEntry; outcome: "kept_visible"; path: string }
  // An unfinished copy was removed; the original is untouched.
  | { entry: ReplaceJournalEntry; outcome: "removed_copy" }
  // The hidden item couldn't be reached (its disk isn't connected, or it can't be read):
  // it may still be there, so the entry is kept for the next start.
  | { entry: ReplaceJournalEntry; outcome: "unreachable"; error: string }
  // Another operation was writing, so nothing was touched; the entry is tried again later.
  | { entry: ReplaceJournalEntry; outcome: "deferred" }
  | { entry: ReplaceJournalEntry; outcome: "failed"; error: string };

// Runs `write` only if nothing else is writing to the disk, holding everything else off
// until it is done; `ran: false` means it didn't run at all.
export type RunWriteAlone = <T>(
  write: () => Promise<T>,
) => Promise<{ ran: true; value: T } | { ran: false }>;

// Finishes or undoes Replaces that were cut short (a crash, a power cut), so no item stays
// under the hidden name it was built under. Run once at start, before any paste.
export async function recoverInterruptedReplaces(
  entries: ReplaceJournalEntry[],
  fileSystem: WriteServiceFileSystem,
  // A network disk that doesn't answer mustn't hold up the start: after this long its
  // entry is left for later, as for a disk that isn't connected.
  // Once the app is running, each entry's changes go through `runWriteAlone`, so they
  // never happen alongside a paste or any other operation. Whether the disk answers is
  // found out first, outside it: that can take seconds and changes nothing.
  options: { answerWithinMs?: number; runWriteAlone?: RunWriteAlone } = {},
): Promise<ReplaceRecoveryOutcome[]> {
  const outcomes: ReplaceRecoveryOutcome[] = [];
  for (const entry of entries) {
    try {
      if (
        options.answerWithinMs !== undefined &&
        !(await answersWithin(fileSystem, dirname(entry.stagingPath), options.answerWithinMs))
      ) {
        outcomes.push({ entry, outcome: "unreachable", error: "The disk didn't answer." });
        continue;
      }
      if (options.runWriteAlone === undefined) {
        outcomes.push(await recoverEntry(entry, fileSystem));
        continue;
      }
      const run = await options.runWriteAlone(() => recoverEntry(entry, fileSystem));
      outcomes.push(run.ran ? run.value : { entry, outcome: "deferred" });
    } catch (error) {
      outcomes.push(
        error instanceof StagingUnreadableError
          ? { entry, outcome: "unreachable", error: error.message }
          : { entry, outcome: "failed", error: describeCopyPasteError(error) },
      );
    }
  }
  return outcomes;
}

export type PartialFileRecoveryOutcome =
  | { entry: PartialFileJournalEntry; outcome: "nothing_left" | "removed_copy" | "deferred" }
  | { entry: PartialFileJournalEntry; outcome: "unreachable" | "failed"; error: string };

// Removes the parts of large files a crash cut short (see PartialFileJournalEntry). Each is
// a hidden file of this app's own naming; anything else found there is left alone.
export async function recoverPartialFiles(
  entries: PartialFileJournalEntry[],
  fileSystem: WriteServiceFileSystem,
  options: { answerWithinMs?: number; runWriteAlone?: RunWriteAlone } = {},
): Promise<PartialFileRecoveryOutcome[]> {
  const outcomes: PartialFileRecoveryOutcome[] = [];
  for (const entry of entries) {
    try {
      if (
        options.answerWithinMs !== undefined &&
        !(await answersWithin(fileSystem, dirname(entry.partialPath), options.answerWithinMs))
      ) {
        outcomes.push({ entry, outcome: "unreachable", error: "The disk didn't answer." });
        continue;
      }
      if (options.runWriteAlone === undefined) {
        outcomes.push(await removePartialFile(entry, fileSystem));
        continue;
      }
      const run = await options.runWriteAlone(() => removePartialFile(entry, fileSystem));
      outcomes.push(run.ran ? run.value : { entry, outcome: "deferred" });
    } catch (error) {
      outcomes.push({ entry, outcome: "failed", error: describeCopyPasteError(error) });
    }
  }
  return outcomes;
}

async function removePartialFile(
  entry: PartialFileJournalEntry,
  fileSystem: WriteServiceFileSystem,
): Promise<PartialFileRecoveryOutcome> {
  let isFile: boolean;
  try {
    isFile = (await fileSystem.lstat(entry.partialPath)).isFile();
  } catch (error) {
    if (
      errorCode(error) === "ENOENT" &&
      ((await folderIsThere(fileSystem, entry.partialPath)) ||
        (await hiddenFolderAroundIsGone(fileSystem, entry.partialPath)))
    ) {
      return { entry, outcome: "nothing_left" };
    }
    return { entry, outcome: "unreachable", error: describeCopyPasteError(error) };
  }
  // Only what this app names its partial files (see STAGING_NAME).
  if (!isFile || !STAGING_NAME.test(basename(entry.partialPath))) {
    return { entry, outcome: "nothing_left" };
  }
  // A copy is locked, or carries a rule against deleting it, as its original does: those
  // go on as it is finished, and come off for it to be removed.
  await removeStagedItem(fileSystem, entry.partialPath);
  return { entry, outcome: "removed_copy" };
}

// A large file copied inside a folder a paste was building under a hidden name: that folder
// may have gone since (removed by recovery after this part couldn't be), taking the part
// with it. Told from a disk that isn't connected by the folder that held it being there.
async function hiddenFolderAroundIsGone(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<boolean> {
  for (let folder = dirname(path); folder !== dirname(folder); folder = dirname(folder)) {
    if (STAGING_NAME.test(basename(folder))) {
      const gone = await fileSystem.lstat(folder).then(
        () => false,
        (error) => errorCode(error) === "ENOENT",
      );
      return gone && (await folderIsThere(fileSystem, folder));
    }
  }
  return false;
}

// The hidden name this app builds an item under: "."+name+".filetrail-" and 8 hex digits.
const STAGING_NAME = /^\..*\.filetrail-[0-9a-f]{8}$/su;

// Whether looking up `path` comes back (found or not) within `ms`.
export async function answersWithin(
  fileSystem: WriteServiceFileSystem,
  path: string,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const answered = fileSystem.lstat(path).then(
    () => true as const,
    () => true as const,
  );
  try {
    return await Promise.race([answered, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function recoverEntry(
  entry: ReplaceJournalEntry,
  fileSystem: WriteServiceFileSystem,
): Promise<ReplaceRecoveryOutcome> {
  // Only an item that is really gone counts as gone. A disk that isn't connected, or a
  // folder that can't be read, hides an item that may be the only copy of someone's data.
  try {
    await fileSystem.lstat(entry.stagingPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT" && (await folderIsThere(fileSystem, entry.stagingPath))) {
      // A folder built under a hidden name and put in place before its own metadata went on:
      // it is in place (the same folder, by its id), and gets it now.
      if (entry.staged && (await isOwnStaging(fileSystem, entry.finalPath, entry))) {
        await applyFolderMetadata(fileSystem, entry);
        return { entry, outcome: "finished", path: entry.finalPath };
      }
      return { entry, outcome: "nothing_left" };
    }
    return { entry, outcome: "unreachable", error: describeCopyPasteError(error) };
  }
  const staged = await captureFingerprint(fileSystem, entry.stagingPath);
  // A folder made there for the item to be built in is known by its id: another item that
  // took the name since isn't this paste's, and is left alone.
  if (
    entry.stagingId !== undefined &&
    !(await isOwnStaging(fileSystem, entry.stagingPath, entry))
  ) {
    return { entry, outcome: "nothing_left" };
  }
  const finalTaken = (await captureFingerprint(fileSystem, entry.finalPath)).exists;
  if (entry.moved) {
    // The staged item is the only copy of what was moved: it is never removed.
    if (!finalTaken) {
      await moveUnlocked(fileSystem, entry.stagingPath, entry.finalPath);
      return { entry, outcome: "finished", path: entry.finalPath };
    }
    if (!(await captureFingerprint(fileSystem, entry.sourcePath)).exists) {
      await moveUnlocked(fileSystem, entry.stagingPath, entry.sourcePath);
      return { entry, outcome: "restored", path: entry.sourcePath };
    }
    const visiblePath = await resolveDuplicateName(
      basename(entry.finalPath),
      dirname(entry.finalPath),
      fileSystem,
      undefined,
      {
        isDirectory: staged.kind === "directory",
        // The staged item's hidden name has no package extension: its source tells.
        isPackage:
          staged.kind === "directory" && (await isPackageFolder(fileSystem, entry.sourcePath)),
      },
    );
    await moveUnlocked(fileSystem, entry.stagingPath, visiblePath);
    return { entry, outcome: "kept_visible", path: visiblePath };
  }
  // A copy: the original is still in place. Only a complete copy whose old item already
  // went to the Trash is worth keeping.
  if (entry.staged && !finalTaken) {
    await moveUnlocked(fileSystem, entry.stagingPath, entry.finalPath);
    if (entry.stagingId !== undefined) {
      await applyFolderMetadata(fileSystem, entry);
    }
    return { entry, outcome: "finished", path: entry.finalPath };
  }
  await removeStagedItem(fileSystem, entry.stagingPath);
  return { entry, outcome: "removed_copy" };
}

// A folder built under a hidden name gets its own metadata once it has its name (see
// metadataLaterFor): from its original, when that is still there.
async function applyFolderMetadata(
  fileSystem: WriteServiceFileSystem,
  entry: ReplaceJournalEntry,
): Promise<void> {
  const source = await captureFingerprint(fileSystem, entry.sourcePath);
  // Only from the very item copied: another put at its path since would give the copy
  // permissions that were never its own.
  if (
    !fileSystem.copyMetadata ||
    entry.sourceId === undefined ||
    source.dev !== entry.sourceId.dev ||
    source.ino !== entry.sourceId.ino
  ) {
    return;
  }
  await fileSystem.copyMetadata(entry.sourcePath, entry.finalPath).catch(() => undefined);
}

// Whether the item at `path` is the folder the entry's paste made to build in (it keeps its
// id when renamed into place). An external disk connected again since has another device
// number: the folder is then known by its file id and when it was made, which the disk
// keeps; another disk at the same place has neither.
class StagingUnreadableError extends Error {
  constructor(readonly original: unknown) {
    super(describeCopyPasteError(original));
  }
}

async function isOwnStaging(
  fileSystem: WriteServiceFileSystem,
  path: string,
  entry: ReplaceJournalEntry,
): Promise<boolean> {
  const id = entry.stagingId;
  if (id === undefined) {
    return false;
  }
  let stats: Awaited<ReturnType<WriteServiceFileSystem["lstat"]>>;
  try {
    stats = await fileSystem.lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    // Not read (a disk with a moment's trouble): not known to be someone else's, so the
    // entry is kept for later.
    throw new StagingUnreadableError(error);
  }
  if (stats.ino !== id.ino) {
    return false;
  }
  return (
    stats.dev === id.dev ||
    (entry.stagingBornMs !== undefined && stats.birthtimeMs === entry.stagingBornMs)
  );
}

async function folderIsThere(fileSystem: WriteServiceFileSystem, path: string): Promise<boolean> {
  try {
    return (await fileSystem.lstat(dirname(path))).isDirectory();
  } catch {
    return false;
  }
}

// A copy of a locked item is locked, and a locked item can't be renamed: unlocked for the
// move and locked again after.
async function moveUnlocked(
  fileSystem: WriteServiceFileSystem,
  from: string,
  to: string,
): Promise<void> {
  const flags = await unlockForMove(fileSystem, from);
  try {
    await moveExclusive(fileSystem, from, to);
  } catch (error) {
    if (flags !== null) {
      await fileSystem.setFlags?.(from, flags).catch(() => undefined);
    }
    throw error;
  }
  if (flags !== null) {
    await fileSystem.setFlags?.(to, flags).catch(() => undefined);
  }
}
