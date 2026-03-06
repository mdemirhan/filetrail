import { flattenVisibleTree, getTreeKeyboardAction } from "./treeView";

describe("flattenVisibleTree", () => {
  it("returns only expanded branches in display order", () => {
    const nodes = {
      "/root": {
        path: "/root",
        name: "root",
        kind: "directory" as const,
        isHidden: false,
        isSymlink: false,
        expanded: true,
        loading: false,
        loaded: true,
        error: null,
        childPaths: ["/root/a", "/root/b"],
      },
      "/root/a": {
        path: "/root/a",
        name: "a",
        kind: "directory" as const,
        isHidden: false,
        isSymlink: false,
        expanded: true,
        loading: false,
        loaded: true,
        error: null,
        childPaths: ["/root/a/deep"],
      },
      "/root/a/deep": {
        path: "/root/a/deep",
        name: "deep",
        kind: "directory" as const,
        isHidden: false,
        isSymlink: false,
        expanded: false,
        loading: false,
        loaded: false,
        error: null,
        childPaths: [],
      },
      "/root/b": {
        path: "/root/b",
        name: "b",
        kind: "directory" as const,
        isHidden: false,
        isSymlink: false,
        expanded: false,
        loading: false,
        loaded: false,
        error: null,
        childPaths: [],
      },
    };

    expect(flattenVisibleTree({ rootPath: "/root", nodes })).toEqual([
      { path: "/root", depth: 0 },
      { path: "/root/a", depth: 1 },
      { path: "/root/a/deep", depth: 2 },
      { path: "/root/b", depth: 1 },
    ]);
  });
});

describe("getTreeKeyboardAction", () => {
  const nodes = {
    "/root": {
      path: "/root",
      name: "root",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: true,
      loading: false,
      loaded: true,
      error: null,
      childPaths: ["/root/a", "/root/b", "/root/loading"],
    },
    "/root/a": {
      path: "/root/a",
      name: "a",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: true,
      loading: false,
      loaded: true,
      error: null,
      childPaths: ["/root/a/deep"],
    },
    "/root/a/deep": {
      path: "/root/a/deep",
      name: "deep",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: false,
      loading: false,
      loaded: false,
      error: null,
      childPaths: [],
    },
    "/root/b": {
      path: "/root/b",
      name: "b",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: false,
      loading: false,
      loaded: true,
      error: null,
      childPaths: ["/root/b/child"],
    },
    "/root/loading": {
      path: "/root/loading",
      name: "loading",
      kind: "directory" as const,
      isHidden: false,
      isSymlink: false,
      expanded: false,
      loading: false,
      loaded: false,
      error: null,
      childPaths: [],
    },
  };

  it("moves through visible tree rows", () => {
    expect(
      getTreeKeyboardAction({
        key: "ArrowDown",
        currentPath: "/root",
        rootPath: "/root",
        nodes,
      }),
    ).toEqual({ type: "navigate", path: "/root/a" });
    expect(
      getTreeKeyboardAction({
        key: "ArrowUp",
        currentPath: "/root/a",
        rootPath: "/root",
        nodes,
      }),
    ).toEqual({ type: "navigate", path: "/root" });
  });

  it("expands and collapses tree nodes on horizontal arrows", () => {
    expect(
      getTreeKeyboardAction({
        key: "ArrowRight",
        currentPath: "/root/b",
        rootPath: "/root",
        nodes,
      }),
    ).toEqual({ type: "expand", path: "/root/b" });
    expect(
      getTreeKeyboardAction({
        key: "ArrowLeft",
        currentPath: "/root/a",
        rootPath: "/root",
        nodes,
      }),
    ).toEqual({ type: "collapse", path: "/root/a" });
  });

  it("navigates to parent and requests loading for unloaded nodes", () => {
    expect(
      getTreeKeyboardAction({
        key: "ArrowLeft",
        currentPath: "/root/a/deep",
        rootPath: "/root",
        nodes,
      }),
    ).toEqual({ type: "navigate", path: "/root/a" });
    expect(
      getTreeKeyboardAction({
        key: "ArrowRight",
        currentPath: "/root/loading",
        rootPath: "/root",
        nodes,
      }),
    ).toEqual({ type: "load", path: "/root/loading" });
  });
});
