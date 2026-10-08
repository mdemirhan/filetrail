import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  REPLACE_ALL,
  nativeFileSystem,
  nativeFileSystemWithTrash,
  runPaste,
} from "@filetrail/core/fs/testNativePaste";

import { originalRenameExclusive } from "../originalFileSystem";
import { classifyUndoWriteError } from "./undoExecution";
import { folderTrash, paste, setUpUndo, snapshotOf } from "./undoRealDisk.testkit";

// What an Undo leaves to do: a step whose write failed stays on the Undo list to be tried
// again, a stopped Undo goes on from where it stopped, and what changed outside the app is
// dropped. Redo only ever does again what Undo really did.

let root: string;
let trashDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "filetrail-undo-failures-"));
  trashDir = join(root, ".Trash");
  mkdirSync(trashDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function snapshot(): string[] {
  return snapshotOf(root, trashDir).filter((line) => !line.startsWith("paste-trash"));
}

function permissionDenied(): NodeJS.ErrnoException {
  return Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
}

// The Trash failing on a disk macOS says has none.
function noTrash(): NodeJS.ErrnoException {
  return Object.assign(new Error("no Trash"), {
    code: "ENOTRASH",
    cause: Object.assign(new Error("not supported"), { code: "ENOTSUP" }),
  });
}

describe("a write that fails", () => {
  it("keeps the operation on top of the Undo list, to be tried again", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    let denied = true;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (denied) {
          throw permissionDenied();
        }
        renameSync(from, to);
      },
    });
    denied = false;
    await t.rename(join(root, "a.txt"), "b.txt");
    const entry = t.history.top("undo");
    denied = true;

    const failed = await t.undo();

    expect(failed.status).toBe("failed");
    expect(t.history.top("undo")).toEqual(entry);
    expect(t.history.menu()).toEqual({ undo: "Rename", redo: null, cantUndo: false });

    denied = false;
    expect((await t.undo()).status).toBe("completed");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("a");
    expect(t.history.menu()).toEqual({ undo: null, redo: "Rename", cantUndo: false });
    await t.coordinator.shutdown();
  });

  it("keeps only the items whose write failed; the rest go to Redo", async () => {
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      writeFileSync(join(root, name), name);
    }
    let denied = true;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (denied && to === join(root, "b.txt")) {
          throw permissionDenied();
        }
        renameSync(from, to);
      },
    });
    const before = snapshot();
    await t.trash(join(root, "a.txt"), join(root, "b.txt"), join(root, "c.txt"));

    const partly = await t.undo();

    expect(partly.status).toBe("partial");
    expect(partly.result?.items.map((item) => item.status)).toEqual([
      "completed",
      "failed",
      "completed",
    ]);
    expect(t.history.menu()).toEqual({
      undo: "Move to Trash of “b.txt”",
      redo: "Move to Trash of 2 Items",
      cantUndo: false,
    });

    denied = false;
    await t.undo();
    expect(snapshot()).toEqual(before);
    expect(t.history.menu().undo).toBeNull();
    await t.coordinator.shutdown();
  });

  it("keeps the steps of a Replace after one that failed, and goes on from there", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    mkdirSync(join(root, "paste-trash"));
    writeFileSync(join(root, "src", "a.txt"), "new");
    writeFileSync(join(root, "dst", "a.txt"), "old");
    let denied = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        // Putting the old item back from the Trash fails, once.
        if (denied && to === join(root, "dst", "a.txt")) {
          denied = false;
          throw permissionDenied();
        }
        renameSync(from, to);
      },
    });
    const before = snapshot();
    await paste(t.history, {
      mode: "cut",
      sourcePaths: [join(root, "src", "a.txt")],
      destinationDirectoryPath: join(root, "dst"),
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(join(root, "paste-trash")),
    });
    denied = true;

    expect((await t.undo()).status).toBe("partial");
    expect(readFileSync(join(root, "src", "a.txt"), "utf8")).toBe("new");
    expect(existsSync(join(root, "dst", "a.txt"))).toBe(false);
    // Still a move: what is left of it is only the old item's trip to the Trash.
    expect(t.history.menu()).toEqual({
      undo: "Move of “a.txt”",
      redo: "Move of “a.txt”",
      cantUndo: false,
    });

    await t.undo();
    expect(snapshot()).toEqual(before);
    await t.coordinator.shutdown();
  });

  it("keeps the items of a batch whose rename back failed", async () => {
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      writeFileSync(join(root, name), name);
    }
    let denied = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (denied && to === join(root, "b.txt")) {
          throw permissionDenied();
        }
        renameSync(from, to);
      },
    });
    const before = snapshot();
    await t.batchRename([
      [join(root, "a.txt"), "x.txt"],
      [join(root, "b.txt"), "y.txt"],
      [join(root, "c.txt"), "z.txt"],
    ]);
    denied = true;

    expect((await t.undo()).status).toBe("partial");
    expect(t.history.menu()).toEqual({
      undo: "Rename",
      redo: "Rename of 2 Items",
      cantUndo: false,
    });

    denied = false;
    await t.undo();
    expect(snapshot()).toEqual(before);
    await t.coordinator.shutdown();
  });

  it("swaps two names back in two tries when one item failed the first time", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    let failOnce = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        // The item now named "a.txt" can't be moved aside, once.
        if (failOnce && from === join(root, "a.txt")) {
          failOnce = false;
          throw permissionDenied();
        }
        await originalRenameExclusive(from, to);
      },
    });
    const before = snapshot();
    await t.batchRename([
      [join(root, "a.txt"), "b.txt"],
      [join(root, "b.txt"), "a.txt"],
    ]);
    const after = snapshot();
    failOnce = true;

    const failed = await t.undo();
    expect(failed.status).toBe("failed");
    // The other one took a number rather than wait, and was renamed straight back: nothing
    // is undone, and both are tried again.
    expect(snapshot()).toEqual(after);
    expect(failed.result?.items.map((item) => [item.status, item.error])).toEqual([
      ["failed", "“b.txt” was left as it is, because “a.txt” couldn't be renamed out of its way."],
      ["failed", "You don't have permission to access this item."],
    ]);
    expect(t.history.menu()).toEqual({ undo: "Rename of 2 Items", redo: null, cantUndo: false });

    expect((await t.undo()).status).toBe("completed");
    expect(snapshot()).toEqual(before);
    expect(t.history.menu()).toEqual({ undo: null, redo: "Rename of 2 Items", cantUndo: false });

    expect((await t.undo("redo")).status).toBe("completed");
    expect(snapshot()).toEqual(after);
    await t.coordinator.shutdown();
  });

  it("records where an item that waits under a number went, when it can't be renamed straight back", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    let failing = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        // The item now named "a.txt" can't be moved aside, nor the other one renamed back
        // from the number it took.
        if (failing && (from === join(root, "a.txt") || from === join(root, "a 2.txt"))) {
          throw permissionDenied();
        }
        await originalRenameExclusive(from, to);
      },
    });
    const before = snapshot();
    await t.batchRename([
      [join(root, "a.txt"), "b.txt"],
      [join(root, "b.txt"), "a.txt"],
    ]);
    const after = snapshot();
    failing = true;

    const failed = await t.undo();
    expect(failed.result?.items.map((item) => [item.status, item.destinationPath])).toEqual([
      ["failed", join(root, "a 2.txt")],
      ["failed", null],
    ]);
    // Moved, so on Redo; not back yet, so still to undo.
    expect(t.history.menu()).toEqual({
      undo: "Rename of 2 Items",
      redo: "Rename",
      cantUndo: false,
    });

    // Redo first: it goes back where it was. Undo then takes it to the number again, and
    // does both; Redo, each try in turn.
    failing = false;
    expect((await t.undo("redo")).status).toBe("completed");
    expect(snapshot()).toEqual(after);
    await t.undo();
    await t.undo();
    expect(snapshot()).toEqual(before);
    expect(t.history.menu()).toEqual({ undo: null, redo: "Rename of 2 Items", cantUndo: false });
    await t.undo("redo");
    await t.undo("redo");
    expect(snapshot()).toEqual(after);
    expect(t.history.menu()).toEqual({ undo: "Rename", redo: null, cantUndo: false });
    await t.coordinator.shutdown();
  });

  it("renames a folder that waits straight back with the items inside it", async () => {
    mkdirSync(join(root, "A"));
    writeFileSync(join(root, "A", "in.txt"), "in");
    mkdirSync(join(root, "B"));
    let failing = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (failing && from === join(root, "A")) {
          throw permissionDenied();
        }
        await originalRenameExclusive(from, to);
      },
    });
    const before = snapshot();
    await t.batchRename([
      [join(root, "A", "in.txt"), "out.txt"],
      [join(root, "A"), "B", true],
      [join(root, "B"), "A", true],
    ]);
    const after = snapshot();
    failing = true;

    expect((await t.undo()).status).toBe("partial");
    // Only the item inside, which nothing held, is renamed back.
    expect(readdirSync(join(root, "A"))).toEqual([]);
    expect(readdirSync(join(root, "B"))).toEqual(["in.txt"]);
    expect(snapshot()).not.toEqual(after);

    failing = false;
    await t.undo();
    expect(snapshot()).toEqual(before);
    await t.coordinator.shutdown();
  });

  it("lets go of a copy on a disk without a Trash, which would fail each time, and says why", async () => {
    const t = setUpUndo(root, trashDir, {
      trash: async () => {
        throw noTrash();
      },
    });
    await t.newFolder(root, "F");

    const undone = await t.undo();

    expect(undone.status).toBe("failed");
    expect(undone.result?.error).toBe(
      "“F” couldn't be moved to the Trash because its disk has no Trash.",
    );
    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        sourcePath: join(root, "F"),
        status: "skipped",
        error: "“F” couldn't be moved to the Trash because its disk has no Trash.",
      }),
    ]);
    expect(existsSync(join(root, "F"))).toBe(true);
    // Not kept to be tried again: an older operation is next.
    expect(t.history.menu()).toEqual({ undo: null, redo: null, cantUndo: false });
    await t.coordinator.shutdown();
  });

  it("keeps a copy the Trash refused without saying why, on a disk that has a Trash", async () => {
    const unsaid = () => Object.assign(new Error("couldn't be moved"), { code: "ENOTRASH" });
    const t = setUpUndo(root, trashDir, {
      trash: async () => {
        throw unsaid();
      },
    });
    await t.newFolder(root, "F");

    expect((await t.undo()).result?.items).toEqual([
      expect.objectContaining({ status: "failed", error: "couldn't be moved" }),
    ]);
    expect(t.history.menu().undo).toBe("New Folder");
    await t.coordinator.shutdown();

    // On a network share, which has none, it is let go.
    const share = setUpUndo(
      root,
      trashDir,
      {
        trash: async () => {
          throw unsaid();
        },
      },
      { diskHasTrash: () => false },
    );
    await share.newFolder(root, "G");
    expect((await share.undo()).result?.items).toEqual([
      expect.objectContaining({ status: "skipped", error: expect.stringContaining("no Trash") }),
    ]);
    expect(share.history.menu().undo).toBeNull();
    await share.coordinator.shutdown();
  });
});

