import type {
  AccentMode,
  ThemeMode,
  UiFontFamily,
  UiFontWeight,
} from "../../shared/appPreferences";
import {
  accentTokensToCssVariables,
  generateAccentTokens,
  getToolbarAccentVariables,
} from "./accent";

// CSS files own the full palettes; this module applies the user-selected theme identity,
// font stack, and optional text color overrides at runtime.
const UI_FONT_STACKS: Record<UiFontFamily, string> = {
  "dm-sans": '"DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  lexend: '"Lexend", "DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  "fira-code": '"Fira Code", "SFMono-Regular", ui-monospace, monospace',
  "jetbrains-mono": '"JetBrains Mono", "SFMono-Regular", ui-monospace, monospace',
};

const THEME_DEFAULT_TEXT_COLORS: Record<
  ThemeMode,
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
  return THEME_DEFAULT_TEXT_COLORS[theme];
}

export function applyAppearance({
  theme,
  accent,
  accentToolbarButtons,
  uiFontFamily,
  uiFontSize,
  uiFontWeight,
  textPrimaryOverride,
  textSecondaryOverride,
  textMutedOverride,
}: {
  theme: ThemeMode;
  accent: AccentMode;
  accentToolbarButtons: boolean;
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
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;
  document.documentElement.style.setProperty("--font-sans", UI_FONT_STACKS[uiFontFamily]);
  document.documentElement.style.setProperty(
    "--font-mono",
    '"Fira Code", "SFMono-Regular", ui-monospace, monospace',
  );
  document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  document.documentElement.style.setProperty("--ui-font-weight", String(uiFontWeight));
  document.documentElement.style.setProperty("--mono-font-size", "12px");
  document.documentElement.style.setProperty("--mono-font-weight", "500");
  const accentTokens = generateAccentTokens(accent, theme);
  const accentVariables = accentTokensToCssVariables(accentTokens);
  for (const [propertyName, value] of Object.entries(accentVariables)) {
    document.documentElement.style.setProperty(propertyName, value);
  }
  if (accentToolbarButtons) {
    const toolbarAccentVariables = getToolbarAccentVariables(accentTokens);
    for (const [propertyName, value] of Object.entries(toolbarAccentVariables)) {
      document.documentElement.style.setProperty(propertyName, value);
    }
  } else {
    document.documentElement.style.removeProperty("--tb-primary-bg");
    document.documentElement.style.removeProperty("--tb-primary-fg");
    document.documentElement.style.removeProperty("--tb-primary-hover-bg");
    document.documentElement.style.removeProperty("--toolbar-nav-icon-active");
    document.documentElement.style.removeProperty("--toolbar-toggle-active-bg");
    document.documentElement.style.removeProperty("--toolbar-toggle-icon-active");
    document.documentElement.style.removeProperty("--toolbar-sort-text");
    document.documentElement.style.removeProperty("--toolbar-sort-arrow");
    document.documentElement.style.removeProperty("--sidebar-rail-icon");
    document.documentElement.style.removeProperty("--sidebar-rail-active-bg");
    document.documentElement.style.removeProperty("--sidebar-rail-icon-active");
    document.documentElement.style.removeProperty("--sidebar-rail-menu-active-bg");
    document.documentElement.style.removeProperty("--sidebar-rail-menu-active-fg");
    document.documentElement.style.removeProperty("--sidebar-rail-menu-check");
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
