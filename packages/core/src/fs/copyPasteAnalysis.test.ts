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

  describe("destinationTotalNodeCount", () => {
    it("counts destination items recursively for a directory conflict", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/Photos": { kind: "directory" },
        "/source/Photos/a.png": { kind: "file", size: 10 },
        "/target": { kind: "directory" },
        "/target/Photos": { kind: "directory" },
        "/target/Photos/x.png": { kind: "file", size: 5 },
        "/target/Photos/y.png": { kind: "file", size: 5 },
        "/target/Photos/sub": { kind: "directory" },
        "/target/Photos/sub/z.png": { kind: "file", size: 5 },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-1",
        request: {
          mode: "copy",
          sourcePaths: ["/source/Photos"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      const node = report.nodes[0];
      expect(node?.conflictClass).toBe("directory_conflict");
      // destination has: x.png, y.png, sub, sub/z.png = 4 items
      expect(node?.destinationTotalNodeCount).toBe(4);
    });

    it("counts hidden dotfiles in the destination directory", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/folder": { kind: "directory" },
        "/source/folder/file.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/folder": { kind: "directory" },
        "/target/folder/.hidden": { kind: "file", size: 1 },
        "/target/folder/.config": { kind: "directory" },
        "/target/folder/.config/settings": { kind: "file", size: 1 },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-hidden",
        request: {
          mode: "copy",
          sourcePaths: ["/source/folder"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      // .hidden, .config, .config/settings = 3 items
      expect(report.nodes[0]?.destinationTotalNodeCount).toBe(3);
    });

    it("returns 0 for an empty destination directory", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/folder": { kind: "directory" },
        "/source/folder/file.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/folder": { kind: "directory" },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-empty",
        request: {
          mode: "copy",
          sourcePaths: ["/source/folder"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      expect(report.nodes[0]?.destinationTotalNodeCount).toBe(0);
    });

    it("counts symlinks as items in the destination", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/folder": { kind: "directory" },
        "/source/folder/f.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/folder": { kind: "directory" },
        "/target/folder/link": { kind: "symlink", target: "/elsewhere" },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-symlink",
        request: {
          mode: "copy",
          sourcePaths: ["/source/folder"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      expect(report.nodes[0]?.destinationTotalNodeCount).toBe(1);
    });

    it("returns null for file conflict nodes", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/file.txt": { kind: "file", size: 10 },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-file",
        request: {
          mode: "copy",
          sourcePaths: ["/source/file.txt"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      expect(report.nodes[0]?.conflictClass).toBe("file_conflict");
      expect(report.nodes[0]?.destinationTotalNodeCount).toBeNull();
    });

    it("returns null for type mismatch nodes", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/item": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/item": { kind: "directory" },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-mismatch",
        request: {
          mode: "copy",
          sourcePaths: ["/source/item"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      expect(report.nodes[0]?.conflictClass).toBe("type_mismatch");
      expect(report.nodes[0]?.destinationTotalNodeCount).toBeNull();
    });

    it("returns null for new items with no conflict", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/file.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-new",
        request: {
          mode: "copy",
          sourcePaths: ["/source/file.txt"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      expect(report.nodes[0]?.conflictClass).toBeNull();
      expect(report.nodes[0]?.destinationTotalNodeCount).toBeNull();
    });

    it("returns null when destination readdir fails", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/folder": { kind: "directory" },
        "/source/folder/f.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/folder": { kind: "directory" },
        "/target/folder/a.txt": { kind: "file", size: 1 },
      });

      const failingReaddir = async (path: string): Promise<string[]> => {
        if (path === "/target/folder") {
          throw new Error("EACCES: permission denied");
        }
        // Temporarily remove override to use default behavior
        fileSystem.readdirImpl = null;
        try {
          return await fileSystem.readdir(path);
        } finally {
          fileSystem.readdirImpl = failingReaddir;
        }
      };
      fileSystem.readdirImpl = failingReaddir;

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-fail",
        request: {
          mode: "copy",
          sourcePaths: ["/source/folder"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      expect(report.nodes[0]?.conflictClass).toBe("directory_conflict");
      expect(report.nodes[0]?.destinationTotalNodeCount).toBeNull();
    });

    it("handles deeply nested destination trees", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/root": { kind: "directory" },
        "/source/root/f.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/root": { kind: "directory" },
        "/target/root/a": { kind: "directory" },
        "/target/root/a/b": { kind: "directory" },
        "/target/root/a/b/c": { kind: "directory" },
        "/target/root/a/b/c/deep.txt": { kind: "file", size: 1 },
        "/target/root/sibling.txt": { kind: "file", size: 1 },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-deep",
        request: {
          mode: "copy",
          sourcePaths: ["/source/root"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      // a, a/b, a/b/c, a/b/c/deep.txt, sibling.txt = 5
      expect(report.nodes[0]?.destinationTotalNodeCount).toBe(5);
    });

    it("counts mixed file types correctly in destination", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/dir": { kind: "directory" },
        "/source/dir/x.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/dir": { kind: "directory" },
        "/target/dir/file.txt": { kind: "file", size: 1 },
        "/target/dir/sub": { kind: "directory" },
        "/target/dir/link": { kind: "symlink", target: "/elsewhere" },
      });

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-mixed",
        request: {
          mode: "copy",
          sourcePaths: ["/source/dir"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      // file.txt, sub, link = 3
      expect(report.nodes[0]?.destinationTotalNodeCount).toBe(3);
    });

    it("reuses cached counts for nested destination conflicts", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/root": { kind: "directory" },
        "/source/root/sub": { kind: "directory" },
        "/source/root/sub/file.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/root": { kind: "directory" },
        "/target/root/sub": { kind: "directory" },
        "/target/root/sub/existing.txt": { kind: "file", size: 1 },
      });

      const targetReadCounts = new Map<string, number>();
      const countingReaddir = async (path: string): Promise<string[]> => {
        if (path.startsWith("/target/")) {
          targetReadCounts.set(path, (targetReadCounts.get(path) ?? 0) + 1);
        }
        fileSystem.readdirImpl = null;
        try {
          return await fileSystem.readdir(path);
        } finally {
          fileSystem.readdirImpl = countingReaddir;
        }
      };
      fileSystem.readdirImpl = countingReaddir;

      const report = await buildCopyPasteAnalysisReport({
        analysisId: "dest-count-cache",
        request: {
          mode: "copy",
          sourcePaths: ["/source/root"],
          destinationDirectoryPath: "/target",
        },
        fileSystem,
        thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
      });

      expect(report.nodes[0]?.destinationTotalNodeCount).toBe(2);
      expect(report.nodes[0]?.children[0]?.destinationTotalNodeCount).toBe(1);
      expect(targetReadCounts.get("/target/root")).toBe(1);
      expect(targetReadCounts.get("/target/root/sub")).toBe(1);
    });

    it("propagates aborts while counting destination items", async () => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/source": { kind: "directory" },
        "/source/folder": { kind: "directory" },
        "/source/folder/file.txt": { kind: "file", size: 1 },
        "/target": { kind: "directory" },
        "/target/folder": { kind: "directory" },
        "/target/folder/existing.txt": { kind: "file", size: 1 },
      });
      const controller = new AbortController();
      controller.abort();

      await expect(
        buildCopyPasteAnalysisReport({
          analysisId: "dest-count-abort",
          request: {
            mode: "copy",
            sourcePaths: ["/source/folder"],
            destinationDirectoryPath: "/target",
          },
          fileSystem,
          thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 10000 },
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    });
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
