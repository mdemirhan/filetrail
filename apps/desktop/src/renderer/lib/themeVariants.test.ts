import {
  THEME_VARIANT_OVERRIDE_KEYS,
  getThemeVariant,
  getThemeVariantCssOverrides,
  resolveThemeCssBase,
} from "./themeVariants";

describe("themeVariants", () => {
  it("returns variant definitions for variant palettes and null for stylesheet palettes", () => {
    expect(getThemeVariant("macos-dark")).toMatchObject({
      cssBase: "dark",
      surfaces: { page: "#1e1e20" },
    });
    expect(getThemeVariant("sand")).toMatchObject({ cssBase: "light" });
    expect(getThemeVariant("tomorrow-night")).toBeNull();
    expect(getThemeVariant("catppuccin-mocha")).toBeNull();
  });

  it("resolves css bases for both variants and stylesheet palettes", () => {
    expect(resolveThemeCssBase("macos-dark")).toBe("dark");
    expect(resolveThemeCssBase("macos-light")).toBe("light");
    expect(resolveThemeCssBase("warm-paper")).toBe("light");
    expect(resolveThemeCssBase("tomorrow-night")).toBe("tomorrow-night");
    expect(resolveThemeCssBase("catppuccin-mocha")).toBe("catppuccin-mocha");
  });

  it("builds css overrides for variants and exposes the shared override key list", () => {
    const overrides = getThemeVariantCssOverrides("warm-paper");

    expect(overrides).toMatchObject({ "--bg-base": "#f0ede7" });
    expect(Object.keys(overrides)).toEqual(
      expect.arrayContaining(["--toolbar-bg", "--search-border"]),
    );
    expect(getThemeVariantCssOverrides("tomorrow-night")).toEqual({});
    expect(THEME_VARIANT_OVERRIDE_KEYS).toContain("--bg-base");
    expect(THEME_VARIANT_OVERRIDE_KEYS).toContain("--context-menu-bg");
    expect(new Set(THEME_VARIANT_OVERRIDE_KEYS).size).toBe(THEME_VARIANT_OVERRIDE_KEYS.length);
  });
});
