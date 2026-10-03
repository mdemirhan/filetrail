import type { ShortcutOverrides } from "./shortcuts";
import { DEFAULT_TOP_TOOLBAR_ITEMS, type ToolbarItemId } from "./toolbarItems";

// The app's two looks, macOS light and macOS dark.
export type ThemeMode = "light" | "dark";
// "auto" follows the macOS appearance; "light" or "dark" pins the app to one.
export type ThemePreference = "auto" | ThemeMode;
export type AccentMode = string;
// "native" shows the real macOS icons for files and folders (via NSWorkspace).
export type ExplorerViewMode = "icons" | "list" | "details";
export type SearchPatternModePreference = "text" | "glob" | "regex";
// How the search text is matched, in the order the menus list the choices.
export const SEARCH_PATTERN_MODES = ["text", "glob", "regex"] as const;
export const SEARCH_PATTERN_MODE_LABELS: Record<SearchPatternModePreference, string> = {
  text: "Plain Text",
  glob: "Glob",
  regex: "Regex",
};
export type SearchMatchScopePreference = "name" | "path";
export type SearchResultsSortByPreference = "name" | "path";
export type SearchResultsSortDirectionPreference = "asc" | "desc";
export type DetailColumnKey = "name" | "modified" | "size" | "kind" | "created" | "permissions";
export type OptionalDetailColumnKey = Exclude<DetailColumnKey, "name">;
export type DetailColumnVisibility = Record<OptionalDetailColumnKey, boolean>;
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

// The theme a saved value stands for, or null when it is unknown. The app used to offer
// several palettes for each side; a saved palette becomes the side it was on.
const SAVED_PALETTE_SIDES: Readonly<Record<string, ThemeMode>> = {
  "macos-light": "light",
  "warm-paper": "light",
  sand: "light",
  "clean-white": "light",
  stone: "light",
  "macos-dark": "dark",
  "catppuccin-mocha": "dark",
  "tomorrow-night": "dark",
  obsidian: "dark",
  onyx: "dark",
  graphite: "dark",
  midnight: "dark",
};

export function resolveSavedTheme(value: unknown): ThemePreference | null {
  if (typeof value !== "string") {
    return null;
  }
  if (THEME_OPTIONS.some((option) => option.value === value)) {
    return value as ThemePreference;
  }
  return SAVED_PALETTE_SIDES[value] ?? null;
}

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
export const DETAIL_COLUMN_LABELS: Record<DetailColumnKey, string> = {
  name: "Name",
  modified: "Date Modified",
  size: "Size",
  kind: "Kind",
  created: "Date Created",
  permissions: "Permissions",
};
// `name` is always visible, so only optional columns are persisted as booleans. The
// defaults are Finder's list view columns; Date Created and Permissions are opt-in.
export const DEFAULT_DETAIL_COLUMN_VISIBILITY: DetailColumnVisibility = {
  modified: true,
  size: true,
  kind: true,
  created: false,
  permissions: false,
};
// The defaults before Kind and Date Created existed. Saved choices still exactly equal to
// them were never customized, so they are upgraded to the new defaults when state loads.
export const LEGACY_DEFAULT_DETAIL_COLUMN_VISIBILITY = {
  size: true,
  modified: true,
  permissions: true,
} as const;
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
export const DETAIL_COLUMN_WIDTH_LIMITS = {
  name: { min: 220, max: 720 },
  modified: { min: 132, max: 280 },
  size: { min: 84, max: 240 },
  kind: { min: 96, max: 320 },
  created: { min: 132, max: 280 },
  permissions: { min: 96, max: 260 },
} as const satisfies Record<DetailColumnKey, { min: number; max: number }>;
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

// This is the durable shape written by the main-process state store.
// Adding or renaming keys here requires corresponding migration handling in the loader,
// otherwise older saved preferences will either be dropped or fail validation.
export type AppPreferences = {
  theme: ThemePreference;
  accent: AccentMode;
  zoomPercent: number;
  viewMode: ExplorerViewMode;
  sortBy: "name" | "modified" | "kind" | "size";
  sortDirection: "asc" | "desc";
  foldersFirst: boolean;
  compactListView: boolean;
  compactDetailsView: boolean;
  compactIconView: boolean;
  compactTreeView: boolean;
  singleClickExpandTreeItems: boolean;
  detailColumns: DetailColumnVisibility;
  detailColumnWidths: DetailColumnWidths;
  notificationsEnabled: boolean;
  // Items that were copied or cut flash and keep a mark, in the folder tree and the file list.
  markClipboardItems: boolean;
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
  favoritesInitialized: boolean;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "auto",
  accent: DEFAULT_ACCENT,
  zoomPercent: 100,
  viewMode: "details",
  sortBy: "name",
  sortDirection: "asc",
  foldersFirst: true,
  compactListView: false,
  compactDetailsView: false,
  compactIconView: false,
  compactTreeView: false,
  singleClickExpandTreeItems: false,
  detailColumns: DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths: DEFAULT_DETAIL_COLUMN_WIDTHS,
  notificationsEnabled: true,
  markClipboardItems: true,
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
  favoritesInitialized: false,
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
