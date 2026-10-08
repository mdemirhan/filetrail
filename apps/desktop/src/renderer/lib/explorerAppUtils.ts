import {
  type WriteOperationAction,
  type WriteOperationProgressEvent,
  isFollowedMove,
  isInsideTrash,
} from "@filetrail/contracts";

import type { ContextMenuState } from "../hooks/useWriteOperations";
import { parentDirectoryPath } from "./explorerNavigation";
import type { DirectoryEntry, SearchResultItem, WriteOperationResult } from "./explorerTypes";
import { getVolumeRootPath } from "./volumes";

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

// Names a few items for a message: “a.txt”, “a.txt” and “b.txt”, or “a.txt”, “b.txt”,
// “c.txt” and 2 more.
export function formatQuotedNames(paths: readonly string[], maxShown = 3): string {
  const names = paths.map((path) => `“${getPathLeafName(path)}”`);
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  if (names.length <= maxShown) {
    return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  }
  return `${names.slice(0, maxShown).join(", ")} and ${names.length - maxShown} more`;
}

// Why items on the clipboard were left out of a paste: they were moved, renamed or deleted
// outside the app since they were copied. A cut is "moved", as everything else about it.
export function formatMissingClipboardItemsMessage(
  paths: readonly string[],
  verb: "pasted" | "moved" = "pasted",
): string {
  if (paths.length === 1) {
    return `${formatQuotedNames(paths)} couldn’t be ${verb} because it no longer exists.`;
  }
  if (paths.length <= 3) {
    return `${formatQuotedNames(paths)} couldn’t be ${verb} because they no longer exist.`;
  }
  return `${paths.length} items couldn’t be ${verb} because they no longer exist: ${formatQuotedNames(paths)}.`;
}

// What to say when Finder did not empty the Trash. The usual reason is that macOS has not
// let File Trail control Finder (Apple event error -1743), which only the user can allow.
export function describeEmptyTrashFailure(detail: string): { title: string; message: string } {
  const title = "Couldn’t Empty the Trash";
  if (/not authori[sz]ed|-1743/iu.test(detail)) {
    return {
      title,
      message:
        "File Trail needs permission to control Finder. Turn it on in System Settings > Privacy & Security > Automation, then try again.",
    };
  }
  if (/-1712\b|timed out/iu.test(detail)) {
    return {
      title,
      message: "Finder took too long to answer. It may still be emptying the Trash.",
    };
  }
  if (/-128\b|user canceled/iu.test(detail)) {
    return { title, message: "Emptying the Trash was stopped in Finder." };
  }
  // osascript's reason, without its command line or error number.
  const reason = detail
    .replace(/^[\s\S]*execution error:\s*/u, "")
    .replace(/^Command failed:[^\n]*\n?/u, "")
    .replace(/\s*\(-?\d+\)\s*$/u, "")
    .trim();
  return {
    title,
    message:
      reason.length > 0
        ? reason
        : "Finder didn't empty the Trash. Try again, or empty it in Finder.",
  };
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
  // An Undo that left anything as it was says what and why; a stopped one says how far.
  if (isUndoOrRedo(event.action)) {
    return (
      event.status === "failed" ||
      event.status === "partial" ||
      (event.status === "cancelled" && event.result.summary.completedItemCount > 0)
    );
  }
  if (event.status === "failed") {
    return true;
  }
  // The sheet said every item would be renamed: one skipped after all (its name was taken
  // since) is told, even when the rest went.
  if (event.action === "batch_rename" && event.result.summary.skippedItemCount > 0) {
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
  isSearchMode: boolean;
  homePath: string;
}): string | null {
  const destination = resolvePasteDestinationIgnoringTrash(args);
  // Nothing is pasted into the Trash: Move to Trash puts items there, where they can be
  // put back from (Finder's Trash has no Paste either).
  return destination !== null && isInsideTrash(destination, args.homePath) ? null : destination;
}

function resolvePasteDestinationIgnoringTrash(args: {
  contextMenuState: ContextMenuState | null;
  contextMenuTargetEntry: DirectoryEntry | null;
  clipboardSourcePaths: string[];
  currentPath: string;
  isSearchMode: boolean;
}): string | null {
  const {
    contextMenuState,
    contextMenuTargetEntry,
    clipboardSourcePaths,
    currentPath,
    isSearchMode,
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
    // Like the keyboard, a folder is the target only when it is the one item picked, and
    // not when it is itself on the clipboard: nothing goes into itself, so the paste goes
    // into the folder on screen instead.
    if (contextMenuState.paths.length <= 1 && isPasteTargetFolderEntry(contextMenuTargetEntry)) {
      if (clipboardSourcePaths.includes(contextMenuTargetEntry.path)) {
        return currentFolder ?? contextMenuTargetEntry.path;
      }
      return contextMenuTargetEntry.path;
    }
    return currentFolder;
  }
  // From the keyboard or the menu bar the paste goes into the folder on screen, like
  // Finder, whatever is selected: a selected folder (often the one just pasted or made)
  // isn't a target, or a second ⌘V would land out of sight inside it. A folder's own
  // right-click menu pastes into it (above).
  return currentFolder;
}

