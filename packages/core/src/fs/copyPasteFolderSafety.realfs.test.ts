import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis, removeStagedItem } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { recoverInterruptedReplaces } from "./copyPasteRecovery";
import {
  type CopyPasteOperationResult,
  type CopyPastePolicy,
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  type ReplaceJournalEntry,
  type WriteServiceFileSystem,
} from "./writeServiceTypes";

// Folders that can't be read are readable anyway when running as root.
const runsAsRoot = process.getuid?.() === 0;

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-folder-safety-"));
});

afterEach(async () => {
  // Read-only folders left by a test would stop the cleanup.
  execFileSync("chmod", ["-R", "u+rwx", testDir]);
  await rm(testDir, { recursive: true, force: true });
});

async function paste(args: {
  mode: "copy" | "cut";
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy?: CopyPastePolicy;
  fileSystem?: WriteServiceFileSystem;
  replaceJournal?: Parameters<typeof executeCopyPasteFromAnalysis>[0]["replaceJournal"];
}): Promise<CopyPasteOperationResult> {
  const fileSystem = args.fileSystem ?? DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
  const policy = args.policy ?? { file: "skip", directory: "merge", mismatch: "skip" };
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-folder-safety",
    request: {
      mode: args.mode,
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath,
    },
    fileSystem,
    thresholds: { largeBatchItemThreshold: 1000, largeBatchByteThreshold: 1e9 },
  });
  expect(report.issues).toEqual([]);
  const resolvedNodes = await resolveAnalysisWithPolicy({ report, policy, fileSystem });
  let result: CopyPasteOperationResult | null = null;
  await executeCopyPasteFromAnalysis({
    operationId: "op-folder-safety",
    report,
    mode: args.mode,
    policy,
    fileSystem,
    now: () => new Date(),
    signal: new AbortController().signal,
    resolvedNodes,
    emit: (event) => {
      result = event.result ?? result;
    },
    requestResolution: async () => null,
    ...(args.replaceJournal ? { replaceJournal: args.replaceJournal } : {}),
  });
  if (!result) {
    throw new Error("The paste reported no result.");
  }
  return result;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function modeOf(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777;
}

describe("read-only folders", () => {
  it("copies a read-only folder with everything in it, and keeps it read-only", async () => {
    const source = join(testDir, "src", "module");
    await mkdir(join(source, "nested"), { recursive: true });
    await writeFile(join(source, "a.txt"), "a");
    await writeFile(join(source, "nested", "b.txt"), "b");
    await chmod(join(source, "nested"), 0o555);
    await chmod(source, 0o555);
    await mkdir(join(testDir, "dst"));

    const result = await paste({
      mode: "copy",
      sourcePaths: [source],
      destinationDirectoryPath: join(testDir, "dst"),
    });

    expect(result.status).toBe("completed");
    const copy = join(testDir, "dst", "module");
    expect(await readFile(join(copy, "a.txt"), "utf8")).toBe("a");
    expect(await readFile(join(copy, "nested", "b.txt"), "utf8")).toBe("b");
    expect(await modeOf(copy)).toBe(0o555);
    expect(await modeOf(join(copy, "nested"))).toBe(0o555);
  });

  it("replaces a folder with a read-only one", async () => {
    const source = join(testDir, "src", "module");
    await mkdir(source, { recursive: true });
    await writeFile(join(source, "new.txt"), "new");
    await chmod(source, 0o555);
    await mkdir(join(testDir, "dst", "module"), { recursive: true });
    await writeFile(join(testDir, "dst", "module", "old.txt"), "old");
    const fileSystem: WriteServiceFileSystem = {
      ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      trash: async (path) => rm(path, { recursive: true, force: true }),
    };

    const result = await paste({
      mode: "copy",
      sourcePaths: [source],
      destinationDirectoryPath: join(testDir, "dst"),
      policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      fileSystem,
    });

    // The whole result on failure: it names what went wrong, which the status alone doesn't.
    expect(result.status, JSON.stringify(result, null, 1)).toBe("completed");
    expect(await readdir(join(testDir, "dst"))).toEqual(["module"]);
    expect(await readdir(join(testDir, "dst", "module"))).toEqual(["new.txt"]);
    expect(await modeOf(join(testDir, "dst", "module"))).toBe(0o555);
  });

  it("removes a staged copy even when folders inside it are read-only", async () => {
    const staged = join(testDir, ".module.filetrail-0000");
    await mkdir(join(staged, "inner"), { recursive: true });
    await writeFile(join(staged, "inner", "f.txt"), "f");
    await chmod(join(staged, "inner"), 0o555);
    await chmod(staged, 0o555);

    await removeStagedItem(DEFAULT_WRITE_SERVICE_FILE_SYSTEM, staged);

    expect(await exists(staged)).toBe(false);
  });
});