// Each error a write can fail with, and what Undo does then: an item gone or a name taken
// is a change outside the app (skipped and let go, as the disk check does); what would fail
// every time is let go and said; anything else stays to be tried again.
describe("a write that fails, by its error", () => {
  function failing(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(`${code}: failed on purpose`), { code });
  }

  it("classifies each error code", () => {
    expect(classifyUndoWriteError("ENOENT")).toBe("outside_change");
    expect(classifyUndoWriteError("ENOTDIR")).toBe("outside_change");
    expect(classifyUndoWriteError("EEXIST")).toBe("outside_change");
    expect(classifyUndoWriteError("ENOTRASH")).toBe("permanent");
    expect(classifyUndoWriteError("EROFS")).toBe("permanent");
    expect(classifyUndoWriteError("EXDEV")).toBe("permanent");
    expect(classifyUndoWriteError("EACCES")).toBe("retry");
    expect(classifyUndoWriteError("EPERM")).toBe("retry");
    expect(classifyUndoWriteError("EBUSY")).toBe("retry");
    expect(classifyUndoWriteError(undefined)).toBe("retry");
  });

  it.each([
    ["EACCES", "failed", "You don't have permission to access this item.", "Rename"],
    ["EROFS", "skipped", "“b.txt” is on a disk that can only be read.", null],
    ["EXDEV", "skipped", "“b.txt” is on another disk now.", null],
    ["ENOENT", "skipped", "“b.txt” is no longer in", null],
    ["EEXIST", "skipped", "An item named “a", null],
  ])("renaming back fails with %s", async (code, status, error, left) => {
    writeFileSync(join(root, "a.txt"), "a");
    let denied = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (denied) {
          throw failing(code);
        }
        renameSync(from, to);
      },
    });
    await t.rename(join(root, "a.txt"), "b.txt");
    denied = true;

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({ status, error: expect.stringContaining(error) }),
    ]);
    expect(existsSync(join(root, "b.txt"))).toBe(true);
    expect(t.history.menu().undo).toBe(left);
    await t.coordinator.shutdown();
  });

  it.each([
    ["EACCES", "failed", "New Folder"],
    ["ENOENT", "skipped", null],
    ["EROFS", "skipped", null],
  ])("the Trash fails with %s", async (code, status, left) => {
    const t = setUpUndo(root, trashDir, {
      trash: async () => {
        throw failing(code);
      },
    });
    await t.newFolder(root, "F");

    expect((await t.undo()).result?.items).toEqual([expect.objectContaining({ status })]);
    expect(t.history.menu().undo).toBe(left);
    await t.coordinator.shutdown();
  });

  it.each([
    ["EACCES", "failed"],
    ["EROFS", "skipped"],
  ])("an item of a batch fails with %s", async (code, status) => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    let denied = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (denied && from === join(root, "x.txt")) {
          throw failing(code);
        }
        renameSync(from, to);
      },
    });
    await t.batchRename([
      [join(root, "a.txt"), "x.txt"],
      [join(root, "b.txt"), "y.txt"],
    ]);
    denied = true;

    const undone = await t.undo();

    expect(undone.result?.items.map((item) => item.status).sort()).toEqual(
      ["completed", status].sort(),
    );
    expect(existsSync(join(root, "x.txt"))).toBe(true);
    // What failed for good is let go; what may work next time stays, with the item the
    // batch did on Redo.
    expect(t.history.menu()).toEqual({
      undo: status === "failed" ? "Rename" : null,
      redo: "Rename",
      cantUndo: false,
    });
    await t.coordinator.shutdown();
  });
});

