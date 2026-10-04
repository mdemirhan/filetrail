import {
  type BatchRenamePreset,
  type BatchRenameSettings,
  DEFAULT_BATCH_RENAME_SETTINGS,
} from "./batchRename";
import type { ShortcutOverrides } from "./shortcuts";
import { DEFAULT_TOP_TOOLBAR_ITEMS, type ToolbarItemId } from "./toolbarItems";

// The app's two looks, macOS light and macOS dark.
export type ThemeMode = "light" | "dark";
// "auto" follows the macOS appearance; "light" or "dark" pins the app to one.
export type ThemePreference = "auto" | ThemeMode;
export type AccentMode = string;
// The file list's views. "details" is the one called List, the table; "list" is Compact
// List, names in columns.
export type ExplorerViewMode = "icons" | "list" | "details";
// The views in the order every menu lists them, by the names the menus give them.
export const VIEW_MODE_ORDER = ["icons", "details", "list"] as const;
export const VIEW_MODE_NAMES: Record<ExplorerViewMode, string> = {
  icons: "Icons",
  details: "List",
  list: "Compact List",
};
export type SearchPatternModePreference = "text" | "glob" | "regex";
// How the search text is matched, in the order the menus list the choices.
export const SEARCH_PATTERN_MODES = ["text", "glob", "regex"] as const;
export const SEARCH_PATTERN_MODE_LABELS: Record<SearchPatternModePreference, string> = {
  text: "Plain Text",
  glob: "Glob",
  regex: "Regex",
};
export type SearchMatchScopePreference = "name" | "path";
// Search results sort by name, by the folder they are in, or by kind (told from the extension).
export type SearchResultsSortByPreference = "name" | "path" | "kind";
export type SearchResultsSortDirectionPreference = "asc" | "desc";
export type DetailColumnKey = "name" | "modified" | "size" | "kind" | "created" | "permissions";
export type OptionalDetailColumnKey = Exclude<DetailColumnKey, "name">;
export type DetailColumnVisibility = Record<OptionalDetailColumnKey, boolean>;
// The optional columns in the order the list shows them, each once; Name always comes first.
export type DetailColumnOrder = OptionalDetailColumnKey[];
export type DetailColumnWidths = Record<DetailColumnKey, number>;
export type ApplicationSelection = {
  appPath: string;
  appName: string;
};
export type OpenWithApplication = {
  id: string;
} & ApplicationSelection;
export type FavoriteIconId =
  | "home"
  | "applications"
  | "desktop"
  | "documents"
  | "downloads"
  | "trash"
  | "folder"
  | "star"
  | "drive"
  | "code"
  | "terminal"
  | "globe"
  | "music"
  | "photos"
  | "videos"
  | "archive"
  | "cloud"
  | "server"
  | "projects"
  | "books"
  | "camera"
  | "toolbox"
  | "network";
export type FavoritePreference = {
  path: string;
  icon: FavoriteIconId;
};

// A tab as it is remembered between launches: where it was and how it showed its folder.
// Its history, selection and search are not kept.
export type OpenTabPreference = {
  // null for a tab that showed no folder (Favorites selected in the sidebar).
  path: string | null;
  treeRootPath: string | null;
  favoritePath: string | null;
  viewMode: ExplorerViewMode;
  // How the tab shows search results, kept apart from how it shows folders.
  searchViewMode: ExplorerViewMode;
  sortBy: "name" | "modified" | "kind" | "size";
  sortDirection: "asc" | "desc";
  // Each tab shows hidden files, and folders before files, or not, on its own.
  includeHidden: boolean;
  foldersFirst: boolean;
};
export const OPEN_TABS_LIMIT = 100;

export type FavoritesPlacement = "integrated" | "separate";
export type FileActivationAction = "open" | "edit";
// Finder renames with Return; "open" keeps the older behavior of opening the selection.
export type ReturnKeyAction = "rename" | "open";
export type {
  ToolbarItemDefinition,
  ToolbarItemId,
} from "./toolbarItems";

