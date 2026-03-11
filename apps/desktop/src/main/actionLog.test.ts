import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createActionLogRecorder,
  createActionLogStore,
  resolveActionLogFilePath,
} from "./actionLog";

describe("actionLog", () => {
  it("appends and lists entries newest first", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-action-log-"));
    const store = createActionLogStore(resolveActionLogFilePath(root));
    const recorder = createActionLogRecorder(store);

    await recorder.recordOpenPath({
      path: "/Users/demo/a.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T09:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T09:00:00.010Z"),
    });
    await recorder.recordOpenWithApplication({
      applicationPath: "/Applications/Zed.app",
      applicationName: "Zed",
      paths: ["/Users/demo/b.txt"],
      ok: false,
      error: "Application not found",
      startedAtMs: Date.parse("2026-03-10T10:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T10:00:00.010Z"),
    });

    const items = await store.list();

    expect(items).toHaveLength(2);
    expect(items[0]?.action).toBe("open_with");
    expect(items[1]?.action).toBe("open");
    expect(items[0]?.error).toBe("Application not found");
  });

  it("rotates files when the active log exceeds the size limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-action-log-rotate-"));
    const store = createActionLogStore(resolveActionLogFilePath(root), {
      maxBytes: 250,
      maxFiles: 3,
    });
    const recorder = createActionLogRecorder(store);

    await recorder.recordOpenPath({
      path: "/Users/demo/first-long-name.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T09:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T09:00:00.010Z"),
    });
    await recorder.recordOpenPath({
      path: "/Users/demo/second-long-name.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T10:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T10:00:00.010Z"),
    });
    await recorder.recordOpenPath({
      path: "/Users/demo/third-long-name.txt",
      ok: true,
      error: null,
      startedAtMs: Date.parse("2026-03-10T11:00:00.000Z"),
      finishedAtMs: Date.parse("2026-03-10T11:00:00.010Z"),
    });

    const currentFile = await readFile(resolveActionLogFilePath(root), "utf8");
    const rotatedFile = await readFile(join(root, "logs", "action-log.1.jsonl"), "utf8");

    expect(currentFile.length).toBeGreaterThan(0);
    expect(rotatedFile.length).toBeGreaterThan(0);
  });

  it("records write-operation runtime conflict history and initiation details", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-action-log-write-"));
    const store = createActionLogStore(resolveActionLogFilePath(root));
    const recorder = createActionLogRecorder(store);

    await recorder.recordWriteOperation({
      action: "move_to",
      operationId: "copy-op-9",
      sourcePaths: ["/Users/demo/source"],
      destinationPaths: ["/Users/demo/target"],
      initiator: "drag_drop",
      requestedDestinationPath: "/Users/demo/target",
      runtimeConflicts: [
        {
          conflictId: "conflict-1",
          sourcePath: "/Users/demo/source/b.txt",
          destinationPath: "/Users/demo/target/b.txt",
          sourceKind: "file",
          destinationKind: "file",
          conflictClass: "file_conflict",
          reason: "destination_changed",
          resolution: "skip",
        },
      ],
      result: {
        operationId: "copy-op-9",
        action: "move_to",
        status: "partial",
        targetPath: "/Users/demo/target",
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
      metadata: {
        transferMode: "cut",
      },
    });

    const items = await store.list();

    expect(items).toHaveLength(1);
    expect(items[0]?.initiator).toBe("drag_drop");
    expect(items[0]?.requestedDestinationPath).toBe("/Users/demo/target");
    expect(items[0]?.runtimeConflicts).toEqual([
      expect.objectContaining({
        conflictId: "conflict-1",
        resolution: "skip",
      }),
    ]);
    expect(items[0]?.items[1]?.skipReason).toBe("runtime_conflict_resolution");
  });
});
