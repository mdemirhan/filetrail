import { vi } from "vitest";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { MockWriteServiceFileSystem } from "./testUtils";
import type {
  CopyPasteOperationResult,
  CopyPasteProgressEvent,
  ReplaceJournalEntry,
} from "./writeServiceTypes";
import { type WriteJournalEntry, isReplaceJournalEntry } from "./writeServiceTypes";

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error("Expected value to be defined.");
  }
  return value;
}

function expectNode(fileSystem: MockWriteServiceFileSystem, path: string) {
  return expectDefined(fileSystem.readNode(path));
}

function expectLastEvent(events: CopyPasteProgressEvent[]) {
  return expectDefined(events.at(-1));
}

/** Hidden names a Replace builds the new item under; none may be left behind. */
function temporaryLeftovers(fileSystem: MockWriteServiceFileSystem): string[] {
  return [...fileSystem.nodes.keys()].filter((path) => path.includes(".filetrail-"));
}

/** Replaces `rm` with a recording implementation that still deletes nodes. */
function recordRmCalls(
  fileSystem: MockWriteServiceFileSystem,
): Array<{ path: string; recursive: boolean }> {
  const rmCalls: Array<{ path: string; recursive: boolean }> = [];
  fileSystem.rmImpl = async (path, options) => {
    rmCalls.push({ path, recursive: Boolean(options?.recursive) });
    for (const key of Array.from(fileSystem.nodes.keys())) {
      if (key === path || key.startsWith(`${path}/`)) {
        fileSystem.nodes.delete(key);
      }
    }
  };
  return rmCalls;
}

async function createResolvedOperation(args: {
  fileSystem: MockWriteServiceFileSystem;
  mode?: "copy" | "cut";
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy?: {
    file: "overwrite" | "skip" | "keep_both";
    directory: "overwrite" | "merge" | "skip" | "keep_both";
    mismatch: "overwrite" | "skip" | "keep_both";
  };
}) {
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-1",
    request: {
      mode: args.mode ?? "copy",
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath,
    },
    fileSystem: args.fileSystem,
    thresholds: {
      largeBatchItemThreshold: 100,
      largeBatchByteThreshold: 1000,
    },
  });
  const resolvedNodes = await resolveAnalysisWithPolicy({
    report,
    policy: args.policy ?? {
      file: "skip",
      directory: "merge",
      mismatch: "skip",
    },
    fileSystem: args.fileSystem,
  });
  return {
    report,
    resolvedNodes,
  };
}

