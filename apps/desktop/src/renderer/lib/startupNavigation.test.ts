import { resolveStartupNavigation } from "./startupNavigation";

describe("startup navigation", () => {
  it("uses home as the tree root when the last visited folder is inside home", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: true,
          lastVisitedPath: "/Users/demo/projects/filetrail",
          lastVisitedFavoritePath: null,
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo/projects/filetrail",
      startupRootPath: "/Users/demo",
      startupFavoritePath: null,
    });
  });

  it("uses slash as the tree root when the last visited folder is above home", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: true,
          lastVisitedPath: "/Applications",
          lastVisitedFavoritePath: null,
          treeRootPath: "/Applications",
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
          restoreLastVisitedFolderOnStartup: true,
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
          restoreLastVisitedFolderOnStartup: true,
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
          restoreLastVisitedFolderOnStartup: false,
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

  it("starts at home when restore last visited is disabled", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: false,
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
          restoreLastVisitedFolderOnStartup: true,
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
});
