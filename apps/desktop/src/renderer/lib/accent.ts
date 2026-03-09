import {
  ACCENT_OPTIONS,
  type AccentMode,
  type ThemeMode,
} from "../../shared/appPreferences";
import { withAlpha } from "./colorUtils";
import { resolveThemeCssBase, type ThemeCssBase } from "./themeVariants";

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

const ACCENT_PALETTES = Object.fromEntries(
  ACCENT_OPTIONS.map((accent) => [accent.value, accent]),
) as Record<AccentMode, (typeof ACCENT_OPTIONS)[number]>;

export function getAccentPalette(accent: AccentMode) {
  return ACCENT_PALETTES[accent];
}

export function generateAccentTokens(accent: AccentMode, theme: ThemeMode): AccentTokens {
  const palette = getAccentPalette(accent);
  const profile = ACCENT_THEME_PROFILES[resolveThemeCssBase(theme)];

  return {
    id: accent,
    name: palette.label,
    primary: palette.primary,
    dark: palette.dark,
    solid: palette.primary,
    solidDark: palette.dark,
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
    "--bg-active-strong": tokens.activeStrongBg,
    "--crumb-active-bg": tokens.activeBg,
    "--accent": tokens.solid,
    "--accent-blue": tokens.solid,
    "--accent-blue-dim": tokens.hoverBg,
    "--accent-blue-mid": tokens.pillBg,
    "--accent-blue-border": tokens.border,
    "--accent-gold": tokens.solid,
    "--accent-gold-dim": tokens.folderTint,
    "--accent-soft": tokens.pillBg,
    "--accent-text": tokens.pillText,
    "--help-accent": tokens.solid,
    "--help-accent-dim": tokens.calloutBg,
    "--ft-accent-solid": tokens.solid,
    "--ft-accent-solid-dark": tokens.solidDark,
    "--ft-accent-hover-bg": tokens.hoverBg,
    "--ft-accent-pill-bg": tokens.pillBg,
    "--ft-accent-pill-border": tokens.pillBorder,
    "--ft-accent-pill-text": tokens.pillText,
    "--ft-accent-border": tokens.border,
    "--ft-accent-border-soft": tokens.borderSoft,
    "--ft-accent-focus-border": tokens.focusBorder,
    "--ft-accent-soft-bg": tokens.softBg,
    "--ft-accent-hero-icon-bg": tokens.heroIconBg,
    "--ft-accent-path-crumb-hover": tokens.pathCrumbHover,
    "--ft-accent-action-hover-bg": tokens.actionHoverBg,
    "--ft-accent-callout-bg": tokens.calloutBg,
    "--ft-accent-callout-border": tokens.calloutBorder,
    "--ft-accent-search-pill-bg": tokens.searchPillBg,
    "--ft-accent-search-pill-border": tokens.searchPillBorder,
    "--ft-accent-search-stop-bg": tokens.searchStopBg,
    "--ft-accent-search-stop-bg-hover": tokens.searchStopBgHover,
    "--ft-accent-search-stop-border": tokens.searchStopBorder,
    "--ft-accent-search-toggle-bg": tokens.searchToggleBg,
    "--ft-accent-location-ring": tokens.locationRing,
    "--ft-accent-ring-soft": tokens.ringSoft,
  };
}

export function getToolbarAccentVariables(tokens: AccentTokens): Record<string, string> {
  return {
    "--tb-primary-bg": tokens.pillBg,
    "--tb-primary-fg": tokens.pillText,
    "--tb-primary-hover-bg": tokens.hoverBg,
    "--toolbar-nav-icon-active": tokens.pathCrumbHover,
    "--toolbar-toggle-active-bg": tokens.activeStrongBg,
    "--toolbar-toggle-icon-active": tokens.pathCrumbHover,
    "--toolbar-sort-text": tokens.pathCrumbHover,
    "--toolbar-sort-arrow": tokens.pathCrumbHover,
    "--sidebar-rail-icon": tokens.pathCrumbHover,
    "--sidebar-rail-active-bg": tokens.activeStrongBg,
    "--sidebar-rail-icon-active": tokens.pathCrumbHover,
    "--sidebar-rail-menu-active-bg": tokens.hoverBg,
    "--sidebar-rail-menu-active-fg": tokens.pathCrumbHover,
    "--sidebar-rail-menu-check": tokens.pathCrumbHover,
  };
}
