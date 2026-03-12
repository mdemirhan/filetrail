// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { applyAppearance } from "./theme";
import { getThemeAppearanceDefaults } from "./theme";

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
      uiFontSize: 14,
      uiFontWeight: 500,
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
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain("Fira Code");
    expect(document.documentElement.style.getPropertyValue("--ui-font-size")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--ui-font-weight")).toBe("500");
    expect(document.documentElement.style.getPropertyValue("--mono-font-size")).toBe("12px");
    expect(document.documentElement.style.getPropertyValue("--mono-font-weight")).toBe("500");
    expect(document.documentElement.style.getPropertyValue("--ft-accent-solid")).toBe("#2cb5a0");
    expect(document.documentElement.style.getPropertyValue("--accent-blue")).toBe("#2cb5a0");
    expect(document.documentElement.style.getPropertyValue("--tb-primary-bg")).toBe(
      "rgba(218, 165, 32, 0.12)",
    );
    expect(document.documentElement.style.getPropertyValue("--toolbar-nav-icon-active")).toBe(
      "#daa520",
    );
    expect(document.documentElement.style.getPropertyValue("--toolbar-toggle-active-bg")).toBe(
      "rgba(218, 165, 32, 0.16)",
    );
    expect(document.documentElement.style.getPropertyValue("--sidebar-rail-icon")).toBe("#daa520");
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
      uiFontSize: 13,
      uiFontWeight: 500,
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
      uiFontSize: 13,
      uiFontWeight: 500,
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeVariant).toBe("obsidian");
    expect(document.documentElement.style.getPropertyValue("--bg-base")).toBe("#080809");
    expect(document.documentElement.style.getPropertyValue("--toolbar-bg")).toBe("#101012");
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
          uiFontSize: 13,
          uiFontWeight: 500,
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