describe("a stop as the last item of a batch is renamed back", () => {
  it("stops nothing, and leaves nothing to undo", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    let stopping = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        await originalRenameExclusive(from, to);
        if (stopping && to === join(root, "b.txt")) {
          t.coordinator.handlers["writeOperation:cancel"](
            { operationId: t.coordinator.getActiveOperation()?.operationId ?? "" },
            { sender: t.sender },
          );
        }
      },
    });
    const before = snapshot();
    await t.batchRename([
      [join(root, "a.txt"), "x.txt"],
      [join(root, "b.txt"), "y.txt"],
    ]);
    stopping = true;

    const undone = await t.undo();

    expect(undone.status).toBe("completed");
    expect(snapshot()).toEqual(before);
    expect(t.history.menu()).toEqual({ undo: null, redo: "Rename of 2 Items", cantUndo: false });
    await t.coordinator.shutdown();
  });
});

describe("a stop inside a Replace", () => {
  // A moving Replace undone up to the stop: the new item went back where it came from,
  // the old item is still in the Trash.
  async function stoppedHalfway() {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    mkdirSync(join(root, "paste-trash"));
    writeFileSync(join(root, "src", "a.txt"), "new");
    writeFileSync(join(root, "dst", "a.txt"), "old");
    let stopAfterNextMove = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        renameSync(from, to);
        if (stopAfterNextMove) {
          stopAfterNextMove = false;
          t.coordinator.handlers["writeOperation:cancel"](
            { operationId: t.coordinator.getActiveOperation()?.operationId ?? "" },
            { sender: t.sender },
          );
        }
      },
    });
    const before = snapshot();
    await paste(t.history, {
      mode: "cut",
      sourcePaths: [join(root, "src", "a.txt")],
      destinationDirectoryPath: join(root, "dst"),
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(join(root, "paste-trash")),
    });
    const after = snapshot();
    stopAfterNextMove = true;

    const stopped = await t.undo();

    expect(stopped.status).toBe("partial");
    expect(readFileSync(join(root, "src", "a.txt"), "utf8")).toBe("new");
    expect(existsSync(join(root, "dst", "a.txt"))).toBe(false);
    expect(t.history.menu()).toEqual({
      undo: "Move of “a.txt”",
      redo: "Move of “a.txt”",
      cantUndo: false,
    });
    return { t, before, after };
  }

  it("puts the old item back on the next Undo", async () => {
    const { t, before } = await stoppedHalfway();

    expect((await t.undo()).status).toBe("completed");

    expect(snapshot()).toEqual(before);
    expect(readFileSync(join(root, "dst", "a.txt"), "utf8")).toBe("old");
    expect(readdirSync(join(root, "paste-trash"))).toEqual([]);
    expect(t.history.menu().undo).toBeNull();
    await t.coordinator.shutdown();
  });

  it("brings the new item back on Redo, with the rest still to undo", async () => {
    const { t, before, after } = await stoppedHalfway();

    expect((await t.undo("redo")).status).toBe("completed");

    expect(snapshot()).toEqual(after);
    expect(t.history.menu()).toEqual({ undo: "Move of “a.txt”", redo: null, cantUndo: false });
    await t.undo();
    await t.undo();
    expect(snapshot()).toEqual(before);
    expect(t.history.menu().undo).toBeNull();
    await t.coordinator.shutdown();
  });
});

