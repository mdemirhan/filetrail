import {
  flattenVisibleTreePaths,
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getNextSelectionIndex,
  getPageStepItemCount,
  getPagedSelectionIndex,
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

  it("starts from the first item when arrow navigation begins with no content selection", () => {
    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: -1,
        key: "ArrowDown",
        columns: 4,
        viewMode: "list",
      }),
    ).toBe(0);

    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: -1,
        key: "ArrowRight",
        columns: 4,
        viewMode: "list",
      }),
    ).toBe(0);
  });

  it("computes paged step counts with one-item overlap", () => {
    expect(getPageStepItemCount(400, 56)).toBe(6);
    expect(getPageStepItemCount(120, 38)).toBe(2);
    expect(getPageStepItemCount(20, 38)).toBe(1);
  });

  it("computes paged selection indices", () => {
    expect(
      getPagedSelectionIndex({
        itemCount: 100,
        currentIndex: 10,
        stepItems: 6,
        direction: "forward",
      }),
    ).toBe(16);
    expect(
      getPagedSelectionIndex({
        itemCount: 100,
        currentIndex: 10,
        stepItems: 6,
        direction: "backward",
      }),
    ).toBe(4);
    expect(
      getPagedSelectionIndex({
        itemCount: 12,
        currentIndex: 10,
        stepItems: 6,
        direction: "forward",
      }),
    ).toBe(11);
  });

  it("flattens visible tree paths in expanded order", () => {
    expect(
      flattenVisibleTreePaths("/Users/demo", {
        "/Users/demo": {
          path: "/Users/demo",
          expanded: true,
          childPaths: ["/Users/demo/Documents", "/Users/demo/Downloads"],
        },
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          expanded: true,
          childPaths: ["/Users/demo/Documents/Notes"],
        },
        "/Users/demo/Documents/Notes": {
          path: "/Users/demo/Documents/Notes",
          expanded: false,
          childPaths: [],
        },
        "/Users/demo/Downloads": {
          path: "/Users/demo/Downloads",
          expanded: false,
          childPaths: ["/Users/demo/Downloads/Archive"],
        },
        "/Users/demo/Downloads/Archive": {
          path: "/Users/demo/Downloads/Archive",
          expanded: false,
          childPaths: [],
        },
      }),
    ).toEqual([
      "/Users/demo",
      "/Users/demo/Documents",
      "/Users/demo/Documents/Notes",
      "/Users/demo/Downloads",
    ]);
  });
});
