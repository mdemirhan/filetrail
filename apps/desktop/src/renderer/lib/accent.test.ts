import {
  accentTokensToCssVariables,
  generateAccentTokens,
  getAccentPalette,
  getFavoriteAccentVariables,
  getToolbarAccentVariables,
} from "./accent";

describe("accent helpers", () => {
  it("looks up palettes by persisted accent id", () => {
    expect(getAccentPalette("teal")).toEqual({
      value: "teal",
      label: "Teal",
      primary: "#2cb5a0",
      dark: "#1e9a87",
    });
  });

  it("generates light and dark accent tokens from the selected theme base", () => {
    const lightTokens = generateAccentTokens("teal", "light");
    const variantTokens = generateAccentTokens("teal", "obsidian");

    expect(lightTokens).toMatchObject({
      id: "teal",
      name: "Teal",
      primary: "#2cb5a0",
      solidDark: "#1e9a87",
      hoverBg: "rgba(44, 181, 160, 0.14)",
      pillText: "#1e9a87",
      pathCrumbHover: "#1e9a87",
      locationRing: "rgba(44, 181, 160, 0.16)",
    });
    expect(variantTokens).toMatchObject({
      pillText: "#2cb5a0",
      pathCrumbHover: "#2cb5a0",
      activeStrongBg: "rgba(44, 181, 160, 0.16)",
      locationRing: "rgba(44, 181, 160, 0.14)",
    });
  });

  it("maps accent tokens into CSS variable groups for shared and toolbar styling", () => {
    const tokens = generateAccentTokens("rose", "tomorrow-night");

    expect(accentTokensToCssVariables(tokens)).toMatchObject({
      "--accent": "#e8729a",
      "--accent-text": "#e8729a",
      "--ft-accent-pill-bg": "rgba(232, 114, 154, 0.11)",
      "--ft-accent-search-stop-border": "rgba(232, 114, 154, 0.18)",
      "--ft-accent-ring-soft": "rgba(232, 114, 154, 0.15)",
    });
    expect(getToolbarAccentVariables(tokens)).toEqual({
      "--tb-primary-bg": "rgba(232, 114, 154, 0.11)",
      "--tb-primary-fg": "#e8729a",
      "--tb-primary-hover-bg": "rgba(232, 114, 154, 0.11)",
      "--toolbar-nav-icon-active": "#e8729a",
      "--toolbar-toggle-active-bg": "rgba(232, 114, 154, 0.14)",
      "--toolbar-toggle-icon-active": "#e8729a",
      "--toolbar-sort-text": "#e8729a",
      "--toolbar-sort-arrow": "#e8729a",
      "--sidebar-rail-icon": "#e8729a",
      "--sidebar-rail-active-bg": "rgba(232, 114, 154, 0.14)",
      "--sidebar-rail-icon-active": "#e8729a",
      "--sidebar-rail-menu-active-bg": "rgba(232, 114, 154, 0.11)",
      "--sidebar-rail-menu-active-fg": "#e8729a",
      "--sidebar-rail-menu-check": "#e8729a",
    });
    expect(getFavoriteAccentVariables(tokens)).toEqual({
      "--favorite-accent-solid": "#e8729a",
      "--favorite-accent-text": "#e8729a",
      "--favorite-accent-soft-bg": "rgba(232, 114, 154, 0.08)",
      "--favorite-accent-active-bg": "rgba(232, 114, 154, 0.14)",
      "--favorite-accent-border": "rgba(232, 114, 154, 0.3)",
      "--favorite-accent-focus-border": "rgba(232, 114, 154, 0.4)",
      "--favorite-accent-badge-bg": "rgba(232, 114, 154, 0.11)",
      "--favorite-accent-badge-text": "#e8729a",
    });
  });
});
