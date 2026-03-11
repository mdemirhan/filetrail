import { vi } from "vitest";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import {
  type MockFileSystemSnapshotEntry,
  MockWriteServiceFileSystem,
  snapshotMockFileSystem,
} from "./testUtils";
import type {
  CopyPasteMode,
  CopyPastePolicy,
  CopyPasteProgressEvent,
  CopyPasteRuntimeConflict,
} from "./writeServiceTypes";

type SeedNode =
  | {
      kind: "file";
      size?: number;
      mode?: number;
    }
  | {
      kind: "directory";
      mode?: number;
    }
  | {
      kind: "symlink";
      target: string;
      mode?: number;
    };

type MatrixScenario = {
  name: string;
  mode: CopyPasteMode;
  seed: Record<string, SeedNode>;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy: CopyPastePolicy;
  expectedStatus: "completed" | "partial";
  expectedSnapshot: Record<string, MockFileSystemSnapshotEntry>;
  expectedRuntimeConflictCount?: number;
  runtimeResolution?: "overwrite" | "skip" | "keep_both" | "merge";
  mutateAfterResolve?: (fileSystem: MockWriteServiceFileSystem) => void;
};

describe("copyPaste scenario matrix", () => {
  it.each(createKeepBothRegressionScenarios())(
    "$name",
    async ({
      destinationDirectoryPath,
      expectedRuntimeConflictCount,
      expectedSnapshot,
      expectedStatus,
      mode,
      mutateAfterResolve,
      name: _name,
      policy,
      runtimeResolution,
      seed,
      sourcePaths,
    }) => {
      const result = await runScenario({
        destinationDirectoryPath,
        mode,
        mutateAfterResolve,
        policy,
        runtimeResolution,
        seed,
        sourcePaths,
      });

      expect(result.runtimeConflicts).toHaveLength(expectedRuntimeConflictCount ?? 0);
      expect(result.result?.status).toBe(expectedStatus);
      expect(snapshotRelevantTree(result.fileSystem)).toEqual(expectedSnapshot);
    },
  );

  it.each(createDirectoryPolicyMatrixScenarios())(
    "$name",
    async ({
      destinationDirectoryPath,
      expectedRuntimeConflictCount,
      expectedSnapshot,
      expectedStatus,
      mode,
      mutateAfterResolve,
      name: _name,
      policy,
      runtimeResolution,
      seed,
      sourcePaths,
    }) => {
      const result = await runScenario({
        destinationDirectoryPath,
        mode,
        mutateAfterResolve,
        policy,
        runtimeResolution,
        seed,
        sourcePaths,
      });

      expect(result.runtimeConflicts).toHaveLength(expectedRuntimeConflictCount ?? 0);
      expect(result.result?.status).toBe(expectedStatus);
      expect(snapshotRelevantTree(result.fileSystem)).toEqual(expectedSnapshot);
    },
  );

  it.each(createFilePolicyMatrixScenarios())(
    "$name",
    async ({
      destinationDirectoryPath,
      expectedRuntimeConflictCount,
      expectedSnapshot,
      expectedStatus,
      mode,
      mutateAfterResolve,
      name: _name,
      policy,
      runtimeResolution,
      seed,
      sourcePaths,
    }) => {
      const result = await runScenario({
        destinationDirectoryPath,
        mode,
        mutateAfterResolve,
        policy,
        runtimeResolution,
        seed,
        sourcePaths,
      });

      expect(result.runtimeConflicts).toHaveLength(expectedRuntimeConflictCount ?? 0);
      expect(result.result?.status).toBe(expectedStatus);
      expect(snapshotRelevantTree(result.fileSystem)).toEqual(expectedSnapshot);
    },
  );

  it.each(createMismatchPolicyMatrixScenarios())(
    "$name",
    async ({
      destinationDirectoryPath,
      expectedRuntimeConflictCount,
      expectedSnapshot,
      expectedStatus,
      mode,
      mutateAfterResolve,
      name: _name,
      policy,
      runtimeResolution,
      seed,
      sourcePaths,
    }) => {
      const result = await runScenario({
        destinationDirectoryPath,
        mode,
        mutateAfterResolve,
        policy,
        runtimeResolution,
        seed,
        sourcePaths,
      });

      expect(result.runtimeConflicts).toHaveLength(expectedRuntimeConflictCount ?? 0);
      expect(result.result?.status).toBe(expectedStatus);
      expect(snapshotRelevantTree(result.fileSystem)).toEqual(expectedSnapshot);
    },
  );

  it("prompts once when the resolved keep-both destination is actually created after planning", async () => {
    const result = await runScenario({
      mode: "copy",
      seed: {
        "/source": { kind: "directory" },
        "/source/report.txt": { kind: "file", size: 5 },
        "/target": { kind: "directory" },
        "/target/report.txt": { kind: "file", size: 3 },
      },
      sourcePaths: ["/source/report.txt"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "keep_both",
        directory: "merge",
        mismatch: "overwrite",
      },
      runtimeResolution: "keep_both",
      mutateAfterResolve: (fileSystem) => {
        fileSystem.addFile("/target/report copy.txt", { size: 4 });
      },
    });

    expect(result.runtimeConflicts).toHaveLength(1);
    expect(result.runtimeConflicts[0]?.reason).toBe("destination_created");
    expect(result.result?.status).toBe("completed");
    expect(snapshotRelevantTree(result.fileSystem)).toEqual({
      "/source": dir(),
      "/source/report.txt": file(5),
      "/target": dir(),
      "/target/report copy.txt": file(4),
      "/target/report copy 2.txt": file(5),
      "/target/report.txt": file(3),
    });
  });

  it("does not re-prompt for folder overwrite when the destination drifts after planning", async () => {
    const result = await runScenario({
      mode: "copy",
      seed: {
        "/source": { kind: "directory" },
        "/source/Folder": { kind: "directory" },
        "/source/Folder/a.txt": { kind: "file", size: 7 },
        "/target": { kind: "directory" },
        "/target/Folder": { kind: "directory" },
        "/target/Folder/stale.txt": { kind: "file", size: 1 },
      },
      sourcePaths: ["/source/Folder"],
      destinationDirectoryPath: "/target",
      policy: {
        file: "overwrite",
        directory: "overwrite",
        mismatch: "overwrite",
      },
      mutateAfterResolve: (fileSystem) => {
        fileSystem.addFile("/target/Folder/late-change.txt", { size: 5 });
      },
    });

    expect(result.runtimeConflicts).toHaveLength(0);
    expect(result.result?.status).toBe("completed");
    expect(snapshotRelevantTree(result.fileSystem)).toEqual({
      "/source": dir(),
      "/source/Folder": dir(),
      "/source/Folder/a.txt": file(7),
      "/target": dir(),
      "/target/Folder": dir(),
      "/target/Folder/a.txt": file(7),
    });
  });
});

