import { basename, dirname, join, resolve } from "node:path";

import {
  captureFingerprint,
  detectKind,
  findSourceRelation,
  isSameExistingItem,
} from "./copyPasteFingerprint";
import { destinationPathKey, detectCaseSensitivity, resolveDuplicateName } from "./copyPasteNames";
import type {
  CopyPasteAnalysisIssue,
  CopyPasteAnalysisNode,
  CopyPasteAnalysisReport,
  CopyPasteAnalysisRequest,
  CopyPasteAnalysisSummary,
  CopyPasteAnalysisWarning,
  CopyPasteConflictClass,
  CopyPasteDestinationOnlySummary,
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
  const destinationFingerprint = await captureFingerprint(
    fileSystem,
    request.destinationDirectoryPath,
  );
  // Asked once per analysis: everything pasted lands on the destination folder's volume.
  const caseSensitive =
    destinationFingerprint.kind === "directory"
      ? await detectCaseSensitivity(fileSystem, request.destinationDirectoryPath)
      : false;
  const pathKey = (path: string) => destinationPathKey(path, caseSensitive);
  const destinationScanCache: DestinationScanCache = {
    counts: new Map(),
    entries: new Map(),
    pathKey,
  };
  // APFS is case- and normalization-insensitive by default, so "report.pdf"
  // from one folder and "Report.pdf" from another land on the same entry.
  const claimedDestinationNames = new Map<string, string>();

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

  // The destination folder may be reached through another path (a symlinked folder or a
  // different letter case), so "same folder" compares identities, not just strings.
  const sameDirectoryCache = new Map<string, boolean>();
  const isDestinationDirectory = async (directoryPath: string): Promise<boolean> => {
    if (directoryPath === request.destinationDirectoryPath) {
      return true;
    }
    const cached = sameDirectoryCache.get(directoryPath);
    if (cached !== undefined) {
      return cached;
    }
    const same = isSameExistingItem(
      await captureFingerprint(fileSystem, directoryPath),
      destinationFingerprint,
    );
    sameDirectoryCache.set(directoryPath, same);
    return same;
  };

  for (const [index, sourcePath] of request.sourcePaths.entries()) {
    args.signal?.throwIfAborted();
    const sourceFingerprint = await captureFingerprint(fileSystem, sourcePath);
    let destinationPath = join(request.destinationDirectoryPath, basename(sourcePath));
    const pastingIntoSourceFolder = await isDestinationDirectory(dirname(sourcePath));

    if (request.mode === "copy" && pastingIntoSourceFolder) {
      destinationPath = await resolveDuplicateName(
        basename(sourcePath),
        request.destinationDirectoryPath,
        fileSystem,
        undefined,
        { isDirectory: sourceFingerprint.kind === "directory", caseSensitive },
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

    if (
      sourcePath === destinationPath ||
      (request.mode === "cut" && pastingIntoSourceFolder) ||
      isSameExistingItem(sourceFingerprint, await captureFingerprint(fileSystem, destinationPath))
    ) {
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

    const destinationNameKey = pathKey(basename(destinationPath));
    const claimingSourcePath = claimedDestinationNames.get(destinationNameKey);
    if (claimingSourcePath !== undefined) {
      issues.push({
        code: "duplicate_destination_name",
        message: `${sourcePath} and ${claimingSourcePath} would both be pasted as ${basename(destinationPath)}.`,
        sourcePath,
        destinationPath,
      });
      continue;
    }
    claimedDestinationNames.set(destinationNameKey, sourcePath);

    const node = await analyzeNode({
      id: `item-${index + 1}`,
      sourcePath,
      destinationPath,
      fileSystem,
      destinationScanCache,
      ...(args.signal ? { signal: args.signal } : {}),
    });
    node.replaceBlockedReason = await findReplaceBlockedReason(node, fileSystem);
    nodes.push(node);
  }

  await annotateKeepBothNames(nodes, fileSystem, caseSensitive, args.signal);
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
    destinationCaseSensitive: caseSensitive,
  };
}

async function analyzeNode(args: {
  id: string;
  sourcePath: string;
  destinationPath: string;
  fileSystem: WriteServiceFileSystem;
  destinationScanCache: DestinationScanCache;
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
        destinationScanCache: args.destinationScanCache,
        ...(args.signal ? { signal: args.signal } : {}),
      });
      children.push(childNode);
      totalNodeCount += childNode.totalNodeCount;
      conflictNodeCount += childNode.conflictNodeCount;
    }
  }

  let destinationTotalNodeCount: number | null = null;
  let destinationOnly: CopyPasteDestinationOnlySummary | null = null;
  // An existing folder in the way: what only it holds is kept by Merge and lost by Replace.
  if (conflictClass !== null && destinationKind === "directory") {
    destinationTotalNodeCount = await countDirectoryItems(
      args.fileSystem,
      args.destinationPath,
      args.destinationScanCache,
      args.signal,
    );
    destinationOnly = await summarizeDestinationOnly({
      fileSystem: args.fileSystem,
      destinationPath: args.destinationPath,
      sourceChildren: conflictClass === "directory_conflict" ? children : [],
      cache: args.destinationScanCache,
      ...(args.signal ? { signal: args.signal } : {}),
    });
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
    keepBothDestinationPath: null,
    destinationOnly,
    replaceBlockedReason: null,
  };
}

