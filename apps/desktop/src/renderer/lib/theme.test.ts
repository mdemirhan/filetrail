// @vitest-environment jsdom

import { applyTheme } from "./theme";

describe("theme helpers", () => {
  it("applies the theme to the document root", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
