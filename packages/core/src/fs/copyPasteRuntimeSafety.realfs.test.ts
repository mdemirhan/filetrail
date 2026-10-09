// What a paste does when the items it is about relate to each other, or change between the
// review and the paste, on the real disk.

import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  buildCopyPasteAnalysisReport,
  normalizeCopyPasteAnalysisRequest,
} from "./copyPasteAnalysis";
import { NO_TRASH_ERROR_CODE } from "./copyPasteErrors";
import { JOURNALED_FILE_BYTES } from "./copyPasteExecution";
import {
  KEEP_EXISTING,
  REPLACE_ALL,
  nativeFileSystem,
  nativeFileSystemWithTrash,
  runPaste,
} from "./testNativePaste";
import {
  type ReplaceJournalEntry,
  type WriteJournalEntry,
  type WriteServiceFileSystem,
  isReplaceJournalEntry,
} from "./writeServiceTypes";

// As on a move to another disk: no rename, so items are copied and the originals removed.
function withoutRenameAtAll(): WriteServiceFileSystem {
  const { rename: _rename, ...rest } = nativeFileSystem;
  return rest;
}

function idOf(path: string) {
  const stats = lstatSync(path);
  return { dev: stats.dev, ino: stats.ino };
}

// The start of an AppleDouble file (its magic number and version).
const APPLE_DOUBLE_DATA = Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00]);

let testDir: string;
let src: string;
let dst: string;
let trash: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-runtime-safety-"));
  src = join(testDir, "src");
  dst = join(testDir, "dst");
  trash = join(testDir, "trash");
  await mkdir(src);
  await mkdir(dst);
  await mkdir(trash);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("Replace never destroys another item of the same paste", () => {
  // Cutting "src/a" and "dst/a/keep.txt" into "dst": replacing "dst/a" would send
  // "keep.txt" to the Trash inside it.
  it("is blocked in the review for a folder holding another item being pasted", async () => {
    await mkdir(join(src, "a"));
    await writeFile(join(src, "a", "new.txt"), "new");
    await mkdir(join(dst, "a"));
    await writeFile(join(dst, "a", "keep.txt"), "keep");

    const { report } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "a"), join(dst, "a", "keep.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
    });

    expect(report.nodes[0]?.replaceBlockedReason).toBe("It contains another item being pasted.");
  });

  // As the review shows it: Replace for all merges a folder it can't replace.
  it("merges the folder instead when Replace is chosen for all, and keeps every item", async () => {
    await mkdir(join(src, "a"));
    await writeFile(join(src, "a", "new.txt"), "new");
    await mkdir(join(dst, "a"));
    await writeFile(join(dst, "a", "keep.txt"), "keep");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "a"), join(dst, "a", "keep.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
    });

    expect(result?.status).toBe("completed");
    expect(await readdir(trash)).toEqual([]);
    expect(await readFile(join(dst, "keep.txt"), "utf8")).toBe("keep");
    expect(await readFile(join(dst, "a", "new.txt"), "utf8")).toBe("new");
    expect(result?.replacedPaths).toBeUndefined();
  });

  // Planned as a merge (the review saw the other item in it), so nothing goes to the Trash
  // even though the other item has left it by then.
  it("merges the folder once the other item has been moved out of it first", async () => {
    await mkdir(join(src, "a"));
    await writeFile(join(src, "a", "new.txt"), "new");
    await mkdir(join(dst, "a"));
    await writeFile(join(dst, "a", "keep.txt"), "keep");

    const { result } = await runPaste({
      mode: "cut",
      // keep.txt goes first, so by the time "a" is replaced it is safe.
      sourcePaths: [join(dst, "a", "keep.txt"), join(src, "a")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
      resolve: () => "overwrite",
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "keep.txt"), "utf8")).toBe("keep");
    expect(await readdir(join(dst, "a"))).toEqual(["new.txt"]);
    expect(await readdir(trash)).toEqual([]);
  });
});

describe("an item that changed after the review", () => {
  // Answering "use the changed file" is about the file being pasted; an item that
  // appeared at the destination meanwhile is asked about on its own.
  it("asks about the destination too when both sides changed", async () => {
    await writeFile(join(src, "notes.txt"), "draft");

    const { conflicts, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "notes.txt")],
      destinationDirectoryPath: dst,
      fileSystem: nativeFileSystemWithTrash(trash),
      beforeExecute: async () => {
        await writeFile(join(src, "notes.txt"), "final draft");
        await writeFile(join(dst, "notes.txt"), "someone else's notes");
      },
      resolve: (conflict) => (conflict.reason === "source_changed" ? "overwrite" : "keep_both"),
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual([
      "source_changed",
      "destination_created",
    ]);
    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "notes.txt"), "utf8")).toBe("someone else's notes");
    expect(await readFile(join(dst, "notes copy.txt"), "utf8")).toBe("final draft");
    expect(await readdir(trash)).toEqual([]);
  });

  it("asks once when only the item being pasted changed", async () => {
    await writeFile(join(src, "notes.txt"), "draft");

    const { conflicts, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "notes.txt")],
      destinationDirectoryPath: dst,
      beforeExecute: async () => {
        await writeFile(join(src, "notes.txt"), "final draft");
        await utimes(join(src, "notes.txt"), new Date(2020, 1, 1), new Date(2020, 1, 1));
      },
      resolve: () => "overwrite",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["source_changed"]);
    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "notes.txt"), "utf8")).toBe("final draft");
  });
});

describe("the swap at the end of a Replace", () => {
  // The old item is in the Trash by then; the new one must never be thrown away too.
  it("keeps the new item under a visible name when it can't take the old one's name", async () => {
    await writeFile(join(src, "f.txt"), "new");
    await writeFile(join(dst, "f.txt"), "old");
    const journal: ReplaceJournalEntry[] = [];
    const fileSystem = {
      ...nativeFileSystemWithTrash(trash),
      renameExclusive: async (from: string, to: string) => {
        if (to === join(dst, "f.txt")) {
          throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
        }
        await nativeFileSystem.renameExclusive?.(from, to);
      },
    };

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "f.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem,
      writeJournal: {
        add: async (entry) => {
          if (isReplaceJournalEntry(entry)) {
            journal.splice(0, journal.length, entry);
          }
        },
        remove: async () => {
          journal.splice(0);
        },
      },
    });

    expect(result?.items[0]).toMatchObject({
      status: "failed",
      destinationPath: join(dst, "f copy.txt"),
    });
    expect(result?.items[0]?.error).toContain(
      "The old “f.txt” was moved to the Trash, but the new one couldn't take its name, so it was saved as “f copy.txt”.",
    );
    expect(await readdir(dst)).toEqual(["f copy.txt"]);
    expect(await readFile(join(dst, "f copy.txt"), "utf8")).toBe("new");
    expect(journal).toEqual([]);
  });
});

