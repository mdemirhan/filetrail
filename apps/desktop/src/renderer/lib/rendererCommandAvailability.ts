import type { RendererCommandType } from "../../shared/rendererCommands";
import type { ShortcutContext } from "./shortcutPolicy";
import type { CopyPasteClipboardState } from "./copyPasteClipboard";
import {
  hasClipboardItems,
} from "./copyPasteClipboard";
import {
  isEditableFileEntry,
  resolveNewFolderTargetPath,
} from "./explorerAppUtils";
import type { DirectoryEntry } from "./explorerTypes";
import { canHandleRendererCommand } from "./shortcutPolicy";

const WRITE_LOCKED_RENDERER_COMMANDS = new Set<RendererCommandType>([
  "copySelection",
  "cutSelection",
  "pasteSelection",
  "moveSelection",
  "renameSelection",
  "duplicateSelection",
  "newFolder",
  "copyPath",
  "trashSelection",
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
};

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
    case "duplicateSelection":
    case "trashSelection":
      return !context.isSearchMode && selectedCount > 0;
    case "renameSelection":
      return !context.isSearchMode && selectedCount === 1;
    case "newFolder":
      return (
        resolveNewFolderTargetPath({
          currentPath: context.currentPath,
          selectedEntry: context.selectedEntry,
          selectedPaths: context.selectedPathsInViewOrder,
          isSearchMode: context.isSearchMode,
        }) !== null
      );
    case "copySelection":
    case "cutSelection":
      return selectedCount > 0;
    case "pasteSelection":
      return hasClipboardItems(context.copyPasteClipboard) && context.pasteDestinationPath !== null;
    case "copyPath":
      if (focusedPane === "tree") {
        return context.selectedTreeTargetPath !== null;
      }
      return selectedCount > 0;
    default:
      return true;
  }
}
