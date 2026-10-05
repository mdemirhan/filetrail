import { open, readFile, rename } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  type ReplaceJournal,
  type ReplaceJournalEntry,
  type RunWriteAlone,
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

export type ReplaceRecoveryReport = {
  // What the person must know: items left under a hidden name, or waiting for their disk.
  notices: string[];
  // Items that waited for their disk and are in place now.
  finished: string[];
};

// Finishes or undoes what an earlier run left half done. Entries that couldn't be dealt
// with stay for later (see the retry in bootstrap). Never throws: nothing here may keep
// the app from starting. `entryIds` limits it to those entries (a retry of what was left
// at start, never a Replace running now). A retry passes `runWriteAlone`, so its changes
// never happen alongside an operation the person started.
export async function recoverReplaces(
  journal: FileReplaceJournal,
  fileSystem: WriteServiceFileSystem,
  logger: Pick<AppLogger, "info" | "error">,
  options: {
    entryIds?: ReadonlySet<string>;
    answerWithinMs?: number;
    retry?: boolean;
    runWriteAlone?: RunWriteAlone;
  } = {},
): Promise<ReplaceRecoveryReport> {
  const report: ReplaceRecoveryReport = { notices: [], finished: [] };
  const entries = journal
    .entries()
    .filter((entry) => options.entryIds === undefined || options.entryIds.has(entry.id));
  if (entries.length === 0) {
    return report;
  }
  let outcomes: Awaited<ReturnType<typeof recoverInterruptedReplaces>>;
  try {
    outcomes = await recoverInterruptedReplaces(entries, fileSystem, {
      ...(options.answerWithinMs === undefined ? {} : { answerWithinMs: options.answerWithinMs }),
      ...(options.runWriteAlone === undefined ? {} : { runWriteAlone: options.runWriteAlone }),
    });
  } catch (error) {
    logger.error("[filetrail] couldn't recover interrupted replaces", error);
    return report;
  }
  for (const outcome of outcomes) {
    const name = basename(outcome.entry.finalPath);
    if (outcome.outcome === "failed") {
      logger.error("[filetrail] couldn't recover an interrupted replace", {
        stagingPath: outcome.entry.stagingPath,
        error: outcome.error,
      });
      if (!options.retry) {
        report.notices.push(
          `“${name}” is still under the hidden name “${basename(outcome.entry.stagingPath)}” in “${dirname(outcome.entry.stagingPath)}”. ${outcome.error}`,
        );
      }
      continue;
    }
    if (outcome.outcome === "deferred") {
      // An operation was running; the entry stays for the next try.
      continue;
    }
    if (outcome.outcome === "unreachable") {
      logger.info("[filetrail] an interrupted replace can't be reached", {
        stagingPath: outcome.entry.stagingPath,
        error: outcome.error,
      });
      // A moved item there is the only copy of what was moved, kept under a hidden name:
      // the person is told once, at start, where to find it. An unfinished copy is only a
      // copy (its original is in place) and is cleared up quietly once the disk is back.
      if (outcome.entry.moved && !options.retry) {
        report.notices.push(
          `“${name}” was being moved onto “${diskName(outcome.entry.stagingPath)}”, which isn't connected. Connect it and File Trail puts “${name}” in place; until then it is under the hidden name “${basename(outcome.entry.stagingPath)}” there.`,
        );
      }
      continue;
    }
    logger.info("[filetrail] recovered an interrupted replace", {
      outcome: outcome.outcome,
      stagingPath: outcome.entry.stagingPath,
      path: "path" in outcome ? outcome.path : null,
    });
    if (options.retry && outcome.entry.moved && "path" in outcome) {
      report.finished.push(`“${name}” is in place now, in “${dirname(outcome.path)}”.`);
    }
    try {
      await journal.remove(outcome.entry.id);
    } catch (error) {
      // The item was dealt with; the next start finds nothing left for this entry.
      logger.error("[filetrail] couldn't update the replace journal", error);
    }
  }
  return report;
}

export const RECOVERY_RETRY_INTERVAL_MS = 60_000;

// Tries the entries left at start again every minute, while no operation runs, until none
// of them is left. Tells what was put in place.
export function retryReplaceRecovery(args: {
  leftoverIds: ReadonlySet<string>;
  recover: (entryIds: ReadonlySet<string>) => Promise<ReplaceRecoveryReport>;
  remainingIds: () => ReadonlySet<string>;
  isBusy: () => boolean;
  onFinished: (messages: string[]) => void;
  intervalMs?: number;
}): { stop: () => void } {
  let waiting = new Set(args.leftoverIds);
  let running = false;
  const timer = setInterval(() => {
    if (running || args.isBusy()) {
      return;
    }
    running = true;
    void args
      .recover(waiting)
      .then((report) => {
        if (report.finished.length > 0) {
          args.onFinished(report.finished);
        }
      })
      .finally(() => {
        const remaining = args.remainingIds();
        waiting = new Set([...waiting].filter((id) => remaining.has(id)));
        running = false;
        if (waiting.size === 0) {
          clearInterval(timer);
        }
      });
  }, args.intervalMs ?? RECOVERY_RETRY_INTERVAL_MS);
  if (waiting.size === 0) {
    clearInterval(timer);
  }
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}

// "/Volumes/Backup/x/.y" is on "Backup"; anything else on the disk that holds its folder.
function diskName(path: string): string {
  const match = /^\/Volumes\/([^/]+)/u.exec(path);
  return match?.[1] ?? basename(dirname(path));
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
