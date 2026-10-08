import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setUpUndo, snapshotOf } from "./undoRealDisk.testkit";

// Undo and Redo of items in a folder opened through a symbolic link: the app keeps the
// link's path (~/Projects for /Volumes/Data/Projects), so the folder an item goes back to
// is named by the link.

let root: string;
let trashDir: string;
let real: string;
let link: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "filetrail-undo-links-"));
  trashDir = join(root, ".Trash");
  mkdirSync(trashDir);
  real = join(root, "Data", "Projects");
  mkdirSync(real, { recursive: true });
  link = join(root, "Projects");
  symlinkSync(real, link);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a folder opened through a link", () => {
  it("renames back, and again on Redo", async () => {
    writeFileSync(join(real, "a.txt"), "a");
    const t = setUpUndo(root, trashDir);
    const before = snapshotOf(root, trashDir);
    await t.rename(join(link, "a.txt"), "b.txt");
    const after = snapshotOf(root, trashDir);

    expect((await t.undo()).status).toBe("completed");
    expect(snapshotOf(root, trashDir)).toEqual(before);
    expect((await t.undo("redo")).status).toBe("completed");
    expect(snapshotOf(root, trashDir)).toEqual(after);
    await t.coordinator.shutdown();
  });

  it("puts back from the Trash, and moves to the Trash again on Redo", async () => {
    writeFileSync(join(real, "a.txt"), "a");
    const t = setUpUndo(root, trashDir);
    const before = snapshotOf(root, trashDir);
    await t.trash(join(link, "a.txt"));

    expect((await t.undo()).status).toBe("completed");
    expect(snapshotOf(root, trashDir)).toEqual(before);
    expect((await t.undo("redo")).status).toBe("completed");
    expect(existsSync(join(real, "a.txt"))).toBe(false);
    await t.coordinator.shutdown();
  });

  it("moves a cut item back out of a folder reached through a link, and in again", async () => {
    const { runPaste } = await import("@filetrail/core/fs/testNativePaste");
    mkdirSync(join(real, "In"));
    writeFileSync(join(real, "a.txt"), "a");
    const t = setUpUndo(root, trashDir);
    const before = snapshotOf(root, trashDir);
    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(link, "a.txt")],
      destinationDirectoryPath: join(link, "In"),
    });
    if (!result?.undoLog) {
      throw new Error("The paste recorded nothing.");
    }
    t.history.record({ action: "paste", log: result.undoLog, items: result.items });
    const after = snapshotOf(root, trashDir);

    expect((await t.undo()).status).toBe("completed");
    expect(snapshotOf(root, trashDir)).toEqual(before);
    expect((await t.undo("redo")).status).toBe("completed");
    expect(snapshotOf(root, trashDir)).toEqual(after);
    await t.coordinator.shutdown();
  });
});
