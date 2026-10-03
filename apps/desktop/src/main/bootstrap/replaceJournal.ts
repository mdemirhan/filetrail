import { open, readFile, rename } from "node:fs/promises";

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
// with stay for the next start.
export async function recoverReplaces(
  journal: FileReplaceJournal,
  fileSystem: WriteServiceFileSystem,
  logger: Pick<AppLogger, "info" | "error">,
): Promise<void> {
  const entries = journal.entries();
  if (entries.length === 0) {
    return;
  }
  for (const outcome of await recoverInterruptedReplaces(entries, fileSystem)) {
    if (outcome.outcome === "failed") {
      logger.error("[filetrail] couldn't recover an interrupted replace", {
        stagingPath: outcome.entry.stagingPath,
        error: outcome.error,
      });
      continue;
    }
    logger.info("[filetrail] recovered an interrupted replace", {
      outcome: outcome.outcome,
      stagingPath: outcome.entry.stagingPath,
      path: "path" in outcome ? outcome.path : null,
    });
    await journal.remove(outcome.entry.id);
  }
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
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
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
