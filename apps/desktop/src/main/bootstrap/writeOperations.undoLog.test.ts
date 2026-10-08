import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import { type UndoLog, type WriteService, createWriteService } from "@filetrail/core";

import { createOriginalWriteOperationFs } from "../originalFileSystem";
import { createUndoHistory } from "./undoHistory";
import {
  type FinishedWrite,
  type WriteOperationFs,
  createWriteOperationCoordinator,
} from "./writeOperations";

// What each operation tells the history for Undo, and when: before the next operation can
// start, so the history keeps them in order.

let root: string;
let trashDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "filetrail-undo-record-"));
  // The home folder's Trash, for Delete Immediately.
  trashDir = join(root, ".Trash");
  mkdirSync(trashDir);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function idOf(path: string) {
  const stats = lstatSync(path);
  return { dev: stats.dev, ino: stats.ino };
}

// A Trash that is a folder: items go in with a number first, so names never clash.
function folderTrash(): (path: string) => Promise<string> {
  let count = 0;
  return async (path) => {
    count += 1;
    const inTrash = join(trashDir, `${count}-${basename(path)}`);
    renameSync(path, inTrash);
    return inTrash;
  };
}

function setUp(
  options: {
    fs?: Partial<WriteOperationFs>;
    writeService?: WriteService;
    diskHasTrash?: (path: string) => boolean;
  } = {},
) {
  const finished: FinishedWrite[] = [];
  const fs = { ...createOriginalWriteOperationFs(folderTrash()), ...options.fs };
  const coordinator = createWriteOperationCoordinator(
    options.writeService ?? createWriteServiceStub(),
    fs,
    {
      homePath: root,
      recordUndo: (entry) => {
        finished.push(entry);
      },
      ...(options.diskHasTrash ? { diskHasTrash: options.diskHasTrash } : {}),
    },
  );
  return { coordinator, finished, sender: createSender() };
}

function createSender() {
  return { send: vi.fn<(channel: string, payload: unknown) => void>() };
}