async function runScenario(args: {
  mode: CopyPasteMode;
  seed: Record<string, SeedNode>;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy: CopyPastePolicy;
  runtimeResolution?: "overwrite" | "skip" | "keep_both" | "merge" | undefined;
  mutateAfterResolve?: ((fileSystem: MockWriteServiceFileSystem) => void) | undefined;
}) {
  const fileSystem = new MockWriteServiceFileSystem(args.seed);
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-1",
    request: {
      mode: args.mode,
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath,
    },
    fileSystem,
    thresholds: {
      largeBatchItemThreshold: 100,
      largeBatchByteThreshold: 1_000,
    },
  });
  const resolvedNodes = await resolveAnalysisWithPolicy({
    report,
    policy: args.policy,
    fileSystem,
  });
  args.mutateAfterResolve?.(fileSystem);
  const events: CopyPasteProgressEvent[] = [];
  const runtimeConflicts: CopyPasteRuntimeConflict[] = [];

  await executeCopyPasteFromAnalysis({
    operationId: "copy-op-1",
    report,
    mode: args.mode,
    policy: args.policy,
    fileSystem,
    now: () => new Date("2026-03-11T00:00:00.000Z"),
    signal: new AbortController().signal,
    resolvedNodes,
    emit: (event) => events.push(event),
    requestResolution: async (conflict) => {
      runtimeConflicts.push(conflict);
      return args.runtimeResolution ?? "skip";
    },
  });

  return {
    fileSystem,
    runtimeConflicts,
    result: [...events].reverse().find((event) => event.result)?.result ?? null,
  };
}

