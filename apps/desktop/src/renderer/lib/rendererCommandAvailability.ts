import { isInsideTrash } from "@filetrail/contracts";

import type { RendererCommandType } from "../../shared/rendererCommands";
import type { CopyPasteClipboardState } from "./copyPasteClipboard";
import { hasClipboardItems } from "./copyPasteClipboard";
import {
  isDirectoryLikeEntry,
  isEditableFileEntry,
  resolveNewFolderTargetPath,
} from "./explorerAppUtils";
import { parentDirectoryPath } from "./explorerNavigation";
import type { DirectoryEntry } from "./explorerTypes";
import type { ShortcutContext } from "./shortcutPolicy";
import { canHandleRendererCommand } from "./shortcutPolicy";

// What a running file operation blocks: anything that would start another one. Copy, Cut
// and Copy Path only fill a clipboard, so they stay available.
const WRITE_LOCKED_RENDERER_COMMANDS = new Set<RendererCommandType>([
  "undo",
  "redo",
  "pasteSelection",
  "moveSelection",
  "renameSelection",
  "duplicateSelection",
  "newFolder",
  "trashSelection",
  "emptyTrash",
]);

export type RendererCommandAvailabilityContext = {
  shortcutContext: ShortcutContext;
  currentPath: string;
  selectedPathsInViewOrder: string[];
  activeContentEntries: DirectoryEntry[];
  selectedEntry: DirectoryEntry | null;
  selectedTreeTargetPath: string | null;
  copyPasteClipboard: CopyPasteClipboardState;
  pasteDestinationPath: string | null;
  isSearchMode: boolean;
  openItemLimit: number;
  writeOperationLocked: boolean;
  // What the menu needs beyond the toolbar. Left out, a command they decide is available.
  canGoBack?: boolean;
  canGoForward?: boolean;
  hasCachedSearch?: boolean;
  tabCount?: number;
  /** Trash is a favorite that stays: it is never offered for removal. */
  trashPath?: string | null;
  /** Where the home folder is, to tell what is in the Trash. */
  homePath?: string;
  /** The Trash has nothing to empty (null or left out: it can't be told). */
  trashIsEmpty?: boolean | null;
};

type CommandTargetContext = Pick<
  RendererCommandAvailabilityContext,
  | "currentPath"
  | "selectedPathsInViewOrder"
  | "activeContentEntries"
  | "selectedTreeTargetPath"
  | "isSearchMode"
  | "trashPath"
> & { focusedPane: ShortcutContext["focusedPane"] };

function resolveSingleSelectedFolderPath(context: CommandTargetContext): string | null {
  if (context.selectedPathsInViewOrder.length !== 1) {
    return null;
  }
  const entry = context.activeContentEntries.find(
    (candidate) => candidate.path === context.selectedPathsInViewOrder[0],
  );
  return isDirectoryLikeEntry(entry ?? null) ? (entry?.path ?? null) : null;
}

// The folder File > Open in New Tab opens: the tree's folder when the tree has the
// keyboard, otherwise the one folder selected in the list.
export function resolveNewTabTargetPath(context: CommandTargetContext): string | null {
  if (context.focusedPane === "tree") {
    return context.selectedTreeTargetPath;
  }
  return resolveSingleSelectedFolderPath(context);
}

// The folder File > Add to Favorites acts on: the tree's folder when the tree has the
// keyboard, otherwise the one folder selected in the list, or the folder on screen when
// nothing is selected.
export function resolveFavoriteTargetPath(context: CommandTargetContext): string | null {
  if (context.isSearchMode) {
    return null;
  }
  const targetPath =
    context.focusedPane === "tree"
      ? context.selectedTreeTargetPath
      : context.selectedPathsInViewOrder.length === 0
        ? context.currentPath || null
        : resolveSingleSelectedFolderPath(context);
  return targetPath !== null && targetPath !== context.trashPath ? targetPath : null;
}

// What File > Show in Finder reveals: the tree's folder, the selection, or with nothing
// selected the folder on screen.
export function resolveShowInFinderPaths(context: CommandTargetContext): string[] {
  if (context.focusedPane === "tree" && context.selectedTreeTargetPath) {
    return [context.selectedTreeTargetPath];
  }
  if (context.selectedPathsInViewOrder.length > 0) {
    return context.selectedPathsInViewOrder;
  }
  return context.currentPath ? [context.currentPath] : [];
}

function selectionIsInTrash(context: RendererCommandAvailabilityContext): boolean {
  const homePath = context.homePath ?? "";
  return context.selectedPathsInViewOrder.some((path) => isInsideTrash(path, homePath));
}

