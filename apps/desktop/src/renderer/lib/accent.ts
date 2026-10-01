import { ACCENT_OPTIONS, type AccentMode, type ThemeMode } from "../../shared/appPreferences";
import { darkenHex, hexToRgb, withAlpha } from "./colorUtils";
import { type ThemeCssBase, resolveThemeCssBase } from "./themeVariants";

type AccentThemeProfile = {
  isLight: boolean;
  hoverBgAlpha: number;
  activeBgAlpha: number;
  activeStrongAlpha: number;
  pillBgAlpha: number;
  pillBorderAlpha: number;
  focusBorderAlpha: number;
  heroIconBgAlpha: number;
  actionHoverBgAlpha: number;
  calloutBgAlpha: number;
  calloutBorderAlpha: number;
  searchPillBgAlpha: number;
  searchPillBorderAlpha: number;
  searchStopBgAlpha: number;
  searchStopBgHoverAlpha: number;
  searchStopBorderAlpha: number;
  searchToggleBgAlpha: number;
  locationRingAlpha: number;
  folderTintAlpha: number;
};

export type AccentTokens = {
  id: AccentMode;
  name: string;
  primary: string;
  dark: string;
  solid: string;
  solidDark: string;
  /** Background of solid (default) buttons: the accent, a touch darker if that keeps white text. */
  solidButton: string;
  /** Text on `solidButton`: white or black, always at least 4.5:1. */
  onSolid: string;
  /** Background of a selected row in the focused pane: the accent, darkened for white text. */
  selectionBg: string;
  /** Text on `selectionBg`: always white, as on macOS. */
  onSelection: string;
  hoverBg: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  border: string;
  borderSoft: string;
  focusBorder: string;
  softBg: string;
  activeBg: string;
  activeStrongBg: string;
  heroIconBg: string;
  folderTint: string;
  pathCrumbHover: string;
  actionHoverBg: string;
  calloutBg: string;
  calloutBorder: string;
  searchPillBg: string;
  searchPillBorder: string;
  searchStopBg: string;
  searchStopBgHover: string;
  searchStopBorder: string;
  searchToggleBg: string;
  locationRing: string;
  ringSoft: string;
};

const ACCENT_THEME_PROFILES: Record<ThemeCssBase, AccentThemeProfile> = {
  light: {
    isLight: true,
    hoverBgAlpha: 0.14,
    activeBgAlpha: 0.08,
    activeStrongAlpha: 0.14,
    pillBgAlpha: 0.14,
    pillBorderAlpha: 0.3,
    focusBorderAlpha: 0.5,
    heroIconBgAlpha: 0.1,
    actionHoverBgAlpha: 0.1,
    calloutBgAlpha: 0.06,
    calloutBorderAlpha: 0.15,
    searchPillBgAlpha: 0.08,
    searchPillBorderAlpha: 0.55,
    searchStopBgAlpha: 0.08,
    searchStopBgHoverAlpha: 0.15,
    searchStopBorderAlpha: 0.25,
    searchToggleBgAlpha: 0.14,
    locationRingAlpha: 0.16,
    folderTintAlpha: 0.16,
  },
  dark: {
    isLight: false,
    hoverBgAlpha: 0.12,
    activeBgAlpha: 0.1,
    activeStrongAlpha: 0.16,
    pillBgAlpha: 0.12,
    pillBorderAlpha: 0.3,
    focusBorderAlpha: 0.4,
    heroIconBgAlpha: 0.08,
    actionHoverBgAlpha: 0.1,
    calloutBgAlpha: 0.06,
    calloutBorderAlpha: 0.12,
    searchPillBgAlpha: 0.12,
    searchPillBorderAlpha: 0.5,
    searchStopBgAlpha: 0.08,
    searchStopBgHoverAlpha: 0.14,
    searchStopBorderAlpha: 0.2,
    searchToggleBgAlpha: 0.12,
    locationRingAlpha: 0.14,
    folderTintAlpha: 0.14,
  },
  "tomorrow-night": {
    isLight: false,
    hoverBgAlpha: 0.11,
    activeBgAlpha: 0.1,
    activeStrongAlpha: 0.14,
    pillBgAlpha: 0.11,
    pillBorderAlpha: 0.28,
    focusBorderAlpha: 0.4,
    heroIconBgAlpha: 0.07,
    actionHoverBgAlpha: 0.09,
    calloutBgAlpha: 0.05,
    calloutBorderAlpha: 0.1,
    searchPillBgAlpha: 0.12,
    searchPillBorderAlpha: 0.5,
    searchStopBgAlpha: 0.07,
    searchStopBgHoverAlpha: 0.13,
    searchStopBorderAlpha: 0.18,
    searchToggleBgAlpha: 0.11,
    locationRingAlpha: 0.18,
    folderTintAlpha: 0.18,
  },
  "catppuccin-mocha": {
    isLight: false,
    hoverBgAlpha: 0.11,
    activeBgAlpha: 0.1,
    activeStrongAlpha: 0.18,
    pillBgAlpha: 0.1,
    pillBorderAlpha: 0.25,
    focusBorderAlpha: 0.35,
    heroIconBgAlpha: 0.07,
    actionHoverBgAlpha: 0.08,
    calloutBgAlpha: 0.05,
    calloutBorderAlpha: 0.1,
    searchPillBgAlpha: 0.12,
    searchPillBorderAlpha: 0.5,
    searchStopBgAlpha: 0.07,
    searchStopBgHoverAlpha: 0.12,
    searchStopBorderAlpha: 0.18,
    searchToggleBgAlpha: 0.1,
    locationRingAlpha: 0.18,
    folderTintAlpha: 0.18,
  },
};

