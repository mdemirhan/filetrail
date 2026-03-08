import {
  getForcedVisibleHiddenChildPath,
  getAncestorChain,
  getNextSelectionIndex,
  getTreeSeedChain,
  parentDirectoryPath,
  pathHasHiddenSegmentWithinRoot,
} from "./explorerNavigation";

describe("explorerNavigation", () => {
  it("builds ancestor chains inside the active root", () => {
    expect(getAncestorChain("/Users/demo", "/Users/demo/Documents/Notes")).toEqual([
      "/Users/demo",
      "/Users/demo/Documents",
      "/Users/demo/Documents/Notes",
    ]);
  });

  it("returns the root only when the path is outside the active root", () => {
    expect(getAncestorChain("/Users/demo", "/tmp")).toEqual(["/Users/demo"]);
  });

  it("computes parent directories", () => {
    expect(parentDirectoryPath("/Users/demo/Documents")).toBe("/Users/demo");
    expect(parentDirectoryPath("/Users")).toBe("/");
    expect(parentDirectoryPath("/")).toBeNull();
  });

  it("detects hidden segments under the active root", () => {
    expect(pathHasHiddenSegmentWithinRoot("/Users/demo/.config/ghostty", "/Users/demo")).toBe(true);
    expect(pathHasHiddenSegmentWithinRoot("/Users/demo/projects", "/Users/demo")).toBe(false);
    expect(pathHasHiddenSegmentWithinRoot("/tmp/.cache", "/Users/demo")).toBe(false);
  });

  it("returns only the hidden child on the active path chain", () => {
    expect(getForcedVisibleHiddenChildPath("/Users/demo", "/Users/demo/.config/ghostty")).toBe(
      "/Users/demo/.config",
    );
    expect(
      getForcedVisibleHiddenChildPath("/Users/demo/dotfiles", "/Users/demo/dotfiles/.config"),
    ).toBe("/Users/demo/dotfiles/.config");
    expect(getForcedVisibleHiddenChildPath("/Users/demo", "/Users/demo/Documents")).toBeNull();
  });

  it("builds a seeded tree chain that keeps ancestors expanded to the focused path", () => {
    expect(getTreeSeedChain("/Users/demo", "/Users/demo/Documents/Notes")).toEqual([
      { path: "/Users/demo", childPath: "/Users/demo/Documents" },
      { path: "/Users/demo/Documents", childPath: "/Users/demo/Documents/Notes" },
      { path: "/Users/demo/Documents/Notes", childPath: null },
    ]);
  });

  it("moves selection by visual columns in list view and single rows in details view", () => {
    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: 6,
        key: "ArrowDown",
        columns: 4,
        viewMode: "list",
      }),
    ).toBe(7);

    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: 6,
        key: "ArrowRight",
        columns: 4,
        viewMode: "list",
      }),
    ).toBe(10);

    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: 6,
        key: "ArrowDown",
        columns: 4,
        viewMode: "details",
      }),
    ).toBe(7);
  });
});
