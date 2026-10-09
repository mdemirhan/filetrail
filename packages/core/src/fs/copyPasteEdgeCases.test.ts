// Races and failures in the middle of a paste that the plain paths don't reach: items
// appearing or changing while they are written, stops part way, and a Replace whose last
// step fails. On the mock file system, where each can be made to happen at an exact step.

import { vi } from "vitest";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { NO_TRASH_ERROR_CODE, isLocked, lockedMessage } from "./copyPasteErrors";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { captureFolderFingerprint } from "./copyPasteFingerprint";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { recoverInterruptedReplaces } from "./copyPasteRecovery";
import { MockWriteServiceFileSystem } from "./testUtils";
import type {
  CopyPasteMode,
  CopyPasteOperationResult,
  CopyPastePolicy,
  CopyPasteRuntimeConflict,
  CopyPasteRuntimeResolutionAction,
  ReplaceJournalEntry,
} from "./writeServiceTypes";
import { type WriteJournalEntry, isReplaceJournalEntry } from "./writeServiceTypes";

const REPLACE_ALL: CopyPastePolicy = {
  file: "overwrite",
  directory: "overwrite",
  mismatch: "overwrite",
};
const MERGE: CopyPastePolicy = { file: "skip", directory: "merge", mismatch: "skip" };

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
}

function codeError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

function recordingJournal() {
  const live = new Map<string, ReplaceJournalEntry>();
  return {
    live,
    journal: {
      add: async (entry: WriteJournalEntry) => {
        if (isReplaceJournalEntry(entry)) {
          live.set(entry.id, entry);
        }
      },
      remove: async (id: string) => {
        live.delete(id);
      },
    },
  };
}

async function paste(args: {
  fileSystem: MockWriteServiceFileSystem;
  mode?: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath?: string;
  policy?: CopyPastePolicy;
  controller?: AbortController;
  beforeExecute?: () => void;
  resolve?: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
  writeJournal?: ReturnType<typeof recordingJournal>["journal"];
}) {
  const mode = args.mode ?? "copy";
  const policy = args.policy ?? MERGE;
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-edge",
    request: {
      mode,
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath ?? "/target",
    },
    fileSystem: args.fileSystem,
    thresholds: { largeBatchItemThreshold: 1000, largeBatchByteThreshold: 1e9 },
  });
  const resolvedNodes = await resolveAnalysisWithPolicy({
    report,
    policy,
    fileSystem: args.fileSystem,
  });
  args.beforeExecute?.();
  const conflicts: CopyPasteRuntimeConflict[] = [];
  let result: CopyPasteOperationResult | null = null;
  await executeCopyPasteFromAnalysis({
    operationId: "op-edge",
    report,
    mode,
    policy,
    fileSystem: args.fileSystem,
    now: () => new Date("2026-10-03T00:00:00.000Z"),
    signal: (args.controller ?? new AbortController()).signal,
    resolvedNodes,
    ...(args.writeJournal ? { writeJournal: args.writeJournal } : {}),
    emit: (event) => {
      result = event.result ?? result;
    },
    requestResolution: async (conflict) => {
      conflicts.push(conflict);
      return args.resolve?.(conflict) ?? "skip";
    },
  });
  if (!result) {
    throw new Error("The paste reported no result.");
  }
  return { report, result: result as CopyPasteOperationResult, conflicts };
}

function itemFor(result: CopyPasteOperationResult, sourcePath: string) {
  return result.items.find((item) => item.sourcePath === sourcePath);
}

