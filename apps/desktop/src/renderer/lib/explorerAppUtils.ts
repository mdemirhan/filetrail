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
  if (event.status === "failed" || event.status === "partial") {
    return true;
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

export function resolvePasteDestinationPath(args: {
  contextMenuState: ContextMenuState | null;
  contextMenuTargetEntry: DirectoryEntry | null;
  clipboardSourcePaths: string[];
  currentPath: string;
  focusedPane: "tree" | "content" | null;
  isSearchMode: boolean;
  selectedEntry: DirectoryEntry | null;
}): string | null {
  const {
    contextMenuState,
    contextMenuTargetEntry,
    clipboardSourcePaths,
    currentPath,
    focusedPane,
    isSearchMode,
    selectedEntry,
  } = args;
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
    if (isDirectoryLikeEntry(contextMenuTargetEntry)) {
      return contextMenuTargetEntry.path;
    }
    return currentPath.length > 0 ? currentPath : null;
  }
  if (focusedPane === "tree") {
    return currentPath.length > 0 ? currentPath : null;
  }
  if (focusedPane === "content" && isDirectoryLikeEntry(selectedEntry)) {
    if (clipboardSourcePaths.includes(selectedEntry.path)) {
      return currentPath.length > 0 ? currentPath : selectedEntry.path;
    }
    return selectedEntry.path;
  }
  return currentPath.length > 0 ? currentPath : null;
}

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
  if (args.contextScope === "background") {
    return args.currentPath.length > 0 ? args.currentPath : null;
  }
  if (args.selectedPaths.length === 0) {
    return args.currentPath.length > 0 ? args.currentPath : null;
  }
  if (args.selectedPaths.length !== 1) {
    return null;
  }
  return isDirectoryLikeEntry(args.selectedEntry) ? args.selectedEntry.path : null;
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
  if (result.action === "trash") {
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

  if (result.action === "trash") {
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

export function isDirectoryLikeEntry(entry: DirectoryEntry | null): entry is DirectoryEntry {
  return entry?.kind === "directory" || entry?.kind === "symlink_directory";
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