describe("folders reached through a symlink", () => {
  it("pastes into a symlink to a folder as into that folder", async () => {
    await writeFile(join(src, "a.txt"), "a");
    await symlink(dst, join(testDir, "Shortcut to dst"));

    const { report, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: join(testDir, "Shortcut to dst"),
    });

    expect(report.issues).toEqual([]);
    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("a");
  });

  // "L/a.txt" where L links to dst is "dst/a.txt": copying it into dst duplicates it.
  it("duplicates an item copied into its own folder through a symlink", async () => {
    await writeFile(join(dst, "a.txt"), "a");
    await symlink(dst, join(testDir, "L"));

    const { report, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(testDir, "L", "a.txt")],
      destinationDirectoryPath: dst,
    });

    expect(report.issues).toEqual([]);
    expect(result?.status).toBe("completed");
    expect((await readdir(dst)).sort()).toEqual(["a copy.txt", "a.txt"]);
  });
});

describe("duplicating several items", () => {
  it("names each copy apart when one item's copy name is another item's name", async () => {
    await writeFile(join(dst, "a.txt"), "a");
    await writeFile(join(dst, "a copy.txt"), "a copy");

    const { report, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(dst, "a.txt"), join(dst, "a copy.txt")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(report.issues).toEqual([]);
    expect(result?.status).toBe("completed");
    expect((await readdir(dst)).sort()).toEqual([
      "a copy 2.txt",
      "a copy 3.txt",
      "a copy.txt",
      "a.txt",
    ]);
    expect(await readFile(join(dst, "a copy 2.txt"), "utf8")).toBe("a");
    expect(await readFile(join(dst, "a copy 3.txt"), "utf8")).toBe("a copy");
  });
});

// The person is asked when the item being pasted changed after the review; going on must
// paste what is there now, not what the review saw.
describe("going on after the item being pasted changed", () => {
  const { rename: _rename, ...withoutRename } = nativeFileSystem;

  async function becomePackage(path: string, files: Record<string, string>) {
    await rm(path, { recursive: true, force: true });
    await mkdir(path);
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(path, name), content);
    }
  }

  it("copies a file that became a package as the whole package", async () => {
    await writeFile(join(src, "Doc.key"), "flat");

    const { conflicts, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Doc.key")],
      destinationDirectoryPath: dst,
      beforeExecute: () => becomePackage(join(src, "Doc.key"), { "Index.zip": "index" }),
      resolve: () => "overwrite",
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["source_changed"]);
    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "Doc.key", "Index.zip"), "utf8")).toBe("index");
  });

  it("replaces with the whole package, never with an empty folder", async () => {
    await writeFile(join(src, "Doc.key"), "flat");
    await writeFile(join(dst, "Doc.key"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Doc.key")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
      beforeExecute: () => becomePackage(join(src, "Doc.key"), { "Index.zip": "index" }),
      resolve: () => "overwrite",
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "Doc.key", "Index.zip"), "utf8")).toBe("index");
    expect(await readdir(trash)).toEqual(["1-Doc.key"]);
  });

  // Keynote and Pages save a package as a new folder that takes the old one's name.
  it("copies a package saved anew with the files it has now", async () => {
    await becomePackage(join(src, "Photos.key"), { "a.jpg": "a" });

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Photos.key")],
      destinationDirectoryPath: dst,
      beforeExecute: async () => {
        await mkdir(join(src, "saving"));
        await writeFile(join(src, "saving", "a.jpg"), "a");
        await writeFile(join(src, "saving", "b.jpg"), "b");
        await rm(join(src, "Photos.key"), { recursive: true });
        await rename(join(src, "saving"), join(src, "Photos.key"));
      },
      resolve: () => "overwrite",
    });

    expect(result?.status).toBe("completed");
    expect((await readdir(join(dst, "Photos.key"))).sort()).toEqual(["a.jpg", "b.jpg"]);
  });

  it("moves a file that became a folder to another place as the whole folder", async () => {
    await writeFile(join(src, "Doc.key"), "flat");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Doc.key")],
      destinationDirectoryPath: dst,
      // As to another disk: copied, then the original removed.
      fileSystem: withoutRename,
      beforeExecute: () => becomePackage(join(src, "Doc.key"), { "Index.zip": "index" }),
      resolve: () => "overwrite",
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "Doc.key", "Index.zip"), "utf8")).toBe("index");
    expect(await readdir(src)).toEqual([]);
  });

  it("copies a folder that became a file as the file", async () => {
    await mkdir(join(src, "notes"));
    await writeFile(join(src, "notes", "a.txt"), "a");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "notes")],
      destinationDirectoryPath: dst,
      beforeExecute: async () => {
        await rm(join(src, "notes"), { recursive: true });
        await writeFile(join(src, "notes"), "now a file");
      },
      resolve: () => "overwrite",
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "notes"), "utf8")).toBe("now a file");
  });

  it("copies a symlink that became a file as the file", async () => {
    await writeFile(join(src, "target.txt"), "target");
    await symlink(join(src, "target.txt"), join(src, "link"));

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "link")],
      destinationDirectoryPath: dst,
      beforeExecute: async () => {
        await rm(join(src, "link"));
        await writeFile(join(src, "link"), "a file now");
      },
      resolve: () => "overwrite",
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "link"), "utf8")).toBe("a file now");
  });

  it("leaves an item that is no longer a folder when the answer was Merge", async () => {
    await mkdir(join(src, "notes"));
    await mkdir(join(dst, "notes"));

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "notes")],
      destinationDirectoryPath: dst,
      beforeExecute: async () => {
        await rm(join(src, "notes"), { recursive: true });
        await writeFile(join(src, "notes"), "a file now");
      },
      resolve: () => "merge",
    });

    expect(result?.status).toBe("failed");
    expect(result?.items[0]?.error).toBe(
      "“notes” is no longer a folder, so it can't be merged and was left.",
    );
    expect(await readdir(join(dst, "notes"))).toEqual([]);
  });

  // An item the review saw at the destination and that changed there since is still
  // asked about, even inside a folder that was read again.
  it("still asks before replacing an item inside it that changed at the destination", async () => {
    await mkdir(join(src, "Project"));
    await writeFile(join(src, "Project", "a.txt"), "new a");
    await mkdir(join(dst, "Project"));
    await writeFile(join(dst, "Project", "a.txt"), "old a");

    const { conflicts } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Project")],
      destinationDirectoryPath: dst,
      policy: { file: "overwrite", directory: "merge", mismatch: "skip" },
      beforeExecute: async () => {
        await mkdir(join(src, "saving"));
        await writeFile(join(src, "saving", "a.txt"), "newer a");
        await rm(join(src, "Project"), { recursive: true });
        await rename(join(src, "saving"), join(src, "Project"));
        await writeFile(join(dst, "Project", "a.txt"), "edited at the destination");
      },
      resolve: (conflict) => (conflict.reason === "source_changed" ? "merge" : "skip"),
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual([
      "source_changed",
      "destination_changed",
    ]);
    expect(await readFile(join(dst, "Project", "a.txt"), "utf8")).toBe("edited at the destination");
  });
});

