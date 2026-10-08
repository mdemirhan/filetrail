import { basename } from "node:path";

import type { UndoDirection, WriteOperationAction } from "@filetrail/contracts";
import type { UndoStep, UndoUnit } from "@filetrail/core";

import type { FinishedWrite } from "./writeOperations";

// One operation that can be undone (or, once undone, done again).
export type UndoEntry = {
  id: number;
  action: WriteOperationAction;
  units: UndoUnit[];
  // Whether it moved anything, so a paste is named a Move for as long as it is in the
  // history: what a stop leaves of a moving Replace may be only its trip to the Trash.
  moves: boolean;
};

export type UndoHistory = ReturnType<typeof createUndoHistory>;

// The operations that can be undone and redone, newest last, for as long as the app runs.
// Kept in memory only: nothing is written to disk, and quitting forgets them, as Finder does.
//
// Only what an operation really did is kept, and nothing in here is trusted when undoing:
// every step is checked on disk first (see undoPlan.ts).
export function createUndoHistory() {
  const undoList: UndoEntry[] = [];
  const redoList: UndoEntry[] = [];
  // Set by an operation that can't be undone, until the next one that can.
  let cantUndo = false;
  let nextId = 1;
  // Goes up with every change, so an Undo prepared before one is refused.
  let generation = 0;
  const listeners = new Set<() => void>();

  function changed(): void {
    generation += 1;
    for (const listener of listeners) {
      listener();
    }
  }

  function listOf(direction: UndoDirection): UndoEntry[] {
    return direction === "undo" ? undoList : redoList;
  }

  return {
    // A finished operation. One that can be undone goes on top and leaves nothing to
    // redo; one that can't leaves nothing to undo either.
    record(finished: FinishedWrite): void {
      redoList.length = 0;
      // (Emptying the Trash is never undoable.)
      if (finished.action === "empty_trash" || !finished.log.undoable) {
        undoList.length = 0;
        cantUndo = true;
        changed();
        return;
      }
      undoList.push({
        id: nextId++,
        action: finished.action,
        units: finished.log.units,
        moves: movesAnything(finished.log.units),
      });
      cantUndo = false;
      changed();
    },

    top(direction: UndoDirection): UndoEntry | null {
      return listOf(direction).at(-1) ?? null;
    },

    // An Undo or Redo of `entryId` ended. `done` is what it did, in the order it did it,
    // which is what the other direction reverses; `leftover` is what a stop left to do and
    // what failed to be written, kept on top so the next Undo goes on from there. What the
    // disk check refused (changed outside the app) is dropped.
    finish(
      direction: UndoDirection,
      entryId: number,
      result: { done: UndoUnit[]; leftover: UndoUnit[] },
    ): void {
      const list = listOf(direction);
      const entry = list.at(-1);
      if (!entry || entry.id !== entryId) {
        return;
      }
      list.pop();
      if (result.leftover.length > 0) {
        list.push({ ...entry, units: result.leftover });
      }
      // Each try is its own entry on the other list: what it did, exactly, so the other
      // command puts back where each item was before it, whatever was tried after it.
      if (result.done.length > 0) {
        listOf(direction === "undo" ? "redo" : "undo").push({
          id: nextId++,
          action: entry.action,
          units: result.done,
          moves: entry.moves,
        });
      }
      changed();
    },

    // What the Edit menu shows after "Undo " and "Redo " ("Move of “a.txt”"), or null when
    // there is nothing; `cantUndo` when the last operation can't be undone. Named after
    // what is left to do: a stopped Undo of 3 items leaves "of 2 Items".
    menu(): { undo: string | null; redo: string | null; cantUndo: boolean } {
      const undo = undoList.at(-1);
      const redo = redoList.at(-1);
      return {
        undo: undo ? labelOf(undo.action, undo.units, undo.moves) : null,
        redo: redo ? labelOf(redo.action, redo.units, redo.moves) : null,
        cantUndo: cantUndo && undoList.length === 0,
      };
    },

    generation: () => generation,

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// "Rename", "Move of “a.txt”", "Copy of 3 Items"…: what the Edit menu puts after "Undo".
// A paste is a Move when it `moves` anything, a Copy otherwise.
export function labelOf(
  action: FinishedWrite["action"],
  units: readonly UndoUnit[],
  moves: boolean = movesAnything(units),
): string {
  switch (action) {
    case "rename":
      return "Rename";
    case "batch_rename": {
      const count = units.reduce(
        (sum, unit) =>
          sum +
          unit.steps.reduce(
            (stepSum, step) => stepSum + (step.kind === "batchRenamed" ? step.items.length : 0),
            0,
          ),
        0,
      );
      return count === 1 ? "Rename" : `Rename of ${count} Items`;
    }
    case "new_folder":
      return "New Folder";
    case "trash":
      return `Move to Trash of ${itemsName(units)}`;
    case "duplicate":
      return `Duplicate of ${itemsName(units)}`;
    case "move_to":
      return `Move of ${itemsName(units)}`;
    case "copy_to":
      return `Copy of ${itemsName(units)}`;
    default:
      return `${moves ? "Move" : "Copy"} of ${itemsName(units)}`;
  }
}

function movesAnything(units: readonly UndoUnit[]): boolean {
  return units.some((unit) => unit.steps.some((step) => step.kind === "moved" && !step.fromTrash));
}

// “a.txt” for one item, "3 Items" for more.
function itemsName(units: readonly UndoUnit[]): string {
  if (units.length !== 1) {
    return `${units.length} Items`;
  }
  const path = mainPathOf(units[0]?.steps ?? []);
  return path === null ? "1 Item" : `“${basename(path)}”`;
}

// The item a unit is about: what was made or moved, or else what went to the Trash.
function mainPathOf(steps: UndoStep[]): string | null {
  for (const step of [...steps].reverse()) {
    switch (step.kind) {
      case "created":
        return step.path;
      case "moved":
        return step.to;
      case "trashed":
        return step.from;
      default:
        break;
    }
  }
  return null;
}
