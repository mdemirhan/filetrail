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
  // Access rules and read-only folders some tests make, which would keep them from going.
  execFileSync("chmod", ["-R", "-N", root]);
  execFileSync("chmod", ["-R", "u+rwx", root]);
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

  it("moves a copy Redo put back locked to the Trash again on the next Undo", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    execFileSync("chflags", ["uchg", join(root, "a.txt")]);
    const t = setUpUndo(root, trashDir);
    await paste(
      t.history,
      { mode: "copy", sourcePaths: [join(root, "a.txt")], destinationDirectoryPath: root },
      "duplicate",
    );
    await t.undo();
    await t.undo("redo");

    expect((await t.undo()).status).toBe("completed");

    expect(existsSync(join(root, "a copy.txt"))).toBe(false);
    expect(await isLockedOnDisk(join(trashDir, "2-a copy.txt"))).toBe(true);
    expect((await t.undo("redo")).status).toBe("completed");
    expect(await isLockedOnDisk(join(root, "a copy.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });

  it("doesn't unlock an item put back from the Trash that was locked since", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUpUndo(root, trashDir);
    await t.trash(join(root, "a.txt"));
    await t.undo();
    execFileSync("chflags", ["uchg", join(root, "a.txt")]);

    const redone = await t.undo("redo");

    expect(redone.result?.items).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "“a.txt” is locked. Unlock it in Finder's Get Info and try again.",
      }),
    ]);
    expect(await isLockedOnDisk(join(root, "a.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });

  it.each([
    ["moved to the Trash", "undo"],
    ["put back", "redo"],
  ] as const)("says so when a copy %s can't be locked again", async (_label, direction) => {
    writeFileSync(join(root, "a.txt"), "a");
    execFileSync("chflags", ["uchg", join(root, "a.txt")]);
    let refuseLock = false;
    const t = setUpUndo(root, trashDir, {
      setFlags: async (path, flags) => {
        if (refuseLock && (flags & UF_IMMUTABLE) !== 0) {
          throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
        }
        await native.nativeSetFlags(path, flags);
      },
    });
    await paste(
      t.history,
      { mode: "copy", sourcePaths: [join(root, "a.txt")], destinationDirectoryPath: root },
      "duplicate",
    );
    if (direction === "redo") {
      await t.undo();
    }
    refuseLock = true;

    const ended = await t.undo(direction);

    // Done, with a note: nothing is left for the same command to try again.
    expect(ended.status).toBe("completed");
    expect(ended.result?.items).toEqual([
      expect.objectContaining({
        status: "completed",
        note: true,
        error:
          "“a copy.txt” was moved, but its lock or permissions couldn't be put back. Set them in Finder's Get Info.",
      }),
    ]);
    // Done all the same: the other command is next.
    expect(t.history.top(direction)).toBeNull();
    await t.coordinator.shutdown();
  });

  it("keeps a copy in the Trash to put back again when it can't be unlocked", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    execFileSync("chflags", ["uchg", join(root, "a.txt")]);
    let refuseUnlock = false;
    const t = setUpUndo(root, trashDir, {
      setFlags: async (path, flags) => {
        if (refuseUnlock && (flags & UF_IMMUTABLE) === 0) {
          throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
        }
        await native.nativeSetFlags(path, flags);
      },
    });
    await paste(
      t.history,
      { mode: "copy", sourcePaths: [join(root, "a.txt")], destinationDirectoryPath: root },
      "duplicate",
    );
    await t.undo();
    refuseUnlock = true;

    const redone = await t.undo("redo");

    expect(redone.status).toBe("failed");
    expect(readdirSync(trashDir)).toEqual(["1-a copy.txt"]);
    expect(t.history.menu().redo).toBe("Duplicate of “a copy.txt”");
    refuseUnlock = false;
    expect((await t.undo("redo")).status).toBe("completed");
    expect(await isLockedOnDisk(join(root, "a copy.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });

  it("says so when an item the Trash refused can't be locked again", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const flags = new Map<string, number>();
    const t = setUpUndo(root, trashDir, {
      getFlags: async (path) => flags.get(path) ?? 0,
      setFlags: async (path, value) => {
        if ((value & UF_IMMUTABLE) !== 0) {
          throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
        }
        flags.set(path, value);
      },
      trash: async () => {
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      },
    });
    await t.newFolder(root, "F");
    flags.set(join(root, "F"), UF_IMMUTABLE);

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "failed",
        error: expect.stringMatching(
          / “F” couldn't be locked again\. Lock it in Finder's Get Info\.$/u,
        ),
      }),
    ]);
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

  it("lets go of a copy locked by the system, and says why", async () => {
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
        status: "skipped",
        error: "“F” is locked by the system, so it can't be moved.",
      }),
    ]);
    expect(existsSync(join(root, "F"))).toBe(true);
    // It never can be: not kept to be tried again.
    expect(t.history.menu().undo).toBeNull();
    await t.coordinator.shutdown();
  });
});

