import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

import { REPLACE_ALL, nativeFileSystemWithTrash } from "@filetrail/core/fs/testNativePaste";

import { paste, setUpUndo, snapshotOf } from "./undoRealDisk.testkit";
import type { WriteOperationFs } from "./writeOperations";

// Undo and Redo on a real disk, through the write coordinator as the app runs them: each
// operation's round trip, chains, and what happens when things changed in between.

let root: string;
let trashDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "filetrail-undo-"));
  trashDir = join(root, ".Trash");
  mkdirSync(trashDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function snapshot(): string[] {
  return snapshotOf(root, trashDir);
}

function inTrash(): string[] {
  return readdirSync(trashDir).sort();
}

function setUp(fsOverrides: Partial<WriteOperationFs> = {}) {
  return setUpUndo(root, trashDir, fsOverrides);
}

describe("round trips", () => {
  it("renames back, and again on Redo", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    const before = snapshot();
    await t.rename(join(root, "a.txt"), "b.txt");
    const after = snapshot();

    expect((await t.undo()).status).toBe("completed");
    expect(snapshot()).toEqual(before);
    expect(t.history.menu()).toEqual({ undo: null, redo: "Rename", cantUndo: false });

    expect((await t.undo("redo")).status).toBe("completed");
    expect(snapshot()).toEqual(after);
    expect(t.history.menu()).toEqual({ undo: "Rename", redo: null, cantUndo: false });
    await t.coordinator.shutdown();
  });

  it("renames back a name that differs only in case", async () => {
    writeFileSync(join(root, "notes.txt"), "a");
    const t = setUp();
    const before = snapshot();
    await t.rename(join(root, "notes.txt"), "Notes.txt");

    expect((await t.undo()).status).toBe("completed");

    expect(snapshot()).toEqual(before);
    await t.coordinator.shutdown();
  });

  it("moves a new folder to the Trash, and puts it back on Redo", async () => {
    const t = setUp();
    const before = snapshot();
    await t.newFolder(root, "New");
    const after = snapshot();

    await t.undo();
    expect(snapshot()).toEqual(before);
    expect(inTrash()).toEqual(["1-New"]);

    await t.undo("redo");
    expect(snapshot()).toEqual(after);
    expect(inTrash()).toEqual([]);
    await t.coordinator.shutdown();
  });

  it("puts items back from the Trash, and moves them there again on Redo", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    mkdirSync(join(root, "Folder"));
    writeFileSync(join(root, "Folder", "inside.txt"), "inside");
    const t = setUp();
    const before = snapshot();
    await t.trash(join(root, "a.txt"), join(root, "Folder"));
    expect(t.history.menu().undo).toBe("Move to Trash of 2 Items");

    const undone = await t.undo();
    expect(snapshot()).toEqual(before);
    expect(inTrash()).toEqual([]);
    // A put back reads as a move out of the Trash.
    expect(undone.result?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: join(trashDir, "1-a.txt"),
          destinationPath: join(root, "a.txt"),
          status: "completed",
        }),
      ]),
    );

    await t.undo("redo");
    expect(existsSync(join(root, "a.txt"))).toBe(false);
    expect(inTrash()).toHaveLength(2);
    await t.undo();
    expect(snapshot()).toEqual(before);
    await t.coordinator.shutdown();
  });

  it("renames a batch back, swaps and a folder with items in it included", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    mkdirSync(join(root, "F"));
    writeFileSync(join(root, "F", "c.txt"), "c");
    const t = setUp();
    const before = snapshot();
    await t.batchRename([
      [join(root, "a.txt"), "b.txt"],
      [join(root, "b.txt"), "a.txt"],
      [join(root, "F"), "G", true],
      [join(root, "F", "c.txt"), "d.txt"],
    ]);
    const after = snapshot();
    expect(readFileSync(join(root, "G", "d.txt"), "utf8")).toBe("c");

    await t.undo();
    expect(snapshot()).toEqual(before);
    await t.undo("redo");
    expect(snapshot()).toEqual(after);
    await t.coordinator.shutdown();
  });

  it("moves copies to the Trash, and puts them back on Redo", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    writeFileSync(join(root, "src", "a.txt"), "a");
    mkdirSync(join(root, "src", "Folder"));
    const t = setUp();
    const before = snapshot();
    await paste(t.history, {
      mode: "copy",
      sourcePaths: [join(root, "src", "a.txt"), join(root, "src", "Folder")],
      destinationDirectoryPath: join(root, "dst"),
    });
    const after = snapshot();
    expect(t.history.menu().undo).toBe("Copy of 2 Items");

    await t.undo();
    expect(snapshot()).toEqual(before);
    expect(inTrash()).toEqual(["1-Folder", "2-a.txt"]);

    await t.undo("redo");
    expect(snapshot()).toEqual(after);
    await t.coordinator.shutdown();
  });

  it("moves moved items back", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    writeFileSync(join(root, "src", "a.txt"), "a");
    const t = setUp();
    const before = snapshot();
    await paste(t.history, {
      mode: "cut",
      sourcePaths: [join(root, "src", "a.txt")],
      destinationDirectoryPath: join(root, "dst"),
    });
    const after = snapshot();

    await t.undo();
    expect(snapshot()).toEqual(before);
    await t.undo("redo");
    expect(snapshot()).toEqual(after);
    await t.coordinator.shutdown();
  });

  it.each(["copy", "cut"] as const)(
    "takes back a Replace (%s): the new item away, the old one back in its place",
    async (mode) => {
      mkdirSync(join(root, "src"));
      mkdirSync(join(root, "dst"));
      writeFileSync(join(root, "src", "a.txt"), "new");
      writeFileSync(join(root, "dst", "a.txt"), "old");
      const pasteTrash = join(root, "paste-trash");
      mkdirSync(pasteTrash);
      const t = setUp();
      const before = snapshot().filter((line) => !line.startsWith("paste-trash"));
      await paste(t.history, {
        mode,
        sourcePaths: [join(root, "src", "a.txt")],
        destinationDirectoryPath: join(root, "dst"),
        policy: REPLACE_ALL,
        fileSystem: nativeFileSystemWithTrash(pasteTrash),
      });
      expect(readFileSync(join(root, "dst", "a.txt"), "utf8")).toBe("new");

      expect((await t.undo()).status).toBe("completed");

      expect(snapshot().filter((line) => !line.startsWith("paste-trash"))).toEqual(before);
      expect(readFileSync(join(root, "dst", "a.txt"), "utf8")).toBe("old");
      expect(readdirSync(pasteTrash)).toEqual([]);

      // And done again.
      await t.undo("redo");
      expect(readFileSync(join(root, "dst", "a.txt"), "utf8")).toBe("new");
      expect(existsSync(join(root, "src", "a.txt"))).toBe(mode === "copy");
      await t.coordinator.shutdown();
    },
  );

  // A folder's date changes with every item in or out, so it must not count as a change.
  it("doesn't ask about a new folder an item was moved into and back out of", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.newFolder(root, "F");
    await paste(t.history, {
      mode: "cut",
      sourcePaths: [join(root, "a.txt")],
      destinationDirectoryPath: join(root, "F"),
    });
    await t.undo();

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: [] });
    await t.coordinator.shutdown();
  });

  it("doesn't ask about a new folder Finder wrote its view settings into", async () => {
    const t = setUp();
    await t.newFolder(root, "F");
    writeFileSync(join(root, "F", ".DS_Store"), "Finder");

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: [] });
    expect((await t.undo()).status).toBe("completed");
    expect(existsSync(join(root, "F"))).toBe(false);
    await t.coordinator.shutdown();
  });

  it("undoes a chain of operations one by one, back to the start", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    const before = snapshot();
    await t.rename(join(root, "a.txt"), "b.txt");
    await t.newFolder(root, "F");
    await paste(t.history, {
      mode: "cut",
      sourcePaths: [join(root, "b.txt")],
      destinationDirectoryPath: join(root, "F"),
    });
    await t.trash(join(root, "F"));

    for (let step = 0; step < 4; step += 1) {
      expect((await t.undo()).status).toBe("completed");
    }

    expect(snapshot()).toEqual(before);
    expect(t.history.menu().undo).toBeNull();
    await t.coordinator.shutdown();
  });
});

