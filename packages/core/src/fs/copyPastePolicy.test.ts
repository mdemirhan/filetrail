import { resolveAnalysisWithPolicy, resolveSingleNodeWithAction } from "./copyPastePolicy";
import { MockWriteServiceFileSystem } from "./testUtils";
import type {
  CopyPasteAnalysisNode,
  CopyPasteAnalysisReport,
  CopyPastePolicy,
} from "./writeServiceTypes";

function createNode(
  input: Partial<CopyPasteAnalysisNode> &
    Pick<CopyPasteAnalysisNode, "id" | "sourcePath" | "destinationPath">,
): CopyPasteAnalysisNode {
  return {
    id: input.id,
    sourcePath: input.sourcePath,
    destinationPath: input.destinationPath,
    sourceKind: input.sourceKind ?? "file",
    destinationKind: input.destinationKind ?? "missing",
    disposition: input.disposition ?? "new",
    conflictClass: input.conflictClass ?? null,
    sourceFingerprint: input.sourceFingerprint ?? {
      exists: true,
      kind: input.sourceKind ?? "file",
      size: 1,
      mtimeMs: 1,
      mode: 0o644,
      ino: 1,
      dev: 1,
      symlinkTarget: null,
    },
    destinationFingerprint: input.destinationFingerprint ?? {
      exists: input.destinationKind ? input.destinationKind !== "missing" : false,
      kind: input.destinationKind ?? "missing",
      size: null,
      mtimeMs: null,
      mode: null,
      ino: null,
      dev: null,
      symlinkTarget: null,
    },
    children: input.children ?? [],
    issueCode: null,
    issueMessage: null,
    totalNodeCount: input.totalNodeCount ?? 1,
    conflictNodeCount: input.conflictNodeCount ?? (input.conflictClass ? 1 : 0),
    destinationTotalNodeCount: input.destinationTotalNodeCount ?? null,
  };
}

function createReport(nodes: CopyPasteAnalysisNode[]): CopyPasteAnalysisReport {
  return {
    analysisId: "analysis-1",
    mode: "copy",
    sourcePaths: nodes.map((node) => node.sourcePath),
    destinationDirectoryPath: "/target",
    nodes,
    issues: [],
    warnings: [],
    summary: {
      topLevelItemCount: nodes.length,
      totalNodeCount: nodes.length,
      totalBytes: 1,
      fileConflictCount: nodes.filter((node) => node.conflictClass === "file_conflict").length,
      directoryConflictCount: nodes.filter((node) => node.conflictClass === "directory_conflict")
        .length,
      mismatchConflictCount: nodes.filter((node) => node.conflictClass === "type_mismatch").length,
      blockedCount: 0,
    },
  };
}

