import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import {
  ANALYSIS_BUSY_ERROR,
  NO_TRASH_ERROR_CODE,
  type WriteService,
  createWriteService,
} from "@filetrail/core";
import { DEFAULT_WRITE_SERVICE_FILE_SYSTEM } from "@filetrail/core/fs/writeServiceTypes";

import { createOriginalWriteOperationFs } from "../originalFileSystem";
import { clearResponseCaches } from "./responseCache";
import { createUndoHistory } from "./undoHistory";
import {
  type FinishedWrite,
  createWriteOperationCoordinator,
  sendToEachWindow,
} from "./writeOperations";

// Forgetting cached listings tells the folder sizes, which can go wrong; the tests make it.
vi.mock("./responseCache", async (importOriginal) => {
  const original = await importOriginal<typeof import("./responseCache")>();
  return { ...original, clearResponseCaches: vi.fn(original.clearResponseCaches) };
});

// Operations and copy analyses with several windows open: each belongs to the window that
// started it, and is handed on or cancelled when that window goes away.

type Coordinator = ReturnType<typeof createWriteOperationCoordinator>;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "filetrail-windows-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// A stand-in for WebContents: an event emitter that can be marked destroyed.
function createWindow() {
  const window = Object.assign(new EventEmitter(), {
    destroyed: false,
    send: vi.fn<(channel: string, payload: unknown) => void>(),
    isDestroyed: () => window.destroyed,
  });
  return window;
}

type Window = ReturnType<typeof createWindow>;

function close(window: Window, event: "destroyed" | "render-process-gone" = "destroyed") {
  window.destroyed = true;
  window.emit(event);
}

function progressSentTo(window: Window): WriteOperationProgressEvent[] {
  return window.send.mock.calls
    .filter(([channel]) => channel === "filetrail:writeOperationProgress")
    .map(([, payload]) => payload as WriteOperationProgressEvent);
}

async function waitFor<T>(read: () => T | null): Promise<T> {
  const deadline = Date.now() + 4_000;
  for (;;) {
    const value = read();
    if (value !== null) {
      return value;
    }
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }
}

function waitForEnd(window: Window, operationId: string): Promise<WriteOperationProgressEvent> {
  return waitFor(
    () =>
      progressSentTo(window).find(
        (event) =>
          event.operationId === operationId &&
          ["completed", "failed", "cancelled", "partial"].includes(event.status),
      ) ?? null,
  );
}

// A write service whose events the test sends, as the real one would.
function createWriteServiceStub() {
  const subscribers: Array<(event: unknown) => void> = [];
  const writeService = {
    subscribe: vi.fn((callback: (event: unknown) => void) => {
      subscribers.push(callback);
      return () => undefined;
    }),
    startCopyPasteAnalysis: vi.fn(() => ({ analysisId: "analysis-1", status: "queued" })),
    cancelCopyPasteAnalysis: vi.fn(() => ({ ok: true })),
    startCopyPaste: vi.fn(() => ({ operationId: "copy-op-1", status: "queued" })),
    resolveRuntimeConflict: vi.fn(() => ({ ok: true })),
    cancelOperation: vi.fn(() => ({ ok: true })),
  };
  return {
    writeService: writeService as typeof writeService & WriteService,
    emit(event: Record<string, unknown>) {
      for (const subscriber of subscribers) {
        subscriber(event);
      }
    },
  };
}

function copyEvent(status: string, extra: Record<string, unknown> = {}) {
  return {
    operationId: "copy-op-1",
    mode: "copy",
    status,
    completedItemCount: 0,
    totalItemCount: 1,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result: null,
    ...extra,
  };
}

// The end of a paste that copied (or moved) a.txt into /Volumes/Share, with what it did for
// Undo.
function copiedEvent(mode: "copy" | "cut" = "copy") {
  return copyEvent("completed", {
    mode,
    completedItemCount: 1,
    result: {
      operationId: "copy-op-1",
      mode,
      status: "completed",
      destinationDirectoryPath: "/Volumes/Share",
      startedAt: "2026-10-08T12:00:00.000Z",
      finishedAt: "2026-10-08T12:00:00.050Z",
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
      undoLog: {
        undoable: true,
        units: [
          {
            steps: [
              {
                kind: "created",
                path: "/Volumes/Share/a.txt",
                id: { dev: 9, ino: 1 },
                stamp: null,
              },
            ],
          },
        ],
      },
    },
  });
}

