import type { ThemeMode } from "../../shared/appPreferences";

import { withAlpha } from "./colorUtils";

export type ThemeCssBase = "light" | "dark" | "tomorrow-night" | "catppuccin-mocha";

type ThemeVariantDefinition = {
  cssBase: ThemeCssBase;
  surfaces: {
    page: string;
    canvas: string;
    toolbar: string;
    toolbarBorder: string;
    card: string;
    cardBorder: string;
    panel: string;
    panelBorder: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    muted: string;
    placeholder: string;
    disabled: string;
  };
  icons: {
    active: string;
    inactive: string;
    muted: string;
  };
  controls: {
    inputBg: string;
    inputBorder: string;
    selectBg: string;
    selectBorder: string;
    selectText: string;
    selectArrow: string;
    toggleOff: string;
    checkOff: string;
    checkBorder: string;
  };
  search: {
    bg: string;
    border: string;
    icon: string;
    placeholder: string;
    badgeBg: string;
    badgeBorder: string;
    badgeText: string;
  };
  viewToggle: {
    bg: string;
    activeBg: string;
    activeIcon: string;
    inactiveIcon: string;
  };
  pills: {
    inactiveBg: string;
    inactiveBorder: string;
    inactiveText: string;
  };
  menu: {
    bg: string;
    border: string;
    separator: string;
    itemText: string;
    itemIcon: string;
    destructive: string;
  };
  inspector: {
    metaLabel: string;
    metaValue: string;
    permsBg: string;
    permsCode: string;
    pathBg: string;
    pathCrumb: string;
  };
  separator: string;
};

