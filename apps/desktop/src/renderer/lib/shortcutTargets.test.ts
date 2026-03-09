import {
  resolveEditSelectionPaths,
  resolveOpenInTerminalPaths,
  resolveOpenSelectionPaths,
} from "./shortcutTargets";

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

  it("falls back to the current path for terminal when the tree pane is focused", () => {
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

  it("falls back to the tree path for terminal when the tree pane is focused", () => {
    expect(
      resolveOpenInTerminalPaths({
        focusedPane: "tree",
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: [],
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

  it("falls back to the current path for terminal when focus is temporarily null after tree focus", () => {
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

  it("does not return open targets when the tree pane is focused", () => {
    expect(
      resolveOpenSelectionPaths({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/tree"]);
  });

  it("falls back to the current path for Open when the tree pane is focused", () => {
    expect(
      resolveOpenSelectionPaths({
        focusedPane: "tree",
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/tree"]);
  });

  it("falls back to the current path for Open when focus is temporarily null after tree focus", () => {
    expect(
      resolveOpenSelectionPaths({
        focusedPane: null,
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/tree"]);
  });

  it("does not fall back to the current path for Edit without a file selection", () => {
    expect(
      resolveEditSelectionPaths({
        focusedPane: "tree",
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: [],
      }),
    ).toEqual([]);
  });
});
