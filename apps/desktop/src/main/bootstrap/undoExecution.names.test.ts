import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { REPLACE_ALL, nativeFileSystemWithTrash } from "@filetrail/core/fs/testNativePaste";

import { paste, setUpUndo } from "./undoRealDisk.testkit";

// Undoing a Replace whose new item is spelled differently from the old one: only in case
// ("X.TXT" over "x.txt"), or only in how an accented letter is encoded. On a disk that
// ignores both, the old item's name is the new item's, which Undo moves away first: the
// name isn't taken by anyone else.

let root: string;
let trashDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "filetrail-undo-names-"));
  trashDir = join(root, ".Trash");
  mkdirSync(trashDir);
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "dst"));
  mkdirSync(join(root, "paste-trash"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const NFC = "café.txt";
const NFD = "café.txt";

describe.each(["copy", "cut"] as const)("undoing a Replace (%s) spelled differently", (mode) => {
  it.each([
    ["only in case", "X.TXT", "x.txt"],
    ["only in accent encoding", NFD, NFC],
  ])("asks nothing, and puts the old item back: %s", async (_label, newName, oldName) => {
    writeFileSync(join(root, "src", newName), "new");
    writeFileSync(join(root, "dst", oldName), "old");
    const t = setUpUndo(root, trashDir);
    await paste(t.history, {
      mode,
      sourcePaths: [join(root, "src", newName)],
      destinationDirectoryPath: join(root, "dst"),
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(join(root, "paste-trash")),
    });

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: [] });
    expect((await t.undo()).status).toBe("completed");
    expect(readdirSync(join(root, "dst"))).toEqual([oldName]);
    expect(readFileSync(join(root, "dst", oldName), "utf8")).toBe("old");
    await t.coordinator.shutdown();
  });
});

describe("renaming back a name that differs only in case", () => {
  it("renames an item without a usable id (an empty file on FAT) back, asking nothing", async () => {
    writeFileSync(join(root, "notes.txt"), "");
    // The ids FAT and exFAT give empty files, too large to go by.
    const withoutId = async (path: string) => {
      const stats = await lstat(path);
      return basename(path).toLowerCase() === "notes.txt"
        ? Object.assign(Object.create(Object.getPrototypeOf(stats)), stats, { ino: 2 ** 64 })
        : stats;
    };
    const t = setUpUndo(root, trashDir, { lstat: withoutId });
    await t.rename(join(root, "notes.txt"), "Notes.txt");

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: [] });
    expect((await t.undo()).status).toBe("completed");
    expect(readdirSync(root).filter((name) => name.endsWith(".txt"))).toEqual(["notes.txt"]);
    await t.coordinator.shutdown();
  });

  it("takes a hard link to the item under its old name for another item", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUpUndo(root, trashDir);
    await t.rename(join(root, "a.txt"), "b.txt");
    linkSync(join(root, "b.txt"), join(root, "a.txt"));

    expect(await t.prepare()).toMatchObject({ nameTaken: ["a.txt"] });
    expect((await t.undo()).status).toBe("completed");

    expect(readdirSync(root).filter((name) => name.endsWith(".txt"))).toEqual(["a 2.txt", "a.txt"]);
    await t.coordinator.shutdown();
  });
});

// A folder and an item in it renamed together; the item's new name was taken meanwhile, so
// it was skipped and kept its name, and is in the renamed folder only because of it.
describe("undoing a rename of a folder with an item in it that was skipped", () => {
  it("takes the item back with its folder, under its own name", async () => {
    mkdirSync(join(root, "P"));
    writeFileSync(join(root, "P", "a.txt"), "a");
    // Taken after the sheet checked the names.
    writeFileSync(join(root, "P", "b.txt"), "b");
    const t = setUpUndo(root, trashDir);
    const renamed = await t.finish(
      t.coordinator.handlers["writeOperation:batchRename"](
        {
          items: [
            { sourcePath: join(root, "P"), destinationName: "Q", isFolder: true },
            { sourcePath: join(root, "P", "a.txt"), destinationName: "b.txt", isFolder: false },
          ],
          onConflict: "skip",
          numberSeparator: " ",
        },
        { sender: t.sender },
      ),
    );
    expect(renamed.result?.items.map((item) => item.status)).toEqual(["completed", "skipped"]);
    expect(readdirSync(join(root, "Q")).sort()).toEqual(["a.txt", "b.txt"]);

    expect((await t.undo()).status).toBe("completed");

    expect(readdirSync(join(root, "P")).sort()).toEqual(["a.txt", "b.txt"]);
    expect(readdirSync(root).includes("Q")).toBe(false);
  });
});