// A copy of ~/Documents (or Desktop, Downloads) carries its rule against deleting it, and a
// copy of a read-only folder is read-only: the Trash refuses both. They are the operation's
// own copies, so Undo takes the rule off (or makes the folder writable) to move them there,
// and puts it back on in the Trash; Redo does the same to put them back.
describe("undoing a copy the Trash would refuse", () => {
  function aclOf(path: string): string {
    return execFileSync("/bin/ls", ["-led", path]).toString().split("\n").slice(1).join("\n");
  }

  it("moves a copy with a rule against deleting it to the Trash, rule and all", async () => {
    mkdirSync(join(root, "Documents"));
    writeFileSync(join(root, "Documents", "a.txt"), "a");
    execFileSync("chmod", ["+a", "group:everyone deny delete", join(root, "Documents")]);
    const t = setUpUndo(root, trashDir);
    await paste(
      t.history,
      { mode: "copy", sourcePaths: [join(root, "Documents")], destinationDirectoryPath: root },
      "duplicate",
    );
    expect(aclOf(join(root, "Documents copy"))).toContain("deny delete");

    expect((await t.undo()).status).toBe("completed");
    expect(existsSync(join(root, "Documents copy"))).toBe(false);
    expect(aclOf(join(trashDir, "1-Documents copy"))).toContain("deny delete");

    expect((await t.undo("redo")).status).toBe("completed");
    expect(aclOf(join(root, "Documents copy"))).toContain("deny delete");

    // And again: the copy Redo put back is still the operation's own.
    expect((await t.undo()).status).toBe("completed");
    expect(existsSync(join(root, "Documents copy"))).toBe(false);
    expect(aclOf(join(trashDir, "2-Documents copy"))).toContain("deny delete");
    await t.coordinator.shutdown();
  });

  it("moves a copy of a read-only folder to the Trash, still read-only", async () => {
    mkdirSync(join(root, "cache"));
    writeFileSync(join(root, "cache", "a.txt"), "a");
    execFileSync("chmod", ["555", join(root, "cache")]);
    const t = setUpUndo(root, trashDir);
    await paste(
      t.history,
      { mode: "copy", sourcePaths: [join(root, "cache")], destinationDirectoryPath: root },
      "duplicate",
    );

    expect((await t.undo()).status).toBe("completed");
    expect(existsSync(join(root, "cache copy"))).toBe(false);
    expect(
      execFileSync("stat", ["-f", "%Lp", join(trashDir, "1-cache copy")])
        .toString()
        .trim(),
    ).toBe("555");
    expect((await t.undo("redo")).status).toBe("completed");
    expect(
      execFileSync("stat", ["-f", "%Lp", join(root, "cache copy")])
        .toString()
        .trim(),
    ).toBe("555");

    expect((await t.undo()).status).toBe("completed");
    expect(existsSync(join(root, "cache copy"))).toBe(false);
    expect(
      execFileSync("stat", ["-f", "%Lp", join(trashDir, "2-cache copy")])
        .toString()
        .trim(),
    ).toBe("555");
    await t.coordinator.shutdown();
  });
});
