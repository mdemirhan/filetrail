import { basename, dirname } from "node:path";

import { describeCopyPasteError, errorCode } from "./copyPasteErrors";
import { moveExclusive, removeStagedItem, unlockForMove } from "./copyPasteExecution";
import { captureFingerprint } from "./copyPasteFingerprint";
import { resolveDuplicateName } from "./copyPasteNames";
import type { ReplaceJournalEntry, WriteServiceFileSystem } from "./writeServiceTypes";

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
      outcomes.push({ entry, outcome: "failed", error: describeCopyPasteError(error) });
    }
  }
  return outcomes;
}

// Whether looking up `path` comes back (found or not) within `ms`.
async function answersWithin(
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
      return { entry, outcome: "nothing_left" };
    }
    return { entry, outcome: "unreachable", error: describeCopyPasteError(error) };
  }
  const staged = await captureFingerprint(fileSystem, entry.stagingPath);
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
      { isDirectory: staged.kind === "directory" },
    );
    await moveUnlocked(fileSystem, entry.stagingPath, visiblePath);
    return { entry, outcome: "kept_visible", path: visiblePath };
  }
  // A copy: the original is still in place. Only a complete copy whose old item already
  // went to the Trash is worth keeping.
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
      await fileSystem.setFlags?.(from, flags).catch(() => undefined);
    }
    throw error;
  }
  if (flags !== null) {
    await fileSystem.setFlags?.(to, flags).catch(() => undefined);
  }
}