function resolveSelectedEntries(
  selectedPathsInViewOrder: readonly string[],
  activeContentEntries: readonly DirectoryEntry[],
) {
  return selectedPathsInViewOrder
    .map((path) => activeContentEntries.find((entry) => entry.path === path) ?? null)
    .filter((entry): entry is DirectoryEntry => entry !== null);
}

export function canRunToolbarRendererCommand(
  command: RendererCommandType,
  context: RendererCommandAvailabilityContext,
): boolean {
  if (!canHandleRendererCommand(command, context.shortcutContext)) {
    return false;
  }

  if (context.writeOperationLocked && WRITE_LOCKED_RENDERER_COMMANDS.has(command)) {
    return false;
  }

  const { focusedPane } = context.shortcutContext;
  const selectedCount = context.selectedPathsInViewOrder.length;
  const selectedEntries = resolveSelectedEntries(
    context.selectedPathsInViewOrder,
    context.activeContentEntries,
  );

  switch (command) {
    case "openSelection":
      if (focusedPane === "tree") {
        return context.selectedTreeTargetPath !== null;
      }
      return selectedCount > 0 && selectedCount <= context.openItemLimit;
    case "editSelection":
      return (
        selectedCount > 0 &&
        selectedCount <= context.openItemLimit &&
        selectedEntries.length === selectedCount &&
        selectedEntries.every((entry) => isEditableFileEntry(entry))
      );
    case "openInTerminal":
      if (focusedPane === "tree") {
        return context.selectedTreeTargetPath !== null;
      }
      return selectedCount > 0 || context.currentPath.length > 0;
    case "moveSelection":
      return selectedCount > 0;
    case "trashSelection":
      // What is in the Trash is already there; it can only be deleted for good, from its menu.
      return selectedCount > 0 && !selectionIsInTrash(context);
    case "duplicateSelection":
      // A duplicate goes next to its original: search results from several folders have
      // no one folder for theirs. Nothing is made in the Trash.
      return (
        selectedCount > 0 &&
        !selectionIsInTrash(context) &&
        (!context.isSearchMode ||
          new Set(context.selectedPathsInViewOrder.map((path) => parentDirectoryPath(path)))
            .size === 1)
      );
    case "renameSelection":
      // One item in its row; several in the Rename sheet.
      return selectedCount > 0;
    case "emptyTrash":
      return context.trashIsEmpty !== true;
    case "newFolder":
      return (
        resolveNewFolderTargetPath({
          currentPath: context.currentPath,
          selectedEntry: context.selectedEntry,
          selectedPaths: context.selectedPathsInViewOrder,
          isSearchMode: context.isSearchMode,
          homePath: context.homePath ?? "",
        }) !== null
      );
    case "copySelection":
    case "cutSelection":
      if (focusedPane === "tree") {
        return context.selectedTreeTargetPath !== null;
      }
      return selectedCount > 0;
    case "pasteSelection":
      return hasClipboardItems(context.copyPasteClipboard) && context.pasteDestinationPath !== null;
    case "showClipboard":
    case "clearClipboard":
      return hasClipboardItems(context.copyPasteClipboard);
    case "copyPath":
      if (focusedPane === "tree") {
        return context.selectedTreeTargetPath !== null;
      }
      return selectedCount > 0;
    case "openSelectionInNewTab":
      return resolveNewTabTargetPath({ ...context, focusedPane }) !== null;
    case "quickLookSelection":
      return context.selectedEntry !== null;
    case "toggleFavorite":
      return resolveFavoriteTargetPath({ ...context, focusedPane }) !== null;
    case "showInFinder":
      return resolveShowInFinderPaths({ ...context, focusedPane }).length > 0;
    case "showLastSearchResults":
      return context.hasCachedSearch !== false && !context.isSearchMode;
    case "sortByName":
    case "sortByModified":
    case "sortBySize":
    case "sortByKind":
    case "toggleFoldersFirst":
      // Search results have an order of their own, chosen in the List view's headers.
      return !context.isSearchMode;
    case "goBack":
      return context.canGoBack !== false;
    case "goForward":
      return context.canGoForward !== false;
    case "goEnclosingFolder":
      return context.currentPath.length > 0 && parentDirectoryPath(context.currentPath) !== null;
    case "selectNextTab":
    case "selectPreviousTab":
      return context.tabCount === undefined || context.tabCount > 1;
    default:
      return true;
  }
}
