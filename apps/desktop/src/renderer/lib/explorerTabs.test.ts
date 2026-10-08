import {
  type ExplorerTab,
  type TabSearchSession,
  type TabSnapshot,
  applyBackgroundSearchUpdate,
  describeTab,
  disambiguateTabLabels,
  followMovedItems,
  followMovedPath,
  getPathAndAncestors,
  leaveUnmountedDisks,
  moveTabInList,
  resolveAdjacentTab,
  resolveTabAfterClose,
  settleTreeNodes,
  toReopenableSnapshot,
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

  it("moves a tab along the row without disturbing the order of the others", () => {
    const ids = (list: ExplorerTab[]) => list.map((tab) => tab.id).join("");
    expect(ids(moveTabInList(tabs, "a", 2))).toBe("bca");
    expect(ids(moveTabInList(tabs, "c", 0))).toBe("cab");
    expect(ids(moveTabInList(tabs, "b", 1))).toBe("abc");
    expect(ids(moveTabInList(tabs, "a", 9))).toBe("bca");
    expect(ids(moveTabInList(tabs, "missing", 0))).toBe("abc");
  });

  it("keeps a closed tab's folder and view, not its history or what it had on screen", () => {
    const snapshot: TabSnapshot = {
      currentPath: "/Users/demo/work",
      historyPaths: ["/Users/demo", "/Users/demo/work"],
      historyIndex: 1,
      viewMode: "details",
      searchViewMode: "icons",
      sortBy: "size",
      sortDirection: "desc",
      treeRootPath: "/Users/demo",
      selectedTreeItemId: null,
      leftPaneSubview: "tree",
      focusedPane: "tree",
      includeHidden: false,
      foldersFirst: true,
      favoritesExpanded: false,
      locationsExpanded: true,
      view: {
        treeNodes: {},
        currentEntries: [],
        metadataByPath: {},
        directoryError: null,
        contentSelection: { paths: ["/Users/demo/work/a"], anchorPath: null, leadPath: null },
        listFilterQuery: "a",
        contentScroll: { top: 40, left: 0 },
        treeScrollTop: 0,
        sidebarSectionsScrollTop: 0,
        folderViewMemories: {},
      },
      search: null,
    };
    expect(toReopenableSnapshot(snapshot)).toEqual({
      ...snapshot,
      historyPaths: ["/Users/demo/work"],
      historyIndex: 0,
      view: null,
    });
  });

  describe("a search running in a background tab", () => {
    const result = (name: string) => ({
      path: `/Users/demo/${name}`,
      name,
      extension: "txt",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
      parentPath: "/Users/demo",
      relativeParentPath: ".",
    });
    const session = {
      results: [result("a.txt")],
      cursor: 1,
      status: "running",
      error: null,
      truncated: false,
      elapsedMs: null,
      jobId: "job-1",
      pollInFlight: false,
      interrupted: false,
      keptResultPaths: new Set<string>(),
    } as unknown as TabSearchSession;
    const update = (items: ReturnType<typeof result>[], done: boolean) => ({
      jobId: "job-1",
      status: done ? ("complete" as const) : ("running" as const),
      items,
      nextCursor: 1 + items.length,
      done,
      truncated: false,
      error: null,
    });

    it("adds what was found since and keeps asking while the search runs", () => {
      const next = applyBackgroundSearchUpdate(session, update([result("b.txt")], false));
      expect(next.results.map((item) => item.name)).toEqual(["a.txt", "b.txt"]);
      expect(next).toMatchObject({ cursor: 2, status: "running", jobId: "job-1" });
    });

    it("lets go of a search that has finished", () => {
      const next = applyBackgroundSearchUpdate(session, update([result("b.txt")], true));
      expect(next).toMatchObject({ status: "complete", jobId: null, elapsedMs: null });
      expect(next.results).toHaveLength(2);
    });

    it("leaves out results that were kept from the search before", () => {
      const next = applyBackgroundSearchUpdate(
        { ...session, keptResultPaths: new Set(["/Users/demo/a.txt"]) },
        update([result("a.txt"), result("b.txt")], false),
      );
      expect(next.results.map((item) => item.name)).toEqual(["a.txt", "b.txt"]);
    });

    it("marks the search to run again when its last answer was thrown away", () => {
      const next = applyBackgroundSearchUpdate(
        { ...session, pollInFlight: true },
        update([], true),
      );
      expect(next).toMatchObject({ jobId: null, status: "cancelled", interrupted: true });
      // An answer that still carries results shows that nothing was lost.
      expect(
        applyBackgroundSearchUpdate({ ...session, pollInFlight: true }, update([], false)),
      ).toMatchObject({ jobId: "job-1", pollInFlight: false, interrupted: false });
    });
  });

  it("tells tabs on folders of the same name apart by the folder each is in", () => {
    const tab = (label: string, path: string, kind = "folder") => ({ label, path, kind });
    expect(
      disambiguateTabLabels([
        tab("src", "/Users/demo/filetrail/src"),
        tab("src", "/Users/demo/codetrail/src"),
        tab("Documents", "/Users/demo/Documents"),
        // Two tabs on the same folder are the same place.
        tab("Downloads", "/Users/demo/Downloads"),
        tab("Downloads", "/Users/demo/Downloads"),
        tab("“src” in demo", "/Users/demo", "search"),
      ]).map((item) => item.label),
    ).toEqual([
      "src — filetrail",
      "src — codetrail",
      "Documents",
      "Downloads",
      "Downloads",
      "“src” in demo",
    ]);
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

describe("followMovedItems", () => {
  const snapshot = (currentPath: string) =>
    ({
      currentPath,
      historyPaths: ["/Users/demo", currentPath],
      historyIndex: 1,
      treeRootPath: "/Users/demo",
      selectedTreeItemId: `fs:${currentPath}`,
      view: { entries: [] },
    }) as unknown as Parameters<typeof followMovedItems>[0];

  // A tab on a folder renamed in another tab finds it under its new name, as a Finder
  // window does, instead of falling back to the folder above.
  it("follows a renamed or moved folder, and folders inside it", () => {
    const moves = [{ from: "/Users/demo/Projects", to: "/Users/demo/Work" }];

    const followed = followMovedItems(snapshot("/Users/demo/Projects/app"), moves);

    expect(followed.currentPath).toBe("/Users/demo/Work/app");
    expect(followed.historyPaths).toEqual(["/Users/demo", "/Users/demo/Work/app"]);
    expect(followed.selectedTreeItemId).toBe("fs:/Users/demo/Work/app");
    // Its listing is read again at the new place.
    expect(followed.view).toBeNull();
  });

  it("leaves a tab on another folder as it is", () => {
    const tab = snapshot("/Users/demo/Projects2");
    expect(followMovedItems(tab, [{ from: "/Users/demo/Projects", to: "/Users/demo/Work" }])).toBe(
      tab,
    );
  });
});

describe("leaveUnmountedDisks", () => {
  const snapshot = (currentPath: string, historyPaths: string[]) =>
    ({
      currentPath,
      historyPaths,
      historyIndex: historyPaths.length - 1,
      treeRootPath: "/Volumes/Backup",
      selectedTreeItemId: "location:/Volumes/Backup",
      leftPaneSubview: "favorites",
      view: { entries: [] },
    }) as unknown as TabSnapshot;
  const unmounted = new Set(["/Volumes/Backup"]);

  it("sends a tab on an unmounted disk Home, keeping its history elsewhere", () => {
    const left = leaveUnmountedDisks(
      snapshot("/Volumes/Backup/Photos", ["/Users/demo/Desktop", "/Volumes/Backup/Photos"]),
      unmounted,
      "/Users/demo",
    );

    expect(left).toMatchObject({
      currentPath: "/Users/demo",
      historyPaths: ["/Users/demo/Desktop", "/Users/demo"],
      historyIndex: 1,
      treeRootPath: "/Users/demo",
      selectedTreeItemId: "fs:/Users/demo",
      leftPaneSubview: "tree",
      view: null,
    });
  });

  it("leaves a tab on another disk, or on a folder named alike, as it is", () => {
    const onArchive = {
      ...snapshot("/Volumes/Archive/2025", ["/Volumes/Archive/2025"]),
      treeRootPath: "/Volumes/Archive",
    };
    expect(leaveUnmountedDisks(onArchive, unmounted, "/Users/demo")).toBe(onArchive);
    const onBackup2 = {
      ...snapshot("/Volumes/Backup 2", ["/Volumes/Backup 2"]),
      treeRootPath: "/Volumes/Backup 2",
    };
    expect(leaveUnmountedDisks(onBackup2, unmounted, "/Users/demo")).toBe(onBackup2);
  });
});

describe("following moved folders", () => {
  // "/P" moved to "/Q", and "/P/A" inside it to "/Q/B": the deepest move decides.
  it("follows the deepest move that holds a path", () => {
    const moves = [
      { from: "/P", to: "/Q" },
      { from: "/P/A", to: "/Q/B" },
    ];
    expect(followMovedPath("/P/A", moves)).toBe("/Q/B");
    expect(followMovedPath("/P/A/x", moves)).toBe("/Q/B/x");
    expect(followMovedPath("/P/C", moves)).toBe("/Q/C");
    expect(followMovedPath("/Elsewhere", moves)).toBe("/Elsewhere");
  });
});
