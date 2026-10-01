import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import type { ContextMenuState } from "../hooks/useWriteOperations";
import { parentDirectoryPath } from "./explorerNavigation";
import type { DirectoryEntry, SearchResultItem, WriteOperationResult } from "./explorerTypes";

export function formatPathForShell(path: string): string {
  if (!/\s/.test(path)) {
    return path;
  }
  return `'${path.replaceAll("'", "'\\''")}'`;
}

export function getPathLeafName(path: string): string {
  const trimmedPath = path.replace(/\/+$/u, "");
  return trimmedPath.split("/").filter(Boolean).at(-1) ?? path;
}

export function shouldRenderCopyPasteResultDialog(
  event: WriteOperationProgressEvent | null,
): boolean {
  if (!event || !event.result) {
    return false;
  }
  if (event.action === "rename" || event.action === "new_folder") {
    return event.status === "failed";
  }
  if (event.status === "failed") {
    return true;
  }
  if (event.status === "partial") {
    return !isExpectedPlannedSkipResult(event);
  }
  if (event.status !== "cancelled") {
    return false;
  }
  return (
    event.result.summary.completedItemCount > 0 ||
    event.result.summary.failedItemCount > 0 ||
    event.result.summary.skippedItemCount > 0
  );
}

export function isExpectedPlannedSkipResult(event: WriteOperationProgressEvent): boolean {
  if (!event.result || event.status !== "partial") {
    return false;
  }
  const { result } = event;
  if (result.summary.skippedItemCount === 0) {
    return false;
  }
  if (result.summary.failedItemCount > 0 || result.summary.cancelledItemCount > 0) {
    return false;
  }
  return result.items
    .filter((item) => item.status === "skipped")
    .every((item) => item.skipReason === "planned_conflict_policy");
}

// Items worth retrying after a copy-like operation: failures and items that never
// started. Only top-level items are returned; an item inside a folder is retried by
// retrying that folder, never pasted on its own at the destination root.
export function collectRetrySourcePaths(items: WriteOperationResult["items"]): string[] {
  const retryPaths = new Set<string>();
  for (const item of selectTopLevelItems(items)) {
    if (
      typeof item.sourcePath === "string" &&
      (item.status === "failed" || item.status === "cancelled")
    ) {
      retryPaths.add(item.sourcePath);
    }
  }
  return [...retryPaths];
}

// Result lists name every item the operation touched, including everything inside a
// copied folder. This keeps only the items the user actually picked: those with no other
// listed item above them. Items without a source path cannot be nested and are kept.
// Each path's ancestors are looked up in a set so large results stay fast.
export function selectTopLevelItems<T extends { sourcePath?: string | null }>(
  items: readonly T[],
): T[] {
  const itemPaths = new Set<string>();
  for (const item of items) {
    if (typeof item.sourcePath === "string") {
      itemPaths.add(item.sourcePath);
    }
  }
  return items.filter(
    (item) => typeof item.sourcePath !== "string" || !hasAncestorPath(item.sourcePath, itemPaths),
  );
}

function hasAncestorPath(path: string, candidates: ReadonlySet<string>): boolean {
  let separatorIndex = path.lastIndexOf("/");
  while (separatorIndex > 0) {
    if (candidates.has(path.slice(0, separatorIndex))) {
      return true;
    }
    separatorIndex = path.lastIndexOf("/", separatorIndex - 1);
  }
  return false;
}

export function resolvePasteDestinationPath(args: {
  contextMenuState: ContextMenuState | null;
  contextMenuTargetEntry: DirectoryEntry | null;
  clipboardSourcePaths: string[];
  currentPath: string;
  focusedPane: "tree" | "content" | null;
  isSearchMode: boolean;
  selectedEntry: DirectoryEntry | null;
  selectedPathCount: number;
}): string | null {
  const {
    contextMenuState,
    contextMenuTargetEntry,
    clipboardSourcePaths,
    currentPath,
    focusedPane,
    isSearchMode,
    selectedEntry,
    selectedPathCount,
  } = args;
  const currentFolder = currentPath.length > 0 ? currentPath : null;
  if (isSearchMode) {
    return null;
  }
  if (contextMenuState) {
    if (
      contextMenuState.targetKind === "treeFolder" ||
      contextMenuState.targetKind === "favorite"
    ) {
      return contextMenuState.targetPath;
    }
    // Like the keyboard, a folder is the target only when it is the one item picked.
    if (contextMenuState.paths.length <= 1 && isPasteTargetFolderEntry(contextMenuTargetEntry)) {
      return contextMenuTargetEntry.path;
    }
    return currentFolder;
  }
  // The tree's selected folder is the folder on screen, so paste goes there.
  if (focusedPane === "tree") {
    return currentFolder;
  }
  // With several items selected there is no single folder to paste into, so the paste
  // goes into the folder on screen, like Finder.
  if (
    focusedPane === "content" &&
    selectedPathCount === 1 &&
    isPasteTargetFolderEntry(selectedEntry)
  ) {
    if (clipboardSourcePaths.includes(selectedEntry.path)) {
      return currentFolder ?? selectedEntry.path;
    }
    return selectedEntry.path;
  }
  return currentFolder;
}

