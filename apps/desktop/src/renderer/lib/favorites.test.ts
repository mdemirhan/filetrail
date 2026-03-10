import { buildTreePresentation, createFavorite, getDefaultFavorites } from "./favorites";

describe("favorites", () => {
  it("builds default favorites in the requested order", () => {
    expect(getDefaultFavorites("/Users/demo")).toEqual([
      { path: "/Users/demo", icon: "home" },
      { path: "/Applications", icon: "applications" },
      { path: "/Users/demo/Desktop", icon: "desktop" },
      { path: "/Users/demo/Documents", icon: "documents" },
      { path: "/Users/demo/Downloads", icon: "downloads" },
      { path: "/Users/demo/.Trash", icon: "trash" },
    ]);
  });

  it("infers curated icons for common added folders", () => {
    expect(createFavorite("/Users/demo/Music", "/Users/demo")).toEqual({
      path: "/Users/demo/Music",
      icon: "music",
    });
    expect(createFavorite("/Users/demo/Projects", "/Users/demo")).toEqual({
      path: "/Users/demo/Projects",
      icon: "projects",
    });
  });

  it("includes a synthetic favorites root ahead of the filesystem tree", () => {
    const presentation = buildTreePresentation({
      favorites: [{ path: "/Users/demo/Documents", icon: "documents" }],
      favoritesExpanded: true,
      homePath: "/Users/demo",
      rootPath: "/Users/demo",
      nodes: {
        "/Users/demo": {
          path: "/Users/demo",
          name: "demo",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: true,
          loading: false,
          loaded: true,
          error: null,
          childPaths: ["/Users/demo/src"],
        },
        "/Users/demo/src": {
          path: "/Users/demo/src",
          name: "src",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: false,
          loading: false,
          loaded: false,
          error: null,
          childPaths: [],
        },
      },
    });

    expect(presentation.visibleItemIds).toEqual([
      "favorites-root",
      "favorite:/Users/demo/Documents",
      "fs:/Users/demo",
      "fs:/Users/demo/src",
    ]);
    expect(presentation.items["favorites-root"]?.childIds).toEqual(["favorite:/Users/demo/Documents"]);
    expect(presentation.items["favorites-root"]?.icon).toBe("star");
    expect(presentation.items["favorite:/Users/demo/Documents"]?.icon).toBe("documents");
    expect(presentation.items["fs:/Users/demo/src"]?.depth).toBe(1);
  });

  it("keeps favorites flat even when filesystem tree contains descendants", () => {
    const presentation = buildTreePresentation({
      favorites: [{ path: "/Users/demo/Documents", icon: "documents" }],
      favoritesExpanded: true,
      homePath: "/Users/demo",
      rootPath: "/Users/demo",
      nodes: {
        "/Users/demo": {
          path: "/Users/demo",
          name: "demo",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: true,
          loading: false,
          loaded: true,
          error: null,
          childPaths: ["/Users/demo/Documents"],
        },
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          name: "Documents",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: true,
          loading: false,
          loaded: true,
          error: null,
          childPaths: ["/Users/demo/Documents/Subfolder"],
        },
        "/Users/demo/Documents/Subfolder": {
          path: "/Users/demo/Documents/Subfolder",
          name: "Subfolder",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: false,
          loading: false,
          loaded: false,
          error: null,
          childPaths: [],
        },
      },
    });

    expect(presentation.items["favorite:/Users/demo/Documents"]?.childIds).toEqual([]);
    expect(presentation.visibleItemIds).not.toContain("favorite:/Users/demo/Documents/Subfolder");
  });
});
