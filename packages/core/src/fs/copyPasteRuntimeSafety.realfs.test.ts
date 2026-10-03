// What a paste does when the items it is about relate to each other, or change between the
// review and the paste, on the real disk.

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  KEEP_EXISTING,
  REPLACE_ALL,
  nativeFileSystem,
  nativeFileSystemWithTrash,
  runPaste,
} from "./testNativePaste";
import type { ReplaceJournalEntry } from "./writeServiceTypes";

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

  it("refuses the Replace at paste time and keeps every item", async () => {
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

    expect(result?.items.find((item) => item.sourcePath === join(src, "a"))).toMatchObject({
      status: "failed",
      error: "Can't replace “a” because it contains another item being pasted.",
    });
    expect(await readdir(trash)).toEqual([]);
    expect(await readFile(join(dst, "keep.txt"), "utf8")).toBe("keep");
    expect(await readFile(join(src, "a", "new.txt"), "utf8")).toBe("new");
  });

  it("replaces the folder once the other item has been moved out of it first", async () => {
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
      replaceJournal: {
        add: async (entry) => {
          journal.splice(0, journal.length, entry);
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
