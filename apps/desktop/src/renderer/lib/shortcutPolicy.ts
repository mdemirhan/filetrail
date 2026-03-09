import type { RendererCommandType } from "../../shared/rendererCommands";

type MainView = "explorer" | "help" | "settings";
type FocusedPane = "tree" | "content" | null;

export type TreeFocusShortcutBucket = "treeNavigation" | "globalExplorer" | "contentOnly";

export type ShortcutContext = {
  actionNoticeOpen: boolean;
  copyPasteModalOpen: boolean;
  focusedPane: FocusedPane;
  locationSheetOpen: boolean;
  mainView: MainView;
};

const EDIT_COMMANDS = new Set<RendererCommandType>([
  "editCut",
  "editCopy",
  "editPaste",
  "editSelectAll",
]);
const ZOOM_COMMANDS = new Set<RendererCommandType>(["zoomIn", "zoomOut", "resetZoom"]);

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
  "moveSelection",
  "newFolder",
  "openLocationSheet",
  "toggleInfoRow",
  "toggleInfoPanel",
  "pagedScrollBackward",
  "pagedScrollForward",
  "typeahead",
  "treeArrowNavigation",
  "contentArrowNavigation",
  "treeEnter",
  "contentEnter",
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
  moveSelection: "contentOnly",
  newFolder: "contentOnly",
  openLocationSheet: "globalExplorer",
  toggleInfoRow: "globalExplorer",
  toggleInfoPanel: "globalExplorer",
  pagedScrollBackward: "treeNavigation",
  pagedScrollForward: "treeNavigation",
  typeahead: "treeNavigation",
  treeArrowNavigation: "treeNavigation",
  contentArrowNavigation: "contentOnly",
  treeEnter: "treeNavigation",
  contentEnter: "contentOnly",
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

  if (
    context.focusedPane === "tree" &&
    RENDERER_COMMAND_TREE_FOCUS_BUCKETS[command] === "contentOnly"
  ) {
    return false;
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

  return RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS[shortcutId] !== "contentOnly";
}
