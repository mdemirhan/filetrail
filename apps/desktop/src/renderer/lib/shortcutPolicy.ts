import type { RendererCommandType } from "../../shared/rendererCommands";
import type { ShortcutCommandId } from "../../shared/shortcuts";
import type { ContextMenuActionId } from "./contextMenu";
import { DEFAULT_SHORTCUT_DISPLAY, type ShortcutDisplay } from "./shortcutDisplay";

type MainView = "explorer" | "help" | "settings";
type FocusedPane = "tree" | "content" | null;
export type SelectedTreeTargetKind = "filesystemFolder" | "favorite" | "favoritesRoot" | null;

export type TreeFocusShortcutBucket = "treeNavigation" | "globalExplorer" | "contentOnly";

export type ShortcutContext = {
  actionNoticeOpen: boolean;
  copyPasteModalOpen: boolean;
  focusedPane: FocusedPane;
  locationSheetOpen: boolean;
  mainView: MainView;
  selectedTreeTargetKind: SelectedTreeTargetKind;
};

const EDIT_COMMANDS = new Set<RendererCommandType>([
  "editCut",
  "editCopy",
  "editPaste",
  "editSelectAll",
]);
const ZOOM_COMMANDS = new Set<RendererCommandType>(["zoomIn", "zoomOut", "resetZoom"]);
// Content commands that also work from the tree, on its selected folder and never on a
// selection left behind in the file list. Paste goes into that folder; copy and cut take
// the folder itself.
const TREE_SAFE_RENDERER_COMMANDS = new Set<RendererCommandType>([
  "openSelection",
  "openSelectionInNewTab",
  "openInTerminal",
  "copyPath",
  "copySelection",
  "cutSelection",
  "pasteSelection",
]);
// A favorite is a pointer to a folder, not something to copy or move: these act on folders
// of the tree only, as the favorite's right-click menu does.
const TREE_FOLDER_ONLY_COMMANDS = new Set<string>(["copySelection", "cutSelection"]);
// Help opens from anywhere a menu can be used, including the Help page itself.
const HELP_COMMANDS = new Set<RendererCommandType>(["openHelp", "openKeyboardShortcuts"]);
const TREE_SAFE_RAW_SHORTCUTS = new Set<RawExplorerShortcutId>([
  "copyPath",
  "openInTerminal",
  "copySelection",
  "cutSelection",
  "pasteSelection",
]);
// The command whose shortcut a context-menu item shows.
const CONTEXT_MENU_SHORTCUT_COMMANDS = {
  open: "openSelection",
  showInfo: "toggleInfoPanel",
  edit: "editSelection",
  cut: "cut",
  copy: "copy",
  paste: "paste",
  move: "moveSelection",
  rename: "renameSelection",
  duplicate: "duplicateSelection",
  newFolder: "newFolder",
  terminal: "openInTerminal",
  copyPath: "copyPath",
  rootTreeHere: "rootTreeAtSelection",
  trash: "trashSelection",
} as const satisfies Partial<Record<ContextMenuActionId, ShortcutCommandId>>;

export const RENDERER_COMMAND_TREE_FOCUS_BUCKETS = {
  editCut: "globalExplorer",
  editCopy: "globalExplorer",
  editPaste: "globalExplorer",
  editSelectAll: "globalExplorer",
  focusFileSearch: "globalExplorer",
  openSelection: "contentOnly",
  editSelection: "contentOnly",
  openLocationSheet: "globalExplorer",
  openSettings: "globalExplorer",
  zoomIn: "globalExplorer",
  zoomOut: "globalExplorer",
  resetZoom: "globalExplorer",
  openInTerminal: "contentOnly",
  moveSelection: "contentOnly",
  renameSelection: "contentOnly",
  duplicateSelection: "contentOnly",
  newFolder: "contentOnly",
  trashSelection: "contentOnly",
  emptyTrash: "globalExplorer",
  copySelection: "contentOnly",
  cutSelection: "contentOnly",
  pasteSelection: "contentOnly",
  copyPath: "contentOnly",
  showClipboard: "globalExplorer",
  clearClipboard: "globalExplorer",
  refreshOrApplySearchSort: "globalExplorer",
  toggleInfoPanel: "globalExplorer",
  toggleInfoRow: "globalExplorer",
  customizeToolbar: "globalExplorer",
  goHomeRootTree: "globalExplorer",
  rootTreeAtSelection: "globalExplorer",
  newTab: "globalExplorer",
  reopenClosedTab: "globalExplorer",
  closeTab: "globalExplorer",
  selectNextTab: "globalExplorer",
  selectPreviousTab: "globalExplorer",
  openSelectionInNewTab: "contentOnly",
  quickLookSelection: "contentOnly",
  toggleFavorite: "globalExplorer",
  showInFinder: "globalExplorer",
  showLastSearchResults: "globalExplorer",
  viewAsIcons: "globalExplorer",
  viewAsList: "globalExplorer",
  viewAsDetails: "globalExplorer",
  sortByName: "globalExplorer",
  sortByModified: "globalExplorer",
  sortBySize: "globalExplorer",
  sortByKind: "globalExplorer",
  toggleFoldersFirst: "globalExplorer",
  toggleHiddenFiles: "globalExplorer",
  goBack: "globalExplorer",
  goForward: "globalExplorer",
  goEnclosingFolder: "globalExplorer",
  focusTreePane: "globalExplorer",
  focusContentPane: "globalExplorer",
  openHelp: "globalExplorer",
  openKeyboardShortcuts: "globalExplorer",
} as const satisfies Record<RendererCommandType, TreeFocusShortcutBucket>;