function fingerprint() {
  return {
    exists: true,
    kind: "file" as const,
    size: 1,
    mtimeMs: 1,
    mode: 0o644,
    ino: 1,
    dev: 1,
    symlinkTarget: null,
  };
}

function conflict(conflictId: string) {
  return {
    conflictId,
    analysisId: "analysis-1",
    sourcePath: "/Users/demo/source/b.txt",
    destinationPath: "/Users/demo/target/b.txt",
    sourceKind: "file" as const,
    destinationKind: "file" as const,
    conflictClass: "file_conflict" as const,
    reason: "destination_changed" as const,
    sourceFingerprint: fingerprint(),
    destinationFingerprint: fingerprint(),
    currentSourceFingerprint: fingerprint(),
    currentDestinationFingerprint: fingerprint(),
  };
}

function analyze(
  coordinator: Coordinator,
  window: Window,
  sourcePaths: string[] = ["/Users/demo/a.txt"],
  destinationDirectoryPath = "/Users/demo/b",
) {
  return coordinator.handlers["copyPaste:analyzeStart"](
    { mode: "copy", sourcePaths, destinationDirectoryPath, action: "paste" },
    { sender: window },
  );
}

function paste(coordinator: Coordinator, window: Window, analysisId = "analysis-1") {
  return coordinator.handlers["copyPaste:start"](
    { analysisId, action: "paste", policy: { file: "skip", directory: "merge", mismatch: "skip" } },
    { sender: window },
  );
}

async function analyzed(coordinator: Coordinator, window: Window, analysisId: string) {
  return waitFor(() => {
    const update = coordinator.handlers["copyPaste:analyzeGetUpdate"](
      { analysisId },
      { sender: window },
    );
    return update.done ? update : null;
  });
}

describe("a paste starting", () => {
  // The write service says "queued" before startCopyPaste returns, when the paste has no
  // window yet.
  it("tells the other windows it is queued", async () => {
    const { writeService, emit } = createWriteServiceStub();
    writeService.startCopyPaste.mockImplementation(() => {
      emit(copyEvent("queued"));
      return { operationId: "copy-op-1", status: "queued" };
    });
    const broadcastProgress = vi.fn();
    const successor = createWindow();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { broadcastProgress, successorOf: () => successor },
    );
    const owner = createWindow();
    await analyze(coordinator, owner);

    await paste(coordinator, owner);

    expect(broadcastProgress).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "copy-op-1", status: "queued", action: "paste" }),
      owner,
    );
    // The window that started it knows from the reply.
    expect(progressSentTo(owner)).toEqual([]);
    // A window taking it over before anything else is heard knows it is queued.
    close(owner);
    expect(successor.send).toHaveBeenCalledWith("filetrail:writeOperationAdopted", {
      operationId: "copy-op-1",
      event: expect.objectContaining({ status: "queued" }),
    });
    emit(copyEvent("cancelled"));
    await coordinator.shutdown();
  });
});

describe("a paste ending", () => {
  // The window follows what a paste after Cut moved, as it follows a Move To.
  it("tells the window whether it copied or moved the items", async () => {
    const { writeService, emit } = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
    );
    const window = createWindow();
    await analyze(coordinator, window);
    await paste(coordinator, window);

    emit(copiedEvent("cut"));

    expect((await waitForEnd(window, "copy-op-1")).result).toMatchObject({
      action: "paste",
      mode: "cut",
    });
    await coordinator.shutdown();
  });
});

