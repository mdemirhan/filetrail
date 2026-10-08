import type { UndoLog, UndoStep, UndoUnit } from "@filetrail/core";

import { createUndoHistory, labelOf } from "./undoHistory";
import type { FinishedWrite } from "./writeOperations";

const ID = { dev: 1, ino: 2 };

function moved(from: string, to: string): UndoStep {
  return { kind: "moved", from, to, id: ID, itemKind: "file", parentId: ID };
}

function created(path: string): UndoStep {
  return { kind: "created", path, id: ID, stamp: null };
}

function trashed(from: string): UndoStep {
  return { kind: "trashed", from, trashPath: "/Users/demo/.Trash/x", id: ID, parentId: ID };
}

function units(...steps: UndoStep[][]): UndoUnit[] {
  return steps.map((unitSteps) => ({ steps: unitSteps }));
}

function finished(action: FinishedWrite["action"], log: UndoLog): FinishedWrite {
  return { action, log, items: [] };
}

function undoable(action: FinishedWrite["action"], ...steps: UndoStep[][]): FinishedWrite {
  return finished(action, { undoable: true, units: units(...steps) });
}

describe("createUndoHistory", () => {
  it("has nothing to undo or redo at first", () => {
    const history = createUndoHistory();
    expect(history.top("undo")).toBeNull();
    expect(history.top("redo")).toBeNull();
    expect(history.menu()).toEqual({ undo: null, redo: null, cantUndo: false });
  });

  it("undoes the newest operation first", () => {
    const history = createUndoHistory();
    history.record(undoable("rename", [moved("/a", "/b")]));
    history.record(undoable("new_folder", [created("/F")]));

    expect(history.top("undo")?.action).toBe("new_folder");
    expect(history.menu().undo).toBe("New Folder");
  });

  it("moves what an Undo did to Redo, and back", () => {
    const history = createUndoHistory();
    history.record(undoable("rename", [moved("/a", "/b")]));
    const entry = history.top("undo");
    const done = units([moved("/b", "/a")]);

    history.finish("undo", entry?.id ?? -1, { done, leftover: [] });

    expect(history.top("undo")).toBeNull();
    expect(history.top("redo")).toMatchObject({ action: "rename", units: done });
    const redo = history.top("redo");
    history.finish("redo", redo?.id ?? -1, { done: units([moved("/a", "/b")]), leftover: [] });
    expect(history.menu()).toEqual({ undo: "Rename", redo: null, cantUndo: false });
  });

  it("keeps what a stop left on top, and drops what couldn't be done", () => {
    const history = createUndoHistory();
    history.record(undoable("trash", [trashed("/a")], [trashed("/b")], [trashed("/c")]));
    const entry = history.top("undo");

    history.finish("undo", entry?.id ?? -1, {
      done: units([moved("/x/c", "/c")]),
      leftover: units([trashed("/a")]),
    });

    expect(history.top("undo")?.units).toEqual(units([trashed("/a")]));
    expect(history.top("redo")?.units).toEqual(units([moved("/x/c", "/c")]));
  });

  it("forgets an operation none of which could be undone", () => {
    const history = createUndoHistory();
    history.record(undoable("rename", [moved("/a", "/b")]));
    history.finish("undo", history.top("undo")?.id ?? -1, { done: [], leftover: [] });

    expect(history.menu()).toEqual({ undo: null, redo: null, cantUndo: false });
  });

  it("ignores the end of an Undo of an entry that is no longer on top", () => {
    const history = createUndoHistory();
    history.record(undoable("rename", [moved("/a", "/b")]));
    const first = history.top("undo");
    history.record(undoable("rename", [moved("/c", "/d")]));

    history.finish("undo", first?.id ?? -1, { done: [], leftover: [] });

    expect(history.top("undo")?.units).toEqual(units([moved("/c", "/d")]));
  });

  it("leaves nothing to redo after a new operation", () => {
    const history = createUndoHistory();
    history.record(undoable("rename", [moved("/a", "/b")]));
    history.finish("undo", history.top("undo")?.id ?? -1, {
      done: units([moved("/b", "/a")]),
      leftover: [],
    });
    history.record(undoable("new_folder", [created("/F")]));

    expect(history.top("redo")).toBeNull();
  });

  it("leaves nothing to undo after an operation that can't be undone, until the next one", () => {
    const history = createUndoHistory();
    history.record(undoable("rename", [moved("/a", "/b")]));
    history.record(finished("empty_trash", { undoable: false, reason: "deleted_for_good" }));

    expect(history.menu()).toEqual({ undo: null, redo: null, cantUndo: true });

    history.record(undoable("new_folder", [created("/F")]));
    expect(history.menu()).toEqual({ undo: "New Folder", redo: null, cantUndo: false });
  });

  it("counts changes and tells about them", () => {
    const history = createUndoHistory();
    const listener = vi.fn();
    const stop = history.onChange(listener);
    const before = history.generation();

    history.record(undoable("rename", [moved("/a", "/b")]));
    history.finish("undo", history.top("undo")?.id ?? -1, { done: [], leftover: [] });

    expect(history.generation()).toBe(before + 2);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    history.record(undoable("rename", [moved("/a", "/b")]));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("an Undo done in two tries", () => {
  const renamed = (from: string, to: string): UndoStep => ({
    kind: "batchRenamed",
    items: [{ from, to, id: ID, itemKind: "file" }],
  });

  it("keeps each try of a batch rename its own entry to redo, the last one first", () => {
    const history = createUndoHistory();
    history.record(undoable("batch_rename", [renamed("/a", "/b"), renamed("/b", "/a")]));
    const entry = history.top("undo");
    history.finish("undo", entry?.id ?? -1, {
      done: units([renamed("/b", "/a")]),
      leftover: units([renamed("/a", "/b")]),
    });
    history.finish("undo", entry?.id ?? -1, { done: units([renamed("/a", "/b")]), leftover: [] });

    expect(history.top("redo")?.units).toEqual(units([renamed("/a", "/b")]));
    expect(history.menu().redo).toBe("Rename");
  });

  it("keeps other parts apart, each to redo on its own", () => {
    const history = createUndoHistory();
    history.record(undoable("trash", [trashed("/a")], [trashed("/b")]));
    const entry = history.top("undo");
    history.finish("undo", entry?.id ?? -1, {
      done: units([moved("/T/b", "/b")]),
      leftover: units([trashed("/a")]),
    });
    history.finish("undo", entry?.id ?? -1, { done: units([moved("/T/a", "/a")]), leftover: [] });

    expect(history.top("redo")?.units).toEqual(units([moved("/T/a", "/a")]));
  });
});

describe("an entry's name", () => {
  it("stays a Move when what is left of a moving Replace is its trip to the Trash", () => {
    const history = createUndoHistory();
    history.record(undoable("paste", [trashed("/F/a.txt"), moved("/a.txt", "/F/a.txt")]));
    const entry = history.top("undo");

    history.finish("undo", entry?.id ?? -1, {
      done: units([moved("/F/a.txt", "/a.txt")]),
      leftover: units([trashed("/F/a.txt")]),
    });

    expect(history.menu()).toEqual({
      undo: "Move of “a.txt”",
      redo: "Move of “a.txt”",
      cantUndo: false,
    });
  });
});

describe("labelOf", () => {
  it.each([
    [undoable("rename", [moved("/a.txt", "/b.txt")]), "Rename"],
    [
      undoable("batch_rename", [
        {
          kind: "batchRenamed",
          items: [
            { from: "/a", to: "/b", id: ID, itemKind: "file" },
            { from: "/c", to: "/d", id: ID, itemKind: "file" },
          ],
        },
      ]),
      "Rename of 2 Items",
    ],
    [
      undoable("batch_rename", [
        { kind: "batchRenamed", items: [{ from: "/a", to: "/b", id: ID, itemKind: "file" }] },
      ]),
      "Rename",
    ],
    [undoable("new_folder", [created("/untitled folder")]), "New Folder"],
    [undoable("trash", [trashed("/Docs/a.txt")]), "Move to Trash of “a.txt”"],
    [undoable("duplicate", [created("/a copy.txt")]), "Duplicate of “a copy.txt”"],
    [undoable("move_to", [moved("/a.txt", "/F/a.txt")], [moved("/b", "/F/b")]), "Move of 2 Items"],
    [undoable("copy_to", [created("/F/a.txt")]), "Copy of “a.txt”"],
    [undoable("paste", [moved("/a.txt", "/F/a.txt")]), "Move of “a.txt”"],
    [undoable("paste", [created("/F/a.txt")], [created("/F/b.txt")]), "Copy of 2 Items"],
    // A Replace: named after the new item, not the one that went to the Trash.
    [undoable("paste", [trashed("/F/a.txt"), created("/F/a.txt")]), "Copy of “a.txt”"],
  ])("names %#", (entry, label) => {
    expect(labelOf(entry.action, entry.log.undoable ? entry.log.units : [])).toBe(label);
  });

  it("names a unit with nothing to go by plainly", () => {
    expect(labelOf("trash", units([{ kind: "batchRenamed", items: [] }]))).toBe(
      "Move to Trash of 1 Item",
    );
  });
});
