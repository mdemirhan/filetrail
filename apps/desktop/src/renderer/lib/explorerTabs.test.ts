import {
  type ExplorerTab,
  describeTab,
  getPathAndAncestors,
  resolveAdjacentTab,
  resolveTabAfterClose,
  settleTreeNodes,
} from "./explorerTabs";

const tabs: ExplorerTab[] = ["a", "b", "c"].map((id) => ({ id, snapshot: null, stale: false }));

describe("explorerTabs", () => {
  it("names a tab after its folder, or after its search while results are showing", () => {
    const folder = {
      currentPath: "/Users/demo/Documents",
      searchVisible: false,
      searchQuery: "",
      searchRootPath: "",
      searchRunning: false,
    };
    expect(describeTab(folder)).toMatchObject({ label: "Documents", kind: "folder" });
    expect(describeTab({ ...folder, currentPath: "/" }).label).toBe("Macintosh HD");
    expect(describeTab({ ...folder, currentPath: "" }).label).toBe("Favorites");
    expect(
      describeTab({
        ...folder,
        searchVisible: true,
        searchQuery: "invoice",
        searchRootPath: "/Users/demo",
        searchRunning: true,
      }),
    ).toMatchObject({ label: "“invoice” in demo", kind: "search", searching: true });
    // A search that was put away leaves the tab named after its folder.
    expect(describeTab({ ...folder, searchQuery: "invoice" }).kind).toBe("folder");
  });

  it("hands a closed tab's place to the tab on its right, or its left when it was last", () => {
    expect(resolveTabAfterClose(tabs, "a")).toBe("b");
    expect(resolveTabAfterClose(tabs, "b")).toBe("c");
    expect(resolveTabAfterClose(tabs, "c")).toBe("b");
    expect(resolveTabAfterClose(tabs.slice(0, 1), "a")).toBeNull();
    expect(resolveTabAfterClose(tabs, "missing")).toBeNull();
  });

  it("steps to the next and previous tab, wrapping around", () => {
    expect(resolveAdjacentTab(tabs, "a", "next")).toBe("b");
    expect(resolveAdjacentTab(tabs, "c", "next")).toBe("a");
    expect(resolveAdjacentTab(tabs, "a", "previous")).toBe("c");
    expect(resolveAdjacentTab(tabs.slice(0, 1), "a", "next")).toBeNull();
  });

  it("stops a saved tree from waiting for answers that went to another tab", () => {
    const node = {
      path: "/a",
      name: "a",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: true,
      loading: false,
      loaded: true,
      error: null,
      childPaths: [],
    };
    const settledNodes = { "/a": node };
    expect(settleTreeNodes(settledNodes)).toBe(settledNodes);
    const loadingNodes = { "/a": node, "/b": { ...node, path: "/b", loading: true } };
    expect(settleTreeNodes(loadingNodes)["/b"]?.loading).toBe(false);
    expect(settleTreeNodes(loadingNodes)["/a"]).toBe(node);
  });

  it("lists a folder and the folders above it, nearest first", () => {
    expect(getPathAndAncestors("/Users/demo/Folder")).toEqual([
      "/Users/demo/Folder",
      "/Users/demo",
      "/Users",
      "/",
    ]);
    expect(getPathAndAncestors("")).toEqual([]);
  });
});