// A symlinked folder is not a paste target, the same as for drag and drop
// (`isRealDirectoryEntry`): pasting through it would write into the link's target
// somewhere else on disk, so the paste goes into the folder on screen instead.
function isPasteTargetFolderEntry(entry: DirectoryEntry | null): entry is DirectoryEntry {
  return entry?.kind === "directory" && !entry.isSymlink;
}

// Where New Folder makes its folder. One selected folder takes it inside; otherwise it goes
// into the folder on screen, as in Finder, whatever else is selected. The exception is the
// menu opened on the selection itself (`contextScope: "selection"`): on a file or on several
// items it has no New Folder, since the menu is about those items, not the folder.
export function resolveNewFolderTargetPath(args: {
  currentPath: string;
  selectedEntry: DirectoryEntry | null;
  selectedPaths: string[];
  isSearchMode: boolean;
  contextScope?: "selection" | "background";
}): string | null {
  if (args.isSearchMode) {
    return null;
  }
  const folderOnScreen = args.currentPath.length > 0 ? args.currentPath : null;
  if (args.contextScope === "background" || args.selectedPaths.length === 0) {
    return folderOnScreen;
  }
  if (args.selectedPaths.length === 1 && isDirectoryLikeEntry(args.selectedEntry)) {
    return args.selectedEntry.path;
  }
  return args.contextScope === "selection" ? null : folderOnScreen;
}

export function resolveWriteOperationSelectionDirectoryPath(
  result: WriteOperationResult,
  selectedPaths: string[],
): string | null {
  const firstSelectedPath = selectedPaths[0];
  if (!firstSelectedPath) {
    return null;
  }
  if (result.action === "rename" || result.action === "new_folder") {
    return parentDirectoryPath(firstSelectedPath) ?? null;
  }
  return result.targetPath;
}

export function resolveWriteOperationRefreshPath(
  result: WriteOperationResult,
  currentPath: string,
): string {
  if (result.action === "trash" || result.action === "delete_immediately") {
    const impactedPath = findDeepestMatchingSourcePath(result, currentPath);
    if (!impactedPath) {
      return currentPath;
    }
    return parentDirectoryPath(impactedPath) ?? currentPath;
  }

  if (result.action === "rename" || result.action === "move_to") {
    const impactedItem = findDeepestMatchingSourceItem(result, currentPath);
    if (!impactedItem?.sourcePath || !impactedItem.destinationPath) {
      return currentPath;
    }
    return replacePathPrefix(currentPath, impactedItem.sourcePath, impactedItem.destinationPath);
  }

  return currentPath;
}

export function resolveWriteOperationTreeSelectionPath(
  result: WriteOperationResult,
  selectedTreePath: string | null,
): string | null {
  if (!selectedTreePath) {
    return null;
  }

  if (result.action === "trash" || result.action === "delete_immediately") {
    const impactedPath = findDeepestMatchingSourcePath(result, selectedTreePath);
    if (!impactedPath) {
      return null;
    }
    return parentDirectoryPath(impactedPath) ?? null;
  }

  if (result.action === "rename" || result.action === "move_to") {
    const impactedItem = findDeepestMatchingSourceItem(result, selectedTreePath);
    if (!impactedItem?.sourcePath || !impactedItem.destinationPath) {
      return null;
    }
    return replacePathPrefix(
      selectedTreePath,
      impactedItem.sourcePath,
      impactedItem.destinationPath,
    );
  }

  return null;
}

export function resolveWriteOperationTreeReloadPaths(result: WriteOperationResult): string[] {
  const completedSourceRoots = collapseNestedPaths(
    result.items
      .filter((item) => item.status === "completed")
      .map((item) => item.sourcePath)
      .filter((path): path is string => typeof path === "string" && path.length > 0),
  );
  const completedDestinationRoots = collapseNestedPaths(
    result.items
      .filter((item) => item.status === "completed")
      .map((item) => item.destinationPath)
      .filter((path): path is string => typeof path === "string" && path.length > 0),
  );
  const parentPaths = new Set<string>();
  for (const path of [...completedSourceRoots, ...completedDestinationRoots]) {
    const parentPath = parentDirectoryPath(path);
    if (parentPath) {
      parentPaths.add(parentPath);
    }
  }
  return [...new Set([...parentPaths, ...completedDestinationRoots])].sort((left, right) =>
    left.length === right.length ? left.localeCompare(right) : left.length - right.length,
  );
}

export function replacePathPrefix(
  path: string,
  sourcePrefix: string,
  destinationPrefix: string,
): string {
  if (path === sourcePrefix) {
    return destinationPrefix;
  }
  if (!path.startsWith(`${sourcePrefix}/`)) {
    return path;
  }
  return `${destinationPrefix}${path.slice(sourcePrefix.length)}`;
}

