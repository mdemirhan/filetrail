import {
  resolveExplorerTreeRootPath,
  resolvePasteDestinationPath,
  resolveWriteOperationRefreshPath,
  resolveWriteOperationTreeReloadPaths,
  resolveWriteOperationTreeSelectionPath,
} from "./explorerAppUtils";
import type { WriteOperationResult } from "./explorerTypes";

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

  it("pastes a copied folder back into the current directory instead of into itself", () => {
    expect(
      resolvePasteDestinationPath({
        contextMenuState: null,
        contextMenuTargetEntry: null,
        clipboardSourcePaths: ["/Users/demo/Folder"],
        currentPath: "/Users/demo",
        focusedPane: "content",
        isSearchMode: false,
        selectedEntry: {
          path: "/Users/demo/Folder",
          name: "Folder",
          kind: "directory",
          extension: "",
          isHidden: false,
          isSymlink: false,
        },
      }),
    ).toBe("/Users/demo");
  });

  it("remaps the refreshed path after a rename inside the current folder", () => {
    const result = {
      action: "rename",
      items: [
        {
          sourcePath: "/Users/demo/tmp/old-name",
          destinationPath: "/Users/demo/tmp/new-name",
          status: "completed",
          error: null,
        },
      ],
    } as WriteOperationResult;

    expect(resolveWriteOperationRefreshPath(result, "/Users/demo/tmp/old-name")).toBe(
      "/Users/demo/tmp/new-name",
    );
    expect(
      resolveWriteOperationRefreshPath(result, "/Users/demo/tmp/old-name/child/grandchild"),
    ).toBe("/Users/demo/tmp/new-name/child/grandchild");
  });

  it("falls back to the parent path after trashing the selected tree folder", () => {
    const result = {
      action: "trash",
      items: [
        {
          sourcePath: "/Users/demo/tmp/old-name",
          destinationPath: null,
          status: "completed",
          error: null,
        },
      ],
    } as WriteOperationResult;

    expect(resolveWriteOperationRefreshPath(result, "/Users/demo/tmp/old-name")).toBe(
      "/Users/demo/tmp",
    );
    expect(resolveWriteOperationTreeSelectionPath(result, "/Users/demo/tmp/old-name/child")).toBe(
      "/Users/demo/tmp",
    );
  });

  it("remaps tree selection after a rename when the selected node is inside the renamed folder", () => {
    const result = {
      action: "rename",
      items: [
        {
          sourcePath: "/Users/demo/tmp/old-name",
          destinationPath: "/Users/demo/tmp/new-name",
          status: "completed",
          error: null,
        },
      ],
    } as WriteOperationResult;

    expect(resolveWriteOperationTreeSelectionPath(result, "/Users/demo/tmp/old-name/child")).toBe(
      "/Users/demo/tmp/new-name/child",
    );
  });

  it("remaps tree selection after a rename when the renamed folder itself is selected", () => {
    const result = {
      action: "rename",
      items: [
        {
          sourcePath: "/Users/demo/tmp/old-name",
          destinationPath: "/Users/demo/tmp/new-name",
          status: "completed",
          error: null,
        },
      ],
    } as WriteOperationResult;

    expect(resolveWriteOperationTreeSelectionPath(result, "/Users/demo/tmp/old-name")).toBe(
      "/Users/demo/tmp/new-name",
    );
  });

  it("reloads only impacted parent branches for a completed subtree move", () => {
    const result = {
      action: "move_to",
      items: [
        {
          sourcePath: "/Users/demo/source-folder",
          destinationPath: "/Users/demo/target/source-folder",
          status: "completed",
          error: null,
        },
        {
          sourcePath: "/Users/demo/source-folder/child.txt",
          destinationPath: "/Users/demo/target/source-folder/child.txt",
          status: "completed",
          error: null,
        },
        {
          sourcePath: "/Users/demo/source-folder/nested/deep.txt",
          destinationPath: "/Users/demo/target/source-folder/nested/deep.txt",
          status: "completed",
          error: null,
        },
      ],
    } as WriteOperationResult;

    expect(resolveWriteOperationTreeReloadPaths(result)).toEqual([
      "/Users/demo",
      "/Users/demo/target",
    ]);
  });
});
