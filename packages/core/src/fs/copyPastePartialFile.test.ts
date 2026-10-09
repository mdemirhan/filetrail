import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { JOURNALED_FILE_BYTES, executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { recoverPartialFiles } from "./copyPasteRecovery";
import { MockWriteServiceFileSystem } from "./testUtils";
import type {
  CopyPasteMode,
  CopyPasteOperationResult,
  CopyPastePolicy,
  CopyPasteProgressEvent,
  CopyPasteRuntimeConflict,
  CopyPasteRuntimeResolutionAction,
  PartialFileJournalEntry,
  WriteJournalEntry,
} from "./writeServiceTypes";

// A large file is copied under a hidden name next to its place, written down in the journal
// first. Whatever stops it part way, nothing is left at its name, the part goes, and the
// journal lets go of it; a part that can't be removed stays written down for the next start.

const SKIP: CopyPastePolicy = { file: "skip", directory: "skip", mismatch: "skip" };
const SOURCE = "/source/movie.mov";
const FINAL = "/target/movie.mov";

function fsError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code, path });
}

// The file on another disk (dev 2): a move copies it, then removes the original.
function largeFileOnAnotherDisk(): MockWriteServiceFileSystem {
  const fileSystem = new MockWriteServiceFileSystem({
    "/source": { kind: "directory", dev: 2 },
    [SOURCE]: { kind: "file", size: JOURNALED_FILE_BYTES, dev: 2 },
    "/target": { kind: "directory" },
  });
  fileSystem.enableRename();
  return fileSystem;
}

function hiddenItems(fileSystem: MockWriteServiceFileSystem): string[] {
  return [...fileSystem.nodes.keys()].filter((path) => path.includes(".filetrail-"));
}

type Run = {
  result: CopyPasteOperationResult;
  live: Map<string, WriteJournalEntry>;
  recorded: WriteJournalEntry[];
  questions: CopyPasteRuntimeConflict[];
};

async function paste(
  fileSystem: MockWriteServiceFileSystem,
  mode: CopyPasteMode,
  options: {
    controller?: AbortController;
    answer?: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
  } = {},
): Promise<Run> {
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-1",
    request: { mode, sourcePaths: [SOURCE], destinationDirectoryPath: "/target" },
    fileSystem,
    thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1e12 },
  });
  const live = new Map<string, WriteJournalEntry>();
  const recorded: WriteJournalEntry[] = [];
  const questions: CopyPasteRuntimeConflict[] = [];
  const events: CopyPasteProgressEvent[] = [];
  await executeCopyPasteFromAnalysis({
    operationId: "op-1",
    report,
    mode,
    policy: SKIP,
    fileSystem,
    now: () => new Date("2026-10-09T00:00:00.000Z"),
    signal: (options.controller ?? new AbortController()).signal,
    resolvedNodes: await resolveAnalysisWithPolicy({ report, policy: SKIP, fileSystem }),
    emit: (event) => events.push(event),
    requestResolution: async (conflict) => {
      questions.push(conflict);
      return options.answer?.(conflict) ?? null;
    },
    writeJournal: {
      add: async (entry) => {
        recorded.push(entry);
        live.set(entry.id, entry);
      },
      remove: async (id) => {
        live.delete(id);
      },
    },
  });
  const result = events.at(-1)?.result;
  if (!result) {
    throw new Error("The paste didn't finish.");
  }
  return { result, live, recorded, questions };
}

// Copies part of the file under its hidden name, then does `then` (throws, aborts...).
function copyPartThen(
  fileSystem: MockWriteServiceFileSystem,
  then: (destination: string, signal: AbortSignal | undefined) => void,
): void {
  fileSystem.copyFileStreamImpl = async (_source, destination, signal) => {
    fileSystem.addFile(destination, { size: 1024 });
    then(destination, signal);
  };
}

// Nothing at the file's name or under a hidden one, the journal let go of the entry it
// wrote (the part's hidden name), and the original is where it was.
function expectNothingLeft(fileSystem: MockWriteServiceFileSystem, run: Run): void {
  expect(run.recorded).toEqual([
    expect.objectContaining({
      kind: "partial_file",
      partialPath: expect.stringMatching(/^\/target\/\.movie\.mov\.filetrail-[0-9a-f]{8}$/u),
      finalPath: FINAL,
    }),
  ]);
  expect(run.live.size).toBe(0);
  expect(hiddenItems(fileSystem)).toEqual([]);
  expect(fileSystem.readNode(SOURCE)?.size).toBe(JOURNALED_FILE_BYTES);
}