describe("a batch rename another app got in the way of", () => {
  it("renames back an item left under a numbered name", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        await originalRenameExclusive(from, to);
        // Once "a" has taken "b.txt", another app makes a new "a.txt": "b" can't take it,
        // and its own old name is taken, so it is left as "b 2.txt".
        if (to === join(root, "b.txt")) {
          writeFileSync(join(root, "a.txt"), "outside");
        }
      },
    });
    const renamed = await t.finish(
      t.coordinator.handlers["writeOperation:batchRename"](
        {
          items: [
            { sourcePath: join(root, "a.txt"), destinationName: "b.txt", isFolder: false },
            { sourcePath: join(root, "b.txt"), destinationName: "a.txt", isFolder: false },
          ],
          onConflict: "skip",
          numberSeparator: " ",
        },
        { sender: t.sender },
      ),
    );
    expect(renamed.result?.items.map((item) => [item.status, item.destinationPath])).toEqual([
      ["completed", join(root, "b.txt")],
      ["failed", join(root, "b 2.txt")],
    ]);

    expect(await t.prepare()).toMatchObject({ nameTaken: ["a.txt"] });
    await t.undo();

    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("outside");
    expect(readFileSync(join(root, "a 2.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("b");
    expect(existsSync(join(root, "b 2.txt"))).toBe(false);
    await t.coordinator.shutdown();
  });
});

