import { resolveStartupNavigation } from "./startupNavigation";

describe("startup navigation", () => {
  it("uses home as the tree root when the last visited folder is inside home", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: true,
          lastVisitedPath: "/Users/demo/projects/filetrail",
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo/projects/filetrail",
      startupRootPath: "/Users/demo",
    });
  });

  it("uses slash as the tree root when the last visited folder is above home", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: true,
          lastVisitedPath: "/Applications",
          treeRootPath: "/Applications",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Applications",
      startupRootPath: "/",
    });
  });

  it("uses the explicit startup folder instead of the last visited folder", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: true,
          lastVisitedPath: "/Users/demo/projects/filetrail",
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
        "/Applications",
      ),
    ).toEqual({
      startupPath: "/Applications",
      startupRootPath: "/",
    });
  });

  it("uses home as the tree root when the explicit startup folder is inside home", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: false,
          lastVisitedPath: null,
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
        "/Users/demo/src/filetrail",
      ),
    ).toEqual({
      startupPath: "/Users/demo/src/filetrail",
      startupRootPath: "/Users/demo",
    });
  });

  it("starts at home when restore last visited is disabled", () => {
    expect(
      resolveStartupNavigation(
        {
          restoreLastVisitedFolderOnStartup: false,
          lastVisitedPath: "/Users/demo/projects/filetrail",
          treeRootPath: "/Users/demo/projects",
        },
        "/Users/demo",
      ),
    ).toEqual({
      startupPath: "/Users/demo",
      startupRootPath: "/Users/demo",
    });
  });
});