describe.skipIf(runsAsRoot)("folders that can't be read", () => {
  it("pastes everything else and reports only the unreadable folder", async () => {
    const source = join(testDir, "src", "project");
    await mkdir(join(source, "locked"), { recursive: true });
    await writeFile(join(source, "readme.txt"), "readme");
    await writeFile(join(source, "locked", "secret.txt"), "secret");
    await chmod(join(source, "locked"), 0o000);
    await mkdir(join(testDir, "dst"));

    const result = await paste({
      mode: "copy",
      sourcePaths: [source],
      destinationDirectoryPath: join(testDir, "dst"),
    });

    expect(result.status).toBe("partial");
    expect(await readFile(join(testDir, "dst", "project", "readme.txt"), "utf8")).toBe("readme");
    expect(await exists(join(testDir, "dst", "project", "locked"))).toBe(false);
    const failed = result.items.filter((item) => item.status === "failed");
    expect(failed.map((item) => item.sourcePath)).toContain(join(source, "locked"));
    expect(failed.find((item) => item.sourcePath === join(source, "locked"))?.error).toBe(
      "This folder couldn't be read, so it wasn't copied. You don't have permission to access this item.",
    );
  });

  it("an unreadable folder pasted on its own fails without stopping the others", async () => {
    await mkdir(join(testDir, "src", "locked"), { recursive: true });
    await writeFile(join(testDir, "src", "other.txt"), "other");
    await chmod(join(testDir, "src", "locked"), 0o000);
    await mkdir(join(testDir, "dst"));

    const result = await paste({
      mode: "copy",
      sourcePaths: [join(testDir, "src", "locked"), join(testDir, "src", "other.txt")],
      destinationDirectoryPath: join(testDir, "dst"),
    });

    expect(result.status).toBe("partial");
    expect(await readdir(join(testDir, "dst"))).toEqual(["other.txt"]);
  });
});

describe("Replace journal", () => {
  function recordingJournal() {
    const live = new Map<string, ReplaceJournalEntry>();
    const history: ReplaceJournalEntry[] = [];
    return {
      live,
      history,
      journal: {
        add: async (entry: ReplaceJournalEntry) => {
          live.set(entry.id, entry);
          history.push(entry);
        },
        remove: async (id: string) => {
          live.delete(id);
        },
      },
    };
  }

  it("writes a Replace down before staging it and clears it once swapped in", async () => {
    await mkdir(join(testDir, "src"));
    await mkdir(join(testDir, "dst"));
    await writeFile(join(testDir, "src", "a.txt"), "new");
    await writeFile(join(testDir, "dst", "a.txt"), "old");
    const { live, history, journal } = recordingJournal();
    const fileSystem: WriteServiceFileSystem = {
      ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      trash: async (path) => rm(path),
    };

    const result = await paste({
      mode: "copy",
      sourcePaths: [join(testDir, "src", "a.txt")],
      destinationDirectoryPath: join(testDir, "dst"),
      policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      fileSystem,
      replaceJournal: journal,
    });

    expect(result.status).toBe("completed");
    expect(history.map((entry) => [entry.moved, entry.staged])).toEqual([
      [false, false],
      [false, true],
    ]);
    expect(history[0]?.finalPath).toBe(join(testDir, "dst", "a.txt"));
    expect(live.size).toBe(0);
  });

  it("records a same-volume move as moved before the source leaves its place", async () => {
    await mkdir(join(testDir, "src"));
    await mkdir(join(testDir, "dst"));
    await writeFile(join(testDir, "src", "a.txt"), "new");
    await writeFile(join(testDir, "dst", "a.txt"), "old");
    const { live, history, journal } = recordingJournal();
    const sourceSeenWhenRecorded: boolean[] = [];
    const fileSystem: WriteServiceFileSystem = {
      ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      trash: async (path) => rm(path),
    };

    await paste({
      mode: "cut",
      sourcePaths: [join(testDir, "src", "a.txt")],
      destinationDirectoryPath: join(testDir, "dst"),
      policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      fileSystem,
      replaceJournal: {
        add: async (entry) => {
          sourceSeenWhenRecorded.push(await exists(entry.sourcePath));
          await journal.add(entry);
        },
        remove: journal.remove,
      },
    });

    expect(history.map((entry) => entry.moved)).toEqual([true]);
    expect(sourceSeenWhenRecorded).toEqual([true]);
    expect(live.size).toBe(0);
    expect(await readFile(join(testDir, "dst", "a.txt"), "utf8")).toBe("new");
  });
});

