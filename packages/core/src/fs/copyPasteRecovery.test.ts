import { vi } from "vitest";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { JOURNALED_FILE_BYTES, executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { recoverInterruptedReplaces, recoverPartialFiles } from "./copyPasteRecovery";
import { MockWriteServiceFileSystem } from "./testUtils";
import type {
  PartialFileJournalEntry,
  ReplaceJournalEntry,
  WriteJournalEntry,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

// Looking anything up under `folder` never comes back, as on a network disk that hangs.
function hangUnder(fileSystem: MockWriteServiceFileSystem, folder: string): void {
  const impl: WriteServiceFileSystem["lstat"] = (path) => {
    if (path === folder || path.startsWith(`${folder}/`)) {
      return new Promise(() => undefined);
    }
    fileSystem.lstatImpl = null;
    const answer = fileSystem.lstat(path);
    fileSystem.lstatImpl = impl;
    return answer;
  };
  fileSystem.lstatImpl = impl;
}

describe("recovering a Replace or a move at start", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves an entry for later, untouched, when its original's disk doesn't answer", async () => {
    vi.useFakeTimers();
    const fileSystem = new MockWriteServiceFileSystem({
      "/away/a.txt": { kind: "file", size: 1 },
      "/target/.a.txt.filetrail-0000abcd": { kind: "file", size: 1 },
      "/target/a.txt": { kind: "file", size: 2 },
    });
    hangUnder(fileSystem, "/away");
    const entry: ReplaceJournalEntry = {
      id: "1",
      stagingPath: "/target/.a.txt.filetrail-0000abcd",
      finalPath: "/target/a.txt",
      sourcePath: "/away/a.txt",
      moved: true,
      staged: true,
    };

    let settled = false;
    const recovery = recoverInterruptedReplaces([entry], fileSystem, { answerWithinMs: 1_000 });
    void recovery.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled).toBe(true);
    expect(await recovery).toEqual([
      { entry, outcome: "unreachable", error: "The disk didn't answer." },
    ]);
    expect(fileSystem.exists("/target/.a.txt.filetrail-0000abcd")).toBe(true);
    expect(fileSystem.readNode("/target/a.txt")?.size).toBe(2);
  });

  // A copy never goes back to its original's place: a share there that hangs doesn't hold
  // up the copy, already whole, from being put in place.
  it("puts a copy in place when only its original's disk doesn't answer", async () => {
    vi.useFakeTimers();
    const fileSystem = new MockWriteServiceFileSystem({
      "/away/a.txt": { kind: "file", size: 1 },
      "/target/.a.txt.filetrail-0000abcd": { kind: "file", size: 1 },
    });
    hangUnder(fileSystem, "/away");
    const entry: ReplaceJournalEntry = {
      id: "1",
      stagingPath: "/target/.a.txt.filetrail-0000abcd",
      finalPath: "/target/a.txt",
      sourcePath: "/away/a.txt",
      moved: false,
      staged: true,
    };

    const recovery = recoverInterruptedReplaces([entry], fileSystem, { answerWithinMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await recovery).toEqual([{ entry, outcome: "finished", path: "/target/a.txt" }]);
    expect(fileSystem.readNode("/target/a.txt")?.size).toBe(1);
  });
});

describe("recovering a Replace by its hidden name", () => {
  // Only an item under a hidden name this app makes is ever moved or removed: a record that
  // names anything else (a journal written wrong) leaves it alone.
  it("leaves alone an item that isn't under a hidden name of this app's", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target/notes.txt": { kind: "file", size: 3 },
    });
    const entry: ReplaceJournalEntry = {
      id: "1",
      stagingPath: "/target/notes.txt",
      finalPath: "/target/a.txt",
      sourcePath: "/source/a.txt",
      moved: false,
      staged: false,
    };

    expect(await recoverInterruptedReplaces([entry], fileSystem)).toEqual([
      { entry, outcome: "nothing_left" },
    ]);
    expect(fileSystem.readNode("/target/notes.txt")?.size).toBe(3);
  });
});