describe("the Trash not saying where an item went", () => {
  // A Trash that takes the item and says nothing of where it put it.
  function silentTrash(path: string): Promise<null> {
    renameSync(path, join(trashDir, `somewhere-${Date.now()}-${Math.random()}`));
    return Promise.resolve(null);
  }

  it("makes a Move to Trash one that can't be undone", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    const toTrash = folderTrash(trashDir);
    const t = setUpUndo(root, trashDir, {
      trash: (path) => (path.endsWith("b.txt") ? silentTrash(path) : toTrash(path)),
    });

    expect((await t.trash(join(root, "a.txt"), join(root, "b.txt"))).status).toBe("completed");

    expect(t.history.menu()).toEqual({ undo: null, redo: null, cantUndo: true });
    await t.coordinator.shutdown();
  });

  it("makes a paste whose Replace put the old item there one that can't be undone", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    writeFileSync(join(root, "src", "a.txt"), "new");
    writeFileSync(join(root, "dst", "a.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(root, "src", "a.txt")],
      destinationDirectoryPath: join(root, "dst"),
      policy: REPLACE_ALL,
      fileSystem: { ...nativeFileSystem, trash: silentTrash },
    });

    expect(result?.status).toBe("completed");
    expect(result?.undoLog).toEqual({ undoable: false, reason: "trash_location_unknown" });
  });

  it("counts an Undo's trip to the Trash as done, with nothing to redo", async () => {
    const t = setUpUndo(root, trashDir, { trash: silentTrash });
    await t.newFolder(root, "F");

    expect((await t.undo()).status).toBe("completed");

    expect(existsSync(join(root, "F"))).toBe(false);
    expect(t.history.menu()).toEqual({ undo: null, redo: null, cantUndo: false });
    await t.coordinator.shutdown();
  });
});

