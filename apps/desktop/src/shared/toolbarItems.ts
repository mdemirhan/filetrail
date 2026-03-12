import type { RendererCommandType } from "./rendererCommands";

export type ToolbarIconName =
  | "back"
  | "forward"
  | "home"
  | "up"
  | "down"
  | "location"
  | "hidden"
  | "refresh"
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
  | "actionLog"
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
  | "separatorHorizontal";

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
  | "actionLog"
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
  shortcutLabel?: string;
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
    shortcutLabel: "Cmd+Left",
    topVisibleInMinimal: true,
  },
  {
    id: "forward",
    label: "Forward",
    icon: "forward",
    kind: "button",
    surfaces: ["top"],
    shortcutLabel: "Cmd+Right",
    topVisibleInMinimal: true,
  },
  {
    id: "up",
    label: "Navigate Up",
    icon: "up",
    kind: "button",
    surfaces: ["top"],
    shortcutLabel: "Cmd+Up",
    topVisibleInMinimal: false,
  },
  {
    id: "down",
    label: "Navigate Down",
    icon: "down",
    kind: "button",
    surfaces: ["top"],
    shortcutLabel: "Cmd+Down",
    topVisibleInMinimal: false,
  },
  {
    id: "refresh",
    label: "Refresh",
    icon: "refresh",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "refreshOrApplySearchSort",
    shortcutLabel: "Cmd+R",
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
    label: "Root Tree At Home",
    icon: "rerootHome",
    kind: "button",
    surfaces: ["left"],
  },
  {
    id: "goToFolder",
    label: "Go To Folder",
    icon: "location",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "openLocationSheet",
    shortcutLabel: "Cmd+Shift+G",
  },
  {
    id: "foldersFirst",
    label: "Folders First",
    icon: "foldersFirst",
    kind: "toggle",
    surfaces: ["top", "left"],
  },
  {
    id: "hidden",
    label: "Hidden Files",
    icon: "hidden",
    kind: "toggle",
    surfaces: ["top", "left"],
    shortcutLabel: "Cmd+Shift+.",
  },
  {
    id: "infoPanel",
    label: "Info Panel",
    icon: "drawer",
    kind: "toggle",
    surfaces: ["top", "left"],
    commandType: "toggleInfoPanel",
    shortcutLabel: "Cmd+I",
  },
  {
    id: "infoRow",
    label: "Info Row",
    icon: "infoRow",
    kind: "toggle",
    surfaces: ["top", "left"],
    commandType: "toggleInfoRow",
    shortcutLabel: "Cmd+Shift+I",
  },
  {
    id: "actionLog",
    label: "Action Log",
    icon: "actionLog",
    kind: "button",
    surfaces: ["left"],
    commandType: "openActionLog",
  },
  {
    id: "help",
    label: "Help",
    icon: "help",
    kind: "button",
    surfaces: ["left"],
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
    shortcutLabel: "Cmd+,",
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
    shortcutLabel: "Cmd+O",
  },
  {
    id: "editSelection",
    label: "Edit",
    icon: "edit",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "editSelection",
    shortcutLabel: "Cmd+E",
  },
  {
    id: "moveSelection",
    label: "Move To",
    icon: "move",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "moveSelection",
    shortcutLabel: "Cmd+Shift+M",
  },
  {
    id: "renameSelection",
    label: "Rename",
    icon: "rename",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "renameSelection",
    shortcutLabel: "F2",
  },
  {
    id: "duplicateSelection",
    label: "Duplicate",
    icon: "duplicate",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "duplicateSelection",
    shortcutLabel: "Cmd+D",
  },
  {
    id: "newFolder",
    label: "New Folder",
    icon: "newFolder",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "newFolder",
    shortcutLabel: "Cmd+Shift+N",
  },
  {
    id: "trashSelection",
    label: "Move To Trash",
    icon: "trash",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "trashSelection",
    shortcutLabel: "Cmd+Backspace",
  },
  {
    id: "copySelection",
    label: "Copy",
    icon: "copy",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "copySelection",
    shortcutLabel: "Cmd+C",
  },
  {
    id: "cutSelection",
    label: "Cut",
    icon: "cut",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "cutSelection",
    shortcutLabel: "Cmd+X",
  },
  {
    id: "pasteSelection",
    label: "Paste",
    icon: "paste",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "pasteSelection",
    shortcutLabel: "Cmd+V",
  },
  {
    id: "openInTerminal",
    label: "Open In Terminal",
    icon: "terminal",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "openInTerminal",
    shortcutLabel: "Cmd+T",
  },
  {
    id: "copyPath",
    label: "Copy Path",
    icon: "copyPath",
    kind: "button",
    surfaces: ["top", "left"],
    commandType: "copyPath",
    shortcutLabel: "Cmd+Option+C",
  },
] as const satisfies ReadonlyArray<ToolbarItemDefinition>;

export const TOOLBAR_ITEM_IDS = TOOLBAR_ITEM_DEFINITIONS.map((item) => item.id) as ToolbarItemId[];

export const DEFAULT_TOP_TOOLBAR_ITEMS: ToolbarItemId[] = [
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
  utility: ["actionLog", "help", "leftSeparator", "theme", "settings"],
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
  return TOOLBAR_ITEM_DEFINITIONS.filter(
    (item) => {
      const definition = item as ToolbarItemDefinition;
      return definition.surfaces.includes("left") && (!definition.leftZones || definition.leftZones.includes(zone));
    },
  );
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
  const record = value as { main?: unknown; utility?: unknown };
  const seen = new Set<ToolbarItemId>();
  return {
    main: sanitizeToolbarItemList(record.main, "left", "main", seen),
    utility: sanitizeToolbarItemList(record.utility, "left", "utility", seen),
  };
}