describe("items that keep changing while they are pasted", () => {
  it("leaves an item that changes after every answer, instead of asking forever", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
    });

    const { result, conflicts } = await paste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      beforeExecute: () => fileSystem.mutateNode("/source/a.txt", () => undefined),
      resolve: () => {
        // Changed again before the answer is used.
        fileSystem.mutateNode("/source/a.txt", () => undefined);
        return "overwrite";
      },
    });

    expect(conflicts.length).toBe(5);
    expect(itemFor(result, "/source/a.txt")).toMatchObject({
      status: "failed",
      error: "“a.txt” kept changing, so it was left.",
    });
    expect(fileSystem.exists("/target/a.txt")).toBe(false);
  });

  it("gives up on a name that is taken every time it is written", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
    });
    fileSystem.copyFileImpl = async () => {
      throw codeError("EEXIST");
    };

    const { result } = await paste({ fileSystem, sourcePaths: ["/source/a.txt"] });

    expect(itemFor(result, "/source/a.txt")).toMatchObject({
      status: "failed",
      error: "An item with this name already exists.",
    });
  });

  it("asks about a folder that took its name while it was being copied", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
    });
    fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
      fileSystem.copyFileImpl = null;
      // Another app makes a folder at the name while the copy is built under a hidden one.
      fileSystem.addDirectory("/target/Docs");
      await fileSystem.copyFile(sourcePath, destinationPath);
    };

    const { result, conflicts } = await paste({
      fileSystem,
      sourcePaths: ["/source/Docs"],
      resolve: () => "skip",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["destination_created"]);
    expect(itemFor(result, "/source/Docs")?.status).toBe("skipped");
    expect(fileSystem.exists("/target/Docs/a.txt")).toBe(false);
  });

  it("asks about an item that appeared where a symlink was being made", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/link": { kind: "symlink", target: "/elsewhere" },
      "/target": { kind: "directory" },
    });
    fileSystem.copyFileImpl = async (_source, path) => {
      fileSystem.copyFileImpl = null;
      fileSystem.addFile(path, { size: 3 });
      throw codeError("EEXIST");
    };

    const { result, conflicts } = await paste({
      fileSystem,
      sourcePaths: ["/source/link"],
      resolve: () => "keep_both",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["destination_created"]);
    expect(itemFor(result, "/source/link")).toMatchObject({
      status: "completed",
      destinationPath: "/target/link copy",
    });
    expect(fileSystem.readNode("/target/link")?.kind).toBe("file");
  });

  it("asks before merging into a folder that became a file", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/target/Docs/old.txt": { kind: "file", size: 1 },
    });

    const { result, conflicts } = await paste({
      fileSystem,
      sourcePaths: ["/source/Docs"],
      beforeExecute: () => {
        fileSystem.nodes.delete("/target/Docs/old.txt");
        fileSystem.nodes.delete("/target/Docs");
        fileSystem.addFile("/target/Docs", { size: 9 });
      },
      resolve: () => "skip",
    });

    expect(conflicts).toEqual([
      expect.objectContaining({ reason: "destination_changed", conflictClass: "type_mismatch" }),
    ]);
    expect(itemFor(result, "/source/Docs")?.status).toBe("skipped");
    expect(fileSystem.readNode("/target/Docs")?.kind).toBe("file");
  });
});

describe("stopping part way", () => {
  it("stopped inside a folder being copied, leaves nothing of it", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/source/Docs/b.txt": { kind: "file", size: 1 },
      "/source/Docs/c.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
    });
    const controller = new AbortController();
    fileSystem.copyFileImpl = async (sourcePath, destinationPath, signal) => {
      if (sourcePath.endsWith("b.txt")) {
        controller.abort();
        signal?.throwIfAborted();
      }
      fileSystem.addFile(destinationPath, { size: 1 });
    };

    const { result } = await paste({ fileSystem, sourcePaths: ["/source/Docs"], controller });

    // It was built under a hidden name, which went with the stop.
    expect(result.status).toBe("cancelled");
    expect(await fileSystem.readdir("/target")).toEqual([]);
  });

  it("stopped while building a replacement, leaves the existing item as it was", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/source/Docs/b.txt": { kind: "file", size: 1 },
      "/target/Docs/old.txt": { kind: "file", size: 7 },
    });
    fileSystem.enableTrash();
    const controller = new AbortController();
    fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
      if (sourcePath.endsWith("b.txt")) {
        controller.abort();
        throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
      }
      fileSystem.addFile(destinationPath, { size: 1 });
    };
    const { live, journal } = recordingJournal();

    const { result } = await paste({
      fileSystem,
      sourcePaths: ["/source/Docs"],
      policy: REPLACE_ALL,
      controller,
      writeJournal: journal,
    });

    expect(result.status).toBe("cancelled");
    expect(fileSystem.readNode("/target/Docs/old.txt")?.size).toBe(7);
    expect([...fileSystem.nodes.keys()].filter((path) => path.includes(".filetrail-"))).toEqual([]);
    expect(fileSystem.trashed).toEqual([]);
    expect(live.size).toBe(0);
  });
});

