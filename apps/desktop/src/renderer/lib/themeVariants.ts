import type { ThemeMode } from "../../shared/appPreferences";

import { withAlpha } from "./colorUtils";

export type ThemeCssBase = "light" | "dark" | "tomorrow-night" | "catppuccin-mocha";

type ThemeVariantDefinition = {
  cssBase: ThemeCssBase;
  textDefaults: {
    primary: string;
    secondary: string;
    muted: string;
  };
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
  "clean-white": {
    cssBase: "light",
    textDefaults: { primary: "#111111", secondary: "#333333", muted: "#666666" },
    surfaces: {
      page: "#f3f3f3",
      canvas: "#ffffff",
      toolbar: "#f7f7f7",
      toolbarBorder: "#dfdfdf",
      card: "#ffffff",
      cardBorder: "rgba(0,0,0,0.07)",
      panel: "#f5f5f5",
      panelBorder: "#dfdfdf",
    },
    text: {
      primary: "#111111",
      secondary: "#333333",
      tertiary: "#666666",
      muted: "#999999",
      placeholder: "#b8b8b8",
      disabled: "#cccccc",
    },
    icons: { active: "#666666", inactive: "#cccccc", muted: "#999999" },
    controls: {
      inputBg: "#ffffff",
      inputBorder: "rgba(0,0,0,0.13)",
      selectBg: "#ffffff",
      selectBorder: "rgba(0,0,0,0.13)",
      selectText: "#333333",
      selectArrow: "#999999",
      toggleOff: "#d0d0d0",
      checkOff: "#ffffff",
      checkBorder: "rgba(0,0,0,0.16)",
    },
    search: {
      bg: "#fafafa",
      border: "#d0d0d0",
      icon: "#bbbbbb",
      placeholder: "#b8b8b8",
      badgeBg: "#f0f0f0",
      badgeBorder: "#d8d8d8",
      badgeText: "#999999",
    },
    viewToggle: {
      bg: "#e0e0e0",
      activeBg: "#d4d4d4",
      activeIcon: "#111111",
      inactiveIcon: "#999999",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(0,0,0,0.12)",
      inactiveText: "#777777",
    },
    menu: {
      bg: "#f8f8f8",
      border: "#d5d5d5",
      separator: "#e0e0e0",
      itemText: "#111111",
      itemIcon: "#555555",
      destructive: "#d44040",
    },
    inspector: {
      metaLabel: "#999999",
      metaValue: "#333333",
      permsBg: "rgba(0,0,0,0.025)",
      permsCode: "#666666",
      pathBg: "rgba(0,0,0,0.03)",
      pathCrumb: "#444444",
    },
    separator: "rgba(0,0,0,0.06)",
  },
  "warm-paper": {
    cssBase: "light",
    textDefaults: { primary: "#1f1a14", secondary: "#3d3528", muted: "#6b6050" },
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
  stone: {
    cssBase: "light",
    textDefaults: { primary: "#151515", secondary: "#383838", muted: "#5e5e5e" },
    surfaces: {
      page: "#eeeeee",
      canvas: "#f8f8f8",
      toolbar: "#ebebeb",
      toolbarBorder: "#d8d8d8",
      card: "#fbfbfb",
      cardBorder: "rgba(0,0,0,0.07)",
      panel: "#eeeeee",
      panelBorder: "#d8d8d8",
    },
    text: {
      primary: "#151515",
      secondary: "#383838",
      tertiary: "#5e5e5e",
      muted: "#919191",
      placeholder: "#b0b0b0",
      disabled: "#c0c0c0",
    },
    icons: { active: "#5e5e5e", inactive: "#c0c0c0", muted: "#919191" },
    controls: {
      inputBg: "#fcfcfc",
      inputBorder: "rgba(0,0,0,0.12)",
      selectBg: "#fcfcfc",
      selectBorder: "rgba(0,0,0,0.12)",
      selectText: "#383838",
      selectArrow: "#919191",
      toggleOff: "#c8c8c8",
      checkOff: "#fcfcfc",
      checkBorder: "rgba(0,0,0,0.14)",
    },
    search: {
      bg: "#f4f4f4",
      border: "#c8c8c8",
      icon: "#b0b0b0",
      placeholder: "#b0b0b0",
      badgeBg: "#eeeeee",
      badgeBorder: "#d0d0d0",
      badgeText: "#919191",
    },
    viewToggle: {
      bg: "#d8d8d8",
      activeBg: "#cccccc",
      activeIcon: "#151515",
      inactiveIcon: "#919191",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(0,0,0,0.1)",
      inactiveText: "#707070",
    },
    menu: {
      bg: "#f2f2f2",
      border: "#cdcdcd",
      separator: "#d8d8d8",
      itemText: "#151515",
      itemIcon: "#5e5e5e",
      destructive: "#d44040",
    },
    inspector: {
      metaLabel: "#919191",
      metaValue: "#383838",
      permsBg: "rgba(0,0,0,0.025)",
      permsCode: "#5e5e5e",
      pathBg: "rgba(0,0,0,0.03)",
      pathCrumb: "#484848",
    },
    separator: "rgba(0,0,0,0.06)",
  },
  sand: {
    cssBase: "light",
    textDefaults: { primary: "#1c1508", secondary: "#3a3220", muted: "#655840" },
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
  obsidian: {
    cssBase: "dark",
    textDefaults: { primary: "#f0f0f2", secondary: "#c4c4c8", muted: "#8a8a90" },
    surfaces: {
      page: "#080809",
      canvas: "#0c0c0e",
      toolbar: "#101012",
      toolbarBorder: "#1e1e22",
      card: "#111113",
      cardBorder: "rgba(255,255,255,0.06)",
      panel: "#0e0e10",
      panelBorder: "#1e1e22",
    },
    text: {
      primary: "#f0f0f2",
      secondary: "#c4c4c8",
      tertiary: "#8a8a90",
      muted: "#5e5e64",
      placeholder: "#404046",
      disabled: "#303036",
    },
    icons: { active: "#5e5e64", inactive: "#303036", muted: "#4a4a50" },
    controls: {
      inputBg: "rgba(255,255,255,0.04)",
      inputBorder: "rgba(255,255,255,0.08)",
      selectBg: "rgba(255,255,255,0.04)",
      selectBorder: "rgba(255,255,255,0.08)",
      selectText: "#c4c4c8",
      selectArrow: "#5e5e64",
      toggleOff: "#2a2a2e",
      checkOff: "rgba(255,255,255,0.04)",
      checkBorder: "rgba(255,255,255,0.08)",
    },
    search: {
      bg: "#141416",
      border: "#2e2e32",
      icon: "#404046",
      placeholder: "#404046",
      badgeBg: "#1a1a1e",
      badgeBorder: "#2a2a2e",
      badgeText: "#5e5e64",
    },
    viewToggle: {
      bg: "#1a1a1e",
      activeBg: "#242428",
      activeIcon: "#f0f0f2",
      inactiveIcon: "#5e5e64",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(255,255,255,0.08)",
      inactiveText: "#6a6a70",
    },
    menu: {
      bg: "#141416",
      border: "#262628",
      separator: "#1e1e22",
      itemText: "#c4c4c8",
      itemIcon: "#6a6a70",
      destructive: "#e05555",
    },
    inspector: {
      metaLabel: "#4a4a50",
      metaValue: "#c4c4c8",
      permsBg: "rgba(255,255,255,0.02)",
      permsCode: "#8a8a90",
      pathBg: "rgba(255,255,255,0.025)",
      pathCrumb: "#8a8a90",
    },
    separator: "rgba(255,255,255,0.04)",
  },
  graphite: {
    cssBase: "dark",
    textDefaults: { primary: "#ededec", secondary: "#c0bfba", muted: "#8e8c86" },
    surfaces: {
      page: "#161614",
      canvas: "#1c1c1a",
      toolbar: "#1a1a18",
      toolbarBorder: "#2c2c28",
      card: "#1f1f1d",
      cardBorder: "rgba(255,255,255,0.05)",
      panel: "#1a1a18",
      panelBorder: "#2c2c28",
    },
    text: {
      primary: "#ededec",
      secondary: "#c0bfba",
      tertiary: "#8e8c86",
      muted: "#5e5c58",
      placeholder: "#444240",
      disabled: "#343230",
    },
    icons: { active: "#5e5c58", inactive: "#343230", muted: "#4e4c48" },
    controls: {
      inputBg: "rgba(255,255,255,0.035)",
      inputBorder: "rgba(255,255,255,0.07)",
      selectBg: "rgba(255,255,255,0.035)",
      selectBorder: "rgba(255,255,255,0.07)",
      selectText: "#c0bfba",
      selectArrow: "#5e5c58",
      toggleOff: "#333330",
      checkOff: "rgba(255,255,255,0.035)",
      checkBorder: "rgba(255,255,255,0.07)",
    },
    search: {
      bg: "#222220",
      border: "#383834",
      icon: "#444240",
      placeholder: "#444240",
      badgeBg: "#262624",
      badgeBorder: "#343230",
      badgeText: "#5e5c58",
    },
    viewToggle: {
      bg: "#222220",
      activeBg: "#2c2c28",
      activeIcon: "#ededec",
      inactiveIcon: "#5e5c58",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(255,255,255,0.07)",
      inactiveText: "#706e68",
    },
    menu: {
      bg: "#222220",
      border: "#343430",
      separator: "#2c2c28",
      itemText: "#c0bfba",
      itemIcon: "#706e68",
      destructive: "#dc5555",
    },
    inspector: {
      metaLabel: "#4e4c48",
      metaValue: "#c0bfba",
      permsBg: "rgba(255,255,255,0.02)",
      permsCode: "#8e8c86",
      pathBg: "rgba(255,255,255,0.025)",
      pathCrumb: "#8e8c86",
    },
    separator: "rgba(255,255,255,0.04)",
  },
  midnight: {
    cssBase: "dark",
    textDefaults: { primary: "#eef0f6", secondary: "#b8bece", muted: "#7e8698" },
    surfaces: {
      page: "#0a0d14",
      canvas: "#0e1118",
      toolbar: "#111420",
      toolbarBorder: "#222840",
      card: "#121520",
      cardBorder: "rgba(140,160,255,0.06)",
      panel: "#10131c",
      panelBorder: "#222840",
    },
    text: {
      primary: "#eef0f6",
      secondary: "#b8bece",
      tertiary: "#7e8698",
      muted: "#505870",
      placeholder: "#3a4058",
      disabled: "#2c3248",
    },
    icons: { active: "#505870", inactive: "#2c3248", muted: "#404860" },
    controls: {
      inputBg: "rgba(180,200,255,0.04)",
      inputBorder: "rgba(140,160,255,0.08)",
      selectBg: "rgba(180,200,255,0.04)",
      selectBorder: "rgba(140,160,255,0.08)",
      selectText: "#b8bece",
      selectArrow: "#505870",
      toggleOff: "#2a3040",
      checkOff: "rgba(180,200,255,0.04)",
      checkBorder: "rgba(140,160,255,0.08)",
    },
    search: {
      bg: "#161a26",
      border: "#303858",
      icon: "#3a4058",
      placeholder: "#3a4058",
      badgeBg: "#1a1e2e",
      badgeBorder: "#2a3048",
      badgeText: "#505870",
    },
    viewToggle: {
      bg: "#1a1e2e",
      activeBg: "#242a3c",
      activeIcon: "#eef0f6",
      inactiveIcon: "#505870",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(140,160,255,0.08)",
      inactiveText: "#606878",
    },
    menu: {
      bg: "#161a26",
      border: "#2a3048",
      separator: "#222840",
      itemText: "#b8bece",
      itemIcon: "#606878",
      destructive: "#e05555",
    },
    inspector: {
      metaLabel: "#404860",
      metaValue: "#b8bece",
      permsBg: "rgba(140,160,255,0.02)",
      permsCode: "#7e8698",
      pathBg: "rgba(140,160,255,0.025)",
      pathCrumb: "#7e8698",
    },
    separator: "rgba(140,160,255,0.04)",
  },
  onyx: {
    cssBase: "dark",
    textDefaults: { primary: "#e8eaf0", secondary: "#b8bcc8", muted: "#848998" },
    surfaces: {
      page: "#101218",
      canvas: "#14161c",
      toolbar: "#16181e",
      toolbarBorder: "#282c36",
      card: "#181a20",
      cardBorder: "rgba(255,255,255,0.06)",
      panel: "#151720",
      panelBorder: "#282c36",
    },
    text: {
      primary: "#e8eaf0",
      secondary: "#b8bcc8",
      tertiary: "#848998",
      muted: "#585e70",
      placeholder: "#404558",
      disabled: "#303446",
    },
    icons: { active: "#585e70", inactive: "#303446", muted: "#484e60" },
    controls: {
      inputBg: "rgba(255,255,255,0.04)",
      inputBorder: "rgba(255,255,255,0.08)",
      selectBg: "rgba(255,255,255,0.04)",
      selectBorder: "rgba(255,255,255,0.08)",
      selectText: "#b8bcc8",
      selectArrow: "#585e70",
      toggleOff: "#2e3240",
      checkOff: "rgba(255,255,255,0.04)",
      checkBorder: "rgba(255,255,255,0.08)",
    },
    search: {
      bg: "#1c1e26",
      border: "#34384a",
      icon: "#404558",
      placeholder: "#404558",
      badgeBg: "#202430",
      badgeBorder: "#30343e",
      badgeText: "#585e70",
    },
    viewToggle: {
      bg: "#1e2028",
      activeBg: "#282c36",
      activeIcon: "#e8eaf0",
      inactiveIcon: "#585e70",
    },
    pills: {
      inactiveBg: "transparent",
      inactiveBorder: "rgba(255,255,255,0.08)",
      inactiveText: "#666c7c",
    },
    menu: {
      bg: "#1c1e26",
      border: "#30343e",
      separator: "#282c36",
      itemText: "#b8bcc8",
      itemIcon: "#666c7c",
      destructive: "#e05555",
    },
    inspector: {
      metaLabel: "#484e60",
      metaValue: "#b8bcc8",
      permsBg: "rgba(255,255,255,0.02)",
      permsCode: "#848998",
      pathBg: "rgba(255,255,255,0.025)",
      pathCrumb: "#848998",
    },
    separator: "rgba(255,255,255,0.04)",
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
    "--border-inactive": variant.surfaces.panelBorder,
    "--border-light": variant.separator,
    "--text-primary": variant.text.primary,
    "--text-secondary": variant.text.secondary,
    "--text-tertiary": variant.text.tertiary,
    "--text-dim": variant.text.muted,
    "--icon-neutral": variant.icons.active,
    "--sidebar-bg": variant.surfaces.panel,
    "--toolbar-bg": variant.surfaces.toolbar,
    "--toolbar-border": variant.surfaces.toolbarBorder,
    "--toolbar-title-fg": variant.text.muted,
    "--toolbar-nav-icon": variant.icons.inactive,
    "--toolbar-nav-icon-active": variant.icons.active,
    "--toolbar-toggle-bg": variant.viewToggle.bg,
    "--toolbar-toggle-active-bg": variant.viewToggle.activeBg,
    "--toolbar-toggle-icon-active": variant.viewToggle.activeIcon,
    "--toolbar-toggle-icon-inactive": variant.viewToggle.inactiveIcon,
    "--toolbar-sort-text": variant.text.secondary,
    "--toolbar-sort-arrow": variant.text.muted,
    "--get-info-panel-bg": variant.surfaces.page,
    "--get-info-panel-border": variant.surfaces.panelBorder,
    "--get-info-header-text": variant.text.muted,
    "--get-info-close-icon": variant.text.placeholder,
    "--get-info-close-icon-hover": variant.text.secondary,
    "--get-info-hero-name": variant.text.primary,
    "--get-info-hero-type": variant.text.muted,
    "--get-info-meta-separator": variant.separator,
    "--get-info-meta-label": variant.inspector.metaLabel,
    "--get-info-meta-value": variant.inspector.metaValue,
    "--get-info-meta-value-muted": variant.text.muted,
    "--get-info-path-bg": variant.inspector.pathBg,
    "--get-info-path-border": variant.surfaces.panelBorder,
    "--get-info-path-text": variant.text.secondary,
    "--get-info-path-separator": variant.text.placeholder,
    "--get-info-path-crumb": variant.inspector.pathCrumb,
    "--get-info-path-copy-icon": variant.text.placeholder,
    "--get-info-perms-bg": variant.inspector.permsBg,
    "--get-info-perms-text": variant.text.secondary,
    "--get-info-perms-code": variant.inspector.permsCode,
    "--get-info-perms-code-bg": variant.inspector.pathBg,
    "--context-menu-bg": variant.menu.bg,
    "--context-menu-bg-blur": withAlpha(variant.menu.bg, isLight ? 0.88 : 0.92),
    "--context-menu-border": variant.menu.border,
    "--context-menu-separator": variant.menu.separator,
    "--context-menu-text": variant.menu.itemText,
    "--context-menu-text-muted": variant.text.muted,
    "--context-menu-shortcut": variant.text.muted,
    "--context-menu-disabled": variant.text.disabled,
    "--context-menu-icon": variant.menu.itemIcon,
    "--context-menu-submenu-arrow": variant.text.muted,
    "--dropdown-bg": variant.menu.bg,
    "--bg-raised": variant.surfaces.panel,
    "--fg": variant.text.secondary,
    "--fg-bright": variant.text.primary,
    "--fg-muted": variant.text.tertiary,
    "--fg-dim": variant.text.muted,
    "--help-muted": variant.text.tertiary,
    "--help-key-bg": variant.surfaces.card,
    "--crumb-row-bg": variant.surfaces.toolbar,
    "--search-surface": variant.search.bg,
    "--search-surface-strong": variant.search.bg,
    "--search-border": variant.search.border,
    "--search-divider": variant.menu.separator,
    "--search-panel-separator": variant.menu.separator,
    "--search-text": variant.text.secondary,
    "--search-icon": variant.search.icon,
    "--search-placeholder": variant.search.placeholder,
    "--search-shortcut-bg": variant.search.badgeBg,
    "--search-shortcut-border": variant.search.badgeBorder,
    "--search-shortcut-fg": variant.search.badgeText,
    "--search-pill-bg": variant.pills.inactiveBg,
    "--search-pill-border": variant.pills.inactiveBorder,
    "--search-pill-fg": variant.pills.inactiveText,
    "--search-pill-hover-border": variant.search.border,
    "--search-pill-hover-fg": variant.text.secondary,
    "--search-meta-fg": variant.text.muted,
    "--srbar-canvas": variant.surfaces.page,
    "--srbar-separator": variant.separator,
    "--srbar-status-label": variant.text.muted,
    "--srbar-path": variant.inspector.pathCrumb,
    "--srbar-count": variant.text.muted,
    "--srbar-count-number": variant.text.secondary,
    "--srbar-action-text": variant.text.secondary,
    "--srbar-action-icon": variant.menu.itemIcon,
    "--srbar-filter-bg": variant.controls.inputBg,
    "--srbar-filter-text": variant.text.secondary,
    "--srbar-filter-placeholder": variant.search.placeholder,
    "--srbar-filter-icon": variant.search.icon,
    "--srbar-select-bg": variant.controls.selectBg,
    "--srbar-select-text": variant.controls.selectText,
    "--srbar-select-arrow": variant.controls.selectArrow,
    "--scroll-thumb": withAlpha(variant.icons.active, isLight ? 0.22 : 0.3),
    "--scroll-thumb-hover": withAlpha(variant.icons.active, isLight ? 0.34 : 0.42),
  };
}