function snapshotRelevantTree(
  fileSystem: MockWriteServiceFileSystem,
): Record<string, MockFileSystemSnapshotEntry> {
  return Object.fromEntries(
    Object.entries(snapshotMockFileSystem(fileSystem)).filter(
      ([path]) =>
        path === "/source" ||
        path.startsWith("/source/") ||
        path === "/target" ||
        path.startsWith("/target/"),
    ),
  );
}

function dir(mode = 0o755): MockFileSystemSnapshotEntry {
  return { kind: "directory", mode };
}

function file(size: number, mode = 0o644): MockFileSystemSnapshotEntry {
  return { kind: "file", size, mode };
}

function createKeepBothRegressionScenarios(): MatrixScenario[] {
  const fullFolderSeed = {
    "/source": { kind: "directory" },
    "/source/x": { kind: "directory" },
    "/source/x/a.txt": { kind: "file", size: 1 },
    "/source/x/nested": { kind: "directory" },
    "/source/x/nested/b.txt": { kind: "file", size: 2 },
    "/target": { kind: "directory" },
  } satisfies Record<string, SeedNode>;
  const identicalDestinationSeed = {
    ...fullFolderSeed,
    "/target/x": { kind: "directory" },
    "/target/x/a.txt": { kind: "file", size: 1 },
    "/target/x/nested": { kind: "directory" },
    "/target/x/nested/b.txt": { kind: "file", size: 2 },
  } satisfies Record<string, SeedNode>;
  const emptyDestinationSeed = {
    ...fullFolderSeed,
    "/target/x": { kind: "directory" },
  } satisfies Record<string, SeedNode>;

  return [
    createKeepBothScenario({
      name: "copies an identical folder tree into a duplicate folder without false live-change prompts",
      mode: "copy",
      seed: identicalDestinationSeed,
    }),
    createKeepBothScenario({
      name: "cuts an identical folder tree into a duplicate folder without false live-change prompts",
      mode: "cut",
      seed: identicalDestinationSeed,
    }),
    createKeepBothScenario({
      name: "copies a full folder into a sibling of an existing empty same-name folder",
      mode: "copy",
      seed: emptyDestinationSeed,
    }),
    createKeepBothScenario({
      name: "cuts a full folder into a sibling of an existing empty same-name folder",
      mode: "cut",
      seed: emptyDestinationSeed,
    }),
  ];
}

function createKeepBothScenario(args: {
  name: string;
  mode: CopyPasteMode;
  seed: Record<string, SeedNode>;
}): MatrixScenario {
  const expectedSourceTree =
    args.mode === "copy"
      ? {
          "/source": dir(),
          "/source/x": dir(),
          "/source/x/a.txt": file(1),
          "/source/x/nested": dir(),
          "/source/x/nested/b.txt": file(2),
        }
      : {
          "/source": dir(),
        };
  const expectedTargetTree = {
    "/target": dir(),
    "/target/x": dir(),
    ...(args.seed["/target/x/a.txt"] ? { "/target/x/a.txt": file(1) } : {}),
    ...(args.seed["/target/x/nested"] ? { "/target/x/nested": dir() } : {}),
    ...(args.seed["/target/x/nested/b.txt"] ? { "/target/x/nested/b.txt": file(2) } : {}),
    "/target/x copy": dir(),
    "/target/x copy/a.txt": file(1),
    "/target/x copy/nested": dir(),
    "/target/x copy/nested/b.txt": file(2),
  };

  return {
    name: args.name,
    mode: args.mode,
    seed: args.seed,
    sourcePaths: ["/source/x"],
    destinationDirectoryPath: "/target",
    policy: {
      file: "overwrite",
      directory: "keep_both",
      mismatch: "overwrite",
    },
    expectedStatus: "completed",
    expectedRuntimeConflictCount: 0,
    expectedSnapshot: {
      ...expectedSourceTree,
      ...expectedTargetTree,
    },
  };
}