export function getAccentPalette(accent: AccentMode) {
  return (
    ACCENT_OPTIONS.find((option) => option.value === accent) ?? {
      id: "custom",
      value: accent,
      label: "Custom",
      primary: accent,
      dark: darkenHex(accent, 0.18),
    }
  );
}

export function generateAccentTokens(accent: AccentMode, theme: ThemeMode): AccentTokens {
  const palette = getAccentPalette(accent);
  const profile = ACCENT_THEME_PROFILES[resolveThemeCssBase(theme)];
  const button = solidButtonColors(palette.primary);
  const selection = selectionColors(palette.primary);

  return {
    id: accent,
    name: palette.label,
    primary: palette.primary,
    dark: palette.dark,
    solid: palette.primary,
    solidDark: palette.dark,
    solidButton: button.background,
    onSolid: button.foreground,
    selectionBg: selection.background,
    onSelection: selection.foreground,
    hoverBg: withAlpha(palette.primary, profile.hoverBgAlpha),
    pillBg: withAlpha(palette.primary, profile.pillBgAlpha),
    pillBorder: withAlpha(palette.primary, profile.pillBorderAlpha),
    pillText: profile.isLight ? palette.dark : palette.primary,
    border: withAlpha(palette.primary, 0.3),
    borderSoft: withAlpha(palette.primary, 0.18),
    focusBorder: withAlpha(palette.primary, profile.focusBorderAlpha),
    softBg: withAlpha(palette.primary, 0.08),
    activeBg: withAlpha(palette.primary, profile.activeBgAlpha),
    activeStrongBg: withAlpha(palette.primary, profile.activeStrongAlpha),
    heroIconBg: withAlpha(palette.primary, profile.heroIconBgAlpha),
    folderTint: withAlpha(palette.primary, profile.folderTintAlpha),
    pathCrumbHover: profile.isLight ? palette.dark : palette.primary,
    actionHoverBg: withAlpha(palette.primary, profile.actionHoverBgAlpha),
    calloutBg: withAlpha(palette.primary, profile.calloutBgAlpha),
    calloutBorder: withAlpha(palette.primary, profile.calloutBorderAlpha),
    searchPillBg: withAlpha(palette.primary, profile.searchPillBgAlpha),
    searchPillBorder: withAlpha(palette.primary, profile.searchPillBorderAlpha),
    searchStopBg: withAlpha(palette.primary, profile.searchStopBgAlpha),
    searchStopBgHover: withAlpha(palette.primary, profile.searchStopBgHoverAlpha),
    searchStopBorder: withAlpha(palette.primary, profile.searchStopBorderAlpha),
    searchToggleBg: withAlpha(palette.primary, profile.searchToggleBgAlpha),
    locationRing: withAlpha(palette.primary, profile.locationRingAlpha),
    ringSoft: withAlpha(palette.primary, 0.15),
  };
}