export const RAW_EXPLORER_SHORTCUT_IDS = [
  "paneTabSwitch",
  "copySelection",
  "cutSelection",
  "pasteSelection",
  "duplicateSelection",
  "trashSelection",
  "renameSelection",
  "selectAllContent",
  "focusTreePane",
  "focusContentPane",
  "showCachedSearchResults",
  "focusFileSearch",
  "historyBack",
  "historyForward",
  "openParentTree",
  "openParentContent",
  "openSelectedContentWithCommand",
  "openTreeNodeWithCommand",
  "toggleHiddenFiles",
  "refreshOrApplySearchSort",
  "copyPath",
  "openInTerminal",
  "moveSelection",
  "newFolder",
  "openLocationSheet",
  "toggleInfoRow",
  "toggleInfoPanel",
  "goHomeRootTree",
  "rootTreeAtSelection",
  "newTab",
  "reopenClosedTab",
  "closeTab",
  "selectNextTab",
  "selectPreviousTab",
  "pagedScrollBackward",
  "pagedScrollForward",
  "listFilterEdit",
  "typeahead",
  "treeArrowNavigation",
  "contentArrowNavigation",
  "treeEnter",
  "contentEnter",
  "quickLook",
] as const;

export type RawExplorerShortcutId = (typeof RAW_EXPLORER_SHORTCUT_IDS)[number];

export const RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS = {
  paneTabSwitch: "treeNavigation",
  copySelection: "contentOnly",
  cutSelection: "contentOnly",
  pasteSelection: "contentOnly",
  duplicateSelection: "contentOnly",
  trashSelection: "contentOnly",
  renameSelection: "contentOnly",
  selectAllContent: "contentOnly",
  focusTreePane: "treeNavigation",
  focusContentPane: "treeNavigation",
  showCachedSearchResults: "globalExplorer",
  focusFileSearch: "globalExplorer",
  historyBack: "globalExplorer",
  historyForward: "globalExplorer",
  openParentTree: "treeNavigation",
  openParentContent: "contentOnly",
  openSelectedContentWithCommand: "contentOnly",
  openTreeNodeWithCommand: "treeNavigation",
  toggleHiddenFiles: "globalExplorer",
  refreshOrApplySearchSort: "globalExplorer",
  copyPath: "contentOnly",
  openInTerminal: "contentOnly",
  moveSelection: "contentOnly",
  newFolder: "contentOnly",
  openLocationSheet: "globalExplorer",
  toggleInfoRow: "globalExplorer",
  toggleInfoPanel: "globalExplorer",
  goHomeRootTree: "globalExplorer",
  rootTreeAtSelection: "globalExplorer",
  newTab: "globalExplorer",
  reopenClosedTab: "globalExplorer",
  closeTab: "globalExplorer",
  selectNextTab: "globalExplorer",
  selectPreviousTab: "globalExplorer",
  pagedScrollBackward: "treeNavigation",
  pagedScrollForward: "treeNavigation",
  listFilterEdit: "contentOnly",
  typeahead: "treeNavigation",
  treeArrowNavigation: "treeNavigation",
  contentArrowNavigation: "contentOnly",
  treeEnter: "treeNavigation",
  contentEnter: "contentOnly",
  quickLook: "contentOnly",
} as const satisfies Record<RawExplorerShortcutId, TreeFocusShortcutBucket>;