// Auto, Light and Dark, in the order Settings shows them.
export const THEME_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string }>;

// The accent colors offered in Settings: macOS's own, in System Settings order, then the
// copper the app used to default to. Any other saved color shows up as a custom color.
export const ACCENT_OPTIONS = [
  { value: "#007aff", label: "Blue" },
  { value: "#a550a7", label: "Purple" },
  { value: "#f74f9e", label: "Pink" },
  { value: "#e0383e", label: "Red" },
  { value: "#f7821b", label: "Orange" },
  { value: "#ffc600", label: "Yellow" },
  { value: "#62ba46", label: "Green" },
  { value: "#8c8c8c", label: "Graphite" },
  { value: "#d4845a", label: "Copper" },
] as const;
export const DEFAULT_ACCENT: AccentMode = ACCENT_OPTIONS[0].value;

export const ZOOM_PERCENT_MIN = 75;
export const ZOOM_PERCENT_MAX = 150;
// In display order, which is Finder's: Name, Date Modified, Size, Kind, then the extras.
export const DETAIL_COLUMN_KEYS = [
  "name",
  "modified",
  "size",
  "kind",
  "created",
  "permissions",
] as const;
export const OPTIONAL_DETAIL_COLUMN_KEYS = [
  "modified",
  "size",
  "kind",
  "created",
  "permissions",
] as const;
// What the list can be sorted by, in the order every menu lists it (named by its column).
export const SORT_BY_ORDER = ["name", "kind", "modified", "size"] as const;
export const DETAIL_COLUMN_LABELS: Record<DetailColumnKey, string> = {
  name: "Name",
  modified: "Date Modified",
  size: "Size",
  kind: "Kind",
  created: "Date Created",
  permissions: "Permissions",
};
export const DEFAULT_DETAIL_COLUMN_ORDER: DetailColumnOrder = [...OPTIONAL_DETAIL_COLUMN_KEYS];
// `name` is always visible, so only optional columns are persisted as booleans. The
// defaults are Finder's list view columns; Date Created and Permissions are opt-in.
export const DEFAULT_DETAIL_COLUMN_VISIBILITY: DetailColumnVisibility = {
  modified: true,
  size: true,
  kind: true,
  created: false,
  permissions: false,
};
// Widths are persisted in pixels and are shared by renderer layout and IPC validation.
// The date columns fit "Yesterday, 12:44 PM"; Permissions fits its header (the cell is a
// three-digit code).
export const DEFAULT_DETAIL_COLUMN_WIDTHS: DetailColumnWidths = {
  name: 320,
  modified: 152,
  size: 108,
  kind: 148,
  created: 152,
  permissions: 108,
};
// A column may be made narrower than its title or its longest value: both end in an
// ellipsis, and a date's tooltip has it in full. The least widths still show a short value
// ("Mar 3, 2024", "123.5 MB", "Folder", "755") and a few letters of the title, except
// Permissions, whose code is all it needs to show.
export const DETAIL_COLUMN_WIDTH_LIMITS = {
  name: { min: 140, max: 720 },
  modified: { min: 80, max: 280 },
  size: { min: 60, max: 240 },
  kind: { min: 60, max: 320 },
  created: { min: 80, max: 280 },
  permissions: { min: 36, max: 260 },
} as const satisfies Record<DetailColumnKey, { min: number; max: number }>;
// Search results' List view: the folder's columns, and the folder each result is in. Which
// are shown, their order and their widths are kept apart from a folder's.
export type SearchColumnKey = DetailColumnKey | "folder";
export type OptionalSearchColumnKey = Exclude<SearchColumnKey, "name">;
export type SearchColumnVisibility = Record<OptionalSearchColumnKey, boolean>;
export type SearchColumnOrder = OptionalSearchColumnKey[];
export type SearchColumnWidths = Record<SearchColumnKey, number>;
export const OPTIONAL_SEARCH_COLUMN_KEYS = [
  "folder",
  "modified",
  "size",
  "kind",
  "created",
  "permissions",
] as const satisfies ReadonlyArray<OptionalSearchColumnKey>;
export const SEARCH_COLUMN_LABELS: Record<SearchColumnKey, string> = {
  ...DETAIL_COLUMN_LABELS,
  folder: "Folder",
};
export const DEFAULT_SEARCH_COLUMN_ORDER: SearchColumnOrder = [...OPTIONAL_SEARCH_COLUMN_KEYS];
export const DEFAULT_SEARCH_COLUMN_VISIBILITY: SearchColumnVisibility = {
  folder: true,
  modified: true,
  size: true,
  kind: false,
  created: false,
  permissions: false,
};
// In the order of the columns, which is also how a saved value is read back.
export const DEFAULT_SEARCH_COLUMN_WIDTHS: SearchColumnWidths = {
  name: 300,
  folder: 240,
  modified: DEFAULT_DETAIL_COLUMN_WIDTHS.modified,
  size: DEFAULT_DETAIL_COLUMN_WIDTHS.size,
  kind: DEFAULT_DETAIL_COLUMN_WIDTHS.kind,
  created: DEFAULT_DETAIL_COLUMN_WIDTHS.created,
  permissions: DEFAULT_DETAIL_COLUMN_WIDTHS.permissions,
};
export const SEARCH_COLUMN_WIDTH_LIMITS = {
  ...DETAIL_COLUMN_WIDTH_LIMITS,
  folder: { min: 80, max: 720 },
} as const satisfies Record<SearchColumnKey, { min: number; max: number }>;
export function clampSearchColumnWidth(key: SearchColumnKey, value: number): number {
  const limits = SEARCH_COLUMN_WIDTH_LIMITS[key];
  return Math.round(Math.max(limits.min, Math.min(limits.max, value)));
}
export const DEFAULT_OPEN_WITH_APPLICATIONS: OpenWithApplication[] = [
  {
    id: "visual-studio-code",
    appPath: "/Applications/Visual Studio Code.app",
    appName: "Visual Studio Code",
  },
  {
    id: "sublime-text",
    appPath: "/Applications/Sublime Text.app",
    appName: "Sublime Text",
  },
  {
    id: "zed",
    appPath: "/Applications/Zed.app",
    appName: "Zed",
  },
];
export const FAVORITE_ICON_OPTIONS = [
  { value: "home", label: "Home" },
  { value: "applications", label: "Applications" },
  { value: "desktop", label: "Desktop" },
  { value: "documents", label: "Documents" },
  { value: "downloads", label: "Downloads" },
  { value: "trash", label: "Trash" },
  { value: "folder", label: "Folder" },
  { value: "star", label: "Star" },
  { value: "drive", label: "Drive" },
  { value: "code", label: "Code" },
  { value: "terminal", label: "Terminal" },
  { value: "globe", label: "Globe" },
  { value: "music", label: "Music" },
  { value: "photos", label: "Photos" },
  { value: "videos", label: "Videos" },
  { value: "archive", label: "Archive" },
  { value: "cloud", label: "Cloud" },
  { value: "server", label: "Server" },
  { value: "projects", label: "Projects" },
  { value: "books", label: "Books" },
  { value: "camera", label: "Camera" },
  { value: "toolbox", label: "Toolbox" },
  { value: "network", label: "Network" },
] as const satisfies ReadonlyArray<{ value: FavoriteIconId; label: string }>;
export const DEFAULT_TEXT_EDITOR: ApplicationSelection = {
  appPath: "/System/Applications/TextEdit.app",
  appName: "TextEdit",
};
export const DEFAULT_TERMINAL_APPLICATION: ApplicationSelection = {
  appPath: "/System/Applications/Utilities/Terminal.app",
  appName: "Terminal",
};
export const OPEN_ITEM_LIMIT_MIN = 1;
export const OPEN_ITEM_LIMIT_MAX = 50;

