import type { AccentMode, ThemeMode, UiFontFamily } from "../../shared/appPreferences";
import { accentTokensToCssVariables, generateAccentTokens } from "./accent";
import {
  THEME_VARIANT_OVERRIDE_KEYS,
  getThemeVariantCssOverrides,
  resolveThemeCssBase,
} from "./themeVariants";

// CSS files own the full palettes; this module applies the chosen palette, accent and font
// stack at runtime.
export const UI_FONT_STACKS: Record<UiFontFamily, string> = {
  system: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
  "dm-sans": '"DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  lexend: '"Lexend", "DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  "fira-code": '"Fira Code", "SFMono-Regular", ui-monospace, monospace',
  "jetbrains-mono": '"JetBrains Mono", "SFMono-Regular", ui-monospace, monospace',
};

export const UI_MONO_FONT_STACK = '"SF Mono", "SFMono-Regular", ui-monospace, Menlo, monospace';

export function applyAppearance({
  theme,
  accent,
  uiFontFamily,
}: {
  theme: ThemeMode;
  accent: AccentMode;
  uiFontFamily: UiFontFamily;
}): void {
  // Write to `documentElement` so every mounted view observes the same token updates
  // immediately without any component-level plumbing.
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = resolveThemeCssBase(theme);
  root.dataset.themeVariant = theme;
  root.dataset.accent = accent;
  root.style.setProperty("--font-sans", UI_FONT_STACKS[uiFontFamily]);
  root.style.setProperty("--font-mono", UI_MONO_FONT_STACK);
  // Clear what the previous palette set inline, then layer the palette and the accent.
  for (const propertyName of THEME_VARIANT_OVERRIDE_KEYS) {
    root.style.removeProperty(propertyName);
  }
  setProperties(root, getThemeVariantCssOverrides(theme));
  setProperties(root, accentTokensToCssVariables(generateAccentTokens(accent, theme)));
}

function setProperties(root: HTMLElement, variables: Record<string, string>): void {
  for (const [propertyName, value] of Object.entries(variables)) {
    root.style.setProperty(propertyName, value);
  }
}