describe("items added to a folder after the review", () => {
  it("are named in the result of a copy instead of calling it complete", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      beforeExecute: () => writeFile(join(src, "F", "late.txt"), "late"),
    });

    expect(result?.status).toBe("partial");
    expect(result?.items.find((item) => item.sourcePath === join(src, "F"))?.error).toBe(
      "“late.txt” was added to “F” after the copy began, so it wasn't copied.",
    );
    expect(await readdir(join(dst, "F"))).toEqual(["a.txt"]);
  });

  it("don't count Finder's own .DS_Store", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      beforeExecute: () => writeFile(join(src, "F", ".DS_Store"), "view"),
    });

    expect(result?.status).toBe("completed");
  });
});

// Finder writes .DS_Store into a folder just by showing it: merging two folders that both
// have one isn't a clash to ask about, and the folder merged into keeps its own.
describe("merging folders that both have Finder's .DS_Store", () => {
  it.each(["copy", "cut"] as const)(
    "keeps the destination's, asking nothing (%s)",
    async (mode) => {
      await mkdir(join(src, "F"));
      await writeFile(join(src, "F", ".DS_Store"), "pasted view");
      await writeFile(join(src, "F", "a.txt"), "a");
      await mkdir(join(dst, "F"));
      await writeFile(join(dst, "F", ".DS_Store"), "own view");
      await writeFile(join(dst, "F", "b.txt"), "b");

      const { report, result } = await runPaste({
        mode,
        sourcePaths: [join(src, "F")],
        destinationDirectoryPath: dst,
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
      });

      expect(report.summary).toMatchObject({ fileConflictCount: 0, directoryConflictCount: 1 });
      expect(report.nodes[0]?.children.map((child) => basename(child.sourcePath))).toEqual([
        "a.txt",
      ]);
      expect(result?.status).toBe("completed");
      expect((await readdir(join(dst, "F"))).sort()).toEqual([".DS_Store", "a.txt", "b.txt"]);
      expect(await readFile(join(dst, "F", ".DS_Store"), "utf8")).toBe("own view");
    },
  );

  it("copies the pasted one into a folder that has none", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", ".DS_Store"), "pasted view");
    await mkdir(join(dst, "F"));

    const { report } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
    });

    expect(report.summary).toMatchObject({ fileConflictCount: 0 });
    expect(await readFile(join(dst, "F", ".DS_Store"), "utf8")).toBe("pasted view");
  });
});

describe("what is picked to paste", () => {
  // "/" holds everything, so wherever it is pasted is inside it.
  it("refuses to paste the startup disk into one of its own folders", async () => {
    const { report, result } = await runPaste({
      mode: "copy",
      sourcePaths: ["/"],
      destinationDirectoryPath: dst,
    });

    expect(report.issues).toEqual([expect.objectContaining({ code: "parent_into_child" })]);
    expect(result).toBeNull();
  });

  // Select All in search results picks a folder and items inside it.
  it("copies an item picked with its folder once, inside the folder", async () => {
    await mkdir(join(src, "A"));
    await writeFile(join(src, "A", "b.txt"), "b");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "A", "b.txt"), join(src, "A")],
      destinationDirectoryPath: dst,
    });

    expect(result?.status).toBe("completed");
    expect(await readdir(dst)).toEqual(["A"]);
    expect(await readdir(join(dst, "A"))).toEqual(["b.txt"]);
  });

  it("moves an item picked with its folder along with the folder, without asking", async () => {
    await mkdir(join(src, "A"));
    await writeFile(join(src, "A", "b.txt"), "b");

    const { conflicts, result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "A"), join(src, "A", "b.txt")],
      destinationDirectoryPath: dst,
    });

    expect(conflicts).toEqual([]);
    expect(result?.status).toBe("completed");
    expect(await readdir(join(dst, "A"))).toEqual(["b.txt"]);
    expect(await readdir(src)).toEqual([]);
  });

  it("counts a folder as one item picked, not the items inside it", async () => {
    await mkdir(join(src, "Photos"));
    for (const name of ["1.jpg", "2.jpg", "3.jpg"]) {
      await writeFile(join(src, "Photos", name), name);
    }

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Photos")],
      destinationDirectoryPath: dst,
    });

    expect(result?.summary.topLevelItemCount).toBe(1);
  });
});

describe("the folder pasted into goes away during the paste", () => {
  it("doesn't make it again, and says it is gone", async () => {
    await writeFile(join(src, "a.txt"), "a");
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "b.txt"), "b");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt"), join(src, "F")],
      destinationDirectoryPath: dst,
      beforeExecute: () => rm(dst, { recursive: true }),
    });

    expect(result?.status).toBe("failed");
    expect(result?.items.map((item) => item.error)).toEqual([
      "The folder “dst” no longer exists.",
      "The folder “dst” no longer exists.",
    ]);
    expect(await readdir(testDir)).not.toContain("dst");
  });
});

