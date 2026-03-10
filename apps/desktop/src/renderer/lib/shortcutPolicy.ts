import type { RendererCommandType } from "../../shared/rendererCommands";
import type { ContextMenuActionId } from "./contextMenu";

type MainView = "explorer" | "help" | "settings" | "action-log";
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
const TREE_SAFE_RENDERER_COMMANDS = new Set<RendererCommandType>([
  "openSelection",
  "openInTerminal",
  "copyPath",
]);
const TREE_SAFE_RAW_SHORTCUTS = new Set<RawExplorerShortcutId>(["copyPath", "openInTerminal"]);
const CONTEXT_MENU_SHORTCUT_LABELS = {
  open: "⌘O",
  edit: "⌘E",
  cut: "⌘X",
  copy: "⌘C",
  paste: "⌘V",
  move: "⇧⌘M",
  rename: "F2",
  duplicate: "⌘D",
  newFolder: "⇧⌘N",
  terminal: "⌘T",
  copyPath: "⌥⌘C",
  trash: "⌘⌫",
} as const satisfies Partial<Record<ContextMenuActionId, string>>;

export const RENDERER_COMMAND_TREE_FOCUS_BUCKETS = {
  editCut: "globalExplorer",
  editCopy: "globalExplorer",
  editPaste: "globalExplorer",
  editSelectAll: "globalExplorer",
  focusFileSearch: "globalExplorer",
  openActionLog: "globalExplorer",
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
  "openInTerminal",
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
  openInTerminal: "contentOnly",
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

  if (ZOOM_COMMANDS.has(command)) {
    return true;
  }

  if (command === "openSettings" || command === "openActionLog") {
    return !context.locationSheetOpen && !context.actionNoticeOpen;
  }

  if (context.actionNoticeOpen || context.locationSheetOpen || context.copyPasteModalOpen) {
    return false;
  }

  if (context.focusedPane === "tree" && RENDERER_COMMAND_TREE_FOCUS_BUCKETS[command] === "contentOnly") {
    if (TREE_SAFE_RENDERER_COMMANDS.has(command)) {
      return isSafeTreeTargetKind(context.selectedTreeTargetKind) && context.mainView === "explorer";
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

  return TREE_SAFE_RAW_SHORTCUTS.has(shortcutId) && isSafeTreeTargetKind(context.selectedTreeTargetKind);
}

export function getContextMenuShortcutLabel(
  actionId: ContextMenuActionId,
  context: ShortcutContext,
): string | null {
  if (actionId === "open" && canHandleRendererCommand("openSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.open ?? null;
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
  if (actionId === "paste" && canHandleRawExplorerShortcut("pasteSelection", context)) {
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
  if (actionId === "trash" && canHandleRawExplorerShortcut("trashSelection", context)) {
    return CONTEXT_MENU_SHORTCUT_LABELS.trash ?? null;
  }

  return null;
}

function isSafeTreeTargetKind(kind: SelectedTreeTargetKind): boolean {
  return kind === "filesystemFolder" || kind === "favorite";
}
