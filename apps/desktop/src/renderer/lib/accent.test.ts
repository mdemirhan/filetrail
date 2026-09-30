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
      "--ft-accent-pill-text": "#e8729a",
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
      "--favorite-accent-selection-bg": "#c86284",
      "--favorite-accent-on-selection": "#000000",
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

  it("keeps selected-row text white where it reads well and switches to black otherwise", () => {
    // Selections are the accent darkened like `color-mix(accent 86%, black)`.
    expect(selectionColors("#007aff")).toEqual({ background: "#0069db", foreground: "#ffffff" });
    expect(selectionColors("#4f46e5").foreground).toBe("#ffffff");
    // Yellow and gold stay light even darkened: black text reads far better.
    expect(selectionColors("#ffc600").foreground).toBe("#000000");
    expect(selectionColors("#daa520").foreground).toBe("#000000");
    for (const option of [...ACCENT_OPTIONS, ...MACOS_ACCENT_OPTIONS]) {
      const colors = selectionColors(option.primary);
      const other = colors.foreground === "#ffffff" ? "#000000" : "#ffffff";
      // Whichever is chosen is readable, or at least the better of the two.
      expect(
        contrastRatio(colors.foreground, colors.background) >= 4.5 ||
          contrastRatio(colors.foreground, colors.background) >=
            contrastRatio(other, colors.background),
      ).toBe(true);
    }
    expect(accentTokensToCssVariables(generateAccentTokens("#ffc600", "dark"))).toMatchObject({
      "--ft-accent-on-selection": "#000000",
      "--ft-accent-on-selection-soft": "rgba(0, 0, 0, 0.85)",
    });
  });
});
