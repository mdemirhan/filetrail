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
  root.dataset.favoriteAccent = favoriteAccent;
  root.dataset.accentFavoriteItems = accentFavoriteItems ? "true" : "false";
  root.dataset.accentFavoriteText = accentFavoriteItems && accentFavoriteText ? "true" : "false";
  root.style.setProperty("--font-sans", UI_FONT_STACKS[uiFontFamily]);
  root.style.setProperty("--font-mono", '"Fira Code", "SFMono-Regular", ui-monospace, monospace');
  root.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  root.style.setProperty("--ui-font-weight", String(uiFontWeight));
  root.style.setProperty("--mono-font-size", "12px");
  root.style.setProperty("--mono-font-weight", "500");
  for (const propertyName of THEME_VARIANT_OVERRIDE_KEYS) {
    root.style.removeProperty(propertyName);
  }
  const themeVariantVariables = getThemeVariantCssOverrides(theme);
  for (const [propertyName, value] of Object.entries(themeVariantVariables)) {
    root.style.setProperty(propertyName, value);
  }
  const accentTokens = generateAccentTokens(accent, theme);
  const accentVariables = accentTokensToCssVariables(accentTokens);
  for (const [propertyName, value] of Object.entries(accentVariables)) {
    root.style.setProperty(propertyName, value);
  }
  const favoriteAccentVariables = getFavoriteAccentVariables(
    generateAccentTokens(favoriteAccent, theme),
  );
  for (const [propertyName, value] of Object.entries(favoriteAccentVariables)) {
    root.style.setProperty(propertyName, value);
  }
  if (accentToolbarButtons) {
    const toolbarAccentVariables = getToolbarAccentVariables(accentTokens);
    for (const [propertyName, value] of Object.entries(toolbarAccentVariables)) {
      root.style.setProperty(propertyName, value);
    }
  } else {
    for (const propertyName of Object.keys(getToolbarAccentVariables(accentTokens))) {
      root.style.removeProperty(propertyName);
    }
  }
  applyOptionalColor("--text-primary", textPrimaryOverride);
  applyOptionalColor("--text-secondary", textSecondaryOverride);
  applyOptionalColor("--text-tertiary", textMutedOverride);
  applyOptionalColor("--text-dim", textMutedOverride);
  applyOptionalColor("--fg-muted", textMutedOverride);
  applyOptionalColor("--fg-dim", textMutedOverride);
}

function applyOptionalColor(propertyName: string, value: string | null): void {
  if (value) {
    document.documentElement.style.setProperty(propertyName, value);
    return;
  }
  document.documentElement.style.removeProperty(propertyName);
}