function createDirectoryPolicyMatrixScenarios(): MatrixScenario[] {
  const scenarios: MatrixScenario[] = [];
  for (const mode of ["copy", "cut"] as const) {
    scenarios.push(
      createDirectoryPolicyScenario(mode, "merge"),
      createDirectoryPolicyScenario(mode, "overwrite"),
      createDirectoryPolicyScenario(mode, "skip"),
      createDirectoryPolicyScenario(mode, "keep_both"),
    );
  }
  return scenarios;
}

function createDirectoryPolicyScenario(
  mode: CopyPasteMode,
  directoryPolicy: CopyPastePolicy["directory"],
): MatrixScenario {
  const baseSeed = {
    "/source": { kind: "directory" },
    "/source/Folder": { kind: "directory" },
    "/source/Folder/new.txt": { kind: "file", size: 1 },
    "/source/Folder/shared.txt": { kind: "file", size: 8, mode: 0o755 },
    "/source/Folder/nested": { kind: "directory" },
    "/source/Folder/nested/inside.txt": { kind: "file", size: 4 },
    "/target": { kind: "directory" },
    "/target/Folder": { kind: "directory" },
    "/target/Folder/shared.txt": { kind: "file", size: 2, mode: 0o600 },
    "/target/Folder/target-only.txt": { kind: "file", size: 3 },
    "/target/Folder/nested": { kind: "directory" },
    "/target/Folder/nested/inside.txt": { kind: "file", size: 1 },
    "/target/Folder/nested/target-only-nested.txt": { kind: "file", size: 9 },
  } satisfies Record<string, SeedNode>;
  const expectedSource =
    mode === "copy"
      ? {
          "/source": dir(),
          "/source/Folder": dir(),
          "/source/Folder/new.txt": file(1),
          "/source/Folder/shared.txt": file(8, 0o755),
          "/source/Folder/nested": dir(),
          "/source/Folder/nested/inside.txt": file(4),
        }
      : directoryPolicy === "skip"
        ? {
            "/source": dir(),
            "/source/Folder": dir(),
            "/source/Folder/new.txt": file(1),
            "/source/Folder/shared.txt": file(8, 0o755),
            "/source/Folder/nested": dir(),
            "/source/Folder/nested/inside.txt": file(4),
          }
        : {
            "/source": dir(),
          };

  const expectedTargetByPolicy = {
    merge: {
      "/target": dir(),
      "/target/Folder": dir(),
      "/target/Folder/new.txt": file(1),
      "/target/Folder/shared.txt": file(8, 0o755),
      "/target/Folder/target-only.txt": file(3),
      "/target/Folder/nested": dir(),
      "/target/Folder/nested/inside.txt": file(4),
      "/target/Folder/nested/target-only-nested.txt": file(9),
    },
    overwrite: {
      "/target": dir(),
      "/target/Folder": dir(),
      "/target/Folder/new.txt": file(1),
      "/target/Folder/shared.txt": file(8, 0o755),
      "/target/Folder/nested": dir(),
      "/target/Folder/nested/inside.txt": file(4),
    },
    skip: {
      "/target": dir(),
      "/target/Folder": dir(),
      "/target/Folder/shared.txt": file(2, 0o600),
      "/target/Folder/target-only.txt": file(3),
      "/target/Folder/nested": dir(),
      "/target/Folder/nested/inside.txt": file(1),
      "/target/Folder/nested/target-only-nested.txt": file(9),
    },
    keep_both: {
      "/target": dir(),
      "/target/Folder": dir(),
      "/target/Folder/shared.txt": file(2, 0o600),
      "/target/Folder/target-only.txt": file(3),
      "/target/Folder/nested": dir(),
      "/target/Folder/nested/inside.txt": file(1),
      "/target/Folder/nested/target-only-nested.txt": file(9),
      "/target/Folder copy": dir(),
      "/target/Folder copy/new.txt": file(1),
      "/target/Folder copy/shared.txt": file(8, 0o755),
      "/target/Folder copy/nested": dir(),
      "/target/Folder copy/nested/inside.txt": file(4),
    },
  } satisfies Record<CopyPastePolicy["directory"], Record<string, MockFileSystemSnapshotEntry>>;

  return {
    name: `${mode} applies directory policy ${directoryPolicy} to the full subtree consistently`,
    mode,
    seed: baseSeed,
    sourcePaths: ["/source/Folder"],
    destinationDirectoryPath: "/target",
    policy: {
      file: "overwrite",
      directory: directoryPolicy,
      mismatch: "overwrite",
    },
    expectedStatus: directoryPolicy === "skip" ? "partial" : "completed",
    expectedRuntimeConflictCount: 0,
    expectedSnapshot: {
      ...expectedSource,
      ...expectedTargetByPolicy[directoryPolicy],
    },
  };
}