describe("changes made outside the app", () => {
  it("skips an item that is gone, says so, and forgets the operation", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.rename(join(root, "a.txt"), "b.txt");
    rmSync(join(root, "b.txt"));

    const undone = await t.undo();

    expect(undone.status).toBe("failed");
    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: `“b.txt” is no longer in “${basename(root)}”.`,
      }),
    ]);
    expect(t.history.menu()).toEqual({ undo: null, redo: null, cantUndo: false });
    await t.coordinator.shutdown();
  });

  it("asks when an old name is taken, then puts the item back with a number", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    const t = setUp();
    await t.trash(join(root, "a.txt"), join(root, "b.txt"));
    writeFileSync(join(root, "a.txt"), "someone else's");

    expect(await t.prepare()).toMatchObject({ nameTaken: ["a.txt"], changed: [] });
    expect((await t.undo()).status).toBe("completed");

    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("someone else's");
    expect(readFileSync(join(root, "a 2.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("b");
    // Redo moves the very item back to the Trash, under whatever name it has now.
    await t.undo("redo");
    expect(existsSync(join(root, "a 2.txt"))).toBe(false);
    await t.coordinator.shutdown();
  });

  it("puts an item back with a number in a folder whose name is taken", async () => {
    mkdirSync(join(root, "F"));
    const t = setUp();
    await t.trash(join(root, "F"));
    mkdirSync(join(root, "F"));

    await t.undo();

    expect(lstatSync(join(root, "F 2")).isDirectory()).toBe(true);
    await t.coordinator.shutdown();
  });

  it("asks before moving a copy that changed to the Trash, saying it is a duplicate", async () => {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.txt"), "a");
    const t = setUp();
    await paste(
      t.history,
      {
        mode: "copy",
        sourcePaths: [join(root, "src", "a.txt")],
        destinationDirectoryPath: join(root, "src"),
      },
      "duplicate",
    );
    writeFileSync(join(root, "src", "a copy.txt"), "edited since");

    expect(await t.prepare()).toMatchObject({
      action: "duplicate",
      nameTaken: [],
      changed: [{ name: "a copy.txt", putBack: false, replaced: false }],
    });
    await t.undo();
    expect(existsSync(join(root, "src", "a copy.txt"))).toBe(false);
    // The edits went to the Trash with it, and come back with Redo.
    await t.undo("redo");
    expect(readFileSync(join(root, "src", "a copy.txt"), "utf8")).toBe("edited since");
    await t.coordinator.shutdown();
  });

  it("moves a copied folder something was added to the Trash once agreed", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "src", "Folder"));
    const t = setUp();
    await paste(
      t.history,
      {
        mode: "copy",
        sourcePaths: [join(root, "src", "Folder")],
        destinationDirectoryPath: join(root, "src"),
      },
      "duplicate",
    );
    // An item added right inside the copied folder.
    writeFileSync(join(root, "src", "Folder copy", "added.txt"), "added");

    expect((await t.prepare()).changed).toEqual([
      { name: "Folder copy", putBack: false, replaced: false },
    ]);
    await t.undo();

    expect(existsSync(join(root, "src", "Folder copy"))).toBe(false);
    expect(inTrash()).toEqual(["1-Folder copy"]);
    await t.coordinator.shutdown();
  });

  it("never moves another item that took a copy's name to the Trash", async () => {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.txt"), "a");
    const t = setUp();
    await paste(
      t.history,
      {
        mode: "copy",
        sourcePaths: [join(root, "src", "a.txt")],
        destinationDirectoryPath: join(root, "src"),
      },
      "duplicate",
    );
    rmSync(join(root, "src", "a copy.txt"));
    mkdirSync(join(root, "src", "a copy.txt"));

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: "The “a copy.txt” in “src” is another item now.",
      }),
    ]);
    expect(existsSync(join(root, "src", "a copy.txt"))).toBe(true);
    expect(inTrash()).toEqual([]);
    await t.coordinator.shutdown();
  });

  it("still renames back a file an app saved under a new id", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.rename(join(root, "a.txt"), "b.txt");
    // Saved the way many apps save: a new file takes the old one's place.
    writeFileSync(join(root, "b.tmp"), "saved");
    renameSync(join(root, "b.tmp"), join(root, "b.txt"));

    expect((await t.undo()).status).toBe("completed");

    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("saved");
    await t.coordinator.shutdown();
  });

  it("doesn't move an item back into a folder that is gone or was replaced", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    writeFileSync(join(root, "src", "a.txt"), "a");
    const t = setUp();
    await paste(t.history, {
      mode: "cut",
      sourcePaths: [join(root, "src", "a.txt")],
      destinationDirectoryPath: join(root, "dst"),
    });
    rmSync(join(root, "src"), { recursive: true });

    const gone = await t.undo();
    expect(gone.result?.items).toEqual([
      expect.objectContaining({ status: "skipped", error: "Its folder “src” no longer exists." }),
    ]);

    await paste(t.history, {
      mode: "cut",
      sourcePaths: [join(root, "dst", "a.txt")],
      destinationDirectoryPath: root,
    });
    rmSync(join(root, "dst"), { recursive: true });
    mkdirSync(join(root, "dst"));
    const replaced = await t.undo();
    expect(replaced.result?.items).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: "Its folder “dst” was replaced by another folder.",
      }),
    ]);
    expect(existsSync(join(root, "a.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });

  it("skips an item emptied from the Trash", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.trash(join(root, "a.txt"));
    rmSync(join(trashDir, "1-a.txt"));

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({ status: "skipped", error: "“1-a.txt” is no longer in “.Trash”." }),
    ]);
    await t.coordinator.shutdown();
  });

  it("puts a replaced item back even when the new one is gone already", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    writeFileSync(join(root, "src", "a.txt"), "new");
    writeFileSync(join(root, "dst", "a.txt"), "old");
    const pasteTrash = join(root, "paste-trash");
    mkdirSync(pasteTrash);
    const t = setUp();
    await paste(t.history, {
      mode: "copy",
      sourcePaths: [join(root, "src", "a.txt")],
      destinationDirectoryPath: join(root, "dst"),
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(pasteTrash),
    });
    rmSync(join(root, "dst", "a.txt"));

    await t.undo();

    expect(readFileSync(join(root, "dst", "a.txt"), "utf8")).toBe("old");
    await t.coordinator.shutdown();
  });

  it("leaves a replaced item in the Trash while the new one can't be moved away", async () => {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "dst"));
    writeFileSync(join(root, "src", "a.txt"), "new");
    writeFileSync(join(root, "dst", "a.txt"), "old");
    const pasteTrash = join(root, "paste-trash");
    mkdirSync(pasteTrash);
    const t = setUp();
    await paste(t.history, {
      mode: "copy",
      sourcePaths: [join(root, "src", "a.txt")],
      destinationDirectoryPath: join(root, "dst"),
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(pasteTrash),
    });
    // Another item takes the new one's place before Undo.
    rmSync(join(root, "dst", "a.txt"));
    mkdirSync(join(root, "dst", "a.txt"));

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: [] });
    const undone = await t.undo();

    expect(lstatSync(join(root, "dst", "a.txt")).isDirectory()).toBe(true);
    expect(readdirSync(pasteTrash)).toEqual(["1-a.txt"]);
    expect(undone.result?.items).toEqual([
      expect.objectContaining({ status: "skipped" }),
      expect.objectContaining({
        status: "skipped",
        error:
          "“a.txt” was left in the Trash, because the item in its place couldn't be moved away.",
      }),
    ]);
    await t.coordinator.shutdown();
  });
});

