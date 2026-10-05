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

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import type { WriteService } from "@filetrail/core";
import {
  REPLACE_ALL,
  nativeFileSystemWithTrash,
  runPaste,
} from "@filetrail/core/fs/testNativePaste";

import { createOriginalWriteOperationFs } from "../originalFileSystem";
import { createUndoHistory } from "./undoHistory";
import { type WriteOperationFs, createWriteOperationCoordinator } from "./writeOperations";

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

// Every item under the root but the Trash: path, kind and id.
function snapshot(): string[] {
  const lines: string[] = [];
  const walk = (folder: string) => {
    for (const name of readdirSync(folder).sort()) {
      const path = join(folder, name);
      if (path === trashDir) {
        continue;
      }
      const stats = lstatSync(path);
      lines.push(`${relative(root, path)} ${stats.isDirectory() ? "dir" : "file"} ${stats.ino}`);
      if (stats.isDirectory()) {
        walk(path);
      }
    }
  };
  walk(root);
  return lines;
}

function inTrash(): string[] {
  return readdirSync(trashDir).sort();
}

function folderTrash(): (path: string) => Promise<string> {
  let count = 0;
  return async (path) => {
    count += 1;
    const destination = join(trashDir, `${count}-${basename(path)}`);
    renameSync(path, destination);
    return destination;
  };
}

function createSender() {
  return { send: vi.fn<(channel: string, payload: unknown) => void>() };
}

