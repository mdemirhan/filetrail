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
  | "sort";

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
  topLocked?: boolean;
  topVisibleInMinimal?: boolean;
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
    topVisibleInMinimal: true,
  },
  {
    id: "forward",
    label: "Forward",
    icon: "forward",
    kind: "button",
    surfaces: ["top"],
    shortcutCommand: "goForward",
    topVisibleInMinimal: true,
  },
  {
    id: "up",
    label: "Enclosing Folder",
    icon: "up",
    kind: "button",
    surfaces: ["top"],
    shortcutCommand: "goEnclosingFolder",
    topVisibleInMinimal: false,
  },
  {
    id: "down",
    label: "Open Selected Item",
    icon: "down",
    kind: "button",
    surfaces: ["top"],
    shortcutCommand: "openSelectedItem",
    topVisibleInMinimal: false,
  },
  {
    id: "refresh",
    label: "Refresh",
    icon: "refresh",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "refreshOrApplySearchSort",
    shortcutCommand: "refreshOrApplySearchSort",
    topVisibleInMinimal: false,
  },
  {
    id: "topSeparator",
    label: "Separator",
    icon: "separatorVertical",
    kind: "separator",
    surfaces: ["top"],
    allowDuplicates: true,
    topVisibleInMinimal: true,
  },
  {
    id: "view",
    label: "View Mode",
    icon: "list",
    kind: "composite",
    surfaces: ["top"],
    topVisibleInMinimal: true,
  },
  {
    id: "sort",
    label: "Sort",
    icon: "sortAsc",
    kind: "composite",
    surfaces: ["top"],
    topVisibleInMinimal: false,
  },
  {
    id: "search",
    label: "Search",
    icon: "search",
    kind: "composite",
    surfaces: ["top"],
    topLocked: true,
    topVisibleInMinimal: true,
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

// Finder-like default: back/forward, then (right-aligned) view switch, sort menu, Info
// toggle and search. Up/Down/Refresh remain available in toolbar customization.
export const DEFAULT_TOP_TOOLBAR_ITEMS: ToolbarItemId[] = [
  "back",
  "forward",
  "view",
  "sort",
  "infoPanel",
  "search",
];

// The previous default. Toolbars still exactly equal to it were never customized, so they
// are upgraded to the new default when preferences load.
export const LEGACY_DEFAULT_TOP_TOOLBAR_ITEMS: readonly ToolbarItemId[] = [
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

export function sanitizeTopToolbarItems(value: unknown): ToolbarItemId[] {
  const next = sanitizeToolbarItemList(value, "top");
  if (!next.includes("search")) {
    next.push("search");
  }
  return next;
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
