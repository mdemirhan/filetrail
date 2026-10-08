import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import type { WriteService } from "@filetrail/core";

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
