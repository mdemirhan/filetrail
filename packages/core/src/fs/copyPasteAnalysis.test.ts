import {
  buildCopyPasteAnalysisReport,
  normalizeCopyPasteAnalysisRequest,
} from "./copyPasteAnalysis";
import { MockWriteServiceFileSystem } from "./testUtils";

describe("copyPasteAnalysis", () => {
  it("normalizes source and destination paths", () => {
    expect(
      normalizeCopyPasteAnalysisRequest({
        mode: "copy",
        sourcePaths: ["/workspace/file.txt/", "/workspace/file.txt", "/workspace/../workspace/a"],
        destinationDirectoryPath: "/target/../target",
      }),
    ).toEqual({
      mode: "copy",
      sourcePaths: ["/workspace/file.txt", "/workspace/a"],
      destinationDirectoryPath: "/target",
    });
  });

  it("analyzes a new file copy into an empty destination", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
      "/workspace/file.txt": { kind: "file", size: 5 },
      "/target": { kind: "directory" },
    });

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/workspace/file.txt"],
        destinationDirectoryPath: "/target",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });

    expect(report.issues).toEqual([]);
    expect(report.summary).toMatchObject({
      totalNodeCount: 1,
      fileConflictCount: 0,
      directoryConflictCount: 0,
      mismatchConflictCount: 0,
      totalBytes: 5,
    });
    expect(report.nodes[0]).toMatchObject({
      sourcePath: "/workspace/file.txt",
      destinationPath: "/target/file.txt",
      conflictClass: null,
      disposition: "new",
    });
  });

  it("resolves same-directory copy to a keep-both destination name", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
      "/workspace/file.txt": { kind: "file", size: 5 },
      "/workspace/file copy.txt": { kind: "file", size: 5 },
    });

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/workspace/file.txt"],
        destinationDirectoryPath: "/workspace",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });

    expect(report.nodes[0]?.destinationPath).toBe("/workspace/file copy 2.txt");
    expect(report.issues).toEqual([]);
  });

  it("blocks same-directory cut as a self-target", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
      "/workspace/file.txt": { kind: "file", size: 5 },
    });

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "cut",
        sourcePaths: ["/workspace/file.txt"],
        destinationDirectoryPath: "/workspace",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });

    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "same_path",
      }),
    ]);
  });

  it("flags top-level and nested conflicts recursively for folders", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/Photos": { kind: "directory" },
      "/source/Photos/logo.png": { kind: "file", size: 10 },
      "/source/Photos/icons": { kind: "directory" },
      "/source/Photos/icons/a.svg": { kind: "file", size: 4 },
      "/target": { kind: "directory" },
      "/target/Photos": { kind: "directory" },
      "/target/Photos/logo.png": { kind: "file", size: 8 },
      "/target/Photos/icons": { kind: "directory" },
      "/target/Photos/icons/a.svg": { kind: "directory" },
    });

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/source/Photos"],
        destinationDirectoryPath: "/target",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });

    const topLevel = report.nodes[0];
    expect(topLevel?.conflictClass).toBe("directory_conflict");
    expect(report.summary.directoryConflictCount).toBe(2);
    expect(report.summary.fileConflictCount).toBe(1);
    expect(report.summary.mismatchConflictCount).toBe(1);
    expect(
      topLevel?.children.find((child) => child.sourcePath.endsWith("logo.png"))?.conflictClass,
    ).toBe("file_conflict");
    expect(
      topLevel?.children
        .find((child) => child.sourcePath.endsWith("/icons"))
        ?.children.find((child) => child.sourcePath.endsWith("a.svg"))?.conflictClass,
    ).toBe("type_mismatch");
  });

  it("detects destination and source issues", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
      "/workspace/file.txt": { kind: "file", size: 3 },
      "/not-a-dir": { kind: "file", size: 1 },
    });

    const destinationMissing = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/workspace/file.txt"],
        destinationDirectoryPath: "/missing",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });
    expect(destinationMissing.issues).toEqual([
      expect.objectContaining({
        code: "destination_missing",
      }),
    ]);

    const destinationNotDirectory = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-2",
      request: {
        mode: "copy",
        sourcePaths: ["/workspace/file.txt"],
        destinationDirectoryPath: "/not-a-dir",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });
    expect(destinationNotDirectory.issues).toEqual([
      expect.objectContaining({
        code: "destination_not_directory",
      }),
    ]);

    const sourceMissing = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-3",
      request: {
        mode: "copy",
        sourcePaths: ["/workspace/file.txt", "/workspace/missing.txt"],
        destinationDirectoryPath: "/workspace",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });
    expect(sourceMissing.issues).toEqual([
      expect.objectContaining({
        code: "source_missing",
      }),
    ]);
  });

  it("rejects copying a directory into its own descendant", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
      "/workspace/folder": { kind: "directory" },
      "/workspace/folder/child": { kind: "directory" },
    });
    fileSystem.setRealpath("/workspace/folder", "/workspace/folder");
    fileSystem.setRealpath("/workspace/folder/child", "/workspace/folder/child");

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/workspace/folder"],
        destinationDirectoryPath: "/workspace/folder/child",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });

    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "parent_into_child",
      }),
    ]);
  });

  it("falls back to a source-missing issue when parent/child realpath checks fail", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
      "/workspace/folder": { kind: "directory" },
      "/workspace/folder/child": { kind: "directory" },
      "/target": { kind: "directory" },
    });
    fileSystem.realpathImpl = async (path) => {
      if (path === "/workspace/folder") {
        throw new Error("realpath failed");
      }
      return path;
    };

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/workspace/folder"],
        destinationDirectoryPath: "/workspace/folder/child",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });

    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "source_missing",
      }),
    ]);
  });

  it("includes large-batch and cut warnings", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
      "/workspace/folder": { kind: "directory" },
      "/workspace/folder/a.txt": { kind: "file", size: 5 },
      "/workspace/folder/b.txt": { kind: "file", size: 7 },
      "/target": { kind: "directory" },
    });

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "cut",
        sourcePaths: ["/workspace/folder"],
        destinationDirectoryPath: "/target",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 2,
        largeBatchByteThreshold: 4,
      },
    });

    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "large_batch" }),
        expect.objectContaining({ code: "cut_requires_delete" }),
      ]),
    );
  });

  it("handles symlink sources as first-class nodes", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source": { kind: "directory" },
      "/source/alias": { kind: "symlink", target: "actual.txt" },
      "/target": { kind: "directory" },
      "/target/alias": { kind: "file", size: 5 },
    });

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: ["/source/alias"],
        destinationDirectoryPath: "/target",
      },
      fileSystem,
      thresholds: {
        largeBatchItemThreshold: 100,
        largeBatchByteThreshold: 1000,
      },
    });

    expect(report.nodes[0]).toMatchObject({
      sourceKind: "symlink",
      destinationKind: "file",
      conflictClass: "type_mismatch",
    });
  });
});
