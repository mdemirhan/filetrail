import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import {
  ANALYSIS_BUSY_ERROR,
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  type WriteService,
  createWriteService,
} from "@filetrail/core";

import { createOriginalWriteOperationFs } from "../originalFileSystem";
import { createWriteOperationCoordinator } from "./writeOperations";

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

describe("a window taking over an operation", () => {
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
