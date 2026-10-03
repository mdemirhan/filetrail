import { basename, dirname, join, resolve } from "node:path";

import { describeCopyPasteError } from "./copyPasteErrors";
import {
  captureFingerprint,
  captureFolderFingerprint,
  detectKind,
  findSourceRelation,
  holdsAnyOf,
  isSameExistingItem,
  realItemPaths,
} from "./copyPasteFingerprint";
import {
  destinationPathKey,
  detectCaseSensitivity,
  isAppleDoubleCompanionName,
  isFolderViewFile,
  isPackageFolder,
  resolveDuplicateName,
} from "./copyPasteNames";
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
  NodeFingerprint,
  RequiredCopyPasteAnalysisRequest,
  WriteServiceFileSystem,
} from "./writeServiceTypes";

export function normalizeCopyPasteAnalysisRequest(
  request: CopyPasteAnalysisRequest,
): RequiredCopyPasteAnalysisRequest {
  return {
    mode: request.mode,
    sourcePaths: withoutNestedPaths(
      Array.from(new Set(request.sourcePaths.map((path) => resolve(path)))),
    ),
    destinationDirectoryPath: resolve(request.destinationDirectoryPath),
  };
}

// A folder and an item inside it picked together (Select All in search results, say): the
// item goes with its folder. Pasted on its own as well, it would be copied twice, or moved
// out of the folder before (or after) the folder itself.
function withoutNestedPaths(paths: string[]): string[] {
  const picked = new Set(paths);
  return paths.filter((path) => {
    let child = path;
    let parent = dirname(child);
    while (parent !== child) {
      if (picked.has(parent)) {
        return false;
      }
      child = parent;
      parent = dirname(child);
    }
    return true;
  });
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
  // A symlink to a folder is pasted into as that folder.
  const destinationFingerprint = await captureFolderFingerprint(
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
    nameCollisions: [],
  };
  // APFS is case- and normalization-insensitive by default, so "report.pdf"
  // from one folder and "Report.pdf" from another land on the same entry.
  const claimedDestinationNames = new Map<string, string>();
  // The same, as whole destination paths (`destinationPathKey`), for picking free names.
  const plannedDestinationKeys = new Set<string>();

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
      await captureFolderFingerprint(fileSystem, directoryPath),
      destinationFingerprint,
    );
    sameDirectoryCache.set(directoryPath, same);
    return same;
  };

  // Items that keep their own name claim it first, so a " copy" name picked for an item
  // copied into its own folder never takes it, whatever order the items come in.
  if (request.mode === "copy") {
    for (const sourcePath of request.sourcePaths) {
      if (!(await isDestinationDirectory(dirname(sourcePath)))) {
        plannedDestinationKeys.add(
          pathKey(join(request.destinationDirectoryPath, basename(sourcePath))),
        );
      }
    }
  }

  for (const [index, sourcePath] of request.sourcePaths.entries()) {
    args.signal?.throwIfAborted();
    const sourceFingerprint = await captureFingerprint(fileSystem, sourcePath);
    let destinationPath = join(request.destinationDirectoryPath, basename(sourcePath));
    const pastingIntoSourceFolder = await isDestinationDirectory(dirname(sourcePath));

    if (request.mode === "copy" && pastingIntoSourceFolder) {
      // Duplicating "a.txt" and "a copy.txt" together gives "a copy 2.txt" and
      // "a copy 3.txt": a name an earlier item took is skipped, like Finder.
      destinationPath = await resolveDuplicateName(
        basename(sourcePath),
        request.destinationDirectoryPath,
        fileSystem,
        plannedDestinationKeys,
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
        // "/" holds everything: its own path already ends with the separator.
        const sourcePrefix = sourceRealPath.endsWith("/") ? sourceRealPath : `${sourceRealPath}/`;
        if (
          destinationRealPath === sourceRealPath ||
          destinationRealPath.startsWith(sourcePrefix)
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
    plannedDestinationKeys.add(pathKey(destinationPath));

    const node = await analyzeNode({
      id: `item-${index + 1}`,
      sourcePath,
      destinationPath,
      fileSystem,
      destinationScanCache,
      ...(args.signal ? { signal: args.signal } : {}),
    });
    nodes.push(node);
  }

  for (const collision of destinationScanCache.nameCollisions) {
    issues.push({
      code: "duplicate_destination_name",
      message: `${collision.sourcePath} and ${collision.otherSourcePath} would both be pasted as ${basename(collision.destinationPath)}, because the destination doesn't tell upper and lower case apart.`,
      sourcePath: collision.sourcePath,
      destinationPath: collision.destinationPath,
    });
  }

  // Replacing an item that is, or holds, any item of this paste would destroy that item
  // too. Items inside merged folders are checked as well: a Replace offered there would
  // only be refused when the paste reaches it.
  const sourceRealPaths = await realSourcePaths(fileSystem, nodes);
  const annotate = async (node: CopyPasteAnalysisNode): Promise<void> => {
    node.replaceBlockedReason = await findReplaceBlockedReason(node, fileSystem, sourceRealPaths);
    if (node.conflictClass === "directory_conflict") {
      for (const child of node.children) {
        await annotate(child);
      }
    }
  };
  for (const node of nodes) {
    await annotate(node);
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

// Reads one item again from disk, as the review would read it now: used when the item
// changed after the review (a file saved as a package, a package saved anew) and the
// person chose to go on, so what is pasted is what is there, not what was there.
// Throws when the item now holds two names the destination can't tell apart.
export async function analyzeItemAgain(args: {
  id: string;
  sourcePath: string;
  destinationPath: string;
  fileSystem: WriteServiceFileSystem;
  caseSensitive: boolean;
  signal?: AbortSignal;
}): Promise<CopyPasteAnalysisNode> {
  const destinationScanCache: DestinationScanCache = {
    counts: new Map(),
    entries: new Map(),
    pathKey: (path) => destinationPathKey(path, args.caseSensitive),
    nameCollisions: [],
  };
  const node = await analyzeNode({
    id: args.id,
    sourcePath: args.sourcePath,
    destinationPath: args.destinationPath,
    fileSystem: args.fileSystem,
    destinationScanCache,
    ...(args.signal ? { signal: args.signal } : {}),
  });
  const collision = destinationScanCache.nameCollisions[0];
  if (collision) {
    throw new Error(
      `“${basename(collision.sourcePath)}” and “${basename(collision.otherSourcePath)}” would both be pasted as one item, because the destination doesn't tell upper and lower case apart.`,
    );
  }
  return node;
}

async function analyzeNode(args: {
  id: string;
  sourcePath: string;
  destinationPath: string;
  fileSystem: WriteServiceFileSystem;
  destinationScanCache: DestinationScanCache;
  // Inside a package that replaces or sits beside another: everything in it is written
  // anew, so nothing at the destination is looked at.
  insideWholePackage?: boolean;
  signal?: AbortSignal;
}): Promise<CopyPasteAnalysisNode> {
  args.signal?.throwIfAborted();
  const sourceFingerprint = await captureFingerprint(args.fileSystem, args.sourcePath);
  const destinationFingerprint = args.insideWholePackage
    ? MISSING_FINGERPRINT
    : await captureFingerprint(args.fileSystem, args.destinationPath);
  const sourceKind = sourceFingerprint.kind as Exclude<CopyPasteNodeKind, "missing">;
  const destinationKind = destinationFingerprint.kind;
  const conflictClass = await classifyConflict(
    args.fileSystem,
    { path: args.sourcePath, kind: sourceKind },
    { path: args.destinationPath, kind: destinationKind },
  );
  const disposition = conflictClass === null ? "new" : "conflict";
  const wholePackage =
    args.insideWholePackage === true ||
    (sourceKind === "directory" &&
      conflictClass !== null &&
      conflictClass !== "directory_conflict");

  const children: CopyPasteAnalysisNode[] = [];
  let totalNodeCount = 1;
  let conflictNodeCount = conflictClass === null ? 0 : 1;
  let unreadableReason: string | null = null;

  if (sourceKind === "directory") {
    let sourceChildren: string[] = [];
    try {
      sourceChildren = await withoutAppleDoubleFiles(
        args.fileSystem,
        args.sourcePath,
        (await args.fileSystem.readdir(args.sourcePath)).sort(),
      );
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      // One folder that can't be read (no permission, say) fails on its own when the
      // paste runs; it must not stop everything else from being pasted.
      unreadableReason = describeCopyPasteError(error);
    }
    // A folder from a disk that tells "A.txt" from "a.txt" may hold both; on a destination
    // that doesn't, they would land on one name and one would replace the other.
    const claimedChildNames = new Map<string, string>();
    for (const childName of sourceChildren) {
      args.signal?.throwIfAborted();
      const childSourcePath = join(args.sourcePath, childName);
      const childDestinationPath = join(args.destinationPath, childName);
      const childKey = args.destinationScanCache.pathKey(childName);
      const claimedBy = claimedChildNames.get(childKey);
      if (claimedBy !== undefined) {
        args.destinationScanCache.nameCollisions.push({
          sourcePath: childSourcePath,
          otherSourcePath: join(args.sourcePath, claimedBy),
          destinationPath: childDestinationPath,
        });
      } else {
        claimedChildNames.set(childKey, childName);
      }
      const childNode = await analyzeNode({
        id: `${args.id}/${childName}`,
        sourcePath: childSourcePath,
        destinationPath: childDestinationPath,
        fileSystem: args.fileSystem,
        destinationScanCache: args.destinationScanCache,
        ...(wholePackage ? { insideWholePackage: true } : {}),
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
    // A package is replaced as one item: what is inside it isn't anyone's to list.
    destinationOnly =
      conflictClass === "file_conflict"
        ? null
        : await summarizeDestinationOnly({
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
    issueCode: unreadableReason === null ? null : "source_unreadable",
    issueMessage: unreadableReason,
    totalNodeCount,
    conflictNodeCount,
    destinationTotalNodeCount,
    keepBothDestinationPath: null,
    destinationOnly,
    replaceBlockedReason: null,
  };
}

// A folder's items without the AppleDouble files kept beside them on FAT, exFAT and SMB
// disks: the copy of "name" carries its attributes, and "._name" copied as a file of its
// own would only be clutter (and counted as an item).
async function withoutAppleDoubleFiles(
  fileSystem: WriteServiceFileSystem,
  folderPath: string,
  names: string[],
): Promise<string[]> {
  if (!fileSystem.isAppleDouble) {
    return names;
  }
  const siblings = new Set(names);
  const kept: string[] = [];
  for (const name of names) {
    if (
      isAppleDoubleCompanionName(name, siblings) &&
      (await fileSystem.isAppleDouble(join(folderPath, name)))
    ) {
      continue;
    }
    kept.push(name);
  }
  return kept;
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
    if (isFolderViewFile(entry)) {
      continue;
    }
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

// Replacing an item that is, or contains, the item being pasted would destroy the source;
// so would replacing a folder that holds another item of the same paste.
async function findReplaceBlockedReason(
  node: CopyPasteAnalysisNode,
  fileSystem: WriteServiceFileSystem,
  sourceRealPaths: readonly string[],
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
  if (relation === "same") {
    return "It is the item being pasted.";
  }
  if (relation === "contains") {
    return "It contains the item being pasted.";
  }
  if (
    node.destinationKind === "directory" &&
    (await holdsAnyOf(fileSystem, node.destinationPath, sourceRealPaths))
  ) {
    return "It contains another item being pasted.";
  }
  // Pasting "/x/a.txt" over "/d/a.txt" while "/d/a.txt" is pasted too (search results).
  const destinationRealPath = await fileSystem.realpath(node.destinationPath).catch(() => null);
  if (destinationRealPath !== null && sourceRealPaths.includes(destinationRealPath)) {
    return "It is another item being pasted.";
  }
  return null;
}

async function realSourcePaths(
  fileSystem: WriteServiceFileSystem,
  nodes: readonly CopyPasteAnalysisNode[],
): Promise<string[]> {
  return realItemPaths(
    fileSystem,
    nodes.map((node) => node.sourcePath),
  );
}

type DestinationScanCache = {
  // Item counts of existing folders (null when unreadable).
  counts: Map<string, number | null>;
  // Sorted folder listings, so each existing folder is read once per analysis.
  entries: Map<string, string[]>;
  // How names are compared on the destination volume (see `destinationPathKey`).
  pathKey: (path: string) => string;
  // Items inside pasted folders whose names the destination can't tell apart.
  nameCollisions: Array<{ sourcePath: string; otherSourcePath: string; destinationPath: string }>;
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
    const entries = (await readDestinationEntries(fileSystem, directoryPath, cache)).filter(
      (entry) => !isFolderViewFile(entry),
    );
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

const MISSING_FINGERPRINT: NodeFingerprint = {
  exists: false,
  kind: "missing",
  size: null,
  mtimeMs: null,
  mode: null,
  ino: null,
  dev: null,
  symlinkTarget: null,
};

// What kind of clash an item has with what is at its destination. Two folders can be
// merged, unless either is a package (an app, a Keynote document): those are replaced or
// kept beside each other whole, like files, since mixing two versions breaks them.
export async function classifyConflict(
  fileSystem: WriteServiceFileSystem,
  source: { path: string; kind: Exclude<CopyPasteNodeKind, "missing"> },
  destination: { path: string; kind: CopyPasteNodeKind },
): Promise<CopyPasteConflictClass | null> {
  if (destination.kind === "missing") {
    return null;
  }
  if (source.kind === "directory" && destination.kind === "directory") {
    const packaged =
      (await isPackageFolder(fileSystem, source.path)) ||
      (await isPackageFolder(fileSystem, destination.path));
    return packaged ? "file_conflict" : "directory_conflict";
  }
  if (source.kind !== "directory" && destination.kind === source.kind) {
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
