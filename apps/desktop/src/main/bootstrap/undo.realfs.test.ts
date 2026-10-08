import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type TestDiskImage,
  canMountDiskImages,
  mountTestDiskImage,
} from "@filetrail/core/fs/testDiskImage";

import { originalFileSystem, originalTrashItem } from "../originalFileSystem";
import { createTrashItem } from "./trashItem";
import { setUpUndo } from "./undoRealDisk.testkit";

// Undo on test disk images, for what the startup disk can't show: the Trash of another
// disk (its own .Trashes folder), and disks that tell names apart by case or don't.

let home: string;
let volume: TestDiskImage | null = null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "filetrail-undo-realfs-"));
  mkdirSync(join(home, ".Trash"));
});

afterEach(() => {
  volume?.detach();
  volume = null;
  rmSync(home, { recursive: true, force: true });
});

// The coordinator as the app runs it on `disk`: the real Trash, the home folder elsewhere.
function setUpOn(disk: TestDiskImage) {
  volume = disk;
  return setUpUndo(home, join(home, ".Trash"), {
    trash: createTrashItem({ trash: originalTrashItem, fs: originalFileSystem, homePath: home }),
  });
}

describe("Undo on other disks", () => {
  it.runIf(canMountDiskImages)("puts an item back from its disk's own Trash", async () => {
    const t = setUpOn(mountTestDiskImage({ name: "FileTrailUndo" }));
    const disk = (volume as TestDiskImage).mountPath;
    writeFileSync(join(disk, "a.txt"), "a");

    await t.trash(join(disk, "a.txt"));
    expect(readdirSync(disk)).not.toContain("a.txt");

    expect((await t.undo()).status).toBe("completed");
    expect(readFileSync(join(disk, "a.txt"), "utf8")).toBe("a");
    expect((await t.undo("redo")).status).toBe("completed");
    expect(readdirSync(disk)).not.toContain("a.txt");
    await t.coordinator.shutdown();
  });

  it.runIf(canMountDiskImages)(
    "renames back a name that differs only in case on a disk that ignores case",
    async () => {
      const t = setUpOn(mountTestDiskImage({ name: "FileTrailUndo" }));
      const disk = (volume as TestDiskImage).mountPath;
      writeFileSync(join(disk, "notes.txt"), "n");

      await t.rename(join(disk, "notes.txt"), "Notes.txt");
      expect(readdirSync(disk)).toContain("Notes.txt");

      expect(await t.prepare()).toMatchObject({ nameTaken: [] });
      expect((await t.undo()).status).toBe("completed");
      expect(readdirSync(disk).filter((name) => !name.startsWith("."))).toEqual(["notes.txt"]);
      await t.coordinator.shutdown();
    },
  );

  it.runIf(canMountDiskImages)(
    "keeps both only when the very name is taken on a disk that minds case",
    async () => {
      const t = setUpOn(mountTestDiskImage({ caseSensitive: true, name: "FileTrailUndo" }));
      const disk = (volume as TestDiskImage).mountPath;
      writeFileSync(join(disk, "a.txt"), "a");
      writeFileSync(join(disk, "b.txt"), "b");
      await t.rename(join(disk, "a.txt"), "x.txt");
      await t.rename(join(disk, "b.txt"), "y.txt");
      // "A.txt" is another name here; "b.txt" is the very one.
      writeFileSync(join(disk, "A.txt"), "someone else's A");
      writeFileSync(join(disk, "b.txt"), "someone else's b");

      expect(await t.prepare()).toMatchObject({ nameTaken: ["b.txt"] });
      await t.undo();
      expect(readFileSync(join(disk, "b 2.txt"), "utf8")).toBe("b");
      expect(await t.prepare()).toMatchObject({ nameTaken: [] });
      await t.undo();
      expect(readFileSync(join(disk, "a.txt"), "utf8")).toBe("a");
      expect(readFileSync(join(disk, "A.txt"), "utf8")).toBe("someone else's A");
      await t.coordinator.shutdown();
    },
  );
});