describe.each(["copy", "cut"] as const)("a large file (%s) cut short", (mode) => {
  it("leaves nothing behind when stopped part way", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    const controller = new AbortController();
    copyPartThen(fileSystem, (_destination, signal) => {
      controller.abort();
      signal?.throwIfAborted();
    });

    const run = await paste(fileSystem, mode, { controller });

    expect(run.result.status).toBe("cancelled");
    expect(fileSystem.exists(FINAL)).toBe(false);
    expectNothingLeft(fileSystem, run);
  });

  it.each(["ENOSPC", "EIO"])("leaves nothing behind and says why on %s", async (code) => {
    const fileSystem = largeFileOnAnotherDisk();
    copyPartThen(fileSystem, (destination) => {
      throw fsError(code, destination);
    });

    const run = await paste(fileSystem, mode);

    expect(run.result.status).toBe("failed");
    expect(run.result.items).toEqual([
      expect.objectContaining({ sourcePath: SOURCE, status: "failed", error: expect.any(String) }),
    ]);
    expect(run.result.items[0]?.error).not.toBe("");
    expect(fileSystem.exists(FINAL)).toBe(false);
    expectNothingLeft(fileSystem, run);
  });

  it("asks about an item that took the name as the copy was done, and clears its own away", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    // Another app saves a file at the name while the copy is being made.
    copyPartThen(fileSystem, () => fileSystem.addFile(FINAL, { size: 3 }));

    const run = await paste(fileSystem, mode, { answer: () => "skip" });

    expect(run.questions).toEqual([
      expect.objectContaining({ sourcePath: SOURCE, destinationPath: FINAL }),
    ]);
    expect(run.result.items).toEqual([
      expect.objectContaining({ sourcePath: SOURCE, status: "skipped" }),
    ]);
    // The other app's file is untouched.
    expect(fileSystem.readNode(FINAL)?.size).toBe(3);
    expectNothingLeft(fileSystem, run);
  });

  it("fails the item when it can't take its name, and clears its own away", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    fileSystem.renameImpl = async (from, to) => {
      if (to === FINAL && from.includes(".filetrail-")) {
        throw fsError("EIO", to);
      }
      await fileSystem.renameDirectly(from, to);
    };

    const run = await paste(fileSystem, mode);

    expect(run.result.items).toEqual([
      expect.objectContaining({ sourcePath: SOURCE, status: "failed" }),
    ]);
    expect(fileSystem.exists(FINAL)).toBe(false);
    expectNothingLeft(fileSystem, run);
  });
});

describe.each(["copy", "cut"] as const)("a large file's hidden part (%s)", (mode) => {
  // rm of the hidden part fails (a disk error) until `working` is set.
  function partRemovalFails(fileSystem: MockWriteServiceFileSystem): { working: boolean } {
    const state = { working: false };
    fileSystem.rmImpl = async (path, options) => {
      if (!state.working && /\.filetrail-[0-9a-f]{8}$/u.test(path)) {
        throw fsError("EIO", path);
      }
      fileSystem.rmImpl = null;
      try {
        await fileSystem.rm(path, options);
      } finally {
        fileSystem.rmImpl = impl;
      }
    };
    const impl = fileSystem.rmImpl;
    return state;
  }

  it("stays written down when a failed copy can't clear it away", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    const removal = partRemovalFails(fileSystem);
    copyPartThen(fileSystem, (destination) => {
      throw fsError("ENOSPC", destination);
    });

    const run = await paste(fileSystem, mode);

    expect(run.result.items).toEqual([
      expect.objectContaining({ sourcePath: SOURCE, status: "failed" }),
    ]);
    expect(fileSystem.exists(FINAL)).toBe(false);
    expect(fileSystem.readNode(SOURCE)?.size).toBe(JOURNALED_FILE_BYTES);
    const entries = [...run.live.values()] as PartialFileJournalEntry[];
    expect(entries).toHaveLength(1);
    expect(hiddenItems(fileSystem).length).toBeGreaterThan(0);

    removal.working = true;
    const outcomes = await recoverPartialFiles(entries, fileSystem);

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["removed_copy"]);
    expect(hiddenItems(fileSystem)).toEqual([]);
  });
});