// A symlinked folder is not a paste target, the same as for drag and drop
// (`isRealDirectoryEntry`): pasting through it would write into the link's target
// somewhere else on disk, so the paste goes into the folder on screen instead.
function isPasteTargetFolderEntry(entry: DirectoryEntry | null): entry is DirectoryEntry {
  return entry?.kind === "directory" && !entry.isSymlink;
}

// Where New Folder makes its folder. From the keyboard, the menu bar or the background's
// menu it goes into the folder on screen, as in Finder, whatever is selected. The menu
// opened on one folder (`contextScope: "selection"`) makes it inside that folder; on a file
// or on several items that menu has no New Folder, since it is about those items.
export function resolveNewFolderTargetPath(args: {
  currentPath: string;
  selectedEntry: DirectoryEntry | null;
  selectedPaths: string[];
  isSearchMode: boolean;
  homePath: string;
  contextScope?: "selection" | "background";
}): string | null {
  if (args.isSearchMode) {
    return null;
  }
  const folderOnScreen = args.currentPath.length > 0 ? args.currentPath : null;
  const target =
    args.contextScope !== "selection" || args.selectedPaths.length === 0
      ? folderOnScreen
      : args.selectedPaths.length === 1 && isDirectoryLikeEntry(args.selectedEntry)
        ? args.selectedEntry.path
        : null;
  // Nothing is made in the Trash.
  return target !== null && isInsideTrash(target, args.homePath) ? null : target;
}

// Why a drag doesn't start while an operation runs, said in one line: one operation runs at
// a time, and a drag would start another.
export function describeDragRefusedWhileBusy(
  action: WriteOperationAction,
  currentSourcePath: string | null,
  // A drag of the app's own that didn't start, or one from another app that can't drop.
  gesture: "drag" | "drop" = "drag",
): string {
  const subject = currentSourcePath ? `“${getPathLeafName(currentSourcePath)}” is` : "items are";
  const refused = `Can't ${gesture} while`;
  switch (action) {
    case "move_to":
      return `${refused} ${subject} being moved`;
    case "trash":
      return `${refused} ${subject} being moved to the Trash`;
    case "delete_immediately":
      return `${refused} ${subject} being deleted`;
    case "rename":
    case "batch_rename":
      return `${refused} ${subject} being renamed`;
    case "new_folder":
      return `${refused} a folder is being made`;
    default:
      return `${refused} ${subject} being copied`;
  }
}

// The name New Folder suggests, as Finder's: "untitled folder", else the first free
// "untitled folder 2", "untitled folder 3"… The disk (APFS by default) treats names that
// differ only in case as the same, so the names are compared that way.
export const NEW_FOLDER_NAME = "untitled folder";

export function resolveFreeNewFolderName(existingNames: Iterable<string>): string {
  const takenNames = new Set(Array.from(existingNames, (name) => name.toLocaleLowerCase()));
  const baseName = NEW_FOLDER_NAME;
  if (!takenNames.has(baseName.toLocaleLowerCase())) {
    return baseName;
  }
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!takenNames.has(candidate.toLocaleLowerCase())) {
      return candidate;
    }
  }
  return baseName;
}

