import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ReplaceJournalEntry, RunWriteAlone } from "@filetrail/core";
import { nativeFileSystem } from "@filetrail/core/fs/testNativePaste";

import { createOriginalWriteOperationFs, originalFileSystem } from "../originalFileSystem";
import { runBatchRename } from "./batchRenameExecution";
import { getCachedResponse, getResponseCacheSizes, resetResponseCacheState } from "./responseCache";
import { openWriteJournal, recoverWrites, retryRecovery } from "./writeJournal";

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
    stagingPath: join(testDir, `.${id}.txt.filetrail-00000000`),
    finalPath: join(testDir, `${id}.txt`),
    sourcePath: join(testDir, "source", `${id}.txt`),
    moved: false,
    staged: true,
    ...overrides,
  };
}

describe("openWriteJournal", () => {
  it("keeps its entries across a reopen", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openWriteJournal(filePath);
    await journal.add(createEntry("a"));
    await journal.add(createEntry("b"));

    const reopened = await openWriteJournal(filePath);

    expect(reopened.entries()).toEqual([createEntry("a"), createEntry("b")]);
    // Written in one piece: no temporary file is left next to it.
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it("replaces an entry added again with the same id", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openWriteJournal(filePath);
    await journal.add(createEntry("a", { staged: false }));
    await journal.add(createEntry("a", { staged: true }));

    expect(journal.entries()).toEqual([createEntry("a", { staged: true })]);
    expect((await openWriteJournal(filePath)).entries()).toEqual([
      createEntry("a", { staged: true }),
    ]);
  });

  it("takes out a removed entry, on disk too", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openWriteJournal(filePath);
    await journal.add(createEntry("a"));
    await journal.add(createEntry("b"));
    await journal.remove("a");
    // Removing one that isn't there changes nothing.
    await journal.remove("missing");

    expect(journal.entries()).toEqual([createEntry("b")]);
    expect((await openWriteJournal(filePath)).entries()).toEqual([createEntry("b")]);
  });

  it("opens empty when the file is missing, unreadable as JSON, or not a list of entries", async () => {
    expect((await openWriteJournal(join(testDir, "missing.json"))).entries()).toEqual([]);

    const corrupt = join(testDir, "corrupt.json");
    await writeFile(corrupt, '[{"id": "a", "stagingPa');
    expect((await openWriteJournal(corrupt)).entries()).toEqual([]);
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
    expect((await openWriteJournal(notAList)).entries()).toEqual([]);

    // Entries of the wrong shape are dropped; good ones next to them are kept.
    const mixed = join(testDir, "mixed.json");
    await writeFile(mixed, JSON.stringify([{ id: "broken" }, createEntry("good")]));
    expect((await openWriteJournal(mixed)).entries()).toEqual([createEntry("good")]);
  });
});

