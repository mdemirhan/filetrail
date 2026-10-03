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
  | "sort"
  | "title"
  | "clipboard"
  | "newTab"
  | "quickLook"
  | "showInFinder";

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
    id: "topSeparator",
    label: "Separator",
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
    icon: "clipboard",
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

// The default: Back and Forward, the folder title, then (pushed to the far end by the
// title, which takes the spare room) the controls for how the list is shown, the search
// field, and the two that close the toolbar.
// - The clipboard button comes and goes, so it is the first item after the title: there it
//   takes its room from the title, and no button moves when something is copied.
// - View Options is a menu rather than a control of its own, so it sits past the search field.
// - Info Panel is last, over the panel it opens, and so the first to go in a narrow window
//   (View Options has the same toggle).
// Everything else can be added in Settings.
export const DEFAULT_TOP_TOOLBAR_ITEMS: ToolbarItemId[] = [
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

// The defaults before this one, as they were saved. A toolbar still exactly equal to one of
// them was never customized, so it is given the new default when preferences load.
// (Plain strings: one of them holds an item that no longer exists.)
export const PREVIOUS_DEFAULT_TOP_TOOLBARS: ReadonlyArray<readonly string[]> = [
  [
    "back",
    "forward",
    "topSeparator",
    "up",
    "down",
    "refresh",
    "topSeparator",
    "view",
    "sort",
    "search",
  ],
  // Saved before the title, the clipboard button and View Options were in the list.
  ["back", "forward", "view", "sort", "infoPanel", "search"],
  ["back", "forward", "title", "view", "sort", "infoPanel", "clipboard", "viewOptions", "search"],
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

// Where a toolbar saved before the title could be moved drew it: after Back and Forward
// when they led the toolbar, otherwise first.
const LEGACY_LEADING_TOP_TOOLBAR_ITEMS = new Set<ToolbarItemId>(["back", "forward"]);

// Every top toolbar holds the title, the clipboard button, View Options and search. A list
// without them is given them where they were drawn while their places were fixed: the title
// after a leading Back and Forward, search last, and the other two just ahead of search.
export function sanitizeTopToolbarItems(value: unknown): ToolbarItemId[] {
  let next = sanitizeToolbarItemList(value);
  if (!next.includes("title")) {
    // Until the title could be moved, search was drawn last wherever the list had it.
    const rest = next.filter((itemId) => itemId !== "search");
    const firstOtherIndex = rest.findIndex(
      (itemId) => !LEGACY_LEADING_TOP_TOOLBAR_ITEMS.has(itemId),
    );
    const leadingCount = firstOtherIndex === -1 ? rest.length : firstOtherIndex;
    next = [...rest.slice(0, leadingCount), "title", ...rest.slice(leadingCount), "search"];
  }
  if (!next.includes("search")) {
    next.push("search");
  }
  for (const itemId of ["clipboard", "viewOptions"] as const) {
    if (!next.includes(itemId)) {
      next.splice(next.indexOf("search"), 0, itemId);
    }
  }
  return next;
}

// Where an item added in Settings goes: with the buttons ahead of the search field (in the
// default toolbar, after Sort), and ahead of a clipboard button or View Options that sits
// right before the field. In a toolbar that starts with the search field it goes last.
export function addTopToolbarItem(
  items: readonly ToolbarItemId[],
  itemId: ToolbarItemId,
): ToolbarItemId[] {
  const searchIndex = items.indexOf("search");
  let insertIndex = searchIndex > 0 ? searchIndex : items.length;
  while (insertIndex > 0) {
    const previous = items[insertIndex - 1];
    if (previous === undefined || previous === "title" || !isRequiredTopToolbarItem(previous)) {
      break;
    }
    insertIndex -= 1;
  }
  return [...items.slice(0, insertIndex), itemId, ...items.slice(insertIndex)];
}