describe("recovering interrupted Replaces", () => {
  function entry(overrides: Partial<ReplaceJournalEntry>): ReplaceJournalEntry {
    return {
      id: "entry-1",
      stagingPath: join(testDir, "dst", ".report.txt.filetrail-1234"),
      finalPath: join(testDir, "dst", "report.txt"),
      sourcePath: join(testDir, "src", "report.txt"),
      moved: false,
      staged: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    await mkdir(join(testDir, "src"));
    await mkdir(join(testDir, "dst"));
  });

  it("finishes a move whose old item already went to the Trash", async () => {
    const interrupted = entry({ moved: true, staged: true });
    await writeFile(interrupted.stagingPath, "moved");

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
    );

    expect(outcome?.outcome).toBe("finished");
    expect(await readFile(interrupted.finalPath, "utf8")).toBe("moved");
    expect(await exists(interrupted.stagingPath)).toBe(false);
  });

  it("touches nothing while another operation writes, and says the entry is put off", async () => {
    const interrupted = entry({ moved: true, staged: true });
    await writeFile(interrupted.stagingPath, "moved");

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      { runWriteAlone: async () => ({ ran: false }) },
    );

    expect(outcome).toEqual({ entry: interrupted, outcome: "deferred" });
    expect(await readFile(interrupted.stagingPath, "utf8")).toBe("moved");
    expect(await exists(interrupted.finalPath)).toBe(false);
  });

  it("makes its changes inside runWriteAlone when it is given", async () => {
    const interrupted = entry({ moved: true, staged: true });
    await writeFile(interrupted.stagingPath, "moved");
    let inside = false;
    let stagingGoneInside = false;

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      {
        runWriteAlone: async (write) => {
          inside = true;
          const value = await write();
          stagingGoneInside = !(await exists(interrupted.stagingPath));
          inside = false;
          return { ran: true, value };
        },
      },
    );

    expect(outcome?.outcome).toBe("finished");
    expect(stagingGoneInside).toBe(true);
    expect(inside).toBe(false);
    expect(await readFile(interrupted.finalPath, "utf8")).toBe("moved");
  });

  it("puts a moved item back when the old item was never removed", async () => {
    const interrupted = entry({ moved: true, staged: true });
    await writeFile(interrupted.stagingPath, "moved");
    await writeFile(interrupted.finalPath, "old");

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
    );

    expect(outcome?.outcome).toBe("restored");
    expect(await readFile(interrupted.sourcePath, "utf8")).toBe("moved");
    expect(await readFile(interrupted.finalPath, "utf8")).toBe("old");
  });

  it("gives a moved item a visible name when both of its places are taken", async () => {
    const interrupted = entry({ moved: true, staged: true });
    await writeFile(interrupted.stagingPath, "moved");
    await writeFile(interrupted.finalPath, "old");
    await writeFile(interrupted.sourcePath, "someone else's");

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
    );

    expect(outcome).toMatchObject({
      outcome: "kept_visible",
      path: join(testDir, "dst", "report copy.txt"),
    });
    expect(await readFile(join(testDir, "dst", "report copy.txt"), "utf8")).toBe("moved");
  });

  it("finishes a complete copy whose old item already went to the Trash", async () => {
    const interrupted = entry({ staged: true });
    await writeFile(interrupted.stagingPath, "copy");
    await writeFile(interrupted.sourcePath, "copy");

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
    );

    expect(outcome?.outcome).toBe("finished");
    expect(await readFile(interrupted.finalPath, "utf8")).toBe("copy");
  });

  it("removes an unfinished copy and leaves the old item alone", async () => {
    const interrupted = entry({
      stagingPath: join(testDir, "dst", ".module.filetrail-1234"),
      finalPath: join(testDir, "dst", "module"),
    });
    await mkdir(join(interrupted.stagingPath, "inner"), { recursive: true });
    await chmod(join(interrupted.stagingPath, "inner"), 0o555);
    await mkdir(interrupted.finalPath);

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
    );

    expect(outcome?.outcome).toBe("removed_copy");
    expect(await readdir(join(testDir, "dst"))).toEqual(["module"]);
  });

  it("removes an unfinished copy even when the old item is gone", async () => {
    const interrupted = entry({ staged: false });
    await writeFile(interrupted.stagingPath, "partial");

    const [outcome] = await recoverInterruptedReplaces(
      [interrupted],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
    );

    expect(outcome?.outcome).toBe("removed_copy");
    expect(await exists(interrupted.finalPath)).toBe(false);
  });

  it("has nothing to do when the Replace had finished", async () => {
    await writeFile(join(testDir, "dst", "report.txt"), "done");

    const [outcome] = await recoverInterruptedReplaces(
      [entry({ moved: true, staged: true })],
      DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
    );

    expect(outcome?.outcome).toBe("nothing_left");
  });

  it("reports an entry it couldn't recover and goes on with the rest", async () => {
    const stuck = entry({ id: "stuck", moved: true, staged: true });
    await writeFile(stuck.stagingPath, "moved");
    const fine = entry({
      id: "fine",
      stagingPath: join(testDir, "dst", ".other.txt.filetrail-1234"),
      finalPath: join(testDir, "dst", "other.txt"),
    });
    const fileSystem: WriteServiceFileSystem = {
      ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
      renameExclusive: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    };

    const outcomes = await recoverInterruptedReplaces([stuck, fine], fileSystem);

    expect(outcomes.map((outcome) => outcome.outcome)).toEqual(["failed", "nothing_left"]);
    expect(outcomes[0]).toMatchObject({
      error: "You don't have permission to access this item.",
    });
  });
});
