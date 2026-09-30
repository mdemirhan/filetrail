// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { applyAppearance } from "./theme";
import { UI_FONT_STACKS, UI_MONO_FONT_STACK, getThemeAppearanceDefaults } from "./theme";

describe("theme helpers", () => {
  it("returns variant-specific text defaults when a custom theme overrides the base palette", () => {
    expect(getThemeAppearanceDefaults("obsidian")).toEqual({
      primary: "#f0f0f2",
      secondary: "#c4c4c8",
      muted: "#8a8a90",
    });
    expect(getThemeAppearanceDefaults("dark")).toEqual({
      primary: "#dcdee4",
      secondary: "#9da1b3",
      muted: "#6e7283",
    });
  });

  it("applies theme and typography variables to the document root", () => {
    applyAppearance({
      theme: "dark",
      iconTheme: "classic",
      accent: "#2cb5a0",
      accentToolbarButtons: true,
      toolbarAccent: "#daa520",
      accentFavoriteItems: true,
      accentFavoriteText: true,
      favoriteAccent: "#e8806a",
      uiFontFamily: "lexend",
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("dark");
    expect(document.documentElement.dataset.iconTheme).toBe("classic");
    expect(document.documentElement.dataset.accent).toBe("#2cb5a0");
    expect(document.documentElement.dataset.toolbarAccent).toBe("#daa520");
    expect(document.documentElement.dataset.favoriteAccent).toBe("#e8806a");
    expect(document.documentElement.dataset.accentFavoriteItems).toBe("true");
    expect(document.documentElement.dataset.accentFavoriteText).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("Lexend");
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain("SF Mono");
    expect(document.documentElement.style.getPropertyValue("--ft-accent-solid")).toBe("#2cb5a0");
    expect(document.documentElement.style.getPropertyValue("--accent-blue")).toBe("#2cb5a0");
    expect(document.documentElement.style.getPropertyValue("--tb-primary-bg")).toBe(
      "rgba(218, 165, 32, 0.12)",
    );
    // Icons at rest stay neutral; only active states take the toolbar accent.
    expect(document.documentElement.style.getPropertyValue("--toolbar-nav-icon-active")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--toolbar-toggle-active-bg")).toBe(
      "rgba(218, 165, 32, 0.16)",
    );
    expect(document.documentElement.style.getPropertyValue("--sidebar-rail-icon")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sidebar-rail-active-bg")).toBe(
      "rgba(218, 165, 32, 0.16)",
    );
    expect(document.documentElement.style.getPropertyValue("--favorite-accent-solid")).toBe(
      "#e8806a",
    );
    expect(document.documentElement.style.getPropertyValue("--favorite-accent-active-bg")).toBe(
      "rgba(232, 128, 106, 0.16)",
    );
    expect(document.documentElement.style.getPropertyValue("--text-primary")).toBe("#ffffff");
  });

  it("restores theme toolbar defaults when accent toolbar buttons are disabled", () => {
    applyAppearance({
      theme: "dark",
      iconTheme: "classic",
      accent: "#e8729a",
      accentToolbarButtons: false,
      toolbarAccent: "#daa520",
      accentFavoriteItems: false,
      accentFavoriteText: true,
      favoriteAccent: "#daa520",
      uiFontFamily: "lexend",
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
    });

    expect(document.documentElement.style.getPropertyValue("--tb-primary-bg")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--tb-primary-fg")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--tb-primary-hover-bg")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--toolbar-nav-icon-active")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--toolbar-toggle-active-bg")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sidebar-rail-icon")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sidebar-rail-active-bg")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--help-accent")).toBe("#e8729a");
    expect(document.documentElement.dataset.accentFavoriteText).toBe("false");
  });

  it("maps variant themes onto a css base and applies palette overrides", () => {
    applyAppearance({
      theme: "obsidian",
      iconTheme: "classic",
      accent: "#daa520",
      accentToolbarButtons: false,
      toolbarAccent: "#daa520",
      accentFavoriteItems: false,
      accentFavoriteText: false,
      favoriteAccent: "#daa520",
      uiFontFamily: "lexend",
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("obsidian");
    expect(document.documentElement.style.getPropertyValue("--bg-base")).toBe("#080809");
    expect(document.documentElement.style.getPropertyValue("--toolbar-bg")).toBe("#101012");
  });

  it("keeps a variant's own text and toolbar colors when overrides and the toolbar accent are off", () => {
    const base = {
      theme: "macos-dark" as const,
      iconTheme: "classic" as const,
      accent: "#007aff",
      accentToolbarButtons: true,
      toolbarAccent: "#daa520",
      accentFavoriteItems: false,
      accentFavoriteText: false,
      favoriteAccent: "#daa520",
      uiFontFamily: "system" as const,
      textPrimaryOverride: "#ff0000" as string | null,
      textSecondaryOverride: null,
      textMutedOverride: "#00ff00" as string | null,
    };
    const style = document.documentElement.style;
    applyAppearance(base);
    expect(style.getPropertyValue("--text-primary")).toBe("#ff0000");
    expect(style.getPropertyValue("--fg-dim")).toBe("#00ff00");
    expect(style.getPropertyValue("--toolbar-toggle-active-bg")).toBe("rgba(218, 165, 32, 0.16)");

    // Turning the overrides and the toolbar accent off brings back the variant's values
    // rather than leaving the properties empty (which fell back to the base theme).
    applyAppearance({
      ...base,
      accentToolbarButtons: false,
      textPrimaryOverride: null,
      textMutedOverride: null,
    });
    expect(style.getPropertyValue("--text-primary")).toBe("#f2f2f5");
    expect(style.getPropertyValue("--text-secondary")).not.toBe("");
    expect(style.getPropertyValue("--text-dim")).not.toBe("");
    expect(style.getPropertyValue("--fg-dim")).not.toBe("#00ff00");
    expect(style.getPropertyValue("--fg-dim")).not.toBe("");
    expect(style.getPropertyValue("--toolbar-toggle-active-bg")).not.toBe("");
    expect(style.getPropertyValue("--toolbar-toggle-active-bg")).not.toContain("218, 165, 32");
    expect(style.getPropertyValue("--toolbar-nav-icon-active")).not.toBe("");
  });

  it("carries text color overrides into menus, search, the Info panel and the toolbar", () => {
    const base = {
      theme: "light" as const,
      iconTheme: "classic" as const,
      accent: "#007aff",
      accentToolbarButtons: false,
      toolbarAccent: "#007aff",
      accentFavoriteItems: false,
      accentFavoriteText: false,
      favoriteAccent: "#007aff",
      uiFontFamily: "system" as const,
      textPrimaryOverride: "#111111" as string | null,
      textSecondaryOverride: "#222222" as string | null,
      textMutedOverride: "#333333" as string | null,
    };
    const style = document.documentElement.style;
    applyAppearance(base);
    expect(style.getPropertyValue("--context-menu-text")).toBe("#111111");
    expect(style.getPropertyValue("--search-text")).toBe("#222222");
    expect(style.getPropertyValue("--get-info-meta-value")).toBe("#222222");
    expect(style.getPropertyValue("--context-menu-shortcut")).toBe("#333333");
    expect(style.getPropertyValue("--search-meta-fg")).toBe("#333333");

    // Cleared overrides hand these back to the stylesheet's theme palette.
    applyAppearance({
      ...base,
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
    });
    expect(style.getPropertyValue("--context-menu-text")).toBe("");
    expect(style.getPropertyValue("--search-text")).toBe("");
    expect(style.getPropertyValue("--context-menu-shortcut")).toBe("");
  });

  it("starts from the same fonts the default Font preference applies", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    expect(styles).toContain(`  --font-sans: ${UI_FONT_STACKS.system};`);
    expect(styles).toContain(`  --font-mono: ${UI_MONO_FONT_STACK};`);
    // Text size and weight are no longer settings: nothing may still read them.
    expect(styles).not.toMatch(/--ui-font-weight|--mono-font-weight/u);
  });

  it("ships a stylesheet rule that targets the favorite svg for accent overrides", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");

    expect(styles).toContain(
      '.tree-row[data-tree-kind="favorite"]\n  .file-icon.favorite\n  .file-icon-favorite',
    );
    expect(styles).toContain(
      '.tree-row[data-tree-kind="favorites-root"]\n  .file-icon.favorite\n  .file-icon-favorite',
    );
  });

  it("no-ops cleanly when no DOM is available", () => {
    const originalDocument = globalThis.document;

    // `applyAppearance` is shared with tests that can run in a non-DOM environment.
    vi.stubGlobal("document", undefined);
    try {
      expect(() =>
        applyAppearance({
          theme: "dark",
          iconTheme: "classic",
          accent: "#daa520",
          accentToolbarButtons: false,
          toolbarAccent: "#daa520",
          accentFavoriteItems: false,
          accentFavoriteText: false,
          favoriteAccent: "#daa520",
          uiFontFamily: "lexend",
          textPrimaryOverride: null,
          textSecondaryOverride: null,
          textMutedOverride: null,
        }),
      ).not.toThrow();
    } finally {
      vi.stubGlobal("document", originalDocument);
    }
  });
});