export function accentTokensToCssVariables(tokens: AccentTokens): Record<string, string> {
  return {
    "--bg-active": tokens.activeBg,
    "--crumb-active-bg": tokens.activeBg,
    "--accent": tokens.solid,
    "--accent-blue": tokens.solid,
    "--accent-blue-dim": tokens.hoverBg,
    "--accent-blue-border": tokens.border,
    "--accent-gold": tokens.solid,
    "--accent-gold-dim": tokens.folderTint,
    "--accent-soft": tokens.pillBg,
    "--accent-text": tokens.pillText,
    "--help-accent": tokens.solid,
    "--ft-accent-solid": tokens.solid,
    "--ft-accent-solid-dark": tokens.solidDark,
    "--ft-accent-solid-button": tokens.solidButton,
    "--ft-accent-on-solid": tokens.onSolid,
    "--ft-accent-selection-bg": tokens.selectionBg,
    "--ft-accent-on-selection": tokens.onSelection,
    "--ft-accent-on-selection-soft": withAlpha(tokens.onSelection, 0.85),
    "--ft-accent-hover-bg": tokens.hoverBg,
    "--ft-accent-border": tokens.border,
    "--ft-accent-soft-bg": tokens.softBg,
    "--ft-accent-hero-icon-bg": tokens.heroIconBg,
    "--ft-accent-path-crumb-hover": tokens.pathCrumbHover,
    "--ft-accent-action-hover-bg": tokens.actionHoverBg,
    "--ft-accent-search-pill-border": tokens.searchPillBorder,
    "--ft-accent-location-ring": tokens.locationRing,
    "--ft-accent-ring-soft": tokens.ringSoft,
  };
}

// WCAG relative luminance of an sRGB hex color (0 for black, 1 for white).
export function relativeLuminance(value: string): number {
  const rgb = hexToRgb(value);
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const MIN_TEXT_CONTRAST = 4.5;
// How much a solid button may be darkened to keep white text before it stops looking like
// the accent color; lighter accents (gold, yellow, aqua…) get black text instead.
const MAX_BUTTON_DARKENING = 0.2;

// Colors for a solid accent button with readable text (at least 4.5:1, WCAG AA). macOS
// buttons have white text, so white is kept when the accent is dark enough or a slightly
// darker shade of it is; otherwise the text is black on the accent itself.
export function solidButtonColors(accent: string): { background: string; foreground: string } {
  if (!/^#[0-9a-f]{6}$/iu.test(accent)) {
    return { background: accent, foreground: "#ffffff" };
  }
  for (let step = 0; step <= MAX_BUTTON_DARKENING * 100; step += 1) {
    const background = step === 0 ? accent : darkenHex(accent, step / 100);
    if (contrastRatio("#ffffff", background) >= MIN_TEXT_CONTRAST) {
      return { background, foreground: "#ffffff" };
    }
  }
  return { background: accent, foreground: "#000000" };
}

// How much a selected row darkens the accent at the least (in percent), so selections read
// as a deeper shade of it.
const SELECTION_DARKENING_PERCENT = 14;
// Lighter accents are darkened further until white text is readable, up to this much; past
// it the fill would no longer look like the accent.
const MAX_SELECTION_DARKENING_PERCENT = 34;

// Colors for a selected row in the focused pane: the accent as a fill with white text, as
// in Finder. The fill is darkened just far enough for white to reach 4.5:1; the lightest
// accents (yellow, gold) stop at the darkest allowed shade and stay a little under that.
export function selectionColors(accent: string): { background: string; foreground: string } {
  if (!/^#[0-9a-f]{6}$/iu.test(accent)) {
    return {
      background: `color-mix(in srgb, ${accent} ${100 - SELECTION_DARKENING_PERCENT}%, black)`,
      foreground: "#ffffff",
    };
  }
  let percent = SELECTION_DARKENING_PERCENT;
  let background = darkenHex(accent, percent / 100);
  while (
    percent < MAX_SELECTION_DARKENING_PERCENT &&
    contrastRatio("#ffffff", background) < MIN_TEXT_CONTRAST
  ) {
    percent += 1;
    background = darkenHex(accent, percent / 100);
  }
  return { background, foreground: "#ffffff" };
}
