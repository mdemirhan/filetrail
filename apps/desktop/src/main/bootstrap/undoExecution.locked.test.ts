import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { native } from "@filetrail/core/fs/testNativePaste";

import { paste, setUpUndo } from "./undoRealDisk.testkit";

// Undoing a copy of a locked item (Finder's "Locked", the uchg flag): the copy is locked
// too, and the Trash refuses a locked item. It is the operation's own copy, so Undo unlocks
// it for the move, without asking, and locks it again in the Trash.

const UF_IMMUTABLE = 0x2;
const SF_IMMUTABLE = 0x20000;

let root: string;
let trashDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "filetrail-undo-locked-"));
  trashDir = join(root, ".Trash");
  mkdirSync(trashDir);
});

afterEach(() => {
  execFileSync("chflags", ["-R", "nouchg", root]);
  rmSync(root, { recursive: true, force: true });
});

async function isLockedOnDisk(path: string): Promise<boolean> {
  return ((await native.nativeGetFlags(path)) & UF_IMMUTABLE) !== 0;
}

describe("undoing a copy of a locked item", () => {
  it("moves the copy to the Trash still locked, and Redo puts it back locked", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    execFileSync("chflags", ["uchg", join(root, "a.txt")]);
    const t = setUpUndo(root, trashDir);
    await paste(
      t.history,
      { mode: "copy", sourcePaths: [join(root, "a.txt")], destinationDirectoryPath: root },
      "duplicate",
    );
    expect(await isLockedOnDisk(join(root, "a copy.txt"))).toBe(true);

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: [] });
    expect((await t.undo()).status).toBe("completed");

    expect(existsSync(join(root, "a copy.txt"))).toBe(false);
    expect(readdirSync(trashDir)).toEqual(["1-a copy.txt"]);
    expect(await isLockedOnDisk(join(trashDir, "1-a copy.txt"))).toBe(true);

    expect((await t.undo("redo")).status).toBe("completed");
    expect(await isLockedOnDisk(join(root, "a copy.txt"))).toBe(true);
    expect(await isLockedOnDisk(join(root, "a.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });

  it("puts the lock back when the Trash refuses the copy for another reason", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const flags = new Map<string, number>([[join(root, "a.txt"), UF_IMMUTABLE]]);
    const t = setUpUndo(root, trashDir, {
      getFlags: async (path) => flags.get(path) ?? 0,
      setFlags: async (path, value) => {
        flags.set(path, value);
      },
      trash: async () => {
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      },
    });
    await t.newFolder(root, "F");
    flags.set(join(root, "F"), UF_IMMUTABLE);

    const undone = await t.undo();

    expect(undone.status).toBe("failed");
    expect(flags.get(join(root, "F"))).toBe(UF_IMMUTABLE);
    await t.coordinator.shutdown();
  });

  it("leaves a copy locked by the system, and says it is locked", async () => {
    const t = setUpUndo(root, trashDir, {
      getFlags: async () => SF_IMMUTABLE,
      setFlags: async () => {
        throw new Error("setFlags shouldn't be called");
      },
    });
    await t.newFolder(root, "F");

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "“F” is locked. Unlock it in Finder's Get Info and try again.",
      }),
    ]);
    expect(existsSync(join(root, "F"))).toBe(true);
    await t.coordinator.shutdown();
  });
});
