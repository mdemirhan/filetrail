import type {
  AccentMode,
  IconThemeMode,
  ThemeMode,
  UiFontFamily,
  UiFontWeight,
} from "../../shared/appPreferences";
import {
  accentTokensToCssVariables,
  generateAccentTokens,
  getFavoriteAccentVariables,
  getToolbarAccentVariables,
} from "./accent";
import {
  THEME_VARIANT_OVERRIDE_KEYS,
  getThemeVariant,
  getThemeVariantCssOverrides,
  resolveThemeCssBase,
} from "./themeVariants";

// CSS files own the full palettes; this module applies the user-selected theme identity,
// font stack, and optional text color overrides at runtime.
const UI_FONT_STACKS: Record<UiFontFamily, string> = {
  system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  "dm-sans": '"DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  lexend: '"Lexend", "DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  "fira-code": '"Fira Code", "SFMono-Regular", ui-monospace, monospace',
  "jetbrains-mono": '"JetBrains Mono", "SFMono-Regular", ui-monospace, monospace',
};

const THEME_DEFAULT_TEXT_COLORS: Record<
  ReturnType<typeof resolveThemeCssBase>,
  { primary: string; secondary: string; muted: string }
> = {
  light: {
    primary: "#1a1c2e",
    secondary: "#3c3f56",
    muted: "#8b8da3",
  },
  dark: {
    primary: "#dcdee4",
    secondary: "#9da1b3",
    muted: "#6e7283",
  },
  "tomorrow-night": {
    primary: "#e0e0e0",
    secondary: "#c5c8c6",
    muted: "#969896",
  },
  "catppuccin-mocha": {
    primary: "#cdd6f4",
    secondary: "#bac2de",
    muted: "#6c7086",
  },
};

export function getThemeAppearanceDefaults(theme: ThemeMode): {
  primary: string;
  secondary: string;
  muted: string;
} {
  return (
    getThemeVariant(theme)?.textDefaults ?? THEME_DEFAULT_TEXT_COLORS[resolveThemeCssBase(theme)]
  );
}

export function applyAppearance({
  theme,
  iconTheme,
  accent,
  accentToolbarButtons,
  toolbarAccent,
  accentFavoriteItems,
  accentFavoriteText,
  favoriteAccent,
  uiFontFamily,
  uiFontSize,
  uiFontWeight,
  textPrimaryOverride,
  textSecondaryOverride,
  textMutedOverride,
}: {
  theme: ThemeMode;
  iconTheme: IconThemeMode;
  accent: AccentMode;
  accentToolbarButtons: boolean;
  toolbarAccent: AccentMode;
  accentFavoriteItems: boolean;
  accentFavoriteText: boolean;
  favoriteAccent: AccentMode;
  uiFontFamily: UiFontFamily;
  uiFontSize: number;
  uiFontWeight: UiFontWeight;
  textPrimaryOverride: string | null;
  textSecondaryOverride: string | null;
  textMutedOverride: string | null;
}): void {
  // Write to `documentElement` so every mounted view observes the same token updates
  // immediately without any component-level plumbing.
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = resolveThemeCssBase(theme);
  root.dataset.themeVariant = theme;
  root.dataset.iconTheme = iconTheme;
  root.dataset.accent = accent;
  root.dataset.toolbarAccent = toolbarAccent;
  root.dataset.favoriteAccent = favoriteAccent;
  root.dataset.accentFavoriteItems = accentFavoriteItems ? "true" : "false";
  root.dataset.accentFavoriteText = accentFavoriteItems && accentFavoriteText ? "true" : "false";
  root.style.setProperty("--font-sans", UI_FONT_STACKS[uiFontFamily]);
  root.style.setProperty(
    "--font-mono",
    '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, monospace',
  );
  root.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  root.style.setProperty("--ui-font-weight", String(uiFontWeight));
  root.style.setProperty("--mono-font-size", "12px");
  root.style.setProperty("--mono-font-weight", "400");
  // Clear everything a previous call may have set inline, then layer: theme variant palette,
  // accents, the toolbar accent (when on), and finally the text color overrides (when set).
  // Removing only up front means a setting that is off leaves the variant's value in place.
  const toolbarAccentTokens = generateAccentTokens(toolbarAccent, theme);
  const toolbarAccentVariables = getToolbarAccentVariables(toolbarAccentTokens);
  for (const propertyName of [
    ...THEME_VARIANT_OVERRIDE_KEYS,
    ...Object.keys(toolbarAccentVariables),
    ...TEXT_OVERRIDE_KEYS,
  ]) {
    root.style.removeProperty(propertyName);
  }
  setProperties(root, getThemeVariantCssOverrides(theme));
  setProperties(root, accentTokensToCssVariables(generateAccentTokens(accent, theme)));
  setProperties(root, getFavoriteAccentVariables(generateAccentTokens(favoriteAccent, theme)));
  if (accentToolbarButtons) {
    setProperties(root, toolbarAccentVariables);
  }
  setOptionalColor(root, ["--text-primary"], textPrimaryOverride);
  setOptionalColor(root, ["--text-secondary"], textSecondaryOverride);
  setOptionalColor(root, TEXT_MUTED_OVERRIDE_KEYS, textMutedOverride);
}

const TEXT_MUTED_OVERRIDE_KEYS = ["--text-tertiary", "--text-dim", "--fg-muted", "--fg-dim"];
const TEXT_OVERRIDE_KEYS = ["--text-primary", "--text-secondary", ...TEXT_MUTED_OVERRIDE_KEYS];

function setProperties(root: HTMLElement, variables: Record<string, string>): void {
  for (const [propertyName, value] of Object.entries(variables)) {
    root.style.setProperty(propertyName, value);
  }
}

function setOptionalColor(root: HTMLElement, propertyNames: string[], value: string | null): void {
  if (!value) {
    return;
  }
  for (const propertyName of propertyNames) {
    root.style.setProperty(propertyName, value);
  }
}
