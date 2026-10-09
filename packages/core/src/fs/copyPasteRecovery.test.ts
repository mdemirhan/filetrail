import { dirname } from "node:path";

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
    fileSystem.enableRename();
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
});

describe("removing the part of a large file a crash cut short", () => {
  const folder = "/target/.movie.mov.filetrail-0000abcd";

  function withPart(): MockWriteServiceFileSystem {
    return new MockWriteServiceFileSystem({
      [folder]: { kind: "directory", ino: 700, dev: 1 },
      [`${folder}/part`]: { kind: "file", size: 9, ino: 701, dev: 1 },
    });
  }

  function entryFor(id: { dev: number; ino: number }): PartialFileJournalEntry {
    return {
      kind: "partial_file",
      id: "p",
      partialPath: `${folder}/part`,
      finalPath: "/target/movie.mov",
      folderId: id,
    };
  }

  it("removes the hidden folder it was copied in, known by its id", async () => {
    const fileSystem = withPart();

    const [outcome] = await recoverPartialFiles([entryFor({ dev: 1, ino: 700 })], fileSystem);

    expect(outcome?.outcome).toBe("removed_copy");
    expect(fileSystem.exists(folder)).toBe(false);
  });

  it("leaves another item that came to have the folder's name", async () => {
    const fileSystem = withPart();

    const [outcome] = await recoverPartialFiles([entryFor({ dev: 1, ino: 999 })], fileSystem);

    expect(outcome?.outcome).toBe("nothing_left");
    expect(fileSystem.exists(`${folder}/part`)).toBe(true);
  });

  it("knows the folder on a disk connected again by its file id and when it was made", async () => {
    const fileSystem = withPart();
    fileSystem.lstatImpl = async (path) => {
      fileSystem.lstatImpl = null;
      const stats = await fileSystem.lstat(path);
      fileSystem.lstatImpl = impl;
      return { ...stats, dev: 9, birthtimeMs: 1234 };
    };
    const impl = fileSystem.lstatImpl;

    const [other] = await recoverPartialFiles([entryFor({ dev: 1, ino: 700 })], fileSystem);
    expect(other?.outcome).toBe("nothing_left");
    const [same] = await recoverPartialFiles(
      [{ ...entryFor({ dev: 1, ino: 700 }), folderBornMs: 1234 }],
      fileSystem,
    );
    expect(same?.outcome).toBe("removed_copy");
  });

  it("finds nothing left once the folder is gone", async () => {
    const fileSystem = new MockWriteServiceFileSystem({ "/target": { kind: "directory" } });

    const [outcome] = await recoverPartialFiles([entryFor({ dev: 1, ino: 700 })], fileSystem);

    expect(outcome?.outcome).toBe("nothing_left");
  });

  it("removes a part written down without a folder by its hidden name, as before", async () => {
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
  it("writes down the folder it is copied in, by its id, before copying anything", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/movie.mov": { kind: "file", size: JOURNALED_FILE_BYTES },
      "/target": { kind: "directory" },
    });
    fileSystem.enableRename();
    const live = new Map<string, WriteJournalEntry>();
    const seen: Array<{ entry: WriteJournalEntry | undefined; folderId: string }> = [];
    fileSystem.copyFileStreamImpl = async (_source, destination) => {
      const folder = await fileSystem.lstat(dirname(destination));
      seen.push({ entry: [...live.values()][0], folderId: `${folder.dev}:${folder.ino}` });
      fileSystem.addFile(destination, { size: JOURNALED_FILE_BYTES });
    };
    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/source/movie.mov"],
        destinationDirectoryPath: "/target",
      },
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

    const [{ entry, folderId } = { entry: undefined, folderId: "" }] = seen;
    expect(entry).toMatchObject({
      kind: "partial_file",
      partialPath: expect.stringMatching(/^\/target\/\.movie\.mov\.filetrail-[0-9a-f]{8}\/part$/u),
      finalPath: "/target/movie.mov",
    });
    const recorded = entry?.kind === "partial_file" ? entry.folderId : undefined;
    expect(`${recorded?.dev}:${recorded?.ino}`).toBe(folderId);
    // Done: the file has its name, and nothing is left under a hidden one.
    expect(live.size).toBe(0);
    expect(fileSystem.readNode("/target/movie.mov")?.size).toBe(JOURNALED_FILE_BYTES);
    expect([...fileSystem.nodes.keys()].filter((path) => path.includes(".filetrail-"))).toEqual([]);
  });
});