describe("the other windows", () => {
  // A paste of a large folder lists every file in it: each other window used to be sent
  // them all, and went through them all.
  it("are told of the items a paste worked on, but not of every item inside them", async () => {
    const { writeService, emit } = createWriteServiceStub();
    const broadcastProgress = vi.fn();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { broadcastProgress },
    );
    const owner = createWindow();
    await analyze(coordinator, owner, ["/Users/demo/Folder"]);
    await paste(coordinator, owner);
    const item = (path: string, sourceKind: string) => ({
      sourcePath: `/Users/demo/${path}`,
      destinationPath: `/Users/demo/b/${path}`,
      sourceKind,
      status: "completed",
      error: null,
      skipReason: null,
    });
    const items = [
      item("Folder", "directory"),
      ...["a", "b", "c"].map((name) => item(`Folder/${name}.txt`, "file")),
    ];
    emit(
      copyEvent("completed", {
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/b",
          startedAt: "2026-10-08T10:00:00.000Z",
          finishedAt: "2026-10-08T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 4,
            completedItemCount: 4,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 2,
            totalBytes: 2,
          },
          items,
          error: null,
        },
      }),
    );

    const ownView = items.map(({ sourceKind: _sourceKind, ...rest }) => rest);
    expect((await waitForEnd(owner, "copy-op-1")).result?.items).toEqual(ownView);
    const toOthers = broadcastProgress.mock.calls
      .map(([event]) => event as WriteOperationProgressEvent)
      .find((event) => event.status === "completed");
    // The folder, and one item in it, so the folder is seen to hold what changed.
    expect(toOthers?.result).toMatchObject({
      targetPath: "/Users/demo/b",
      items: ownView.slice(0, 2),
    });
    await coordinator.shutdown();
  });
});

describe("a window taking over an operation", () => {
  it("is told the cut a paste clears from the clipboard when it is done", async () => {
    const { writeService, emit } = createWriteServiceStub();
    const successor = createWindow();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { successorOf: () => successor },
    );
    const owner = createWindow();
    await analyze(coordinator, owner);
    await coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        clearsCutClipboard: "2026-10-07T10:00:00.000Z",
      },
      { sender: owner },
    );

    close(owner);

    expect(successor.send).toHaveBeenCalledWith("filetrail:writeOperationAdopted", {
      operationId: "copy-op-1",
      event: null,
      clearsCutClipboard: "2026-10-07T10:00:00.000Z",
    });
    emit(copyEvent("cancelled"));
    await coordinator.shutdown();
  });

  it("isn't shown a question the window that closed already answered", async () => {
    const { writeService, emit } = createWriteServiceStub();
    const successor = createWindow();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { successorOf: () => successor },
    );
    const owner = createWindow();
    await analyze(coordinator, owner);
    await paste(coordinator, owner);
    emit(copyEvent("awaiting_resolution", { runtimeConflict: conflict("conflict-1") }));

    expect(
      coordinator.handlers["copyPaste:resolveConflict"](
        { operationId: "copy-op-1", conflictId: "conflict-1", resolution: "skip" },
        { sender: owner },
      ),
    ).toEqual({ ok: true });
    // The engine hasn't said anything since when the window closes.
    close(owner);

    expect(successor.send).toHaveBeenCalledWith("filetrail:writeOperationAdopted", {
      operationId: "copy-op-1",
      event: expect.objectContaining({ status: "running", runtimeConflict: null }),
    });
    emit(copyEvent("cancelled"));
    await coordinator.shutdown();
  });

  it("is still shown a question that wasn't answered", async () => {
    const { writeService, emit } = createWriteServiceStub();
    writeService.resolveRuntimeConflict.mockReturnValue({ ok: false });
    const successor = createWindow();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { successorOf: () => successor },
    );
    const owner = createWindow();
    await analyze(coordinator, owner);
    await paste(coordinator, owner);
    emit(copyEvent("awaiting_resolution", { runtimeConflict: conflict("conflict-1") }));

    // An answer the write service refused (a question asked since) leaves it open.
    coordinator.handlers["copyPaste:resolveConflict"](
      { operationId: "copy-op-1", conflictId: "conflict-old", resolution: "skip" },
      { sender: owner },
    );
    close(owner);

    expect(successor.send).toHaveBeenCalledWith("filetrail:writeOperationAdopted", {
      operationId: "copy-op-1",
      event: expect.objectContaining({
        status: "awaiting_resolution",
        runtimeConflict: expect.objectContaining({ conflictId: "conflict-1" }),
      }),
    });
    emit(copyEvent("cancelled"));
    await coordinator.shutdown();
  });
});