describe("recoverWrites", () => {
  it("removes the entries it recovered and keeps the ones it couldn't", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openWriteJournal(filePath);
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

    const { notices } = await recoverWrites(journal, originalFileSystem, logger);

    expect(await readFile(finished.finalPath, "utf8")).toBe("new contents");
    expect(existsSync(finished.stagingPath)).toBe(false);
    expect(journal.entries()).toEqual([failing]);
    expect((await openWriteJournal(filePath)).entries()).toEqual([failing]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledTimes(2);
    // The person is told where the item that couldn't be put right is.
    expect(notices).toEqual([
      expect.stringContaining(
        `“failing.txt” is still under the hidden name “.failing.txt.filetrail-00000000” in “${testDir}”.`,
      ),
    ]);
  });

  // Its disk isn't connected now: the item may be the only copy of something, so the entry
  // stays until it can be dealt with, and the person is told where the item waits.
  it("keeps an entry whose hidden item can't be reached, and says where it waits", async () => {
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const unreachable = createEntry("unreachable", {
      stagingPath: "/Volumes/FileTrailNotConnected/.moved.filetrail-00000001",
      finalPath: "/Volumes/FileTrailNotConnected/report.txt",
      moved: true,
    });
    const unfinishedCopy = createEntry("copy", {
      stagingPath: "/Volumes/FileTrailNotConnected/.copy.filetrail-00000002",
    });
    await journal.add(unreachable);
    await journal.add(unfinishedCopy);

    const { notices } = await recoverWrites(journal, originalFileSystem, {
      info: vi.fn(),
      error: vi.fn(),
    });

    // Only the moved item: an unfinished copy's original is in place.
    expect(notices).toEqual([
      "“report.txt” was being moved onto “FileTrailNotConnected”, which isn't connected. Connect it and File Trail puts “report.txt” in place; until then it is under the hidden name “.moved.filetrail-00000001” there.",
    ]);
    expect(journal.entries()).toEqual([unreachable, unfinishedCopy]);
  });

  // A network share that doesn't answer mustn't hold up the window.
  it("leaves for later an entry whose disk doesn't answer in time", async () => {
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const hanging = createEntry("hanging", { moved: true });
    await journal.add(hanging);
    const fileSystem = {
      ...originalFileSystem,
      lstat: () => new Promise<never>(() => undefined),
    };

    const startedAt = Date.now();
    const { notices } = await recoverWrites(
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
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const waiting = createEntry("waiting", { moved: true });
    await writeFile(waiting.stagingPath, "moved contents");
    await journal.add(waiting);

    const report = await recoverWrites(
      journal,
      originalFileSystem,
      { info: vi.fn(), error: vi.fn() },
      { entryIds: new Set([waiting.id]), retry: true },
    );

    expect(report.finished).toEqual([`“waiting.txt” is in place now, in “${testDir}”.`]);
    expect(await readFile(waiting.finalPath, "utf8")).toBe("moved contents");
    expect(journal.entries()).toEqual([]);
  });

  it("forgets the folder listings read before a retry put an item in place", async () => {
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const waiting = createEntry("waiting", { moved: true });
    await writeFile(waiting.stagingPath, "moved contents");
    await journal.add(waiting);
    resetResponseCacheState();
    await getCachedResponse("directory", { path: testDir }, async () => "listing before");
    expect(getResponseCacheSizes().directorySnapshots).toBe(1);

    await recoverWrites(
      journal,
      originalFileSystem,
      { info: vi.fn(), error: vi.fn() },
      {
        entryIds: new Set([waiting.id]),
        retry: true,
        runWriteAlone: async (write) => ({ ran: true, value: await write() }),
      },
    );

    expect(await readFile(waiting.finalPath, "utf8")).toBe("moved contents");
    expect(getResponseCacheSizes().directorySnapshots).toBe(0);
    resetResponseCacheState();
  });

  it("keeps the folder listings when a retry changed nothing", async () => {
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const waiting = createEntry("waiting", { moved: true });
    await writeFile(waiting.stagingPath, "moved contents");
    await journal.add(waiting);
    resetResponseCacheState();
    await getCachedResponse("directory", { path: testDir }, async () => "listing before");

    await recoverWrites(
      journal,
      originalFileSystem,
      { info: vi.fn(), error: vi.fn() },
      {
        entryIds: new Set([waiting.id]),
        retry: true,
        runWriteAlone: async () => ({ ran: false }),
      },
    );

    expect(getResponseCacheSizes().directorySnapshots).toBe(1);
    resetResponseCacheState();
  });

  // A retry runs while the app is in use: it waits for a moment when nothing else writes,
  // and touches nothing while an operation runs.
  it("leaves a waiting entry alone while another operation writes, and finishes it after", async () => {
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const waiting = createEntry("waiting", { moved: true });
    await writeFile(waiting.stagingPath, "moved contents");
    await journal.add(waiting);
    const logger = { info: vi.fn(), error: vi.fn() };
    const busy = vi.fn(async () => ({ ran: false as const }));

    const report = await recoverWrites(journal, originalFileSystem, logger, {
      entryIds: new Set([waiting.id]),
      retry: true,
      runWriteAlone: busy,
    });

    expect(busy).toHaveBeenCalledTimes(1);
    expect(report).toEqual({ notices: [], finished: [] });
    expect(await readFile(waiting.stagingPath, "utf8")).toBe("moved contents");
    expect(journal.entries()).toEqual([waiting]);
    expect(logger.error).not.toHaveBeenCalled();

    let writing = false;
    const free: RunWriteAlone = async (write) => {
      writing = true;
      try {
        return { ran: true, value: await write() };
      } finally {
        writing = false;
      }
    };
    const lstat = originalFileSystem.lstat;
    const seenWhileWriting: boolean[] = [];
    const watchingFileSystem = {
      ...originalFileSystem,
      // Whether the disk answers is checked before the slot is taken.
      lstat: (path: string) => {
        seenWhileWriting.push(writing);
        return lstat(path);
      },
    };
    const retried = await recoverWrites(journal, watchingFileSystem, logger, {
      entryIds: new Set([waiting.id]),
      retry: true,
      answerWithinMs: 1_000,
      runWriteAlone: free,
    });

    expect(retried.finished).toEqual([`“waiting.txt” is in place now, in “${testDir}”.`]);
    expect(await readFile(waiting.finalPath, "utf8")).toBe("moved contents");
    expect(journal.entries()).toEqual([]);
    expect(seenWhileWriting[0]).toBe(false);
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
      retryRecovery({
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
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
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

    await expect(recoverWrites(failingJournal, originalFileSystem, logger)).resolves.toEqual({
      notices: [],
      finished: [],
    });
    expect(await readFile(finished.finalPath, "utf8")).toBe("new contents");
    expect(logger.error).toHaveBeenCalledWith(
      "[filetrail] couldn't update the write journal",
      expect.any(Error),
    );
  });

  // A large file a crash cut short while it was being copied: only part of a copy, its
  // original in place. It is removed; an item of another name stays.
  it("removes the part of a large file left by a crash, and nothing else", async () => {
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const partial = join(testDir, ".movie.mov.filetrail-0a1b2c3d");
    await writeFile(partial, "part of it");
    const notOurs = join(testDir, "notes.txt");
    await writeFile(notOurs, "someone's notes");
    for (const [id, partialPath] of [
      ["partial", partial],
      ["not-ours", notOurs],
      ["gone", join(testDir, ".gone.mov.filetrail-11111111")],
    ] as const) {
      await journal.add({ kind: "partial_file", id, partialPath, finalPath: join(testDir, id) });
    }
    const logger = { info: vi.fn(), error: vi.fn() };

    expect(await recoverWrites(journal, originalFileSystem, logger)).toEqual({
      notices: [],
      finished: [],
    });

    expect((await readdir(testDir)).sort()).toEqual(["notes.txt", "replace-journal.json"]);
    expect(journal.entries()).toEqual([]);
    // Kept for a later try when its disk can't be read.
    const unreachable = join(testDir, "gone-disk", ".big.filetrail-22222222");
    await journal.add({
      kind: "partial_file",
      id: "away",
      partialPath: unreachable,
      finalPath: "x",
    });
    await recoverWrites(journal, originalFileSystem, logger);
    expect(journal.entries().map((entry) => entry.id)).toEqual(["away"]);
    expect(logger.info).toHaveBeenCalledWith(
      "[filetrail] an interrupted copy wasn't removed",
      expect.objectContaining({ partialPath: unreachable }),
    );
  });

  // A copy of a locked file is locked as it is finished, before it takes its name.
  it("removes a locked part of a large file", async () => {
    const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
    const partial = join(testDir, ".movie.mov.filetrail-0a1b2c3d");
    await writeFile(partial, "all of it");
    execFileSync("chflags", ["uchg", partial]);
    await journal.add({ kind: "partial_file", id: "p", partialPath: partial, finalPath: "x" });
    const logger = { info: vi.fn(), error: vi.fn() };

    await recoverWrites(journal, nativeFileSystem, logger);

    expect(existsSync(partial)).toBe(false);
    expect(journal.entries()).toEqual([]);
  });

  // v0.4.3 wrote down a large file copied inside a folder a paste was building, and ids
  // along with each folder: read back from its file, the folder and the part both go, by
  // their paths, and neither record stays.
  it("clears a folder and the part of a large file in it written down by v0.4.3", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const staging = join(testDir, ".F.filetrail-0a1b2c3d");
    await mkdir(staging);
    const partial = join(staging, ".movie.mov.filetrail-11111111");
    await writeFile(partial, "part of it");
    await writeFile(
      filePath,
      JSON.stringify([
        {
          ...createEntry("folder", {
            stagingPath: staging,
            finalPath: join(testDir, "F"),
            sourcePath: join(testDir, "source", "F"),
            staged: false,
          }),
          stagingId: { dev: 1, ino: 2 },
          stagingBornMs: 3,
          sourceId: { dev: 4, ino: 5 },
        },
        { kind: "partial_file", id: "p", partialPath: partial, finalPath: "x" },
      ]),
    );
    const journal = await openWriteJournal(filePath);
    const logger = { info: vi.fn(), error: vi.fn() };

    await recoverWrites(journal, nativeFileSystem, logger);

    expect(existsSync(staging)).toBe(false);
    expect(journal.entries()).toEqual([]);
  });

  // A folder being moved to another disk, complete under its hidden name when v0.4.3
  // stopped: put in place by its path (the ids it was written down with don't matter), and
  // the person is told the original is still where it was.
  it("puts in place a moved folder's copy written down by v0.4.3, and says so", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const staging = join(testDir, ".F.filetrail-0a1b2c3d");
    await mkdir(staging);
    await writeFile(join(staging, "a.txt"), "a");
    await writeFile(
      filePath,
      JSON.stringify([
        {
          ...createEntry("folder", {
            stagingPath: staging,
            finalPath: join(testDir, "F"),
            sourcePath: join(testDir, "source", "F"),
            staged: true,
            movingCopy: true,
          }),
          stagingId: { dev: 1, ino: 2 },
          stagingBornMs: 3,
          sourceId: { dev: 4, ino: 5 },
        },
      ]),
    );
    const journal = await openWriteJournal(filePath);
    const logger = { info: vi.fn(), error: vi.fn() };

    const report = await recoverWrites(journal, nativeFileSystem, logger);

    expect(await readFile(join(testDir, "F", "a.txt"), "utf8")).toBe("a");
    expect(existsSync(staging)).toBe(false);
    expect(report.notices).toEqual([
      `“F” was being moved when File Trail stopped. It is in “${basename(testDir)}” now, and the original is still in “source” too.`,
    ]);
    expect(journal.entries()).toEqual([]);
  });

  // Builds after v0.4.3 that were never released copied a large file as "part" in a hidden
  // folder of its own: that folder goes, and a record of one already gone clears.
  it("removes the hidden folder a large file was copied in by a build after v0.4.3", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const folder = join(testDir, ".movie.mov.filetrail-0a1b2c3d");
    await mkdir(folder);
    await writeFile(join(folder, "part"), "part of it");
    const gone = join(testDir, ".gone.mov.filetrail-11111111", "part");
    await writeFile(
      filePath,
      JSON.stringify(
        [
          ["p", join(folder, "part")],
          ["gone", gone],
        ].map(([id, partialPath]) => ({
          kind: "partial_file",
          id,
          partialPath,
          finalPath: join(testDir, "movie.mov"),
          folderId: { dev: 1, ino: 2 },
          folderBornMs: 3,
        })),
      ),
    );
    const journal = await openWriteJournal(filePath);
    const logger = { info: vi.fn(), error: vi.fn() };

    await recoverWrites(journal, nativeFileSystem, logger);

    expect(await readdir(testDir)).toEqual(["replace-journal.json"]);
    expect(journal.entries()).toEqual([]);
  });

  // A rename of several ("1" becomes "2", "2" becomes "3") stops dead as the first item
  // takes its new name, as in a crash: the items waiting under hidden names are put back at
  // the next start, and the person is told.
  it("puts back the items a rename of several left under hidden names", async () => {
    const folder = join(testDir, "trip");
    await mkdir(folder);
    for (const name of ["1.jpg", "2.jpg", "3.jpg"]) {
      await writeFile(join(folder, name), name);
    }
    const journalPath = join(testDir, "replace-journal.json");
    const journal = await openWriteJournal(journalPath);
    const fs = createOriginalWriteOperationFs(async () => null);
    let crashed: () => void = () => undefined;
    const crash = new Promise<void>((resolve) => {
      crashed = resolve;
    });
    void runBatchRename({
      request: {
        items: ["1.jpg", "2.jpg", "3.jpg"].map((name, index) => ({
          sourcePath: join(folder, name),
          destinationName: `${index + 2}.jpg`,
          isFolder: false,
        })),
        onConflict: "number",
        numberSeparator: " ",
      },
      fs: {
        ...fs,
        renameExclusive: async (from, to) => {
          if (basename(to) === "2.jpg") {
            crashed();
            return new Promise<void>(() => undefined);
          }
          return fs.renameExclusive(from, to);
        },
      },
      signal: new AbortController().signal,
      journal,
    });
    await crash;
    // "2.jpg" and "3.jpg" were moved aside for the others; "1.jpg" was taking its new name.
    expect((await readdir(folder)).filter((name) => !name.startsWith("."))).toEqual(["1.jpg"]);

    const reopened = await openWriteJournal(journalPath);
    const report = await recoverWrites(
      reopened,
      { ...originalFileSystem, renameExclusive: fs.renameExclusive },
      { info: vi.fn(), error: vi.fn() },
    );

    expect((await readdir(folder)).sort()).toEqual(["1.jpg", "2.jpg", "3.jpg"]);
    expect(await readFile(join(folder, "1.jpg"), "utf8")).toBe("1.jpg");
    expect(report.notices).toEqual([
      "A rename of several items was cut short when File Trail stopped. “2.jpg” is back under its old name; “3.jpg” is back under its old name.",
    ]);
    expect(reopened.entries()).toEqual([]);
  });

  // Items renamed from search results, one on a network share that hangs: the start goes
  // on, and nothing of the entry is put back until every folder answers.
  it("leaves a rename of several for later when any of its folders doesn't answer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const journal = await openWriteJournal(join(testDir, "replace-journal.json"));
      const entry = {
        kind: "batch_rename" as const,
        id: "rename",
        items: [
          {
            temporaryPath: "/Users/me/Photos/.filetrail-rename-aaaaaaaaaaaa",
            originalPath: "/Users/me/Photos/a.jpg",
            newPath: "/Users/me/Photos/b.jpg",
          },
          {
            temporaryPath: "/Volumes/Share/Photos/.filetrail-rename-bbbbbbbbbbbb",
            originalPath: "/Volumes/Share/Photos/c.jpg",
            newPath: "/Volumes/Share/Photos/d.jpg",
          },
        ],
      };
      await journal.add(entry);
      const renameExclusive = vi.fn(async () => undefined);
      const fileSystem = {
        ...originalFileSystem,
        lstat: (path: string) =>
          path.startsWith("/Volumes/Share")
            ? new Promise<never>(() => undefined)
            : Promise.resolve(lstatSync(testDir)),
        renameExclusive,
      };

      let settled = false;
      const recovered = recoverWrites(
        journal,
        fileSystem,
        { info: vi.fn(), error: vi.fn() },
        { answerWithinMs: 1_000 },
      ).then((report) => {
        settled = true;
        return report;
      });
      await vi.advanceTimersByTimeAsync(1_001);

      expect(settled).toBe(true);
      expect((await recovered).notices).toEqual([]);
      expect(renameExclusive).not.toHaveBeenCalled();
      expect(journal.entries()).toEqual([entry]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads both kinds of entry back, and leaves out what it can't read", async () => {
    const filePath = join(testDir, "replace-journal.json");
    await writeFile(
      filePath,
      JSON.stringify([
        createEntry("old"),
        {
          kind: "partial_file",
          id: "p",
          partialPath: "/a/.b.filetrail-00000000",
          finalPath: "/a/b",
        },
        { kind: "partial_file", id: "broken" },
        { kind: "something_newer", id: "n", finalPath: "/x" },
      ]),
    );

    expect((await openWriteJournal(filePath)).entries().map((entry) => entry.id)).toEqual([
      "old",
      "p",
    ]);
  });

  it("does nothing when there is nothing to recover", async () => {
    const filePath = join(testDir, "replace-journal.json");
    const journal = await openWriteJournal(filePath);
    const logger = { info: vi.fn(), error: vi.fn() };

    await recoverWrites(journal, originalFileSystem, logger);

    expect(logger.info).not.toHaveBeenCalled();
    expect(existsSync(filePath)).toBe(false);
  });
});
