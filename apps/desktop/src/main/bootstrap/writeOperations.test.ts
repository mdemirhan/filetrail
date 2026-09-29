import { describe, expect, it, vi } from "vitest";

import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import type { WriteService } from "@filetrail/core";

import { createWriteOperationCoordinator } from "./writeOperations";

const electronMock = vi.hoisted(() => ({
  trashItem: vi.fn(),
}));

vi.mock("electron", () => ({
  shell: {
    trashItem: electronMock.trashItem,
  },
}));

describe("createWriteOperationCoordinator", () => {
  it("renames a local item, emits progress, and records the write operation", async () => {
    const recordWriteOperation = vi.fn(async () => undefined);
    const sender = createSender();
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs, {
      recordWriteOperation,
    });

    await expect(
      coordinator.handlers["writeOperation:rename"](
        {
          sourcePath: "/Users/demo/source.txt",
          destinationName: "renamed.txt",
        },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(fs.rename).toHaveBeenCalledWith("/Users/demo/source.txt", "/Users/demo/renamed.txt");
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "rename",
        status: "completed",
        completedItemCount: 1,
        currentDestinationPath: "/Users/demo/renamed.txt",
      }),
    );
    expect(recordWriteOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rename",
        operationId: "write-op-1",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationPaths: ["/Users/demo/renamed.txt"],
      }),
    );

    coordinator.shutdown();
  });

  it("creates a folder only when the parent exists and the target is unused", async () => {
    const sender = createSender();
    const fs = createWriteOperationFs({
      stat: vi.fn(async () => createStats(true)),
      lstat: vi.fn(async () => {
        throw new Error("missing");
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        {
          parentDirectoryPath: "/Users/demo",
          folderName: "Projects",
        },
        { sender },
      ),
    ).resolves.toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(fs.stat).toHaveBeenCalledWith("/Users/demo");
    expect(fs.mkdir).toHaveBeenCalledWith("/Users/demo/Projects");
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "new_folder",
        status: "completed",
        currentDestinationPath: "/Users/demo/Projects",
      }),
    );

    coordinator.shutdown();
  });

  it("moves local paths to Trash through Electron shell and reports partial failures", async () => {
    electronMock.trashItem.mockReset();
    electronMock.trashItem
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Trash unavailable"));
    const sender = createSender();
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );

    expect(
      coordinator.handlers["writeOperation:trash"](
        {
          paths: ["/Users/demo/a.txt", "/Users/demo/b.txt", "/Users/demo/c.txt"],
        },
        { sender },
      ),
    ).toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(electronMock.trashItem).toHaveBeenCalledWith("/Users/demo/a.txt");
    expect(electronMock.trashItem).toHaveBeenCalledWith("/Users/demo/b.txt");
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "trash",
        status: "partial",
        completedItemCount: 1,
        result: expect.objectContaining({
          error: "Trash unavailable",
          items: [
            expect.objectContaining({ sourcePath: "/Users/demo/a.txt", status: "completed" }),
            expect.objectContaining({ sourcePath: "/Users/demo/b.txt", status: "failed" }),
            expect.objectContaining({ sourcePath: "/Users/demo/c.txt", status: "cancelled" }),
          ],
        }),
      }),
    );

    coordinator.shutdown();
  });

  it("delete-immediately reports partial completion while continuing after failed items", async () => {
    const sender = createSender();
    const fs = createWriteOperationFs({
      rm: vi.fn(async (path: string) => {
        if (path.endsWith("b.txt")) {
          throw new Error("delete denied");
        }
      }),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    expect(
      coordinator.handlers["writeOperation:deleteImmediately"](
        {
          paths: ["/Users/demo/a.txt", "/Users/demo/b.txt", "/Users/demo/c.txt"],
        },
        { sender },
      ),
    ).toEqual({ operationId: "write-op-1", status: "queued" });
    const terminal = await waitForTerminalEvent(sender, "write-op-1");

    expect(fs.rm).toHaveBeenCalledTimes(3);
    expect(terminal).toEqual(
      expect.objectContaining({
        action: "delete_immediately",
        status: "partial",
        completedItemCount: 2,
        result: expect.objectContaining({
          error: "delete denied",
        }),
      }),
    );

    coordinator.shutdown();
  });

  it("rejects protected top-level Trash mutations before queuing local writes", async () => {
    const coordinator = createWriteOperationCoordinator(
      createWriteServiceStub(),
      createWriteOperationFs(),
    );
    const trashPath = resolve(homedir(), ".Trash");

    await expect(
      coordinator.handlers["writeOperation:rename"](
        {
          sourcePath: trashPath,
          destinationName: "Renamed Trash",
        },
        { sender: createSender() },
      ),
    ).rejects.toThrow("protected system directory");
    expect(() =>
      coordinator.handlers["writeOperation:trash"](
        { paths: [trashPath] },
        { sender: createSender() },
      ),
    ).toThrow("protected system directory");
    expect(() =>
      coordinator.handlers["writeOperation:deleteImmediately"](
        { paths: [trashPath] },
        { sender: createSender() },
      ),
    ).toThrow("protected system directory");

    coordinator.shutdown();
  });

  it("holds the busy lock while local write operations are in flight and releases it on terminal events", async () => {
    let finishRename: (() => void) | null = null;
    const sender = createSender();
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
      rename: vi.fn(
        () =>
          new Promise<void>((resolveRename) => {
            finishRename = resolveRename;
          }),
      ),
      stat: vi.fn(async () => createStats(true)),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);

    await coordinator.handlers["writeOperation:rename"](
      {
        sourcePath: "/Users/demo/source.txt",
        destinationName: "renamed.txt",
      },
      { sender },
    );
    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        {
          parentDirectoryPath: "/Users/demo",
          folderName: "Blocked",
        },
        { sender: createSender() },
      ),
    ).rejects.toThrow("Another write operation is already running.");

    (finishRename as (() => void) | null)?.();
    await waitForTerminalEvent(sender, "write-op-1");
    await expect(
      coordinator.handlers["writeOperation:createFolder"](
        {
          parentDirectoryPath: "/Users/demo",
          folderName: "Allowed",
        },
        { sender: createSender() },
      ),
    ).resolves.toEqual({ operationId: "write-op-2", status: "queued" });

    coordinator.shutdown();
  });

  it("routes local and delegated cancellation requests to the correct operation owner", async () => {
    let finishRename: (() => void) | null = null;
    const sender = createSender();
    const writeService = createWriteServiceStub();
    const fs = createWriteOperationFs({
      lstat: vi.fn(async (path: string) => {
        if (path === "/Users/demo/source.txt") {
          return createStats(false);
        }
        throw new Error("missing");
      }),
      rename: vi.fn(
        () =>
          new Promise<void>((resolveRename) => {
            finishRename = resolveRename;
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(writeService, fs);

    await coordinator.handlers["writeOperation:rename"](
      {
        sourcePath: "/Users/demo/source.txt",
        destinationName: "renamed.txt",
      },
      { sender },
    );

    expect(coordinator.handlers["writeOperation:cancel"]({ operationId: "write-op-1" })).toEqual({
      ok: true,
    });
    expect(writeService.cancelOperation).not.toHaveBeenCalledWith("write-op-1");
    expect(coordinator.handlers["writeOperation:cancel"]({ operationId: "copy-op-1" })).toEqual({
      ok: true,
    });
    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");

    (finishRename as (() => void) | null)?.();
    await waitForTerminalEvent(sender, "write-op-1");
    coordinator.shutdown();
  });

  it("records initiator, requested destination, and runtime conflict resolutions for copy-paste operations", async () => {
    const subscribers: Array<(event: Record<string, unknown>) => void> = [];
    const recordWriteOperation = vi.fn(async () => undefined);
    const writeService = {
      subscribe: vi.fn((callback: (event: Record<string, unknown>) => void) => {
        subscribers.push(callback);
        return () => undefined;
      }),
      startCopyPaste: vi.fn(() => ({ operationId: "copy-op-1", status: "queued" as const })),
      getCopyPasteAnalysisUpdate: vi.fn(() => ({
        report: {
          mode: "cut" as const,
          destinationDirectoryPath: "/Users/demo/target",
        },
      })),
      resolveRuntimeConflict: vi.fn(() => ({ ok: true })),
      cancelOperation: vi.fn(() => ({ ok: true })),
      startCopyPasteAnalysis: vi.fn(),
      cancelCopyPasteAnalysis: vi.fn(),
      planCopyPaste: vi.fn(),
    } as unknown as WriteService;
    const coordinator = createWriteOperationCoordinator(
      writeService,
      {
        lstat: vi.fn(),
        stat: vi.fn(),
        mkdir: vi.fn(),
        rename: vi.fn(),
        rm: vi.fn(),
      },
      { recordWriteOperation },
    );

    coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "move_to",
        initiator: "drag_drop",
        policy: {
          file: "skip",
          directory: "merge",
          mismatch: "skip",
        },
      },
      { sender: { send: vi.fn() } },
    );

    const emit = subscribers[0];
    if (!emit) {
      throw new Error("Expected write-service subscriber to be registered.");
    }

    emit({
      operationId: "copy-op-1",
      mode: "cut",
      status: "awaiting_resolution",
      completedItemCount: 1,
      totalItemCount: 2,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: "/Users/demo/source/b.txt",
      currentDestinationPath: "/Users/demo/target/b.txt",
      runtimeConflict: {
        conflictId: "conflict-1",
        analysisId: "analysis-1",
        sourcePath: "/Users/demo/source/b.txt",
        destinationPath: "/Users/demo/target/b.txt",
        sourceKind: "file",
        destinationKind: "file",
        conflictClass: "file_conflict",
        reason: "destination_changed",
        sourceFingerprint: createNodeFingerprint(),
        destinationFingerprint: createNodeFingerprint(),
        currentSourceFingerprint: createNodeFingerprint(),
        currentDestinationFingerprint: createNodeFingerprint(),
      },
      result: null,
      action: "move_to",
    });

    coordinator.handlers["copyPaste:resolveConflict"]({
      operationId: "copy-op-1",
      conflictId: "conflict-1",
      resolution: "skip",
    });

    emit({
      operationId: "copy-op-1",
      mode: "cut",
      status: "partial",
      completedItemCount: 1,
      totalItemCount: 2,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      runtimeConflict: null,
      result: {
        operationId: "copy-op-1",
        mode: "cut",
        status: "partial",
        destinationDirectoryPath: "/Users/demo/target",
        startedAt: "2026-03-10T12:00:00.000Z",
        finishedAt: "2026-03-10T12:00:00.050Z",
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 2,
          completedItemCount: 1,
          failedItemCount: 0,
          skippedItemCount: 1,
          cancelledItemCount: 0,
          completedByteCount: 0,
          totalBytes: null,
        },
        items: [
          {
            sourcePath: "/Users/demo/source/a.txt",
            destinationPath: "/Users/demo/target/a.txt",
            status: "completed",
            error: null,
            skipReason: null,
          },
          {
            sourcePath: "/Users/demo/source/b.txt",
            destinationPath: "/Users/demo/target/b.txt",
            status: "skipped",
            error: null,
            skipReason: "runtime_conflict_resolution",
          },
        ],
        error: null,
      },
      action: "move_to",
    });

    expect(recordWriteOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "move_to",
        initiator: "drag_drop",
        requestedDestinationPath: "/Users/demo/target",
        metadata: {
          transferMode: "cut",
        },
        runtimeConflicts: [
          expect.objectContaining({
            conflictId: "conflict-1",
            resolution: "skip",
            sourcePath: "/Users/demo/source/b.txt",
            destinationPath: "/Users/demo/target/b.txt",
          }),
        ],
      }),
    );

    coordinator.shutdown();
  });

  it("cancels a paste whose window crashed or closed, so writes don't stay locked", () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = Object.assign(new EventEmitter(), { send: vi.fn() });

    coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      },
      { sender },
    );
    sender.emit("render-process-gone");

    expect(writeService.cancelOperation).toHaveBeenCalledWith("copy-op-1");
    coordinator.shutdown();
    expect(sender.listenerCount("destroyed")).toBe(0);
  });

  it("rejects a paste that arrives while a rename is still being prepared", async () => {
    let finishLstat: (() => void) | null = null;
    const fs = createWriteOperationFs({
      lstat: vi.fn(
        (path: string) =>
          new Promise<{ isDirectory(): boolean }>((resolveLstat, rejectLstat) => {
            finishLstat = () =>
              path === "/Users/demo/source.txt"
                ? resolveLstat(createStats(false))
                : rejectLstat(new Error("missing"));
          }),
      ),
    });
    const coordinator = createWriteOperationCoordinator(createWriteServiceStub(), fs);
    const sender = createSender();

    const rename = coordinator.handlers["writeOperation:rename"](
      { sourcePath: "/Users/demo/source.txt", destinationName: "renamed.txt" },
      { sender },
    );
    expect(() =>
      coordinator.handlers["copyPaste:start"](
        {
          analysisId: "analysis-1",
          action: "paste",
          policy: { file: "skip", directory: "merge", mismatch: "skip" },
        },
        { sender },
      ),
    ).toThrow("Another write operation is already running.");

    (finishLstat as (() => void) | null)?.();
    rename.catch(() => undefined);
    coordinator.shutdown();
  });

  it("passes per-item choices and standing runtime answers to the write service", () => {
    const writeService = createWriteServiceStub();
    const coordinator = createWriteOperationCoordinator(writeService, createWriteOperationFs());
    const sender = createSender();

    coordinator.handlers["copyPaste:start"](
      {
        analysisId: "analysis-1",
        action: "paste",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
        overrides: [{ nodeId: "item-2", action: "overwrite" }],
      },
      { sender },
    );
    coordinator.handlers["copyPaste:resolveConflict"]({
      operationId: "copy-op-1",
      conflictId: "runtime-item-1-destination",
      resolution: "skip",
      applyToRemaining: true,
    });

    expect(writeService.startCopyPaste).toHaveBeenCalledWith({
      analysisId: "analysis-1",
      policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
      overrides: [{ nodeId: "item-2", action: "overwrite" }],
    });
    expect(writeService.resolveRuntimeConflict).toHaveBeenCalledWith(
      "copy-op-1",
      "runtime-item-1-destination",
      "skip",
      true,
    );
    coordinator.shutdown();
  });
});

