export type ThemeMode =
  | "dark"
  | "tomorrow-night"
  | "catppuccin-mocha"
  | "obsidian"
  | "graphite"
  | "midnight"
  | "onyx"
  | "light"
  | "clean-white"
  | "warm-paper"
  | "stone"
  | "sand";
export type AccentMode =
  | "gold"
  | "teal"
  | "blue"
  | "violet"
  | "rose"
  | "emerald"
  | "copper"
  | "sky"
  | "lavender"
  | "coral"
  | "indigo"
  | "lime";
export type IconThemeMode = "classic" | "colorblock" | "monoline" | "vivid";
export type ExplorerViewMode = "list" | "details";
export type UiFontFamily = "dm-sans" | "lexend" | "fira-code" | "jetbrains-mono";
export type UiFontWeight = 400 | 500 | 600;
export type SearchPatternModePreference = "glob" | "regex";
export type SearchMatchScopePreference = "name" | "path";
export type SearchResultsSortByPreference = "name" | "path";
export type SearchResultsSortDirectionPreference = "asc" | "desc";
export type SearchResultsFilterScopePreference = "name" | "path";
export type DetailColumnKey = "name" | "size" | "modified" | "permissions";
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

export type FavoritesPlacement = "integrated" | "separate";
export type FileActivationAction = "open" | "edit";
export type CopyPasteReviewDialogSize = {
  width: number;
  height: number;
};

