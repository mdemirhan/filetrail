export type ThemeMode = "light" | "dark" | "tomorrow-night" | "catppuccin-mocha";
export type ExplorerViewMode = "list" | "details";
export type UiFontFamily = "dm-sans" | "lexend" | "fira-code" | "jetbrains-mono";
export type UiFontWeight = 400 | 500 | 600;
export type SearchPatternModePreference = "glob" | "regex";
export type SearchMatchScopePreference = "name" | "path";
export type SearchResultsSortByPreference = "name" | "path";
export type SearchResultsSortDirectionPreference = "asc" | "desc";
export type SearchResultsFilterScopePreference = "name" | "path";

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
  compactTreeView: boolean;
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
  compactTreeView: false,
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

export function clampTypeaheadDebounceMs(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}

export function getThemeLabel(theme: ThemeMode): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}

export function getUiFontLabel(font: UiFontFamily): string {
  return UI_FONT_OPTIONS.find((option) => option.value === font)?.label ?? font;
}
