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
        !(await allAnswerWithin(fileSystem, foldersReadFor(entry), options.answerWithinMs))
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
      outcomes.push({ entry, outcome: "failed", error: describeCopyPasteError(error) });
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
  // Builds after v0.4.3 that were never released copied a large file as "part" inside a
  // hidden folder of its own: that folder goes, with the part.
  const inFolder =
    basename(entry.partialPath) === "part" &&
    STAGING_NAME.test(basename(dirname(entry.partialPath)));
  const path = inFolder ? dirname(entry.partialPath) : entry.partialPath;
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT" && (await folderIsThere(fileSystem, path))) {
      return { entry, outcome: "nothing_left" };
    }
    return { entry, outcome: "unreachable", error: describeCopyPasteError(error) };
  }
  // Only what this app names its partial files (see STAGING_NAME).
  if (!STAGING_NAME.test(basename(path))) {
    return { entry, outcome: "nothing_left" };
  }
  // A copy is locked, or carries a rule against deleting it, as its original does: those
  // go on as it is finished, and come off for it to be removed.
  await removeStagedItem(fileSystem, path);
  return { entry, outcome: "removed_copy" };
}

// The hidden name this app builds an item under: "."+name+".filetrail-" and 8 hex digits.
const STAGING_NAME = /^\..*\.filetrail-[0-9a-f]{8}$/su;

// Every folder recovering `entry` looks in: the hidden item's, its final place's, and for a
// moved item its original's (on another disk, maybe), which may not answer either.
function foldersReadFor(entry: ReplaceJournalEntry): string[] {
  const folders = [dirname(entry.stagingPath), dirname(entry.finalPath)];
  // Only a moved item may go back where it came from; a copy never looks there.
  if (entry.moved) {
    folders.push(dirname(entry.sourcePath));
  }
  return [...new Set(folders)];
}

// Whether looking up each of `paths` comes back within `ms`, all looked up at once.
async function allAnswerWithin(
  fileSystem: WriteServiceFileSystem,
  paths: readonly string[],
  ms: number,
): Promise<boolean> {
  const answered = await Promise.all(paths.map((path) => answersWithin(fileSystem, path, ms)));
  return !answered.includes(false);
}

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
  let isDirectory: boolean;
  try {
    isDirectory = (await fileSystem.lstat(entry.stagingPath)).isDirectory();
  } catch (error) {
    if (errorCode(error) === "ENOENT" && (await folderIsThere(fileSystem, entry.stagingPath))) {
      return { entry, outcome: "nothing_left" };
    }
    return { entry, outcome: "unreachable", error: describeCopyPasteError(error) };
  }
  // The hidden name was made for this Replace alone (see STAGING_NAME): what is there is its.
  if (!STAGING_NAME.test(basename(entry.stagingPath))) {
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
        isDirectory,
        // The staged item's hidden name has no package extension: its source tells.
        isPackage: isDirectory && (await isPackageFolder(fileSystem, entry.sourcePath)),
      },
    );
    await moveUnlocked(fileSystem, entry.stagingPath, visiblePath);
    return { entry, outcome: "kept_visible", path: visiblePath };
  }
  // A copy: the original is still in place. Only a complete copy whose old item already
  // went to the Trash is worth keeping. A folder put in place here goes without its own
  // tags and dates, which it would have had once named (see metadataLaterFor).
  if (entry.staged && !finalTaken) {
    await moveUnlocked(fileSystem, entry.stagingPath, entry.finalPath);
    return { entry, outcome: "finished", path: entry.finalPath };
  }
  await removeStagedItem(fileSystem, entry.stagingPath);
  return { entry, outcome: "removed_copy" };
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
      await fileSystem.setFlags(from, flags).catch(() => undefined);
    }
    throw error;
  }
  if (flags !== null) {
    await fileSystem.setFlags(to, flags).catch(() => undefined);
  }
}
