import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import {
  type CopyPastePolicy,
  type CopyPasteProgressEvent,
  type CopyPasteRuntimeConflict,
  type CopyPasteRuntimeResolutionAction,
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  type WriteServiceFileSystem,
} from "./writeServiceTypes";

let testDir: string;
let trashDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-conflict-safety-"));
  trashDir = join(testDir, ".trash");
  await mkdir(trashDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

const REPLACE_ALL: CopyPastePolicy = {
  file: "overwrite",
  directory: "overwrite",
  mismatch: "overwrite",
};

// A Trash that keeps what was moved into it, for checking what a replace removed.
const fileSystemWithTrash: WriteServiceFileSystem = {
  ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  trash: async (path) => {
    await rename(path, join(trashDir, basename(path)));
  },
};

async function paste(args: {
  mode: "copy" | "cut";
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy: CopyPastePolicy;
  fileSystem?: WriteServiceFileSystem;
  beforeExecute?: () => Promise<void>;
  resolve?: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
  onEvent?: (event: CopyPasteProgressEvent, controller: AbortController) => void;
}) {
  const fileSystem = args.fileSystem ?? fileSystemWithTrash;
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-safety",
    request: {
      mode: args.mode,
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath,
    },
    fileSystem,
    thresholds: { largeBatchItemThreshold: 1000, largeBatchByteThreshold: 1e9 },
  });
  const resolvedNodes = await resolveAnalysisWithPolicy({
    report,
    policy: args.policy,
    fileSystem,
  });
  await args.beforeExecute?.();
  const events: CopyPasteProgressEvent[] = [];
  const conflicts: CopyPasteRuntimeConflict[] = [];
  const controller = new AbortController();
  await executeCopyPasteFromAnalysis({
    operationId: "op-safety",
    report,
    mode: args.mode,
    policy: args.policy,
    fileSystem,
    now: () => new Date("2026-09-29T00:00:00.000Z"),
    signal: controller.signal,
    resolvedNodes,
    emit: (event) => {
      events.push(event);
      args.onEvent?.(event, controller);
    },
    requestResolution: async (conflict) => {
      conflicts.push(conflict);
      return args.resolve?.(conflict) ?? null;
    },
  });
  return { report, result: events.at(-1)?.result ?? null, conflicts };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("copy/paste conflict safety (real filesystem)", () => {
  it.each(["copy", "cut"] as const)(
    "refuses to replace a folder that contains the item being pasted (%s)",
    async (mode) => {
      // Flattening "foo/foo" into its parent must never delete either copy.
      const outer = join(testDir, "foo");
      await mkdir(join(outer, "foo"), { recursive: true });
      await writeFile(join(outer, "outer.txt"), "outer");
      await writeFile(join(outer, "foo", "a.txt"), "important");

      const { result } = await paste({
        mode,
        sourcePaths: [join(outer, "foo")],
        destinationDirectoryPath: testDir,
        policy: REPLACE_ALL,
      });

      expect(result?.items[0]).toMatchObject({
        status: "failed",
        error: "Can't replace “foo” because it contains the item being pasted.",
      });
      expect(await readFile(join(outer, "outer.txt"), "utf8")).toBe("outer");
      expect(await readFile(join(outer, "foo", "a.txt"), "utf8")).toBe("important");
      expect(await readdir(trashDir)).toEqual([]);
    },
  );

  it("refuses to replace a folder with a file it contains", async () => {
    const outer = join(testDir, "foo");
    await mkdir(outer);
    await writeFile(join(outer, "foo"), "inner file");
    await writeFile(join(outer, "keep.txt"), "keep");

    const { result } = await paste({
      mode: "copy",
      sourcePaths: [join(outer, "foo")],
      destinationDirectoryPath: testDir,
      policy: REPLACE_ALL,
    });

    expect(result?.items[0]?.status).toBe("failed");
    expect(await readFile(join(outer, "foo"), "utf8")).toBe("inner file");
    expect(await readFile(join(outer, "keep.txt"), "utf8")).toBe("keep");
  });

  it("treats a destination reached through a symlinked folder as the source folder", async () => {
    // "alias/docs" is "real/docs" reached through a symlinked parent folder.
    const real = join(testDir, "real", "docs");
    await mkdir(real, { recursive: true });
    await writeFile(join(real, "a.txt"), "original");
    await symlink(join(testDir, "real"), join(testDir, "alias"));

    const copied = await paste({
      mode: "copy",
      sourcePaths: [join(real, "a.txt")],
      destinationDirectoryPath: join(testDir, "alias", "docs"),
      policy: REPLACE_ALL,
    });
    // Same folder: the copy gets a new name instead of replacing the original.
    expect(copied.report.issues).toEqual([]);
    expect(copied.result?.status).toBe("completed");
    expect(await readFile(join(real, "a.txt"), "utf8")).toBe("original");
    expect(await readFile(join(real, "a copy.txt"), "utf8")).toBe("original");

    const moved = await paste({
      mode: "cut",
      sourcePaths: [join(real, "a.txt")],
      destinationDirectoryPath: join(testDir, "alias", "docs"),
      policy: REPLACE_ALL,
    });
    expect(moved.report.issues.map((issue) => issue.code)).toEqual(["same_path"]);
    expect(await readFile(join(real, "a.txt"), "utf8")).toBe("original");
  });

  it("moves replaced items to the Trash instead of deleting them", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(join(source, "photos"), { recursive: true });
    await mkdir(join(target, "photos"), { recursive: true });
    await writeFile(join(source, "notes.txt"), "new notes");
    await writeFile(join(target, "notes.txt"), "old notes");
    await writeFile(join(source, "photos", "a.jpg"), "new a");
    await writeFile(join(target, "photos", "d.jpg"), "only here");

    const { result } = await paste({
      mode: "copy",
      sourcePaths: [join(source, "notes.txt"), join(source, "photos")],
      destinationDirectoryPath: target,
      policy: REPLACE_ALL,
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(target, "notes.txt"), "utf8")).toBe("new notes");
    expect(await exists(join(target, "photos", "d.jpg"))).toBe(false);
    expect(await readFile(join(trashDir, "notes.txt"), "utf8")).toBe("old notes");
    expect(await readFile(join(trashDir, "photos", "d.jpg"), "utf8")).toBe("only here");
  });

  it("moves an item replaced by a same-disk move to the Trash too", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "notes.txt"), "new notes");
    await writeFile(join(target, "notes.txt"), "old notes");

    const { result } = await paste({
      mode: "cut",
      sourcePaths: [join(source, "notes.txt")],
      destinationDirectoryPath: target,
      policy: REPLACE_ALL,
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(target, "notes.txt"), "utf8")).toBe("new notes");
    expect(await readFile(join(trashDir, "notes.txt"), "utf8")).toBe("old notes");
    expect(await exists(join(source, "notes.txt"))).toBe(false);
  });

  it("keeps the existing item when it can't be moved to the Trash", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "notes.txt"), "new notes");
    await writeFile(join(target, "notes.txt"), "old notes");

    const { result } = await paste({
      mode: "copy",
      sourcePaths: [join(source, "notes.txt")],
      destinationDirectoryPath: target,
      policy: REPLACE_ALL,
      fileSystem: {
        ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
        trash: async () => {
          throw new Error("no Trash on this volume");
        },
      },
    });

    expect(result?.items[0]).toMatchObject({
      status: "failed",
      error: "Couldn't move the existing “notes.txt” to the Trash: no Trash on this volume",
    });
    expect(await readFile(join(target, "notes.txt"), "utf8")).toBe("old notes");
  });

  it("asks again when an item to be replaced changed after review", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "x"), "pasted");
    await writeFile(join(target, "x"), "reviewed file");

    const { result, conflicts } = await paste({
      mode: "copy",
      sourcePaths: [join(source, "x")],
      destinationDirectoryPath: target,
      policy: REPLACE_ALL,
      // Between review and paste, "x" became a folder with new work in it.
      beforeExecute: async () => {
        await rm(join(target, "x"));
        await mkdir(join(target, "x"));
        await writeFile(join(target, "x", "important.doc"), "new work");
      },
      resolve: () => "skip",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["destination_changed"]);
    expect(result?.items[0]?.status).toBe("skipped");
    expect(await readFile(join(target, "x", "important.doc"), "utf8")).toBe("new work");
  });

  it("copies without asking when an item to be replaced is already gone", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "x.txt"), "pasted");
    await writeFile(join(target, "x.txt"), "old");

    const { result, conflicts } = await paste({
      mode: "copy",
      sourcePaths: [join(source, "x.txt")],
      destinationDirectoryPath: target,
      policy: REPLACE_ALL,
      beforeExecute: () => rm(join(target, "x.txt")),
    });

    expect(conflicts).toEqual([]);
    expect(result?.status).toBe("completed");
    expect(await readFile(join(target, "x.txt"), "utf8")).toBe("pasted");
  });

  it("keeps going after an item fails and reports every item", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "a.txt"), "a");
    await writeFile(join(source, "b.txt"), "b");
    await writeFile(join(source, "c.txt"), "c");
    await chmod(join(source, "b.txt"), 0o000);

    try {
      const { result } = await paste({
        mode: "copy",
        sourcePaths: ["a.txt", "b.txt", "c.txt"].map((name) => join(source, name)),
        destinationDirectoryPath: target,
        policy: REPLACE_ALL,
      });

      expect(result?.status).toBe("partial");
      expect(result?.items.map((item) => [basename(item.sourcePath), item.status])).toEqual([
        ["a.txt", "completed"],
        ["b.txt", "failed"],
        ["c.txt", "completed"],
      ]);
      expect(result?.items[1]?.error).toBe("You don't have permission to access this item.");
      // The failed copy leaves nothing half-written behind.
      expect(await exists(join(target, "b.txt"))).toBe(false);
      expect(await readFile(join(target, "c.txt"), "utf8")).toBe("c");
    } finally {
      await chmod(join(source, "b.txt"), 0o644);
    }
  });

  it("keeps going inside a folder after one of its items fails", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(join(source, "docs"), { recursive: true });
    await mkdir(target);
    await writeFile(join(source, "docs", "a.txt"), "a");
    await writeFile(join(source, "docs", "b.txt"), "b");
    await chmod(join(source, "docs", "a.txt"), 0o000);

    try {
      const { result } = await paste({
        mode: "copy",
        sourcePaths: [join(source, "docs")],
        destinationDirectoryPath: target,
        policy: REPLACE_ALL,
      });

      expect(result?.items[0]?.status).toBe("failed");
      expect(
        result?.items.filter((item) => item.status === "failed").map((item) => item.sourcePath),
      ).toContain(join(source, "docs", "a.txt"));
      expect(await readFile(join(target, "docs", "b.txt"), "utf8")).toBe("b");
    } finally {
      await chmod(join(source, "docs", "a.txt"), 0o644);
    }
  });

  it("reports items that were never started when the paste is stopped", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await writeFile(join(source, name), name);
    }

    const { result } = await paste({
      mode: "copy",
      sourcePaths: ["a.txt", "b.txt", "c.txt"].map((name) => join(source, name)),
      destinationDirectoryPath: target,
      policy: REPLACE_ALL,
      onEvent: (event, controller) => {
        if (event.status === "running" && event.currentSourcePath?.endsWith("a.txt")) {
          controller.abort();
        }
      },
    });

    expect(result?.status).toBe("partial");
    expect(result?.items.map((item) => [basename(item.sourcePath), item.status])).toEqual([
      ["a.txt", "completed"],
      ["b.txt", "cancelled"],
      ["c.txt", "cancelled"],
    ]);
    expect(result?.items[2]?.error).toBe("Not started because the operation was stopped.");
  });

  it("merges into a folder that appeared during the paste using the chosen policy", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(join(source, "D"), { recursive: true });
    await mkdir(join(target, "D"), { recursive: true });
    await writeFile(join(source, "D", "c.txt"), "new c");
    await writeFile(join(target, "D", "c.txt"), "old c");

    const { result, conflicts } = await paste({
      mode: "copy",
      sourcePaths: [join(source, "D")],
      destinationDirectoryPath: target,
      policy: { file: "keep_both", directory: "keep_both", mismatch: "skip" },
      // "D copy" appears before the paste creates it; merging into it must still honor
      // the file policy for the nested conflict.
      beforeExecute: async () => {
        await mkdir(join(target, "D copy"));
        await writeFile(join(target, "D copy", "c.txt"), "someone else's c");
      },
      resolve: (conflict) => (conflict.reason === "destination_created" ? "merge" : "keep_both"),
    });

    expect(conflicts[0]?.reason).toBe("destination_created");
    expect(result?.status).not.toBe("failed");
    expect(await readFile(join(target, "D copy", "c.txt"), "utf8")).toBe("someone else's c");
    expect(await readFile(join(target, "D copy", "c copy.txt"), "utf8")).toBe("new c");
  });

  it("gives a Keep Both copy a name no other pasted item uses", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    await writeFile(join(source, "a.txt"), "pasted a");
    await writeFile(join(source, "a copy.txt"), "pasted a copy");
    await writeFile(join(target, "a.txt"), "existing a");

    const { result, conflicts } = await paste({
      mode: "copy",
      sourcePaths: [join(source, "a.txt"), join(source, "a copy.txt")],
      destinationDirectoryPath: target,
      policy: { file: "keep_both", directory: "merge", mismatch: "skip" },
    });

    expect(conflicts).toEqual([]);
    expect(result?.status).toBe("completed");
    expect(await readFile(join(target, "a copy 2.txt"), "utf8")).toBe("pasted a");
    expect(await readFile(join(target, "a copy.txt"), "utf8")).toBe("pasted a copy");
  });

  it("shortens a Keep Both name that would be longer than the file system allows", async () => {
    const source = join(testDir, "source");
    const target = join(testDir, "target");
    await mkdir(source);
    await mkdir(target);
    const longName = `${"n".repeat(246)}.txt`;
    await writeFile(join(source, longName), "pasted");
    await writeFile(join(target, longName), "existing");

    const { result } = await paste({
      mode: "copy",
      sourcePaths: [join(source, longName)],
      destinationDirectoryPath: target,
      policy: { file: "keep_both", directory: "merge", mismatch: "skip" },
    });

    expect(result?.status).toBe("completed");
    const copyName = (await readdir(target)).find((name) => name !== longName) ?? "";
    expect(Buffer.byteLength(copyName)).toBeLessThanOrEqual(255);
    expect(copyName.endsWith(" copy.txt")).toBe(true);
  });
});