describe("a folder copied or moved whole", () => {
  // Four files in a package, the third of which can't be written (the disk is full).
  async function packageWithAFailingFile(): Promise<WriteServiceFileSystem> {
    await mkdir(join(src, "Talk.key", "Data"), { recursive: true });
    for (const name of ["Index.zip", "Data/a.png", "Data/b.png", "Metadata.plist"]) {
      await writeFile(join(src, "Talk.key", name), name);
    }
    let written = 0;
    const plain = withoutRenameAtAll();
    return {
      ...plain,
      copyFile: async (from, to, signal) => {
        written += 1;
        if (written === 3) {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        }
        await plain.copyFile?.(from, to, signal);
      },
    };
  }

  // An incomplete package inside a folder being copied, which the disk won't let go of:
  // the folder around it isn't put in place either, and nothing of it is left.
  it("copies nothing of a folder whose incomplete package can't be cleared away", async () => {
    const fileSystem = await packageWithAFailingFile();
    await mkdir(join(src, "F"));
    await rename(join(src, "Talk.key"), join(src, "F", "Talk.key"));

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: {
        ...fileSystem,
        rm: async (path, options) => {
          if (basename(path) === "Talk.key") {
            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
          }
          await fileSystem.rm(path, options);
        },
      },
    });

    expect(result?.status).toBe("failed");
    expect(result?.items[0]?.error).toBe("You don't have permission to access this item.");
    expect(await readdir(dst)).toEqual([]);
  });

  // As to another disk: no part of the package is left in either place.
  it("moves nothing of a folder some of whose items couldn't be copied", async () => {
    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Talk.key")],
      destinationDirectoryPath: dst,
      fileSystem: await packageWithAFailingFile(),
    });

    expect(result?.status).toBe("failed");
    expect(result?.items[0]?.error).toBe(
      "“Talk.key” wasn't moved because some items in it were skipped or couldn't be copied. Nothing in it was moved.",
    );
    expect(result?.items.filter((item) => item.status === "failed")).toHaveLength(2);
    expect(await readdir(dst)).toEqual([]);
    expect((await readdir(join(src, "Talk.key"))).sort()).toEqual([
      "Data",
      "Index.zip",
      "Metadata.plist",
    ]);
    expect((await readdir(join(src, "Talk.key", "Data"))).sort()).toEqual(["a.png", "b.png"]);
  });

  it("copies nothing of a package some of whose items couldn't be copied", async () => {
    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Talk.key")],
      destinationDirectoryPath: dst,
      fileSystem: await packageWithAFailingFile(),
    });

    expect(result?.items[0]?.error).toBe(
      "“Talk.key” wasn't copied because some items in it were skipped or couldn't be copied.",
    );
    expect(await readdir(dst)).toEqual([]);
  });

  // An ordinary folder is put in place with what could be copied, the rest named.
  it("puts an ordinary folder in place with what could be copied", async () => {
    await rm(join(src, "Talk.key"), { recursive: true, force: true });
    const fileSystem = await packageWithAFailingFile();
    await rename(join(src, "Talk.key"), join(src, "Talk"));

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Talk")],
      destinationDirectoryPath: dst,
      fileSystem,
    });

    expect(result?.status).toBe("partial");
    // The folder, and the file in it that couldn't be written.
    expect(result?.items.filter((item) => item.status === "failed")).toEqual([
      expect.objectContaining({ sourcePath: join(src, "Talk"), childFailureCount: 1 }),
      expect.objectContaining({
        error: "There isn't enough free space on the destination disk.",
      }),
    ]);
    expect(await readdir(dst)).toEqual(["Talk"]);
    const copied = [
      ...(await readdir(join(dst, "Talk"))),
      ...(await readdir(join(dst, "Talk", "Data"))),
    ];
    expect(copied).toHaveLength(4);
  });

  // An item put at the hidden name a folder is being built under is someone else's: when
  // the paste can't go on, only what it made goes.
  it("leaves alone another item that took its hidden name", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    const plain = withoutRenameAtAll();
    let hidden = "";

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: {
        ...plain,
        copyFile: async () => {
          hidden = (await readdir(dst)).find((name) => name.startsWith(".F.filetrail-")) ?? "";
          await rename(join(dst, hidden), join(testDir, "ours"));
          await mkdir(join(dst, hidden));
          await writeFile(join(dst, hidden, "theirs.txt"), "theirs");
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        },
      },
    });

    expect(result?.status).toBe("failed");
    expect(await readdir(join(dst, hidden))).toEqual(["theirs.txt"]);
    expect(await readdir(join(src, "F"))).toEqual(["a.txt"]);
  });

  // Another app swapped the finished hidden copy for a folder of its own: that folder is
  // never put in place, and the originals stay.
  function swappingHiddenCopy(fileSystem: WriteServiceFileSystem): {
    fileSystem: WriteServiceFileSystem;
    hidden: () => string;
  } {
    let copied = false;
    let hidden = "";
    return {
      hidden: () => hidden,
      fileSystem: {
        ...fileSystem,
        // As on another disk: nothing is renamed out of "src".
        renameExclusive: async (from, to) => {
          if (from.startsWith(`${src}/`)) {
            throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
          }
          await rename(from, to);
        },
        copyFile: async (from, to, signal) => {
          await fileSystem.copyFile?.(from, to, signal);
          copied = true;
        },
        // The next look at the hidden folder once everything is copied: it has been swapped.
        lstat: async (path) => {
          if (copied && basename(path).startsWith(".F.filetrail-") && dirname(path) === dst) {
            copied = false;
            hidden = basename(path);
            await rename(path, join(testDir, "ours"));
            await mkdir(path);
            await writeFile(join(path, "theirs.txt"), "theirs");
          }
          return fileSystem.lstat(path);
        },
      },
    };
  }

  it("doesn't put in place, or remove originals for, a hidden copy another app swapped", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    const swapping = swappingHiddenCopy(nativeFileSystem);

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: swapping.fileSystem,
    });

    expect(result?.status).toBe("failed");
    expect(result?.items[0]?.error).toBe(
      "“F” wasn't moved because another app changed its copy while it was being made. The original is where it was.",
    );
    expect(await readdir(dst)).toEqual([swapping.hidden()]);
    expect(await readdir(join(dst, swapping.hidden()))).toEqual(["theirs.txt"]);
    expect(await readdir(join(src, "F"))).toEqual(["a.txt"]);
  });

  it("keeps the old item a Replace was to replace when another app swapped the copy", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "new");
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "a.txt"), "old");
    const swapping = swappingHiddenCopy(nativeFileSystemWithTrash(trash));

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: swapping.fileSystem,
    });

    expect(result?.status).toBe("failed");
    expect(await readFile(join(dst, "F", "a.txt"), "utf8")).toBe("old");
    expect(await readdir(trash)).toEqual([]);
    expect(await readFile(join(src, "F", "a.txt"), "utf8")).toBe("new");
  });

  // A copy of a folder with a rule against deleting it (as ~/Documents has) carries the
  // rule: a move that can't go on still removes all of its hidden copy.
  it("removes a hidden copy holding a folder with a rule against deleting it", async () => {
    await mkdir(join(src, "F", "A"), { recursive: true });
    await writeFile(join(src, "F", "A", "a.txt"), "a");
    await writeFile(join(src, "F", "z.txt"), "z");
    execFileSync("chmod", ["+a", "group:everyone deny delete", join(src, "F", "A")]);
    const plain = withoutRenameAtAll();

    try {
      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "F")],
        destinationDirectoryPath: dst,
        fileSystem: {
          ...plain,
          copyFile: async (from, to, signal) => {
            if (basename(from) === "z.txt") {
              throw Object.assign(new Error("ENOSPC: no space left on device"), {
                code: "ENOSPC",
              });
            }
            await plain.copyFile?.(from, to, signal);
          },
        },
      });

      expect(result?.status).toBe("failed");
      expect(await readdir(dst)).toEqual([]);
      expect((await readdir(join(src, "F"))).sort()).toEqual(["A", "z.txt"]);
    } finally {
      execFileSync("chmod", ["-R", "-N", testDir]);
    }
  });

  // The item Replace was to replace went away before the paste: the package is then moved
  // as any other, whole or not at all.
  it("moves a package whole when the item it was to replace is gone", async () => {
    const fileSystem = await packageWithAFailingFile();
    await mkdir(join(dst, "Talk.key"));

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Talk.key")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem,
      beforeExecute: () => rm(join(dst, "Talk.key"), { recursive: true }),
    });

    expect(result?.status).toBe("failed");
    expect(await readdir(dst)).toEqual([]);
    expect((await readdir(join(src, "Talk.key"))).sort()).toEqual([
      "Data",
      "Index.zip",
      "Metadata.plist",
    ]);
  });

  // A file in the package changed after the review and was skipped: the rest of it isn't
  // a whole package, so none of it is put in place.
  it("copies nothing of a package an item of which was skipped", async () => {
    await mkdir(join(src, "Talk.key"));
    await writeFile(join(src, "Talk.key", "Index.zip"), "index");
    await writeFile(join(src, "Talk.key", "Metadata.plist"), "meta");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Talk.key")],
      destinationDirectoryPath: dst,
      beforeExecute: () => writeFile(join(src, "Talk.key", "Index.zip"), "changed index"),
      resolve: () => "skip",
    });

    expect(result?.items[0]?.error).toBe(
      "“Talk.key” wasn't copied because some items in it were skipped or couldn't be copied.",
    );
    expect(await readdir(dst)).toEqual([]);
  });

  // A folder in a moved folder became a file after the review and was skipped: it stays,
  // and the rest moves.
  it("leaves a skipped folder where it was when moving the rest", async () => {
    await mkdir(join(src, "F", "E"), { recursive: true });
    await writeFile(join(src, "F", "a.txt"), "a");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: withoutRenameAtAll(),
      beforeExecute: async () => {
        await rm(join(src, "F", "E"), { recursive: true });
        await writeFile(join(src, "F", "E"), "now a file");
      },
      resolve: () => "skip",
    });

    expect(result?.items.find((item) => item.sourcePath === join(src, "F", "E"))?.status).toBe(
      "skipped",
    );
    expect(await readdir(join(dst, "F"))).toEqual(["a.txt"]);
    expect(await readdir(join(src, "F"))).toEqual(["E"]);
  });

  // An app inside an ordinary folder is whole or not at all, like the folder's own items.
  it("leaves out an app inside a folder that couldn't be copied whole", async () => {
    await mkdir(join(src, "F", "Tool.app", "Contents"), { recursive: true });
    await writeFile(join(src, "F", "readme.txt"), "readme");
    await writeFile(join(src, "F", "Tool.app", "Contents", "a"), "a");
    await writeFile(join(src, "F", "Tool.app", "Contents", "b"), "b");
    const plain = nativeFileSystem;

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: {
        ...plain,
        copyFile: async (from, to, signal) => {
          if (from.endsWith("Contents/b")) {
            throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
          }
          await plain.copyFile?.(from, to, signal);
        },
      },
    });

    expect(await readdir(join(dst, "F"))).toEqual(["readme.txt"]);
    expect(
      result?.items.find((item) => item.sourcePath === join(src, "F", "Tool.app"))?.error,
    ).toBe("“Tool.app” wasn't copied because some items in it were skipped or couldn't be copied.");
  });

  // Stopped as its last file is written, before the folder is put in place.
  // Skipped deep inside: "Contents" was done, the app it is in wasn't.
  it("leaves out an app with an item skipped deep inside it", async () => {
    await mkdir(join(src, "F", "App.app", "Contents"), { recursive: true });
    await writeFile(join(src, "F", "readme.txt"), "readme");
    await writeFile(join(src, "F", "App.app", "Contents", "a"), "a");

    await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      beforeExecute: () => writeFile(join(src, "F", "App.app", "Contents", "a"), "changed"),
      resolve: () => "skip",
    });

    expect(await readdir(join(dst, "F"))).toEqual(["readme.txt"]);
  });

  it("moves nothing when stopped as its last item is copied", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    const controller = new AbortController();
    const plain = withoutRenameAtAll();

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      signal: controller.signal,
      fileSystem: {
        ...plain,
        copyFile: async (from, to, signal) => {
          await plain.copyFile?.(from, to, signal);
          controller.abort();
        },
      },
    });

    expect(result?.status).toBe("cancelled");
    expect(await readdir(dst)).toEqual([]);
    expect(await readdir(join(src, "F"))).toEqual(["a.txt"]);
  });

  // What couldn't be cleared away (its disk went away) stays written down for the next start.
  it("keeps the record of a hidden folder it couldn't clear away", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    const plain = withoutRenameAtAll();
    const live = new Map<string, WriteJournalEntry>();

    await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: {
        ...plain,
        copyFile: async () => {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        },
        rm: async (path, options) => {
          if (path.includes(".F.filetrail-")) {
            throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
          }
          await plain.rm(path, options);
        },
      },
      writeJournal: {
        add: async (entry) => {
          live.set(entry.id, entry);
        },
        remove: async (id) => {
          live.delete(id);
        },
      },
    });

    expect([...live.values()]).toEqual([
      expect.objectContaining({ finalPath: join(dst, "F"), movingCopy: true }),
    ]);
  });

  it("moves nothing when stopped part way, and leaves nothing hidden", async () => {
    await mkdir(join(src, "F"));
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await writeFile(join(src, "F", name), name);
    }
    const controller = new AbortController();
    const plain = withoutRenameAtAll();

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      signal: controller.signal,
      fileSystem: {
        ...plain,
        copyFile: async (from, to, signal) => {
          await plain.copyFile?.(from, to, signal);
          if (from.endsWith("b.txt")) {
            controller.abort();
          }
        },
      },
    });

    expect(result?.status).toBe("cancelled");
    expect(await readdir(dst)).toEqual([]);
    expect((await readdir(join(src, "F"))).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  // Written down while it is built, so a crash leaves nothing under the hidden name.
  it("writes the folder down while it is built, and lets go once it is in place", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    const added: WriteJournalEntry[] = [];
    const live = new Map<string, WriteJournalEntry>();

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: withoutRenameAtAll(),
      writeJournal: {
        add: async (entry) => {
          added.push(entry);
          live.set(entry.id, entry);
        },
        remove: async (id) => {
          live.delete(id);
        },
      },
    });

    expect(result?.status).toBe("completed");
    expect(added).toEqual([
      expect.objectContaining({ finalPath: join(dst, "F"), staged: false }),
      expect.objectContaining({ finalPath: join(dst, "F"), staged: true }),
    ]);
    expect(live.size).toBe(0);
    expect(await readdir(dst)).toEqual(["F"]);
    expect(await readdir(src)).toEqual([]);
  });
});