// This is the durable shape written by the main-process state store. A saved value the
// loader does not recognize falls back to its default.
export type AppPreferences = {
  theme: ThemePreference;
  accent: AccentMode;
  zoomPercent: number;
  viewMode: ExplorerViewMode;
  // The view search results are shown in, for the tab on screen; List to begin with.
  searchViewMode: ExplorerViewMode;
  sortBy: "name" | "modified" | "kind" | "size";
  sortDirection: "asc" | "desc";
  foldersFirst: boolean;
  compactListView: boolean;
  compactDetailsView: boolean;
  compactIconView: boolean;
  compactTreeView: boolean;
  singleClickExpandTreeItems: boolean;
  detailColumns: DetailColumnVisibility;
  detailColumnOrder: DetailColumnOrder;
  detailColumnWidths: DetailColumnWidths;
  searchColumns: SearchColumnVisibility;
  searchColumnOrder: SearchColumnOrder;
  searchColumnWidths: SearchColumnWidths;
  notificationsEnabled: boolean;
  // Items that were copied or cut flash and keep a mark, in the folder tree and the file list.
  markClipboardItems: boolean;
  // The folder tree on the left (View > Hide Folder Tree).
  folderTreeOpen: boolean;
  propertiesOpen: boolean;
  detailRowOpen: boolean;
  topToolbarItems: ToolbarItemId[];
  terminalApp: ApplicationSelection | null;
  defaultTextEditor: ApplicationSelection;
  openWithApplications: OpenWithApplication[];
  fileActivationAction: FileActivationAction;
  returnKeyAction: ReturnKeyAction;
  // The keyboard shortcuts that differ from their defaults, by command.
  shortcutOverrides: ShortcutOverrides;
  openItemLimit: number;
  includeHidden: boolean;
  searchPatternMode: SearchPatternModePreference;
  searchMatchScope: SearchMatchScopePreference;
  searchRecursive: boolean;
  searchSkipGitFolders: boolean;
  searchSkipGitIgnored: boolean;
  searchResultsSortBy: SearchResultsSortByPreference;
  searchResultsSortDirection: SearchResultsSortDirectionPreference;
  treeWidth: number;
  inspectorWidth: number;
  // Start where the last session ended: its folder, and its tabs.
  restoreSessionOnStartup: boolean;
  // The tabs that were open, in order, and which one was on screen. Like the last visited
  // folder, they follow where the user is and are written when the app quits.
  openTabs: OpenTabPreference[];
  activeTabIndex: number;
  treeRootPath: string | null;
  lastVisitedPath: string | null;
  lastVisitedFavoritePath: string | null;
  favorites: FavoritePreference[];
  favoritesPlacement: FavoritesPlacement;
  favoritesExpanded: boolean;
  // The sidebar's Locations (the disks), shown or folded.
  locationsExpanded: boolean;
  favoritesInitialized: boolean;
  // The Rename sheet for several items: its settings as last used, and the ones saved by name.
  batchRenameSettings: BatchRenameSettings;
  batchRenamePresets: BatchRenamePreset[];
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "auto",
  accent: DEFAULT_ACCENT,
  zoomPercent: 100,
  viewMode: "icons",
  searchViewMode: "details",
  sortBy: "name",
  sortDirection: "asc",
  foldersFirst: true,
  compactListView: false,
  compactDetailsView: false,
  compactIconView: false,
  compactTreeView: false,
  singleClickExpandTreeItems: false,
  detailColumns: DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnOrder: DEFAULT_DETAIL_COLUMN_ORDER,
  detailColumnWidths: DEFAULT_DETAIL_COLUMN_WIDTHS,
  searchColumns: DEFAULT_SEARCH_COLUMN_VISIBILITY,
  searchColumnOrder: DEFAULT_SEARCH_COLUMN_ORDER,
  searchColumnWidths: DEFAULT_SEARCH_COLUMN_WIDTHS,
  notificationsEnabled: true,
  markClipboardItems: true,
  folderTreeOpen: true,
  propertiesOpen: false,
  detailRowOpen: false,
  topToolbarItems: [...DEFAULT_TOP_TOOLBAR_ITEMS],
  terminalApp: null,
  defaultTextEditor: { ...DEFAULT_TEXT_EDITOR },
  openWithApplications: DEFAULT_OPEN_WITH_APPLICATIONS.map((entry) => ({ ...entry })),
  fileActivationAction: "open",
  returnKeyAction: "rename",
  shortcutOverrides: {},
  openItemLimit: 5,
  includeHidden: false,
  searchPatternMode: "text",
  searchMatchScope: "name",
  searchRecursive: true,
  searchSkipGitFolders: true,
  searchSkipGitIgnored: false,
  searchResultsSortBy: "path",
  searchResultsSortDirection: "asc",
  treeWidth: 280,
  inspectorWidth: 320,
  restoreSessionOnStartup: true,
  openTabs: [],
  activeTabIndex: 0,
  treeRootPath: null,
  lastVisitedPath: null,
  lastVisitedFavoritePath: null,
  favorites: [],
  favoritesPlacement: "integrated",
  favoritesExpanded: true,
  locationsExpanded: true,
  favoritesInitialized: false,
  batchRenameSettings: DEFAULT_BATCH_RENAME_SETTINGS,
  batchRenamePresets: [],
};

