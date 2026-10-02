import type { RendererCommandType } from "./rendererCommands";
import type { ShortcutCommandId } from "./shortcuts";

export type ToolbarIconName =
  | "back"
  | "forward"
  | "home"
  | "up"
  | "down"
  | "location"
  | "hidden"
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
  | "applications"
  | "drive"
  | "trash"
  | "rerootHome"
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
  | "separatorHorizontal"
  | "more"
  | "sort"
  | "title"
  | "clipboard";

export type ToolbarSurface = "top" | "left";
export type ToolbarItemKind = "button" | "toggle" | "menu" | "composite" | "separator";
export type LeftToolbarZone = "main" | "utility";

export type ToolbarItemId =
  | "back"
  | "forward"
  | "up"
  | "down"
  | "refresh"
  | "view"
  | "sort"
  | "title"
  | "clipboard"
  | "viewOptions"
  | "search"
  | "home"
  | "root"
  | "applications"
  | "trash"
  | "rerootHome"
  | "goToFolder"
  | "foldersFirst"
  | "hidden"
  | "infoPanel"
  | "infoRow"
  | "help"
  | "theme"
  | "settings"
  | "openSelection"
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
  | "copyPath"
  | "topSeparator"
  | "leftSeparator";

export type LeftToolbarItems = {
  main: ToolbarItemId[];
  utility: ToolbarItemId[];
};

export type ToolbarItemDefinition = {
  id: ToolbarItemId;
  label: string;
  icon: ToolbarIconName;
  kind: ToolbarItemKind;
  surfaces: readonly ToolbarSurface[];
  commandType?: RendererCommandType;
  // Always in the top toolbar: it can be moved there, but not taken off.
  topRequired?: boolean;
  // The command whose shortcut the tooltip shows.
  shortcutCommand?: ShortcutCommandId;
  // The command's full name, where the label is a shorter one for the Settings tiles.
  tooltipLabel?: string;
  allowDuplicates?: boolean;
  leftZones?: readonly LeftToolbarZone[];
};

