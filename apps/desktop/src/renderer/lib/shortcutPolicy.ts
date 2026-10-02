import type { RendererCommandType } from "../../shared/rendererCommands";
import type { ContextMenuActionId } from "./contextMenu";

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
// Paste is safe from the tree: it goes into the tree's selected folder, which is the
// folder on screen, and never acts on a stale content selection the way copy or cut would.
const TREE_SAFE_RENDERER_COMMANDS = new Set<RendererCommandType>([
  "openSelection",
  "openSelectionInNewTab",
  "openInTerminal",
  "copyPath",
  "pasteSelection",
]);
// Help opens from anywhere a menu can be used, including the Help page itself.
const HELP_COMMANDS = new Set<RendererCommandType>(["openHelp", "openKeyboardShortcuts"]);
const TREE_SAFE_RAW_SHORTCUTS = new Set<RawExplorerShortcutId>([
  "copyPath",
  "openInTerminal",
  "pasteSelection",
]);
const CONTEXT_MENU_SHORTCUT_LABELS = {
  open: "⌘O",
  showInfo: "⌘I",
  edit: "⌘E",
  cut: "⌘X",
  copy: "⌘C",
  paste: "⌘V",
  move: "⇧⌘M",
  rename: "↩",
  duplicate: "⌘D",
  newFolder: "⇧⌘N",
  terminal: "⌥⌘T",
  copyPath: "⌥⌘C",
  rootTreeHere: "⇧⌘R",
  trash: "⌘⌫",
} as const satisfies Partial<Record<ContextMenuActionId, string>>;

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
  copySelection: "contentOnly",
  cutSelection: "contentOnly",
  pasteSelection: "contentOnly",
  copyPath: "contentOnly",
  refreshOrApplySearchSort: "globalExplorer",
  toggleInfoPanel: "globalExplorer",
  toggleInfoRow: "globalExplorer",
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
          isSafeTreeTargetKind(context.selectedTreeTargetKind) && context.mainView === "explorer"
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
    TREE_SAFE_RAW_SHORTCUTS.has(shortcutId) && isSafeTreeTargetKind(context.selectedTreeTargetKind)
  );
}

export function getContextMenuShortcutLabel(
  actionId: ContextMenuActionId,
  context: ShortcutContext,
): string | null {
  if (actionId === "open" && canHandleRendererCommand("openSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.open ?? null;
  }
  if (actionId === "showInfo" && canHandleRendererCommand("toggleInfoPanel", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.showInfo ?? null;
  }
  if (actionId === "edit" && canHandleRendererCommand("editSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.edit ?? null;
  }
  if (actionId === "cut" && canHandleRawExplorerShortcut("cutSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.cut ?? null;
  }
  if (actionId === "copy" && canHandleRawExplorerShortcut("copySelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.copy ?? null;
  }
  // A tree or favorite menu pastes into the right-clicked folder, while Cmd+V from the
  // tree pastes into the selected one, so the badge would promise the wrong target.
  if (
    actionId === "paste" &&
    context.focusedPane !== "tree" &&
    canHandleRawExplorerShortcut("pasteSelection", context)
  ) {
    return CONTEXT_MENU_SHORTCUT_LABELS.paste ?? null;
  }
  if (actionId === "move" && canHandleRawExplorerShortcut("moveSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.move ?? null;
  }
  if (actionId === "rename" && canHandleRawExplorerShortcut("renameSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.rename ?? null;
  }
  if (actionId === "duplicate" && canHandleRawExplorerShortcut("duplicateSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.duplicate ?? null;
  }
  if (actionId === "newFolder" && canHandleRawExplorerShortcut("newFolder", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.newFolder ?? null;
  }
  if (actionId === "terminal" && canHandleRendererCommand("openInTerminal", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.terminal ?? null;
  }
  if (
    actionId === "copyPath" &&
    (canHandleRawExplorerShortcut("copyPath", context) ||
      canHandleRendererCommand("copyPath", context))
  ) {
    return CONTEXT_MENU_SHORTCUT_LABELS.copyPath ?? null;
  }
  if (actionId === "rootTreeHere" && canHandleRendererCommand("rootTreeAtSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.rootTreeHere ?? null;
  }
  if (actionId === "trash" && canHandleRawExplorerShortcut("trashSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.trash ?? null;
  }

  return null;
}

function isSafeTreeTargetKind(kind: SelectedTreeTargetKind): boolean {
  return kind === "filesystemFolder" || kind === "favorite";
}
