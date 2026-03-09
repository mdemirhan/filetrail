// @vitest-environment jsdom

import { applyAppearance } from "./theme";

describe("theme helpers", () => {
  it("applies theme and typography variables to the document root", () => {
    applyAppearance({
      theme: "dark",
      accent: "teal",
      accentToolbarButtons: true,
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("teal");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("Lexend");
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain("Fira Code");
    expect(document.documentElement.style.getPropertyValue("--ui-font-size")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--ui-font-weight")).toBe("500");
    expect(document.documentElement.style.getPropertyValue("--mono-font-size")).toBe("12px");
    expect(document.documentElement.style.getPropertyValue("--mono-font-weight")).toBe("500");
    expect(document.documentElement.style.getPropertyValue("--ft-accent-solid")).toBe("#2cb5a0");
    expect(document.documentElement.style.getPropertyValue("--accent-blue")).toBe("#2cb5a0");
    expect(document.documentElement.style.getPropertyValue("--tb-primary-bg")).toBe(
      "rgba(44, 181, 160, 0.12)",
    );
    expect(document.documentElement.style.getPropertyValue("--toolbar-nav-icon-active")).toBe(
      "#2cb5a0",
    );
    expect(document.documentElement.style.getPropertyValue("--toolbar-toggle-active-bg")).toBe(
      "rgba(44, 181, 160, 0.16)",
    );
    expect(document.documentElement.style.getPropertyValue("--sidebar-rail-icon")).toBe(
      "#2cb5a0",
    );
    expect(document.documentElement.style.getPropertyValue("--sidebar-rail-active-bg")).toBe(
      "rgba(44, 181, 160, 0.16)",
    );
    expect(document.documentElement.style.getPropertyValue("--text-primary")).toBe("#ffffff");
  });

  it("restores theme toolbar defaults when accent toolbar buttons are disabled", () => {
    applyAppearance({
      theme: "dark",
      accent: "rose",
      accentToolbarButtons: false,
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
  });
});
