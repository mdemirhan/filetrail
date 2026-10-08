import { open, readFile, rename } from "node:fs/promises";
import { basename, dirname } from "node:path";

import {
  type BatchRenameJournalEntry,
  type PartialFileJournalEntry,
  type ReplaceJournalEntry,
  type RunWriteAlone,
  type WriteJournal,
  type WriteJournalEntry,
  type WriteServiceFileSystem,
  answersWithin,
  isReplaceJournalEntry,
  recoverInterruptedReplaces,
  recoverPartialFiles,
} from "@filetrail/core";

import type { AppLogger } from "../appLog";
import { type BatchRenameRecovery, recoverBatchRename } from "./batchRenameExecution";
import { clearResponseCaches } from "./responseCache";

export type FileWriteJournal = WriteJournal & {
  entries: () => WriteJournalEntry[];
};

// Keeps the writes in progress that leave items under hidden names (Replaces, large file
// copies) in a small file, so the next start can finish or undo one that a crash or power
// cut interrupted. Each change is on disk before the write goes on.
export async function openWriteJournal(filePath: string): Promise<FileWriteJournal> {
  const entries = new Map<string, WriteJournalEntry>();
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

export type RecoveryReport = {
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
export async function recoverWrites(
  journal: FileWriteJournal,
  fileSystem: WriteServiceFileSystem,
  logger: Pick<AppLogger, "info" | "error">,
  options: {
    entryIds?: ReadonlySet<string>;
    answerWithinMs?: number;
    retry?: boolean;
    runWriteAlone?: RunWriteAlone;
  } = {},
): Promise<RecoveryReport> {
  const report: RecoveryReport = { notices: [], finished: [] };
  const entries = journal
    .entries()
    .filter((entry) => options.entryIds === undefined || options.entryIds.has(entry.id));
  const replaces = entries.filter(isReplaceJournalEntry);
  const partialFiles = entries.filter(
    (entry): entry is PartialFileJournalEntry => entry.kind === "partial_file",
  );
  const batchRenames = entries.filter(
    (entry): entry is BatchRenameJournalEntry => entry.kind === "batch_rename",
  );
  const recoveryOptions = {
    ...(options.answerWithinMs === undefined ? {} : { answerWithinMs: options.answerWithinMs }),
    ...(options.runWriteAlone === undefined ? {} : { runWriteAlone: options.runWriteAlone }),
  };
  // Parts of large files first: one inside a folder a paste was building goes with it, and
  // would then look like one on a disk that isn't connected, kept for ever.
  if (partialFiles.length > 0) {
    await removePartialFiles(journal, partialFiles, fileSystem, logger, recoveryOptions);
  }
  if (replaces.length > 0) {
    await recoverReplaces(journal, replaces, fileSystem, logger, recoveryOptions, options, report);
  }
  for (const entry of batchRenames) {
    await putBackRenamedItems(journal, entry, fileSystem, logger, recoveryOptions, report);
  }
  return report;
}

// A rename of several a crash cut short: the items waiting under hidden names are put
// back, and the person is told where. What can't be reached yet waits for the retry.
async function putBackRenamedItems(
  journal: FileWriteJournal,
  entry: BatchRenameJournalEntry,
  fileSystem: WriteServiceFileSystem,
  logger: Pick<AppLogger, "info" | "error">,
  options: { answerWithinMs?: number; runWriteAlone?: RunWriteAlone },
  report: RecoveryReport,
): Promise<void> {
  const { renameExclusive } = fileSystem;
  if (!renameExclusive) {
    return;
  }
  const fs = { lstat: fileSystem.lstat, renameExclusive };
  const folder = dirname(entry.items[0]?.temporaryPath ?? "/");
  if (
    options.answerWithinMs !== undefined &&
    !(await answersWithin(fileSystem, folder, options.answerWithinMs))
  ) {
    return;
  }
  let recovery: Awaited<ReturnType<typeof recoverBatchRename>>;
  try {
    if (options.runWriteAlone === undefined) {
      recovery = await recoverBatchRename(entry, fs);
    } else {
      const run = await options.runWriteAlone(() => recoverBatchRename(entry, fs));
      if (!run.ran) {
        return;
      }
      recovery = run.value;
    }
  } catch (error) {
    logger.error("[filetrail] couldn't put back items of an interrupted rename", error);
    return;
  }
  if (recovery.restored.length > 0) {
    clearResponseCaches(recovery.restored.map((item) => item.path));
    report.notices.push(describePutBack(recovery.restored));
  }
  try {
    await (recovery.remaining.length > 0
      ? journal.add({ ...entry, items: recovery.remaining })
      : journal.remove(entry.id));
  } catch (error) {
    logger.error("[filetrail] couldn't update the write journal", error);
  }
}

// "A rename was cut short when File Trail stopped. “a.txt” is back under its old name;
// “b.txt” is named “c.txt”."
function describePutBack(restored: BatchRenameRecovery["restored"]): string {
  const said = restored
    .slice(0, 3)
    .map(({ originalPath, path }) =>
      path === originalPath
        ? `“${basename(originalPath)}” is back under its old name`
        : `“${basename(originalPath)}” is named “${basename(path)}”`,
    );
  const more = restored.length - said.length;
  return `A rename of several items was cut short when File Trail stopped. ${said.join("; ")}${
    more > 0 ? `; and ${more} more ${more === 1 ? "item was" : "items were"} put back` : ""
  }.`;
}

// What a crash left of large files being copied: only part of a copy, its original in
// place. Removed quietly; one that can't be reached yet waits for the retry.
async function removePartialFiles(
  journal: FileWriteJournal,
  entries: PartialFileJournalEntry[],
  fileSystem: WriteServiceFileSystem,
  logger: Pick<AppLogger, "info" | "error">,
  options: { answerWithinMs?: number; runWriteAlone?: RunWriteAlone },
): Promise<void> {
  let outcomes: Awaited<ReturnType<typeof recoverPartialFiles>>;
  try {
    outcomes = await recoverPartialFiles(entries, fileSystem, options);
  } catch (error) {
    logger.error("[filetrail] couldn't remove interrupted copies", error);
    return;
  }
  const removed = outcomes.filter((outcome) => outcome.outcome === "removed_copy");
  if (removed.length > 0) {
    clearResponseCaches(removed.map((outcome) => outcome.entry.partialPath));
  }
  for (const outcome of outcomes) {
    if (outcome.outcome === "unreachable" || outcome.outcome === "failed") {
      logger.info("[filetrail] an interrupted copy wasn't removed", {
        partialPath: outcome.entry.partialPath,
        error: outcome.error,
      });
      continue;
    }
    if (outcome.outcome === "deferred") {
      continue;
    }
    try {
      await journal.remove(outcome.entry.id);
    } catch (error) {
      logger.error("[filetrail] couldn't update the write journal", error);
    }
  }
}

// Replaces a crash cut short: finished or undone, and what the person must know is said.
async function recoverReplaces(
  journal: FileWriteJournal,
  entries: ReplaceJournalEntry[],
  fileSystem: WriteServiceFileSystem,
  logger: Pick<AppLogger, "info" | "error">,
  recoveryOptions: { answerWithinMs?: number; runWriteAlone?: RunWriteAlone },
  options: { retry?: boolean },
  report: RecoveryReport,
): Promise<void> {
  let outcomes: Awaited<ReturnType<typeof recoverInterruptedReplaces>>;
  try {
    outcomes = await recoverInterruptedReplaces(entries, fileSystem, recoveryOptions);
  } catch (error) {
    logger.error("[filetrail] couldn't recover interrupted replaces", error);
    return;
  }
  // Where items were put in place, back, or taken away: folder listings and sizes read
  // before (a retry runs while the app is in use) are out of date there.
  const changedPaths: string[] = [];
  for (const outcome of outcomes) {
    if ("path" in outcome || outcome.outcome === "removed_copy") {
      changedPaths.push(outcome.entry.stagingPath, ...("path" in outcome ? [outcome.path] : []));
    }
  }
  if (changedPaths.length > 0) {
    clearResponseCaches(changedPaths);
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
    // A folder being moved to another disk, put in place whole: its original wasn't removed
    // yet, and is still where it was.
    if (outcome.outcome === "finished" && outcome.entry.movingCopy) {
      report.notices.push(
        `“${name}” was being moved when File Trail stopped. It is in “${basename(dirname(outcome.path))}” now, and the original is still in “${basename(dirname(outcome.entry.sourcePath))}” too.`,
      );
    }
    try {
      await journal.remove(outcome.entry.id);
    } catch (error) {
      // The item was dealt with; the next start finds nothing left for this entry.
      logger.error("[filetrail] couldn't update the write journal", error);
    }
  }
}

export const RECOVERY_RETRY_INTERVAL_MS = 60_000;

// Tries the entries left at start again every minute, while no operation runs, until none
// of them is left. Tells what was put in place.
export function retryRecovery(args: {
  leftoverIds: ReadonlySet<string>;
  recover: (entryIds: ReadonlySet<string>) => Promise<RecoveryReport>;
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

async function readEntries(filePath: string): Promise<WriteJournalEntry[]> {
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

function isEntry(value: unknown): value is WriteJournalEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string") {
    return false;
  }
  if (entry.kind === "batch_rename") {
    return (
      Array.isArray(entry.items) &&
      entry.items.every(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as Record<string, unknown>).temporaryPath === "string" &&
          typeof (item as Record<string, unknown>).originalPath === "string" &&
          typeof (item as Record<string, unknown>).newPath === "string",
      )
    );
  }
  if (typeof entry.finalPath !== "string") {
    return false;
  }
  if (entry.kind === "partial_file") {
    return typeof entry.partialPath === "string";
  }
  return (
    (entry.kind === undefined || entry.kind === "replace") &&
    typeof entry.stagingPath === "string" &&
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