export const TOOLBAR_ITEM_DEFINITIONS = [
  {
    id: "back",
    label: "Back",
    icon: "back",
    kind: "button",
    surfaces: ["top"],
    shortcutCommand: "goBack",
  },
  {
    id: "forward",
    label: "Forward",
    icon: "forward",
    kind: "button",
    surfaces: ["top"],
    shortcutCommand: "goForward",
  },
  {
    id: "up",
    label: "Enclosing Folder",
    icon: "up",
    kind: "button",
    surfaces: ["top"],
    shortcutCommand: "goEnclosingFolder",
  },
  {
    id: "down",
    label: "Open Selected Item",
    icon: "down",
    kind: "button",
    surfaces: ["top"],
    shortcutCommand: "openSelectedItem",
  },
  {
    id: "refresh",
    label: "Refresh",
    icon: "refresh",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "refreshOrApplySearchSort",
    shortcutCommand: "refreshOrApplySearchSort",
  },
  {
    id: "topSeparator",
    label: "Separator",
    icon: "separatorVertical",
    kind: "separator",
    surfaces: ["top"],
    allowDuplicates: true,
  },
  {
    id: "view",
    label: "View Mode",
    icon: "list",
    kind: "composite",
    surfaces: ["top"],
  },
  {
    id: "sort",
    label: "Sort",
    icon: "sortAsc",
    kind: "composite",
    surfaces: ["top"],
  },
  {
    id: "title",
    label: "Title",
    icon: "title",
    kind: "composite",
    surfaces: ["top"],
    topRequired: true,
  },
  {
    id: "clipboard",
    label: "Clipboard",
    icon: "clipboard",
    kind: "menu",
    surfaces: ["top"],
    topRequired: true,
  },
  {
    id: "viewOptions",
    label: "View Options",
    icon: "more",
    kind: "menu",
    surfaces: ["top"],
    topRequired: true,
  },
  {
    id: "search",
    label: "Search",
    icon: "search",
    kind: "composite",
    surfaces: ["top"],
    topRequired: true,
  },
  {
    id: "home",
    label: "Home",
    icon: "home",
    kind: "button",
    surfaces: ["left"],
  },
  {
    id: "root",
    label: "Macintosh HD",
    icon: "drive",
    kind: "button",
    surfaces: ["left"],
  },
  {
    id: "applications",
    label: "Applications",
    icon: "applications",
    kind: "button",
    surfaces: ["left"],
  },
  {
    id: "trash",
    label: "Trash",
    icon: "trash",
    kind: "button",
    surfaces: ["left"],
  },
  {
    id: "rerootHome",
    label: "Root Tree at Home",
    icon: "rerootHome",
    kind: "button",
    surfaces: ["left"],
  },
  {
    id: "goToFolder",
    label: "Go To",
    icon: "location",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "openLocationSheet",
    shortcutCommand: "openLocationSheet",
  },
  {
    id: "foldersFirst",
    label: "Folders First",
    icon: "foldersFirst",
    kind: "toggle",
    surfaces: ["top", "left"],
    shortcutCommand: "toggleFoldersFirst",
  },
  {
    id: "hidden",
    label: "Hidden Files",
    icon: "hidden",
    kind: "toggle",
    surfaces: ["top", "left"],
    shortcutCommand: "toggleHiddenFiles",
  },
  {
    id: "infoPanel",
    label: "Info Panel",
    icon: "drawer",
    kind: "toggle",
    surfaces: ["top", "left"],
    commandType: "toggleInfoPanel",
    shortcutCommand: "toggleInfoPanel",
  },
  {
    id: "infoRow",
    label: "Info Row",
    icon: "infoRow",
    kind: "toggle",
    surfaces: ["top", "left"],
    commandType: "toggleInfoRow",
    shortcutCommand: "toggleInfoRow",
  },
  {
    id: "help",
    label: "Help",
    icon: "help",
    kind: "button",
    surfaces: ["left"],
    shortcutCommand: "openHelp",
  },
  {
    id: "theme",
    label: "Theme",
    icon: "theme",
    kind: "menu",
    surfaces: ["left"],
    leftZones: ["utility"],
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    kind: "button",
    surfaces: ["left"],
    commandType: "openSettings",
    shortcutCommand: "settings",
    leftZones: ["utility"],
  },
  {
    id: "leftSeparator",
    label: "Separator",
    icon: "separatorHorizontal",
    kind: "separator",
    surfaces: ["left"],
    allowDuplicates: true,
  },
  {
    id: "openSelection",
    label: "Open",
    icon: "open",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "openSelection",
    shortcutCommand: "openSelection",
  },
  {
    id: "editSelection",
    label: "Edit",
    tooltipLabel: "Edit in Text Editor",
    icon: "edit",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "editSelection",
    shortcutCommand: "editSelection",
  },
  {
    id: "moveSelection",
    label: "Move To",
    icon: "move",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "moveSelection",
    shortcutCommand: "moveSelection",
  },
  {
    id: "renameSelection",
    label: "Rename",
    icon: "rename",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "renameSelection",
    shortcutCommand: "renameSelection",
  },
  {
    id: "duplicateSelection",
    label: "Duplicate",
    icon: "duplicate",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "duplicateSelection",
    shortcutCommand: "duplicateSelection",
  },
  {
    id: "newFolder",
    label: "New Folder",
    icon: "newFolder",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "newFolder",
    shortcutCommand: "newFolder",
  },
  {
    id: "trashSelection",
    label: "Move to Trash",
    icon: "trash",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "trashSelection",
    shortcutCommand: "trashSelection",
  },
  {
    id: "copySelection",
    label: "Copy",
    icon: "copy",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "copySelection",
    shortcutCommand: "copy",
  },
  {
    id: "cutSelection",
    label: "Cut",
    icon: "cut",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "cutSelection",
    shortcutCommand: "cut",
  },
  {
    id: "pasteSelection",
    label: "Paste",
    icon: "paste",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "pasteSelection",
    shortcutCommand: "paste",
  },
  {
    id: "openInTerminal",
    label: "Open in Terminal",
    icon: "terminal",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "openInTerminal",
    shortcutCommand: "openInTerminal",
  },
  {
    id: "copyPath",
    label: "Copy Path",
    icon: "copyPath",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "copyPath",
    shortcutCommand: "copyPath",
  },
] as const satisfies ReadonlyArray<ToolbarItemDefinition>;

