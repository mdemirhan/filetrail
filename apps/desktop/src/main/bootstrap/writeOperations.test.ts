import { describe, expect, it, vi } from "vitest";

import type { WriteService } from "@filetrail/core";

import { createWriteOperationCoordinator } from "./writeOperations";

describe("createWriteOperationCoordinator", () => {
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