describe("copyPasteExecution", () => {
  // Add Missing leaves the files already there: progress runs to what is copied, not to
  // the size of everything picked.
  it("counts only what an Add Missing merge copies toward the bytes to go", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/F/a.txt": { kind: "file", size: 10 },
      "/source/F/b.txt": { kind: "file", size: 20 },
      "/target/F/a.txt": { kind: "file", size: 10 },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/F"],
      destinationDirectoryPath: "/target",
    });
    const events: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "op-add-missing",
      report,
      mode: "copy",
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
      fileSystem,
      now: () => new Date("2026-10-09T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution: async () => null,
    });

    expect(report.summary.totalBytes).toBe(30);
    expect(events.map((event) => event.totalBytes)).toEqual(events.map(() => 20));
    const result = expectDefined(expectLastEvent(events).result);
    expect(result.summary).toMatchObject({ completedByteCount: 20, totalBytes: 20 });
  });

  it("copies a new file and emits a completed result", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    const events: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution: async () => null,
    });

    expect(fileSystem.exists("/target/file.txt")).toBe(true);
    expect(events.at(-1)).toMatchObject({
      status: "completed",
      result: {
        summary: {
          completedItemCount: 1,
        },
      },
    });
  });

  it("overwrites conflicting files when the resolved action requires it", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5, mode: 0o755 },
      "/target": { kind: "directory" },
      "/target/file.txt": { kind: "file", size: 2, mode: 0o644 },
    });
    fileSystem.enableTrash();
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.readNode("/target/file.txt")).toMatchObject({
      kind: "file",
      size: 5,
      mode: 0o755,
    });
  });

  it("treats a destination that vanishes while being deleted permanently as already removed", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
      "/target/file.txt": { kind: "file", size: 2 },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
    });
    const originalRm = fileSystem.rm.bind(fileSystem);
    let removedOnce = false;
    fileSystem.rmImpl = async (path, options) => {
      if (path === "/target/file.txt" && removedOnce === false) {
        removedOnce = true;
        fileSystem.nodes.delete("/target/file.txt");
        if (options?.force) {
          return;
        }
        throw Object.assign(new Error("ENOENT: /target/file.txt"), { code: "ENOENT", path });
      }
      await originalRm(path, options);
    };

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-enoent",
      report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      // No Trash here: the person agreed to delete the existing item permanently.
      requestResolution: async (conflict) =>
        conflict.reason === "trash_unavailable" ? "overwrite" : null,
    });

    expect(fileSystem.readNode("/target/file.txt")).toMatchObject({
      kind: "file",
      size: 5,
    });
  });

  it("merges existing folders and applies nested file actions", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/new.txt": { kind: "file", size: 1 },
      "/source/Folder/shared.txt": { kind: "file", size: 8, mode: 0o755 },
      "/target": { kind: "directory" },
      "/target/Folder": { kind: "directory" },
      "/target/Folder/shared.txt": { kind: "file", size: 2, mode: 0o644 },
    });
    fileSystem.enableTrash();
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.readNode("/target/Folder/new.txt")?.size).toBe(1);
    expect(fileSystem.readNode("/target/Folder/shared.txt")).toMatchObject({
      size: 8,
      mode: 0o755,
    });
  });

  it("copies directories with hidden files and hidden folders", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/.env": { kind: "file", size: 7 },
      "/source/Folder/.config": { kind: "directory" },
      "/source/Folder/.config/settings.json": { kind: "file", size: 11 },
      "/source/Folder/visible.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      mode: "copy",
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-hidden-1",
      report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.exists("/target/Folder/.env")).toBe(true);
    expect(fileSystem.exists("/target/Folder/.config")).toBe(true);
    expect(fileSystem.exists("/target/Folder/.config/settings.json")).toBe(true);
    expect(fileSystem.exists("/target/Folder/visible.txt")).toBe(true);
  });

  it("replaces conflicting folders and deletes destination-only nested items", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/shared.txt": { kind: "file", size: 8, mode: 0o755 },
      "/target": { kind: "directory" },
      "/target/Folder": { kind: "directory" },
      "/target/Folder/shared.txt": { kind: "file", size: 2, mode: 0o644 },
      "/target/Folder/destination-only.txt": { kind: "file", size: 3, mode: 0o600 },
      "/target/Folder/nested": { kind: "directory" },
      "/target/Folder/nested/left-behind.txt": { kind: "file", size: 1, mode: 0o600 },
    });
    fileSystem.enableTrash();
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "overwrite",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "overwrite",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.exists("/target/Folder/shared.txt")).toBe(true);
    expect(fileSystem.readNode("/target/Folder/shared.txt")).toMatchObject({
      size: 8,
      mode: 0o755,
    });
    expect(fileSystem.exists("/target/Folder/destination-only.txt")).toBe(false);
    expect(fileSystem.exists("/target/Folder/nested/left-behind.txt")).toBe(false);
  });

  it("does not prompt for nested descendant conflicts under a replaced folder", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/nested": { kind: "directory" },
      "/source/Folder/nested/deep.txt": { kind: "file", size: 8, mode: 0o755 },
      "/target": { kind: "directory" },
      "/target/Folder": { kind: "directory" },
      "/target/Folder/nested": { kind: "directory" },
      "/target/Folder/nested/deep.txt": { kind: "file", size: 2, mode: 0o644 },
    });
    fileSystem.enableTrash();
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "overwrite",
        mismatch: "skip",
      },
    });
    const requestResolution = vi.fn(async () => "overwrite" as const);

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "overwrite",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution,
    });

    expect(requestResolution).not.toHaveBeenCalled();
    expect(fileSystem.readNode("/target/Folder/nested/deep.txt")).toMatchObject({
      size: 8,
      mode: 0o755,
    });
  });

  it("overwrites a conflicting file with a source directory when mismatch policy requests overwrite", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Photos": { kind: "directory" },
      "/source/Photos/a.jpg": { kind: "file", size: 3 },
      "/target": { kind: "directory" },
      "/target/Photos": { kind: "file", size: 9 },
    });
    fileSystem.enableTrash();
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/Photos"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "overwrite",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "overwrite",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.readNode("/target/Photos")?.kind).toBe("directory");
    expect(fileSystem.readNode("/target/Photos/a.jpg")?.size).toBe(3);
  });

  it("keeps both conflicting files when requested", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/report.txt": { kind: "file", size: 7 },
      "/target": { kind: "directory" },
      "/target/report.txt": { kind: "file", size: 2 },
      "/target/report copy.txt": { kind: "file", size: 2 },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/report.txt"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "keep_both",
        directory: "merge",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "keep_both",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.exists("/target/report copy 2.txt")).toBe(true);
  });

  it("keeps both conflicting directories by creating a duplicate destination and copying children into it", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/a.txt": { kind: "file", size: 7 },
      "/target": { kind: "directory" },
      "/target/Folder": { kind: "directory" },
      "/target/Folder copy": { kind: "directory" },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "keep_both",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "keep_both",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.readNode("/target/Folder copy 2")?.kind).toBe("directory");
    expect(fileSystem.readNode("/target/Folder copy 2/a.txt")?.size).toBe(7);
  });

  it("copies symlinks as symlinks", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/alias": { kind: "symlink", target: "actual.txt" },
      "/target": { kind: "directory" },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/alias"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.readNode("/target/alias")).toMatchObject({
      kind: "symlink",
      target: "actual.txt",
    });
  });

  it("pauses for runtime destination conflicts and resumes with the chosen resolution", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.enableTrash();
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    fileSystem.addFile("/target/file.txt", { size: 99 });
    const events: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution: async (conflict) => {
        expect(conflict.reason).toBe("destination_created");
        return "overwrite";
      },
    });

    expect(events.some((event) => event.status === "awaiting_resolution")).toBe(true);
    expect(fileSystem.readNode("/target/file.txt")?.size).toBe(5);
  });

  it("supports cancellation during stream copy", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/slow.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.copyFileImpl = async (_sourcePath, destinationPath, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      signal?.throwIfAborted();
      fileSystem.addFile(destinationPath, { size: 5 });
    };
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/slow.txt"],
      destinationDirectoryPath: "/target",
    });
    const controller = new AbortController();
    const events: CopyPasteProgressEvent[] = [];
    setTimeout(() => controller.abort(), 5);

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: controller.signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution: async () => null,
    });

    expect(events.at(-1)?.status).toBe("cancelled");
    expect(fileSystem.exists("/target/slow.txt")).toBe(false);
  });

  it("removes source files after successful cut and preserves changed sources during cleanup", async () => {
    const movedFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const moveOperation = await createResolvedOperation({
      fileSystem: movedFileSystem,
      mode: "cut",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "cut-op-1",
      report: moveOperation.report,
      mode: "cut",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: movedFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: moveOperation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(movedFileSystem.exists("/source/file.txt")).toBe(false);
    expect(movedFileSystem.exists("/target/file.txt")).toBe(true);

    // On another disk, so the file is copied and its original then removed.
    const changedSourceFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory", dev: 2 },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    changedSourceFileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
      changedSourceFileSystem.addFile(destinationPath, { size: 5 });
      changedSourceFileSystem.mutateNode(sourcePath, (node) => ({
        ...node,
        size: node.size + 1,
      }));
    };
    const changedOperation = await createResolvedOperation({
      fileSystem: changedSourceFileSystem,
      mode: "cut",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "cut-op-2",
      report: changedOperation.report,
      mode: "cut",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: changedSourceFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: changedOperation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(changedSourceFileSystem.exists("/source/file.txt")).toBe(true);
    expect(changedSourceFileSystem.exists("/target/file.txt")).toBe(true);
  });

  it("reports skipped items as a partial result when the resolved top-level action is skip", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
      "/target/file.txt": { kind: "file", size: 2 },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
    });
    const events: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution: async () => null,
    });

    expect(events.at(-1)).toMatchObject({
      status: "partial",
      result: {
        items: [
          expect.objectContaining({
            status: "skipped",
            skipReason: "planned_conflict_policy",
          }),
        ],
      },
    });
  });

  it("cancels immediately when the signal is already aborted", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    const controller = new AbortController();
    controller.abort();
    const events: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: controller.signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution: async () => null,
    });

    expect(events.at(-1)?.status).toBe("cancelled");
  });

  it("reports partial and failed results when later or first items fail", async () => {
    const partialFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/one.txt": { kind: "file", size: 1 },
      "/source/two.txt": { kind: "file", size: 2 },
      "/target": { kind: "directory" },
    });
    partialFileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
      if (sourcePath.endsWith("two.txt")) {
        throw new Error("Disk full");
      }
      partialFileSystem.addFile(destinationPath, { size: 1 });
    };
    const partialOperation = await createResolvedOperation({
      fileSystem: partialFileSystem,
      sourcePaths: ["/source/one.txt", "/source/two.txt"],
      destinationDirectoryPath: "/target",
    });
    const partialEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report: partialOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: partialFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: partialOperation.resolvedNodes,
      emit: (event) => partialEvents.push(event),
      requestResolution: async () => null,
    });

    expect(partialEvents.at(-1)).toMatchObject({
      status: "partial",
      result: {
        error: "Disk full",
      },
    });

    const failedFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/one.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
    });
    failedFileSystem.copyFileImpl = async () => {
      throw new Error("Permission denied");
    };
    const failedOperation = await createResolvedOperation({
      fileSystem: failedFileSystem,
      sourcePaths: ["/source/one.txt"],
      destinationDirectoryPath: "/target",
    });
    const failedEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-2",
      report: failedOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: failedFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: failedOperation.resolvedNodes,
      emit: (event) => failedEvents.push(event),
      requestResolution: async () => null,
    });

    expect(failedEvents.at(-1)).toMatchObject({
      status: "failed",
      result: {
        error: "Permission denied",
      },
    });
  });

  it("fails when a runtime conflict is not resolved and can skip a changed source after prompting", async () => {
    const unresolvedFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const unresolvedOperation = await createResolvedOperation({
      fileSystem: unresolvedFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    unresolvedFileSystem.addFile("/target/file.txt", { size: 2 });
    const unresolvedEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report: unresolvedOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: unresolvedFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: unresolvedOperation.resolvedNodes,
      emit: (event) => unresolvedEvents.push(event),
      requestResolution: async () => null,
    });

    expect(unresolvedEvents.at(-1)).toMatchObject({
      status: "failed",
      result: {
        error: "Runtime conflict was not resolved.",
      },
    });

    const changedSourceFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const changedSourceOperation = await createResolvedOperation({
      fileSystem: changedSourceFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    changedSourceFileSystem.mutateNode("/source/file.txt", (node) => ({
      ...node,
      size: node.size + 1,
    }));
    const changedSourceEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-2",
      report: changedSourceOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: changedSourceFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: changedSourceOperation.resolvedNodes,
      emit: (event) => changedSourceEvents.push(event),
      requestResolution: async (conflict) => {
        expect(conflict.reason).toBe("source_changed");
        return "skip";
      },
    });

    expect(changedSourceEvents.at(-1)).toMatchObject({
      status: "partial",
      result: {
        items: [
          expect.objectContaining({
            status: "skipped",
            skipReason: "runtime_conflict_resolution",
          }),
        ],
      },
    });
  });

  it("handles destination changes for overwrite conflicts without re-prompting and preserves non-empty cut folders", async () => {
    const changedDestinationFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
      "/target/file.txt": { kind: "file", size: 1 },
    });
    const changedDestinationOperation = await createResolvedOperation({
      fileSystem: changedDestinationFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
    });
    await changedDestinationFileSystem.rm("/target/file.txt", { force: false });
    const changedDestinationEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report: changedDestinationOperation.report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: changedDestinationFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: changedDestinationOperation.resolvedNodes,
      emit: (event) => changedDestinationEvents.push(event),
      requestResolution: async () => {
        throw new Error("Overwrite should not re-prompt for destination drift.");
      },
    });

    expect(changedDestinationFileSystem.exists("/target/file.txt")).toBe(true);
    expect(changedDestinationEvents.some((event) => event.status === "awaiting_resolution")).toBe(
      false,
    );

    const cutFolderFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
      "/target/Folder": { kind: "directory" },
      "/target/Folder/file.txt": { kind: "file", size: 1 },
    });
    const cutFolderOperation = await createResolvedOperation({
      fileSystem: cutFolderFileSystem,
      mode: "cut",
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-2",
      report: cutFolderOperation.report,
      mode: "cut",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: cutFolderFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: cutFolderOperation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(cutFolderFileSystem.exists("/source/Folder")).toBe(true);
    expect(cutFolderFileSystem.exists("/source/Folder/file.txt")).toBe(true);
  });

  it("handles source deletion, destination mutation, runtime directory merges, partial cancellation, and chmod edge cases", async () => {
    const deletedSourceFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const deletedSourceOperation = await createResolvedOperation({
      fileSystem: deletedSourceFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    await deletedSourceFileSystem.rm("/source/file.txt", { force: false });
    const deletedSourceEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report: deletedSourceOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: deletedSourceFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: deletedSourceOperation.resolvedNodes,
      emit: (event) => deletedSourceEvents.push(event),
      requestResolution: async (conflict) => {
        expect(conflict.reason).toBe("source_deleted");
        return "skip";
      },
    });
    expect(deletedSourceEvents.at(-1)?.status).toBe("partial");

    const changedDestinationFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
      "/target/file.txt": { kind: "file", size: 1 },
    });
    changedDestinationFileSystem.enableTrash();
    const changedDestinationOperation = await createResolvedOperation({
      fileSystem: changedDestinationFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
    });
    changedDestinationFileSystem.mutateNode("/target/file.txt", (node) => ({
      ...node,
      size: node.size + 10,
    }));
    const destinationChangedEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-2",
      report: changedDestinationOperation.report,
      mode: "copy",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: changedDestinationFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: changedDestinationOperation.resolvedNodes,
      emit: (event) => destinationChangedEvents.push(event),
      requestResolution: async (conflict) => {
        expect(conflict.reason).toBe("destination_changed");
        return "overwrite";
      },
    });
    expect(changedDestinationFileSystem.readNode("/target/file.txt")?.size).toBe(5);

    const mergeAtRuntimeFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const mergeAtRuntimeOperation = await createResolvedOperation({
      fileSystem: mergeAtRuntimeFileSystem,
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
    });
    mergeAtRuntimeFileSystem.addDirectory("/target/Folder");
    const mergeAtRuntimeEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-3",
      report: mergeAtRuntimeOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: mergeAtRuntimeFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: mergeAtRuntimeOperation.resolvedNodes,
      emit: (event) => mergeAtRuntimeEvents.push(event),
      requestResolution: async (conflict) => {
        expect(conflict.conflictClass).toBe("directory_conflict");
        return "merge";
      },
    });
    expect(mergeAtRuntimeFileSystem.exists("/target/Folder/file.txt")).toBe(true);

    const partialCancelFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/one.txt": { kind: "file", size: 1 },
      "/source/two.txt": { kind: "file", size: 2 },
      "/target": { kind: "directory" },
    });
    partialCancelFileSystem.copyFileImpl = async (sourcePath, destinationPath, signal) => {
      if (sourcePath.endsWith("two.txt")) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        signal?.throwIfAborted();
      }
      partialCancelFileSystem.addFile(destinationPath, {
        size: sourcePath.endsWith("two.txt") ? 2 : 1,
      });
    };
    const partialCancelOperation = await createResolvedOperation({
      fileSystem: partialCancelFileSystem,
      sourcePaths: ["/source/one.txt", "/source/two.txt"],
      destinationDirectoryPath: "/target",
    });
    const partialController = new AbortController();
    const partialCancelEvents: CopyPasteProgressEvent[] = [];
    setTimeout(() => partialController.abort(), 5);

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-4",
      report: partialCancelOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: partialCancelFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: partialController.signal,
      resolvedNodes: partialCancelOperation.resolvedNodes,
      emit: (event) => partialCancelEvents.push(event),
      requestResolution: async () => null,
    });
    expect(partialCancelEvents.at(-1)?.status).toBe("partial");

    const chmodIgnoredFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    chmodIgnoredFileSystem.chmodImpl = async () => {
      throw Object.assign(new Error("unsupported"), { code: "EOPNOTSUPP" });
    };
    const chmodIgnoredOperation = await createResolvedOperation({
      fileSystem: chmodIgnoredFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-5",
      report: chmodIgnoredOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: chmodIgnoredFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: chmodIgnoredOperation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });
    expect(chmodIgnoredFileSystem.exists("/target/file.txt")).toBe(true);

    const chmodFailureFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    chmodFailureFileSystem.chmodImpl = async () => {
      throw Object.assign(new Error("chmod denied"), { code: "EPERM" });
    };
    const chmodFailureOperation = await createResolvedOperation({
      fileSystem: chmodFailureFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });
    const chmodFailureEvents: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-6",
      report: chmodFailureOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: chmodFailureFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: chmodFailureOperation.resolvedNodes,
      emit: (event) => chmodFailureEvents.push(event),
      requestResolution: async () => null,
    });
    // The file was copied; a volume that refuses its mode doesn't make the copy a failure.
    expect(chmodFailureEvents.at(-1)).toMatchObject({
      status: "completed",
      result: { error: null },
    });
    expect(chmodFailureFileSystem.exists("/target/file.txt")).toBe(true);
  });

  it("removes source directories after successful cut copies and supports filesystems without chmod", async () => {
    const cutDirectoryFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const cutDirectoryOperation = await createResolvedOperation({
      fileSystem: cutDirectoryFileSystem,
      mode: "cut",
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report: cutDirectoryOperation.report,
      mode: "cut",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: cutDirectoryFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: cutDirectoryOperation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(cutDirectoryFileSystem.exists("/source/Folder")).toBe(false);
    expect(cutDirectoryFileSystem.exists("/target/Folder/file.txt")).toBe(true);

    const baseFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const noChmodFileSystem = {
      lstat: baseFileSystem.lstat.bind(baseFileSystem),
      stat: baseFileSystem.stat.bind(baseFileSystem),
      realpath: baseFileSystem.realpath.bind(baseFileSystem),
      readdir: baseFileSystem.readdir.bind(baseFileSystem),
      readlink: baseFileSystem.readlink.bind(baseFileSystem),
      mkdir: baseFileSystem.mkdir.bind(baseFileSystem),
      rm: baseFileSystem.rm.bind(baseFileSystem),
      rmdir: baseFileSystem.rmdir.bind(baseFileSystem),
      renameExclusive: baseFileSystem.renameExclusive.bind(baseFileSystem),
      copyFile: baseFileSystem.copyFile.bind(baseFileSystem),
      getFlags: baseFileSystem.getFlags.bind(baseFileSystem),
      setFlags: baseFileSystem.setFlags.bind(baseFileSystem),
    };
    const noChmodOperation = await createResolvedOperation({
      fileSystem: baseFileSystem,
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-2",
      report: noChmodOperation.report,
      mode: "copy",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem: noChmodFileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: noChmodOperation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(baseFileSystem.exists("/target/file.txt")).toBe(true);
  });

  it("moves directories with hidden files and hidden folders during cut", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/.env": { kind: "file", size: 7 },
      "/source/Folder/.config": { kind: "directory" },
      "/source/Folder/.config/settings.json": { kind: "file", size: 11 },
      "/source/Folder/visible.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    const operation = await createResolvedOperation({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
    });

    await executeCopyPasteFromAnalysis({
      operationId: "cut-op-hidden-1",
      report: operation.report,
      mode: "cut",
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: operation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.exists("/target/Folder/.env")).toBe(true);
    expect(fileSystem.exists("/target/Folder/.config")).toBe(true);
    expect(fileSystem.exists("/target/Folder/.config/settings.json")).toBe(true);
    expect(fileSystem.exists("/target/Folder/visible.txt")).toBe(true);
    expect(fileSystem.exists("/source/Folder")).toBe(false);
  });

  it("removes emptied cut source folders when child deletions only change parent mtime", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.rmImpl = async (path, options) => {
      const delegate = fileSystem.rmImpl;
      fileSystem.rmImpl = null;
      try {
        await fileSystem.rm(path, options);
      } finally {
        fileSystem.rmImpl = delegate;
      }
      if (path === "/source/Folder/file.txt") {
        fileSystem.mutateNode("/source/Folder", (node) => node);
      }
    };
    const operation = await createResolvedOperation({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-3",
      report: operation.report,
      mode: "cut",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: operation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.exists("/source/Folder")).toBe(false);
    expect(fileSystem.exists("/target/Folder/file.txt")).toBe(true);
  });

  it("preserves cut source directories when the source folder changes before cleanup", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory", dev: 2 },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
      fileSystem.addFile(destinationPath, { size: 5 });
      if (sourcePath.endsWith("file.txt")) {
        fileSystem.mutateNode("/source/Folder", (node) => ({
          ...node,
          mode: 0o700,
        }));
      }
    };
    const operation = await createResolvedOperation({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
    });

    await executeCopyPasteFromAnalysis({
      operationId: "copy-op-1",
      report: operation.report,
      mode: "cut",
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
      now: () => new Date("2026-03-11T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes: operation.resolvedNodes,
      emit: () => undefined,
      requestResolution: async () => null,
    });

    expect(fileSystem.exists("/source/Folder")).toBe(true);
    expect(fileSystem.exists("/target/Folder/file.txt")).toBe(true);
  });

  // The items are on another disk (dev 2): a move copies each, then removes its original.
  describe("per-file cut flow", () => {
    it("deletes source file immediately after successful copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 3 },
        "/source/b.txt": { kind: "file", size: 4 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt", "/source/b.txt"],
        destinationDirectoryPath: "/target",
      });
      const sourceExistedDuringSecondCopy: boolean[] = [];
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        if (sourcePath === "/source/b.txt") {
          sourceExistedDuringSecondCopy.push(fileSystem.exists("/source/a.txt"));
        }
        fileSystem.addFile(destinationPath, {
          size: expectNode(fileSystem, sourcePath).size,
        });
      };

      await executeCopyPasteFromAnalysis({
        operationId: "cut-inline-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(sourceExistedDuringSecondCopy).toEqual([false]);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.exists("/source/b.txt")).toBe(false);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
      expect(fileSystem.exists("/target/b.txt")).toBe(true);
    });

    it("deletes source symlink immediately after successful copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/link": { kind: "symlink", target: "actual.txt" },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/link"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-symlink-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/link")).toBe(false);
      expect(fileSystem.readNode("/target/link")).toMatchObject({
        kind: "symlink",
        target: "actual.txt",
      });
    });

    it("stopped part way through a folder, leaves every original and nothing copied", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/source/dir/b.txt": { kind: "file", size: 2 },
        "/source/dir/c.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      const controller = new AbortController();
      let copyCount = 0;
      fileSystem.copyFileImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyCount++;
        fileSystem.addFile(destinationPath, {
          size: expectNode(fileSystem, sourcePath).size,
        });
        if (copyCount === 2) {
          controller.abort();
        }
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-cancel-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: controller.signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // The folder was built under a hidden name, which went with the stop.
      expect(await fileSystem.readdir("/target")).toEqual([]);
      for (const name of ["a.txt", "b.txt", "c.txt"]) {
        expect(fileSystem.exists(`/source/dir/${name}`)).toBe(true);
      }
    });

    it("preserves source file when source mutated after copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        fileSystem.addFile(destinationPath, { size: 5 });
        fileSystem.mutateNode(sourcePath, (node) => ({
          ...node,
          size: 99,
        }));
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-mutated-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(expectNode(fileSystem, "/source/a.txt").size).toBe(99);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("preserves source file when source deleted externally after copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        fileSystem.addFile(destinationPath, { size: 5 });
        fileSystem.nodes.delete(sourcePath);
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-external-delete-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("removes empty source directory after all children deleted", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/source/dir/b.txt": { kind: "file", size: 2 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-rmdir-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/dir")).toBe(false);
      expect(fileSystem.exists("/source")).toBe(true);
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
      expect(fileSystem.exists("/target/dir/b.txt")).toBe(true);
    });

    it("preserves non-empty source directory when some children skipped", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/source/dir/b.txt": { kind: "file", size: 2 },
        "/target": { kind: "directory" },
        "/target/dir": { kind: "directory" },
        "/target/dir/b.txt": { kind: "file", size: 3 },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-partial-skip-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/dir")).toBe(true);
      expect(fileSystem.exists("/source/dir/b.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
    });

    it("preserves source directory when directory mode changed externally", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory", mode: 0o755 },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        fileSystem.addFile(destinationPath, {
          size: expectNode(fileSystem, sourcePath).size,
        });
        fileSystem.mutateNode("/source/dir", (node) => ({
          ...node,
          mode: 0o700,
        }));
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-dir-changed-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/dir")).toBe(true);
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
    });

    it("empty source directory rm failure reports item as failed", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
      });
      fileSystem.rmdirImpl = async (path) => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM", path });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "cut-rmdir-fail-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      // Operation reports partial — directory item failed (source dir couldn't be removed)
      expect(events.at(-1)?.status).toBe("partial");
      const result = events.at(-1)?.result;
      expect(result?.items[0]?.status).toBe("failed");
      expect(result?.items[0]?.error).toContain("the original folder couldn't be removed");
      // Children were moved successfully
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      // Empty source directory remains (rm failed)
      expect(fileSystem.exists("/source/dir")).toBe(true);
    });

    it("inline deletion rm failure reports item as failed but continues operation", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 1 },
        "/source/b.txt": { kind: "file", size: 2 },
        "/target": { kind: "directory" },
      });
      const rmImplFn: typeof fileSystem.rmImpl = async (path, options) => {
        if (path === "/source/a.txt") {
          throw Object.assign(new Error("EPERM"), { code: "EPERM", path });
        }
        fileSystem.rmImpl = null;
        try {
          await fileSystem.rm(path, options);
        } finally {
          fileSystem.rmImpl = rmImplFn;
        }
      };
      fileSystem.rmImpl = rmImplFn;
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt", "/source/b.txt"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "cut-rm-fail-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      // Operation reports partial — a.txt failed (source deletion), b.txt completed
      expect(events.at(-1)?.status).toBe("partial");
      const result = events.at(-1)?.result;
      expect(result?.items[0]?.status).toBe("failed");
      expect(result?.items[0]?.error).toContain("the original couldn't be removed");
      expect(result?.items[1]?.status).toBe("completed");
      // Both files are at destination (copies succeeded)
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
      expect(fileSystem.exists("/target/b.txt")).toBe(true);
      // a.txt source remains (delete failed), b.txt source removed
      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(fileSystem.exists("/source/b.txt")).toBe(false);
    });

    it("handles nested directory cut with mixed actions", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory" },
        "/source/dir/new.txt": { kind: "file", size: 1 },
        "/source/dir/conflict.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/dir": { kind: "directory" },
        "/target/dir/conflict.txt": { kind: "file", size: 3 },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-mixed-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // new.txt moved (source deleted)
      expect(fileSystem.exists("/source/dir/new.txt")).toBe(false);
      expect(fileSystem.exists("/target/dir/new.txt")).toBe(true);
      // conflict.txt skipped (source preserved)
      expect(fileSystem.exists("/source/dir/conflict.txt")).toBe(true);
      expect(expectNode(fileSystem, "/target/dir/conflict.txt").size).toBe(3);
      // Source directory preserved (conflict.txt still there)
      expect(fileSystem.exists("/source/dir")).toBe(true);
    });

    it("source rm called only once per file — no redundant cleanup pass", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const rmCalls: string[] = [];
      const rmImplFn: typeof fileSystem.rmImpl = async (path, options) => {
        rmCalls.push(path);
        fileSystem.rmImpl = null;
        try {
          await fileSystem.rm(path, options);
        } finally {
          fileSystem.rmImpl = rmImplFn;
        }
      };
      fileSystem.rmImpl = rmImplFn;
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-no-double-rm-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(rmCalls.filter((p) => p === "/source/a.txt")).toHaveLength(1);
    });

    it("cut with runtime conflict resolved as skip preserves source", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      fileSystem.addFile("/target/a.txt", { size: 2 });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-runtime-skip-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => "skip",
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(2);
    });

    it("cut with runtime conflict resolved as overwrite deletes source inline", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      fileSystem.addFile("/target/a.txt", { size: 2 });

      await executeCopyPasteFromAnalysis({
        operationId: "cut-runtime-overwrite-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => "overwrite",
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("nested child file deletion failure propagates to parent directory status", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/source/dir/b.txt": { kind: "file", size: 2 },
        "/target": { kind: "directory" },
      });
      const rmImplFn: typeof fileSystem.rmImpl = async (path, options) => {
        if (path === "/source/dir/a.txt") {
          throw Object.assign(new Error("EPERM"), { code: "EPERM", path });
        }
        fileSystem.rmImpl = null;
        try {
          await fileSystem.rm(path, options);
        } finally {
          fileSystem.rmImpl = rmImplFn;
        }
      };
      fileSystem.rmImpl = rmImplFn;
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "nested-child-fail-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      // Parent directory reports partial because nested child failed
      expect(events.at(-1)?.status).toBe("partial");
      const result = events.at(-1)?.result;
      expect(result?.items[0]?.status).toBe("failed");
      // Filesystem state: a.txt source preserved (rm failed), b.txt moved
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/b.txt")).toBe(false);
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
      expect(fileSystem.exists("/target/dir/b.txt")).toBe(true);
    });

    it("mutated source file reports as failed, not completed", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        fileSystem.addFile(destinationPath, { size: 5 });
        fileSystem.mutateNode(sourcePath, (node) => ({
          ...node,
          size: 99,
        }));
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "cut-mutated-status-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      // Item reports failed because source was preserved (modified after copy)
      // Nothing else was pasted, so the operation as a whole failed.
      expect(events.at(-1)?.status).toBe("failed");
      const result = events.at(-1)?.result;
      expect(result?.items[0]?.status).toBe("failed");
      expect(result?.items[0]?.error).toContain("so the original was kept");
      // Filesystem correctness: both exist
      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });
  });

  describe("same-filesystem rename optimization", () => {
    it("uses rename for same-dev cut file", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-file-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(false);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("uses rename for same-dev cut symlink", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/link": { kind: "symlink", target: "actual.txt" },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/link"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-symlink-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/link")).toBe(false);
      expect(fileSystem.readNode("/target/link")).toMatchObject({
        kind: "symlink",
        target: "actual.txt",
      });
    });

    it("uses rename for same-dev cut directory (moves entire subtree atomically)", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/source/dir/sub": { kind: "directory" },
        "/source/dir/sub/b.txt": { kind: "file", size: 7 },
        "/target": { kind: "directory" },
      });
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-dir-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(false);
      expect(fileSystem.exists("/source/dir")).toBe(false);
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      expect(fileSystem.exists("/source/dir/sub/b.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/dir").kind).toBe("directory");
      expect(expectNode(fileSystem, "/target/dir/a.txt").size).toBe(3);
      expect(expectNode(fileSystem, "/target/dir/sub/b.txt").size).toBe(7);
    });

    it("falls back to copy+delete for cross-dev cut", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 1 },
        "/source/a.txt": { kind: "file", size: 5, dev: 1 },
        "/target": { kind: "directory", dev: 2 },
      });
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileCalled = true;
        fileSystem.addFile(destinationPath, { size: expectNode(fileSystem, sourcePath).size });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-cross-dev-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("treats externally removed source directories as already cleaned up in cut mode", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.rmImpl = async (path) => {
        if (path === "/source/dir/a.txt") {
          fileSystem.nodes.delete("/source/dir/a.txt");
          fileSystem.nodes.delete("/source/dir");
          return;
        }
        if (!fileSystem.nodes.delete(path)) {
          throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT", path });
        }
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "cut-source-dir-already-gone-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      expect(expectLastEvent(events).status).toBe("completed");
      expect(fileSystem.exists("/source/dir")).toBe(false);
      expect(expectNode(fileSystem, "/target/dir/a.txt").size).toBe(5);
    });

    it("falls back to copy+delete on EXDEV error", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      // Another disk: renames out of /source fail; a file put in place at /target doesn't.
      fileSystem.renameImpl = async (from, to) => {
        if (from.startsWith("/source/")) {
          throw Object.assign(new Error("EXDEV"), { code: "EXDEV", path: "/source/a.txt" });
        }
        await fileSystem.renameDirectly(from, to);
      };
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileCalled = true;
        fileSystem.addFile(destinationPath, { size: expectNode(fileSystem, sourcePath).size });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-exdev-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("reports non-EXDEV rename errors as operation failures", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.renameImpl = async () => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM", path: "/source/a.txt" });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "rename-eperm-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      const finalEvent = expectLastEvent(events);
      expect(finalEvent.status).toBe("failed");
      expect(finalEvent.result?.error).toBe("You don't have permission to access this item.");
      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(fileSystem.exists("/target/a.txt")).toBe(false);
    });

    it("does NOT use rename for copy mode (only cut)", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileCalled = true;
        fileSystem.addFile(destinationPath, { size: expectNode(fileSystem, sourcePath).size });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "copy",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-copy-mode-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("merges directories instead of renaming when action is merge", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/source/dir/b.txt": { kind: "file", size: 4 },
        "/target": { kind: "directory" },
        "/target/dir": { kind: "directory" },
        "/target/dir/existing.txt": { kind: "file", size: 9 },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-merge-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // existing.txt preserved (merge, not replace)
      expect(expectNode(fileSystem, "/target/dir/existing.txt").size).toBe(9);
      // Children moved individually via rename
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      expect(fileSystem.exists("/source/dir/b.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/dir/a.txt").size).toBe(3);
      expect(expectNode(fileSystem, "/target/dir/b.txt").size).toBe(4);
    });

    it("rename with overwrite moves the item in, and the replaced one to the Trash", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 10 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      fileSystem.enableTrash();
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-overwrite-1",
        report,
        mode: "cut",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(10);
      expect(fileSystem.trashed).toEqual(["/target/a.txt"]);
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
    });
    it("rename with keep_both uses alternate destination name", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 8 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-keepboth-1",
        report,
        mode: "cut",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      // Original destination unchanged
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(2);
      // Renamed to alternate path
      expect(expectNode(fileSystem, "/target/a copy.txt").size).toBe(8);
    });

    it("rename preserves inode (atomic move, not copy)", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mode: 0o755 },
        "/target": { kind: "directory" },
      });
      const originalIno = expectNode(fileSystem, "/source/a.txt").ino;
      const originalMtimeMs = expectNode(fileSystem, "/source/a.txt").mtimeMs;
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-preserve-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      const destNode = expectNode(fileSystem, "/target/a.txt");
      expect(destNode.ino).toBe(originalIno);
      expect(destNode.mode).toBe(0o755);
      expect(destNode.mtimeMs).toBe(originalMtimeMs);
    });

    it("mixed-dev batch: some items renamed, others copy+deleted", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source1": { kind: "directory", dev: 1 },
        "/source1/a.txt": { kind: "file", size: 3, dev: 1 },
        "/source2": { kind: "directory", dev: 2 },
        "/source2/b.txt": { kind: "file", size: 7, dev: 2 },
        "/target": { kind: "directory", dev: 1 },
      });
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileCalled = true;
        fileSystem.addFile(destinationPath, { size: expectNode(fileSystem, sourcePath).size });
      };
      const originalInoA = expectNode(fileSystem, "/source1/a.txt").ino;
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source1/a.txt", "/source2/b.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-mixed-dev-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // a.txt renamed (same dev) — inode preserved
      expect(expectNode(fileSystem, "/target/a.txt").ino).toBe(originalInoA);
      expect(fileSystem.exists("/source1/a.txt")).toBe(false);
      // b.txt copied+deleted (cross dev)
      expect(copyFileCalled).toBe(true);
      expect(fileSystem.exists("/source2/b.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/b.txt").size).toBe(7);
    });

    it("EXDEV fallback still performs inline source deletion", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      // Another disk: renames out of /source fail; a file put in place at /target doesn't.
      fileSystem.renameImpl = async (from, to) => {
        if (from.startsWith("/source/")) {
          throw Object.assign(new Error("EXDEV"), { code: "EXDEV", path: "/source/a.txt" });
        }
        await fileSystem.renameDirectly(from, to);
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-exdev-inline-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // Source deleted via inline deletion (Phase 1), not rename
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("rename of directory with overwrite action moves the replaced directory to the Trash", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
        "/target/dir": { kind: "directory" },
        "/target/dir/old.txt": { kind: "file", size: 1 },
      });
      fileSystem.enableTrash();
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-dir-overwrite-1",
        report,
        mode: "cut",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/dir")).toBe(false);
      expect(expectNode(fileSystem, "/target/dir/a.txt").size).toBe(3);
      // old.txt gone because directory was overwritten (replaced), not merged
      expect(fileSystem.exists("/target/dir/old.txt")).toBe(false);
      expect(fileSystem.trashed).toEqual(["/target/dir"]);
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
    });
    it("rename overwrite without a Trash deletes the existing item only when the person agrees", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 10 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      const rmCalls = recordRmCalls(fileSystem);
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
      });
      const reasons: string[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "rename-overwrite-no-trash-1",
        report,
        mode: "cut",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async (conflict) => {
          reasons.push(conflict.reason);
          return "overwrite";
        },
      });

      expect(reasons).toEqual(["trash_unavailable"]);
      expect(rmCalls).toEqual([{ path: "/target/a.txt", recursive: false }]);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(10);
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
    });
    it("rename overwrite without a Trash puts everything back when the person skips", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
        "/target/dir": { kind: "directory" },
        "/target/dir/old.txt": { kind: "file", size: 1 },
      });
      const rmCalls = recordRmCalls(fileSystem);
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "rename-overwrite-no-trash-skip-1",
        report,
        mode: "cut",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => "skip",
      });

      expect(rmCalls).toEqual([]);
      expect(expectNode(fileSystem, "/source/dir/a.txt").size).toBe(3);
      expect(expectNode(fileSystem, "/target/dir/old.txt").size).toBe(1);
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(false);
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
      expect(expectLastEvent(events).result?.items[0]).toMatchObject({
        status: "skipped",
        skipReason: "runtime_conflict_resolution",
      });
    });
    it("rename overwrite of a directory by a file", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/item": { kind: "file", size: 6 },
        "/target": { kind: "directory" },
        "/target/item": { kind: "directory" },
        "/target/item/old.txt": { kind: "file", size: 1 },
      });
      fileSystem.enableTrash();
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/item"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-overwrite-file-over-dir-1",
        report,
        mode: "cut",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.trashed).toEqual(["/target/item"]);
      expect(fileSystem.exists("/source/item")).toBe(false);
      expect(expectNode(fileSystem, "/target/item")).toMatchObject({ kind: "file", size: 6 });
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
    });
    it("rename overwrite of a file by a directory", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/item": { kind: "directory" },
        "/source/item/a.txt": { kind: "file", size: 4 },
        "/target": { kind: "directory" },
        "/target/item": { kind: "file", size: 9 },
      });
      fileSystem.enableTrash();
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/item"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-overwrite-dir-over-file-1",
        report,
        mode: "cut",
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.trashed).toEqual(["/target/item"]);
      expect(fileSystem.exists("/source/item")).toBe(false);
      expect(expectNode(fileSystem, "/target/item").kind).toBe("directory");
      expect(expectNode(fileSystem, "/target/item/a.txt").size).toBe(4);
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
    });
    it("rename overwrite skips pre-delete when the destination vanished before execution", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 10 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      const rmCalls = recordRmCalls(fileSystem);
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
      });
      // Destination disappears between analysis and execution.
      fileSystem.nodes.delete("/target/a.txt");

      await executeCopyPasteFromAnalysis({
        operationId: "rename-overwrite-vanished-1",
        report,
        mode: "cut",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(rmCalls).toEqual([]);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(10);
    });

    it("cancellation between rename operations", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 3 },
        "/source/b.txt": { kind: "file", size: 4 },
        "/source/c.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const controller = new AbortController();
      let renameCount = 0;
      fileSystem.renameImpl = async (oldPath, newPath) => {
        renameCount++;
        const size = fileSystem.readNode(oldPath)?.size ?? 0;
        fileSystem.nodes.delete(oldPath);
        fileSystem.addFile(newPath, { size });
        if (renameCount === 1) {
          controller.abort();
        }
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt", "/source/b.txt", "/source/c.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-cancel-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: controller.signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // First file moved
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
      // Remaining at source
      expect(fileSystem.exists("/source/b.txt")).toBe(true);
      expect(fileSystem.exists("/source/c.txt")).toBe(true);
    });

    it("rename with runtime conflict resolved as skip preserves source", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      // Create destination after analysis (triggers runtime conflict)
      fileSystem.addFile("/target/a.txt", { size: 99 });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-runtime-skip-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => "skip",
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(99);
    });

    it("rename with runtime conflict resolved as overwrite uses rename", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      // Create destination after analysis (triggers runtime conflict)
      fileSystem.addFile("/target/a.txt", { size: 99 });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-runtime-overwrite-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => "overwrite",
      });

      expect(copyFileCalled).toBe(false);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("classifies a runtime-created destination directory for a file as a type mismatch", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      fileSystem.addDirectory("/target/a.txt");
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "runtime-created-type-mismatch-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async (conflict) => {
          expect(conflict.reason).toBe("destination_created");
          expect(conflict.conflictClass).toBe("type_mismatch");
          return "skip";
        },
      });

      expect(events.some((event) => event.status === "awaiting_resolution")).toBe(true);
      expect(expectLastEvent(events).status).toBe("partial");
    });

    it.each([
      ["destination_deleted", (fs: MockWriteServiceFileSystem) => fs.nodes.delete("/target/a.txt")],
      [
        "destination_changed",
        (fs: MockWriteServiceFileSystem) => fs.mutateNode("/target/a.txt", (node) => node),
      ],
    ] as const)(
      "prompts when an overwrite destination is %s after analysis",
      async (reason, mutate) => {
        const fileSystem = new MockWriteServiceFileSystem({
          "/source": { kind: "directory" },
          "/source/a.txt": { kind: "file", size: 5 },
          "/target": { kind: "directory" },
          "/target/a.txt": { kind: "file", size: 99 },
        });
        const { report, resolvedNodes } = await createResolvedOperation({
          fileSystem,
          sourcePaths: ["/source/a.txt"],
          destinationDirectoryPath: "/target",
          policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
        });
        mutate(fileSystem);

        await executeCopyPasteFromAnalysis({
          operationId: `runtime-${reason}-1`,
          report,
          mode: "copy",
          policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
          fileSystem,
          now: () => new Date("2026-03-11T00:00:00.000Z"),
          signal: new AbortController().signal,
          resolvedNodes,
          emit: () => undefined,
          requestResolution: async (conflict) => {
            expect(conflict.reason).toBe(reason);
            return "skip";
          },
        });

        expect(fileSystem.exists("/source/a.txt")).toBe(true);
      },
    );

    it("counts a folder renamed whole as one item, of a size not known", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 100 },
        "/source/dir/b.txt": { kind: "file", size: 200 },
        "/source/dir/sub": { kind: "directory" },
        "/source/dir/sub/c.txt": { kind: "file", size: 300 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "rename-byte-progress-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      const result = events.at(-1)?.result;
      // What is inside it wasn't read.
      expect(result?.summary.completedItemCount).toBe(1);
      expect(result?.summary.totalBytes).toBeNull();
      expect(fileSystem.exists("/target/dir/sub/c.txt")).toBe(true);
    });
  });

  describe("native copyFile and utimes", () => {
    it("leaves the mode copyFile copied", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mode: 0o755 },
        "/target": { kind: "directory" },
      });
      const chmodCalls: Array<{ path: string; mode: number }> = [];
      fileSystem.chmodImpl = async (path, mode) => {
        chmodCalls.push({ path, mode });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "native-copy-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // The native copy carried the mode, so it isn't set again (that would fail on a
      // locked file).
      expect(chmodCalls).toEqual([]);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    // A large file shows its progress as it is copied, counted once when it is done.
    it("reports the bytes of the file being copied as they are written", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 100 },
        "/source/b.bin": { kind: "file", size: 1000 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileImpl = async (src, dst, _signal, onProgress) => {
        if (src === "/source/b.bin") {
          onProgress?.(400);
        }
        fileSystem.addFile(dst, { size: expectNode(fileSystem, src).size });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt", "/source/b.bin"],
        destinationDirectoryPath: "/target",
      });
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "native-copy-progress",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      const copying = events.find((event) => event.completedByteCount === 500);
      expect(copying?.currentSourcePath).toBe("/source/b.bin");
      expect(copying?.completedItemCount).toBe(1);
      expect(events.map((event) => event.completedByteCount)).toEqual([0, 100, 500, 1100, 1100]);
    });

    it("copyFile preserves mode and mtime", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mode: 0o755, mtimeMs: 9999 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "native-preserve-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      const dest = expectNode(fileSystem, "/target/a.txt");
      expect(dest.mode).toBe(0o755);
      expect(dest.mtimeMs).toBe(9999);
    });

    it("native copyFile path re-applies mode and mtime even when the copy drops metadata", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mode: 0o755, mtimeMs: 9999 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      // Simulate a native copy that transfers content but not metadata.
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        fileSystem.addFile(destinationPath, { size: expectNode(fileSystem, sourcePath).size });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "native-preserve-2",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      const dest = expectNode(fileSystem, "/target/a.txt");
      expect(dest.mode).toBe(0o755);
      expect(dest.mtimeMs).toBe(9999);
    });

    it("copyFile error propagates and fails the operation", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileImpl = async () => {
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      const events: CopyPasteProgressEvent[] = [];
      await executeCopyPasteFromAnalysis({
        operationId: "native-error-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      const finalEvent = expectLastEvent(events);
      expect(finalEvent.result?.status).toBe("failed");
      expect(finalEvent.result?.error).toBe("You don't have permission to access this item.");
    });

    it("utimes called for directories after mkdir + chmod", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory", mtimeMs: 5555 },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      const utimesCalls: Array<{ path: string; mtimeMs: number }> = [];
      fileSystem.utimesImpl = async (path, _atimeMs, mtimeMs) => {
        utimesCalls.push({ path, mtimeMs });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "utimes-dir-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(utimesCalls.some((c) => c.path === "/target/dir" && c.mtimeMs === 5555)).toBe(true);
    });

    it("utimes not called when absent (no-op)", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory", mtimeMs: 5555 },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      // utimes NOT enabled
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "utimes-absent-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // No error — utimes silently skipped
      expect(expectNode(fileSystem, "/target/dir").kind).toBe("directory");
    });

    it("utimes ENOTSUP silently ignored", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory", mtimeMs: 5555 },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      fileSystem.utimesImpl = async () => {
        throw Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "utimes-enotsup-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(expectNode(fileSystem, "/target/dir").kind).toBe("directory");
    });

    it("utimes EOPNOTSUPP silently ignored", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/link": { kind: "symlink", target: "actual.txt", mtimeMs: 7777 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      fileSystem.utimesImpl = async () => {
        throw Object.assign(new Error("EOPNOTSUPP"), { code: "EOPNOTSUPP" });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/link"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "utimes-eopnotsupp-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(expectNode(fileSystem, "/target/link").kind).toBe("symlink");
    });

    it("doesn't fail a folder whose date can't be set", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory", mtimeMs: 5555 },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      fileSystem.utimesImpl = async () => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      const events: CopyPasteProgressEvent[] = [];
      await executeCopyPasteFromAnalysis({
        operationId: "utimes-eperm-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      // The folder and its items were written; only the folder's date couldn't be set,
      // which, as for a file, isn't a failure (some network volumes refuse it).
      const finalEvent = expectLastEvent(events);
      expect(finalEvent.result?.status).toBe("completed");
      expect(finalEvent.result?.error).toBeNull();
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
    });

    it("copyFile + cut: inline source deletion still works", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "native-cut-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(5);
    });

    it("copyFile + rename: rename takes priority for same-dev cut", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };
      const originalIno = expectNode(fileSystem, "/source/a.txt").ino;
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-vs-native-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(false);
      expect(expectNode(fileSystem, "/target/a.txt").ino).toBe(originalIno);
    });

    it("copyFile with overwrite: destination moved to the Trash, then replaced", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 10 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      fileSystem.enableTrash();
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "native-overwrite-1",
        report,
        mode: "copy",
        policy: { file: "overwrite", directory: "merge", mismatch: "overwrite" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(10);
      expect(fileSystem.trashed).toEqual(["/target/a.txt"]);
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
    });

    it("copyFile with keep_both: correct alternate destination path used", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 8 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      const copyFilePaths: string[] = [];
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        copyFilePaths.push(destinationPath);
        fileSystem.addFile(destinationPath, { size: expectNode(fileSystem, sourcePath).size });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "native-keepboth-1",
        report,
        mode: "copy",
        policy: { file: "keep_both", directory: "merge", mismatch: "keep_both" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // Written under a hidden name next to it, then given its name.
      expect(copyFilePaths).toEqual([
        expect.stringMatching(/^\/target\/\.a copy\.txt\.filetrail-[0-9a-f]{8}$/u),
      ]);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(2);
      expect(expectNode(fileSystem, "/target/a copy.txt").size).toBe(8);
    });

    it("utimes uses source mtimeMs for both atime and mtime parameters", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory", mtimeMs: 1234567890 },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      const utimesArgs: Array<{ path: string; atimeMs: number; mtimeMs: number }> = [];
      fileSystem.utimesImpl = async (path, atimeMs, mtimeMs) => {
        utimesArgs.push({ path, atimeMs, mtimeMs });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "utimes-args-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      const dirCall = expectDefined(utimesArgs.find((c) => c.path === "/target/dir"));
      expect(dirCall.atimeMs).toBe(1234567890);
      expect(dirCall.mtimeMs).toBe(1234567890);
    });
  });

  describe("cross-phase integration", () => {
    it("rename + inline cut: rename moves file, no copy or separate delete", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/a.txt": { kind: "file", size: 10, dev: 1 },
        "/target": { kind: "directory", dev: 1 },
      });

      let copyFileCalled = false;
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };

      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cross-rename-cut",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(false);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("EXDEV fallback + inline cut: copy then inline delete", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/a.txt": { kind: "file", size: 10, dev: 1 },
        "/target": { kind: "directory", dev: 1 },
      });

      // Force EXDEV on rename despite same dev
      // Another disk: renames out of /source fail; a file put in place at /target doesn't.
      fileSystem.renameImpl = async (from, to) => {
        if (from.startsWith("/source/")) {
          throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
        }
        await fileSystem.renameDirectly(from, to);
      };

      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cross-exdev-cut",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // Fell back to copy+delete
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("copyFile + inline cut: native copy then inline delete", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/a.txt": { kind: "file", size: 10, dev: 1 },
        "/target": { kind: "directory", dev: 2 },
      });

      let copyFileCalled = false;
      fileSystem.copyFileImpl = async (src, dst) => {
        copyFileCalled = true;
        // Manually do the file copy since we can't delegate to the mock's own copyFile
        const srcNode = expectNode(fileSystem, src);
        fileSystem.addFile(dst, { size: srcNode.size, mode: srcNode.mode });
      };

      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cross-copyfile-cut",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyFileCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("rename + copyFile: rename prioritized over copyFile for same-dev cut", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/a.txt": { kind: "file", size: 10, dev: 1 },
        "/target": { kind: "directory", dev: 1 },
      });

      let renameCalled = false;
      let copyFileCalled = false;
      const renameSize = expectNode(fileSystem, "/source/a.txt").size;
      fileSystem.renameImpl = async (oldPath, newPath) => {
        renameCalled = true;
        const size = fileSystem.readNode(oldPath)?.size ?? 0;
        fileSystem.nodes.delete(oldPath);
        fileSystem.addFile(newPath, { size });
      };
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };

      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cross-rename-vs-copyfile",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(renameCalled).toBe(true);
      expect(copyFileCalled).toBe(false);
    });

    it("merge + rename children + copyFile fallback: mixed paths in single operation", async () => {
      // src/dir has children, dst/dir exists — merge mode
      // Some children on same dev (rename), some on different dev (copyFile)
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/dir": { kind: "directory", dev: 1 },
        "/source/dir/same-dev.txt": { kind: "file", size: 5, dev: 1 },
        "/source/dir/cross-dev.txt": { kind: "file", size: 8, dev: 2 },
        "/target": { kind: "directory", dev: 1 },
        "/target/dir": { kind: "directory", dev: 1 },
        "/target/dir/existing.txt": { kind: "file", size: 3, dev: 1 },
      });

      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/dir"],
        destinationDirectoryPath: "/target",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
      });

      await executeCopyPasteFromAnalysis({
        operationId: "cross-merge-mixed",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // existing.txt still at destination (merge preserves it)
      expect(fileSystem.exists("/target/dir/existing.txt")).toBe(true);
      // same-dev.txt moved via rename
      expect(fileSystem.exists("/target/dir/same-dev.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/same-dev.txt")).toBe(false);
      // cross-dev.txt copied via copyFile then deleted inline
      expect(fileSystem.exists("/target/dir/cross-dev.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/cross-dev.txt")).toBe(false);
    });
  });

  describe("leaving other people's items alone", () => {
    it("doesn't remove an item after a failed copy unless the copy created it", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });
      // "a.txt" is someone else's, saved while the paste was starting (the runtime check
      // doesn't see it yet), and the copy then fails on it.
      fileSystem.addFile("/target/a.txt", { size: 7 });
      let hidden = true;
      fileSystem.lstatImpl = async (path) => {
        fileSystem.lstatImpl = null;
        try {
          if (path === "/target/a.txt" && hidden) {
            hidden = false;
            throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
          }
          return await fileSystem.lstat(path);
        } finally {
          fileSystem.lstatImpl = lstatImpl;
        }
      };
      const lstatImpl = fileSystem.lstatImpl;
      fileSystem.copyFileImpl = async () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      };
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "someone-elses-file",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
      });

      expect(expectLastEvent(events).result?.items[0]?.status).toBe("failed");
      expect(fileSystem.readNode("/target/a.txt")?.size).toBe(7);
    });

    it("asks about a file that takes its name while it is being copied instead of failing", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
        policy: { file: "keep_both", directory: "merge", mismatch: "skip" },
      });
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        fileSystem.copyFileImpl = null;
        // Another app saves a file at the name while the copy is made.
        fileSystem.addFile("/target/a.txt", { size: 9 });
        await fileSystem.copyFile(sourcePath, destinationPath);
      };
      const events: CopyPasteProgressEvent[] = [];

      await executeCopyPasteFromAnalysis({
        operationId: "intruder",
        report,
        mode: "copy",
        policy: { file: "keep_both", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date("2026-03-11T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async (conflict) => {
          expect(conflict.reason).toBe("destination_created");
          return "keep_both";
        },
      });

      expect(expectLastEvent(events).result?.items[0]).toMatchObject({
        status: "completed",
        destinationPath: "/target/a copy.txt",
      });
      expect(fileSystem.readNode("/target/a.txt")?.size).toBe(9);
      expect(fileSystem.readNode("/target/a copy.txt")?.size).toBe(5);
    });
  });

  describe("folder metadata, unreadable folders and the Replace journal", () => {
    async function run(args: {
      fileSystem: MockWriteServiceFileSystem;
      mode: "copy" | "cut";
      sourcePaths: string[];
      policy?: Parameters<typeof createResolvedOperation>[0]["policy"];
      writeJournal?: Parameters<typeof executeCopyPasteFromAnalysis>[0]["writeJournal"];
    }): Promise<CopyPasteOperationResult> {
      const policy = args.policy ?? { file: "skip", directory: "merge", mismatch: "skip" };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem: args.fileSystem,
        mode: args.mode,
        sourcePaths: args.sourcePaths,
        destinationDirectoryPath: "/target",
        policy,
      });
      const events: CopyPasteProgressEvent[] = [];
      await executeCopyPasteFromAnalysis({
        operationId: "op-metadata",
        report,
        mode: args.mode,
        policy,
        fileSystem: args.fileSystem,
        now: () => new Date("2026-10-03T00:00:00.000Z"),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: (event) => events.push(event),
        requestResolution: async () => null,
        ...(args.writeJournal ? { writeJournal: args.writeJournal } : {}),
      });
      return expectDefined(expectLastEvent(events).result);
    }

    // A folder on another volume (dev 2), so a move copies it item by item.
    function otherVolumeFolder() {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 2 },
        "/source/dir": { kind: "directory", dev: 2, mode: 0o40555, mtimeMs: 1234 },
        "/source/dir/a.txt": { kind: "file", size: 1, dev: 2 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      return fileSystem;
    }

    it("puts a folder's own metadata on after its items, and its date back after a move", async () => {
      const fileSystem = otherVolumeFolder();
      const order: string[] = [];
      fileSystem.copyFileImpl = async (_source, destination) => {
        order.push(`file ${destination}`);
        fileSystem.addFile(destination, { size: 1 });
      };
      Object.assign(fileSystem, {
        copyMetadata: async (source: string, destination: string) => {
          order.push(`metadata ${source} -> ${destination}`);
          // As copyfile(3) would: the source folder's date, which the move just changed.
          expectNode(fileSystem, destination).mtimeMs = 9999;
        },
      });

      const result = await run({ fileSystem, mode: "cut", sourcePaths: ["/source/dir"] });

      expect(result.status).toBe("completed");
      // The folder is built under a hidden name, its file written straight in; the folder's
      // own metadata goes on once it has its name.
      expect(order).toEqual([
        expect.stringMatching(/^file \/target\/\.dir\.filetrail-[0-9a-f]+\/a\.txt$/u),
        "metadata /source/dir -> /target/dir",
      ]);
      expect(expectNode(fileSystem, "/target/dir/a.txt").size).toBe(1);
      expect(expectNode(fileSystem, "/target/dir").mtimeMs).toBe(1234);
    });

    it("falls back to the mode and date when a folder's metadata can't be copied", async () => {
      const fileSystem = otherVolumeFolder();
      const chmodCalls: Array<[string, number]> = [];
      fileSystem.chmodImpl = async (path, mode) => {
        chmodCalls.push([path, mode]);
      };
      Object.assign(fileSystem, {
        copyMetadata: async () => {
          throw Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" });
        },
      });

      const result = await run({ fileSystem, mode: "copy", sourcePaths: ["/source/dir"] });

      expect(result.status).toBe("completed");
      expect(chmodCalls.filter(([path]) => path === "/target/dir")).toEqual([
        ["/target/dir", 0o40555],
      ]);
      expect(expectNode(fileSystem, "/target/dir").mtimeMs).toBe(1234);
    });

    it("leaves an unreadable folder in place when moving, and says it wasn't moved", async () => {
      const fileSystem = otherVolumeFolder();
      fileSystem.readdirImpl = async (path) => {
        if (path === "/source/dir") {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        }
        return [];
      };

      const result = await run({ fileSystem, mode: "cut", sourcePaths: ["/source/dir"] });

      expect(result.status).toBe("failed");
      expect(result.items).toEqual([
        expect.objectContaining({
          sourcePath: "/source/dir",
          status: "failed",
          error:
            "This folder couldn't be read, so it wasn't moved. You don't have permission to access this item.",
        }),
      ]);
      expect(fileSystem.readNode("/source/dir/a.txt")).toBeDefined();
      expect(fileSystem.readNode("/target/dir")).toBeNull();
    });

    function recordingJournal() {
      const live = new Map<string, ReplaceJournalEntry>();
      const added: ReplaceJournalEntry[] = [];
      return {
        live,
        added,
        journal: {
          add: async (entry: WriteJournalEntry) => {
            if (isReplaceJournalEntry(entry)) {
              live.set(entry.id, entry);
              added.push(entry);
            }
          },
          remove: async (id: string) => {
            live.delete(id);
          },
        },
      };
    }

    it("clears a Replace from the journal when its staged copy fails and is undone", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 9 },
      });
      fileSystem.enableTrash();
      fileSystem.copyFileImpl = async () => {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      };
      const { live, added, journal } = recordingJournal();

      const result = await run({
        fileSystem,
        mode: "copy",
        sourcePaths: ["/source/a.txt"],
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
        writeJournal: journal,
      });

      expect(result.status).toBe("failed");
      expect(added).toHaveLength(1);
      expect(live.size).toBe(0);
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(9);
      expect(temporaryLeftovers(fileSystem)).toEqual([]);
    });

    it("clears a moved Replace from the journal when the move to the hidden name fails", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 9 },
      });
      fileSystem.enableTrash();
      fileSystem.renameImpl = async () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      };
      const { live, added, journal } = recordingJournal();

      const result = await run({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        policy: { file: "overwrite", directory: "overwrite", mismatch: "overwrite" },
        writeJournal: journal,
      });

      expect(result.status).toBe("failed");
      expect(added.map((entry) => entry.moved)).toEqual([true]);
      expect(live.size).toBe(0);
      expect(fileSystem.readNode("/source/a.txt")).toBeDefined();
      expect(expectNode(fileSystem, "/target/a.txt").size).toBe(9);
    });
  });
});