const DESTINATION_ONLY_SAMPLE_LIMIT = 5;

async function summarizeDestinationOnly(args: {
  fileSystem: WriteServiceFileSystem;
  destinationPath: string;
  sourceChildren: CopyPasteAnalysisNode[];
  cache: DestinationScanCache;
  signal?: AbortSignal;
}): Promise<CopyPasteDestinationOnlySummary | null> {
  const summary: CopyPasteDestinationOnlySummary = { count: 0, samplePaths: [] };
  const complete = await collectDestinationOnly(
    args.destinationPath,
    args.sourceChildren,
    "",
    summary,
    args,
  );
  return complete ? summary : null;
}

// Walks the existing folder next to the pasted one. Entries with no pasted counterpart
// (or a pasted file standing in for a folder) exist only at the destination; folders
// present on both sides are compared recursively. Returns false when unreadable.
async function collectDestinationOnly(
  destinationPath: string,
  sourceChildren: CopyPasteAnalysisNode[],
  prefix: string,
  summary: CopyPasteDestinationOnlySummary,
  context: {
    fileSystem: WriteServiceFileSystem;
    cache: DestinationScanCache;
    signal?: AbortSignal;
  },
): Promise<boolean> {
  let entries: string[];
  try {
    entries = await readDestinationEntries(context.fileSystem, destinationPath, context.cache);
  } catch {
    return false;
  }
  const sourceByName = new Map(
    sourceChildren.map((child) => [context.cache.pathKey(basename(child.sourcePath)), child]),
  );
  for (const entry of entries) {
    context.signal?.throwIfAborted();
    const entryPath = join(destinationPath, entry);
    const counterpart = sourceByName.get(context.cache.pathKey(entry));
    if (counterpart?.sourceKind === "directory" && counterpart.destinationKind === "directory") {
      // Nested folders are analyzed first; reuse their summary instead of walking again.
      if (counterpart.destinationOnly !== null) {
        summary.count += counterpart.destinationOnly.count;
        for (const samplePath of counterpart.destinationOnly.samplePaths) {
          if (summary.samplePaths.length < DESTINATION_ONLY_SAMPLE_LIMIT) {
            summary.samplePaths.push(`${prefix}${entry}/${samplePath}`);
          }
        }
        continue;
      }
      const complete = await collectDestinationOnly(
        entryPath,
        counterpart.children,
        `${prefix}${entry}/`,
        summary,
        context,
      );
      if (!complete) {
        return false;
      }
      continue;
    }
    if (counterpart !== undefined && counterpart.destinationKind !== "directory") {
      continue;
    }
    summary.count += 1;
    if (summary.samplePaths.length < DESTINATION_ONLY_SAMPLE_LIMIT) {
      summary.samplePaths.push(`${prefix}${entry}`);
    }
    try {
      if ((await context.fileSystem.lstat(entryPath)).isDirectory()) {
        const nestedCount = await countDirectoryItems(
          context.fileSystem,
          entryPath,
          context.cache,
          context.signal,
        );
        if (nestedCount === null) {
          return false;
        }
        summary.count += nestedCount;
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      return false;
    }
  }
  return true;
}

// The names "Keep Both" would use, reserved across the items of each folder the same
// way the paste itself will pick them.
async function annotateKeepBothNames(
  nodes: CopyPasteAnalysisNode[],
  fileSystem: WriteServiceFileSystem,
  caseSensitive: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const reservedPaths = new Set(
    nodes.map((node) => destinationPathKey(node.destinationPath, caseSensitive)),
  );
  for (const node of nodes) {
    signal?.throwIfAborted();
    if (node.conflictClass !== null) {
      node.keepBothDestinationPath = await resolveDuplicateName(
        basename(node.sourcePath),
        dirname(node.destinationPath),
        fileSystem,
        reservedPaths,
        { isDirectory: node.sourceKind === "directory", caseSensitive },
      );
      reservedPaths.add(destinationPathKey(node.keepBothDestinationPath, caseSensitive));
    }
    if (node.conflictClass === "directory_conflict") {
      await annotateKeepBothNames(node.children, fileSystem, caseSensitive, signal);
    }
  }
}

// Replacing an item that is, or contains, the item being pasted would destroy the source.
async function findReplaceBlockedReason(
  node: CopyPasteAnalysisNode,
  fileSystem: WriteServiceFileSystem,
): Promise<string | null> {
  if (node.conflictClass === null) {
    return null;
  }
  const relation = await findSourceRelation(
    fileSystem,
    node.sourcePath,
    node.destinationPath,
    node.destinationFingerprint,
  );
  return relation === "same"
    ? "It is the item being pasted."
    : relation === "contains"
      ? "It contains the item being pasted."
      : null;
}

type DestinationScanCache = {
  // Item counts of existing folders (null when unreadable).
  counts: Map<string, number | null>;
  // Sorted folder listings, so each existing folder is read once per analysis.
  entries: Map<string, string[]>;
  // How names are compared on the destination volume (see `destinationPathKey`).
  pathKey: (path: string) => string;
};

async function readDestinationEntries(
  fileSystem: WriteServiceFileSystem,
  directoryPath: string,
  cache: DestinationScanCache,
): Promise<string[]> {
  const cached = cache.entries.get(directoryPath);
  if (cached) {
    return cached;
  }
  const entries = (await fileSystem.readdir(directoryPath)).sort();
  cache.entries.set(directoryPath, entries);
  return entries;
}

async function countDirectoryItems(
  fileSystem: WriteServiceFileSystem,
  directoryPath: string,
  cache: DestinationScanCache,
  signal?: AbortSignal,
): Promise<number | null> {
  if (cache.counts.has(directoryPath)) {
    return cache.counts.get(directoryPath) ?? null;
  }

  try {
    signal?.throwIfAborted();
    const entries = await readDestinationEntries(fileSystem, directoryPath, cache);
    let count = entries.length;
    for (const entry of entries) {
      signal?.throwIfAborted();
      const entryPath = join(directoryPath, entry);
      const stats = await fileSystem.lstat(entryPath);
      if (stats.isDirectory()) {
        const nestedCount = await countDirectoryItems(fileSystem, entryPath, cache, signal);
        if (nestedCount === null) {
          cache.counts.set(directoryPath, null);
          return null;
        }
        count += nestedCount;
      }
    }
    cache.counts.set(directoryPath, count);
    return count;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    cache.counts.set(directoryPath, null);
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
