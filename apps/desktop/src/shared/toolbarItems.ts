import type { RendererCommandType } from "./rendererCommands";
import type { ShortcutCommandId } from "./shortcuts";

export type ToolbarIconName =
  | "back"
  | "forward"
  | "up"
  | "location"
  | "hidden"
  | "hiddenShown"
  | "refresh"
  | "icons"
  | "list"
  | "details"
  | "drawer"
  | "sidebar"
  | "edit"
  | "chevron"
  | "open"
  | "theme"
  | "close"
  | "sortAsc"
  | "sortDesc"
  | "help"
  | "settings"
  | "search"
  | "trash"
  | "infoRow"
  | "foldersFirst"
  | "copy"
  | "cut"
  | "paste"
  | "clear"
  | "stop"
  | "move"
  | "duplicate"
  | "newFolder"
  | "terminal"
  | "copyPath"
  | "rename"
  | "separatorVertical"
  | "more"
  | "overflow"
  | "sort"
  | "title"
  | "newTab"
  | "quickLook"
  | "showInFinder"
  | "revealInFolder"
  | "calculateSize";

export type ToolbarItemKind = "button" | "toggle" | "menu" | "composite" | "separator";

// The items of the toolbar over the file list. The id is what is saved in the toolbar's order.
export type ToolbarItemId =
  | "back"
  | "forward"
  | "up"
  | "refresh"
  | "view"
  | "sort"
  | "title"
  | "clipboard"
  | "viewOptions"
  | "search"
  | "goToFolder"
  | "foldersFirst"
  | "hidden"
  | "folderTree"
  | "infoPanel"
  | "infoRow"
  | "newTab"
  | "openSelection"
  | "quickLook"
  | "editSelection"
  | "moveSelection"
  | "renameSelection"
  | "duplicateSelection"
  | "newFolder"
  | "trashSelection"
  | "copySelection"
  | "cutSelection"
  | "pasteSelection"
  | "openInTerminal"
  | "showInFinder"
  | "revealInFolder"
  | "calculateSize"
  | "copyPath"
  | "theme"
  | "settings"
  | "help"
  | "topSeparator";

export type ToolbarItemDefinition = {
  id: ToolbarItemId;
  label: string;
  icon: ToolbarIconName;
  kind: ToolbarItemKind;
  commandType?: RendererCommandType;
  // Always in the toolbar: it can be moved there, but not taken off.
  topRequired?: boolean;
  // The command whose shortcut the tooltip shows.
  shortcutCommand?: ShortcutCommandId;
  // The command's full name, where the label is a shorter one for the Settings tiles.
  tooltipLabel?: string;
  allowDuplicates?: boolean;
};