function findDeepestMatchingSourcePath(
  result: WriteOperationResult,
  currentPath: string,
): string | null {
  const matchingSourcePaths = result.items
    .map((item) => item.sourcePath)
    .filter((sourcePath): sourcePath is string => {
      if (typeof sourcePath !== "string" || sourcePath.length === 0) {
        return false;
      }
      return currentPath === sourcePath || currentPath.startsWith(`${sourcePath}/`);
    })
    .sort((left, right) => right.length - left.length);
  return matchingSourcePaths[0] ?? null;
}

function findDeepestMatchingSourceItem(
  result: WriteOperationResult,
  currentPath: string,
): {
  sourcePath: string;
  destinationPath: string;
} | null {
  const matchingItems = result.items
    .filter(
      (item): item is typeof item & { sourcePath: string; destinationPath: string } =>
        typeof item.sourcePath === "string" &&
        item.sourcePath.length > 0 &&
        typeof item.destinationPath === "string" &&
        item.destinationPath.length > 0 &&
        (currentPath === item.sourcePath || currentPath.startsWith(`${item.sourcePath}/`)),
    )
    .sort((left, right) => right.sourcePath.length - left.sourcePath.length);
  return matchingItems[0] ?? null;
}

function collapseNestedPaths(paths: string[]): string[] {
  const roots: string[] = [];
  for (const path of [...new Set(paths)].sort((left, right) =>
    left.length === right.length ? left.localeCompare(right) : left.length - right.length,
  )) {
    if (roots.some((rootPath) => path === rootPath || path.startsWith(`${rootPath}/`))) {
      continue;
    }
    roots.push(path);
  }
  return roots;
}

export function isDirectoryLikeEntry(entry: DirectoryEntry | null): entry is DirectoryEntry {
  return entry?.kind === "directory" || entry?.kind === "symlink_directory";
}

export function isFolderSizeEligibleKind(kind: DirectoryEntry["kind"] | null | undefined): boolean {
  return kind === "directory" || kind === "symlink_directory" || kind === "bundle";
}

// The listing is sorted before folder sizes are known (they come from a separate folder
// size calculation), so sorting by size is finished here: files use the size the listing
// reported, folders and bundles the size calculated for them, and items without a known
// size stay at the end in both directions. Mirrors the main-process sort otherwise.
export function sortEntriesBySize(
  entries: readonly DirectoryEntry[],
  options: {
    sortDirection: "asc" | "desc";
    foldersFirst: boolean;
    getFolderSizeBytes: (path: string) => number | null;
  },
): DirectoryEntry[] {
  const sizeByPath = new Map<string, number | null>();
  for (const entry of entries) {
    sizeByPath.set(
      entry.path,
      isFolderSizeEligibleKind(entry.kind)
        ? options.getFolderSizeBytes(entry.path)
        : (entry.sizeBytes ?? null),
    );
  }
  const direction = options.sortDirection === "desc" ? -1 : 1;
  return [...entries].sort((left, right) => {
    if (options.foldersFirst) {
      const rank = folderRank(left) - folderRank(right);
      if (rank !== 0) {
        return rank;
      }
    }
    const leftSize = sizeByPath.get(left.path) ?? null;
    const rightSize = sizeByPath.get(right.path) ?? null;
    if (leftSize === null || rightSize === null) {
      if (leftSize !== rightSize) {
        return leftSize === null ? 1 : -1;
      }
    } else if (leftSize !== rightSize) {
      return (leftSize - rightSize) * direction;
    }
    return (
      left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) *
      direction
    );
  });
}

function folderRank(entry: DirectoryEntry): number {
  return entry.kind === "directory" || entry.kind === "symlink_directory" ? 0 : 1;
}

export function isEditableFileEntry(entry: DirectoryEntry | null): entry is DirectoryEntry {
  return entry?.kind === "file" || entry?.kind === "symlink_file";
}

export function createOpenItemLimitMessage(
  action: "Open" | "Edit",
  selectedCount: number,
  limit: number,
): string {
  return `${action} is limited to ${limit} item${limit === 1 ? "" : "s"} at a time. You selected ${selectedCount}. Change this in Settings if you want a higher limit.`;
}

export function toDirectoryEntryFromSearchResult(result: SearchResultItem): DirectoryEntry {
  return {
    path: result.path,
    name: result.name,
    extension: result.extension,
    kind: result.kind,
    isHidden: result.isHidden,
    isSymlink: result.isSymlink,
  };
}

export function createTreeNode(path: string, expanded: boolean) {
  return {
    path,
    name: path === "/" ? "/" : (path.split("/").filter(Boolean).at(-1) ?? path),
    kind: "directory" as const,
    isHidden: false,
    isSymlink: false,
    expanded,
    loading: false,
    loaded: false,
    loadedIncludeHidden: false,
    forcedVisibleHiddenChildPath: null,
    error: null,
    childPaths: [],
  };
}

export function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

export function resolveExplorerTreeRootPath(path: string, homePath: string): string {
  if (homePath.length > 0 && isPathWithinRoot(path, homePath)) {
    return homePath;
  }
  return "/";
}
