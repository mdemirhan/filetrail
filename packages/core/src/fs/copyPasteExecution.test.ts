import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { MockWriteServiceFileSystem } from "./testUtils";
import type { CopyPasteProgressEvent } from "./writeServiceTypes";

async function createResolvedOperation(args: {
  fileSystem: MockWriteServiceFileSystem;
  mode?: "copy" | "cut";
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy?: {
    file: "overwrite" | "skip" | "keep_both";
    directory: "merge" | "skip" | "keep_both";
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
    policy:
      args.policy ?? {
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

  it("overwrites a conflicting file with a source directory when mismatch policy requests overwrite", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Photos": { kind: "directory" },
      "/source/Photos/a.jpg": { kind: "file", size: 3 },
      "/target": { kind: "directory" },
      "/target/Photos": { kind: "file", size: 9 },
    });
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

    const changedSourceFileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
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

    expect(changedSourceEvents.at(-1)?.status).toBe("partial");
  });

  it("handles destination changes for pre-existing conflicts and preserves non-empty cut folders", async () => {
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
      requestResolution: async (conflict) => {
        expect(conflict.reason).toBe("destination_deleted");
        return "overwrite";
      },
    });

    expect(changedDestinationFileSystem.exists("/target/file.txt")).toBe(true);
    expect(changedDestinationEvents.some((event) => event.status === "awaiting_resolution")).toBe(
      true,
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
      partialCancelFileSystem.addFile(destinationPath, { size: sourcePath.endsWith("two.txt") ? 2 : 1 });
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
    expect(chmodFailureEvents.at(-1)).toMatchObject({
      status: "failed",
      result: {
        error: "chmod denied",
      },
    });
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
      symlink: baseFileSystem.symlink.bind(baseFileSystem),
      copyFileStream: baseFileSystem.copyFileStream.bind(baseFileSystem),
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

  it("preserves cut source directories when the source folder changes before cleanup", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
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
});