describe("running an Undo", () => {
  it("has nothing to undo or redo at first", async () => {
    const t = setUp();
    expect(await t.prepare()).toEqual({
      ticket: null,
      refusal: "nothing",
      label: null,
      action: null,
      nameTaken: [],
      changed: [],
    });
    expect(await t.prepare("redo")).toMatchObject({ ticket: null, refusal: "nothing" });
    await t.coordinator.shutdown();
  });

  it("is refused while another operation holds the write slot", async () => {
    let finishWrite: (() => void) | null = null;
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.rename(join(root, "a.txt"), "b.txt");
    const writing = t.coordinator.runWriteAlone(
      () =>
        new Promise<void>((resolveWrite) => {
          finishWrite = resolveWrite;
        }),
    );

    expect(await t.prepare()).toMatchObject({ ticket: null, refusal: "busy" });

    (finishWrite as (() => void) | null)?.();
    await writing;
    expect((await t.prepare()).ticket).not.toBeNull();
    await t.coordinator.shutdown();
  });

  it("says it can't undo after an operation that can't be undone", async () => {
    writeFileSync(join(trashDir, "a.txt"), "a");
    const t = setUp();
    await t.finish(
      t.coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: [join(trashDir, "a.txt")] },
        { sender: t.sender },
      ),
    );

    expect(await t.prepare()).toMatchObject({ ticket: null, refusal: "cant_undo" });
    expect(await t.prepare("redo")).toMatchObject({ ticket: null, refusal: "nothing" });
    await t.coordinator.shutdown();
  });

  it("refuses to start from a question asked before the history changed", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.rename(join(root, "a.txt"), "b.txt");
    const prepared = await t.prepare();
    await t.newFolder(root, "F");

    await expect(
      t.coordinator.handlers["undo:start"]({ ticket: prepared.ticket ?? "" }, { sender: t.sender }),
    ).rejects.toThrow("Something changed since Undo was chosen. Choose it again.");
    await expect(
      t.coordinator.handlers["undo:start"]({ ticket: "sideways:1:1" }, { sender: t.sender }),
    ).rejects.toThrow("Something changed since Undo was chosen.");
    await t.coordinator.shutdown();
  });

  it("stops between items when told to, and goes on from there next time", async () => {
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      writeFileSync(join(root, name), name);
    }
    let holdFirst: (() => void) | null = null;
    let renames = 0;
    const t = setUp({
      renameExclusive: async (from, to) => {
        renames += 1;
        if (renames === 1) {
          await new Promise<void>((resolveHold) => {
            holdFirst = resolveHold;
          });
        }
        renameSync(from, to);
      },
    });
    const before = snapshot();
    await t.trash(join(root, "a.txt"), join(root, "b.txt"), join(root, "c.txt"));
    const prepared = await t.prepare();
    const { operationId } = await t.coordinator.handlers["undo:start"](
      { ticket: prepared.ticket ?? "" },
      { sender: t.sender },
    );
    while (holdFirst === null) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    }
    t.coordinator.handlers["writeOperation:cancel"]({ operationId }, { sender: t.sender });
    (holdFirst as () => void)();

    const stopped = await t.finish({ operationId });
    expect(stopped.status).toBe("partial");
    expect(stopped.result?.error).toBe("Stopped after 1 item was undone.");
    expect(existsSync(join(root, "c.txt"))).toBe(true);
    expect(existsSync(join(root, "a.txt"))).toBe(false);
    expect(t.history.menu().undo).toBe("Move to Trash of 2 Items");
    expect(t.history.menu().redo).toBe("Move to Trash of “c.txt”");

    await t.undo();
    expect(snapshot()).toEqual(before);
    await t.coordinator.shutdown();
  });

  it("reports an item it couldn't move back, and leaves it where it is", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.rename(join(root, "a.txt"), "b.txt");
    const failing = setUp({
      renameExclusive: async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      },
    });
    failing.history.record({
      action: "rename",
      log: {
        undoable: true,
        units: t.history.top("undo")?.units ?? [],
      },
      items: [],
    });

    const undone = await failing.undo();

    expect(undone.status).toBe("failed");
    expect(undone.result?.items).toEqual([
      expect.objectContaining({ status: "failed", error: expect.stringContaining("permission") }),
    ]);
    expect(existsSync(join(root, "b.txt"))).toBe(true);
    await t.coordinator.shutdown();
    await failing.coordinator.shutdown();
  });

  it("never deletes a copy whose disk turns out to have no Trash", async () => {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.txt"), "a");
    const t = setUp({
      trash: async () => {
        throw Object.assign(new Error("no Trash"), { code: "ENOTRASH" });
      },
    });
    await paste(
      t.history,
      {
        mode: "copy",
        sourcePaths: [join(root, "src", "a.txt")],
        destinationDirectoryPath: join(root, "src"),
      },
      "duplicate",
    );

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: "“a copy.txt” couldn't be moved to the Trash because its disk has no Trash.",
      }),
    ]);
    expect(existsSync(join(root, "src", "a copy.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });
});

describe("the rarer paths", () => {
  it("numbers the name when another item takes it just as the item goes back", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    let raced = false;
    const t = setUp({
      renameExclusive: async (from, to) => {
        // Another app takes the name between the check and the move, once.
        if (!raced && to === join(root, "a.txt")) {
          raced = true;
          writeFileSync(to, "someone else's");
          throw Object.assign(new Error("EEXIST: file exists"), { code: "EEXIST" });
        }
        renameSync(from, to);
      },
    });
    await t.trash(join(root, "a.txt"));

    await t.undo();

    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("someone else's");
    expect(readFileSync(join(root, "a 2.txt"), "utf8")).toBe("a");
    await t.coordinator.shutdown();
  });

  it("leaves the item where it is when every name it tries is taken just then", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp({
      renameExclusive: async (from, to) => {
        if (to.startsWith(join(root, "a"))) {
          writeFileSync(to, "someone else's");
          throw Object.assign(new Error("EEXIST: file exists"), { code: "EEXIST" });
        }
        renameSync(from, to);
      },
    });
    await t.trash(join(root, "a.txt"));

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: `An item named “a 3.txt” is already in “${basename(root)}”.`,
      }),
    ]);
    expect(inTrash()).toEqual(["1-a.txt"]);
    await t.coordinator.shutdown();
  });

  it("reports a copy the Trash refused, and leaves it", async () => {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.txt"), "a");
    const t = setUp({
      trash: async () => {
        throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      },
    });
    await paste(
      t.history,
      {
        mode: "copy",
        sourcePaths: [join(root, "src", "a.txt")],
        destinationDirectoryPath: join(root, "src"),
      },
      "duplicate",
    );

    const undone = await t.undo();

    expect(undone.status).toBe("failed");
    expect(undone.result?.items).toEqual([
      expect.objectContaining({
        status: "failed",
        error: "You don't have permission to access this item.",
      }),
    ]);
    expect(existsSync(join(root, "src", "a copy.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });

  it("renames back every item of a batch, numbering one whose old name is taken", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    const t = setUp();
    await t.batchRename([
      [join(root, "a.txt"), "x.txt"],
      [join(root, "b.txt"), "y.txt"],
    ]);
    writeFileSync(join(root, "a.txt"), "someone else's");

    expect((await t.prepare()).nameTaken).toEqual(["a.txt"]);
    const undone = await t.undo();

    expect(undone.status).toBe("completed");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("b");
    expect(readFileSync(join(root, "a 2.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("someone else's");
    await t.coordinator.shutdown();
  });

  it("does nothing to a batch none of whose items are where they were", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.batchRename([[join(root, "a.txt"), "x.txt"]]);
    rmSync(join(root, "x.txt"));

    const undone = await t.undo();

    expect(undone.status).toBe("failed");
    expect(t.history.menu()).toEqual({ undo: null, redo: null, cantUndo: false });
    await t.coordinator.shutdown();
  });

  it("stops a batch part way when told to, and goes on from there next time", async () => {
    for (const name of ["a", "b", "c"]) {
      writeFileSync(join(root, `${name}.txt`), name);
    }
    const before = snapshot();
    const t = setUp();
    await t.batchRename([
      [join(root, "a.txt"), "x.txt"],
      [join(root, "b.txt"), "y.txt"],
      [join(root, "c.txt"), "z.txt"],
    ]);
    let renames = 0;
    const stopping = setUp({
      renameExclusive: async (from, to) => {
        renames += 1;
        renameSync(from, to);
        if (renames === 1) {
          stopping.coordinator.handlers["writeOperation:cancel"](
            { operationId: stopping.coordinator.getActiveOperation()?.operationId ?? "" },
            { sender: stopping.sender },
          );
        }
      },
    });
    stopping.history.record({
      action: "batch_rename",
      log: { undoable: true, units: t.history.top("undo")?.units ?? [] },
      items: [],
    });
    const prepared = await stopping.prepare();
    const { operationId } = await stopping.coordinator.handlers["undo:start"](
      { ticket: prepared.ticket ?? "" },
      { sender: stopping.sender },
    );

    const stopped = await stopping.finish({ operationId });

    expect(stopped.status).toBe("partial");
    expect(renames).toBe(1);
    expect(stopping.history.menu()).toEqual({
      undo: "Rename of 2 Items",
      redo: "Rename",
      cantUndo: false,
    });
    await stopping.undo();
    expect(snapshot()).toEqual(before);
    await t.coordinator.shutdown();
    await stopping.coordinator.shutdown();
  });

  it.each([
    ["the item put back", "copy", "“a.txt” was left in the Trash"],
    [
      "the item moved back",
      "cut",
      "“a.txt” was left as it is, because the step before it couldn't be redone.",
    ],
  ] as const)(
    "doesn't redo a Replace's second step when its first can't be: %s",
    async (_label, mode, message) => {
      mkdirSync(join(root, "src"));
      mkdirSync(join(root, "dst"));
      writeFileSync(join(root, "src", "a.txt"), "new");
      writeFileSync(join(root, "dst", "a.txt"), "old");
      const pasteTrash = join(root, "paste-trash");
      mkdirSync(pasteTrash);
      const t = setUp();
      await paste(t.history, {
        mode,
        sourcePaths: [join(root, "src", "a.txt")],
        destinationDirectoryPath: join(root, "dst"),
        policy: REPLACE_ALL,
        fileSystem: nativeFileSystemWithTrash(pasteTrash),
      });
      await t.undo();
      // The old item, back in its place, is replaced by another one before Redo.
      rmSync(join(root, "dst", "a.txt"));
      mkdirSync(join(root, "dst", "a.txt"));

      const redone = await t.undo("redo");

      expect(redone.result?.items).toEqual([
        expect.objectContaining({
          status: "skipped",
          error: "The “a.txt” in “dst” is another item now.",
        }),
        expect.objectContaining({ status: "skipped", error: expect.stringContaining(message) }),
      ]);
      await t.coordinator.shutdown();
    },
  );

  it("doesn't move a later step's item to the Trash once an earlier one couldn't be undone", async () => {
    writeFileSync(join(root, "made.txt"), "made");
    writeFileSync(join(root, "b.txt"), "b");
    const t = setUp();
    const made = lstatSync(join(root, "made.txt"));
    const moved = lstatSync(join(root, "b.txt"));
    t.history.record({
      action: "paste",
      log: {
        undoable: true,
        units: [
          {
            steps: [
              {
                kind: "created",
                path: join(root, "made.txt"),
                id: { dev: made.dev, ino: made.ino },
                stamp: null,
              },
              {
                kind: "moved",
                from: join(root, "a.txt"),
                to: join(root, "b.txt"),
                // Another item than the one moved: a file where a folder was.
                id: { dev: moved.dev, ino: moved.ino + 1_000_000 },
                itemKind: "directory",
                parentId: null,
              },
            ],
          },
        ],
      },
      items: [],
    });

    const undone = await t.undo();

    expect(undone.result?.items).toEqual([
      expect.objectContaining({ status: "skipped" }),
      expect.objectContaining({
        status: "skipped",
        error: "“made.txt” was left as it is, because the step before it couldn't be undone.",
      }),
    ]);
    expect(existsSync(join(root, "made.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });
});