describe("names the destination can't tell apart", () => {
  it("finds an existing item whatever the letter case, as APFS does", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/README.txt": { kind: "file", size: 2 },
      "/target/readme.txt": { kind: "file", size: 1 },
    });

    const { report } = await createResolvedOperation({
      fileSystem,
      sourcePaths: ["/source/README.txt"],
      destinationDirectoryPath: "/target",
    });

    expect(report.nodes[0]).toMatchObject({
      conflictClass: "file_conflict",
      destinationPath: "/target/README.txt",
    });
  });

  // The review stops such a paste; this is the guard behind it. A folder from a disk that
  // tells "A.txt" from "a.txt" lands on one that doesn't: the second item must never
  // replace the first, which this same paste just wrote.
  it("never lets a later item replace one this paste just wrote under the same name", async () => {
    const fileSystem = new MockWriteServiceFileSystem();
    fileSystem.caseSensitive = true;
    // On another disk, so the folder is copied item by item.
    fileSystem.addDirectory("/source", { dev: 2 });
    fileSystem.addFile("/source/F/A.txt", { size: 5 });
    fileSystem.addFile("/source/F/a.txt", { size: 6 });
    fileSystem.addDirectory("/target");
    fileSystem.enableTrash();
    const replaceAll = {
      file: "overwrite",
      directory: "overwrite",
      mismatch: "overwrite",
    } as const;
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/F"],
      destinationDirectoryPath: "/target",
      policy: replaceAll,
    });
    // The destination turns out not to tell case apart after all.
    fileSystem.caseSensitive = false;
    const requestResolution = vi.fn(async () => "overwrite" as const);
    const events: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "op-case",
      report: { ...report, destinationCaseSensitive: false },
      mode: "cut",
      policy: replaceAll,
      fileSystem,
      now: () => new Date("2026-10-03T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution,
    });

    const result = expectDefined(expectLastEvent(events).result);
    expect(requestResolution).not.toHaveBeenCalled();
    expect(result.items.find((item) => item.sourcePath === "/source/F/a.txt")).toMatchObject({
      status: "failed",
      error:
        "“a.txt” wasn't pasted because another item of this paste has the same name on this disk, which doesn't tell upper and lower case apart.",
    });
    expect(fileSystem.trashed).toEqual([]);
    // The move is given up whole: both originals stay where they were.
    expect(fileSystem.exists("/target/F")).toBe(false);
    expect(expectNode(fileSystem, "/source/F/A.txt").size).toBe(5);
    expect(expectNode(fileSystem, "/source/F/a.txt").size).toBe(6);
  });

  // Some disks take other names for one item too ("Strasse.txt" for "Straße.txt"): the item
  // there is known by its id as the one this paste just wrote, and isn't replaced.
  it("never lets a later item replace one this paste wrote under a name the disk takes as its", async () => {
    const fileSystem = new MockWriteServiceFileSystem();
    fileSystem.addFile("/one/Straße.txt", { size: 5 });
    fileSystem.addFile("/two/Strasse.txt", { size: 6 });
    fileSystem.addDirectory("/target");
    fileSystem.enableTrash();
    // A volume that takes "ß" for "ss" as well as ignoring case.
    (fileSystem as unknown as { foldName: (path: string) => string }).foldName = (path) =>
      path.normalize("NFD").toLowerCase().replaceAll("ß", "ss");
    const replaceAll = {
      file: "overwrite",
      directory: "overwrite",
      mismatch: "overwrite",
    } as const;
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      mode: "copy",
      sourcePaths: ["/one/Straße.txt", "/two/Strasse.txt"],
      destinationDirectoryPath: "/target",
      policy: replaceAll,
    });
    const requestResolution = vi.fn(async () => "overwrite" as const);
    const events: CopyPasteProgressEvent[] = [];

    await executeCopyPasteFromAnalysis({
      operationId: "op-fold",
      report,
      mode: "copy",
      policy: replaceAll,
      fileSystem,
      now: () => new Date("2026-10-09T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution,
    });

    const result = expectDefined(expectLastEvent(events).result);
    expect(requestResolution).not.toHaveBeenCalled();
    expect(result.items.find((item) => item.sourcePath === "/two/Strasse.txt")).toMatchObject({
      status: "failed",
      error:
        "“Strasse.txt” wasn't pasted because another item of this paste has the same name on this disk, which doesn't tell upper and lower case apart.",
    });
    expect(expectNode(fileSystem, "/target/Straße.txt").size).toBe(5);
    expect(fileSystem.trashed).toEqual([]);
  });
});

