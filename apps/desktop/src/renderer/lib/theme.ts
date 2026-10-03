import type { AccentMode, ThemeMode } from "../../shared/appPreferences";
import { accentTokensToCssVariables, generateAccentTokens } from "./accent";

// styles.css owns the light and dark palettes; this module picks one and applies the accent.
export function applyAppearance({ theme, accent }: { theme: ThemeMode; accent: AccentMode }): void {
  // Write to `documentElement` so every mounted view observes the same token updates
  // immediately without any component-level plumbing.
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.accent = accent;
  for (const [propertyName, value] of Object.entries(
    accentTokensToCssVariables(generateAccentTokens(accent, theme)),
  )) {
    root.style.setProperty(propertyName, value);
  }
}
