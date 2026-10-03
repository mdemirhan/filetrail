// @vitest-environment jsdom

import { readFileSync } from "node:fs";

import { applyAppearance } from "./theme";

describe("theme helpers", () => {
  it("picks the stylesheet's palette and applies the accent to the document root", () => {
    applyAppearance({ theme: "dark", accent: "#2cb5a0" });

    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.accent).toBe("#2cb5a0");
    expect(root.style.getPropertyValue("--ft-accent-solid")).toBe("#2cb5a0");
    // The palette itself is the stylesheet's: nothing of it is set inline.
    expect(root.style.getPropertyValue("--bg-base")).toBe("");
    expect(root.style.getPropertyValue("--text-primary")).toBe("");
    expect(root.style.getPropertyValue("--font-sans")).toBe("");
  });

  it("uses one accent everywhere: no toolbar, favorite or text color overrides", () => {
    applyAppearance({ theme: "light", accent: "#e8729a" });

    const root = document.documentElement;
    expect(root.dataset.theme).toBe("light");
    expect(root.style.getPropertyValue("--toolbar-toggle-active-bg")).toBe("");
    expect(root.style.getPropertyValue("--favorite-accent-solid")).toBe("");
    expect(root.dataset.favoriteAccent).toBeUndefined();
    expect(root.dataset.toolbarAccent).toBeUndefined();
  });

  it("draws everything in the system font", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    expect(styles).toContain(
      '  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;',
    );
    expect(styles).toContain(
      '  --font-mono: "SF Mono", "SFMono-Regular", ui-monospace, Menlo, monospace;',
    );
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
      expect(() => applyAppearance({ theme: "dark", accent: "#daa520" })).not.toThrow();
    } finally {
      vi.stubGlobal("document", originalDocument);
    }
  });
});