export const TOOLBAR_ITEM_DEFINITIONS = [
  {
    id: "back",
    label: "Back",
    icon: "back",
    kind: "button",
    shortcutCommand: "goBack",
  },
  {
    id: "forward",
    label: "Forward",
    icon: "forward",
    kind: "button",
    shortcutCommand: "goForward",
  },
  {
    id: "up",
    label: "Enclosing Folder",
    icon: "up",
    kind: "button",
    shortcutCommand: "goEnclosingFolder",
  },
  {
    id: "refresh",
    label: "Refresh",
    icon: "refresh",
    kind: "button",
    commandType: "refreshOrApplySearchSort",
    shortcutCommand: "refreshOrApplySearchSort",
  },
  {
    // A space between two runs of buttons: each run sits on a capsule of its own.
    id: "topSeparator",
    label: "Space",
    icon: "separatorVertical",
    kind: "separator",
    allowDuplicates: true,
  },
  {
    id: "view",
    label: "View Mode",
    icon: "list",
    kind: "composite",
  },
  {
    id: "sort",
    label: "Sort",
    icon: "sort",
    kind: "composite",
  },
  {
    id: "title",
    label: "Title",
    icon: "title",
    kind: "composite",
    topRequired: true,
  },
  {
    id: "clipboard",
    label: "Clipboard",
    // The button's own look while items are copied, so it is the same wherever it is shown.
    icon: "copy",
    kind: "menu",
    topRequired: true,
  },
  {
    id: "viewOptions",
    label: "View Options",
    icon: "more",
    kind: "menu",
    topRequired: true,
  },
  {
    id: "search",
    label: "Search",
    icon: "search",
    kind: "composite",
    topRequired: true,
  },
  {
    id: "goToFolder",
    label: "Go To",
    icon: "location",
    kind: "button",
    commandType: "openLocationSheet",
    shortcutCommand: "openLocationSheet",
  },
  {
    id: "foldersFirst",
    label: "Folders First",
    icon: "foldersFirst",
    kind: "toggle",
    shortcutCommand: "toggleFoldersFirst",
  },
  {
    id: "hidden",
    label: "Hidden Files",
    icon: "hidden",
    kind: "toggle",
    shortcutCommand: "toggleHiddenFiles",
  },
  {
    id: "folderTree",
    label: "Folder Tree",
    icon: "sidebar",
    kind: "toggle",
    commandType: "toggleFolderTree",
    shortcutCommand: "toggleFolderTree",
  },
  {
    id: "infoPanel",
    label: "Info Panel",
    icon: "drawer",
    kind: "toggle",
    commandType: "toggleInfoPanel",
    shortcutCommand: "toggleInfoPanel",
  },
  {
    id: "infoRow",
    label: "Info Row",
    icon: "infoRow",
    kind: "toggle",
    commandType: "toggleInfoRow",
    shortcutCommand: "toggleInfoRow",
  },
  {
    id: "newTab",
    label: "New Tab",
    icon: "newTab",
    kind: "button",
    commandType: "newTab",
    shortcutCommand: "newTab",
  },
  {
    id: "openSelection",
    label: "Open",
    icon: "open",
    kind: "button",
    commandType: "openSelection",
    shortcutCommand: "openSelection",
  },
  {
    id: "quickLook",
    label: "Quick Look",
    icon: "quickLook",
    kind: "button",
    commandType: "quickLookSelection",
    shortcutCommand: "quickLookSelection",
  },
  {
    id: "editSelection",
    label: "Edit",
    tooltipLabel: "Edit in Text Editor",
    icon: "edit",
    kind: "button",
    commandType: "editSelection",
    shortcutCommand: "editSelection",
  },
  {
    id: "moveSelection",
    label: "Move To",
    icon: "move",
    kind: "button",
    commandType: "moveSelection",
    shortcutCommand: "moveSelection",
  },
  {
    id: "renameSelection",
    label: "Rename",
    icon: "rename",
    kind: "button",
    commandType: "renameSelection",
    shortcutCommand: "renameSelection",
  },
  {
    id: "duplicateSelection",
    label: "Duplicate",
    icon: "duplicate",
    kind: "button",
    commandType: "duplicateSelection",
    shortcutCommand: "duplicateSelection",
  },
  {
    id: "newFolder",
    label: "New Folder",
    icon: "newFolder",
    kind: "button",
    commandType: "newFolder",
    shortcutCommand: "newFolder",
  },
  {
    id: "trashSelection",
    label: "Move to Trash",
    icon: "trash",
    kind: "button",
    commandType: "trashSelection",
    shortcutCommand: "trashSelection",
  },
  {
    id: "copySelection",
    label: "Copy",
    icon: "copy",
    kind: "button",
    commandType: "copySelection",
    shortcutCommand: "copy",
  },
  {
    id: "cutSelection",
    label: "Cut",
    icon: "cut",
    kind: "button",
    commandType: "cutSelection",
    shortcutCommand: "cut",
  },
  {
    id: "pasteSelection",
    label: "Paste",
    icon: "paste",
    kind: "button",
    commandType: "pasteSelection",
    shortcutCommand: "paste",
  },
  {
    id: "openInTerminal",
    label: "Open in Terminal",
    icon: "terminal",
    kind: "button",
    commandType: "openInTerminal",
    shortcutCommand: "openInTerminal",
  },
  {
    id: "showInFinder",
    label: "Show in Finder",
    icon: "showInFinder",
    kind: "button",
    commandType: "showInFinder",
    shortcutCommand: "showInFinder",
  },
  {
    id: "revealInFolder",
    label: "Reveal in Folder",
    icon: "revealInFolder",
    kind: "button",
    commandType: "revealInFolder",
    shortcutCommand: "revealInFolder",
  },
  {
    id: "calculateSize",
    label: "Calculate Size",
    icon: "calculateSize",
    kind: "button",
    commandType: "calculateSize",
    shortcutCommand: "calculateSize",
  },
  {
    id: "copyPath",
    label: "Copy Path",
    icon: "copyPath",
    kind: "button",
    commandType: "copyPath",
    shortcutCommand: "copyPath",
  },
  {
    id: "theme",
    label: "Theme",
    icon: "theme",
    kind: "menu",
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    kind: "button",
    commandType: "openSettings",
    shortcutCommand: "settings",
  },
  {
    id: "help",
    label: "Help",
    tooltipLabel: "File Trail Help",
    icon: "help",
    kind: "button",
    commandType: "openHelp",
    shortcutCommand: "openHelp",
  },
] as const satisfies ReadonlyArray<ToolbarItemDefinition>;

export const TOOLBAR_ITEM_IDS = TOOLBAR_ITEM_DEFINITIONS.map((item) => item.id) as ToolbarItemId[];

// The default: the folder tree's button (where Finder has its sidebar's), a space to set it
// apart, Back and Forward, the folder title, then (pushed to the far end by the
// title, which takes the spare room) the controls for how the list is shown, the search
// field, and the two that close the toolbar.
// - The clipboard button comes and goes, so it is the first item after the title: there it
//   takes its room from the title, and no button moves when something is copied.
// - View Options is a menu rather than a control of its own, so it sits past the search field.
// - Info Panel is last, over the panel it opens, and so the first to go in a narrow window
//   (View Options has the same toggle).
// Everything else can be added with View > Customize Toolbar.
export const DEFAULT_TOP_TOOLBAR_ITEMS: ToolbarItemId[] = [
  "folderTree",
  "topSeparator",
  "back",
  "forward",
  "title",
  "clipboard",
  "view",
  "sort",
  "search",
  "viewOptions",
  "infoPanel",
];

