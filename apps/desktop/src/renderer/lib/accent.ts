import type { AccentMode, ThemeMode } from "../../shared/appPreferences";
import { darkenHex, hexToRgb, withAlpha } from "./colorUtils";

type AccentThemeProfile = {
  isLight: boolean;
  hoverBgAlpha: number;
  activeBgAlpha: number;
  pillBgAlpha: number;
  focusBorderAlpha: number;
  heroIconBgAlpha: number;
  actionHoverBgAlpha: number;
  searchPillBorderAlpha: number;
  locationRingAlpha: number;
  folderTintAlpha: number;
};

export type AccentTokens = {
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
  pillText: string;
  border: string;
  focusBorder: string;
  softBg: string;
  activeBg: string;
  heroIconBg: string;
  folderTint: string;
  pathCrumbHover: string;
  actionHoverBg: string;
  searchPillBorder: string;
  locationRing: string;
  ringSoft: string;
};

const ACCENT_THEME_PROFILES: Record<ThemeMode, AccentThemeProfile> = {
  light: {
    isLight: true,
    hoverBgAlpha: 0.14,
    activeBgAlpha: 0.08,
    pillBgAlpha: 0.14,
    focusBorderAlpha: 0.5,
    heroIconBgAlpha: 0.1,
    actionHoverBgAlpha: 0.1,
    searchPillBorderAlpha: 0.55,
    locationRingAlpha: 0.16,
    folderTintAlpha: 0.16,
  },
  dark: {
    isLight: false,
    hoverBgAlpha: 0.12,
    activeBgAlpha: 0.1,
    pillBgAlpha: 0.12,
    focusBorderAlpha: 0.4,
    heroIconBgAlpha: 0.08,
    actionHoverBgAlpha: 0.1,
    searchPillBorderAlpha: 0.5,
    locationRingAlpha: 0.14,
    folderTintAlpha: 0.14,
  },
};

// How much darker the accent's deep shade is: link-like text on light palettes, where the
// accent itself is too pale to read.
const ACCENT_DARK_SHADE = 0.18;

export function generateAccentTokens(accent: AccentMode, theme: ThemeMode): AccentTokens {
  const dark = darkenHex(accent, ACCENT_DARK_SHADE);
  const profile = ACCENT_THEME_PROFILES[theme];
  const button = solidButtonColors(accent);
  const selection = selectionColors(accent);

  return {
    solid: accent,
    solidDark: dark,
    solidButton: button.background,
    onSolid: button.foreground,
    selectionBg: selection.background,
    onSelection: selection.foreground,
    hoverBg: withAlpha(accent, profile.hoverBgAlpha),
    pillBg: withAlpha(accent, profile.pillBgAlpha),
    pillText: profile.isLight ? dark : accent,
    border: withAlpha(accent, 0.3),
    focusBorder: withAlpha(accent, profile.focusBorderAlpha),
    softBg: withAlpha(accent, 0.08),
    activeBg: withAlpha(accent, profile.activeBgAlpha),
    heroIconBg: withAlpha(accent, profile.heroIconBgAlpha),
    folderTint: withAlpha(accent, profile.folderTintAlpha),
    pathCrumbHover: profile.isLight ? dark : accent,
    actionHoverBg: withAlpha(accent, profile.actionHoverBgAlpha),
    searchPillBorder: withAlpha(accent, profile.searchPillBorderAlpha),
    locationRing: withAlpha(accent, profile.locationRingAlpha),
    ringSoft: withAlpha(accent, 0.15),
  };
}

export function accentTokensToCssVariables(tokens: AccentTokens): Record<string, string> {
  return {
    "--bg-active": tokens.activeBg,
    "--crumb-active-bg": tokens.activeBg,
    "--ft-accent-solid": tokens.solid,
    "--ft-accent-solid-dark": tokens.solidDark,
    "--ft-accent-solid-button": tokens.solidButton,
    "--ft-accent-on-solid": tokens.onSolid,
    "--ft-accent-selection-bg": tokens.selectionBg,
    "--ft-accent-on-selection": tokens.onSelection,
    "--ft-accent-on-selection-soft": withAlpha(tokens.onSelection, 0.85),
    "--ft-accent-border": tokens.border,
    "--ft-accent-hover-bg": tokens.hoverBg,
    "--ft-accent-pill-bg": tokens.pillBg,
    "--ft-accent-pill-text": tokens.pillText,
    "--ft-accent-folder-tint": tokens.folderTint,
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
