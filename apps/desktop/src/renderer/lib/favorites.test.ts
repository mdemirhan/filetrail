import {
  buildSidebarLocations,
  buildTreePresentation,
  createFavorite,
  getDefaultFavorites,
  getShortcutItemPath,
  isTrashListingRefused,
  reorderFavorites,
} from "./favorites";

describe("favorites", () => {
  it("builds default favorites in the requested order, leaving Home, Macintosh HD and the Trash to Locations", () => {
    expect(getDefaultFavorites("/Users/demo")).toEqual([
      { path: "/Applications", icon: "applications" },
      { path: "/Users/demo/Desktop", icon: "desktop" },
      { path: "/Users/demo/Documents", icon: "documents" },
      { path: "/Users/demo/Downloads", icon: "downloads" },
    ]);
  });

  it("lists Home, Macintosh HD and the Trash under Locations, then the disks mounted", () => {
    expect(
      buildSidebarLocations(
        [
          { path: "/Volumes/Backup", name: "Backup", isLocal: true },
          { path: "/Volumes/Shared", name: "Shared", isLocal: false },
        ],
        "/Users/demo",
      ),
    ).toEqual([
      { path: "/Users/demo", label: "demo", icon: "home" },
      { path: "/", label: "Macintosh HD", icon: "drive" },
      { path: "/Users/demo/.Trash", label: "Trash", icon: "trash" },
      { path: "/Volumes/Backup", label: "Backup", icon: "drive" },
      { path: "/Volumes/Shared", label: "Shared", icon: "server" },
    ]);
    // Without a home folder there is no Home or Trash to list.
    expect(buildSidebarLocations([], "")).toEqual([
      { path: "/", label: "Macintosh HD", icon: "drive" },
    ]);
  });

  it("shows Locations after Favorites in the tree, its places as rows without folders", () => {
    const { items, visibleItemIds } = buildTreePresentation({
      favorites: [{ path: "/Users/demo/Documents", icon: "documents" }],
      favoritesExpanded: true,
      homePath: "/Users/demo",
      rootPath: "/Users/demo",
      nodes: {},
      locations: buildSidebarLocations(
        [{ path: "/Volumes/Backup", name: "Backup", isLocal: true }],
        "/Users/demo",
      ),
      locationsExpanded: true,
    });
    expect(visibleItemIds).toEqual([
      "favorites-root",
      "favorite:/Users/demo/Documents",
      "locations-root",
      "location:/Users/demo",
      "location:/",
      "location:/Users/demo/.Trash",
      "location:/Volumes/Backup",
    ]);
    expect(items["location:/Volumes/Backup"]).toMatchObject({
      kind: "location",
      label: "Backup",
      path: "/Volumes/Backup",
      canExpand: false,
      icon: "drive",
    });
    expect(getShortcutItemPath("location:/Volumes/Backup")).toBe("/Volumes/Backup");
    expect(getShortcutItemPath("favorite:/Users/demo/Documents")).toBe("/Users/demo/Documents");

    // Folded, only its row is left; with favorites in their own list, it is not in the tree.
    expect(
      buildTreePresentation({
        favorites: [],
        favoritesExpanded: true,
        homePath: "/Users/demo",
        rootPath: "",
        nodes: {},
        locations: buildSidebarLocations([], "/Users/demo"),
        locationsExpanded: false,
      }).visibleItemIds,
    ).toEqual(["favorites-root", "locations-root"]);
    expect(
      buildTreePresentation({
        favorites: [],
        favoritesExpanded: true,
        homePath: "/Users/demo",
        rootPath: "",
        nodes: {},
        includeFavorites: false,
        locations: buildSidebarLocations([], "/Users/demo"),
      }).visibleItemIds,
    ).toEqual([]);
  });

  it("puts a dragged favorite just before or after another", () => {
    const favorites = [
      { path: "/Applications", icon: "applications" as const },
      { path: "/Users/demo/Desktop", icon: "desktop" as const },
      { path: "/Users/demo/Documents", icon: "documents" as const },
      { path: "/Users/demo/Downloads", icon: "downloads" as const },
    ];
    const order = (moved: string, target: string, position: "before" | "after") =>
      reorderFavorites(favorites, moved, target, position).map((favorite) =>
        favorite.path.split("/").at(-1),
      );

    expect(order("/Users/demo/Downloads", "/Applications", "before")).toEqual([
      "Downloads",
      "Applications",
      "Desktop",
      "Documents",
    ]);
    expect(order("/Applications", "/Users/demo/Documents", "after")).toEqual([
      "Desktop",
      "Documents",
      "Applications",
      "Downloads",
    ]);
    expect(order("/Users/demo/Desktop", "/Users/demo/Downloads", "before")).toEqual([
      "Applications",
      "Documents",
      "Desktop",
      "Downloads",
    ]);
    // Onto itself, or where it already is: the same list, so nothing is saved.
    expect(reorderFavorites(favorites, "/Applications", "/Applications", "after")).toBe(favorites);
    expect(reorderFavorites(favorites, "/Applications", "/Users/demo/Desktop", "before")).toBe(
      favorites,
    );
    expect(reorderFavorites(favorites, "/Missing", "/Applications", "before")).toBe(favorites);
  });

  it("recognizes macOS refusing to list the Trash", () => {
    const refusal = "EPERM: operation not permitted, scandir '/Users/demo/.Trash'";
    expect(isTrashListingRefused("/Users/demo/.Trash", refusal, "/Users/demo")).toBe(true);
    expect(isTrashListingRefused("/Users/demo/Private", refusal, "/Users/demo")).toBe(false);
    expect(isTrashListingRefused("/Users/demo/.Trash", "ENOENT: no such file", "/Users/demo")).toBe(
      false,
    );
    expect(isTrashListingRefused("/Users/demo/.Trash", null, "/Users/demo")).toBe(false);
    expect(isTrashListingRefused("", refusal, "")).toBe(false);
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
    expect(presentation.items["favorites-root"]?.childIds).toEqual([
      "favorite:/Users/demo/Documents",
    ]);
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