// A window opened just before the one running an operation closed: its page may still be
// loading, and miss the message that hands the operation over. It asks once it listens.
describe("a window asking for the operation handed to it", () => {
  function getAdopted(coordinator: Coordinator, window: Window) {
    return coordinator.handlers["writeOperation:getAdopted"]({}, { sender: window });
  }

  async function handedOver(clearsCutClipboard?: string) {
    const { writeService, emit } = createWriteServiceStub();
    const successor = createWindow();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { successorOf: () => successor },
    );
    const owner = createWindow();
    await analyze(coordinator, owner);
    await coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        ...(clearsCutClipboard ? { clearsCutClipboard } : {}),
      },
      { sender: owner },
    );
    return { coordinator, emit, owner, successor };
  }

  it("is told it, with the question it waits on, once", async () => {
    const { coordinator, emit, owner, successor } = await handedOver("2026-10-08T10:00:00.000Z");
    emit(copyEvent("awaiting_resolution", { runtimeConflict: conflict("conflict-1") }));
    close(owner);

    expect(getAdopted(coordinator, successor)).toEqual({
      adoption: {
        operationId: "copy-op-1",
        event: expect.objectContaining({
          status: "awaiting_resolution",
          runtimeConflict: expect.objectContaining({ conflictId: "conflict-1" }),
        }),
        clearsCutClipboard: "2026-10-08T10:00:00.000Z",
      },
    });
    expect(getAdopted(coordinator, successor)).toEqual({ adoption: null });
    // It is the operation's window now: it answers the question.
    expect(
      coordinator.handlers["copyPaste:resolveConflict"](
        { operationId: "copy-op-1", conflictId: "conflict-1", resolution: "skip" },
        { sender: successor },
      ),
    ).toEqual({ ok: true });
    emit(copyEvent("cancelled"));
    await coordinator.shutdown();
  });

  it("is told how it ended when it ended before the window asked", async () => {
    const { coordinator, emit, owner, successor } = await handedOver();
    close(owner);
    emit(copiedEvent());

    expect(coordinator.getActiveOperation()).toBeNull();
    expect(getAdopted(coordinator, successor)).toEqual({
      adoption: {
        operationId: "copy-op-1",
        event: expect.objectContaining({
          status: "completed",
          result: expect.objectContaining({ status: "completed" }),
        }),
      },
    });
    await coordinator.shutdown();
  });

  it("is told nothing when nothing was handed to it, or it was handed on again", async () => {
    const { writeService, emit } = createWriteServiceStub();
    const second = createWindow();
    const third = createWindow();
    let successor = second;
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { successorOf: () => successor },
    );
    const owner = createWindow();
    await analyze(coordinator, owner);
    await paste(coordinator, owner);
    expect(getAdopted(coordinator, second)).toEqual({ adoption: null });

    close(owner);
    successor = third;
    close(second);

    expect(getAdopted(coordinator, second)).toEqual({ adoption: null });
    expect(getAdopted(coordinator, third)).toEqual({
      adoption: { operationId: "copy-op-1", event: null },
    });
    emit(copyEvent("cancelled"));
    await coordinator.shutdown();
  });
});

describe("telling every window", () => {
  it("tells the others when one window can't be told", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = createWindow();
    const broken = createWindow();
    broken.send.mockImplementation(() => {
      throw new Error("Object has been destroyed");
    });
    const closed = createWindow();
    closed.destroyed = true;
    const last = createWindow();

    sendToEachWindow([first, broken, closed, last], "filetrail:writeOperationProgress", "end");

    expect(first.send).toHaveBeenCalledWith("filetrail:writeOperationProgress", "end");
    expect(last.send).toHaveBeenCalledWith("filetrail:writeOperationProgress", "end");
    expect(closed.send).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  // A window that missed the end of another window's operation asks.
  it("says which operation runs, if any", async () => {
    const { writeService, emit } = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
    );
    const window = createWindow();
    expect(coordinator.handlers["writeOperation:getActive"]()).toEqual({ operationId: null });

    await analyze(coordinator, window);
    await paste(coordinator, window);
    expect(coordinator.handlers["writeOperation:getActive"]()).toEqual({
      operationId: "copy-op-1",
    });

    emit(copyEvent("cancelled"));
    expect(coordinator.handlers["writeOperation:getActive"]()).toEqual({ operationId: null });
    await coordinator.shutdown();
  });
});

