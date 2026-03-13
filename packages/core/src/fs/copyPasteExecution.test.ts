import { vi } from "vitest";

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

  it("treats a destination that vanishes during overwrite deletion as already removed", async () => {
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
      requestResolution: async () => null,
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
    fileSystem.copyFileStreamImpl = async (_sourcePath, destinationPath, signal) => {
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
    changedSourceFileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
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
    partialFileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
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
    failedFileSystem.copyFileStreamImpl = async () => {
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
    partialCancelFileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
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
      "/source": { kind: "directory" },
      "/source/Folder": { kind: "directory" },
      "/source/Folder/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });
    fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
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

  describe("per-file cut flow", () => {
    it("deletes source file immediately after successful copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
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
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
        if (sourcePath === "/source/b.txt") {
          sourceExistedDuringSecondCopy.push(fileSystem.exists("/source/a.txt"));
        }
        fileSystem.addFile(destinationPath, {
          size: fileSystem.readNode(sourcePath)!.size,
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

    it("mid-cancel leaves clean partition — no duplicates", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/source/dir/b.txt": { kind: "file", size: 2 },
        "/source/dir/c.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      const controller = new AbortController();
      let copyCount = 0;
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyCount++;
        fileSystem.addFile(destinationPath, {
          size: fileSystem.readNode(sourcePath)!.size,
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

      // Copied files at destination only
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/dir/b.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/b.txt")).toBe(false);
      // Uncopied file at source only
      expect(fileSystem.exists("/source/dir/c.txt")).toBe(true);
      expect(fileSystem.exists("/target/dir/c.txt")).toBe(false);
    });

    it("mid-cancel with nested directories — partial tree at source, moved subtree at destination", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/sub1": { kind: "directory" },
        "/source/dir/sub1/a.txt": { kind: "file", size: 1 },
        "/source/dir/sub1/b.txt": { kind: "file", size: 2 },
        "/source/dir/sub2": { kind: "directory" },
        "/source/dir/sub2/c.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
      });
      const controller = new AbortController();
      let copyCount = 0;
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyCount++;
        fileSystem.addFile(destinationPath, {
          size: fileSystem.readNode(sourcePath)!.size,
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
        operationId: "cut-nested-cancel-1",
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

      // sub1 files moved to destination
      expect(fileSystem.exists("/target/dir/sub1/a.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/sub1/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/dir/sub1/b.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/sub1/b.txt")).toBe(false);
      // sub1 directory should be removed (empty after children moved)
      expect(fileSystem.exists("/source/dir/sub1")).toBe(false);
      // sub2 remains at source untouched
      expect(fileSystem.exists("/source/dir/sub2/c.txt")).toBe(true);
      expect(fileSystem.exists("/target/dir/sub2/c.txt")).toBe(false);
      expect(fileSystem.exists("/source/dir/sub2")).toBe(true);
      // Parent source dir preserved (still has sub2)
      expect(fileSystem.exists("/source/dir")).toBe(true);
    });

    it("preserves source file when source mutated after copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
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
      expect(fileSystem.readNode("/source/a.txt")!.size).toBe(99);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("preserves source file when source deleted externally after copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
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
        "/source": { kind: "directory" },
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
        "/source": { kind: "directory" },
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
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory", mode: 0o755 },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
        fileSystem.addFile(destinationPath, {
          size: fileSystem.readNode(sourcePath)!.size,
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
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
      });
      const rmImplFn: typeof fileSystem.rmImpl = async (path, options) => {
        if (path === "/source/dir") {
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
      expect(result?.items[0]?.error).toContain("Failed to remove empty source directory");
      // Children were moved successfully
      expect(fileSystem.exists("/target/dir/a.txt")).toBe(true);
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      // Empty source directory remains (rm failed)
      expect(fileSystem.exists("/source/dir")).toBe(true);
    });

    it("inline deletion rm failure reports item as failed but continues operation", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
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
      expect(result?.items[0]?.error).toContain("Failed to remove source");
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
        "/source": { kind: "directory" },
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
      expect(fileSystem.readNode("/target/dir/conflict.txt")!.size).toBe(3);
      // Source directory preserved (conflict.txt still there)
      expect(fileSystem.exists("/source/dir")).toBe(true);
    });

    it("source rm called only once per file — no redundant cleanup pass", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
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
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(2);
    });

    it("cut with runtime conflict resolved as overwrite deletes source inline", async () => {
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
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("nested child file deletion failure propagates to parent directory status", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
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
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath) => {
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
      expect(events.at(-1)?.status).toBe("partial");
      const result = events.at(-1)?.result;
      expect(result?.items[0]?.status).toBe("failed");
      expect(result?.items[0]?.error).toContain("Source was modified after copy");
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
      fileSystem.enableRename();
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async () => {
        copyFileStreamCalled = true;
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

      expect(copyFileStreamCalled).toBe(false);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("uses rename for same-dev cut symlink", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/link": { kind: "symlink", target: "actual.txt" },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
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
      fileSystem.enableRename();
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async () => {
        copyFileStreamCalled = true;
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

      expect(copyFileStreamCalled).toBe(false);
      expect(fileSystem.exists("/source/dir")).toBe(false);
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      expect(fileSystem.exists("/source/dir/sub/b.txt")).toBe(false);
      expect(fileSystem.readNode("/target/dir")!.kind).toBe("directory");
      expect(fileSystem.readNode("/target/dir/a.txt")!.size).toBe(3);
      expect(fileSystem.readNode("/target/dir/sub/b.txt")!.size).toBe(7);
    });

    it("falls back to copy+delete for cross-dev cut", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory", dev: 1 },
        "/source/a.txt": { kind: "file", size: 5, dev: 1 },
        "/target": { kind: "directory", dev: 2 },
      });
      fileSystem.enableRename();
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileStreamCalled = true;
        fileSystem.addFile(destinationPath, { size: fileSystem.readNode(sourcePath)!.size });
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

      expect(copyFileStreamCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("falls back to copy+delete on EXDEV error", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
      fileSystem.renameImpl = async () => {
        throw Object.assign(new Error("EXDEV"), { code: "EXDEV", path: "/source/a.txt" });
      };
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileStreamCalled = true;
        fileSystem.addFile(destinationPath, { size: fileSystem.readNode(sourcePath)!.size });
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

      expect(copyFileStreamCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("does NOT use rename for copy mode (only cut)", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileStreamCalled = true;
        fileSystem.addFile(destinationPath, { size: fileSystem.readNode(sourcePath)!.size });
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

      expect(copyFileStreamCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(true);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("does NOT use rename when fileSystem.rename is absent", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      // rename NOT enabled
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileStreamCalled = true;
        fileSystem.addFile(destinationPath, { size: fileSystem.readNode(sourcePath)!.size });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        mode: "cut",
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "rename-absent-1",
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

      expect(copyFileStreamCalled).toBe(true);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
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
      fileSystem.enableRename();
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
      expect(fileSystem.readNode("/target/dir/existing.txt")!.size).toBe(9);
      // Children moved individually via rename
      expect(fileSystem.exists("/source/dir/a.txt")).toBe(false);
      expect(fileSystem.exists("/source/dir/b.txt")).toBe(false);
      expect(fileSystem.readNode("/target/dir/a.txt")!.size).toBe(3);
      expect(fileSystem.readNode("/target/dir/b.txt")!.size).toBe(4);
    });

    it("rename with overwrite removes destination first", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 10 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      fileSystem.enableRename();
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
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(10);
    });

    it("rename with keep_both uses alternate destination name", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 8 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      fileSystem.enableRename();
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
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(2);
      // Renamed to alternate path
      expect(fileSystem.readNode("/target/a copy.txt")!.size).toBe(8);
    });

    it("rename preserves inode (atomic move, not copy)", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mode: 0o755 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
      const originalIno = fileSystem.readNode("/source/a.txt")!.ino;
      const originalMtimeMs = fileSystem.readNode("/source/a.txt")!.mtimeMs;
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

      const destNode = fileSystem.readNode("/target/a.txt")!;
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
      fileSystem.enableRename();
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async (sourcePath, destinationPath, signal) => {
        signal?.throwIfAborted();
        copyFileStreamCalled = true;
        fileSystem.addFile(destinationPath, { size: fileSystem.readNode(sourcePath)!.size });
      };
      const originalInoA = fileSystem.readNode("/source1/a.txt")!.ino;
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
      expect(fileSystem.readNode("/target/a.txt")!.ino).toBe(originalInoA);
      expect(fileSystem.exists("/source1/a.txt")).toBe(false);
      // b.txt copied+deleted (cross dev)
      expect(copyFileStreamCalled).toBe(true);
      expect(fileSystem.exists("/source2/b.txt")).toBe(false);
      expect(fileSystem.readNode("/target/b.txt")!.size).toBe(7);
    });

    it("EXDEV fallback still performs inline source deletion", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
      fileSystem.renameImpl = async () => {
        throw Object.assign(new Error("EXDEV"), { code: "EXDEV", path: "/source/a.txt" });
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
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("rename of directory with overwrite action removes destination directory first", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 3 },
        "/target": { kind: "directory" },
        "/target/dir": { kind: "directory" },
        "/target/dir/old.txt": { kind: "file", size: 1 },
      });
      fileSystem.enableRename();
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
      expect(fileSystem.readNode("/target/dir/a.txt")!.size).toBe(3);
      // old.txt gone because directory was overwritten (replaced), not merged
      expect(fileSystem.exists("/target/dir/old.txt")).toBe(false);
    });

    it("cancellation between rename operations", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 3 },
        "/source/b.txt": { kind: "file", size: 4 },
        "/source/c.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
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
      fileSystem.enableRename();
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
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(99);
    });

    it("rename with runtime conflict resolved as overwrite uses rename", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async () => {
        copyFileStreamCalled = true;
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

      expect(copyFileStreamCalled).toBe(false);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("directory rename reports correct byte progress for subtree", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/a.txt": { kind: "file", size: 100 },
        "/source/dir/b.txt": { kind: "file", size: 200 },
        "/source/dir/sub": { kind: "directory" },
        "/source/dir/sub/c.txt": { kind: "file", size: 300 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableRename();
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
      // completedByteCount must sum all file sizes in the subtree (100 + 200 + 300 = 600)
      expect(result?.summary.completedByteCount).toBe(600);
    });
  });

  describe("native copyFile and utimes", () => {
    it("uses copyFile when available, skips copyFileStream and chmod", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mode: 0o755 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableCopyFile();
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async () => {
        copyFileStreamCalled = true;
      };
      let chmodCalled = false;
      fileSystem.chmodImpl = async () => {
        chmodCalled = true;
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

      expect(copyFileStreamCalled).toBe(false);
      expect(chmodCalled).toBe(false);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("falls back to copyFileStream when copyFile absent", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      // copyFile NOT enabled
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "native-fallback-1",
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

      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("copyFileStream fallback preserves mtime via utimes", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mtimeMs: 5555 },
        "/target": { kind: "directory" },
      });
      // No copyFile — exercises copyFileStream path. Enable utimes.
      fileSystem.enableUtimes();

      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/a.txt"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "stream-utimes-1",
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

      expect(fileSystem.readNode("/target/a.txt")!.mtimeMs).toBe(5555);
    });

    it("copyFile preserves mode and mtime", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5, mode: 0o755, mtimeMs: 9999 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableCopyFile();
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

      const dest = fileSystem.readNode("/target/a.txt")!;
      expect(dest.mode).toBe(0o755);
      expect(dest.mtimeMs).toBe(9999);
    });

    it("copyFile error propagates and fails the operation", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableCopyFile();
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

      const finalEvent = events[events.length - 1]!;
      expect(finalEvent.result!.status).toBe("failed");
      expect(finalEvent.result!.error).toContain("EACCES");
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

    it("lutimes called for symlinks after symlink creation", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/link": { kind: "symlink", target: "actual.txt", mtimeMs: 7777 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableLutimes();
      const lutimesCalls: Array<{ path: string; mtimeMs: number }> = [];
      fileSystem.lutimesImpl = async (path, _atimeMs, mtimeMs) => {
        lutimesCalls.push({ path, mtimeMs });
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/link"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "lutimes-symlink-1",
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

      expect(lutimesCalls.some((c) => c.path === "/target/link" && c.mtimeMs === 7777)).toBe(true);
    });

    it("symlink uses lutimes not utimes (does not follow symlink target)", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/link": { kind: "symlink", target: "actual.txt", mtimeMs: 7777 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableUtimes();
      fileSystem.enableLutimes();
      const utimesCalls: string[] = [];
      const lutimesCalls: string[] = [];
      fileSystem.utimesImpl = async (path) => {
        utimesCalls.push(path);
      };
      fileSystem.lutimesImpl = async (path) => {
        lutimesCalls.push(path);
      };
      const { report, resolvedNodes } = await createResolvedOperation({
        fileSystem,
        sourcePaths: ["/source/link"],
        destinationDirectoryPath: "/target",
      });

      await executeCopyPasteFromAnalysis({
        operationId: "symlink-lutimes-not-utimes",
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

      // lutimes called for the symlink, utimes NOT called
      expect(lutimesCalls).toContain("/target/link");
      expect(utimesCalls).not.toContain("/target/link");
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
      expect(fileSystem.readNode("/target/dir")!.kind).toBe("directory");
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

      expect(fileSystem.readNode("/target/dir")!.kind).toBe("directory");
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

      expect(fileSystem.readNode("/target/link")!.kind).toBe("symlink");
    });

    it("utimes other errors propagate", async () => {
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

      const finalEvent = events[events.length - 1]!;
      expect(finalEvent.result!.status).toBe("failed");
      expect(finalEvent.result!.error).toContain("EPERM");
    });

    it("copyFile + cut: inline source deletion still works", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableCopyFile();
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
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(5);
    });

    it("copyFile + rename: rename takes priority for same-dev cut", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });
      fileSystem.enableCopyFile();
      fileSystem.enableRename();
      let copyFileCalled = false;
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };
      const originalIno = fileSystem.readNode("/source/a.txt")!.ino;
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
      expect(fileSystem.readNode("/target/a.txt")!.ino).toBe(originalIno);
    });

    it("copyFile with overwrite: destination removed before native copy", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 10 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      fileSystem.enableCopyFile();
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

      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(10);
    });

    it("copyFile with keep_both: correct alternate destination path used", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/a.txt": { kind: "file", size: 8 },
        "/target": { kind: "directory" },
        "/target/a.txt": { kind: "file", size: 2 },
      });
      fileSystem.enableCopyFile();
      const copyFilePaths: string[] = [];
      fileSystem.copyFileImpl = async (sourcePath, destinationPath) => {
        copyFilePaths.push(destinationPath);
        fileSystem.addFile(destinationPath, { size: fileSystem.readNode(sourcePath)!.size });
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

      expect(copyFilePaths).toEqual(["/target/a copy.txt"]);
      expect(fileSystem.readNode("/target/a.txt")!.size).toBe(2);
      expect(fileSystem.readNode("/target/a copy.txt")!.size).toBe(8);
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

      const dirCall = utimesArgs.find((c) => c.path === "/target/dir");
      expect(dirCall).toBeDefined();
      expect(dirCall!.atimeMs).toBe(1234567890);
      expect(dirCall!.mtimeMs).toBe(1234567890);
    });
  });

  describe("cross-phase integration", () => {
    it("rename + inline cut: rename moves file, no copy or separate delete", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/a.txt": { kind: "file", size: 10, dev: 1 },
        "/target": { kind: "directory", dev: 1 },
      });
      fileSystem.enableRename();
      fileSystem.enableCopyFile();

      let copyFileCalled = false;
      let copyFileStreamCalled = false;
      fileSystem.copyFileImpl = async () => {
        copyFileCalled = true;
      };
      fileSystem.copyFileStreamImpl = async () => {
        copyFileStreamCalled = true;
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
      expect(copyFileStreamCalled).toBe(false);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("EXDEV fallback + inline cut: copy then inline delete", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/a.txt": { kind: "file", size: 10, dev: 1 },
        "/target": { kind: "directory", dev: 1 },
      });
      fileSystem.enableRename();

      // Force EXDEV on rename despite same dev
      fileSystem.renameImpl = async () => {
        throw Object.assign(new Error("EXDEV"), { code: "EXDEV" });
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
      fileSystem.enableCopyFile();

      let copyFileCalled = false;
      let copyFileStreamCalled = false;
      fileSystem.copyFileStreamImpl = async () => {
        copyFileStreamCalled = true;
      };
      fileSystem.copyFileImpl = async (src, dst) => {
        copyFileCalled = true;
        // Manually do the file copy since we can't delegate to the mock's own copyFile
        const srcNode = fileSystem.readNode(src)!;
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
      expect(copyFileStreamCalled).toBe(false);
      expect(fileSystem.exists("/source/a.txt")).toBe(false);
      expect(fileSystem.exists("/target/a.txt")).toBe(true);
    });

    it("rename + copyFile: rename prioritized over copyFile for same-dev cut", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source/a.txt": { kind: "file", size: 10, dev: 1 },
        "/target": { kind: "directory", dev: 1 },
      });
      fileSystem.enableRename();
      fileSystem.enableCopyFile();

      let renameCalled = false;
      let copyFileCalled = false;
      const renameSize = fileSystem.readNode("/source/a.txt")!.size;
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
      fileSystem.enableRename();
      fileSystem.enableCopyFile();

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
});
