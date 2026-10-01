import { ACCENT_OPTIONS, MACOS_ACCENT_OPTIONS } from "../../shared/appPreferences";
import {
  accentTokensToCssVariables,
  contrastRatio,
  generateAccentTokens,
  getAccentPalette,
  getFavoriteAccentVariables,
  getToolbarAccentVariables,
  selectionColors,
  solidButtonColors,
} from "./accent";
import { darkenHex } from "./colorUtils";

describe("accent helpers", () => {
  it("looks up palettes by persisted accent color", () => {
    expect(getAccentPalette("#2cb5a0")).toEqual({
      id: "teal",
      value: "#2cb5a0",
      label: "Teal",
      primary: "#2cb5a0",
      dark: "#1e9a87",
    });
  });

  it("generates light and dark accent tokens from the selected theme base", () => {
    const lightTokens = generateAccentTokens("#2cb5a0", "light");
    const variantTokens = generateAccentTokens("#2cb5a0", "obsidian");

    expect(lightTokens).toMatchObject({
      id: "#2cb5a0",
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
    const tokens = generateAccentTokens("#e8729a", "tomorrow-night");

    expect(accentTokensToCssVariables(tokens)).toMatchObject({
      "--accent": "#e8729a",
      "--accent-text": "#e8729a",
      "--ft-accent-solid": "#e8729a",
      "--ft-accent-ring-soft": "rgba(232, 114, 154, 0.15)",
    });
    expect(getToolbarAccentVariables(tokens)).toEqual({
      "--tb-primary-bg": "rgba(232, 114, 154, 0.11)",
      "--tb-primary-fg": "#e8729a",
      "--tb-primary-hover-bg": "rgba(232, 114, 154, 0.11)",
      "--toolbar-toggle-active-bg": "rgba(232, 114, 154, 0.14)",
      "--toolbar-toggle-icon-active": "#e8729a",
      "--sidebar-rail-active-bg": "rgba(232, 114, 154, 0.14)",
      "--sidebar-rail-icon-active": "#e8729a",
      "--sidebar-rail-menu-active-bg": "rgba(232, 114, 154, 0.11)",
      "--sidebar-rail-menu-active-fg": "#e8729a",
      "--sidebar-rail-menu-check": "#e8729a",
    });
    expect(getFavoriteAccentVariables(tokens)).toEqual({
      "--favorite-accent-solid": "#e8729a",
      "--favorite-accent-text": "#e8729a",
      "--favorite-accent-selection-bg": "#b55978",
      "--favorite-accent-on-selection": "#ffffff",
    });
  });

  it("gives solid accent buttons readable text, keeping white where a darker shade allows", () => {
    const check = (accent: string) => {
      const colors = solidButtonColors(accent);
      expect(contrastRatio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
      return colors;
    };
    // Light accents (Gold, Yellow, Aqua, Sky) get black text on the accent itself.
    for (const light of ["#daa520", "#ffc600", "#23c7d9", "#58b9e8"]) {
      expect(check(light)).toEqual({ background: light, foreground: "#000000" });
    }
    // Dark enough accents keep white text, on the accent or a slightly darker shade.
    expect(check("#4f46e5")).toEqual({ background: "#4f46e5", foreground: "#ffffff" });
    expect(check("#007aff").foreground).toBe("#ffffff");
    expect(check("#e0383e").foreground).toBe("#ffffff");
    for (const option of [...ACCENT_OPTIONS, ...MACOS_ACCENT_OPTIONS]) {
      check(option.primary);
    }
    expect(generateAccentTokens("#daa520", "dark").onSolid).toBe("#000000");
    expect(accentTokensToCssVariables(generateAccentTokens("#4f46e5", "light"))).toMatchObject({
      "--ft-accent-solid-button": "#4f46e5",
      "--ft-accent-on-solid": "#ffffff",
    });
  });

  it("fills selected rows with the accent, darkened as far as white text needs", () => {
    // Selections start from the accent darkened like `color-mix(accent 86%, black)`.
    expect(selectionColors("#007aff")).toEqual({ background: "#0069db", foreground: "#ffffff" });
    expect(selectionColors("#4f46e5").foreground).toBe("#ffffff");
    // The default copper is darkened a little further so white reads at 4.5:1.
    const copper = selectionColors("#d4845a");
    expect(copper.foreground).toBe("#ffffff");
    expect(copper.background).toBe("#a56746");
    expect(contrastRatio("#ffffff", copper.background)).toBeGreaterThanOrEqual(4.5);
    // Yellow and gold stop at the darkest allowed shade and still get white text.
    expect(selectionColors("#ffc600")).toEqual({
      background: darkenHex("#ffc600", 0.34),
      foreground: "#ffffff",
    });
    expect(selectionColors("#daa520").foreground).toBe("#ffffff");
    for (const option of [...ACCENT_OPTIONS, ...MACOS_ACCENT_OPTIONS]) {
      const colors = selectionColors(option.primary);
      expect(colors.foreground).toBe("#ffffff");
      // Readable, or already at the darkest shade that still looks like the accent.
      expect(
        contrastRatio("#ffffff", colors.background) >= 4.5 ||
          colors.background === darkenHex(option.primary, 0.34),
      ).toBe(true);
    }
    expect(accentTokensToCssVariables(generateAccentTokens("#ffc600", "dark"))).toMatchObject({
      "--ft-accent-on-selection": "#ffffff",
      "--ft-accent-on-selection-soft": "rgba(255, 255, 255, 0.85)",
    });
  });
});