describe("copy analyses and their windows", () => {
  it.each(["destroyed", "render-process-gone"] as const)(
    "cancels an analysis when its window is %s",
    async (event) => {
      const { writeService } = createWriteServiceStub();
      const coordinator = createWriteOperationCoordinator(
        writeService,
        createOriginalWriteOperationFs(async (path) => path),
      );
      const window = createWindow();
      await analyze(coordinator, window);

      close(window, event);

      expect(writeService.cancelCopyPasteAnalysis).toHaveBeenCalledWith("analysis-1");
      expect(window.listenerCount("destroyed")).toBe(0);
      await coordinator.shutdown();
    },
  );

  it("lets another window set up a copy once the window of a stuck analysis closes", async () => {
    // A folder on a network disk that stopped answering.
    const coordinator = createWriteOperationCoordinator(
      createWriteService({
        fileSystem: {
          ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
          lstat: () => new Promise(() => undefined),
        },
      }),
      createOriginalWriteOperationFs(async (path) => path),
    );
    const first = createWindow();
    const second = createWindow();
    await analyze(coordinator, first, [join(root, "a.txt")], root);
    await expect(analyze(coordinator, second, [join(root, "a.txt")], root)).rejects.toThrow(
      ANALYSIS_BUSY_ERROR,
    );

    close(first);

    await expect(analyze(coordinator, second, [join(root, "a.txt")], root)).resolves.toEqual(
      expect.objectContaining({ status: "queued" }),
    );
    await coordinator.shutdown();
  });

  it("doesn't listen to a window for an analysis it replaced or pasted from", async () => {
    const { writeService, emit } = createWriteServiceStub();
    writeService.startCopyPasteAnalysis
      .mockReturnValueOnce({ analysisId: "analysis-1", status: "queued" })
      .mockReturnValueOnce({ analysisId: "analysis-2", status: "queued" });
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
    );
    const window = createWindow();

    await analyze(coordinator, window);
    await analyze(coordinator, window);
    expect(window.listenerCount("destroyed")).toBe(1);

    // The paste listens for itself.
    await paste(coordinator, window, "analysis-2");
    expect(window.listenerCount("destroyed")).toBe(1);
    expect(
      coordinator.handlers["copyPaste:analyzeCancel"](
        { analysisId: "analysis-2" },
        { sender: window },
      ),
    ).toEqual({ ok: false });
    emit(copyEvent("cancelled"));
    expect(window.listenerCount("destroyed")).toBe(0);
    await coordinator.shutdown();
  });

  it("keeps a window's finished analysis when another window sets up a copy", async () => {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "one"));
    await mkdir(join(root, "two"));
    await writeFile(join(root, "src", "a.txt"), "a");
    const coordinator = createWriteOperationCoordinator(
      createWriteService(),
      createOriginalWriteOperationFs(async (path) => path),
    );
    const first = createWindow();
    const second = createWindow();
    const { analysisId: firstAnalysis } = await analyze(
      coordinator,
      first,
      [join(root, "src", "a.txt")],
      join(root, "one"),
    );
    await analyzed(coordinator, first, firstAnalysis);

    // The second window sets up its copy, and pastes, while the first one's review is open.
    const { analysisId: secondAnalysis } = await analyze(
      coordinator,
      second,
      [join(root, "src", "a.txt")],
      join(root, "two"),
    );
    await analyzed(coordinator, second, secondAnalysis);
    const secondPaste = await paste(coordinator, second, secondAnalysis);
    expect((await waitForEnd(second, secondPaste.operationId)).status).toBe("completed");

    // The first window's review can still be pasted from.
    expect((await analyzed(coordinator, first, firstAnalysis)).status).toBe("complete");
    const firstPaste = await paste(coordinator, first, firstAnalysis);
    expect((await waitForEnd(first, firstPaste.operationId)).status).toBe("completed");
    expect(await readFile(join(root, "one", "a.txt"), "utf8")).toBe("a");
    expect(await readFile(join(root, "two", "a.txt"), "utf8")).toBe("a");
    await coordinator.shutdown();
  });
});

