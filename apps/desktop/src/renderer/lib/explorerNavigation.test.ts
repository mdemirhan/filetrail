import {
  flattenVisibleTreePaths,
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getForcedVisiblePackageChildPath,
  getNextSelectionIndex,
  getPageStepItemCount,
  getPagedSelectionIndex,
  getTreeSeedChain,
  isFolderGoneError,
  keepUnchangedEntries,
  parentDirectoryPath,
  pathHasHiddenSegmentWithinRoot,
  sameDetailsByPath,
  sameDirectoryEntries,
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

  it("tells a folder that is gone from one that can't be read", () => {
    expect(isFolderGoneError("ENOENT: no such file or directory, stat '/Users/demo/Old'")).toBe(
      true,
    );
    expect(isFolderGoneError("ENOTDIR: not a directory, stat '/Users/demo/a.txt/b'")).toBe(true);
    // Replaced by a file of the same name.
    expect(isFolderGoneError("Path is not a directory: /Users/demo/Old")).toBe(true);
    expect(isFolderGoneError("EPERM: operation not permitted, scandir '/Users/demo/.Trash'")).toBe(
      false,
    );
    expect(isFolderGoneError("EACCES: permission denied, scandir '/Users/demo/Locked'")).toBe(
      false,
    );
  });

  // A folder that can't be read was taken for gone when its path had the words in it.
  it("looks for why a folder couldn't be read in the reason, not in its path", () => {
    for (const path of [
      "/Users/demo/ENOENT",
      "/Users/demo/ENOTDIR logs",
      "/Users/demo/no such file or directory",
      "/Users/demo/Not a Directory",
    ]) {
      expect(isFolderGoneError(`EACCES: permission denied, scandir '${path}'`), path).toBe(false);
      expect(isFolderGoneError(`EPERM: operation not permitted, scandir '${path}'`), path).toBe(
        false,
      );
      expect(isFolderGoneError(`ENOENT: no such file or directory, stat '${path}'`), path).toBe(
        true,
      );
    }
  });

  it("tells whether a folder read again lists the same items the same way", () => {
    const file = { path: "/a/one.txt", name: "one.txt", kind: "file", isHidden: false };
    const listing = [file, { path: "/a/B", name: "B", kind: "directory", isHidden: false }];
    expect(
      sameDirectoryEntries(
        listing,
        listing.map((entry) => ({ ...entry })),
      ),
    ).toBe(true);
    expect(sameDirectoryEntries(listing, [...listing].reverse())).toBe(false);
    expect(sameDirectoryEntries(listing, [file])).toBe(false);
    expect(sameDirectoryEntries([file], [{ ...file, isHidden: true }])).toBe(false);
    // A detail only one of them has (a size, when sorted by size).
    expect(sameDirectoryEntries<object>([file], [{ ...file, sizeBytes: 5 }])).toBe(false);
  });

  it("keeps the items of a folder read again that are still as they were", () => {
    const one = { path: "/a/one.txt", name: "one.txt", kind: "file", isHidden: false };
    const two = { path: "/a/two.txt", name: "two.txt", kind: "file", isHidden: false };
    const shown = [one, two];

    // Nothing changed: the listing on screen stays as it is.
    expect(
      keepUnchangedEntries(
        shown,
        shown.map((entry) => ({ ...entry })),
      ),
    ).toBe(shown);

    // One item changed, one came: the one that didn't change is the one on screen.
    const changedTwo = { ...two, isHidden: true };
    const three = { path: "/a/three.txt", name: "three.txt", kind: "file", isHidden: false };
    const next = keepUnchangedEntries(shown, [{ ...one }, changedTwo, three]);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(one);
    expect(next[1]).toBe(changedTwo);
    expect(next[2]).toBe(three);

    // The new order is kept, with the same items.
    const reordered = keepUnchangedEntries(shown, [{ ...two }, { ...one }]);
    expect(reordered[0]).toBe(two);
    expect(reordered[1]).toBe(one);
  });

  it("tells whether two sets of item details are the very same", () => {
    const details = { path: "/a/one.txt", sizeBytes: 5 };
    expect(sameDetailsByPath({ "/a/one.txt": details }, { "/a/one.txt": details })).toBe(true);
    // Read again: the same values, but not the details on screen.
    expect(sameDetailsByPath({ "/a/one.txt": details }, { "/a/one.txt": { ...details } })).toBe(
      false,
    );
    expect(sameDetailsByPath({ "/a/one.txt": details }, {})).toBe(false);
    expect(sameDetailsByPath({ "/a/one.txt": details }, { "/a/two.txt": details })).toBe(false);
  });
});