function setUp(fsOverrides: Partial<WriteOperationFs> = {}) {
  const history = createUndoHistory();
  const fs: WriteOperationFs = {
    ...createOriginalWriteOperationFs(folderTrash()),
    ...fsOverrides,
  };
  const coordinator = createWriteOperationCoordinator(
    {
      subscribe: vi.fn(() => () => undefined),
      cancelOperation: vi.fn(),
    } as unknown as WriteService,
    fs,
    { homePath: root, recordUndo: history.record, undoHistory: history },
  );
  const sender = createSender();

  async function finish(started: Promise<{ operationId: string }> | { operationId: string }) {
    const { operationId } = await started;
    const deadline = Date.now() + 10_000;
    for (;;) {
      const terminal = sender.send.mock.calls
        .map(([, payload]) => payload as WriteOperationProgressEvent)
        .find(
          (event) =>
            event.operationId === operationId &&
            ["completed", "failed", "cancelled", "partial"].includes(event.status),
        );
      if (terminal) {
        return terminal;
      }
      if (Date.now() > deadline) {
        throw new Error("Timed out waiting for the end of the operation.");
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    }
  }

  const handlers = coordinator.handlers;
  return {
    history,
    coordinator,
    sender,
    finish,
    rename: (path: string, name: string) =>
      finish(
        handlers["writeOperation:rename"]({ sourcePath: path, destinationName: name }, { sender }),
      ),
    newFolder: (parent: string, name: string) =>
      finish(
        handlers["writeOperation:createFolder"](
          { parentDirectoryPath: parent, folderName: name },
          { sender },
        ),
      ),
    trash: (...paths: string[]) => finish(handlers["writeOperation:trash"]({ paths }, { sender })),
    batchRename: (pairs: Array<[string, string, boolean?]>) =>
      finish(
        handlers["writeOperation:batchRename"](
          {
            items: pairs.map(([path, name, isFolder]) => ({
              sourcePath: path,
              destinationName: name,
              isFolder: isFolder ?? false,
            })),
            onConflict: "number",
            numberSeparator: " ",
          },
          { sender },
        ),
      ),
    prepare: (direction: "undo" | "redo" = "undo") => handlers["undo:prepare"]({ direction }),
    // Asks, then undoes (or redoes) with the answers given.
    async undo(
      direction: "undo" | "redo" = "undo",
      answers: { nameTaken: "skip" | "keep_both"; changed: "trash" | "skip" } = {
        nameTaken: "skip",
        changed: "trash",
      },
    ) {
      const prepared = await handlers["undo:prepare"]({ direction });
      if (prepared.ticket === null) {
        throw new Error(`Nothing to ${direction}: ${prepared.refusal}`);
      }
      return finish(handlers["undo:start"]({ ticket: prepared.ticket, ...answers }, { sender }));
    },
  };
}

// A paste through the copy engine, recorded as the coordinator records one.
async function paste(
  history: ReturnType<typeof createUndoHistory>,
  args: Parameters<typeof runPaste>[0],
  action: "paste" | "duplicate" = "paste",
) {
  const { result } = await runPaste(args);
  if (!result?.undoLog) {
    throw new Error("The paste recorded nothing.");
  }
  history.record({ action, log: result.undoLog, items: result.items });
  return result;
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

  it("asks when an old name is taken, and leaves the item or numbers it as told", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    const t = setUp();
    await t.trash(join(root, "a.txt"), join(root, "b.txt"));
    writeFileSync(join(root, "a.txt"), "someone else's");

    expect(await t.prepare()).toMatchObject({ nameTaken: ["a.txt"], changed: [] });
    const undone = await t.undo("undo", { nameTaken: "skip", changed: "trash" });
    expect(undone.status).toBe("partial");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("someone else's");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("b");
    expect(undone.result?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "skipped",
          error: `An item named “a.txt” is already in “${basename(root)}”.`,
        }),
      ]),
    );
    await t.coordinator.shutdown();
  });

  it("puts an item back under a numbered name when told to keep both", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUp();
    await t.trash(join(root, "a.txt"));
    writeFileSync(join(root, "a.txt"), "someone else's");

    await t.undo("undo", { nameTaken: "keep_both", changed: "trash" });

    expect(readFileSync(join(root, "a 2.txt"), "utf8")).toBe("a");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("someone else's");
    // Redo moves the very item back to the Trash, under whatever name it has now.
    await t.undo("redo");
    expect(existsSync(join(root, "a 2.txt"))).toBe(false);
    await t.coordinator.shutdown();
  });

  it("asks before moving a copy that changed to the Trash, and leaves it when told to", async () => {
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

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: ["a copy.txt"] });
    const left = await t.undo("undo", { nameTaken: "skip", changed: "skip" });
    expect(left.result?.items).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: "“a copy.txt” has changed since, so it was left where it is.",
      }),
    ]);
    expect(readFileSync(join(root, "src", "a copy.txt"), "utf8")).toBe("edited since");
    await t.coordinator.shutdown();
  });

  it("moves a copy that changed to the Trash when told to", async () => {
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

    expect((await t.prepare()).changed).toEqual(["Folder copy"]);
    await t.undo("undo", { nameTaken: "skip", changed: "trash" });

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
    writeFileSync(join(root, "dst", "a.txt"), "new, edited");

    expect(await t.prepare()).toMatchObject({ nameTaken: [], changed: ["a.txt"] });
    const undone = await t.undo("undo", { nameTaken: "skip", changed: "skip" });

    expect(readFileSync(join(root, "dst", "a.txt"), "utf8")).toBe("new, edited");
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

    expect(() =>
      t.coordinator.handlers["undo:start"](
        { ticket: prepared.ticket ?? "", nameTaken: "skip", changed: "trash" },
        { sender: t.sender },
      ),
    ).toThrow("Something changed since Undo was chosen. Choose it again.");
    expect(() =>
      t.coordinator.handlers["undo:start"](
        { ticket: "sideways:1:1", nameTaken: "skip", changed: "trash" },
        { sender: t.sender },
      ),
    ).toThrow("Something changed since Undo was chosen.");
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
      { ticket: prepared.ticket ?? "", nameTaken: "skip", changed: "trash" },
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
        status: "failed",
        error: "“a copy.txt” couldn't be moved to the Trash because its disk has no Trash.",
      }),
    ]);
    expect(existsSync(join(root, "src", "a copy.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });
});
