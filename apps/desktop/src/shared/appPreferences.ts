import type { ShortcutOverrides } from "./shortcuts";
import { DEFAULT_TOP_TOOLBAR_ITEMS, type ToolbarItemId } from "./toolbarItems";

// The palettes: three light and three dark.
export type ThemeMode =
  | "macos-light"
  | "warm-paper"
  | "sand"
  | "macos-dark"
  | "catppuccin-mocha"
  | "tomorrow-night";
// "auto" follows the macOS appearance, using autoLightTheme / autoDarkTheme as palettes. An
// explicit palette pins the app to that palette's light or dark side.
export type ThemePreference = "auto" | ThemeMode;
export type AccentMode = string;
// "native" shows the real macOS icons for files and folders (via NSWorkspace).
export type ExplorerViewMode = "icons" | "list" | "details";
export type UiFontFamily = "system" | "dm-sans" | "lexend" | "fira-code" | "jetbrains-mono";
// How the tab strip is drawn: flat tabs under a line in the accent color, or cards on a band.
export type TabStyle = "cards" | "accentLine";
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

// These option lists are used for both UI rendering and validation-like lookups.
// Keep them stable unless the corresponding persisted preference values are migrated.
export const THEME_OPTIONS = [
  { value: "macos-light", label: "macOS Light", group: "light" },
  { value: "warm-paper", label: "Warm Paper", group: "light" },
  { value: "sand", label: "Sand", group: "light" },
  { value: "macos-dark", label: "macOS Dark", group: "dark" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha", group: "dark" },
  { value: "tomorrow-night", label: "Tomorrow Night", group: "dark" },
] as const;

// Palettes that were removed, with the remaining palette closest to each. Saved state that
// still names one is moved to its replacement when it loads.
export const REMOVED_THEME_REPLACEMENTS: Readonly<Record<string, ThemeMode>> = {
  light: "macos-light",
  "clean-white": "macos-light",
  stone: "macos-light",
  dark: "macos-dark",
  obsidian: "macos-dark",
  onyx: "macos-dark",
  graphite: "tomorrow-night",
  midnight: "catppuccin-mocha",
};

// The palette a saved theme name stands for today, or null when the name is unknown.
export function resolveSavedTheme(value: unknown): ThemeMode | null {
  if (typeof value !== "string") {
    return null;
  }
  if (THEME_OPTIONS.some((option) => option.value === value)) {
    return value as ThemeMode;
  }
  return REMOVED_THEME_REPLACEMENTS[value] ?? null;
}

export const AUTO_THEME_OPTION = { value: "auto", label: "Auto (follow macOS)" } as const;
export const LIGHT_THEME_OPTIONS = THEME_OPTIONS.filter((option) => option.group === "light");
export const DARK_THEME_OPTIONS = THEME_OPTIONS.filter((option) => option.group === "dark");

export const THEME_GROUPS = [
  {
    value: "light",
    label: "Light",
    options: THEME_OPTIONS.filter((option) => option.group === "light"),
  },
  {
    value: "dark",
    label: "Dark",
    options: THEME_OPTIONS.filter((option) => option.group === "dark"),
  },
] as const;

// Choosing a palette (or Auto) from a single list: the palette becomes the theme and also
// the palette of its side, so going back to Auto keeps it.
export function themeChoicePatch(
  choice: ThemePreference,
): Partial<Pick<AppPreferences, "theme" | "autoLightTheme" | "autoDarkTheme">> {
  if (choice === "auto") {
    return { theme: "auto" };
  }
  return isThemeInGroup(choice, "light")
    ? { theme: choice, autoLightTheme: choice }
    : { theme: choice, autoDarkTheme: choice };
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

export const UI_FONT_OPTIONS = [
  { value: "system", label: "System (SF Pro)" },
  { value: "dm-sans", label: "DM Sans" },
  { value: "lexend", label: "Lexend" },
  { value: "fira-code", label: "Fira Code" },
  { value: "jetbrains-mono", label: "JetBrains Mono" },
] as const;
export const ZOOM_PERCENT_MIN = 75;
export const ZOOM_PERCENT_MAX = 150;
export const NOTIFICATION_DURATION_SECONDS_OPTIONS = [2, 3, 4, 5, 6, 8, 10] as const;
export const NOTIFICATION_DURATION_SECONDS_MIN = 2;
export const NOTIFICATION_DURATION_SECONDS_MAX = 10;
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
  autoLightTheme: ThemeMode;
  autoDarkTheme: ThemeMode;
  accent: AccentMode;
  zoomPercent: number;
  uiFontFamily: UiFontFamily;
  tabStyle: TabStyle;
  viewMode: ExplorerViewMode;
  sortBy: "name" | "modified" | "kind" | "size";
  sortDirection: "asc" | "desc";
  foldersFirst: boolean;
  compactListView: boolean;
  compactDetailsView: boolean;
  compactIconView: boolean;
  compactTreeView: boolean;
  singleClickExpandTreeItems: boolean;
  highlightHoveredItems: boolean;
  detailColumns: DetailColumnVisibility;
  detailColumnWidths: DetailColumnWidths;
  notificationsEnabled: boolean;
  notificationDurationSeconds: number;
  // What shows that items were copied or cut: a flash and a marker on them in the folder
  // tree and in the file list, and a notification that names them.
  highlightClipboardItemsInTree: boolean;
  highlightClipboardItemsInContent: boolean;
  notifyClipboardItems: boolean;
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
  restoreLastVisitedFolderOnStartup: boolean;
  restoreOpenTabsOnStartup: boolean;
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
  autoLightTheme: "macos-light",
  autoDarkTheme: "macos-dark",
  accent: DEFAULT_ACCENT,
  zoomPercent: 100,
  uiFontFamily: "system",
  tabStyle: "accentLine",
  viewMode: "list",
  sortBy: "name",
  sortDirection: "asc",
  foldersFirst: true,
  compactListView: false,
  compactDetailsView: false,
  compactIconView: false,
  compactTreeView: false,
  singleClickExpandTreeItems: false,
  highlightHoveredItems: false,
  detailColumns: DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths: DEFAULT_DETAIL_COLUMN_WIDTHS,
  notificationsEnabled: true,
  notificationDurationSeconds: 4,
  highlightClipboardItemsInTree: true,
  highlightClipboardItemsInContent: true,
  notifyClipboardItems: true,
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
  restoreLastVisitedFolderOnStartup: false,
  restoreOpenTabsOnStartup: false,
  openTabs: [],
  activeTabIndex: 0,
  treeRootPath: null,
  lastVisitedPath: null,
  lastVisitedFavoritePath: null,
  favorites: [],
  favoritesPlacement: "separate",
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

export function clampNotificationDurationSeconds(value: number): number {
  return Math.round(
    Math.max(NOTIFICATION_DURATION_SECONDS_MIN, Math.min(NOTIFICATION_DURATION_SECONDS_MAX, value)),
  );
}

export function clampOpenItemLimit(value: number): number {
  return Math.round(Math.max(OPEN_ITEM_LIMIT_MIN, Math.min(OPEN_ITEM_LIMIT_MAX, value)));
}

export function clampDetailColumnWidth(key: DetailColumnKey, value: number): number {
  const limits = DETAIL_COLUMN_WIDTH_LIMITS[key];
  return Math.round(Math.max(limits.min, Math.min(limits.max, value)));
}

export function getThemeLabel(theme: ThemePreference): string {
  if (theme === "auto") {
    return AUTO_THEME_OPTION.label;
  }
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}

export function isThemeInGroup(theme: string, group: "light" | "dark"): theme is ThemeMode {
  return THEME_OPTIONS.some((option) => option.value === theme && option.group === group);
}

// Resolves the palette actually painted: "auto" picks the light or dark palette from the
// current macOS appearance; an explicit theme is used as is.
export function resolveEffectiveTheme(
  theme: ThemePreference,
  systemPrefersDark: boolean,
  autoLightTheme: ThemeMode,
  autoDarkTheme: ThemeMode,
): ThemeMode {
  if (theme !== "auto") {
    return theme;
  }
  return systemPrefersDark ? autoDarkTheme : autoLightTheme;
}

export function normalizeAccentColor(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase();
}

export function getUiFontLabel(font: UiFontFamily): string {
  return UI_FONT_OPTIONS.find((option) => option.value === font)?.label ?? font;
}

export function getFavoriteIconLabel(icon: FavoriteIconId): string {
  return FAVORITE_ICON_OPTIONS.find((option) => option.value === icon)?.label ?? icon;
}
