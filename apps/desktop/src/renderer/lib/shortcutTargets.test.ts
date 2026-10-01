import {
  resolveEditSelectionPaths,
  resolveOpenInTerminalPaths,
  resolveOpenSelectionPaths,
  resolveRootTreeTargetPath,
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

  it("prefers the explicit selected tree path for terminal when the tree pane is focused", () => {
    expect(
      resolveOpenInTerminalPaths({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        selectedTreePath: "/tmp/tree-selected",
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/tree-selected"]);
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

  it("does not fall back to the current tree path for Open when the tree pane is focused", () => {
    expect(
      resolveOpenSelectionPaths({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual([]);
  });

  it("does not fall back to the current path for Open when focus is temporarily null after tree focus", () => {
    expect(
      resolveOpenSelectionPaths({
        focusedPane: "tree",
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual([]);
  });

  it("prefers the explicit selected tree path for Open when the tree pane is focused", () => {
    expect(
      resolveOpenSelectionPaths({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        selectedTreePath: "/tmp/tree-selected",
        currentPath: "/tmp/tree",
      }),
    ).toEqual(["/tmp/tree-selected"]);
  });

  it("does not fall back to the current path for Open when focus is temporarily null after tree focus", () => {
    expect(
      resolveOpenSelectionPaths({
        focusedPane: null,
        lastFocusedPane: "tree",
        contextMenuPaths: [],
        selectedContentPaths: ["/tmp/content"],
        currentPath: "/tmp/tree",
      }),
    ).toEqual([]);
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

  it("prefers the explicit selected tree path for Edit when the tree pane is focused", () => {
    expect(
      resolveEditSelectionPaths({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuPaths: [],
        selectedContentPaths: [],
        selectedTreePath: "/tmp/tree-selected",
      }),
    ).toEqual(["/tmp/tree-selected"]);
  });

  it("roots the tree at the tree's selected folder when the tree pane is focused", () => {
    expect(
      resolveRootTreeTargetPath({
        focusedPane: "tree",
        lastFocusedPane: "content",
        contextMenuFolderPath: null,
        selectedContentFolderPath: "/tmp/content-folder",
        selectedTreePath: "/tmp/tree-selected",
        currentPath: "/tmp/current",
      }),
    ).toBe("/tmp/tree-selected");
  });

  it("roots the tree at the single folder selected in the file list", () => {
    expect(
      resolveRootTreeTargetPath({
        focusedPane: "content",
        lastFocusedPane: "tree",
        contextMenuFolderPath: null,
        selectedContentFolderPath: "/tmp/content-folder",
        selectedTreePath: "/tmp/tree-selected",
        currentPath: "/tmp/current",
      }),
    ).toBe("/tmp/content-folder");
  });

  it("roots the tree at the folder on screen when the selection is not a single folder", () => {
    expect(
      resolveRootTreeTargetPath({
        focusedPane: "content",
        lastFocusedPane: "content",
        contextMenuFolderPath: null,
        selectedContentFolderPath: null,
        selectedTreePath: "/tmp/tree-selected",
        currentPath: "/tmp/current",
      }),
    ).toBe("/tmp/current");
    expect(
      resolveRootTreeTargetPath({
        focusedPane: null,
        lastFocusedPane: "tree",
        contextMenuFolderPath: null,
        selectedContentFolderPath: null,
        selectedTreePath: null,
        currentPath: "/tmp/current",
      }),
    ).toBe("/tmp/current");
  });

  it("roots the tree at the right-clicked folder while its menu is open", () => {
    expect(
      resolveRootTreeTargetPath({
        focusedPane: "tree",
        lastFocusedPane: "tree",
        contextMenuFolderPath: "/tmp/context",
        selectedContentFolderPath: null,
        selectedTreePath: "/tmp/tree-selected",
        currentPath: "/tmp/current",
      }),
    ).toBe("/tmp/context");
  });

  it("has no tree root target when nothing is selected or on screen", () => {
    expect(
      resolveRootTreeTargetPath({
        focusedPane: "tree",
        lastFocusedPane: "tree",
        contextMenuFolderPath: null,
        selectedContentFolderPath: null,
        selectedTreePath: null,
        currentPath: "",
      }),
    ).toBeNull();
  });
});
