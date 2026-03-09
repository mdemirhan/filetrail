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

  it("documents Go to Folder with Cmd+Shift+G", () => {
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "Cmd+Shift+G",
        description: "Open Go to Folder",
      }),
    );
  });

  it("documents file operation shortcuts", () => {
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "Cmd+Shift+M",
        description: "Move the selected items to another folder",
      }),
    );
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "F2",
        description: "Rename the selected item",
      }),
    );
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "Cmd+D",
        description: "Duplicate the selected items",
      }),
    );
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "Cmd+Shift+N",
        description: "Create a new folder",
      }),
    );
    expect(SHORTCUT_ITEMS).toContainEqual(
      expect.objectContaining({
        shortcut: "Cmd+Backspace",
        description: "Move the selected items to Trash",
      }),
    );
  });
});