async function waitForTerminalEvent(
  sender: ReturnType<typeof createSender>,
  operationId: string,
): Promise<WriteOperationProgressEvent> {
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

function createWriteServiceStub(): WriteService {
  return {
    subscribe: vi.fn(() => () => undefined),
    cancelOperation: vi.fn(() => ({ ok: true })),
  } as unknown as WriteService;
}

describe("what the simple operations record", () => {
  it("records a rename with the item's id and the folder it is in", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const { coordinator, finished, sender } = setUp();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(finished).toEqual([
      {
        action: "rename",
        log: {
          undoable: true,
          units: [
            {
              steps: [
                {
                  kind: "moved",
                  from: join(root, "a.txt"),
                  to: join(root, "b.txt"),
                  id: idOf(join(root, "b.txt")),
                  itemKind: "file",
                  parentId: idOf(root),
                },
              ],
            },
          ],
        },
        items: [expect.objectContaining({ status: "completed" })],
      },
    ]);
    await coordinator.shutdown();
  });

  it("records nothing for a rename that failed", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const { coordinator, finished, sender } = setUp({
      fs: {
        renameExclusive: async () => {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        },
      },
    });

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender },
    );
    expect((await waitForTerminalEvent(sender, "write-op-1")).status).toBe("failed");

    expect(finished).toEqual([]);
    await coordinator.shutdown();
  });

  it("records a new folder with how it looked when made", async () => {
    const { coordinator, finished, sender } = setUp();

    await coordinator.handlers["writeOperation:createFolder"](
      { parentDirectoryPath: root, folderName: "New" },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    const folder = join(root, "New");
    expect(finished.map((entry) => entry.log)).toEqual([
      {
        undoable: true,
        units: [
          {
            steps: [
              {
                kind: "created",
                path: folder,
                id: idOf(folder),
                stamp: {
                  kind: "directory",
                  size: null,
                  mtimeMs: lstatSync(folder).mtimeMs,
                  entryCount: 0,
                },
              },
            ],
          },
        ],
      },
    ]);
    await coordinator.shutdown();
  });

  // As a copy there can't: undoing it would mean deleting it.
  it("can't undo a new folder made on a disk without a Trash", async () => {
    const asked: string[] = [];
    const { coordinator, finished, sender } = setUp({
      diskHasTrash: (path) => {
        asked.push(path);
        return false;
      },
    });

    await coordinator.handlers["writeOperation:createFolder"](
      { parentDirectoryPath: root, folderName: "New" },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(finished.map((entry) => entry.log)).toEqual([{ undoable: false, reason: "no_trash" }]);
    expect(asked).toEqual([root]);
    await coordinator.shutdown();
  });

  it("can't undo a new folder when whether its disk has a Trash can't be told", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { coordinator, finished, sender } = setUp({
      diskHasTrash: () => {
        throw new Error("The mount table couldn't be read.");
      },
    });

    await coordinator.handlers["writeOperation:createFolder"](
      { parentDirectoryPath: root, folderName: "New" },
      { sender },
    );

    expect((await waitForTerminalEvent(sender, "write-op-1")).status).toBe("completed");
    expect(finished.map((entry) => entry.log)).toEqual([{ undoable: false, reason: "no_trash" }]);
    errors.mockRestore();
    await coordinator.shutdown();
  });

  it("records the items a batch rename renamed, under their final names", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    writeFileSync(join(root, "b.txt"), "b");
    writeFileSync(join(root, "same.txt"), "same");
    const { coordinator, finished, sender } = setUp();

    await coordinator.handlers["writeOperation:batchRename"](
      {
        // A swap, and an item asked to keep its name.
        items: [
          { sourcePath: join(root, "a.txt"), destinationName: "b.txt", isFolder: false },
          { sourcePath: join(root, "b.txt"), destinationName: "a.txt", isFolder: false },
        ],
        onConflict: "number",
        numberSeparator: " ",
      },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(finished.map((entry) => entry.log)).toEqual([
      {
        undoable: true,
        units: [
          {
            steps: [
              {
                kind: "batchRenamed",
                items: expect.arrayContaining([
                  {
                    from: join(root, "a.txt"),
                    to: join(root, "b.txt"),
                    id: idOf(join(root, "b.txt")),
                    itemKind: "file",
                  },
                  {
                    from: join(root, "b.txt"),
                    to: join(root, "a.txt"),
                    id: idOf(join(root, "a.txt")),
                    itemKind: "file",
                  },
                ]),
              },
            ],
          },
        ],
      },
    ]);
    await coordinator.shutdown();
  });

  it("records each item moved to the Trash on its own, with where it went", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    mkdirSync(join(root, "Folder"));
    const fileId = idOf(join(root, "a.txt"));
    const folderId = idOf(join(root, "Folder"));
    const { coordinator, finished, sender } = setUp();

    await coordinator.handlers["writeOperation:trash"](
      // One that was already gone: nothing to put back.
      { paths: [join(root, "a.txt"), join(root, "gone.txt"), join(root, "Folder")] },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(finished.map((entry) => entry.log)).toEqual([
      {
        undoable: true,
        units: [
          {
            steps: [
              {
                kind: "trashed",
                from: join(root, "a.txt"),
                trashPath: join(trashDir, "1-a.txt"),
                id: fileId,
                parentId: idOf(root),
              },
            ],
          },
          {
            steps: [
              {
                kind: "trashed",
                from: join(root, "Folder"),
                trashPath: join(trashDir, "2-Folder"),
                id: folderId,
                parentId: idOf(root),
              },
            ],
          },
        ],
      },
    ]);
    await coordinator.shutdown();
  });

  it("records nothing when nothing could go to the Trash", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const { coordinator, finished, sender } = setUp({
      fs: {
        trash: async () => {
          throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
        },
      },
    });

    await coordinator.handlers["writeOperation:trash"](
      { paths: [join(root, "a.txt")] },
      { sender },
    );
    expect((await waitForTerminalEvent(sender, "write-op-1")).status).toBe("failed");

    expect(finished).toEqual([]);
    await coordinator.shutdown();
  });

  it("can't undo Delete Immediately", async () => {
    writeFileSync(join(trashDir, "a.txt"), "a");
    const { coordinator, finished, sender } = setUp();

    await coordinator.handlers["writeOperation:deleteImmediately"](
      { paths: [join(trashDir, "a.txt")] },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(finished).toEqual([
      expect.objectContaining({
        action: "delete_immediately",
        log: { undoable: false, reason: "deleted_for_good" },
      }),
    ]);
    await coordinator.shutdown();
  });

  it("can't undo Empty Trash, even one that failed part way", async () => {
    const { coordinator, finished } = setUp();

    await coordinator.emptyTrash(async () => ({ ok: false, error: "Finder stopped." }));

    expect(finished).toEqual([
      { action: "empty_trash", log: { undoable: false, reason: "deleted_for_good" }, items: [] },
    ]);
    await coordinator.shutdown();
  });

  it("records an operation before the next one can start", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    let slotFreeWhenRecorded: boolean | null = null;
    const finished: FinishedWrite[] = [];
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createOriginalWriteOperationFs(folderTrash()),
      {
        homePath: root,
        recordUndo: (entry) => {
          finished.push(entry);
          slotFreeWhenRecorded = coordinator.getActiveOperation() === null;
        },
      },
    );
    const sender = createSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(finished).toHaveLength(1);
    expect(slotFreeWhenRecorded).toBe(false);
    await coordinator.shutdown();
  });

  it("frees the write slot even when keeping the history fails", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createOriginalWriteOperationFs(folderTrash()),
      {
        homePath: root,
        recordUndo: () => {
          throw new Error("history broke");
        },
      },
    );
    const sender = createSender();

    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");

    expect(coordinator.getActiveOperation()).toBeNull();
    expect(errors).toHaveBeenCalledWith(
      "[filetrail] couldn't record an operation for Undo",
      expect.any(Error),
    );
    errors.mockRestore();
    await coordinator.shutdown();
  });
});