// App-level view toggles such as `?` and `Cmd+,` are handled outside the explorer registry.
// This module only classifies renderer commands and raw explorer shortcuts that dispatch
// through the central keydown binding table in `App.tsx`.
export function canHandleRendererCommand(
  command: RendererCommandType,
  context: ShortcutContext,
): boolean {
  if (EDIT_COMMANDS.has(command)) {
    return true;
  }

  if (ZOOM_COMMANDS.has(command)) {
    return true;
  }

  if (command === "openSettings") {
    return !context.locationSheetOpen && !context.actionNoticeOpen;
  }

  if (context.actionNoticeOpen || context.locationSheetOpen || context.copyPasteModalOpen) {
    return false;
  }

  // ⌘W closes the tab, or the window, from the Help page as well.
  if (command === "closeTab" || HELP_COMMANDS.has(command)) {
    return true;
  }

  // Like Finder, Paste goes into the folder on screen even when no pane has focus (for
  // example right after opening an empty folder).
  if (command === "pasteSelection" && context.focusedPane === null) {
    return context.mainView === "explorer";
  }

  if (RENDERER_COMMAND_TREE_FOCUS_BUCKETS[command] === "contentOnly") {
    if (context.focusedPane === "content") {
      return context.mainView === "explorer";
    }
    if (context.focusedPane === "tree") {
      if (TREE_SAFE_RENDERER_COMMANDS.has(command)) {
        return (
          isSafeTreeTargetKind(command, context.selectedTreeTargetKind) &&
          context.mainView === "explorer"
        );
      }
      return false;
    }
    return false;
  }

  return context.mainView === "explorer";
}

export function canHandleExplorerKeyboardShortcuts(context: ShortcutContext): boolean {
  return (
    context.mainView === "explorer" &&
    !context.actionNoticeOpen &&
    !context.copyPasteModalOpen &&
    !context.locationSheetOpen
  );
}

export function canHandleRawExplorerShortcut(
  shortcutId: RawExplorerShortcutId,
  context: ShortcutContext,
): boolean {
  if (!canHandleExplorerKeyboardShortcuts(context)) {
    return false;
  }

  if (context.focusedPane !== "tree") {
    return true;
  }

  if (RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS[shortcutId] !== "contentOnly") {
    return true;
  }

  return (
    TREE_SAFE_RAW_SHORTCUTS.has(shortcutId) &&
    isSafeTreeTargetKind(shortcutId, context.selectedTreeTargetKind)
  );
}

// The shortcut shown beside a context-menu item: only where pressing it now would do what
// the item does.
export function getContextMenuShortcutLabel(
  actionId: ContextMenuActionId,
  context: ShortcutContext,
  shortcuts: ShortcutDisplay = DEFAULT_SHORTCUT_DISPLAY,
): string | null {
  if (!(actionId in CONTEXT_MENU_SHORTCUT_COMMANDS)) {
    return null;
  }
  const action = actionId as keyof typeof CONTEXT_MENU_SHORTCUT_COMMANDS;
  return isContextMenuShortcutLive(action, context)
    ? shortcuts.label(CONTEXT_MENU_SHORTCUT_COMMANDS[action])
    : null;
}

function isContextMenuShortcutLive(
  action: keyof typeof CONTEXT_MENU_SHORTCUT_COMMANDS,
  context: ShortcutContext,
): boolean {
  switch (action) {
    case "open":
      return canHandleRendererCommand("openSelection", context);
    case "showInfo":
      return canHandleRendererCommand("toggleInfoPanel", context);
    case "edit":
      return canHandleRendererCommand("editSelection", context);
    case "cut":
      return canHandleRawExplorerShortcut("cutSelection", context);
    case "copy":
      return canHandleRawExplorerShortcut("copySelection", context);
    case "paste":
      // A tree or favorite menu pastes into the right-clicked folder, while Cmd+V from the
      // tree pastes into the selected one, so the badge would promise the wrong target.
      return (
        context.focusedPane !== "tree" && canHandleRawExplorerShortcut("pasteSelection", context)
      );
    case "move":
      return canHandleRawExplorerShortcut("moveSelection", context);
    case "rename":
      return canHandleRawExplorerShortcut("renameSelection", context);
    case "duplicate":
      return canHandleRawExplorerShortcut("duplicateSelection", context);
    case "newFolder":
      return canHandleRawExplorerShortcut("newFolder", context);
    case "terminal":
      return canHandleRendererCommand("openInTerminal", context);
    case "copyPath":
      return (
        canHandleRawExplorerShortcut("copyPath", context) ||
        canHandleRendererCommand("copyPath", context)
      );
    case "rootTreeHere":
      return canHandleRendererCommand("rootTreeAtSelection", context);
    case "trash":
      return canHandleRawExplorerShortcut("trashSelection", context);
  }
}

function isSafeTreeTargetKind(
  command: RendererCommandType | RawExplorerShortcutId,
  kind: SelectedTreeTargetKind,
): boolean {
  if (TREE_FOLDER_ONLY_COMMANDS.has(command)) {
    return kind === "filesystemFolder";
  }
  return kind === "filesystemFolder" || kind === "favorite";
}