describe("the last step of a Replace", () => {
  function replaceSetup() {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 2 },
      "/target/a.txt": { kind: "file", size: 1 },
    });
    fileSystem.enableTrash();
    return fileSystem;
  }

  it("asks again when something took the name in the moment the old item was gone", async () => {
    const fileSystem = replaceSetup();
    let sneaked = false;
    Object.defineProperty(fileSystem, "renameExclusive", {
      value: async (from: string, to: string) => {
        if (to === "/target/a.txt" && !sneaked) {
          sneaked = true;
          fileSystem.addFile("/target/a.txt", { size: 5 });
          throw codeError("EEXIST");
        }
        if (fileSystem.exists(to)) {
          throw codeError("EEXIST");
        }
        await fileSystem.rename(from, to);
      },
    });

    const { result, conflicts } = await paste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      policy: REPLACE_ALL,
      resolve: () => "keep_both",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["destination_changed"]);
    expect(itemFor(result, "/source/a.txt")).toMatchObject({
      status: "completed",
      destinationPath: "/target/a copy.txt",
    });
    expect(fileSystem.readNode("/target/a.txt")?.size).toBe(5);
  });

  it("leaves the new item to the next start when no name can be given to it", async () => {
    const fileSystem = replaceSetup();
    Object.defineProperty(fileSystem, "renameExclusive", {
      value: async (from: string, to: string) => {
        if (!to.includes(".filetrail-")) {
          throw codeError("EIO");
        }
        await fileSystem.rename(from, to);
      },
    });
    const { live, journal } = recordingJournal();

    const { result } = await paste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      policy: REPLACE_ALL,
      writeJournal: journal,
    });

    expect(itemFor(result, "/source/a.txt")?.error).toBe(
      "The old “a.txt” was moved to the Trash, but the new one couldn't be put in its place. It will be put there the next time File Trail starts. A disk error occurred.",
    );
    // The journal keeps it, so the next start puts it in place.
    expect([...live.values()]).toEqual([expect.objectContaining({ staged: true })]);
  });

  it("refuses to replace with an item locked in a way its owner can't undo", async () => {
    const fileSystem = replaceSetup();
    Object.assign(fileSystem, {
      getFlags: async (path: string) => (path.includes(".filetrail-") ? 0x20000 : 0),
      setFlags: vi.fn(async () => undefined),
    });

    const { result } = await paste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      policy: REPLACE_ALL,
    });

    expect(itemFor(result, "/source/a.txt")?.error).toMatch(/is locked/);
    expect(fileSystem.readNode("/target/a.txt")?.size).toBe(1);
    expect(fileSystem.trashed).toEqual([]);
  });

  it("asks before deleting the old item for good on a disk without a Trash", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 2 },
      "/target/a.txt": { kind: "file", size: 1 },
    });
    fileSystem.enableTrash();
    fileSystem.trashImpl = async () => {
      throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
    };

    const skipped = await paste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      policy: REPLACE_ALL,
      resolve: () => "skip",
    });
    expect(itemFor(skipped.result, "/source/a.txt")?.status).toBe("skipped");
    expect(fileSystem.readNode("/target/a.txt")?.size).toBe(1);

    const replaced = await paste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      policy: REPLACE_ALL,
      resolve: () => "overwrite",
    });
    expect(itemFor(replaced.result, "/source/a.txt")?.status).toBe("completed");
    expect(fileSystem.readNode("/target/a.txt")?.size).toBe(2);
  });
});

