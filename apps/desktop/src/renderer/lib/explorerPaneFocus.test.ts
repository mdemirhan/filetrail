import { resolveExplorerPaneRestoreTarget } from "./explorerPaneFocus";

describe("explorerPaneFocus", () => {
  it("prefers an explicit restore target when available", () => {
    expect(
      resolveExplorerPaneRestoreTarget({
        preferredPane: "tree",
        lastFocusedPane: "content",
        hasTreePane: true,
        hasContentPane: true,
      }),
    ).toBe("tree");
  });

  it("falls back to the last focused pane for transient blur restoration", () => {
    expect(
      resolveExplorerPaneRestoreTarget({
        preferredPane: null,
        lastFocusedPane: "tree",
        hasTreePane: true,
        hasContentPane: true,
      }),
    ).toBe("tree");
  });

  it("falls back to content when no prior pane is known and content exists", () => {
    expect(
      resolveExplorerPaneRestoreTarget({
        preferredPane: null,
        lastFocusedPane: null,
        hasTreePane: true,
        hasContentPane: true,
      }),
    ).toBe("content");
  });

  it("falls back to tree when content is unavailable", () => {
    expect(
      resolveExplorerPaneRestoreTarget({
        preferredPane: null,
        lastFocusedPane: null,
        hasTreePane: true,
        hasContentPane: false,
      }),
    ).toBe("tree");
  });

  it("returns null when no explorer pane can be focused", () => {
    expect(
      resolveExplorerPaneRestoreTarget({
        preferredPane: "tree",
        lastFocusedPane: "content",
        hasTreePane: false,
        hasContentPane: false,
      }),
    ).toBeNull();
  });
});
