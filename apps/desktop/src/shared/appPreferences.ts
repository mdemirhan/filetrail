export type ThemeMode = "light" | "dark" | "tomorrow-night" | "catppuccin-mocha";
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

// These option lists are used for both UI rendering and validation-like lookups.
// Keep them stable unless the corresponding persisted preference values are migrated.
export const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "tomorrow-night", label: "Tomorrow Night" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { value: "light", label: "Light" },
] as const;

export const UI_FONT_OPTIONS = [
  { value: "dm-sans", label: "DM Sans" },
  { value: "lexend", label: "Lexend" },
  { value: "fira-code", label: "Fira Code" },
  { value: "jetbrains-mono", label: "JetBrains Mono" },
] as const;
export const UI_FONT_SIZE_OPTIONS = [12, 13, 14, 15] as const;
export const UI_FONT_WEIGHT_OPTIONS = [400, 500, 600] as const;
export const TYPEAHEAD_DEBOUNCE_OPTIONS = [250, 500, 750, 1000, 1500] as const;
export const TYPEAHEAD_DEBOUNCE_MIN_MS = 250;
export const TYPEAHEAD_DEBOUNCE_MAX_MS = 1500;
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

// This is the durable shape written by the main-process state store.
// Adding or renaming keys here requires corresponding migration handling in the loader,
// otherwise older saved preferences will either be dropped or fail validation.
export type AppPreferences = {
  theme: ThemeMode;
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
  detailColumns: DetailColumnVisibility;
  detailColumnWidths: DetailColumnWidths;
  tabSwitchesExplorerPanes: boolean;
  typeaheadEnabled: boolean;
  typeaheadDebounceMs: number;
  propertiesOpen: boolean;
  detailRowOpen: boolean;
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
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "tomorrow-night",
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
  detailColumns: DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths: DEFAULT_DETAIL_COLUMN_WIDTHS,
  tabSwitchesExplorerPanes: true,
  typeaheadEnabled: true,
  typeaheadDebounceMs: 750,
  propertiesOpen: true,
  detailRowOpen: true,
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

// Typeahead timing is user-tunable but is kept inside a narrow, predictable range so
// the shared debounce logic behaves consistently across tree, list, details, and search.
export function clampTypeaheadDebounceMs(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

export function clampDetailColumnWidth(key: DetailColumnKey, value: number): number {
  const limits = DETAIL_COLUMN_WIDTH_LIMITS[key];
  return Math.round(Math.max(limits.min, Math.min(limits.max, value)));
}

export function getThemeLabel(theme: ThemeMode): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}

export function getUiFontLabel(font: UiFontFamily): string {
  return UI_FONT_OPTIONS.find((option) => option.value === font)?.label ?? font;
}
