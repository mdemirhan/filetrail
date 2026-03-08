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
});