describe("what a paste records", () => {
  function createSubscribingWriteService() {
    const subscribers: Array<(event: unknown) => void> = [];
    const writeService = {
      subscribe: vi.fn((callback: (event: unknown) => void) => {
        subscribers.push(callback);
        return () => undefined;
      }),
      startCopyPasteAnalysis: vi.fn(() => ({ analysisId: "analysis-1", status: "queued" })),
      startCopyPaste: vi.fn(() => ({ operationId: "copy-op-1", status: "queued" })),
      cancelOperation: vi.fn(() => ({ ok: true })),
    } as unknown as WriteService;
    return {
      writeService,
      finish(undoLog: UndoLog | undefined) {
        for (const subscriber of subscribers) {
          subscriber({
            operationId: "copy-op-1",
            mode: "copy",
            status: "completed",
            completedItemCount: 1,
            totalItemCount: 1,
            completedByteCount: 0,
            totalBytes: null,
            currentSourcePath: null,
            currentDestinationPath: null,
            runtimeConflict: null,
            result: {
              operationId: "copy-op-1",
              mode: "copy",
              status: "completed",
              destinationDirectoryPath: "/Volumes/Share",
              startedAt: "2026-10-05T12:00:00.000Z",
              finishedAt: "2026-10-05T12:00:00.050Z",
              summary: {
                topLevelItemCount: 1,
                totalItemCount: 1,
                completedItemCount: 1,
                failedItemCount: 0,
                skippedItemCount: 0,
                cancelledItemCount: 0,
                completedByteCount: 0,
                totalBytes: null,
              },
              items: [
                {
                  sourcePath: "/Users/demo/a.txt",
                  destinationPath: "/Volumes/Share/a.txt",
                  status: "completed",
                  error: null,
                },
              ],
              error: null,
              ...(undoLog ? { undoLog } : {}),
            },
          });
        }
      },
    };
  }

  async function paste(
    undoLog: UndoLog | undefined,
    diskHasTrash: (path: string) => boolean = () => true,
  ) {
    const service = createSubscribingWriteService();
    const { coordinator, finished, sender } = setUp({
      writeService: service.writeService,
      diskHasTrash,
    });
    await coordinator.handlers["copyPaste:analyzeStart"](
      {
        mode: "copy",
        sourcePaths: ["/Users/demo/a.txt"],
        destinationDirectoryPath: "/Volumes/Share",
        action: "copy_to",
      },
      { sender },
    );
    await coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "copy_to",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      },
      { sender },
    );
    service.finish(undoLog);
    await coordinator.shutdown();
    return finished;
  }

  const copied: UndoLog = {
    undoable: true,
    units: [
      {
        steps: [
          { kind: "created", path: "/Volumes/Share/a.txt", id: { dev: 9, ino: 1 }, stamp: null },
        ],
      },
    ],
  };

  it("passes on the paste's own log, with the action that started it", async () => {
    expect(await paste(copied)).toEqual([
      {
        action: "copy_to",
        log: copied,
        items: [expect.objectContaining({ destinationPath: "/Volumes/Share/a.txt" })],
      },
    ]);
  });

  it("can't undo copies made on a disk without a Trash", async () => {
    const asked: string[] = [];
    const finished = await paste(copied, (path) => {
      asked.push(path);
      return false;
    });

    expect(finished.map((entry) => entry.log)).toEqual([{ undoable: false, reason: "no_trash" }]);
    expect(asked).toEqual(["/Volumes/Share"]);
  });

  // Each answer reads the mount table.
  it("asks whether a disk has a Trash once per folder the copies are in", async () => {
    const created = (path: string, ino: number) => ({
      steps: [{ kind: "created" as const, path, id: { dev: 9, ino }, stamp: null }],
    });
    const asked: string[] = [];
    const log: UndoLog = {
      undoable: true,
      units: [
        created("/Volumes/Share/a.txt", 1),
        created("/Volumes/Share/b.txt", 2),
        created("/Volumes/Share/c.txt", 3),
        created("/Volumes/Other/d.txt", 4),
      ],
    };

    const finished = await paste(log, (path) => {
      asked.push(path);
      return true;
    });

    expect(finished.map((entry) => entry.log)).toEqual([log]);
    expect(asked).toEqual(["/Volumes/Share", "/Volumes/Other"]);
  });

  it("passes on a paste that can't be undone", async () => {
    expect((await paste({ undoable: false, reason: "merge" })).map((entry) => entry.log)).toEqual([
      { undoable: false, reason: "merge" },
    ]);
  });

  it("records nothing for a paste that did nothing", async () => {
    expect(await paste({ undoable: true, units: [] })).toEqual([]);
    expect(await paste(undefined)).toEqual([]);
  });
});

