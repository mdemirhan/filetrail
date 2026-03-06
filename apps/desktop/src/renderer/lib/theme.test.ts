// @vitest-environment jsdom

import { applyTheme, persistTheme, readStoredTheme, resolveInitialTheme } from "./theme";

describe("theme helpers", () => {
  it("persists and reads the stored theme", () => {
    persistTheme("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("falls back to light when there is no preference", () => {
    expect(resolveInitialTheme()).toBe("light");
  });

  it("applies the theme to the document root", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
