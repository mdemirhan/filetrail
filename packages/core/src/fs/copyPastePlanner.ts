import { basename, dirname, extname, join, resolve } from "node:path";

import type {
  CopyPastePlan,
  CopyPasteRequest,
  ExecutionStep,
  InternalCopyPastePlan,
  PlannedTopLevelItem,
  RequiredCopyPasteRequest,
  WriteServiceFileSystem,
  WriteServiceStats,
} from "./writeServiceTypes";

export function normalizeCopyPasteRequest(request: CopyPasteRequest): RequiredCopyPasteRequest {
  return {
    mode: request.mode,
    sourcePaths: Array.from(new Set(request.sourcePaths.map((path) => resolve(path)))),
    destinationDirectoryPath: resolve(request.destinationDirectoryPath),
    conflictResolution: request.conflictResolution ?? "error",
  };
}

export async function buildCopyPastePlan(
  request: RequiredCopyPasteRequest,
  fileSystem: WriteServiceFileSystem,
  thresholds: {
    largeBatchItemThreshold: number;
    largeBatchByteThreshold: number;
  },
): Promise<InternalCopyPastePlan> {
  const issues: InternalCopyPastePlan["issues"] = [];
  const conflicts: InternalCopyPastePlan["conflicts"] = [];
  const warnings: InternalCopyPastePlan["warnings"] = [];
  const items: PlannedTopLevelItem[] = [];
  let totalItemCount = 0;
  let totalBytes = 0;

  const destinationPath = resolve(request.destinationDirectoryPath);
  let destinationRealPath: string | null = null;
  try {
    const destinationStats = await fileSystem.stat(destinationPath);
    if (!destinationStats.isDirectory()) {
      issues.push({
        code: "destination_not_directory",
        message: "Destination must be an existing directory.",
        sourcePath: null,
        destinationPath,
      });
    } else {
      destinationRealPath = await fileSystem.realpath(destinationPath);
    }
  } catch {
    issues.push({
      code: "destination_missing",
      message: "Destination does not exist.",
      sourcePath: null,
      destinationPath,
    });
  }

  for (const sourcePathInput of request.sourcePaths) {
    const sourcePath = resolve(sourcePathInput);
    const initialDestinationItemPath = join(destinationPath, basename(sourcePath));
    let sourceStats: WriteServiceStats;
    try {
      sourceStats = await fileSystem.lstat(sourcePath);
    } catch {
      issues.push({
        code: "source_missing",
        message: `Source does not exist: ${sourcePath}`,
        sourcePath,
        destinationPath: initialDestinationItemPath,
      });
      continue;
    }

    const kind = sourceStats.isSymbolicLink()
      ? "symlink"
      : sourceStats.isDirectory()
        ? "directory"
        : "file";
    const item: PlannedTopLevelItem = {
      sourcePath,
      destinationPath: initialDestinationItemPath,
      kind,
      status: "ready",
      sizeBytes: kind === "file" ? sourceStats.size : null,
      sourceRealPath: null,
      destinationExists: false,
      steps: [],
      itemCount: 0,
    };

    if (request.mode === "copy" && dirname(sourcePath) === destinationPath) {
      item.destinationPath = await resolveDuplicateDestinationPath(
        sourcePath,
        destinationPath,
        fileSystem,
      );
    }

    const destinationItemPath = item.destinationPath;

    if (sourcePath === destinationItemPath) {
      item.status = "blocked";
      items.push(item);
      issues.push({
        code: "same_path",
        message: `Cannot paste ${sourcePath} onto itself.`,
        sourcePath,
        destinationPath: destinationItemPath,
      });
      continue;
    }

    if (destinationRealPath && kind === "directory") {
      try {
        const sourceRealPath = await fileSystem.realpath(sourcePath);
        item.sourceRealPath = sourceRealPath;
        if (
          destinationRealPath === sourceRealPath ||
          destinationRealPath.startsWith(`${sourceRealPath}/`)
        ) {
          item.status = "blocked";
          items.push(item);
          issues.push({
            code: "parent_into_child",
            message: `Cannot paste ${sourcePath} into its own descendant.`,
            sourcePath,
            destinationPath: destinationItemPath,
          });
          continue;
        }
      } catch {
        item.status = "blocked";
        items.push(item);
        issues.push({
          code: "source_missing",
          message: `Source does not exist: ${sourcePath}`,
          sourcePath,
          destinationPath: destinationItemPath,
        });
        continue;
      }
    }

    item.destinationExists = await pathExists(destinationItemPath, fileSystem);
    if (item.destinationExists) {
      item.status = "conflict";
      conflicts.push({
        sourcePath,
        destinationPath: destinationItemPath,
        reason: "destination_exists",
      });
    } else {
      const executionPlan = await buildExecutionPlan(sourcePath, destinationItemPath, fileSystem);
      item.steps = executionPlan.steps;
      item.itemCount = executionPlan.itemCount;
      item.sizeBytes = executionPlan.sizeBytes;
      totalItemCount += executionPlan.itemCount;
      totalBytes += executionPlan.totalBytes;
    }

    items.push(item);
  }

  if (
    totalItemCount > thresholds.largeBatchItemThreshold ||
    totalBytes > thresholds.largeBatchByteThreshold
  ) {
    warnings.push({
      code: "large_batch",
      message: `This operation will write ${totalItemCount} items.`,
    });
  }
  if (request.mode === "cut") {
    warnings.push({
      code: "cut_requires_delete",
      message: "Cut/Paste removes the original items after the copy succeeds.",
    });
  }

  return {
    items,
    conflicts,
    issues,
    warnings,
    totalItemCount,
    totalBytes,
  };
}

