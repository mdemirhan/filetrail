import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { paste, setUpUndo } from "./undoRealDisk.testkit";

// Starting an Undo that was looked at (and asked about) a moment before: what changed in
// between, on disk or in the history, refuses it rather than doing what wasn't agreed to.

let root: string;
let trashDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "filetrail-undo-start-"));
  trashDir = join(root, ".Trash");
  mkdirSync(trashDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("starting an Undo", () => {
  it("refuses when an item changed while the question about another was open", async () => {
    writeFileSync(join(root, "x.txt"), "x");
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUpUndo(root, trashDir);
    await t.trash(join(root, "x.txt"));
    const trashed = t.history.top("undo")?.units ?? [];
    await paste(
      t.history,
      { mode: "copy", sourcePaths: [join(root, "a.txt")], destinationDirectoryPath: root },
      "duplicate",
    );
    const duplicated = t.history.top("undo")?.units ?? [];
    // One operation that put an item in the Trash and made a copy.
    t.history.record({
      action: "paste",
      log: { undoable: true, units: [...trashed, ...duplicated] },
      items: [],
    });
    writeFileSync(join(root, "x.txt"), "someone else's");

    const prepared = await t.prepare();
    expect(prepared).toMatchObject({ nameTaken: ["x.txt"], changed: [] });
    // While "x.txt" is asked about, the copy is edited.
    writeFileSync(join(root, "a copy.txt"), "edited");

    await expect(
      t.coordinator.handlers["undo:start"]({ ticket: prepared.ticket ?? "" }, { sender: t.sender }),
    ).rejects.toThrow("“a copy.txt” was changed after Undo was chosen. Choose Undo again.");
    expect(readFileSync(join(root, "a copy.txt"), "utf8")).toBe("edited");
    expect(t.coordinator.getActiveOperation()).toBeNull();

    // Chosen again, it asks about both, and goes ahead once both are agreed to.
    expect(await t.prepare()).toMatchObject({
      nameTaken: ["x.txt"],
      changed: [{ name: "a copy.txt", putBack: false, replaced: false }],
    });
    expect((await t.undo()).status).toBe("completed");
    expect(existsSync(join(root, "a copy.txt"))).toBe(false);
    expect(readFileSync(join(root, "x 2.txt"), "utf8")).toBe("x");
    await t.coordinator.shutdown();
  });

  it("refuses when another item took a name while Undo was being chosen", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const t = setUpUndo(root, trashDir);
    await t.rename(join(root, "a.txt"), "b.txt");
    const prepared = await t.prepare();
    writeFileSync(join(root, "a.txt"), "someone else's");

    await expect(
      t.coordinator.handlers["undo:start"]({ ticket: prepared.ticket ?? "" }, { sender: t.sender }),
    ).rejects.toThrow(
      "Another item took the name “a.txt” after Undo was chosen. Choose Undo again.",
    );
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("a");
    await t.coordinator.shutdown();
  });

  it("refuses, and frees the write slot, when a disk doesn't answer its last look", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    let hanging = false;
    const t = setUpUndo(
      root,
      trashDir,
      {
        lstat: (path) =>
          hanging && path.endsWith("b.txt") ? new Promise(() => undefined) : lstat(path),
      },
      { undoCheckWithinMs: 20 },
    );
    await t.rename(join(root, "a.txt"), "b.txt");
    const prepared = await t.prepare();
    hanging = true;

    await expect(
      t.coordinator.handlers["undo:start"]({ ticket: prepared.ticket ?? "" }, { sender: t.sender }),
    ).rejects.toThrow(
      "A disk didn't answer while Undo looked at its items. Choose Undo again once it does.",
    );
    expect(t.coordinator.getActiveOperation()).toBeNull();
    expect(existsSync(join(root, "b.txt"))).toBe(true);
    hanging = false;
    expect((await t.undo()).status).toBe("completed");
    await t.coordinator.shutdown();
  });

  it("tells apart two items of one name in two folders", async () => {
    writeFileSync(join(root, "x.txt"), "x");
    mkdirSync(join(root, "A"));
    mkdirSync(join(root, "B"));
    const t = setUpUndo(root, trashDir);
    const copies = [];
    for (const folder of ["A", "B"]) {
      const result = await paste(t.history, {
        mode: "copy",
        sourcePaths: [join(root, "x.txt")],
        destinationDirectoryPath: join(root, folder),
      });
      copies.push(...(result.undoLog?.undoable ? result.undoLog.units : []));
    }
    t.history.record({ action: "paste", log: { undoable: true, units: copies }, items: [] });
    writeFileSync(join(root, "A", "x.txt"), "edited");
    const prepared = await t.prepare();
    expect(prepared.changed).toEqual([{ name: "x.txt", putBack: false, replaced: false }]);
    // While the copy in A is asked about, the one in B is edited too.
    writeFileSync(join(root, "B", "x.txt"), "edited");

    await expect(
      t.coordinator.handlers["undo:start"]({ ticket: prepared.ticket ?? "" }, { sender: t.sender }),
    ).rejects.toThrow("“x.txt” was changed after Undo was chosen. Choose Undo again.");
    expect(existsSync(join(root, "B", "x.txt"))).toBe(true);
    await t.coordinator.shutdown();
  });

  it("starts each window's Undo with what that window was asked", async () => {
    writeFileSync(join(root, "x.txt"), "x");
    writeFileSync(join(root, "y.txt"), "y");
    mkdirSync(join(root, "D"));
    const t = setUpUndo(root, trashDir);
    await paste(t.history, {
      mode: "copy",
      sourcePaths: [join(root, "x.txt"), join(root, "y.txt")],
      destinationDirectoryPath: join(root, "D"),
    });
    writeFileSync(join(root, "D", "x.txt"), "edited x");
    const first = await t.prepare();
    expect(first.changed.map((item) => item.name)).toEqual(["x.txt"]);
    // While the first window asks about "x.txt", "y.txt" is edited, and a second window
    // looks at the same Undo.
    writeFileSync(join(root, "D", "y.txt"), "edited y");
    const second = await t.prepare();
    expect(second.changed.map((item) => item.name)).toEqual(["y.txt", "x.txt"]);

    // The first window's answer covers only "x.txt".
    await expect(
      t.coordinator.handlers["undo:start"]({ ticket: first.ticket ?? "" }, { sender: t.sender }),
    ).rejects.toThrow("“y.txt” was changed after Undo was chosen. Choose Undo again.");
    expect(readFileSync(join(root, "D", "y.txt"), "utf8")).toBe("edited y");

    const undone = await t.finish(
      t.coordinator.handlers["undo:start"]({ ticket: second.ticket ?? "" }, { sender: t.sender }),
    );
    expect(undone.status).toBe("completed");
    expect(existsSync(join(root, "D", "y.txt"))).toBe(false);
    await t.coordinator.shutdown();
  });

  it("starts one Undo for two windows that chose it at once, and refuses the other", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    let holdRename: (() => void) | null = null;
    const t = setUpUndo(root, trashDir, {
      renameExclusive: async (from, to) => {
        if (to === join(root, "a.txt")) {
          await new Promise<void>((resolveHold) => {
            holdRename = resolveHold;
          });
        }
        renameSync(from, to);
      },
    });
    await t.rename(join(root, "a.txt"), "b.txt");
    const otherWindow = { send: vi.fn() };
    const first = await t.prepare();
    const second = await t.coordinator.handlers["undo:prepare"]({ direction: "undo" });
    expect(second.ticket).not.toBe(first.ticket);

    const started = await t.coordinator.handlers["undo:start"](
      { ticket: first.ticket ?? "" },
      { sender: t.sender },
    );
    while (holdRename === null) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    }
    // While the first runs: busy.
    await expect(
      t.coordinator.handlers["undo:start"](
        { ticket: second.ticket ?? "" },
        { sender: otherWindow },
      ),
    ).rejects.toThrow("Another write operation is already running.");
    (holdRename as () => void)();
    expect((await t.finish(started)).status).toBe("completed");

    // Once it has finished: the history has moved on.
    await expect(
      t.coordinator.handlers["undo:start"](
        { ticket: second.ticket ?? "" },
        { sender: otherWindow },
      ),
    ).rejects.toThrow("Something changed since Undo was chosen. Choose it again.");
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("a");
    expect(t.history.menu()).toEqual({ undo: null, redo: "Rename", cantUndo: false });
    await t.coordinator.shutdown();
  });
});
