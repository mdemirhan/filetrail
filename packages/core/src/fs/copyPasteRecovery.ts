import { basename, dirname } from "node:path";

import { describeCopyPasteError } from "./copyPasteErrors";
import { moveExclusive, removeStagedItem } from "./copyPasteExecution";
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
  | { entry: ReplaceJournalEntry; outcome: "failed"; error: string };

// Finishes or undoes Replaces that were cut short (a crash, a power cut), so no item stays
// under the hidden name it was built under. Run once at start, before any paste.
export async function recoverInterruptedReplaces(
  entries: ReplaceJournalEntry[],
  fileSystem: WriteServiceFileSystem,
): Promise<ReplaceRecoveryOutcome[]> {
  const outcomes: ReplaceRecoveryOutcome[] = [];
  for (const entry of entries) {
    try {
      outcomes.push(await recoverEntry(entry, fileSystem));
    } catch (error) {
      outcomes.push({ entry, outcome: "failed", error: describeCopyPasteError(error) });
    }
  }
  return outcomes;
}

async function recoverEntry(
  entry: ReplaceJournalEntry,
  fileSystem: WriteServiceFileSystem,
): Promise<ReplaceRecoveryOutcome> {
  const staged = await captureFingerprint(fileSystem, entry.stagingPath);
  if (!staged.exists) {
    return { entry, outcome: "nothing_left" };
  }
  const finalTaken = (await captureFingerprint(fileSystem, entry.finalPath)).exists;
  if (entry.moved) {
    // The staged item is the only copy of what was moved: it is never removed.
    if (!finalTaken) {
      await moveExclusive(fileSystem, entry.stagingPath, entry.finalPath);
      return { entry, outcome: "finished", path: entry.finalPath };
    }
    if (!(await captureFingerprint(fileSystem, entry.sourcePath)).exists) {
      await moveExclusive(fileSystem, entry.stagingPath, entry.sourcePath);
      return { entry, outcome: "restored", path: entry.sourcePath };
    }
    const visiblePath = await resolveDuplicateName(
      basename(entry.finalPath),
      dirname(entry.finalPath),
      fileSystem,
      undefined,
      { isDirectory: staged.kind === "directory" },
    );
    await moveExclusive(fileSystem, entry.stagingPath, visiblePath);
    return { entry, outcome: "kept_visible", path: visiblePath };
  }
  // A copy: the original is still in place. Only a complete copy whose old item already
  // went to the Trash is worth keeping.
  if (entry.staged && !finalTaken) {
    await moveExclusive(fileSystem, entry.stagingPath, entry.finalPath);
    return { entry, outcome: "finished", path: entry.finalPath };
  }
  await removeStagedItem(fileSystem, entry.stagingPath);
  return { entry, outcome: "removed_copy" };
}
