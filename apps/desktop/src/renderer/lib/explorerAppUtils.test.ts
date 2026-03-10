import { resolveExplorerTreeRootPath, resolveRefreshRootPath } from "./explorerAppUtils";

describe("explorerAppUtils", () => {
  it("roots the tree at home for paths inside home", () => {
    expect(resolveExplorerTreeRootPath("/Users/demo/projects/filetrail", "/Users/demo")).toBe(
      "/Users/demo",
    );
  });

  it("roots the tree at slash for paths above home", () => {
    expect(resolveExplorerTreeRootPath("/Users", "/Users/demo")).toBe("/");
    expect(resolveExplorerTreeRootPath("/Applications", "/Users/demo")).toBe("/");
  });

  it("refresh root never returns an intermediate path", () => {
    expect(resolveRefreshRootPath("/Users/demo/projects", "/Users/demo", "/Users/demo")).toBe(
      "/Users/demo",
    );
    expect(resolveRefreshRootPath("/Users", "/Users/demo", "/Users/demo")).toBe("/");
  });
});