export function resolveWriteOperationSelectionDirectoryPath(
  result: WriteOperationResult,
  selectedPaths: string[],
): string | null {
  const firstSelectedPath = selectedPaths[0];
  if (!firstSelectedPath) {
    return null;
  }
  if (
    result.action === "rename" ||
    result.action === "batch_rename" ||
    result.action === "new_folder" ||
    isUndoOrRedo(result.action)
  ) {
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
  // An Undo may have moved the folder on screen to the Trash (a New Folder undone).
  if (isUndoOrRedo(result.action)) {
    const removedPath = findDeepestMatchingSourcePath(onlyRemoved(result), currentPath);
    if (removedPath) {
      return parentDirectoryPath(removedPath) ?? currentPath;
    }
  }

  // A folder renamed or moved (by Move To, a drag, or Cut and Paste) is followed.
  if (movedItems(result)) {
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
  if (isUndoOrRedo(result.action)) {
    const removedPath = findDeepestMatchingSourcePath(onlyRemoved(result), selectedTreePath);
    if (removedPath) {
      return parentDirectoryPath(removedPath) ?? null;
    }
  }

  if (movedItems(result)) {
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

/** A write that gives items new paths (a rename of one or several, or a move): what was at
 *  the old paths, and what is inside, is followed to the new ones. An Undo or Redo moves
 *  items back too (and out of the Trash), as well as to the Trash. */
export function isRenameOrMove(action: WriteOperationAction): boolean {
  return (
    action === "rename" || action === "batch_rename" || action === "move_to" || isUndoOrRedo(action)
  );
}

/** A write that gave items new paths: a rename or move (see isRenameOrMove), or a paste
 *  that moved what was cut. */
export function movedItems(result: WriteOperationResult): boolean {
  return isRenameOrMove(result.action) || result.mode === "cut";
}

export function isUndoOrRedo(action: WriteOperationAction): boolean {
  return action === "undo" || action === "redo";
}

/** Whether an operation's event is its last: it finished, failed, stopped or partly worked. */
export function isTerminalWriteStatus(status: string): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "partial"
  );
}

/** What a write took out of the folder it was in: what it moved to the Trash or deleted,
 *  and what it moved into another folder (not what it renamed in place). */
export function pathsLeftByWrite(result: WriteOperationResult): string[] {
  const left = new Set(removedByWrite(result));
  if (movedItems(result)) {
    for (const { from, to } of collectFollowedMoves(result)) {
      if (parentDirectoryPath(from) !== parentDirectoryPath(to)) {
        left.add(from);
      }
    }
  }
  return [...left];
}

/** What a write took away from where it was: everything a Trash or delete was asked to
 *  remove, or what an Undo moved to the Trash. */
export function removedByWrite(result: WriteOperationResult): string[] {
  if (result.action === "trash" || result.action === "delete_immediately") {
    return result.items.flatMap((item) =>
      item.status === "completed" && item.sourcePath ? [item.sourcePath] : [],
    );
  }
  return isUndoOrRedo(result.action)
    ? onlyRemoved(result).items.flatMap((item) => (item.sourcePath ? [item.sourcePath] : []))
    : [];
}

// An Undo's items that went to the Trash: done, and with nowhere else to be.
function onlyRemoved(result: WriteOperationResult): WriteOperationResult {
  return {
    ...result,
    items: result.items.filter(
      (item) => item.status === "completed" && item.destinationPath === null,
    ),
  };
}

/**
 * Where a rename or move took each item, for following it there. Only what really moved
 * counts: completed items, and for a rename of several also an item that couldn't take its
 * new name but was put back under another ("b 2"), since its result says where it is.
 */
export function collectFollowedMoves(
  result: WriteOperationResult,
): Array<{ from: string; to: string }> {
  return result.items.flatMap((item) =>
    isFollowedMove(item, result.action) && item.sourcePath && item.destinationPath
      ? [{ from: item.sourcePath, to: item.destinationPath }]
      : [],
  );
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

// A link to a folder is not measured: it has the size of the link itself, as measuring the
// folder it is in counts it, so a selection adds up to that folder's size and the folder it
// points to is not counted twice.
export function isFolderSizeEligibleKind(kind: DirectoryEntry["kind"] | null | undefined): boolean {
  return kind === "directory" || kind === "bundle";
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
  const verb = action === "Open" ? "opens" : "edits";
  return `File Trail ${verb} up to ${limit} item${limit === 1 ? "" : "s"} at a time, and ${selectedCount} are selected. You can change this in Settings.`;
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
    name: path === "/" ? "Macintosh HD" : (path.split("/").filter(Boolean).at(-1) ?? path),
    kind: "directory" as const,
    isHidden: false,
    isSymlink: false,
    expanded,
    loading: false,
    loaded: false,
    loadedIncludeHidden: false,
    forcedVisibleHiddenChildPath: null,
    forcedVisiblePackageChildPath: null,
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

// Whether the folder tree rooted at `rootPath` holds `path`. Rooted at Macintosh HD ("/"),
// it holds the startup disk's own folders only: another disk, though mounted inside it at
// /Volumes, is shown from its own top.
export function isPathWithinTreeRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return getVolumeRootPath(path) === "/";
  }
  return isPathWithinRoot(path, rootPath);
}

// The top the folder tree takes for `path` when it is not rooted somewhere holding it:
// Home for what is in Home, the disk for what is on another disk, otherwise Macintosh HD.
export function resolveExplorerTreeRootPath(path: string, homePath: string): string {
  if (homePath.length > 0 && isPathWithinRoot(path, homePath)) {
    return homePath;
  }
  return getVolumeRootPath(path);
}
