export type ThemeMode = "light" | "tomorrow-night" | "catppuccin-mocha";
export type ExplorerViewMode = "list" | "details";
export type UiFontFamily = "dm-sans" | "lexend";
export type MonoFontFamily = "jetbrains-mono" | "fira-code";
export type UiFontWeight = 400 | 500 | 600;
export type MonoFontWeight = 400 | 500 | 600;

export const THEME_OPTIONS = [
  { value: "tomorrow-night", label: "Tomorrow Night" },
  { value: "catppuccin-mocha", label: "Catppuccin Mocha" },
  { value: "light", label: "Light" },
] as const;

export const UI_FONT_OPTIONS = [
  { value: "dm-sans", label: "DM Sans" },
  { value: "lexend", label: "Lexend" },
] as const;
export const MONO_FONT_OPTIONS = [
  { value: "jetbrains-mono", label: "JetBrains Mono" },
  { value: "fira-code", label: "Fira Code" },
] as const;
export const UI_FONT_SIZE_OPTIONS = [12, 13, 14, 15] as const;
export const MONO_FONT_SIZE_OPTIONS = [11, 12, 13, 14] as const;
export const UI_FONT_WEIGHT_OPTIONS = [400, 500, 600] as const;
export const MONO_FONT_WEIGHT_OPTIONS = [400, 500, 600] as const;

export type AppPreferences = {
  theme: ThemeMode;
  uiFontFamily: UiFontFamily;
  uiFontSize: number;
  uiFontWeight: UiFontWeight;
  monoFontFamily: MonoFontFamily;
  monoFontSize: number;
  monoFontWeight: MonoFontWeight;
  textPrimaryOverride: string | null;
  textSecondaryOverride: string | null;
  textMutedOverride: string | null;
  viewMode: ExplorerViewMode;
  propertiesOpen: boolean;
  includeHidden: boolean;
  treeWidth: number;
  inspectorWidth: number;
  restoreLastVisitedFolderOnStartup: boolean;
  treeRootPath: string | null;
  lastVisitedPath: string | null;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "tomorrow-night",
  uiFontFamily: "dm-sans",
  uiFontSize: 13,
  uiFontWeight: 400,
  monoFontFamily: "jetbrains-mono",
  monoFontSize: 12,
  monoFontWeight: 500,
  textPrimaryOverride: null,
  textSecondaryOverride: null,
  textMutedOverride: null,
  viewMode: "list",
  propertiesOpen: true,
  includeHidden: false,
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

export function clampFontWeight(value: number, options: readonly number[]): number {
  return options.includes(value) ? value : (options[0] ?? 400);
}

export function getThemeLabel(theme: ThemeMode): string {
  return THEME_OPTIONS.find((option) => option.value === theme)?.label ?? theme;
}

export function getUiFontLabel(font: UiFontFamily): string {
  return UI_FONT_OPTIONS.find((option) => option.value === font)?.label ?? font;
}

export function getMonoFontLabel(font: MonoFontFamily): string {
  return MONO_FONT_OPTIONS.find((option) => option.value === font)?.label ?? font;
}