function createNodeFingerprint() {
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

function createWriteServiceStub(): WriteService {
  return {
    subscribe: vi.fn(() => () => undefined),
    startCopyPaste: vi.fn(() => ({ operationId: "copy-op-1", status: "queued" as const })),
    getCopyPasteAnalysisUpdate: vi.fn(() => ({
      analysisId: "analysis-1",
      status: "complete" as const,
      done: true,
      report: null,
      error: null,
    })),
    resolveRuntimeConflict: vi.fn(() => ({ ok: true })),
    cancelOperation: vi.fn(() => ({ ok: true })),
    startCopyPasteAnalysis: vi.fn(() => ({ analysisId: "analysis-1", status: "queued" as const })),
    cancelCopyPasteAnalysis: vi.fn(() => ({ ok: true })),
    planCopyPaste: vi.fn(),
  } as unknown as WriteService;
}

function createWriteOperationFs(overrides: Partial<WriteOperationFs> = {}): WriteOperationFs {
  return {
    lstat:
      overrides.lstat ??
      vi.fn(async () => {
        throw new Error("missing");
      }),
    stat: overrides.stat ?? vi.fn(async () => createStats(true)),
    mkdir: overrides.mkdir ?? vi.fn(async () => undefined),
    rename: overrides.rename ?? vi.fn(async () => undefined),
    rm: overrides.rm ?? vi.fn(async () => undefined),
  };
}

type WriteOperationFs = Parameters<typeof createWriteOperationCoordinator>[1];

function createStats(directory: boolean) {
  return {
    isDirectory: () => directory,
  };
}

function createSender() {
  return {
    send: vi.fn<(channel: string, payload: unknown) => void>(),
  };
}

async function waitForTerminalEvent(
  sender: ReturnType<typeof createSender>,
  operationId: string,
): Promise<WriteOperationProgressEvent> {
  return waitFor(() => {
    const event = sender.send.mock.calls
      .map(([, payload]) => payload as WriteOperationProgressEvent)
      .find(
        (candidate) =>
          candidate.operationId === operationId &&
          ["completed", "failed", "cancelled", "partial"].includes(candidate.status),
      );
    return event ?? null;
  });
}

async function waitFor<T>(read: () => T | null): Promise<T> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const value = read();
    if (value !== null) {
      return value;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
  }
  throw new Error("Timed out waiting for condition.");
}
