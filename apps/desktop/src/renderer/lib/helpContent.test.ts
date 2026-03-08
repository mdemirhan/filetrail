import { SHORTCUT_ITEMS } from "./helpContent";

describe("helpContent", () => {
  it("includes the page scroll shortcuts in help", () => {
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "Ctrl+U",
        description: "Scroll one page up in the focused tree or content view",
      }),
    );
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "Ctrl+D",
        description: "Scroll one page down in the focused tree or content view",
      }),
    );
  });
});