export const TOOLBAR_ITEM_IDS = TOOLBAR_ITEM_DEFINITIONS.map((item) => item.id) as ToolbarItemId[];

// The default: Back and Forward, the folder title, then (pushed to the far end by the
// title, which takes the spare room) the controls for how the list is shown, the search
// field, and the two that close the toolbar.
// - The clipboard button comes and goes, so it is the first item after the title: there it
//   takes its room from the title, and no button moves when something is copied.
// - View Options is a menu of everything else, so it sits past the search field.
// - Info Panel is last, over the panel it opens, and so the first to go in a narrow window
//   (View Options has the same toggle).
// Up/Down/Refresh and the rest remain available in toolbar customization.
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
export const PREVIOUS_DEFAULT_TOP_TOOLBARS: ReadonlyArray<readonly ToolbarItemId[]> = [
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

export const DEFAULT_LEFT_TOOLBAR_ITEMS: LeftToolbarItems = {
  main: [
    "home",
    "root",
    "applications",
    "trash",
    "leftSeparator",
    "rerootHome",
    "goToFolder",
    "leftSeparator",
    "foldersFirst",
    "hidden",
    "infoPanel",
    "infoRow",
  ],
  utility: ["help", "leftSeparator", "theme", "settings"],
};

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

export function getToolbarItemsForSurface(surface: ToolbarSurface): ToolbarItemDefinition[] {
  return TOOLBAR_ITEM_DEFINITIONS.filter((item) =>
    (item.surfaces as readonly ToolbarSurface[]).includes(surface),
  );
}

export function getToolbarItemsForLeftZone(zone: LeftToolbarZone): ToolbarItemDefinition[] {
  return TOOLBAR_ITEM_DEFINITIONS.filter((item) => {
    const definition = item as ToolbarItemDefinition;
    return (
      definition.surfaces.includes("left") &&
      (!definition.leftZones || definition.leftZones.includes(zone))
    );
  });
}

export function isToolbarItemAllowedOnSurface(id: ToolbarItemId, surface: ToolbarSurface): boolean {
  const definition = getToolbarItemDefinition(id);
  return (definition.surfaces as readonly ToolbarSurface[]).includes(surface);
}

export function isToolbarItemAllowedInLeftZone(id: ToolbarItemId, zone: LeftToolbarZone): boolean {
  const definition = getToolbarItemDefinition(id);
  if (!definition.surfaces.includes("left")) {
    return false;
  }
  return !definition.leftZones || definition.leftZones.includes(zone);
}

function sanitizeToolbarItemList(
  value: unknown,
  surface: ToolbarSurface,
  leftZone?: LeftToolbarZone,
  seen: Set<ToolbarItemId> | null = null,
): ToolbarItemId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const localSeen = seen ?? new Set<ToolbarItemId>();
  const result: ToolbarItemId[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !isToolbarItemId(candidate)) {
      continue;
    }
    const definition = getToolbarItemDefinition(candidate);
    if (!isToolbarItemAllowedOnSurface(candidate, surface)) {
      continue;
    }
    if (surface === "left" && leftZone && !isToolbarItemAllowedInLeftZone(candidate, leftZone)) {
      continue;
    }
    if (!definition.allowDuplicates && localSeen.has(candidate)) {
      continue;
    }
    if (!definition.allowDuplicates) {
      localSeen.add(candidate);
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
  let next = sanitizeToolbarItemList(value, "top");
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

export function sanitizeLeftToolbarItems(value: unknown): LeftToolbarItems {
  if (typeof value !== "object" || value === null) {
    return {
      main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
      utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
    };
  }
  // The left and bottom rails are shown independently, so each keeps its own list and the
  // same item may be on both.
  const record = value as { main?: unknown; utility?: unknown };
  return {
    main: sanitizeToolbarItemList(record.main, "left", "main"),
    utility: sanitizeToolbarItemList(record.utility, "left", "utility"),
  };
}