describe("a large file's copy cut short by a crash", () => {
  // The copy never comes back, as when the app is killed part way: the journal entry it
  // wrote and the part are all that is left.
  async function crashPartWay(
    fileSystem: MockWriteServiceFileSystem,
  ): Promise<PartialFileJournalEntry> {
    let wrote: (entry: PartialFileJournalEntry) => void = () => undefined;
    const written = new Promise<PartialFileJournalEntry>((resolve) => {
      wrote = resolve;
    });
    const entries: WriteJournalEntry[] = [];
    fileSystem.copyFileStreamImpl = async (_source, destination) => {
      fileSystem.addFile(destination, { size: 1024 });
      wrote(entries[0] as PartialFileJournalEntry);
      await new Promise(() => undefined);
    };
    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: { mode: "copy", sourcePaths: [SOURCE], destinationDirectoryPath: "/target" },
      fileSystem,
      thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1e12 },
    });
    void executeCopyPasteFromAnalysis({
      operationId: "op-1",
      report,
      mode: "copy",
      policy: SKIP,
      fileSystem,
      now: () => new Date("2026-10-09T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: await resolveAnalysisWithPolicy({ report, policy: SKIP, fileSystem }),
      emit: () => undefined,
      requestResolution: async () => null,
      writeJournal: {
        add: async (entry) => {
          entries.push(entry);
        },
        remove: async () => undefined,
      },
    });
    return written;
  }

  it("has its part removed at the next start", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    const entry = await crashPartWay(fileSystem);
    expect(fileSystem.exists(entry.partialPath)).toBe(true);

    const outcomes = await recoverPartialFiles([entry], fileSystem);

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["removed_copy"]);
    expect(hiddenItems(fileSystem)).toEqual([]);
    expect(fileSystem.exists(FINAL)).toBe(false);
    expect(fileSystem.readNode(SOURCE)?.size).toBe(JOURNALED_FILE_BYTES);
  });
});

describe("a file that failed inside a folder being copied", () => {
  // A folder on another disk with two files; copying "a.txt" writes part of it, then fails.
  async function copyFolderWithFailingFile(options: { partRemovable: boolean }) {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory", dev: 2 },
      "/source/dir": { kind: "directory", dev: 2 },
      "/source/dir/a.txt": { kind: "file", size: 10, dev: 2 },
      "/source/dir/b.txt": { kind: "file", size: 10, dev: 2 },
      "/target": { kind: "directory" },
    });
    fileSystem.enableRename();
    const written: string[] = [];
    fileSystem.copyFileStreamImpl = async (source, destination) => {
      written.push(destination);
      const fails = source.endsWith("/a.txt");
      fileSystem.addFile(destination, { size: fails ? 4 : 10 });
      if (fails) {
        throw fsError("EIO", destination);
      }
    };
    if (!options.partRemovable) {
      fileSystem.rmImpl = async (path, rmOptions) => {
        if (path.endsWith("/a.txt")) {
          throw fsError("EIO", path);
        }
        fileSystem.rmImpl = null;
        try {
          await fileSystem.rm(path, rmOptions);
        } finally {
          fileSystem.rmImpl = impl;
        }
      };
    }
    const impl = fileSystem.rmImpl;
    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: { mode: "copy", sourcePaths: ["/source/dir"], destinationDirectoryPath: "/target" },
      fileSystem,
      thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1e12 },
    });
    const events: CopyPasteProgressEvent[] = [];
    await executeCopyPasteFromAnalysis({
      operationId: "op-1",
      report,
      mode: "copy",
      policy: SKIP,
      fileSystem,
      now: () => new Date("2026-10-09T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: await resolveAnalysisWithPolicy({ report, policy: SKIP, fileSystem }),
      emit: (event) => events.push(event),
      requestResolution: async () => null,
    });
    const result = events.at(-1)?.result;
    if (!result) {
      throw new Error("The paste didn't finish.");
    }
    return { fileSystem, result, written };
  }

  it("is written straight into the hidden folder, which is put in place without it", async () => {
    const { fileSystem, result, written } = await copyFolderWithFailingFile({
      partRemovable: true,
    });

    // No hidden name of its own inside the folder's.
    expect(written).toEqual([
      expect.stringMatching(/^\/target\/\.dir\.filetrail-[0-9a-f]{8}\/a\.txt$/u),
      expect.stringMatching(/^\/target\/\.dir\.filetrail-[0-9a-f]{8}\/b\.txt$/u),
    ]);
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: "/source/dir/a.txt", status: "failed" }),
      ]),
    );
    expect(fileSystem.exists("/target/dir/a.txt")).toBe(false);
    expect(fileSystem.readNode("/target/dir/b.txt")?.size).toBe(10);
    expect(hiddenItems(fileSystem)).toEqual([]);
  });

  it("keeps the whole folder from being put in place when its part can't be removed", async () => {
    const { fileSystem, result } = await copyFolderWithFailingFile({ partRemovable: false });

    expect(result.status).toBe("failed");
    expect(result.items).toEqual([
      expect.objectContaining({ sourcePath: "/source/dir", status: "failed" }),
    ]);
    // The cut-short "a.txt" never shows under its name.
    expect(fileSystem.exists("/target/dir")).toBe(false);
  });
});
