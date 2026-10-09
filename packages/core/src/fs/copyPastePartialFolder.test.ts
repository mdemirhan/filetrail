import { dirname } from "node:path";

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

// A large file is copied inside a hidden folder made for it, written down in the journal
// first. Whatever stops it part way, nothing is left at its name, the folder goes, and the
// journal lets go of it; a folder that can't be removed stays written down for the next start.

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

// Copies part of the file into the hidden folder, then does `then` (throws, aborts...).
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
// wrote (in the hidden folder, by its id), and the original is where it was.
function expectNothingLeft(fileSystem: MockWriteServiceFileSystem, run: Run): void {
  expect(run.recorded).toEqual([
    expect.objectContaining({
      kind: "partial_file",
      partialPath: expect.stringMatching(/^\/target\/\.movie\.mov\.filetrail-[0-9a-f]{8}\/part$/u),
      finalPath: FINAL,
      folderId: { dev: 1, ino: expect.any(Number) },
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
      if (to === FINAL && from.endsWith("/part")) {
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

describe.each(["copy", "cut"] as const)("a large file's hidden folder (%s)", (mode) => {
  // rm of the hidden folder fails (a disk error) until `working` is set.
  function folderRemovalFails(fileSystem: MockWriteServiceFileSystem): { working: boolean } {
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

  it("stays written down when it can't be removed, for the next start to remove", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    const removal = folderRemovalFails(fileSystem);

    const run = await paste(fileSystem, mode);

    // The file itself is in place; only the (empty) folder it was copied in is left.
    expect(run.result.items).toEqual([
      expect.objectContaining({ sourcePath: SOURCE, status: "completed" }),
    ]);
    expect(fileSystem.readNode(FINAL)?.size).toBe(JOURNALED_FILE_BYTES);
    const entries = [...run.live.values()] as PartialFileJournalEntry[];
    expect(entries).toHaveLength(1);
    const folder = dirname(entries[0]?.partialPath ?? "");
    expect(hiddenItems(fileSystem)).toEqual([folder]);

    removal.working = true;
    const outcomes = await recoverPartialFiles(entries, fileSystem);

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["removed_copy"]);
    expect(hiddenItems(fileSystem)).toEqual([]);
    expect(fileSystem.readNode(FINAL)?.size).toBe(JOURNALED_FILE_BYTES);
  });

  it("stays written down with its part when a failed copy can't clear it away", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    const removal = folderRemovalFails(fileSystem);
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
  // wrote and the folder holding the part are all that is left.
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

  it("has its hidden folder removed at the next start, known by the id written down", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    const entry = await crashPartWay(fileSystem);
    expect(fileSystem.exists(entry.partialPath)).toBe(true);

    const outcomes = await recoverPartialFiles([entry], fileSystem);

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["removed_copy"]);
    expect(hiddenItems(fileSystem)).toEqual([]);
    expect(fileSystem.exists(FINAL)).toBe(false);
    expect(fileSystem.readNode(SOURCE)?.size).toBe(JOURNALED_FILE_BYTES);
  });

  it("leaves another folder that came to have its name", async () => {
    const fileSystem = largeFileOnAnotherDisk();
    const entry = await crashPartWay(fileSystem);
    const folder = dirname(entry.partialPath);
    // Removed, and another folder made at the name since (a new id).
    await fileSystem.rm(folder, { recursive: true, force: true });
    fileSystem.addFile(`${folder}/part`, { size: 7 });

    const outcomes = await recoverPartialFiles([entry], fileSystem);

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["nothing_left"]);
    expect(fileSystem.readNode(`${folder}/part`)?.size).toBe(7);
  });
});
