import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canMountDiskImages, mountTestDiskImage } from "./testDiskImage";
import {
  KEEP_EXISTING,
  REPLACE_ALL,
  nativeFileSystem,
  nativeFileSystemWithTrash,
  runPaste,
} from "./testNativePaste";
import type { ItemId, UndoLog, UndoStep } from "./undoLog";
import type {
  CopyPasteOperationResult,
  CopyPastePolicy,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

// What copying a file costs in lstat calls, one of them the look for Undo once it is made
// (it was 8 when Undo read the file's id on its own).
const LSTATS_PER_COPIED_FILE = 7;

// What a paste records for Undo: one unit per item picked, with the steps it really took,
// or why the paste can't be undone.

// Folders merged, and files inside them replaced.
const MERGE_AND_REPLACE: CopyPastePolicy = {
  file: "overwrite",
  directory: "merge",
  mismatch: "skip",
};

let testDir: string;
let src: string;
let dst: string;
let trashDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-undo-log-"));
  src = join(testDir, "src");
  dst = join(testDir, "dst");
  trashDir = join(testDir, "Trash");
  await mkdir(src);
  await mkdir(dst);
  await mkdir(trashDir);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function idOf(path: string): Promise<ItemId> {
  const stats = await lstat(path);
  return { dev: stats.dev, ino: stats.ino };
}

function undoLogOf(result: CopyPasteOperationResult | null): UndoLog {
  if (!result?.undoLog) {
    throw new Error("The paste recorded nothing for Undo.");
  }
  return result.undoLog;
}

// Counts the calls of each kind the paste makes to `fileSystem`, from `calls.clear()` on.
function countingFileSystem(base: WriteServiceFileSystem): {
  fileSystem: WriteServiceFileSystem;
  calls: Map<string, number>;
} {
  const calls = new Map<string, number>();
  const count = (name: string) => calls.set(name, (calls.get(name) ?? 0) + 1);
  return {
    calls,
    fileSystem: {
      ...base,
      lstat: (path) => {
        count("lstat");
        return base.lstat(path);
      },
      stat: (path) => {
        count("stat");
        return base.stat(path);
      },
    },
  };
}

function stepsOf(log: UndoLog): UndoStep[][] {
  if (!log.undoable) {
    throw new Error(`The paste can't be undone: ${log.reason}`);
  }
  return log.units.map((unit) => unit.steps);
}

describe("what a copy records", () => {
  it("records each item it made, not what is inside a copied folder", async () => {
    await writeFile(join(src, "a.txt"), "a");
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "inside.txt"), "inside");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt"), join(src, "Folder")],
      destinationDirectoryPath: dst,
    });

    const units = stepsOf(undoLogOf(result));
    expect(units).toEqual([
      [
        {
          kind: "created",
          path: join(dst, "a.txt"),
          id: await idOf(join(dst, "a.txt")),
          stamp: expect.objectContaining({ kind: "file", size: 1, entryCount: null }),
        },
      ],
      [
        {
          kind: "created",
          path: join(dst, "Folder"),
          id: await idOf(join(dst, "Folder")),
          stamp: expect.objectContaining({ kind: "directory", size: null, entryCount: 1 }),
        },
      ],
    ]);
    // Taken once the folder was complete, its date included.
    const folder = await lstat(join(dst, "Folder"));
    expect(units[1]?.[0]).toMatchObject({ stamp: { mtimeMs: folder.mtimeMs } });
  });

  // A file's id is read along with how it looks once it is copied.
  it("looks at each file it made once for Undo", async () => {
    const callsFor = async (count: number, into: string) => {
      const names = Array.from({ length: count }, (_, index) => `copy ${count}-${index}.txt`);
      for (const name of names) {
        await writeFile(join(src, name), "a");
      }
      const { fileSystem, calls } = countingFileSystem(nativeFileSystem);
      const { result } = await runPaste({
        mode: "copy",
        sourcePaths: names.map((name) => join(src, name)),
        destinationDirectoryPath: into,
        fileSystem,
        beforeExecute: async () => calls.clear(),
      });
      expect(stepsOf(undoLogOf(result))).toHaveLength(count);
      return calls;
    };
    await mkdir(join(dst, "two"));
    await mkdir(join(dst, "five"));
    const two = await callsFor(2, join(dst, "two"));
    const five = await callsFor(5, join(dst, "five"));

    expect(((five.get("lstat") ?? 0) - (two.get("lstat") ?? 0)) / 3).toBe(LSTATS_PER_COPIED_FILE);
  });

  it("records a duplicate under the name it was given", async () => {
    await writeFile(join(src, "a.txt"), "a");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: src,
    });

    expect(stepsOf(undoLogOf(result))).toEqual([
      [expect.objectContaining({ kind: "created", path: join(src, "a copy.txt") })],
    ]);
  });

  it("records nothing for an item skipped as already there", async () => {
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(src, "b.txt"), "b");
    await writeFile(join(dst, "a.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt"), join(src, "b.txt")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(stepsOf(undoLogOf(result))).toEqual([
      [expect.objectContaining({ kind: "created", path: join(dst, "b.txt") })],
    ]);
  });

  it("records the old item's place in the Trash, then the new item, for a Replace", async () => {
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(dst, "a.txt"), "old");
    const oldId = await idOf(join(dst, "a.txt"));
    const dstId = await idOf(dst);

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trashDir),
    });

    const [unit] = stepsOf(undoLogOf(result));
    expect(unit).toEqual([
      {
        kind: "trashed",
        from: join(dst, "a.txt"),
        trashPath: join(trashDir, "1-a.txt"),
        id: oldId,
        parentId: dstId,
      },
      expect.objectContaining({
        kind: "created",
        path: join(dst, "a.txt"),
        id: await idOf(join(dst, "a.txt")),
      }),
    ]);
    expect(await readFile(join(trashDir, "1-a.txt"), "utf8")).toBe("old");
    // Nothing about the hidden name the new item was built under.
    expect(JSON.stringify(unit)).not.toContain(".filetrail");
  });

  // Found by the Undo fuzz test: "X.TXT" pasted over "x.txt" on a disk that ignores case
  // put the old item back as "X.TXT".
  it("records the old item of a Replace under the name it really had", async () => {
    await writeFile(join(src, "X.TXT"), "new");
    await writeFile(join(dst, "x.txt"), "old");
    const ignoresCase =
      (await readdir(dst)).length === 1 &&
      (await lstat(join(dst, "X.TXT")).catch(() => null)) !== null;
    if (!ignoresCase) {
      return;
    }

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "X.TXT")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trashDir),
    });

    expect(stepsOf(undoLogOf(result))[0]?.[0]).toMatchObject({
      kind: "trashed",
      from: join(dst, "x.txt"),
    });
  });

  it("reads the folder once to tell how the items a Replace removes are spelled", async () => {
    const names = Array.from({ length: 30 }, (_, index) => `file ${index}.txt`);
    for (const name of names) {
      await writeFile(join(src, name), "new");
      await writeFile(join(dst, name), "old");
    }
    const reads: string[] = [];
    const fileSystem = nativeFileSystemWithTrash(trashDir);

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: names.map((name) => join(src, name)),
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      // Counted from the paste on, not during the review.
      beforeExecute: async () => {
        fileSystem.readdir = async (path) => {
          reads.push(path);
          return readdir(path);
        };
      },
      fileSystem,
    });

    expect(reads.filter((path) => path === dst)).toHaveLength(1);
    expect(stepsOf(undoLogOf(result)).map((unit) => unit[0])).toEqual(
      names.map((name) => expect.objectContaining({ kind: "trashed", from: join(dst, name) })),
    );
  });

  it("finds how an item that came after the folder was read is spelled", async () => {
    await writeFile(join(src, "A.TXT"), "new");
    await writeFile(join(src, "B.TXT"), "new");
    await writeFile(join(dst, "a.txt"), "old");
    const ignoresCase = (await lstat(join(dst, "A.TXT")).catch(() => null)) !== null;
    if (!ignoresCase) {
      return;
    }

    const { result, conflicts } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "A.TXT"), join(src, "B.TXT")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trashDir),
      // Once "a.txt" is replaced, "b.txt" appears where "B.TXT" goes; it is replaced too.
      onEvent: (event) => {
        if (event.status === "running" && event.completedItemCount === 1) {
          writeFileSync(join(dst, "b.txt"), "came later");
        }
      },
      resolve: () => "overwrite",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["destination_created"]);
    expect(stepsOf(undoLogOf(result)).map((unit) => unit[0])).toEqual([
      expect.objectContaining({ kind: "trashed", from: join(dst, "a.txt") }),
      expect.objectContaining({ kind: "trashed", from: join(dst, "b.txt") }),
    ]);
  });

  it("records a folder whose copy failed part way, since the folder is there", async () => {
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "a.txt"), "a");
    await writeFile(join(src, "Folder", "b.txt"), "b");
    let calls = 0;

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      fileSystem: {
        ...nativeFileSystem,
        copyFile: async (from, to, signal) => {
          calls += 1;
          if (calls === 2) {
            throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
          }
          await nativeFileSystem.copyFile?.(from, to, signal);
        },
      },
    });

    expect(result?.status).toBe("partial");
    expect(stepsOf(undoLogOf(result))).toEqual([
      [expect.objectContaining({ kind: "created", path: join(dst, "Folder") })],
    ]);
  });

  it("records only what was done before a stop", async () => {
    await writeFile(join(src, "a.txt"), "a");
    await writeFile(join(src, "b.txt"), "b");
    const controller = new AbortController();

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt"), join(src, "b.txt")],
      destinationDirectoryPath: dst,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.status === "running" && event.completedItemCount === 1) {
          controller.abort();
        }
      },
    });

    expect(result?.status).toBe("partial");
    expect(await readdir(dst)).toEqual(["a.txt"]);
    expect(stepsOf(undoLogOf(result))).toEqual([
      [expect.objectContaining({ kind: "created", path: join(dst, "a.txt") })],
    ]);
  });

  it("can't be undone once a folder is merged into one already there", async () => {
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "new.txt"), "new");
    await mkdir(join(dst, "Folder"));
    await writeFile(join(dst, "Folder", "old.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(await readdir(join(dst, "Folder"))).toEqual(["new.txt", "old.txt"]);
    expect(undoLogOf(result)).toEqual({ undoable: false, reason: "merge" });
  });

  it("can't be undone when all a merge did was replace an item in the folder", async () => {
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "a.txt"), "new");
    await mkdir(join(dst, "Folder"));
    await writeFile(join(dst, "Folder", "a.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: MERGE_AND_REPLACE,
      fileSystem: nativeFileSystemWithTrash(trashDir),
    });

    expect(await readFile(join(dst, "Folder", "a.txt"), "utf8")).toBe("new");
    expect(undoLogOf(result)).toEqual({ undoable: false, reason: "merge" });
  });

  it("can't be undone when all a merge did was add a link", async () => {
    await mkdir(join(src, "Folder"));
    await symlink("/nowhere", join(src, "Folder", "link"));
    await mkdir(join(dst, "Folder"));
    await writeFile(join(dst, "Folder", "old.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(await readlink(join(dst, "Folder", "link"))).toBe("/nowhere");
    expect(undoLogOf(result)).toEqual({ undoable: false, reason: "merge" });
  });

  // Nothing was changed, so Undo must still undo what came before.
  it("leaves Undo as it was when a merge finds every item already there", async () => {
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "a.txt"), "new");
    await mkdir(join(dst, "Folder"));
    await writeFile(join(dst, "Folder", "a.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(await readFile(join(dst, "Folder", "a.txt"), "utf8")).toBe("old");
    expect(undoLogOf(result)).toEqual({ undoable: true, units: [] });
  });

  it("can't be undone once a Replace deletes the old item for good", async () => {
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(dst, "a.txt"), "old");

    const { result, conflicts } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: {
        ...nativeFileSystem,
        trash: async () => {
          throw Object.assign(new Error("no Trash"), { code: "ENOTRASH" });
        },
      },
      // Asked whether to delete it for good, the person says yes.
      resolve: () => "overwrite",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["trash_unavailable"]);
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("new");
    expect(undoLogOf(result)).toEqual({ undoable: false, reason: "deleted_for_good" });
  });
});

