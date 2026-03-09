import {
  THEME_VARIANT_OVERRIDE_KEYS,
  getThemeVariant,
  getThemeVariantCssOverrides,
  resolveThemeCssBase,
} from "./themeVariants";

describe("themeVariants", () => {
  it("returns variant definitions for custom themes and null for base themes", () => {
    expect(getThemeVariant("obsidian")).toMatchObject({
      cssBase: "dark",
      textDefaults: {
        primary: "#f0f0f2",
      },
    });
    expect(getThemeVariant("dark")).toBeNull();
  });

  it("resolves css bases for both custom variants and built-in base themes", () => {
    expect(resolveThemeCssBase("obsidian")).toBe("dark");
    expect(resolveThemeCssBase("clean-white")).toBe("light");
    expect(resolveThemeCssBase("tomorrow-night")).toBe("tomorrow-night");
  });

  it("builds css overrides for theme variants and exposes the shared override key list", () => {
    const overrides = getThemeVariantCssOverrides("clean-white");

    expect(overrides).toMatchObject({
      "--bg-base": "#f3f3f3",
      "--toolbar-bg": "#f7f7f7",
      "--search-border": "#d0d0d0",
      "--context-menu-bg-blur": "rgba(248, 248, 248, 0.88)",
      "--scroll-thumb": "rgba(102, 102, 102, 0.22)",
    });
    expect(getThemeVariantCssOverrides("dark")).toEqual({});
    expect(THEME_VARIANT_OVERRIDE_KEYS).toContain("--bg-base");
    expect(THEME_VARIANT_OVERRIDE_KEYS).toContain("--context-menu-bg-blur");
    expect(new Set(THEME_VARIANT_OVERRIDE_KEYS).size).toBe(THEME_VARIANT_OVERRIDE_KEYS.length);
  });
});