export function toPublicPlan(
  plan: InternalCopyPastePlan,
  request: RequiredCopyPasteRequest,
): CopyPastePlan {
  const requiresConfirmation = {
    largeBatch: plan.warnings.some((warning) => warning.code === "large_batch"),
    cutDelete: request.mode === "cut",
  };
  const skippedConflictCount = request.conflictResolution === "skip" ? plan.conflicts.length : 0;
  const hasBlockingIssues = plan.issues.length > 0;
  const hasUnresolvedConflicts = plan.conflicts.length > 0 && request.conflictResolution !== "skip";

  return {
    mode: request.mode,
    sourcePaths: request.sourcePaths,
    destinationDirectoryPath: request.destinationDirectoryPath,
    conflictResolution: request.conflictResolution,
    items: plan.items.map((item) => ({
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
      kind: item.kind,
      status: item.status,
      sizeBytes: item.sizeBytes,
    })),
    conflicts: plan.conflicts,
    issues: plan.issues,
    warnings: plan.warnings,
    requiresConfirmation,
    summary: {
      topLevelItemCount: plan.items.length,
      totalItemCount: plan.totalItemCount,
      totalBytes: plan.totalBytes,
      skippedConflictCount,
    },
    canExecute:
      !hasBlockingIssues &&
      !hasUnresolvedConflicts &&
      plan.items.some((item) => item.status === "ready"),
  };
}

async function buildExecutionPlan(
  sourcePath: string,
  destinationPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<{
  steps: ExecutionStep[];
  itemCount: number;
  sizeBytes: number | null;
  totalBytes: number;
}> {
  const sourceStats = await fileSystem.lstat(sourcePath);
  if (sourceStats.isSymbolicLink()) {
    const linkTarget = await fileSystem.readlink(sourcePath);
    return {
      steps: [
        {
          type: "copy_symlink",
          sourcePath,
          destinationPath,
          sizeBytes: 0,
          linkTarget,
        },
      ],
      itemCount: 1,
      sizeBytes: null,
      totalBytes: 0,
    };
  }
  if (sourceStats.isDirectory()) {
    const steps: ExecutionStep[] = [
      {
        type: "mkdir",
        sourcePath,
        destinationPath,
        sizeBytes: 0,
        mode: sourceStats.mode,
      },
    ];
    let itemCount = 1;
    let totalBytes = 0;
    const children = (await fileSystem.readdir(sourcePath)).sort();
    for (const childName of children) {
      const childSourcePath = join(sourcePath, childName);
      const childDestinationPath = join(destinationPath, childName);
      const childPlan = await buildExecutionPlan(childSourcePath, childDestinationPath, fileSystem);
      steps.push(...childPlan.steps);
      itemCount += childPlan.itemCount;
      totalBytes += childPlan.totalBytes;
    }
    return {
      steps,
      itemCount,
      sizeBytes: null,
      totalBytes,
    };
  }
  const fileStats = await fileSystem.stat(sourcePath);
  return {
    steps: [
      {
        type: "copy_file",
        sourcePath,
        destinationPath,
        sizeBytes: fileStats.size,
        mode: fileStats.mode,
      },
    ],
    itemCount: 1,
    sizeBytes: fileStats.size,
    totalBytes: fileStats.size,
  };
}

async function pathExists(path: string, fileSystem: WriteServiceFileSystem): Promise<boolean> {
  try {
    await fileSystem.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveDuplicateDestinationPath(
  sourcePath: string,
  destinationDirectoryPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<string> {
  const sourceName = basename(sourcePath);
  const extension = extname(sourceName);
  const baseName =
    extension.length > 0 ? sourceName.slice(0, sourceName.length - extension.length) : sourceName;

  for (let index = 1; ; index += 1) {
    const duplicateName =
      index === 1 ? `${baseName} copy${extension}` : `${baseName} copy ${index}${extension}`;
    const candidatePath = join(destinationDirectoryPath, duplicateName);
    if (!(await pathExists(candidatePath, fileSystem))) {
      return candidatePath;
    }
  }
}
