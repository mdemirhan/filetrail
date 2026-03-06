export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "filetrail.theme";

export function readStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function resolveInitialTheme(): ThemeMode {
  const stored = readStoredTheme();
  if (stored) {
    return stored;
  }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
}

export function persistTheme(theme: ThemeMode): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, theme);
}
