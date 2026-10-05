import {
  flattenVisibleTreePaths,
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getForcedVisiblePackageChildPath,
  getNextSelectionIndex,
  getPageStepItemCount,
  getPagedSelectionIndex,
  getTreeSeedChain,
  parentDirectoryPath,
  pathHasHiddenSegmentWithinRoot,
  withPackageChild,
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

  it("returns only the package on the active path chain", () => {
    expect(
      getForcedVisiblePackageChildPath("/Applications", "/Applications/Foo.app/Contents/MacOS"),
    ).toBe("/Applications/Foo.app");
    expect(getForcedVisiblePackageChildPath("/Applications", "/Applications/Foo.app")).toBe(
      "/Applications/Foo.app",
    );
    expect(getForcedVisiblePackageChildPath("/", "/Library.bundle/x")).toBe("/Library.bundle");
    expect(getForcedVisiblePackageChildPath("/Applications", "/Applications/Utilities")).toBeNull();
    expect(getForcedVisiblePackageChildPath("/Applications", "/Applications")).toBeNull();
  });

  it("adds a package to a folder's children in name order, once", () => {
    const child = (name: string) => ({
      path: `/Applications/${name}`,
      name,
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
    });
    const children = [child("Alpha"), child("Utilities")];

    expect(withPackageChild(children, "/Applications/foo.app").map((c) => c.name)).toEqual([
      "Alpha",
      "foo.app",
      "Utilities",
    ]);
    expect(withPackageChild(children, "/Applications/Zed.app").map((c) => c.name)).toEqual([
      "Alpha",
      "Utilities",
      "Zed.app",
    ]);
    expect(withPackageChild([child("Foo.app")], "/Applications/Foo.app")).toHaveLength(1);
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

  it("moves by items sideways and by rows up and down in icon view", () => {
    const move = (
      currentIndex: number,
      key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
    ) => getNextSelectionIndex({ itemCount: 10, currentIndex, key, columns: 4, viewMode: "icons" });

    // Ten items in rows of four: 0-3, 4-7, 8-9.
    expect(move(5, "ArrowRight")).toBe(6);
    expect(move(5, "ArrowLeft")).toBe(4);
    expect(move(5, "ArrowDown")).toBe(9);
    expect(move(5, "ArrowUp")).toBe(1);
    // Sideways movement carries on into the next and the previous row.
    expect(move(3, "ArrowRight")).toBe(4);
    expect(move(4, "ArrowLeft")).toBe(3);
    // The edges hold.
    expect(move(1, "ArrowUp")).toBe(1);
    expect(move(9, "ArrowRight")).toBe(9);
    expect(move(8, "ArrowDown")).toBe(8);
    // Down from above the gap in a shorter last row lands on the last item.
    expect(move(6, "ArrowDown")).toBe(9);
    expect(move(7, "ArrowDown")).toBe(9);
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

  it("carries on from where the selected item left the list", () => {
    const next = (
      key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
      viewMode: "icons" | "list" | "details",
      gapIndex: number,
    ) =>
      getNextSelectionIndex({
        itemCount: 10,
        currentIndex: -1,
        key,
        columns: viewMode === "details" ? 1 : 4,
        viewMode,
        gapIndex,
      });
    // Details: Down is the item that took the gone item's place, Up the one before it.
    expect(next("ArrowDown", "details", 5)).toBe(5);
    expect(next("ArrowUp", "details", 5)).toBe(4);
    expect(next("ArrowUp", "details", 0)).toBe(0);
    // The last item gone: both go to the new last item.
    expect(next("ArrowDown", "details", 10)).toBe(9);
    expect(next("ArrowUp", "details", 10)).toBe(9);
    // Icons: Left and Right step through the items, Up and Down by rows from the place.
    expect(next("ArrowRight", "icons", 5)).toBe(5);
    expect(next("ArrowLeft", "icons", 5)).toBe(4);
    expect(next("ArrowDown", "icons", 5)).toBe(9);
    expect(next("ArrowUp", "icons", 5)).toBe(1);
    // List: Up and Down step through the items, Left and Right by columns.
    expect(next("ArrowDown", "list", 5)).toBe(5);
    expect(next("ArrowUp", "list", 5)).toBe(4);
    expect(next("ArrowRight", "list", 5)).toBe(9);
    expect(next("ArrowLeft", "list", 5)).toBe(1);
  });
});
