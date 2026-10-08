import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