describe("a large file being copied", () => {
  // A crash part way would leave the part copied under a hidden name: it is written down
  // first, and let go of once the file has its name, or once the copy failed.
  it("is written down in the journal while it is copied", async () => {
    // Sparse: as large as that, written in no time.
    await writeFile(join(src, "movie.mov"), "");
    await truncate(join(src, "movie.mov"), JOURNALED_FILE_BYTES);
    await writeFile(join(src, "small.txt"), "small");
    const recorded: WriteJournalEntry[] = [];
    const live = new Map<string, WriteJournalEntry>();

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "movie.mov"), join(src, "small.txt")],
      destinationDirectoryPath: dst,
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

    expect(result?.status).toBe("completed");
    expect(recorded).toEqual([
      {
        kind: "partial_file",
        id: expect.any(String),
        // In a hidden folder made for it, known by its id.
        partialPath: expect.stringMatching(/\/\.movie\.mov\.filetrail-[0-9a-f]{8}\/part$/u),
        finalPath: join(dst, "movie.mov"),
        folderId: { dev: expect.any(Number), ino: expect.any(Number) },
        folderBornMs: expect.any(Number),
      },
    ]);
    expect(live.size).toBe(0);
    expect((await readdir(dst)).sort()).toEqual(["movie.mov", "small.txt"]);
  });

  it("lets go of the entry when the copy fails", async () => {
    // Sparse: as large as that, written in no time.
    await writeFile(join(src, "movie.mov"), "");
    await truncate(join(src, "movie.mov"), JOURNALED_FILE_BYTES);
    const live = new Map<string, WriteJournalEntry>();

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "movie.mov")],
      destinationDirectoryPath: dst,
      fileSystem: {
        ...nativeFileSystem,
        copyFile: async () => {
          throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
        },
      },
      writeJournal: {
        add: async (entry) => {
          live.set(entry.id, entry);
        },
        remove: async (id) => {
          live.delete(id);
        },
      },
    });

    expect(result?.status).toBe("failed");
    expect(live.size).toBe(0);
    expect(await readdir(dst)).toEqual([]);
  });
});

