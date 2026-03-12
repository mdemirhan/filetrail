import { basename, dirname, join, resolve } from "node:path";

import { captureFingerprint, detectKind } from "./copyPasteFingerprint";
import { resolveDuplicateName } from "./copyPasteNames";
import type {
  CopyPasteAnalysisIssue,
  CopyPasteAnalysisNode,
  CopyPasteAnalysisReport,
  CopyPasteAnalysisRequest,
  CopyPasteAnalysisSummary,
  CopyPasteAnalysisWarning,
  CopyPasteConflictClass,
  CopyPasteNodeKind,
  RequiredCopyPasteAnalysisRequest,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

export function normalizeCopyPasteAnalysisRequest(
  request: CopyPasteAnalysisRequest,
): RequiredCopyPasteAnalysisRequest {
  return {
    mode: request.mode,
    sourcePaths: Array.from(new Set(request.sourcePaths.map((path) => resolve(path)))),
    destinationDirectoryPath: resolve(request.destinationDirectoryPath),
  };
}

export async function buildCopyPasteAnalysisReport(args: {
  analysisId: string;
  request: RequiredCopyPasteAnalysisRequest;
  fileSystem: WriteServiceFileSystem;
  thresholds: {
    largeBatchItemThreshold: number;
    largeBatchByteThreshold: number;
  };
  signal?: AbortSignal;
}): Promise<CopyPasteAnalysisReport> {
  const { analysisId, request, fileSystem, thresholds } = args;
  const issues: CopyPasteAnalysisIssue[] = [];
  const warnings: CopyPasteAnalysisWarning[] = [];
  const nodes: CopyPasteAnalysisNode[] = [];
  const destinationItemCountCache = new Map<string, number | null>();

  const destinationFingerprint = await captureFingerprint(
    fileSystem,
    request.destinationDirectoryPath,
  );
  if (!destinationFingerprint.exists) {
    issues.push({
      code: "destination_missing",
      message: "Destination does not exist.",
      sourcePath: null,
      destinationPath: request.destinationDirectoryPath,
    });
  } else if (destinationFingerprint.kind !== "directory") {
    issues.push({
      code: "destination_not_directory",
      message: "Destination must be an existing directory.",
      sourcePath: null,
      destinationPath: request.destinationDirectoryPath,
    });
  }

  for (const [index, sourcePath] of request.sourcePaths.entries()) {
    args.signal?.throwIfAborted();
    const sourceFingerprint = await captureFingerprint(fileSystem, sourcePath);
    let destinationPath = join(request.destinationDirectoryPath, basename(sourcePath));

    if (request.mode === "copy" && dirname(sourcePath) === request.destinationDirectoryPath) {
      destinationPath = await resolveDuplicateName(
        basename(sourcePath),
        request.destinationDirectoryPath,
        fileSystem,
      );
    }

    if (!sourceFingerprint.exists || sourceFingerprint.kind === "missing") {
      issues.push({
        code: "source_missing",
        message: `Source does not exist: ${sourcePath}`,
        sourcePath,
        destinationPath,
      });
      continue;
    }

    if (sourcePath === destinationPath) {
      issues.push({
        code: "same_path",
        message: `Cannot paste ${sourcePath} onto itself.`,
        sourcePath,
        destinationPath,
      });
      continue;
    }

    if (
      destinationFingerprint.exists &&
      destinationFingerprint.kind === "directory" &&
      sourceFingerprint.kind === "directory"
    ) {
      try {
        const sourceRealPath = await fileSystem.realpath(sourcePath);
        const destinationRealPath = await fileSystem.realpath(request.destinationDirectoryPath);
        if (
          destinationRealPath === sourceRealPath ||
          destinationRealPath.startsWith(`${sourceRealPath}/`)
        ) {
          issues.push({
            code: "parent_into_child",
            message: `Cannot paste ${sourcePath} into its own descendant.`,
            sourcePath,
            destinationPath,
          });
          continue;
        }
      } catch {
        issues.push({
          code: "source_missing",
          message: `Source does not exist: ${sourcePath}`,
          sourcePath,
          destinationPath,
        });
        continue;
      }
    }

    nodes.push(
      await analyzeNode({
        id: `item-${index + 1}`,
        sourcePath,
        destinationPath,
        fileSystem,
        destinationItemCountCache,
        ...(args.signal ? { signal: args.signal } : {}),
      }),
    );
  }

  const summary = summarizeAnalysis(nodes);
  if (
    summary.totalNodeCount > thresholds.largeBatchItemThreshold ||
    (summary.totalBytes ?? 0) > thresholds.largeBatchByteThreshold
  ) {
    warnings.push({
      code: "large_batch",
      message: `This operation will write ${summary.totalNodeCount} items.`,
    });
  }
  if (request.mode === "cut") {
    warnings.push({
      code: "cut_requires_delete",
      message: "Cut/Paste removes the original items after the copy succeeds.",
    });
  }

  return {
    analysisId,
    mode: request.mode,
    sourcePaths: request.sourcePaths,
    destinationDirectoryPath: request.destinationDirectoryPath,
    nodes,
    issues,
    warnings,
    summary,
  };
}

async function analyzeNode(args: {
  id: string;
  sourcePath: string;
  destinationPath: string;
  fileSystem: WriteServiceFileSystem;
  destinationItemCountCache: Map<string, number | null>;
  signal?: AbortSignal;
}): Promise<CopyPasteAnalysisNode> {
  args.signal?.throwIfAborted();
  const sourceFingerprint = await captureFingerprint(args.fileSystem, args.sourcePath);
  const destinationFingerprint = await captureFingerprint(args.fileSystem, args.destinationPath);
  const sourceKind = sourceFingerprint.kind as Exclude<CopyPasteNodeKind, "missing">;
  const destinationKind = destinationFingerprint.kind;
  const conflictClass = resolveConflictClass(sourceKind, destinationKind);
  const disposition = conflictClass === null ? "new" : "conflict";

  const children: CopyPasteAnalysisNode[] = [];
  let totalNodeCount = 1;
  let conflictNodeCount = conflictClass === null ? 0 : 1;

  if (sourceKind === "directory") {
    const sourceChildren = (await args.fileSystem.readdir(args.sourcePath)).sort();
    for (const childName of sourceChildren) {
      args.signal?.throwIfAborted();
      const childSourcePath = join(args.sourcePath, childName);
      const childDestinationPath = join(args.destinationPath, childName);
      const childNode = await analyzeNode({
        id: `${args.id}/${childName}`,
        sourcePath: childSourcePath,
        destinationPath: childDestinationPath,
        fileSystem: args.fileSystem,
        destinationItemCountCache: args.destinationItemCountCache,
        ...(args.signal ? { signal: args.signal } : {}),
      });
      children.push(childNode);
      totalNodeCount += childNode.totalNodeCount;
      conflictNodeCount += childNode.conflictNodeCount;
    }
  }

  let destinationTotalNodeCount: number | null = null;
  if (conflictClass === "directory_conflict") {
    destinationTotalNodeCount = await countDirectoryItems(
      args.fileSystem,
      args.destinationPath,
      args.destinationItemCountCache,
      args.signal,
    );
  }

  return {
    id: args.id,
    sourcePath: args.sourcePath,
    destinationPath: args.destinationPath,
    sourceKind,
    destinationKind,
    disposition,
    conflictClass,
    sourceFingerprint,
    destinationFingerprint,
    children,
    issueCode: null,
    issueMessage: null,
    totalNodeCount,
    conflictNodeCount,
    destinationTotalNodeCount,
  };
}

async function countDirectoryItems(
  fileSystem: WriteServiceFileSystem,
  directoryPath: string,
  cache: Map<string, number | null>,
  signal?: AbortSignal,
): Promise<number | null> {
  if (cache.has(directoryPath)) {
    return cache.get(directoryPath) ?? null;
  }

  try {
    signal?.throwIfAborted();
    const entries = await fileSystem.readdir(directoryPath);
    let count = entries.length;
    for (const entry of entries) {
      signal?.throwIfAborted();
      const entryPath = join(directoryPath, entry);
      const stats = await fileSystem.lstat(entryPath);
      if (stats.isDirectory()) {
        const nestedCount = await countDirectoryItems(fileSystem, entryPath, cache, signal);
        if (nestedCount === null) {
          cache.set(directoryPath, null);
          return null;
        }
        count += nestedCount;
      }
    }
    cache.set(directoryPath, count);
    return count;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    cache.set(directoryPath, null);
    return null;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function resolveConflictClass(
  sourceKind: Exclude<CopyPasteNodeKind, "missing">,
  destinationKind: CopyPasteNodeKind,
): CopyPasteConflictClass | null {
  if (destinationKind === "missing") {
    return null;
  }
  if (sourceKind === "directory" && destinationKind === "directory") {
    return "directory_conflict";
  }
  if (
    sourceKind !== "directory" &&
    destinationKind !== "directory" &&
    sourceKind === destinationKind
  ) {
    return "file_conflict";
  }
  return "type_mismatch";
}

function summarizeAnalysis(nodes: CopyPasteAnalysisNode[]): CopyPasteAnalysisSummary {
  const summary: CopyPasteAnalysisSummary = {
    topLevelItemCount: nodes.length,
    totalNodeCount: 0,
    totalBytes: 0,
    fileConflictCount: 0,
    directoryConflictCount: 0,
    mismatchConflictCount: 0,
    blockedCount: 0,
  };
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    summary.totalNodeCount += 1;
    if (node.sourceFingerprint.size !== null) {
      summary.totalBytes = (summary.totalBytes ?? 0) + node.sourceFingerprint.size;
    }
    if (node.conflictClass === "file_conflict") {
      summary.fileConflictCount += 1;
    } else if (node.conflictClass === "directory_conflict") {
      summary.directoryConflictCount += 1;
    } else if (node.conflictClass === "type_mismatch") {
      summary.mismatchConflictCount += 1;
    }
    stack.push(...node.children);
  }
  return summary;
}