// Every window refuses to start an operation while one runs, until it hears the end.
describe("an operation that stops unexpectedly", () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errors.mockRestore();
  });

  it("tells every window it failed when it stopped without saying so", async () => {
    const folder = join(root, "New");
    const realFs = createOriginalWriteOperationFs(async (path) => path);
    const broadcastProgress = vi.fn();
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub().writeService,
      {
        ...realFs,
        // Reading the new folder back goes wrong in a way nothing expects.
        lstat: async (path) => {
          const stats = await realFs.lstat(path);
          return path === folder
            ? {
                ...stats,
                isDirectory: () => {
                  throw new Error("The disk went away.");
                },
              }
            : stats;
        },
      },
      { homePath: root, broadcastProgress },
    );
    const window = createWindow();

    const { operationId } = await coordinator.handlers["writeOperation:createFolder"](
      { parentDirectoryPath: root, folderName: "New" },
      { sender: window },
    );
    const end = await waitForEnd(window, operationId);

    expect(end).toMatchObject({
      status: "failed",
      result: { error: "The operation stopped unexpectedly: The disk went away." },
    });
    expect(broadcastProgress).toHaveBeenCalledWith(
      expect.objectContaining({ operationId, status: "failed" }),
      window,
    );
    expect(coordinator.getActiveOperation()).toBeNull();
    await coordinator.shutdown();
  });

  it("goes on when the other windows can't be told", async () => {
    await writeFile(join(root, "a.txt"), "a");
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub().writeService,
      createOriginalWriteOperationFs(async (path) => path),
      {
        homePath: root,
        broadcastProgress: () => {
          throw new Error("A window broke.");
        },
      },
    );
    const window = createWindow();

    const { operationId } = await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender: window },
    );

    expect((await waitForEnd(window, operationId)).status).toBe("completed");
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("a");
    expect(coordinator.getActiveOperation()).toBeNull();
    expect(errors).toHaveBeenCalledWith(
      "[filetrail] couldn't tell the other windows about an operation",
      expect.any(Error),
    );
    await coordinator.shutdown();
  });

  it("ends a paste whose disk can't be told to have a Trash, and can't undo it", async () => {
    await writeFile(join(root, "a.txt"), "a");
    const { writeService, emit } = createWriteServiceStub();
    const broadcastProgress = vi.fn();
    const finished: FinishedWrite[] = [];
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      {
        homePath: root,
        broadcastProgress,
        recordUndo: (entry) => finished.push(entry),
        // Reading the mount table goes wrong.
        diskHasTrash: () => {
          throw new Error("The mount table couldn't be read.");
        },
      },
    );
    const window = createWindow();
    await analyze(coordinator, window);
    await paste(coordinator, window);

    emit(copiedEvent());

    expect((await waitForEnd(window, "copy-op-1")).status).toBe("completed");
    expect(broadcastProgress).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "copy-op-1", status: "completed" }),
      window,
    );
    expect(coordinator.getActiveOperation()).toBeNull();
    // Whether its copy could go to the Trash isn't known, so it isn't offered to Undo.
    expect(finished.map((entry) => entry.log)).toEqual([{ undoable: false, reason: "no_trash" }]);
    // The next operation can start.
    const rename = await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender: window },
    );
    expect((await waitForEnd(window, rename.operationId)).status).toBe("completed");
    await coordinator.shutdown();
  });

  it("ends a paste, and frees the slot, when forgetting what it changed goes wrong", async () => {
    const { writeService, emit } = createWriteServiceStub();
    const finished: FinishedWrite[] = [];
    const coordinator = createWriteOperationCoordinator(
      writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { homePath: root, recordUndo: (entry) => finished.push(entry) },
    );
    const window = createWindow();
    await analyze(coordinator, window);
    await paste(coordinator, window);
    vi.mocked(clearResponseCaches).mockImplementationOnce(() => {
      throw new Error("A folder size broke.");
    });

    emit(copiedEvent());

    expect((await waitForEnd(window, "copy-op-1")).status).toBe("completed");
    expect(coordinator.getActiveOperation()).toBeNull();
    expect(finished).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      "[filetrail] couldn't forget what an operation changed",
      expect.any(Error),
    );
    await coordinator.shutdown();
  });

  it("sends the end of a rename when forgetting what it changed goes wrong", async () => {
    await writeFile(join(root, "a.txt"), "a");
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub().writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { homePath: root },
    );
    const window = createWindow();
    vi.mocked(clearResponseCaches).mockImplementationOnce(() => {
      throw new Error("A folder size broke.");
    });

    const { operationId } = await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender: window },
    );

    expect((await waitForEnd(window, operationId)).status).toBe("completed");
    expect(coordinator.getActiveOperation()).toBeNull();
    await coordinator.shutdown();
  });

  it("sends the end of an Undo when keeping the history goes wrong", async () => {
    await writeFile(join(root, "a.txt"), "a");
    const history = createUndoHistory();
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub().writeService,
      createOriginalWriteOperationFs(async (path) => path),
      { homePath: root, recordUndo: history.record, undoHistory: history },
    );
    const window = createWindow();
    const rename = await coordinator.handlers["writeOperation:rename"](
      { sourcePath: join(root, "a.txt"), destinationName: "b.txt" },
      { sender: window },
    );
    await waitForEnd(window, rename.operationId);
    // Rebuilding the menu from the history fails, for one.
    vi.spyOn(history, "finish").mockImplementation(() => {
      throw new Error("The menu broke.");
    });

    const { ticket } = await coordinator.handlers["undo:prepare"]({ direction: "undo" });
    if (ticket === null) {
      throw new Error("Expected something to undo.");
    }
    const undo = await coordinator.handlers["undo:start"]({ ticket }, { sender: window });

    expect((await waitForEnd(window, undo.operationId)).status).toBe("completed");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("a");
    expect(coordinator.getActiveOperation()).toBeNull();
    expect(errors).toHaveBeenCalledWith(
      "[filetrail] couldn't record an Undo in the history",
      expect.any(Error),
    );
    await coordinator.shutdown();
  });
});