const THEME_VARIANTS: Partial<Record<ThemeMode, ThemeVariantDefinition>> = {
  // Neutral system palettes that mirror macOS window, sidebar and label colors. These are
  // the Auto defaults; the tinted palettes below remain available as named themes.
  "macos-light": {
    cssBase: "light",
    surfaces: {
      page: "#ffffff",
      canvas: "#ffffff",
      toolbar: "#fbfbfd",
      toolbarBorder: "#e3e3e8",
      card: "#ffffff",
      cardBorder: "rgba(0,0,0,0.08)",
      panel: "#ececf0",
      panelBorder: "#dcdce1",
    },
    text: {
      primary: "#1d1d1f",
      secondary: "#4a4a50",
      tertiary: "#86868b",
      muted: "#a1a1a6",
      placeholder: "#b0b0b5",
      disabled: "#c7c7cc",
    },
    icons: { active: "#6e6e73", inactive: "#c7c7cc", muted: "#a1a1a6" },
    controls: {
      inputBg: "#ffffff",
      inputBorder: "rgba(0,0,0,0.12)",
      selectBg: "#ffffff",
      selectBorder: "rgba(0,0,0,0.12)",
      selectText: "#1d1d1f",
      selectArrow: "#86868b",
      toggleOff: "#e3e3e8",
      checkOff: "#ffffff",
      checkBorder: "rgba(0,0,0,0.18)",
    },
    search: {
      bg: "#ececf0",
      border: "transparent",
      icon: "#86868b",
      placeholder: "#a1a1a6",
      badgeBg: "#e3e3e8",
      badgeBorder: "#d6d6db",
      badgeText: "#86868b",
    },
    viewToggle: {
      bg: "#ececf0",
      activeBg: "#ffffff",
      activeIcon: "#1d1d1f",
      inactiveIcon: "#6e6e73",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(0,0,0,0.12)",
      inactiveText: "#6e6e73",
    },
    menu: {
      bg: "#f6f6f8",
      border: "rgba(0,0,0,0.16)",
      separator: "rgba(0,0,0,0.1)",
      itemText: "#1d1d1f",
      itemIcon: "#6e6e73",
      destructive: "#e0383e",
    },
    inspector: {
      metaLabel: "#86868b",
      metaValue: "#1d1d1f",
      permsBg: "rgba(0,0,0,0.03)",
      permsCode: "#86868b",
      pathBg: "rgba(0,0,0,0.03)",
      pathCrumb: "#4a4a50",
    },
    separator: "rgba(0,0,0,0.07)",
  },
  "macos-dark": {
    cssBase: "dark",
    surfaces: {
      page: "#1e1e20",
      canvas: "#1e1e20",
      toolbar: "#252528",
      toolbarBorder: "#38383b",
      card: "#2a2a2d",
      cardBorder: "rgba(255,255,255,0.08)",
      panel: "#29292c",
      panelBorder: "#38383b",
    },
    text: {
      primary: "#f2f2f5",
      secondary: "#c7c7cc",
      tertiary: "#98989d",
      muted: "#6e6e73",
      placeholder: "#5f5f64",
      disabled: "#48484a",
    },
    icons: { active: "#a1a1a6", inactive: "#5f5f64", muted: "#6e6e73" },
    controls: {
      inputBg: "rgba(255,255,255,0.06)",
      inputBorder: "rgba(255,255,255,0.1)",
      selectBg: "#3a3a3d",
      selectBorder: "rgba(255,255,255,0.08)",
      selectText: "#f2f2f5",
      selectArrow: "#98989d",
      toggleOff: "#3a3a3d",
      checkOff: "rgba(255,255,255,0.06)",
      checkBorder: "rgba(255,255,255,0.16)",
    },
    search: {
      bg: "#323235",
      border: "transparent",
      icon: "#98989d",
      placeholder: "#6e6e73",
      badgeBg: "#3a3a3d",
      badgeBorder: "#48484a",
      badgeText: "#98989d",
    },
    viewToggle: {
      bg: "#323235",
      activeBg: "#5a5a5e",
      activeIcon: "#f2f2f5",
      inactiveIcon: "#a1a1a6",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(255,255,255,0.1)",
      inactiveText: "#a1a1a6",
    },
    menu: {
      bg: "#2c2c30",
      border: "rgba(255,255,255,0.12)",
      separator: "rgba(255,255,255,0.1)",
      itemText: "#f2f2f5",
      itemIcon: "#a1a1a6",
      destructive: "#ff453a",
    },
    inspector: {
      metaLabel: "#98989d",
      metaValue: "#f2f2f5",
      permsBg: "rgba(255,255,255,0.04)",
      permsCode: "#98989d",
      pathBg: "rgba(255,255,255,0.04)",
      pathCrumb: "#c7c7cc",
    },
    separator: "rgba(255,255,255,0.07)",
  },
  "warm-paper": {
    cssBase: "light",
    surfaces: {
      page: "#f0ede7",
      canvas: "#faf8f4",
      toolbar: "#ece8e0",
      toolbarBorder: "#dbd6cc",
      card: "#fdfcf8",
      cardBorder: "rgba(120,100,60,0.08)",
      panel: "#f0ede7",
      panelBorder: "#dbd6cc",
    },
    text: {
      primary: "#1f1a14",
      secondary: "#3d3528",
      tertiary: "#6b6050",
      muted: "#9c9282",
      placeholder: "#bab0a0",
      disabled: "#c8c0b4",
    },
    icons: { active: "#6b6050", inactive: "#c8c0b4", muted: "#9c9282" },
    controls: {
      inputBg: "#fdfcf9",
      inputBorder: "rgba(100,80,40,0.14)",
      selectBg: "#fdfcf9",
      selectBorder: "rgba(100,80,40,0.14)",
      selectText: "#3d3528",
      selectArrow: "#9c9282",
      toggleOff: "#d0c9bc",
      checkOff: "#fdfcf9",
      checkBorder: "rgba(100,80,40,0.15)",
    },
    search: {
      bg: "#f6f3ee",
      border: "#ccc6ba",
      icon: "#b8b0a0",
      placeholder: "#bab0a0",
      badgeBg: "#edeae4",
      badgeBorder: "#d4d0c6",
      badgeText: "#9c9282",
    },
    viewToggle: {
      bg: "#ddd8ce",
      activeBg: "#d0c9bc",
      activeIcon: "#1f1a14",
      inactiveIcon: "#9c9282",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(100,80,40,0.12)",
      inactiveText: "#7d7364",
    },
    menu: {
      bg: "#f4f0ea",
      border: "#d0c9bc",
      separator: "#ddd8ce",
      itemText: "#1f1a14",
      itemIcon: "#6b6050",
      destructive: "#c03030",
    },
    inspector: {
      metaLabel: "#9c9282",
      metaValue: "#3d3528",
      permsBg: "rgba(100,80,40,0.025)",
      permsCode: "#6b6050",
      pathBg: "rgba(100,80,40,0.03)",
      pathCrumb: "#4d4538",
    },
    separator: "rgba(100,80,40,0.06)",
  },
  sand: {
    cssBase: "light",
    surfaces: {
      page: "#ece7dc",
      canvas: "#f7f3ec",
      toolbar: "#e8e2d7",
      toolbarBorder: "#d3cbc0",
      card: "#faf8f3",
      cardBorder: "rgba(130,110,70,0.09)",
      panel: "#ece7dc",
      panelBorder: "#d3cbc0",
    },
    text: {
      primary: "#1c1508",
      secondary: "#3a3220",
      tertiary: "#655840",
      muted: "#968a74",
      placeholder: "#b4a892",
      disabled: "#c2b8a8",
    },
    icons: { active: "#655840", inactive: "#c2b8a8", muted: "#968a74" },
    controls: {
      inputBg: "#faf8f4",
      inputBorder: "rgba(110,90,50,0.15)",
      selectBg: "#faf8f4",
      selectBorder: "rgba(110,90,50,0.15)",
      selectText: "#3a3220",
      selectArrow: "#968a74",
      toggleOff: "#ccc4b6",
      checkOff: "#faf8f4",
      checkBorder: "rgba(110,90,50,0.15)",
    },
    search: {
      bg: "#f2ede4",
      border: "#c8c0b4",
      icon: "#b4a892",
      placeholder: "#b4a892",
      badgeBg: "#e8e2d8",
      badgeBorder: "#cfc8bc",
      badgeText: "#968a74",
    },
    viewToggle: {
      bg: "#d8d0c4",
      activeBg: "#ccc4b6",
      activeIcon: "#1c1508",
      inactiveIcon: "#968a74",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(110,90,50,0.12)",
      inactiveText: "#787060",
    },
    menu: {
      bg: "#f0ebe2",
      border: "#ccc4b6",
      separator: "#d8d0c4",
      itemText: "#1c1508",
      itemIcon: "#655840",
      destructive: "#c03030",
    },
    inspector: {
      metaLabel: "#968a74",
      metaValue: "#3a3220",
      permsBg: "rgba(110,90,50,0.025)",
      permsCode: "#655840",
      pathBg: "rgba(110,90,50,0.03)",
      pathCrumb: "#4a4030",
    },
    separator: "rgba(110,90,50,0.06)",
  },
};

