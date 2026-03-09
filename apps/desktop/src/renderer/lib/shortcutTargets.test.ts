import { resolveOpenInTerminalPaths } from "./shortcutTargets";

describe("shortcutTargets", () => {
  it("prefers explicit context menu paths over pane selection", () => {
    expect(
      resolveOpenInTerminalPaths({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuPaths: ["/tmp/context"],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/context"]);
  });

  it("uses the current tree item when the tree pane is focused", () => {
    expect(
      resolveOpenInTerminalPaths({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/tree"]);
  });

  it("uses the content selection when the content pane is focused", () => {
    expect(
      resolveOpenInTerminalPaths({
        focusedPane: "content",
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content-a", "/tmp/content-b"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/content-a", "/tmp/content-b"]);
  });

  it("falls back to the last focused pane when focus is temporarily null", () => {
    expect(
      resolveOpenInTerminalPaths({
        focusedPane: null,
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/tree"]);
  });

  it("falls back to the current path when content has no selection", () => {
    expect(
      resolveOpenInTerminalPaths({
        focusedPane: "content",
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: [],
        currentPath: "/tmp/current",
      }),
    ).toEqual(["/tmp/current"]);
  });
});