describe("an item copied that was replaced before the paste", () => {
  it("is left out as missing, while one renamed into place by the app is pasted", async () => {
    await writeFile(join(src, "a.txt"), "copied");
    await writeFile(join(src, "b.txt"), "copied too");
    const copiedIds = {
      [join(src, "a.txt")]: idOf(join(src, "a.txt")),
      [join(src, "b.txt")]: idOf(join(src, "b.txt")),
    };
    // An app saves a new a.txt in its place (a new file renamed over it).
    await writeFile(join(testDir, "new.tmp"), "saved since");
    await rename(join(testDir, "new.tmp"), join(src, "a.txt"));

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-test",
      request: normalizeCopyPasteAnalysisRequest({
        mode: "copy",
        sourcePaths: [join(src, "a.txt"), join(src, "b.txt")],
        destinationDirectoryPath: dst,
        expectedSourceIds: copiedIds,
      }),
      fileSystem: nativeFileSystem,
      thresholds: { largeBatchItemThreshold: 100_000, largeBatchByteThreshold: 1e12 },
    });

    expect(report.issues).toEqual([
      expect.objectContaining({ code: "source_missing", sourcePath: join(src, "a.txt") }),
    ]);
    expect(report.nodes.map((node) => node.sourcePath)).toEqual([join(src, "b.txt")]);
  });
});

describe("the item a Replace removes is the one that was there", () => {
  // An app saves a new version of "a.txt" (a new file put in its place) while the copy
  // replacing it is being written.
  it("keeps an item saved in its place while the new one was being copied", async () => {
    await writeFile(join(src, "a.txt"), "pasted");
    await writeFile(join(dst, "a.txt"), "old");
    const withTrash = nativeFileSystemWithTrash(trash);
    const fileSystem: WriteServiceFileSystem = {
      ...withTrash,
      copyFile: async (from, to, signal) => {
        await withTrash.copyFile?.(from, to, signal);
        await writeFile(join(testDir, "saved.tmp"), "saved meanwhile");
        await rename(join(testDir, "saved.tmp"), join(dst, "a.txt"));
      },
    };

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem,
    });

    expect(result?.status).toBe("failed");
    expect(result?.items[0]?.error).toBe(
      "“a.txt” changed while it was being replaced, so it was kept and nothing was replaced.",
    );
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("saved meanwhile");
    expect(await readdir(dst)).toEqual(["a.txt"]);
    expect(await readdir(trash)).toEqual([]);
  });

  it("keeps a folder that got a new item while the new one was being copied", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "x.txt"), "pasted");
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "old.txt"), "old");
    const withTrash = nativeFileSystemWithTrash(trash);
    const fileSystem: WriteServiceFileSystem = {
      ...withTrash,
      copyFile: async (from, to, signal) => {
        await withTrash.copyFile?.(from, to, signal);
        await writeFile(join(dst, "F", "new work.txt"), "unsaved elsewhere");
      },
    };

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem,
    });

    expect(result?.status).toBe("failed");
    expect((await readdir(join(dst, "F"))).sort()).toEqual(["new work.txt", "old.txt"]);
    expect(await readdir(dst)).toEqual(["F"]);
    expect(await readdir(trash)).toEqual([]);
  });

  // Looking for a locked item inside a large folder takes a while: one swapped in for it
  // meanwhile isn't deleted.
  it("doesn't delete a folder swapped in while it was looked through for locked items", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "x.txt"), "pasted");
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "old.txt"), "old");
    let swapped = false;
    const fileSystem: WriteServiceFileSystem = {
      ...nativeFileSystem,
      trash: async () => {
        throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
      },
      getFlags: async (path) => {
        if (!swapped && path === join(dst, "F", "old.txt")) {
          swapped = true;
          renameSync(join(dst, "F"), join(testDir, "F asked about"));
          mkdirSync(join(dst, "F"));
          writeFileSync(join(dst, "F", "old.txt"), "never asked about");
        }
        return (await nativeFileSystem.getFlags?.(path)) ?? 0;
      },
    };

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem,
      resolve: () => "overwrite",
    });

    expect(swapped).toBe(true);
    expect(result?.status).toBe("failed");
    expect(await readFile(join(dst, "F", "old.txt"), "utf8")).toBe("never asked about");
    expect(await readdir(dst)).toEqual(["F"]);
  });

  // On a disk with no Trash the person is asked first; another item put there while the
  // question was open is never deleted on that answer.
  it("doesn't delete for good an item put in place while the no-Trash question was open", async () => {
    await writeFile(join(src, "a.txt"), "pasted");
    await writeFile(join(dst, "a.txt"), "old");
    const fileSystem: WriteServiceFileSystem = {
      ...nativeFileSystem,
      trash: async () => {
        throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
      },
    };

    const { result, conflicts } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem,
      resolve: () => {
        writeFileSync(join(testDir, "other.tmp"), "never asked about");
        renameSync(join(testDir, "other.tmp"), join(dst, "a.txt"));
        return "overwrite";
      },
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["trash_unavailable"]);
    expect(result?.status).toBe("failed");
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("never asked about");
    expect(await readdir(dst)).toEqual(["a.txt"]);
  });

  // Another app swapped the hidden copy while the question was open: the old item isn't
  // deleted for it, and it isn't put in place.
  it("doesn't delete the old item for a copy another app swapped while it asked", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "new");
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "a.txt"), "old");
    const fileSystem: WriteServiceFileSystem = {
      ...nativeFileSystem,
      trash: async () => {
        throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
      },
    };

    const { result, conflicts } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem,
      resolve: () => {
        const hidden = readdirSync(dst).find((name) => name.startsWith(".F.filetrail-")) ?? "";
        renameSync(join(dst, hidden), join(testDir, "ours"));
        mkdirSync(join(dst, hidden));
        writeFileSync(join(dst, hidden, "theirs.txt"), "theirs");
        return "overwrite";
      },
    });

    expect(conflicts.map((conflict) => conflict.reason)).toEqual(["trash_unavailable"]);
    expect(result?.status).toBe("failed");
    expect(await readFile(join(dst, "F", "a.txt"), "utf8")).toBe("old");
    const hidden = (await readdir(dst)).filter((name) => name !== "F");
    expect(hidden).toHaveLength(1);
    expect(await readdir(join(dst, hidden[0] ?? ""))).toEqual(["theirs.txt"]);
  });
});

