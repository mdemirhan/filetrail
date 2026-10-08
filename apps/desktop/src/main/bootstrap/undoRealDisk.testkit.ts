// For tests only: Undo and Redo on a real disk, through the write coordinator as the app
// runs them. Shared by the undoExecution tests.

import { lstatSync, readdirSync, renameSync } from "node:fs";
import { basename, join, relative } from "node:path";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import type { WriteService } from "@filetrail/core";
import { runPaste } from "@filetrail/core/fs/testNativePaste";

import { createOriginalWriteOperationFs } from "../originalFileSystem";
import { createUndoHistory } from "./undoHistory";
import { type WriteOperationFs, createWriteOperationCoordinator } from "./writeOperations";

// Every item under `root` but the Trash: path, kind and id.
export function snapshotOf(root: string, trashDir: string): string[] {
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

// A Trash that is a plain folder: each item gets a number in front of its name there.
export function folderTrash(trashDir: string): (path: string) => Promise<string> {
  let count = 0;
  return async (path) => {
    count += 1;
    const destination = join(trashDir, `${count}-${basename(path)}`);
    renameSync(path, destination);
    return destination;
  };
}

export type UndoTest = ReturnType<typeof setUpUndo>;

// A coordinator with a history, its Trash in `trashDir`, and helpers that run each
// operation to its end.
export function setUpUndo(
  root: string,
  trashDir: string,
  fsOverrides: Partial<WriteOperationFs> = {},
) {
  const history = createUndoHistory();
  const fs: WriteOperationFs = {
    ...createOriginalWriteOperationFs(folderTrash(trashDir)),
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
  const sender = { send: vi.fn<(channel: string, payload: unknown) => void>() };

  async function finish(started: Promise<{ operationId: string }> | { operationId: string }) {
    const { operationId } = await started;
    const deadline = Date.now() + 10_000;
    for (;;) {
      const terminal = events().find(
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

  // Every event the window was sent, in order.
  function events(): WriteOperationProgressEvent[] {
    return sender.send.mock.calls.map(([, payload]) => payload as WriteOperationProgressEvent);
  }

  const handlers = coordinator.handlers;
  return {
    history,
    coordinator,
    sender,
    finish,
    events,
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
    // Looks first, then undoes (or redoes) all of it, as when what it asked was agreed to.
    async undo(direction: "undo" | "redo" = "undo") {
      const prepared = await handlers["undo:prepare"]({ direction });
      if (prepared.ticket === null) {
        throw new Error(`Nothing to ${direction}: ${prepared.refusal}`);
      }
      return finish(handlers["undo:start"]({ ticket: prepared.ticket }, { sender }));
    },
  };
}

// A paste through the copy engine, recorded as the coordinator records one.
export async function paste(
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