function createFilePolicyMatrixScenarios(): MatrixScenario[] {
  const scenarios: MatrixScenario[] = [];
  for (const mode of ["copy", "cut"] as const) {
    scenarios.push(
      createFilePolicyScenario(mode, "overwrite"),
      createFilePolicyScenario(mode, "skip"),
      createFilePolicyScenario(mode, "keep_both"),
    );
  }
  return scenarios;
}

function createFilePolicyScenario(
  mode: CopyPasteMode,
  filePolicy: CopyPastePolicy["file"],
): MatrixScenario {
  const expectedSource =
    mode === "copy" || filePolicy === "skip"
      ? {
          "/source": dir(),
          "/source/report.txt": file(5, 0o755),
        }
      : {
          "/source": dir(),
        };
  const expectedTargetByPolicy = {
    overwrite: {
      "/target": dir(),
      "/target/report.txt": file(5, 0o755),
    },
    skip: {
      "/target": dir(),
      "/target/report.txt": file(2, 0o600),
    },
    keep_both: {
      "/target": dir(),
      "/target/report copy.txt": file(5, 0o755),
      "/target/report.txt": file(2, 0o600),
    },
  } satisfies Record<CopyPastePolicy["file"], Record<string, MockFileSystemSnapshotEntry>>;

  return {
    name: `${mode} applies file policy ${filePolicy} deterministically`,
    mode,
    seed: {
      "/source": { kind: "directory" },
      "/source/report.txt": { kind: "file", size: 5, mode: 0o755 },
      "/target": { kind: "directory" },
      "/target/report.txt": { kind: "file", size: 2, mode: 0o600 },
    },
    sourcePaths: ["/source/report.txt"],
    destinationDirectoryPath: "/target",
    policy: {
      file: filePolicy,
      directory: "merge",
      mismatch: "overwrite",
    },
    expectedStatus: filePolicy === "skip" ? "partial" : "completed",
    expectedRuntimeConflictCount: 0,
    expectedSnapshot: {
      ...expectedSource,
      ...expectedTargetByPolicy[filePolicy],
    },
  };
}

