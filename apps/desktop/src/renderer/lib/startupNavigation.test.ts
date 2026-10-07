import { resolveStartupNavigation, resolveStartupTabs } from "./startupNavigation";

describe("startup navigation", () => {
  it("keeps a hand-picked tree root when the last visited folder is inside it", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: true,
          lastVisitedPath: "/Users/demo/projects/filetrail",
          lastVisitedFavoritePath: null,
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo/projects/filetrail",
      startupRootPath: "/Users/demo/projects",
      startupFavoritePath: null,
    });
  });

  it("keeps a hand-picked tree root that is the last visited folder itself", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: true,
          lastVisitedPath: "/Applications",
          lastVisitedFavoritePath: null,
          treeRootPath: "/Applications",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Applications",
      startupRootPath: "/Applications",
      startupFavoritePath: null,
    });
  });

  it("uses home as the tree root when the last visited folder is inside home but outside the saved root", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: true,
          lastVisitedPath: "/Users/demo/Documents",
          lastVisitedFavoritePath: null,
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo/Documents",
      startupRootPath: "/Users/demo",
      startupFavoritePath: null,
    });
  });

  it("uses slash as the tree root when the last visited folder is above home and outside the saved root", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: true,
          lastVisitedPath: "/Applications",
          lastVisitedFavoritePath: null,
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Applications",
      startupRootPath: "/",
      startupFavoritePath: null,
    });
  });

  it("uses the persisted slash root when restoring a path inside home", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: true,
          lastVisitedPath: "/Users/demo/Documents",
          lastVisitedFavoritePath: "/Users/demo/Documents",
          treeRootPath: "/",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo/Documents",
      startupRootPath: "/",
      startupFavoritePath: "/Users/demo/Documents",
    });
  });

  it("uses the explicit startup folder instead of the last visited folder", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: true,
          lastVisitedPath: "/Users/demo/projects/filetrail",
          lastVisitedFavoritePath: "/Users/demo/projects/filetrail",
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
        "/Applications",
      ),
    ).toEqual({
      startupPath: "/Applications",
      startupRootPath: "/",
      startupFavoritePath: null,
    });
  });

  it("uses home as the tree root when the explicit startup folder is inside home", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: false,
          lastVisitedPath: null,
          lastVisitedFavoritePath: null,
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
        "/Users/demo/src/filetrail",
      ),
    ).toEqual({
      startupPath: "/Users/demo/src/filetrail",
      startupRootPath: "/Users/demo",
      startupFavoritePath: null,
    });
  });

  it("starts at home when the last session is not reopened", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: false,
          lastVisitedPath: "/Users/demo/projects/filetrail",
          lastVisitedFavoritePath: "/Users/demo/projects/filetrail",
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo",
      startupRootPath: "/Users/demo",
      startupFavoritePath: null,
    });
  });

  it("restores a selected favorite path when the restored folder exactly matches it", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreSessionOnStartup: true,
          lastVisitedPath: "/Users/demo/Documents",
          lastVisitedFavoritePath: "/Users/demo/Documents",
          treeRootPath: "/Users/demo",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo/Documents",
      startupRootPath: "/Users/demo",
      startupFavoritePath: "/Users/demo/Documents",
    });
  });

  describe("resolveStartupTabs", () => {
    const tab = (path: string | null, overrides: object = {}) => ({
      path,
      treeRootPath: "/Users/demo",
      favoritePath: null,
      viewMode: "list" as const,
      searchViewMode: "details" as const,
      sortBy: "name" as const,
      sortDirection: "asc" as const,
      includeHidden: false,
      foldersFirst: true,
      favoritesExpanded: true,
      locationsExpanded: true,
      ...overrides,
    });
    const preferences = {
      restoreSessionOnStartup: true,
      openTabs: [
        tab("/Users/demo/work", {
          viewMode: "details",
          sortBy: "size",
          sortDirection: "desc",
          includeHidden: true,
          foldersFirst: false,
          favoritesExpanded: false,
          locationsExpanded: false,
        }),
        tab("/Users/demo/Documents", { favoritePath: "/Users/demo/Documents" }),
        tab("/Volumes/Backup", { treeRootPath: "/" }),
      ],
      activeTabIndex: 1,
      lastVisitedPath: "/Users/demo/Documents",
      lastVisitedFavoritePath: "/Users/demo/Documents",
      treeRootPath: "/Users/demo",
      viewMode: "list" as const,
      searchViewMode: "details" as const,
      sortBy: "name" as const,
      sortDirection: "asc" as const,
      includeHidden: false,
      foldersFirst: true,
      favoritesExpanded: true,
      locationsExpanded: false,
    };

    it("brings every tab back at its own folder, with its own view", () => {
      expect(resolveStartupTabs(preferences, "/Users/demo")).toEqual({
        activeIndex: 1,
        tabs: [
          {
            path: "/Users/demo/work",
            rootPath: "/Users/demo",
            favoritePath: null,
            viewMode: "details",
            searchViewMode: "details",
            sortBy: "size",
            sortDirection: "desc",
            includeHidden: true,
            foldersFirst: false,
            favoritesExpanded: false,
            locationsExpanded: false,
          },
          {
            path: "/Users/demo/Documents",
            rootPath: "/Users/demo",
            favoritePath: "/Users/demo/Documents",
            viewMode: "list",
            searchViewMode: "details",
            sortBy: "name",
            sortDirection: "asc",
            includeHidden: false,
            foldersFirst: true,
            favoritesExpanded: true,
            locationsExpanded: true,
          },
          // Saved with the tree at Macintosh HD: another disk is shown from its own top.
          {
            path: "/Volumes/Backup",
            rootPath: "/Volumes/Backup",
            favoritePath: null,
            viewMode: "list",
            searchViewMode: "details",
            sortBy: "name",
            sortDirection: "asc",
            includeHidden: false,
            foldersFirst: true,
            favoritesExpanded: true,
            locationsExpanded: true,
          },
        ],
      });
    });

    it("opens a single view at home when the last session is not reopened", () => {
      expect(
        resolveStartupTabs({ ...preferences, restoreSessionOnStartup: false }, "/Users/demo").tabs,
      ).toEqual([
        {
          path: "/Users/demo",
          rootPath: "/Users/demo",
          favoritePath: null,
          viewMode: "list",
          searchViewMode: "details",
          sortBy: "name",
          sortDirection: "asc",
          includeHidden: false,
          foldersFirst: true,
          // Not reopening the session: the window's sidebar.
          favoritesExpanded: true,
          locationsExpanded: false,
        },
      ]);
      // No tabs were saved yet (the first launch with tabs): the last folder, in one view.
      expect(resolveStartupTabs({ ...preferences, openTabs: [] }, "/Users/demo")).toMatchObject({
        activeIndex: 0,
        tabs: [{ path: "/Users/demo/Documents", favoritePath: "/Users/demo/Documents" }],
      });
    });

    it("shows a folder the app was launched with in a restored tab, or in a new one", () => {
      expect(resolveStartupTabs(preferences, "/Users/demo", "/Users/demo/work").activeIndex).toBe(
        0,
      );
      const launched = resolveStartupTabs(preferences, "/Users/demo", "/Users/demo/Pictures");
      expect(launched.activeIndex).toBe(3);
      expect(launched.tabs[3]).toMatchObject({
        path: "/Users/demo/Pictures",
        rootPath: "/Users/demo",
      });
    });

    it("opens the tabs a window was given, whatever the setting says", () => {
      const off = { ...preferences, restoreSessionOnStartup: false };
      expect(resolveStartupTabs(off, "/Users/demo").tabs).toHaveLength(1);
      const given = resolveStartupTabs(off, "/Users/demo", null, true);
      expect(given.activeIndex).toBe(1);
      expect(given.tabs.map((tab) => tab.path)).toEqual([
        "/Users/demo/work",
        "/Users/demo/Documents",
        "/Volumes/Backup",
      ]);
    });

    it("falls back to the last tab when the saved active tab is out of range", () => {
      expect(
        resolveStartupTabs({ ...preferences, activeTabIndex: 9 }, "/Users/demo").activeIndex,
      ).toBe(2);
      expect(
        resolveStartupTabs({ ...preferences, openTabs: [tab(null)] }, "/Users/demo").tabs[0]?.path,
      ).toBe("/Users/demo");
    });
  });
});