// These option lists are used for both UI rendering and validation-like lookups.
// Keep them stable unless the corresponding persisted preference values are migrated.
export const THEME_OPTIONS = [
  { value: "dark", label: "Dark", group: "dark" },
  { value: "tomorrow-night", label: "Tomorrow Night", group: "dark" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha", group: "dark" },
  { value: "obsidian", label: "Obsidian", group: "dark" },
  { value: "graphite", label: "Graphite", group: "dark" },
  { value: "midnight", label: "Midnight", group: "dark" },
  { value: "onyx", label: "Onyx", group: "dark" },
  { value: "light", label: "Light", group: "light" },
  { value: "clean-white", label: "Clean White", group: "light" },
  { value: "warm-paper", label: "Warm Paper", group: "light" },
  { value: "stone", label: "Stone", group: "light" },
  { value: "sand", label: "Sand", group: "light" },
] as const;

export const THEME_GROUPS = [
  {
    value: "dark",
    label: "Dark Themes",
    options: THEME_OPTIONS.filter((option) => option.group === "dark"),
  },
  {
    value: "light",
    label: "Light Themes",
    options: THEME_OPTIONS.filter((option) => option.group === "light"),
  },
] as const;
export const ICON_THEME_OPTIONS = [
  { value: "classic", label: "Classic" },
  { value: "colorblock", label: "Color Block" },
  { value: "monoline", label: "Monoline" },
  { value: "vivid", label: "Vivid" },
] as const;
export const ACCENT_OPTIONS = [
  { value: "gold", label: "Gold", primary: "#daa520", dark: "#b8860b" },
  { value: "teal", label: "Teal", primary: "#2cb5a0", dark: "#1e9a87" },
  { value: "blue", label: "Blue", primary: "#4a9eff", dark: "#2d7fd4" },
  { value: "violet", label: "Violet", primary: "#9580ff", dark: "#7a62e0" },
  { value: "rose", label: "Rose", primary: "#e8729a", dark: "#c75a80" },
  { value: "emerald", label: "Emerald", primary: "#3dbf7a", dark: "#2a9e62" },
  { value: "copper", label: "Copper", primary: "#d4845a", dark: "#b86e48" },
  { value: "sky", label: "Sky", primary: "#58b9e8", dark: "#3a9acb" },
  { value: "lavender", label: "Lavender", primary: "#a78bfa", dark: "#7c5fd6" },
  { value: "coral", label: "Coral", primary: "#e8806a", dark: "#c86850" },
  { value: "indigo", label: "Indigo", primary: "#6366f1", dark: "#4f46e5" },
  { value: "lime", label: "Lime", primary: "#84b840", dark: "#6a9830" },
] as const;

export const UI_FONT_OPTIONS = [
  { value: "dm-sans", label: "DM Sans" },
  { value: "lexend", label: "Lexend" },
  { value: "fira-code", label: "Fira Code" },
  { value: "jetbrains-mono", label: "JetBrains Mono" },
] as const;
export const UI_FONT_SIZE_OPTIONS = [12, 13, 14, 15] as const;
export const UI_FONT_WEIGHT_OPTIONS = [400, 500, 600] as const;
export const ZOOM_PERCENT_MIN = 75;
export const ZOOM_PERCENT_MAX = 150;
export const TYPEAHEAD_DEBOUNCE_OPTIONS = [250, 500, 750, 1000, 1500] as const;
export const TYPEAHEAD_DEBOUNCE_MIN_MS = 250;
export const TYPEAHEAD_DEBOUNCE_MAX_MS = 1500;
export const NOTIFICATION_DURATION_SECONDS_OPTIONS = [2, 3, 4, 5, 6, 8, 10] as const;
export const NOTIFICATION_DURATION_SECONDS_MIN = 2;
export const NOTIFICATION_DURATION_SECONDS_MAX = 10;
export const DETAIL_COLUMN_KEYS = ["name", "size", "modified", "permissions"] as const;
export const OPTIONAL_DETAIL_COLUMN_KEYS = ["size", "modified", "permissions"] as const;
// `name` is always visible, so only optional columns are persisted as booleans.
export const DEFAULT_DETAIL_COLUMN_VISIBILITY: DetailColumnVisibility = {
  size: true,
  modified: true,
  permissions: true,
};
// Widths are persisted in pixels and are shared by renderer layout and IPC validation.
export const DEFAULT_DETAIL_COLUMN_WIDTHS: DetailColumnWidths = {
  name: 320,
  size: 108,
  modified: 168,
  permissions: 148,
};
export const DETAIL_COLUMN_WIDTH_LIMITS = {
  name: { min: 220, max: 720 },
  size: { min: 84, max: 240 },
  modified: { min: 132, max: 280 },
  permissions: { min: 132, max: 260 },
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
  theme: ThemeMode;
  iconTheme: IconThemeMode;
  accent: AccentMode;
  accentToolbarButtons: boolean;
  toolbarAccent: AccentMode;
  accentFavoriteItems: boolean;
  accentFavoriteText: boolean;
  favoriteAccent: AccentMode;
  zoomPercent: number;
  uiFontFamily: UiFontFamily;
  uiFontSize: number;
  uiFontWeight: UiFontWeight;
  textPrimaryOverride: string | null;
  textSecondaryOverride: string | null;
  textMutedOverride: string | null;
  viewMode: ExplorerViewMode;
  foldersFirst: boolean;
  compactListView: boolean;
  compactDetailsView: boolean;
  compactTreeView: boolean;
  singleClickExpandTreeItems: boolean;
  highlightHoveredItems: boolean;
  detailColumns: DetailColumnVisibility;
  detailColumnWidths: DetailColumnWidths;
  tabSwitchesExplorerPanes: boolean;
  typeaheadEnabled: boolean;
  typeaheadDebounceMs: number;
  notificationsEnabled: boolean;
  notificationDurationSeconds: number;
  actionLogEnabled: boolean;
  propertiesOpen: boolean;
  detailRowOpen: boolean;
  terminalApp: ApplicationSelection | null;
  defaultTextEditor: ApplicationSelection;
  openWithApplications: OpenWithApplication[];
  fileActivationAction: FileActivationAction;
  openItemLimit: number;
  includeHidden: boolean;
  searchPatternMode: SearchPatternModePreference;
  searchMatchScope: SearchMatchScopePreference;
  searchRecursive: boolean;
  searchIncludeHidden: boolean;
  searchResultsSortBy: SearchResultsSortByPreference;
  searchResultsSortDirection: SearchResultsSortDirectionPreference;
  searchResultsFilterScope: SearchResultsFilterScopePreference;
  treeWidth: number;
  inspectorWidth: number;
  restoreLastVisitedFolderOnStartup: boolean;
  treeRootPath: string | null;
  lastVisitedPath: string | null;
  lastVisitedFavoritePath: string | null;
  lastGoToFolderPath: string | null;
  favorites: FavoritePreference[];
  favoritesPlacement: FavoritesPlacement;
  favoritesPaneHeight: number | null;
  favoritesExpanded: boolean;
  favoritesInitialized: boolean;
  copyPasteReviewDialogSize: CopyPasteReviewDialogSize | null;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "dark",
  iconTheme: "classic",
  accent: "copper",
  accentToolbarButtons: false,
  toolbarAccent: "copper",
  accentFavoriteItems: true,
  accentFavoriteText: false,
  favoriteAccent: "sky",
  zoomPercent: 100,
  uiFontFamily: "lexend",
  uiFontSize: 13,
  uiFontWeight: 500,
  textPrimaryOverride: null,
  textSecondaryOverride: null,
  textMutedOverride: null,
  viewMode: "list",
  foldersFirst: true,
  compactListView: false,
  compactDetailsView: false,
  compactTreeView: false,
  singleClickExpandTreeItems: false,
  highlightHoveredItems: false,
  detailColumns: DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths: DEFAULT_DETAIL_COLUMN_WIDTHS,
  tabSwitchesExplorerPanes: true,
  typeaheadEnabled: true,
  typeaheadDebounceMs: 1000,
  notificationsEnabled: true,
  notificationDurationSeconds: 4,
  actionLogEnabled: true,
  propertiesOpen: false,
  detailRowOpen: true,
  terminalApp: null,
  defaultTextEditor: { ...DEFAULT_TEXT_EDITOR },
  openWithApplications: DEFAULT_OPEN_WITH_APPLICATIONS.map((entry) => ({ ...entry })),
  fileActivationAction: "open",
  openItemLimit: 5,
  includeHidden: false,
  searchPatternMode: "regex",
  searchMatchScope: "name",
  searchRecursive: true,
  searchIncludeHidden: false,
  searchResultsSortBy: "path",
  searchResultsSortDirection: "asc",
  searchResultsFilterScope: "name",
  treeWidth: 280,
  inspectorWidth: 320,
  restoreLastVisitedFolderOnStartup: false,
  treeRootPath: null,
  lastVisitedPath: null,
  lastVisitedFavoritePath: null,
  lastGoToFolderPath: null,
  favorites: [],
  favoritesPlacement: "integrated",
  favoritesPaneHeight: null,
  favoritesExpanded: true,
  favoritesInitialized: false,
  copyPasteReviewDialogSize: null,
};

// Pane widths are rounded before persistence so restored layouts remain stable and do not
// drift from repeated floating-point resize calculations.
export function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

export function clampFontSize(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

export function clampFontWeight(
  value: number,
  options: readonly number[],
  fallback = options[0] ?? 400,
): number {
  return options.includes(value) ? value : fallback;
}

export function clampZoomPercent(value: number): number {
  return Math.round(Math.max(ZOOM_PERCENT_MIN, Math.min(ZOOM_PERCENT_MAX, value)));
}

// Typeahead timing is user-tunable but is kept inside a narrow, predictable range so
// the shared debounce logic behaves consistently across tree, list, details, and search.
export function clampTypeaheadDebounceMs(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
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

export function getThemeLabel(theme: ThemeMode): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}

export function getIconThemeLabel(iconTheme: IconThemeMode): string {
  return ICON_THEME_OPTIONS.find((option) => option.value === iconTheme)?.label ?? iconTheme;
}

export function getAccentLabel(accent: AccentMode): string {
  return ACCENT_OPTIONS.find((option) => option.value === accent)?.label ?? accent;
}

export function getUiFontLabel(font: UiFontFamily): string {
  return UI_FONT_OPTIONS.find((option) => option.value === font)?.label ?? font;
}

export function getFavoriteIconLabel(icon: FavoriteIconId): string {
  return FAVORITE_ICON_OPTIONS.find((option) => option.value === icon)?.label ?? icon;
}
