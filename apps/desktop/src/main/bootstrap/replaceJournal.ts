import { open, readFile, rename } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  type ReplaceJournal,
  type ReplaceJournalEntry,
  type WriteServiceFileSystem,
  recoverInterruptedReplaces,
} from "@filetrail/core";

import type { AppLogger } from "../appLog";

export type FileReplaceJournal = ReplaceJournal & {
  entries: () => ReplaceJournalEntry[];
};

// Keeps the Replaces in progress in a small file, so the next start can finish or undo one
// that a crash or power cut interrupted. Each change is on disk before the paste goes on.
export async function openReplaceJournal(filePath: string): Promise<FileReplaceJournal> {
  const entries = new Map<string, ReplaceJournalEntry>();
  for (const entry of await readEntries(filePath)) {
    entries.set(entry.id, entry);
  }
  // One write at a time, in order, so an older list never lands over a newer one.
  let pending: Promise<void> = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify([...entries.values()]);
    const write = pending.then(() => writeDurably(filePath, snapshot));
    pending = write.catch(() => undefined);
    return write;
  };
  return {
    entries: () => [...entries.values()],
    add: async (entry) => {
      entries.set(entry.id, entry);
      await save();
    },
    remove: async (id) => {
      if (entries.delete(id)) {
        await save();
      }
    },
  };
}

// Finishes or undoes what an earlier run left half done. Entries that couldn't be dealt
// with stay for the next start. Never throws: nothing here may keep the app from starting.
// Returns what the person needs to be told: items still left under a hidden name.
export async function recoverReplaces(
  journal: FileReplaceJournal,
  fileSystem: WriteServiceFileSystem,
  logger: Pick<AppLogger, "info" | "error">,
): Promise<string[]> {
  const entries = journal.entries();
  if (entries.length === 0) {
    return [];
  }
  const notices: string[] = [];
  let outcomes: Awaited<ReturnType<typeof recoverInterruptedReplaces>>;
  try {
    outcomes = await recoverInterruptedReplaces(entries, fileSystem);
  } catch (error) {
    logger.error("[filetrail] couldn't recover interrupted replaces", error);
    return notices;
  }
  for (const outcome of outcomes) {
    const name = basename(outcome.entry.finalPath);
    if (outcome.outcome === "failed") {
      logger.error("[filetrail] couldn't recover an interrupted replace", {
        stagingPath: outcome.entry.stagingPath,
        error: outcome.error,
      });
      notices.push(
        `“${name}” is still under the hidden name “${basename(outcome.entry.stagingPath)}” in “${dirname(outcome.entry.stagingPath)}”. ${outcome.error}`,
      );
      continue;
    }
    if (outcome.outcome === "unreachable") {
      logger.info("[filetrail] an interrupted replace can't be reached", {
        stagingPath: outcome.entry.stagingPath,
        error: outcome.error,
      });
      // Kept quietly: on a disk that isn't connected now, it is finished once it is.
      continue;
    }
    logger.info("[filetrail] recovered an interrupted replace", {
      outcome: outcome.outcome,
      stagingPath: outcome.entry.stagingPath,
      path: "path" in outcome ? outcome.path : null,
    });
    try {
      await journal.remove(outcome.entry.id);
    } catch (error) {
      // The item was dealt with; the next start finds nothing left for this entry.
      logger.error("[filetrail] couldn't update the replace journal", error);
    }
  }
  return notices;
}

async function readEntries(filePath: string): Promise<ReplaceJournalEntry[]> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.filter(isEntry);
    }
  } catch {
    // Kept aside below, so the next write doesn't erase what it may still say.
  }
  await rename(filePath, `${filePath}.unreadable-${Date.now()}`).catch(() => undefined);
  return [];
}

function isEntry(value: unknown): value is ReplaceJournalEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.stagingPath === "string" &&
    typeof entry.finalPath === "string" &&
    typeof entry.sourcePath === "string" &&
    typeof entry.moved === "boolean" &&
    typeof entry.staged === "boolean"
  );
}

// Written next to the file, flushed, then renamed over it: a crash mid-write leaves the
// previous list, never half of one.
async function writeDurably(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.tmp`;
  const handle = await open(temporaryPath, "w");
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}