describe("deleting immediately what a disk without a Trash couldn't take", () => {
  it("is up to the window that was told, whatever another window sends to the Trash", async () => {
    const rm = vi.fn(async () => undefined);
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub().writeService,
      {
        lstat: async () => ({ isDirectory: () => false }),
        stat: async () => ({ isDirectory: () => true }),
        mkdir: async () => undefined,
        rename: async () => undefined,
        renameExclusive: async () => undefined,
        rm,
        trash: async (path) => {
          if (path.startsWith("/Volumes/Share/")) {
            throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
          }
          return `/Users/demo/.Trash/${path.split("/").at(-1)}`;
        },
      },
      { homePath: "/Users/demo" },
    );
    const first = createWindow();
    const second = createWindow();
    const trash = async (window: Window, path: string) => {
      const { operationId } = await coordinator.handlers["writeOperation:trash"](
        { paths: [path] },
        { sender: window },
      );
      return waitForEnd(window, operationId);
    };
    const deleteImmediately = (window: Window, path: string) =>
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: [path] },
        { sender: window },
      );

    expect((await trash(first, "/Volumes/Share/a.txt")).result?.items[0]).toMatchObject({
      noTrash: true,
    });
    // While the first window asks whether to delete it, the second one moves something
    // to the Trash.
    expect((await trash(second, "/Users/demo/b.txt")).status).toBe("completed");

    // Only the window that was told may delete it.
    await expect(deleteImmediately(second, "/Volumes/Share/a.txt")).rejects.toThrow(
      "isn't in the Trash",
    );
    const { operationId } = await deleteImmediately(first, "/Volumes/Share/a.txt");
    expect((await waitForEnd(first, operationId)).status).toBe("completed");
    expect(rm).toHaveBeenCalledWith("/Volumes/Share/a.txt", { recursive: true, force: true });
    // Once deleted, it is let go of: another item there now is a different matter.
    await expect(deleteImmediately(first, "/Volumes/Share/a.txt")).rejects.toThrow(
      "isn't in the Trash",
    );
    await coordinator.shutdown();
  });

  it("is let go of when the window's page is loaded again", async () => {
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub().writeService,
      {
        lstat: async () => ({ isDirectory: () => false }),
        stat: async () => ({ isDirectory: () => true }),
        mkdir: async () => undefined,
        rename: async () => undefined,
        renameExclusive: async () => undefined,
        rm: async () => undefined,
        trash: async () => {
          throw Object.assign(new Error("no Trash"), { code: NO_TRASH_ERROR_CODE });
        },
      },
      { homePath: "/Users/demo" },
    );
    const window = createWindow();
    const trash = async () => {
      const { operationId } = await coordinator.handlers["writeOperation:trash"](
        { paths: ["/Volumes/Share/a.txt"] },
        { sender: window },
      );
      await waitForEnd(window, operationId);
    };

    // Twice: the window is listened to once.
    await trash();
    window.emit("did-navigate");
    await trash();
    window.emit("did-navigate");

    await expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: ["/Volumes/Share/a.txt"] },
        { sender: window },
      ),
    ).rejects.toThrow("isn't in the Trash");
    expect(window.listenerCount("did-navigate")).toBe(1);
    await coordinator.shutdown();
  });
});
