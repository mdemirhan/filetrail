import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReplaceJournalEntry } from "@filetrail/core";
import { DEFAULT_WRITE_SERVICE_FILE_SYSTEM } from "@filetrail/core/fs/writeServiceTypes";

import { openReplaceJournal, recoverReplaces, retryReplaceRecovery } from "./replaceJournal";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-replace-journal-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

function createEntry(
  id: string,
  overrides: Partial<ReplaceJournalEntry> = {},
): ReplaceJournalEntry {
  return {
    id,
    stagingPath: join(testDir, `.filetrail-staging-${id}`),
    finalPath: join(testDir, `${id}.txt`),
    sourcePath: join(testDir, "source", `${id}.txt`),
    moved: false,
    staged: true,
    ...overrides,
  };
}

describe("openReplaceJournal", () => {
  it("keeps its entries across a reopen", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openReplaceJournal(filePath);
    await journal.add(createEntry("a"));
    await journal.add(createEntry("b"));

    const reopened = await openReplaceJournal(filePath);

    expect(reopened.entries()).toEqual([createEntry("a"), createEntry("b")]);
    // Written in one piece: no temporary file is left next to it.
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it("replaces an entry added again with the same id", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openReplaceJournal(filePath);
    await journal.add(createEntry("a", { staged: false }));
    await journal.add(createEntry("a", { staged: true }));

    expect(journal.entries()).toEqual([createEntry("a", { staged: true })]);
    expect((await openReplaceJournal(filePath)).entries()).toEqual([
      createEntry("a", { staged: true }),
    ]);
  });

  it("takes out a removed entry, on disk too", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openReplaceJournal(filePath);
    await journal.add(createEntry("a"));
    await journal.add(createEntry("b"));
    await journal.remove("a");
    // Removing one that isn't there changes nothing.
    await journal.remove("missing");

    expect(journal.entries()).toEqual([createEntry("b")]);
    expect((await openReplaceJournal(filePath)).entries()).toEqual([createEntry("b")]);
  });

  it("opens empty when the file is missing, unreadable as JSON, or not a list of entries", async () => {
    expect((await openReplaceJournal(join(testDir, "missing.json"))).entries()).toEqual([]);

    const corrupt = join(testDir, "corrupt.json");
    await writeFile(corrupt, '[{"id": "a", "stagingPa');
    expect((await openReplaceJournal(corrupt)).entries()).toEqual([]);
    // What it may still say is kept aside, not written over by the next Replace.
    const keptAside = (await readdir(testDir)).filter((name) =>
      name.startsWith("corrupt.json.unreadable-"),
    );
    expect(keptAside).toHaveLength(1);
    expect(await readFile(join(testDir, keptAside[0] ?? ""), "utf8")).toBe(
      '[{"id": "a", "stagingPa',
    );

    const notAList = join(testDir, "object.json");
    await writeFile(notAList, JSON.stringify({ id: "a" }));
    expect((await openReplaceJournal(notAList)).entries()).toEqual([]);

    // Entries of the wrong shape are dropped; good ones next to them are kept.
    const mixed = join(testDir, "mixed.json");
    await writeFile(mixed, JSON.stringify([{ id: "broken" }, createEntry("good")]));
    expect((await openReplaceJournal(mixed)).entries()).toEqual([createEntry("good")]);
  });
});