describe("a paste that changed nothing", () => {
  // Add Missing where every item is there already: nothing is written, so what came
  // before can still be undone.
  it("leaves the history as it was", async () => {
    writeFileSync(join(root, "a.txt"), "a");
    mkdirSync(join(root, "src", "Folder"), { recursive: true });
    writeFileSync(join(root, "src", "Folder", "x.txt"), "new");
    mkdirSync(join(root, "dst", "Folder"), { recursive: true });
    writeFileSync(join(root, "dst", "Folder", "x.txt"), "old");
    const history = createUndoHistory();
    const coordinator = createWriteOperationCoordinator(
      createWriteService(),
      createOriginalWriteOperationFs(folderTrash()),
      { homePath: root, recordUndo: history.record, undoHistory: history },
    );
    const sender = createSender();
    await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender },
    );
    await waitForTerminalEvent(sender, "write-op-1");
    const generation = history.generation();

    const { analysisId } = await coordinator.handlers["copyPaste:analyzeStart"](
      {
        mode: "copy",
        sourcePaths: [join(root, "src", "Folder")],
        destinationDirectoryPath: join(root, "dst"),
        action: "paste",
      },
      { sender },
    );
    while (!coordinator.handlers["copyPaste:analyzeGetUpdate"]({ analysisId }, { sender }).done) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    }
    const { operationId } = await coordinator.handlers["copyPaste:start"](
      {
        analysisId,
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      },
      { sender },
    );
    expect((await waitForTerminalEvent(sender, operationId)).status).toBe("partial");

    expect(history.generation()).toBe(generation);
    expect(history.menu()).toEqual({ undo: "Rename", redo: null, cantUndo: false });
    await coordinator.shutdown();
  });
});