describe("copyPastePolicy", () => {
  it("resolves file conflicts with overwrite, skip, and keep-both actions", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
      "/target/report copy.txt": { kind: "file", size: 1 },
    });
    const node = createNode({
      id: "file",
      sourcePath: "/source/report.txt",
      destinationPath: "/target/report.txt",
      sourceKind: "file",
      destinationKind: "file",
      conflictClass: "file_conflict",
      disposition: "conflict",
    });

    const [overwrite] = await resolveAnalysisWithPolicy({
      report: createReport([node]),
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
    });
    expect(overwrite).toMatchObject({
      action: "overwrite",
      destinationPath: "/target/report.txt",
    });

    const [skip] = await resolveAnalysisWithPolicy({
      report: createReport([node]),
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
    });
    if (!skip) {
      throw new Error("Expected skip resolution.");
    }
    expect(skip.action).toBe("skip");

    const [keepBoth] = await resolveAnalysisWithPolicy({
      report: createReport([node]),
      policy: {
        file: "keep_both",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
    });
    expect(keepBoth).toMatchObject({
      action: "keep_both",
      destinationPath: "/target/report copy 2.txt",
    });
  });

  it("resolves directory conflicts as merge, skip, or keep-both and propagates child actions", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
      "/target/Folder copy": { kind: "directory" },
    });
    const directoryNode = createNode({
      id: "dir",
      sourcePath: "/source/Folder",
      destinationPath: "/target/Folder",
      sourceKind: "directory",
      destinationKind: "directory",
      conflictClass: "directory_conflict",
      disposition: "conflict",
      children: [
        createNode({
          id: "dir/a.txt",
          sourcePath: "/source/Folder/a.txt",
          destinationPath: "/target/Folder/a.txt",
          sourceKind: "file",
          destinationKind: "file",
          conflictClass: "file_conflict",
          disposition: "conflict",
        }),
        createNode({
          id: "dir/nested",
          sourcePath: "/source/Folder/nested",
          destinationPath: "/target/Folder/nested",
          sourceKind: "directory",
          destinationKind: "directory",
          conflictClass: "directory_conflict",
          disposition: "conflict",
          children: [
            createNode({
              id: "dir/nested/deep.txt",
              sourcePath: "/source/Folder/nested/deep.txt",
              destinationPath: "/target/Folder/nested/deep.txt",
              sourceKind: "file",
              destinationKind: "file",
              conflictClass: "file_conflict",
              disposition: "conflict",
            }),
          ],
        }),
      ],
    });

    const [merge] = await resolveAnalysisWithPolicy({
      report: createReport([directoryNode]),
      policy: {
        file: "overwrite",
        directory: "merge",
        mismatch: "skip",
      },
      fileSystem,
    });
    if (!merge) {
      throw new Error("Expected merge resolution.");
    }
    expect(merge.action).toBe("merge");
    expect(merge.children[0]?.action).toBe("overwrite");

    const [skip] = await resolveAnalysisWithPolicy({
      report: createReport([directoryNode]),
      policy: {
        file: "overwrite",
        directory: "skip",
        mismatch: "skip",
      },
      fileSystem,
    });
    if (!skip) {
      throw new Error("Expected skip resolution.");
    }
    expect(skip.action).toBe("skip");
    expect(skip.children[0]?.action).toBe("skip");

    const [keepBoth] = await resolveAnalysisWithPolicy({
      report: createReport([directoryNode]),
      policy: {
        file: "overwrite",
        directory: "keep_both",
        mismatch: "skip",
      },
      fileSystem,
    });
    if (!keepBoth) {
      throw new Error("Expected keep-both resolution.");
    }
    expect(keepBoth.action).toBe("keep_both");
    expect(keepBoth.destinationPath).toBe("/target/Folder copy 2");
    expect(keepBoth.children[0]?.action).toBe("create");
    expect(keepBoth.children[0]?.destinationPath).toBe("/target/Folder copy 2/a.txt");
    expect(keepBoth.children[1]?.action).toBe("create");
    expect(keepBoth.children[1]?.destinationPath).toBe("/target/Folder copy 2/nested");
    expect(keepBoth.children[1]?.children[0]?.destinationPath).toBe(
      "/target/Folder copy 2/nested/deep.txt",
    );

    const [overwrite] = await resolveAnalysisWithPolicy({
      report: createReport([directoryNode]),
      policy: {
        file: "overwrite",
        directory: "overwrite",
        mismatch: "skip",
      },
      fileSystem,
    });
    if (!overwrite) {
      throw new Error("Expected overwrite resolution.");
    }
    expect(overwrite.action).toBe("overwrite");
    expect(overwrite.destinationPath).toBe("/target/Folder");
    expect(overwrite.children[0]?.action).toBe("create");
    expect(overwrite.children[0]?.destinationPath).toBe("/target/Folder/a.txt");
  });

  it("uses mismatch policy for type conflicts", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
    });
    const node = createNode({
      id: "mismatch",
      sourcePath: "/source/readme",
      destinationPath: "/target/readme",
      sourceKind: "file",
      destinationKind: "directory",
      conflictClass: "type_mismatch",
      disposition: "conflict",
    });

    const [resolved] = await resolveAnalysisWithPolicy({
      report: createReport([node]),
      policy: {
        file: "skip",
        directory: "merge",
        mismatch: "overwrite",
      },
      fileSystem,
    });

    if (!resolved) {
      throw new Error("Expected mismatch resolution.");
    }
    expect(resolved.action).toBe("overwrite");
  });

  it.each([
    ["directory", "directory_conflict", {}, "Missing directory conflict policy."],
    ["mismatch", "type_mismatch", { directory: "merge" }, "Missing mismatch conflict policy."],
    [
      "file",
      "file_conflict",
      { directory: "merge", mismatch: "skip" },
      "Missing file conflict policy.",
    ],
  ] as const)(
    "rejects incomplete %s conflict policy",
    async (_name, conflictClass, policy, expectedMessage) => {
      const fileSystem = new MockWriteServiceFileSystem({
        "/target": { kind: "directory" },
      });
      const node = createNode({
        id: `missing-${conflictClass}`,
        sourcePath: "/source/item",
        destinationPath: "/target/item",
        sourceKind: conflictClass === "directory_conflict" ? "directory" : "file",
        destinationKind: conflictClass === "type_mismatch" ? "directory" : "file",
        conflictClass,
        disposition: "conflict",
      });

      await expect(
        resolveAnalysisWithPolicy({
          report: createReport([node]),
          policy: policy as CopyPastePolicy,
          fileSystem,
        }),
      ).rejects.toThrow(expectedMessage);
    },
  );

  it("joins child destinations under filesystem root without duplicate separators", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/Folder copy": { kind: "directory" },
    });
    const directoryNode = createNode({
      id: "root-dir",
      sourcePath: "/source/Folder",
      destinationPath: "/Folder",
      sourceKind: "directory",
      destinationKind: "directory",
      conflictClass: "directory_conflict",
      disposition: "conflict",
      children: [
        createNode({
          id: "root-dir/a.txt",
          sourcePath: "/source/Folder/a.txt",
          destinationPath: "/Folder/a.txt",
        }),
      ],
    });

    const [resolved] = await resolveAnalysisWithPolicy({
      report: createReport([directoryNode]),
      policy: {
        file: "skip",
        directory: "keep_both",
        mismatch: "skip",
      },
      fileSystem,
    });

    if (!resolved) {
      throw new Error("Expected root destination resolution.");
    }
    expect(resolved.destinationPath).toBe("/Folder copy 2");
    expect(resolved.children[0]?.destinationPath).toBe("/Folder copy 2/a.txt");
  });

  it("allows explicit runtime actions to override the stored policy", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
      "/target/file copy.txt": { kind: "file", size: 1 },
    });
    const node = createNode({
      id: "runtime",
      sourcePath: "/source/file.txt",
      destinationPath: "/target/file.txt",
      sourceKind: "file",
      destinationKind: "file",
      conflictClass: "file_conflict",
      disposition: "conflict",
    });

    const resolved = await resolveSingleNodeWithAction({
      node,
      action: "keep_both",
      fileSystem,
    });

    expect(resolved).toMatchObject({
      action: "keep_both",
      destinationPath: "/target/file copy 2.txt",
    });
  });

  it("treats directory overwrite children as creates because the parent is replaced fresh", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/target": { kind: "directory" },
    });
    const node = createNode({
      id: "runtime-dir",
      sourcePath: "/source/Folder",
      destinationPath: "/target/Folder",
      sourceKind: "directory",
      destinationKind: "file",
      conflictClass: "type_mismatch",
      disposition: "conflict",
      children: [
        createNode({
          id: "runtime-dir/nested",
          sourcePath: "/source/Folder/nested",
          destinationPath: "/target/Folder/nested",
          sourceKind: "directory",
          destinationKind: "directory",
          conflictClass: "directory_conflict",
          disposition: "conflict",
          children: [
            createNode({
              id: "runtime-dir/nested/deep.txt",
              sourcePath: "/source/Folder/nested/deep.txt",
              destinationPath: "/target/Folder/nested/deep.txt",
              sourceKind: "file",
              destinationKind: "file",
              conflictClass: "file_conflict",
              disposition: "conflict",
            }),
          ],
        }),
      ],
    });

    const resolved = await resolveSingleNodeWithAction({
      node,
      action: "overwrite",
      fileSystem,
    });

    expect(resolved.action).toBe("overwrite");
    expect(resolved.children[0]?.action).toBe("create");
    expect(resolved.children[0]?.children[0]?.action).toBe("create");
  });
});