describe("recoverReplaces", () => {
  it("removes the entries it recovered and keeps the ones it couldn't", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openReplaceJournal(filePath);
    // A complete copy whose old item already went to the Trash: it is put in place.
    const finished = createEntry("finished");
    await writeFile(finished.stagingPath, "new contents");
    // Nothing was left behind.
    const nothingLeft = createEntry("nothing-left");
    // The staged item can't be moved into place: its folder doesn't exist.
    const failing = createEntry("failing", {
      finalPath: join(testDir, "no-such-folder", "failing.txt"),
    });
    await writeFile(failing.stagingPath, "stuck");
    for (const entry of [finished, nothingLeft, failing]) {
      await journal.add(entry);
    }
    const logger = { info: vi.fn(), error: vi.fn() };

    const { notices } = await recoverReplaces(journal, DEFAULT_WRITE_SERVICE_FILE_SYSTEM, logger);

    expect(await readFile(finished.finalPath, "utf8")).toBe("new contents");
    expect(existsSync(finished.stagingPath)).toBe(false);
    expect(journal.entries()).toEqual([failing]);
    expect((await openReplaceJournal(filePath)).entries()).toEqual([failing]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(2);
    // The person is told where the item that couldn't be put right is.
    expect(notices).toEqual([
      expect.stringContaining(
        `“failing.txt” is still under the hidden name “.filetrail-staging-failing” in “${testDir}”.`,
      ),
    ]);
  });

  // Its disk isn't connected now: the item may be the only copy of something, so the entry
  // stays until it can be dealt with, and the person is told where the item waits.
  it("keeps an entry whose hidden item can't be reached, and says where it waits", async () => {
    const journal = await openReplaceJournal(join(testDir, "replace-journal.json"));
    const unreachable = createEntry("unreachable", {
      stagingPath: "/Volumes/FileTrailNotConnected/.moved.filetrail-1",
      finalPath: "/Volumes/FileTrailNotConnected/report.txt",
      moved: true,
    });
    const unfinishedCopy = createEntry("copy", {
      stagingPath: "/Volumes/FileTrailNotConnected/.copy.filetrail-2",
    });
    await journal.add(unreachable);
    await journal.add(unfinishedCopy);

    const { notices } = await recoverReplaces(journal, DEFAULT_WRITE_SERVICE_FILE_SYSTEM, {
      info: vi.fn(),
      error: vi.fn(),
    });

    // Only the moved item: an unfinished copy's original is in place.
    expect(notices).toEqual([
      "“report.txt” was being moved onto “FileTrailNotConnected”, which isn't connected. Connect it and File Trail puts “report.txt” in place; until then it is under the hidden name “.moved.filetrail-1” there.",
    ]);
    expect(journal.entries()).toEqual([unreachable, unfinishedCopy]);
  });

  // A network share that doesn't answer mustn't hold up the window.
  it("leaves for later an entry whose disk doesn't answer in time", async () => {
    const journal = await openReplaceJournal(join(testDir, "replace-journal.json"));
    const hanging = createEntry("hanging", { moved: true });
    await journal.add(hanging);
    const fileSystem = {
      ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      lstat: () => new Promise<never>(() => undefined),
    };

    const startedAt = Date.now();
    const { notices } = await recoverReplaces(
      journal,
      fileSystem,
      { info: vi.fn(), error: vi.fn() },
      {
        answerWithinMs: 50,
      },
    );

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(notices).toHaveLength(1);
    expect(journal.entries()).toEqual([hanging]);
  });

  // Once the disk is back the item is put in place, and the person told.
  it("finishes a waiting entry on a retry, and says so", async () => {
    const journal = await openReplaceJournal(join(testDir, "replace-journal.json"));
    const waiting = createEntry("waiting", { moved: true });
    await writeFile(waiting.stagingPath, "moved contents");
    await journal.add(waiting);

    const report = await recoverReplaces(
      journal,
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      { info: vi.fn(), error: vi.fn() },
      { entryIds: new Set([waiting.id]), retry: true },
    );

    expect(report.finished).toEqual([`“waiting.txt” is in place now, in “${testDir}”.`]);
    expect(await readFile(waiting.finalPath, "utf8")).toBe("moved contents");
    expect(journal.entries()).toEqual([]);
  });

  it("retries every so often while nothing runs, until nothing is left", async () => {
    vi.useFakeTimers();
    try {
      let left = new Set(["a"]);
      const recover = vi.fn(async () => {
        left = new Set();
        return { notices: [], finished: ["“a.txt” is in place now, in “/x”."] };
      });
      const onFinished = vi.fn();
      let busy = true;
      retryReplaceRecovery({
        leftoverIds: new Set(["a"]),
        recover,
        remainingIds: () => left,
        isBusy: () => busy,
        onFinished,
        intervalMs: 1_000,
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(recover).not.toHaveBeenCalled();
      busy = false;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(onFinished).toHaveBeenCalledWith(["“a.txt” is in place now, in “/x”."]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(recover).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // A crash during a Replace that filled the disk must not keep the app from starting.
  it("never throws when the journal can't be written", async () => {
    const journal = await openReplaceJournal(join(testDir, "replace-journal.json"));
    const finished = createEntry("finished");
    await writeFile(finished.stagingPath, "new contents");
    await journal.add(finished);
    const logger = { info: vi.fn(), error: vi.fn() };
    const failingJournal = {
      ...journal,
      remove: vi.fn(async () => {
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
      }),
    };

    await expect(
      recoverReplaces(failingJournal, DEFAULT_WRITE_SERVICE_FILE_SYSTEM, logger),
    ).resolves.toEqual({ notices: [], finished: [] });
    expect(await readFile(finished.finalPath, "utf8")).toBe("new contents");
    expect(logger.error).toHaveBeenCalledWith(
      "[filetrail] couldn't update the replace journal",
      expect.any(Error),
    );
  });

  it("does nothing when there is nothing to recover", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openReplaceJournal(filePath);
    const logger = { info: vi.fn(), error: vi.fn() };

    await recoverReplaces(journal, DEFAULT_WRITE_SERVICE_FILE_SYSTEM, logger);

    expect(logger.info).not.toHaveBeenCalled();
    expect(existsSync(filePath)).toBe(false);
  });
});