// A folder moved on its own disk to a free name is renamed whole, what is in it unread: it
// is never copied or merged, and is left where it was when a rename no longer does it.
describe("a folder renamed whole", () => {
  async function moveFolder(
    fileSystem: MockWriteServiceFileSystem,
    beforeExecute: () => void = () => undefined,
  ) {
    const { report, resolvedNodes } = await createResolvedOperation({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/Project"],
      destinationDirectoryPath: "/target",
    });
    expect(report.nodes[0]?.renameOnly).toBe(true);
    beforeExecute();
    const events: CopyPasteProgressEvent[] = [];
    const requestResolution = vi.fn(async () => "merge" as const);
    await executeCopyPasteFromAnalysis({
      operationId: "rename-only",
      report,
      mode: "cut",
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
      fileSystem,
      now: () => new Date("2026-10-09T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => events.push(event),
      requestResolution,
    });
    return { result: expectDefined(expectLastEvent(events).result), requestResolution };
  }

  function projectFolder() {
    return new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Project": { kind: "directory" },
      "/source/Project/a.txt": { kind: "file", size: 5 },
      "/source/Project/lib/b.txt": { kind: "file", size: 7 },
      "/target": { kind: "directory" },
    });
  }

  const RETRY =
    "“Project” wasn't moved because its destination changed after the move began. Try moving it again.";

  it("is left untouched when the rename finds another disk (EXDEV)", async () => {
    const fileSystem = projectFolder();
    fileSystem.renameImpl = async (from) => {
      throw Object.assign(new Error(`EXDEV: ${from}`), { code: "EXDEV" });
    };

    const { result } = await moveFolder(fileSystem);

    expect(result.items).toEqual([
      expect.objectContaining({ sourcePath: "/source/Project", status: "failed", error: RETRY }),
    ]);
    expect(expectNode(fileSystem, "/source/Project/a.txt").size).toBe(5);
    expect(expectNode(fileSystem, "/source/Project/lib/b.txt").size).toBe(7);
    expect(await fileSystem.readdir("/target")).toEqual([]);
  });

  it("is left untouched, without a question, when its name was taken meanwhile", async () => {
    const fileSystem = projectFolder();

    const { result, requestResolution } = await moveFolder(fileSystem, () =>
      fileSystem.addFile("/target/Project/other.txt", { size: 1 }),
    );

    expect(requestResolution).not.toHaveBeenCalled();
    expect(result.items).toEqual([
      expect.objectContaining({ sourcePath: "/source/Project", status: "failed", error: RETRY }),
    ]);
    expect(await fileSystem.readdir("/target/Project")).toEqual(["other.txt"]);
    expect(expectNode(fileSystem, "/source/Project/lib/b.txt").size).toBe(7);
  });
});
