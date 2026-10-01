// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { applyAppearance } from "./theme";
import { UI_FONT_STACKS, UI_MONO_FONT_STACK } from "./theme";

describe("theme helpers", () => {
  it("applies the palette, accent and typography variables to the document root", () => {
    applyAppearance({
      theme: "tomorrow-night",
      accent: "#2cb5a0",
      uiFontFamily: "lexend",
    });

    const root = document.documentElement;
    expect(root.dataset.theme).toBe("tomorrow-night");
    expect(root.dataset.themeVariant).toBe("tomorrow-night");
    expect(root.dataset.accent).toBe("#2cb5a0");
    expect(root.style.getPropertyValue("--font-sans")).toContain("Lexend");
    expect(root.style.getPropertyValue("--font-mono")).toContain("SF Mono");
    expect(root.style.getPropertyValue("--ft-accent-solid")).toBe("#2cb5a0");
    expect(root.style.getPropertyValue("--accent-blue")).toBe("#2cb5a0");
    expect(root.style.getPropertyValue("--help-accent")).toBe("#2cb5a0");
  });

  it("uses one accent everywhere: no toolbar, favorite or text color overrides", () => {
    applyAppearance({
      theme: "macos-dark",
      accent: "#e8729a",
      uiFontFamily: "system",
    });

    const root = document.documentElement;
    // Active toolbar and rail buttons keep the palette's own neutral colors.
    expect(root.style.getPropertyValue("--tb-primary-bg")).toBe("");
    expect(root.style.getPropertyValue("--sidebar-rail-active-bg")).toBe("");
    expect(root.style.getPropertyValue("--toolbar-toggle-active-bg")).not.toContain("232, 114");
    // Favorites follow the accent through the stylesheet, not a separate set of variables.
    expect(root.style.getPropertyValue("--favorite-accent-solid")).toBe("");
    expect(root.dataset.favoriteAccent).toBeUndefined();
    expect(root.dataset.toolbarAccent).toBeUndefined();
    // Text colors are the palette's.
    expect(root.style.getPropertyValue("--text-primary")).toBe("#f2f2f5");
  });

  it("maps variant palettes onto a css base and applies their overrides", () => {
    applyAppearance({
      theme: "warm-paper",
      accent: "#daa520",
      uiFontFamily: "lexend",
    });

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.themeVariant).toBe("warm-paper");
    expect(document.documentElement.style.getPropertyValue("--bg-base")).toBe("#f0ede7");
  });

  it("clears a variant's overrides when a stylesheet palette takes over", () => {
    const base = { accent: "#007aff", uiFontFamily: "system" } as const;
    const style = document.documentElement.style;

    applyAppearance({ ...base, theme: "macos-dark" });
    expect(style.getPropertyValue("--bg-base")).toBe("#1e1e20");

    // Catppuccin Mocha is defined entirely in styles.css: nothing may stay set inline.
    applyAppearance({ ...base, theme: "catppuccin-mocha" });
    expect(style.getPropertyValue("--bg-base")).toBe("");
    expect(style.getPropertyValue("--text-primary")).toBe("");
    expect(document.documentElement.dataset.theme).toBe("catppuccin-mocha");
  });

  it("starts from the same fonts the default Font preference applies", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    expect(styles).toContain(`  --font-sans: ${UI_FONT_STACKS.system};`);
    expect(styles).toContain(`  --font-mono: ${UI_MONO_FONT_STACK};`);
    // Text size and weight are no longer settings: nothing may still read them.
    expect(styles).not.toMatch(/--ui-font-weight|--mono-font-weight/u);
  });

  it("ships a stylesheet rule that colors favorite icons with the accent", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");

    expect(styles).toContain(
      '.tree-row[data-tree-kind="favorite"] .file-icon.favorite .file-icon-favorite,\n.tree-row[data-tree-kind="favorites-root"] .file-icon.favorite .file-icon-favorite {\n  color: var(--ft-accent-solid);',
    );
    // The separate favorite and toolbar accents are gone.
    expect(styles).not.toMatch(/--favorite-accent-|data-accent-favorite/u);
  });

  it("no-ops cleanly when no DOM is available", () => {
    const originalDocument = globalThis.document;

    // `applyAppearance` is shared with tests that can run in a non-DOM environment.
    vi.stubGlobal("document", undefined);
    try {
      expect(() =>
        applyAppearance({
          theme: "macos-dark",
          accent: "#daa520",
          uiFontFamily: "lexend",
        }),
      ).not.toThrow();
    } finally {
      vi.stubGlobal("document", originalDocument);
    }
  });
});