const TOOLBAR_ITEM_ID_SET = new Set<ToolbarItemId>(TOOLBAR_ITEM_IDS);
const TOOLBAR_ITEM_BY_ID = new Map<ToolbarItemId, ToolbarItemDefinition>(
  TOOLBAR_ITEM_DEFINITIONS.map((item) => [item.id, item]),
);

export function isToolbarItemId(value: string): value is ToolbarItemId {
  return TOOLBAR_ITEM_ID_SET.has(value as ToolbarItemId);
}

export function getToolbarItemDefinition(id: ToolbarItemId): ToolbarItemDefinition {
  const definition = TOOLBAR_ITEM_BY_ID.get(id);
  if (!definition) {
    throw new Error(`Unknown toolbar item: ${id}`);
  }
  return definition;
}

// An unknown or repeated item is dropped; a separator may repeat.
function sanitizeToolbarItemList(value: unknown): ToolbarItemId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<ToolbarItemId>();
  const result: ToolbarItemId[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !isToolbarItemId(candidate)) {
      continue;
    }
    if (!getToolbarItemDefinition(candidate).allowDuplicates) {
      if (seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
    }
    result.push(candidate);
  }
  return result;
}

export function isRequiredTopToolbarItem(id: ToolbarItemId): boolean {
  return getToolbarItemDefinition(id).topRequired === true;
}

// The four items every top toolbar holds, in the default's order.
const REQUIRED_TOP_TOOLBAR_ITEMS = DEFAULT_TOP_TOOLBAR_ITEMS.filter(isRequiredTopToolbarItem);

// Every top toolbar holds the title, the clipboard button, search and View Options; a list
// without one of them gets it at the end.
export function sanitizeTopToolbarItems(value: unknown): ToolbarItemId[] {
  const next = sanitizeToolbarItemList(value);
  return [...next, ...REQUIRED_TOP_TOOLBAR_ITEMS.filter((itemId) => !next.includes(itemId))];
}

// The items offered while the toolbar is customized, in this order: moving about, how the
// list is shown, what can be done with the selection, and the app itself. The four that are
// always in the toolbar are never offered.
const TOP_TOOLBAR_PALETTE_ORDER: readonly ToolbarItemId[] = [
  "topSeparator",
  "back",
  "forward",
  "up",
  "goToFolder",
  "revealInFolder",
  "refresh",
  "newTab",
  "view",
  "sort",
  "foldersFirst",
  "hidden",
  "folderTree",
  "infoPanel",
  "infoRow",
  "calculateSize",
  "openSelection",
  "quickLook",
  "editSelection",
  "copySelection",
  "cutSelection",
  "pasteSelection",
  "renameSelection",
  "moveSelection",
  "duplicateSelection",
  "newFolder",
  "trashSelection",
  "openInTerminal",
  "showInFinder",
  "copyPath",
  "theme",
  "settings",
  "help",
];

// What can still be put in the toolbar: every item it does not hold yet, and the space,
// which it can hold any number of times.
export function getTopToolbarPaletteItems(items: readonly ToolbarItemId[]): ToolbarItemId[] {
  return TOP_TOOLBAR_PALETTE_ORDER.filter(
    (itemId) => getToolbarItemDefinition(itemId).allowDuplicates || !items.includes(itemId),
  );
}

// An item clicked in the palette goes at the far right, where it is easy to find.
export function addTopToolbarItem(
  items: readonly ToolbarItemId[],
  itemId: ToolbarItemId,
): ToolbarItemId[] {
  return insertTopToolbarItem(items, itemId, items.length);
}

// An item dropped into the toolbar, at `index` in its order (clamped to the ends).
export function insertTopToolbarItem(
  items: readonly ToolbarItemId[],
  itemId: ToolbarItemId,
  index: number,
): ToolbarItemId[] {
  const at = Math.max(0, Math.min(index, items.length));
  return [...items.slice(0, at), itemId, ...items.slice(at)];
}

// The item at `from` taken out and put back at `to`, an index in the order without it.
export function moveTopToolbarItem(
  items: readonly ToolbarItemId[],
  from: number,
  to: number,
): ToolbarItemId[] {
  const itemId = items[from];
  if (itemId === undefined) {
    return [...items];
  }
  return insertTopToolbarItem(
    items.filter((_, index) => index !== from),
    itemId,
    to,
  );
}

// The item at `index` taken off the toolbar, unless it is one that always stays.
export function removeTopToolbarItem(
  items: readonly ToolbarItemId[],
  index: number,
): ToolbarItemId[] {
  const itemId = items[index];
  if (itemId === undefined || isRequiredTopToolbarItem(itemId)) {
    return [...items];
  }
  return items.filter((_, candidate) => candidate !== index);
}