// Pane widths are rounded before persistence so restored layouts remain stable and do not
// drift from repeated floating-point resize calculations.
export function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

export function clampZoomPercent(value: number): number {
  return Math.round(Math.max(ZOOM_PERCENT_MIN, Math.min(ZOOM_PERCENT_MAX, value)));
}

export function clampOpenItemLimit(value: number): number {
  return Math.round(Math.max(OPEN_ITEM_LIMIT_MIN, Math.min(OPEN_ITEM_LIMIT_MAX, value)));
}

export function clampDetailColumnWidth(key: DetailColumnKey, value: number): number {
  const limits = DETAIL_COLUMN_WIDTH_LIMITS[key];
  return Math.round(Math.max(limits.min, Math.min(limits.max, value)));
}

// A saved column order made whole: unknown and repeated keys are dropped, and columns it
// leaves out (one added in a later version) follow in their default order.
export function normalizeDetailColumnOrder(value: unknown): DetailColumnOrder {
  return normalizeColumnOrder(value, DEFAULT_DETAIL_COLUMN_ORDER);
}

export function normalizeSearchColumnOrder(value: unknown): SearchColumnOrder {
  return normalizeColumnOrder(value, DEFAULT_SEARCH_COLUMN_ORDER);
}

function normalizeColumnOrder<K extends string>(value: unknown, defaults: readonly K[]): K[] {
  const order: K[] = [];
  for (const key of Array.isArray(value) ? value : []) {
    if (typeof key === "string" && defaults.includes(key as K) && !order.includes(key as K)) {
      order.push(key as K);
    }
  }
  return [...order, ...defaults.filter((key) => !order.includes(key))];
}

// The look actually painted: "auto" follows the current macOS appearance.
export function resolveEffectiveTheme(
  theme: ThemePreference,
  systemPrefersDark: boolean,
): ThemeMode {
  if (theme !== "auto") {
    return theme;
  }
  return systemPrefersDark ? "dark" : "light";
}

export function normalizeAccentColor(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function getFavoriteIconLabel(icon: FavoriteIconId): string {
  return FAVORITE_ICON_OPTIONS.find((option) => option.value === icon)?.label ?? icon;
}