describe("a replacing move to another disk", () => {
  it("reports an original it couldn't remove once its copy was in place", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/source/Docs/Inner/b.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory", dev: 2 },
      "/target/Docs/old.txt": { kind: "file", size: 1, dev: 2 },
    });
    fileSystem.enableTrash();
    fileSystem.rmImpl = async (path) => {
      if (path === "/source/Docs/Inner/b.txt") {
        throw codeError("EBUSY");
      }
      for (const key of [...fileSystem.nodes.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
          fileSystem.nodes.delete(key);
        }
      }
    };

    const { result } = await paste({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/Docs"],
      policy: REPLACE_ALL,
    });

    expect(itemFor(result, "/source/Docs/Inner/b.txt")).toMatchObject({
      status: "failed",
      error: "It was copied, but the original couldn't be removed. The item is in use.",
    });
    expect(fileSystem.exists("/target/Docs/Inner/b.txt")).toBe(true);
    expect(fileSystem.exists("/source/Docs/Inner/b.txt")).toBe(true);
    expect(fileSystem.exists("/source/Docs/a.txt")).toBe(false);
  });

  it("names how many items were added to a folder while it was being moved", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory", dev: 2 },
    });

    const { result } = await paste({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/Docs"],
      beforeExecute: () => {
        fileSystem.addFile("/source/Docs/late-1.txt");
        fileSystem.addFile("/source/Docs/late-2.txt");
      },
    });

    expect(itemFor(result, "/source/Docs")?.error).toBe(
      "2 items were added to “Docs” while it was being moved, so they were left in the original “Docs”.",
    );
  });
});

describe("a Replace that would destroy what it pastes", () => {
  // A hard link to the item being pasted took the place of the item to replace: sending
  // it to the Trash would send the item being pasted with it.
  it("refuses to replace an item with itself, even when that became so after the review", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 2, ino: 500 },
      "/target/a.txt": { kind: "file", size: 1 },
    });
    fileSystem.enableTrash();

    const { result } = await paste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      policy: REPLACE_ALL,
      beforeExecute: () => {
        fileSystem.nodes.delete("/target/a.txt");
        fileSystem.addFile("/target/a.txt", { size: 2, ino: 500 });
      },
      resolve: () => "overwrite",
    });

    expect(itemFor(result, "/source/a.txt")).toMatchObject({
      status: "failed",
      error: "“a.txt” is the item being pasted, so it can't replace itself.",
    });
    expect(fileSystem.trashed).toEqual([]);
  });
});

describe("putting right a Replace cut short", () => {
  it("locks the hidden item again when it can't be moved into place", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target/.a.txt.filetrail-00000001": { kind: "file", size: 2 },
    });
    const setFlags = vi.fn(async () => undefined);
    Object.assign(fileSystem, {
      getFlags: async () => 0x2,
      setFlags,
      renameExclusive: async () => {
        throw codeError("EIO");
      },
    });

    const [outcome] = await recoverInterruptedReplaces(
      [
        {
          id: "1",
          stagingPath: "/target/.a.txt.filetrail-00000001",
          finalPath: "/target/a.txt",
          sourcePath: "/source/a.txt",
          moved: false,
          staged: true,
        },
      ],
      fileSystem,
    );

    expect(outcome).toMatchObject({ outcome: "failed", error: "A disk error occurred." });
    expect(setFlags.mock.calls).toEqual([
      ["/target/.a.txt.filetrail-00000001", 0],
      ["/target/.a.txt.filetrail-00000001", 0x2],
    ]);
  });
});

describe("pasting into the top of the disk", () => {
  it("merges a folder into one at the top of the disk", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/Docs/old.txt": { kind: "file", size: 1 },
    });

    const { result } = await paste({
      fileSystem,
      sourcePaths: ["/source/Docs"],
      destinationDirectoryPath: "/",
    });

    expect(result.status).toBe("completed");
    expect(fileSystem.exists("/Docs/a.txt")).toBe(true);
    expect(fileSystem.exists("/Docs/old.txt")).toBe(true);
  });
});

describe("helpers", () => {
  it("sees a symlink to a file, or a broken one, as the link itself", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/a.txt": { kind: "file" },
      "/link-to-file": { kind: "symlink", target: "/a.txt" },
      "/broken": { kind: "symlink", target: "/missing" },
    });

    expect((await captureFolderFingerprint(fileSystem, "/link-to-file")).kind).toBe("symlink");
    expect((await captureFolderFingerprint(fileSystem, "/broken")).kind).toBe("symlink");
  });

  it("treats an item whose flags can't be read as unlocked", async () => {
    expect(
      await isLocked(
        {
          getFlags: async (path) => {
            throw enoent(path);
          },
        },
        "/missing",
      ),
    ).toBe(false);
    expect(await isLocked({}, "/a.txt")).toBe(false);
    expect(lockedMessage("/")).toBe("“/” is locked. Unlock it in Finder's Get Info and try again.");
  });
});