export const THEME_VARIANT_OVERRIDE_KEYS = Array.from(
  new Set(
    Object.values(THEME_VARIANTS)
      .filter((value): value is ThemeVariantDefinition => value !== undefined)
      .flatMap((variant) => Object.keys(getThemeVariantCssOverridesFromVariant(variant))),
  ),
);

export function getThemeVariant(theme: ThemeMode): ThemeVariantDefinition | null {
  return THEME_VARIANTS[theme] ?? null;
}

export function resolveThemeCssBase(theme: ThemeMode): ThemeCssBase {
  return getThemeVariant(theme)?.cssBase ?? (theme as ThemeCssBase);
}

export function getThemeVariantCssOverrides(theme: ThemeMode): Record<string, string> {
  const variant = getThemeVariant(theme);
  if (!variant) {
    return {};
  }
  return getThemeVariantCssOverridesFromVariant(variant);
}

function getThemeVariantCssOverridesFromVariant(
  variant: ThemeVariantDefinition,
): Record<string, string> {
  const isLight = variant.cssBase === "light";
  return {
    "--bg-base": variant.surfaces.page,
    "--bg-surface": variant.surfaces.panel,
    "--bg-elevated": variant.surfaces.card,
    "--border": variant.surfaces.panelBorder,
    "--border-active": variant.controls.inputBorder,
    "--border-light": variant.separator,
    "--text-primary": variant.text.primary,
    "--text-secondary": variant.text.secondary,
    "--text-tertiary": variant.text.tertiary,
    "--text-dim": variant.text.muted,
    "--icon-neutral": variant.icons.active,
    "--sidebar-bg": variant.surfaces.panel,
    "--toolbar-bg": variant.surfaces.toolbar,
    "--toolbar-border": variant.surfaces.toolbarBorder,
    "--toolbar-nav-icon": variant.icons.inactive,
    "--toolbar-nav-icon-active": variant.icons.active,
    "--toolbar-toggle-bg": variant.viewToggle.bg,
    "--toolbar-toggle-active-bg": variant.viewToggle.activeBg,
    "--toolbar-toggle-icon-active": variant.viewToggle.activeIcon,
    "--get-info-panel-bg": variant.surfaces.page,
    "--get-info-panel-border": variant.surfaces.panelBorder,
    "--get-info-header-text": variant.text.muted,
    "--get-info-close-icon": variant.text.placeholder,
    "--get-info-close-icon-hover": variant.text.secondary,
    "--get-info-hero-name": variant.text.primary,
    "--get-info-meta-separator": variant.separator,
    "--get-info-meta-label": variant.inspector.metaLabel,
    "--get-info-meta-value": variant.inspector.metaValue,
    "--get-info-meta-value-muted": variant.text.muted,
    "--context-menu-bg": variant.menu.bg,
    "--context-menu-bg-blur": withAlpha(variant.menu.bg, isLight ? 0.88 : 0.92),
    "--context-menu-border": variant.menu.border,
    "--context-menu-separator": variant.menu.separator,
    "--context-menu-text": variant.menu.itemText,
    "--context-menu-shortcut": variant.text.muted,
    "--context-menu-disabled": variant.text.disabled,
    "--context-menu-icon": variant.menu.itemIcon,
    "--context-menu-submenu-arrow": variant.text.muted,
    "--dropdown-bg": variant.menu.bg,
    "--fg-bright": variant.text.primary,
    "--fg-muted": variant.text.tertiary,
    "--fg-dim": variant.text.muted,
    "--help-muted": variant.text.tertiary,
    "--search-surface": variant.search.bg,
    "--search-border": variant.search.border,
    "--search-text": variant.text.secondary,
    "--search-icon": variant.search.icon,
    "--search-placeholder": variant.search.placeholder,
    "--search-pill-bg": variant.pills.inactiveBg,
    "--search-pill-border": variant.pills.inactiveBorder,
    "--search-pill-fg": variant.pills.inactiveText,
    "--search-pill-hover-border": variant.search.border,
    "--search-pill-hover-fg": variant.text.secondary,
    "--srbar-canvas": variant.surfaces.page,
    "--srbar-separator": variant.separator,
    "--scroll-thumb": withAlpha(variant.icons.active, isLight ? 0.22 : 0.3),
    "--scroll-thumb-hover": withAlpha(variant.icons.active, isLight ? 0.34 : 0.42),
  };
}
