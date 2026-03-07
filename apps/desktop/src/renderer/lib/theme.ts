import type { ThemeMode } from "../../shared/appPreferences";

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
}
