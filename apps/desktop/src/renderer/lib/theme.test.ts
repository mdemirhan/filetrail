// @vitest-environment jsdom

import { applyAppearance } from "./theme";

describe("theme helpers", () => {
  it("applies theme and typography variables to the document root", () => {
    applyAppearance({
      theme: "tomorrow-night",
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
    });

    expect(document.documentElement.dataset.theme).toBe("tomorrow-night");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toContain("Lexend");
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toContain("Fira Code");
    expect(document.documentElement.style.getPropertyValue("--ui-font-size")).toBe("14px");
    expect(document.documentElement.style.getPropertyValue("--ui-font-weight")).toBe("500");
    expect(document.documentElement.style.getPropertyValue("--mono-font-size")).toBe("12px");
    expect(document.documentElement.style.getPropertyValue("--mono-font-weight")).toBe("500");
    expect(document.documentElement.style.getPropertyValue("--text-primary")).toBe("#ffffff");
  });
});