describe("removing the part of a large file a crash cut short", () => {
  const folder = "/target/.movie.mov.filetrail-0000abcd";

  // Written by builds after v0.4.3 that were never released: the part was copied as "part"
  // in a hidden folder of its own, written down with the folder's id.
  const legacyEntry = {
    kind: "partial_file",
    id: "p",
    partialPath: `${folder}/part`,
    finalPath: "/target/movie.mov",
    folderId: { dev: 1, ino: 700 },
  } as PartialFileJournalEntry;

  it("removes the hidden folder a build after v0.4.3 copied it in", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      [folder]: { kind: "directory" },
      [`${folder}/part`]: { kind: "file", size: 9 },
    });

    const [outcome] = await recoverPartialFiles([legacyEntry], fileSystem);

    expect(outcome?.outcome).toBe("removed_copy");
    expect(fileSystem.exists(folder)).toBe(false);
  });

  it("finds nothing left once that folder is gone", async () => {
    const fileSystem = new MockWriteServiceFileSystem({ "/target": { kind: "directory" } });

    const [outcome] = await recoverPartialFiles([legacyEntry], fileSystem);

    expect(outcome?.outcome).toBe("nothing_left");
  });

  it("leaves a part for later when its disk doesn't answer, or another write runs", async () => {
    vi.useFakeTimers();
    const part = "/target/.movie.mov.filetrail-0000abcd";
    const fileSystem = new MockWriteServiceFileSystem({ [part]: { kind: "file", size: 9 } });
    const entry: PartialFileJournalEntry = {
      kind: "partial_file",
      id: "p",
      partialPath: part,
      finalPath: "/target/movie.mov",
    };

    expect(
      await recoverPartialFiles([entry], fileSystem, {
        runWriteAlone: async () => ({ ran: false }),
      }),
    ).toEqual([{ entry, outcome: "deferred" }]);
    hangUnder(fileSystem, "/target");
    const recovery = recoverPartialFiles([entry], fileSystem, { answerWithinMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await recovery).toEqual([
      { entry, outcome: "unreachable", error: "The disk didn't answer." },
    ]);
    vi.useRealTimers();
    expect(fileSystem.exists(part)).toBe(true);
  });

  it("says why a part couldn't be removed", async () => {
    const part = "/target/.movie.mov.filetrail-0000abcd";
    const fileSystem = new MockWriteServiceFileSystem({ [part]: { kind: "file", size: 9 } });
    fileSystem.rmImpl = async () => {
      throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    };
    const entry: PartialFileJournalEntry = {
      kind: "partial_file",
      id: "p",
      partialPath: part,
      finalPath: "/target/movie.mov",
    };

    const [outcome] = await recoverPartialFiles([entry], fileSystem, {
      runWriteAlone: async (write) => ({ ran: true, value: await write() }),
    });

    expect(outcome).toMatchObject({ entry, outcome: "failed", error: expect.any(String) });
    expect(fileSystem.exists(part)).toBe(true);
  });

  it("removes a part by its hidden name", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target/.movie.mov.filetrail-0000abcd": { kind: "file", size: 9 },
    });

    const [outcome] = await recoverPartialFiles(
      [
        {
          kind: "partial_file",
          id: "p",
          partialPath: "/target/.movie.mov.filetrail-0000abcd",
          finalPath: "/target/movie.mov",
        },
      ],
      fileSystem,
    );

    expect(outcome?.outcome).toBe("removed_copy");
    expect(fileSystem.exists("/target/.movie.mov.filetrail-0000abcd")).toBe(false);
  });
});

describe("copying a large file", () => {
  // Copies `sourcePaths` into /target, noting the journal's entries as each file's contents
  // are written.
  async function copyLarge(fileSystem: MockWriteServiceFileSystem, sourcePaths: string[]) {
    const live = new Map<string, WriteJournalEntry>();
    const seen: Array<{ destination: string; entries: WriteJournalEntry[] }> = [];
    fileSystem.copyFileImpl = async (_source, destination) => {
      seen.push({ destination, entries: [...live.values()] });
      fileSystem.addFile(destination, { size: JOURNALED_FILE_BYTES });
    };
    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: { mode: "copy", sourcePaths, destinationDirectoryPath: "/target" },
      fileSystem,
      thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1e12 },
    });
    const policy = { file: "skip", directory: "skip", mismatch: "skip" } as const;
    await executeCopyPasteFromAnalysis({
      operationId: "op-1",
      report,
      mode: "copy",
      policy,
      fileSystem,
      now: () => new Date("2026-10-09T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: await resolveAnalysisWithPolicy({ report, policy, fileSystem }),
      emit: () => undefined,
      requestResolution: async () => null,
      writeJournal: {
        add: async (entry) => {
          live.set(entry.id, entry);
        },
        remove: async (id) => {
          live.delete(id);
        },
      },
    });
    return { seen, live };
  }

  it("writes down the hidden name it is copied under before copying anything", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/movie.mov": { kind: "file", size: JOURNALED_FILE_BYTES },
      "/target": { kind: "directory" },
    });

    const { seen, live } = await copyLarge(fileSystem, ["/source/movie.mov"]);

    expect(seen).toEqual([
      {
        destination: expect.stringMatching(/^\/target\/\.movie\.mov\.filetrail-[0-9a-f]{8}$/u),
        entries: [
          {
            kind: "partial_file",
            id: expect.any(String),
            partialPath: seen[0]?.destination,
            finalPath: "/target/movie.mov",
          },
        ],
      },
    ]);
    // Done: the file has its name, and nothing is left under a hidden one.
    expect(live.size).toBe(0);
    expect(fileSystem.readNode("/target/movie.mov")?.size).toBe(JOURNALED_FILE_BYTES);
    expect([...fileSystem.nodes.keys()].filter((path) => path.includes(".filetrail-"))).toEqual([]);
  });

  // The folder's own record covers what is inside it: a crash leaves both to go with it.
  it("isn't written down on its own inside a folder built under a hidden name", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/F": { kind: "directory" },
      "/source/F/movie.mov": { kind: "file", size: JOURNALED_FILE_BYTES },
      "/target": { kind: "directory" },
    });

    const { seen, live } = await copyLarge(fileSystem, ["/source/F"]);

    expect(seen).toHaveLength(1);
    // Only the folder's own record.
    expect(seen[0]?.entries).toEqual([expect.objectContaining({ finalPath: "/target/F" })]);
    expect(live.size).toBe(0);
    expect(fileSystem.readNode("/target/F/movie.mov")?.size).toBe(JOURNALED_FILE_BYTES);
  });
});