describe("files that look like AppleDouble files", () => {
  // On APFS a "._name" file is an ordinary file unless it really is AppleDouble data.
  it("copies a ._ file that isn't AppleDouble data, and one without its item", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    await writeFile(join(src, "F", "._a.txt"), "just a file");
    await writeFile(join(src, "F", "._alone"), Buffer.from([0x00, 0x05, 0x16, 0x07, 0x00]));

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
    });

    expect(result?.status).toBe("completed");
    expect((await readdir(join(dst, "F"))).sort()).toEqual(["._a.txt", "._alone", "a.txt"]);
  });

  // APFS keeps attributes natively, so AppleDouble data in "._a.txt" (left by rsync, tar or
  // a NAS) isn't "a.txt"'s attributes: copying "a.txt" wouldn't carry it.
  it("copies AppleDouble data beside its item on APFS, and moves it", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    await writeFile(join(src, "F", "._a.txt"), APPLE_DOUBLE_DATA);

    const copy = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
    });
    expect(copy.report.summary.totalNodeCount).toBe(3);
    expect((await readdir(join(dst, "F"))).sort()).toEqual(["._a.txt", "a.txt"]);

    await rm(join(dst, "F"), { recursive: true });
    const move = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: withoutRenameAtAll(),
    });
    expect(move.result?.status).toBe("completed");
    expect((await readdir(join(dst, "F"))).sort()).toEqual(["._a.txt", "a.txt"]);
    expect(await readFile(join(dst, "F", "._a.txt"))).toEqual(APPLE_DOUBLE_DATA);
  });

  // On APFS "._a.txt" is never "a.txt"'s attributes, even when it holds AppleDouble data:
  // one put in the folder while it was being moved stays there, and is named.
  it("keeps a ._ file added to a moved folder on APFS, and names it", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: withoutRenameAtAll(),
      beforeExecute: () => writeFile(join(src, "F", "._a.txt"), APPLE_DOUBLE_DATA),
    });

    expect(result?.items.find((item) => item.sourcePath === join(src, "F"))?.error).toBe(
      "“._a.txt” was added to “F” while it was being moved, so it was left in the original “F”.",
    );
    expect(await readdir(join(src, "F"))).toEqual(["._a.txt"]);
    expect(await readdir(join(dst, "F"))).toEqual(["a.txt"]);
  });

  it("names a ._ file added to a folder while it was copied on APFS", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "new"), "n");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      beforeExecute: () => writeFile(join(src, "F", "._new"), "an ordinary file"),
    });

    expect(result?.items.find((item) => item.sourcePath === join(src, "F"))?.error).toBe(
      "“._new” was added to “F” after the copy began, so it wasn't copied.",
    );
  });

  // The move empties "F" but for the "._a.txt" the person chose to keep: it isn't cleared
  // away with the folder as if it were "a.txt"'s attributes.
  it("keeps a ._ file the move skipped, in a folder it otherwise emptied", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    await writeFile(join(src, "F", "._a.txt"), APPLE_DOUBLE_DATA);
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "._a.txt"), "theirs");

    for (const fileSystem of [nativeFileSystem, withoutRenameAtAll()]) {
      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "F")],
        destinationDirectoryPath: dst,
        fileSystem,
        policy: KEEP_EXISTING,
      });

      expect(result?.status).toBe("partial");
      expect(await readdir(join(src, "F"))).toEqual(["._a.txt"]);
      expect(await readFile(join(src, "F", "._a.txt"))).toEqual(APPLE_DOUBLE_DATA);
      expect(await readFile(join(dst, "F", "._a.txt"), "utf8")).toBe("theirs");
      // Back where it started, for the next way of moving it.
      await rename(join(dst, "F", "a.txt"), join(src, "F", "a.txt"));
    }
  });
});

describe("a moved folder that stays because something in it stayed", () => {
  it("keeps Finder's view settings in it", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "new");
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "a.txt"), "old");

    await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: withoutRenameAtAll(),
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
      // Finder writes it while the folder is on screen.
      beforeExecute: () => writeFile(join(src, "F", ".DS_Store"), "view"),
    });

    expect((await readdir(join(src, "F"))).sort()).toEqual([".DS_Store", "a.txt"]);
  });
});