describe("an Undo's progress", () => {
  it("counts what it has done out of all it has to do, steps and batch items alike", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    mkdirSync(join(root, "paste-trash"));
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      writeFileSync(join(root, "src", name), name);
      writeFileSync(join(root, "dst", name), "old");
    }
    const t = setUpUndo(root, trashDir);
    // Three Replaces: six steps.
    await paste(t.history, {
      mode: "copy",
      sourcePaths: ["a.txt", "b.txt", "c.txt"].map((name) => join(root, "src", name)),
      destinationDirectoryPath: join(root, "dst"),
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(join(root, "paste-trash")),
    });
    await t.undo();
    // A batch of three: one step, three items.
    await t.batchRename(
      ["a.txt", "b.txt", "c.txt"].map((name) => [join(root, "dst", name), `x ${name}`]),
    );
    await t.undo();

    const undoEvents = t.events().filter((event) => event.action === "undo");
    const totals = [...new Set(undoEvents.map((event) => event.totalItemCount))].filter(
      (total) => total > 0,
    );
    expect(totals).toEqual([6, 3]);
    for (const event of undoEvents) {
      expect(event.completedItemCount).toBeLessThanOrEqual(event.totalItemCount);
    }
    expect(undoEvents.filter((event) => event.status === "completed")).toEqual([
      expect.objectContaining({ completedItemCount: 6, totalItemCount: 6 }),
      expect.objectContaining({ completedItemCount: 3, totalItemCount: 3 }),
    ]);
    await t.coordinator.shutdown();
  });
});

describe("Redo after a partial Undo", () => {
  it("does again only what Undo really did", async () => {
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      writeFileSync(join(root, name), name);
    }
    const t = setUpUndo(root, trashDir);
    await t.trash(join(root, "a.txt"), join(root, "b.txt"), join(root, "c.txt"));
    // Renamed in the Trash, outside the app.
    renameSync(join(trashDir, "2-b.txt"), join(trashDir, "renamed.txt"));

    const undone = await t.undo();
    expect(undone.status).toBe("partial");
    expect(t.history.menu()).toEqual({
      undo: null,
      redo: "Move to Trash of 2 Items",
      cantUndo: false,
    });

    const redone = await t.undo("redo");

    expect(redone.status).toBe("completed");
    expect(redone.result?.items.map((item) => item.sourcePath)).toEqual([
      join(root, "a.txt"),
      join(root, "c.txt"),
    ]);
    expect(readdirSync(trashDir).sort()).toEqual(["4-a.txt", "5-c.txt", "renamed.txt"]);
    await t.coordinator.shutdown();
  });
});

describe("an item of a batch that goes away as it is renamed back", () => {
  it("is skipped, as one the check finds gone, and not kept", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    let removing = false;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (removing && from === join(root, "x.txt")) {
          rmSync(from);
        }
        await originalRenameExclusive(from, to);
      },
    });
    await t.batchRename([
      [join(root, "a.txt"), "x.txt"],
      [join(root, "b.txt"), "y.txt"],
    ]);
    removing = true;

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: `“x.txt” is no longer in “${basename(root)}”.`,
      }),
      expect.objectContaining({ status: "completed" }),
    ]);
    expect(t.history.menu()).toEqual({ undo: null, redo: "Rename", cantUndo: false });
    await t.coordinator.shutdown();
  });
});

describe("an Undo that stops unexpectedly", () => {
  it("keeps the operation on the Undo list, to be tried again", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let broken = false;
    const t = setUpUndo(root, trashDir, {
      itemSize: (path) => {
        if (broken && path === join(root, "F")) {
          throw new Error("Disk gone.");
        }
        return Promise.reject(new Error("not measured"));
      },
    });
    await t.newFolder(root, "F");
    broken = true;

    const undone = await t.undo();

    expect(undone.status).toBe("failed");
    expect(undone.result?.error).toBe("The Undo stopped unexpectedly: Disk gone.");
    expect(t.history.menu()).toEqual({ undo: "New Folder", redo: null, cantUndo: false });
    broken = false;
    expect((await t.undo()).status).toBe("completed");
    expect(existsSync(join(root, "F"))).toBe(false);
    quiet.mockRestore();
    await t.coordinator.shutdown();
  });
});