function createMismatchPolicyMatrixScenarios(): MatrixScenario[] {
  const scenarios: MatrixScenario[] = [];
  for (const mode of ["copy", "cut"] as const) {
    scenarios.push(
      createMismatchFileOverDirectoryScenario(mode, "overwrite"),
      createMismatchFileOverDirectoryScenario(mode, "skip"),
      createMismatchFileOverDirectoryScenario(mode, "keep_both"),
      createMismatchDirectoryOverFileScenario(mode, "overwrite"),
      createMismatchDirectoryOverFileScenario(mode, "skip"),
      createMismatchDirectoryOverFileScenario(mode, "keep_both"),
    );
  }
  return scenarios;
}

function createMismatchFileOverDirectoryScenario(
  mode: CopyPasteMode,
  mismatchPolicy: CopyPastePolicy["mismatch"],
): MatrixScenario {
  const expectedSource =
    mode === "copy" || mismatchPolicy === "skip"
      ? {
          "/source": dir(),
          "/source/item": file(7),
        }
      : {
          "/source": dir(),
        };
  const expectedTargetByPolicy = {
    overwrite: {
      "/target": dir(),
      "/target/item": file(7),
    },
    skip: {
      "/target": dir(),
      "/target/item": dir(),
    },
    keep_both: {
      "/target": dir(),
      "/target/item": dir(),
      "/target/item copy": file(7),
    },
  } satisfies Record<CopyPastePolicy["mismatch"], Record<string, MockFileSystemSnapshotEntry>>;

  return {
    name: `${mode} applies mismatch policy ${mismatchPolicy} when a file collides with a directory`,
    mode,
    seed: {
      "/source": { kind: "directory" },
      "/source/item": { kind: "file", size: 7 },
      "/target": { kind: "directory" },
      "/target/item": { kind: "directory" },
    },
    sourcePaths: ["/source/item"],
    destinationDirectoryPath: "/target",
    policy: {
      file: "overwrite",
      directory: "merge",
      mismatch: mismatchPolicy,
    },
    expectedStatus: mismatchPolicy === "skip" ? "partial" : "completed",
    expectedRuntimeConflictCount: 0,
    expectedSnapshot: {
      ...expectedSource,
      ...expectedTargetByPolicy[mismatchPolicy],
    },
  };
}

function createMismatchDirectoryOverFileScenario(
  mode: CopyPasteMode,
  mismatchPolicy: CopyPastePolicy["mismatch"],
): MatrixScenario {
  const expectedSource =
    mode === "copy" || mismatchPolicy === "skip"
      ? {
          "/source": dir(),
          "/source/item": dir(),
          "/source/item/inside.txt": file(6),
        }
      : {
          "/source": dir(),
        };
  const expectedTargetByPolicy = {
    overwrite: {
      "/target": dir(),
      "/target/item": dir(),
      "/target/item/inside.txt": file(6),
    },
    skip: {
      "/target": dir(),
      "/target/item": file(2),
    },
    keep_both: {
      "/target": dir(),
      "/target/item": file(2),
      "/target/item copy": dir(),
      "/target/item copy/inside.txt": file(6),
    },
  } satisfies Record<CopyPastePolicy["mismatch"], Record<string, MockFileSystemSnapshotEntry>>;

  return {
    name: `${mode} applies mismatch policy ${mismatchPolicy} when a directory collides with a file`,
    mode,
    seed: {
      "/source": { kind: "directory" },
      "/source/item": { kind: "directory" },
      "/source/item/inside.txt": { kind: "file", size: 6 },
      "/target": { kind: "directory" },
      "/target/item": { kind: "file", size: 2 },
    },
    sourcePaths: ["/source/item"],
    destinationDirectoryPath: "/target",
    policy: {
      file: "overwrite",
      directory: "merge",
      mismatch: mismatchPolicy,
    },
    expectedStatus: mismatchPolicy === "skip" ? "partial" : "completed",
    expectedRuntimeConflictCount: 0,
    expectedSnapshot: {
      ...expectedSource,
      ...expectedTargetByPolicy[mismatchPolicy],
    },
  };
}