describe("smaller cases a Replace and a copy get right", () => {
  it("says a pipe can't be copied, instead of blaming the disk", async () => {
    execFileSync("/usr/bin/mkfifo", [join(src, "pipe")]);

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "pipe")],
      destinationDirectoryPath: dst,
    });

    expect(result?.items[0]?.error).toBe(
      "“pipe” is a special file (such as a pipe or a socket), which can't be copied.",
    );
  });

  it("names copies the same way whatever order the items come in", async () => {
    await writeFile(join(dst, "a.txt"), "a");
    await mkdir(join(src, "x"));
    await writeFile(join(src, "x", "a copy.txt"), "other");

    const { report, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(dst, "a.txt"), join(src, "x", "a copy.txt")],
      destinationDirectoryPath: dst,
    });

    expect(report.issues).toEqual([]);
    expect(result?.status).toBe("completed");
    expect((await readdir(dst)).sort()).toEqual(["a copy 2.txt", "a copy.txt", "a.txt"]);
    expect(await readFile(join(dst, "a copy.txt"), "utf8")).toBe("other");
  });

  it("doesn't offer to replace an item that is itself being pasted", async () => {
    await writeFile(join(dst, "a.txt"), "dst a");
    await mkdir(join(src, "x"));
    await writeFile(join(src, "x", "a.txt"), "x a");

    // "/d/a.txt" is copied too (it becomes "a copy.txt"), so it isn't there to be replaced.
    const { report } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "x", "a.txt"), join(dst, "a.txt")],
      destinationDirectoryPath: dst,
    });
    const node = report.nodes.find((item) => item.sourcePath === join(src, "x", "a.txt"));
    expect(node?.replaceBlockedReason).toBe("It is another item being pasted.");
  });

  it("checks Replace inside a merged folder too", async () => {
    await mkdir(join(src, "F", "inner"), { recursive: true });
    await writeFile(join(src, "F", "inner", "n.txt"), "n");
    await mkdir(join(dst, "F", "inner"), { recursive: true });
    await writeFile(join(dst, "F", "inner", "keep.txt"), "keep");

    const { report } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F"), join(dst, "F", "inner", "keep.txt")],
      destinationDirectoryPath: dst,
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
    });

    const inner = report.nodes[0]?.children.find((child) => child.sourcePath.endsWith("inner"));
    expect(inner?.replaceBlockedReason).toBe("It contains another item being pasted.");
  });

  it("keeps the old folder when an item in the new one changed and was skipped", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "new a");
    await writeFile(join(src, "F", "b.txt"), "new b");
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "b.txt"), "old b");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
      beforeExecute: () => writeFile(join(src, "F", "b.txt"), "newer b"),
      resolve: () => "skip",
    });

    expect(result?.items[0]?.error).toBe(
      "“F” wasn't replaced because “b.txt” in it changed and was skipped.",
    );
    expect(await readFile(join(dst, "F", "b.txt"), "utf8")).toBe("old b");
    expect(await readdir(trash)).toEqual([]);
    expect((await readdir(dst)).sort()).toEqual(["F"]);
  });

  it("removes the hidden copy when the Replace can't be written down", async () => {
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(dst, "a.txt"), "old");
    const writeJournal = {
      add: async (entry: WriteJournalEntry) => {
        if (isReplaceJournalEntry(entry) && entry.staged) {
          throw new Error("The disk is full.");
        }
      },
      remove: async () => undefined,
    };

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
      writeJournal,
    });

    expect(result?.status).toBe("failed");
    expect(await readdir(dst)).toEqual(["a.txt"]);
    expect(await readFile(join(dst, "a.txt"), "utf8")).toBe("old");
  });

  it("says a moved folder was kept when it changed during the move", async () => {
    await mkdir(join(src, "F"));
    await writeFile(join(src, "F", "a.txt"), "a");
    const { rename: _rename, ...withoutRename } = nativeFileSystem;

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "F")],
      destinationDirectoryPath: dst,
      fileSystem: withoutRename,
      beforeExecute: () => chmod(join(src, "F"), 0o700),
    });

    expect(result?.items[0]?.error).toBe(
      "Its items were moved, but the original “F” changed during the move, so it was kept.",
    );
    expect(await readdir(join(dst, "F"))).toEqual(["a.txt"]);
  });

  it("deletes nothing of a folder that holds a locked item, on a disk without a Trash", async () => {
    const { rename: _rename, ...withoutRename } = nativeFileSystem;
    await writeFile(join(src, "F"), "a file now");
    await mkdir(join(dst, "F"));
    await writeFile(join(dst, "F", "keep.txt"), "keep");
    await writeFile(join(dst, "F", "other.txt"), "other");
    execFileSync("chflags", ["uchg", join(dst, "F", "keep.txt")]);
    try {
      const { result } = await runPaste({
        mode: "copy",
        sourcePaths: [join(src, "F")],
        destinationDirectoryPath: dst,
        policy: REPLACE_ALL,
        fileSystem: {
          ...withoutRename,
          trash: async () => {
            throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
          },
        },
        resolve: () => "overwrite",
      });

      expect(result?.items[0]?.error).toBe(
        "“keep.txt” is locked. Unlock it in Finder's Get Info and try again.",
      );
      expect((await readdir(join(dst, "F"))).sort()).toEqual(["keep.txt", "other.txt"]);
    } finally {
      execFileSync("chflags", ["nouchg", join(dst, "F", "keep.txt")]);
    }
  });
});

describe("a file being copied", () => {
  // Quitting or a crash part way must never leave a cut-short file under the real name.
  it("is written under a hidden name and takes its own only once complete", async () => {
    await writeFile(join(src, "report.pdf"), "contents");
    const writtenAs: string[] = [];

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "report.pdf")],
      destinationDirectoryPath: dst,
      fileSystem: {
        ...nativeFileSystem,
        copyFile: async (from, to, signal) => {
          writtenAs.push(to);
          expect(await readdir(dst)).not.toContain("report.pdf");
          await nativeFileSystem.copyFile?.(from, to, signal);
        },
      },
    });

    expect(result?.status).toBe("completed");
    expect(writtenAs).toEqual([
      expect.stringMatching(/\/dst\/\.report\.pdf\.filetrail-[0-9a-f]+$/u),
    ]);
    expect(await readdir(dst)).toEqual(["report.pdf"]);
    expect(await readFile(join(dst, "report.pdf"), "utf8")).toBe("contents");
  });

  it("keeps a locked file's lock once it has its name", async () => {
    await writeFile(join(src, "locked.txt"), "keep");
    execFileSync("chflags", ["uchg", join(src, "locked.txt")]);
    try {
      const { result } = await runPaste({
        mode: "copy",
        sourcePaths: [join(src, "locked.txt")],
        destinationDirectoryPath: dst,
      });

      expect(result?.status).toBe("completed");
      expect(execFileSync("ls", ["-lO", join(dst, "locked.txt")]).toString()).toContain("uchg");
    } finally {
      execFileSync("chflags", ["-R", "nouchg", src, dst]);
    }
  });
});