describe("what a move records", () => {
  it("records where each item came from on its disk, and the folder it was in", async () => {
    await writeFile(join(src, "a.txt"), "a");
    await mkdir(join(src, "Folder"));
    const fileId = await idOf(join(src, "a.txt"));
    const folderId = await idOf(join(src, "Folder"));
    const srcId = await idOf(src);

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "a.txt"), join(src, "Folder")],
      destinationDirectoryPath: dst,
    });

    expect(stepsOf(undoLogOf(result))).toEqual([
      [
        {
          kind: "moved",
          from: join(src, "a.txt"),
          to: join(dst, "a.txt"),
          id: fileId,
          itemKind: "file",
          parentId: srcId,
        },
      ],
      [
        {
          kind: "moved",
          from: join(src, "Folder"),
          to: join(dst, "Folder"),
          id: folderId,
          itemKind: "directory",
          parentId: srcId,
        },
      ],
    ]);
  });

  it("records the old item's place in the Trash, then the move, for a Replace", async () => {
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(dst, "a.txt"), "old");
    const movedId = await idOf(join(src, "a.txt"));

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trashDir),
    });

    expect(stepsOf(undoLogOf(result))).toEqual([
      [
        expect.objectContaining({ kind: "trashed", from: join(dst, "a.txt") }),
        expect.objectContaining({
          kind: "moved",
          from: join(src, "a.txt"),
          to: join(dst, "a.txt"),
          id: movedId,
        }),
      ],
    ]);
  });

  // A move on one disk keeps the item's id: it isn't looked at again where it went, and the
  // folder the items came from is looked at once for all of them.
  it("looks at each moved item twice, and at the folder it was in once", async () => {
    const callsFor = async (count: number, into: string) => {
      const names = Array.from({ length: count }, (_, index) => `move ${count}-${index}.txt`);
      for (const name of names) {
        await writeFile(join(src, name), "a");
      }
      const { fileSystem, calls } = countingFileSystem(nativeFileSystem);
      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: names.map((name) => join(src, name)),
        destinationDirectoryPath: into,
        fileSystem,
        beforeExecute: async () => calls.clear(),
      });
      expect(stepsOf(undoLogOf(result))).toHaveLength(count);
      return calls;
    };
    await mkdir(join(dst, "two"));
    await mkdir(join(dst, "five"));
    const two = await callsFor(2, join(dst, "two"));
    const five = await callsFor(5, join(dst, "five"));

    expect(((five.get("lstat") ?? 0) - (two.get("lstat") ?? 0)) / 3).toBe(2);
    expect(five.get("stat")).toBe(two.get("stat"));
  });

  it("records a moved item that is neither a file, a folder nor a link as such", async () => {
    execFileSync("mkfifo", [join(src, "pipe")]);
    const pipeId = await idOf(join(src, "pipe"));

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "pipe")],
      destinationDirectoryPath: dst,
    });

    expect(stepsOf(undoLogOf(result))).toEqual([
      [expect.objectContaining({ kind: "moved", id: pipeId, itemKind: "other" })],
    ]);
  });

  it("can't be undone once a folder is merged on its own disk, as a merge", async () => {
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "new.txt"), "new");
    await mkdir(join(dst, "Folder"));
    await writeFile(join(dst, "Folder", "old.txt"), "old");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(await readdir(join(dst, "Folder"))).toEqual(["new.txt", "old.txt"]);
    expect(undoLogOf(result)).toEqual({ undoable: false, reason: "merge" });
  });

  it("can't be undone when all a merge on its own disk did was replace an item", async () => {
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "a.txt"), "new");
    await mkdir(join(dst, "Folder"));
    await writeFile(join(dst, "Folder", "a.txt"), "old");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: MERGE_AND_REPLACE,
      fileSystem: nativeFileSystemWithTrash(trashDir),
    });

    expect(await readFile(join(dst, "Folder", "a.txt"), "utf8")).toBe("new");
    expect(undoLogOf(result)).toEqual({ undoable: false, reason: "merge" });
  });

  it("can't be undone once an empty folder merged into another is removed", async () => {
    await mkdir(join(src, "Folder"));
    await mkdir(join(dst, "Folder"));

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(await readdir(src)).toEqual([]);
    expect(undoLogOf(result)).toEqual({ undoable: false, reason: "merge" });
  });

  it("leaves Undo as it was when a merging move finds every item already there", async () => {
    await mkdir(join(src, "Folder"));
    await writeFile(join(src, "Folder", "a.txt"), "new");
    await mkdir(join(dst, "Folder"));
    await writeFile(join(dst, "Folder", "a.txt"), "old");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Folder")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(await readFile(join(src, "Folder", "a.txt"), "utf8")).toBe("new");
    expect(undoLogOf(result)).toEqual({ undoable: true, units: [] });
  });

  it.runIf(canMountDiskImages)(
    "can't be undone when it went to another disk",
    async () => {
      const volume = mountTestDiskImage({ sizeMb: 20 });
      try {
        await writeFile(join(src, "a.txt"), "a");

        const { result } = await runPaste({
          mode: "cut",
          sourcePaths: [join(src, "a.txt")],
          destinationDirectoryPath: volume.mountPath,
        });

        expect(await readFile(join(volume.mountPath, "a.txt"), "utf8")).toBe("a");
        expect(undoLogOf(result)).toEqual({ undoable: false, reason: "other_disk_move" });
      } finally {
        volume.detach();
      }
    },
    30_000,
  );

  describe.runIf(canMountDiskImages)("to another disk, when nothing was changed", () => {
    let volume: ReturnType<typeof mountTestDiskImage>;

    beforeEach(() => {
      volume = mountTestDiskImage({ sizeMb: 20 });
    });

    afterEach(() => {
      volume.detach();
    });

    function failingCopy(error: Error): WriteServiceFileSystem {
      return {
        ...nativeFileSystemWithTrash(trashDir),
        copyFile: async () => {
          throw error;
        },
      };
    }

    it("leaves Undo as it was when the item can't be read", async () => {
      await writeFile(join(src, "a.txt"), "a");

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "a.txt")],
        destinationDirectoryPath: volume.mountPath,
        fileSystem: failingCopy(
          Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
        ),
      });

      expect(result?.status).toBe("failed");
      expect(await readdir(volume.mountPath)).not.toContain("a.txt");
      expect(undoLogOf(result)).toEqual({ undoable: true, units: [] });
    });

    it("leaves Undo as it was when stopped before anything was written", async () => {
      await writeFile(join(src, "a.txt"), "a");
      const controller = new AbortController();

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "a.txt")],
        destinationDirectoryPath: volume.mountPath,
        signal: controller.signal,
        fileSystem: {
          ...nativeFileSystem,
          copyFile: async () => {
            controller.abort();
            throw controller.signal.reason;
          },
        },
      });

      expect(result?.status).toBe("cancelled");
      expect(await readFile(join(src, "a.txt"), "utf8")).toBe("a");
      expect(undoLogOf(result)).toEqual({ undoable: true, units: [] });
    });

    it("leaves Undo as it was when a Replace couldn't copy the new item", async () => {
      await writeFile(join(src, "a.txt"), "new");
      await writeFile(join(volume.mountPath, "a.txt"), "old");

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "a.txt")],
        destinationDirectoryPath: volume.mountPath,
        policy: REPLACE_ALL,
        fileSystem: failingCopy(Object.assign(new Error("EIO: i/o error"), { code: "EIO" })),
      });

      expect(result?.status).toBe("failed");
      expect(await readFile(join(volume.mountPath, "a.txt"), "utf8")).toBe("old");
      expect(await readdir(trashDir)).toEqual([]);
      expect(undoLogOf(result)).toEqual({ undoable: true, units: [] });
    });

    // The folder is made on the other disk before anything is copied into it.
    it("can't be undone when stopped just after making the folder there", async () => {
      await mkdir(join(src, "Folder"));
      await writeFile(join(src, "Folder", "a.txt"), "a");
      const controller = new AbortController();

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "Folder")],
        destinationDirectoryPath: volume.mountPath,
        signal: controller.signal,
        fileSystem: {
          ...nativeFileSystem,
          mkdir: async (path, options) => {
            await nativeFileSystem.mkdir(path, options);
            if (path.startsWith(volume.mountPath)) {
              controller.abort();
            }
          },
        },
      });

      expect(result?.status).toBe("cancelled");
      expect(await readFile(join(src, "Folder", "a.txt"), "utf8")).toBe("a");
      expect(undoLogOf(result)).toEqual({ undoable: false, reason: "other_disk_move" });
    });

    it("can't be undone once a Replace put the new item in place", async () => {
      await writeFile(join(src, "a.txt"), "new");
      await writeFile(join(volume.mountPath, "a.txt"), "old");
      // The disk's own Trash: an item can't be renamed into a folder on another disk.
      const volumeTrash = join(volume.mountPath, ".Trash");
      await mkdir(volumeTrash);

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "a.txt")],
        destinationDirectoryPath: volume.mountPath,
        policy: REPLACE_ALL,
        fileSystem: nativeFileSystemWithTrash(volumeTrash),
      });

      expect(await readFile(join(volume.mountPath, "a.txt"), "utf8")).toBe("new");
      expect(undoLogOf(result)).toEqual({ undoable: false, reason: "other_disk_move" });
    });
  });
});
