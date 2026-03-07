import type {
  MonoFontFamily,
  MonoFontWeight,
  ThemeMode,
  UiFontFamily,
  UiFontWeight,
} from "../../shared/appPreferences";

const UI_FONT_STACKS: Record<UiFontFamily, string> = {
  "dm-sans": '"DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
  lexend: '"Lexend", "DM Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif',
};

const MONO_FONT_STACKS: Record<MonoFontFamily, string> = {
  "jetbrains-mono": '"JetBrains Mono", "SFMono-Regular", ui-monospace, monospace',
  "fira-code": '"Fira Code", "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace',
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
  uiFontFamily,
  uiFontSize,
  uiFontWeight,
  monoFontFamily,
  monoFontSize,
  monoFontWeight,
  textPrimaryOverride,
  textSecondaryOverride,
  textMutedOverride,
}: {
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
}): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--font-sans", UI_FONT_STACKS[uiFontFamily]);
  document.documentElement.style.setProperty("--font-mono", MONO_FONT_STACKS[monoFontFamily]);
  document.documentElement.style.setProperty("--ui-font-size", `${uiFontSize}px`);
  document.documentElement.style.setProperty("--ui-font-weight", String(uiFontWeight));
  document.documentElement.style.setProperty("--mono-font-size", `${monoFontSize}px`);
  document.documentElement.style.setProperty("--mono-font-weight", String(monoFontWeight));
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
