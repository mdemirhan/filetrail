import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import {
  collectRetrySourcePaths,
  describeEmptyTrashFailure,
  formatMissingClipboardItemsMessage,
  formatQuotedNames,
  isExpectedPlannedSkipResult,
  isFolderSizeEligibleKind,
  resolveExplorerTreeRootPath,
  resolveFreeNewFolderName,
  resolveNewFolderTargetPath,
  resolvePasteDestinationPath,
  resolveWriteOperationRefreshPath,
  resolveWriteOperationTreeReloadPaths,
  resolveWriteOperationTreeSelectionPath,
  selectTopLevelItems,
  shouldRenderCopyPasteResultDialog,
  sortEntriesBySize,
} from "./explorerAppUtils";
import type { DirectoryEntry, WriteOperationResult } from "./explorerTypes";

function createPartialSkipEvent(
  skipReason: "planned_conflict_policy" | "runtime_conflict_resolution" | null,
): WriteOperationProgressEvent {
  return {
    operationId: "copy-op-1",
    action: "move_to",
    status: "partial",
    completedItemCount: 0,
    totalItemCount: 0,
    completedByteCount: 0,
    totalBytes: null,
    currentSourcePath: null,
    currentDestinationPath: null,
    runtimeConflict: null,
    result: {
      operationId: "copy-op-1",
      action: "move_to",
      status: "partial",
      targetPath: "/target",
      startedAt: "2026-03-11T00:00:00.000Z",
      finishedAt: "2026-03-11T00:00:01.000Z",
      summary: {
        topLevelItemCount: 1,
        totalItemCount: 0,
        completedItemCount: 0,
        failedItemCount: 0,
        skippedItemCount: 1,
        cancelledItemCount: 0,
        completedByteCount: 0,
        totalBytes: null,
      },
      items: [
        {
          sourcePath: "/source.txt",
          destinationPath: "/target/source.txt",
          status: "skipped",
          error: "Skipped by the planned conflict handling.",
          skipReason,
        },
      ],
      error: null,
    },
  };
}

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

  it("treats bundles as eligible for folder size controls without making them navigable folders", () => {
    expect(isFolderSizeEligibleKind("bundle")).toBe(true);
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
        selectedPathCount: 1,
      }),
    ).toBe("/Users/demo");
  });

  describe("resolvePasteDestinationPath", () => {
    const folder: DirectoryEntry = {
      path: "/Users/demo/Folder",
      name: "Folder",
      kind: "directory",
      extension: "",
      isHidden: false,
      isSymlink: false,
    };
    const linkedFolder: DirectoryEntry = {
      path: "/Users/demo/Linked",
      name: "Linked",
      kind: "symlink_directory",
      extension: "",
      isHidden: false,
      isSymlink: true,
    };
    const base = {
      contextMenuState: null,
      contextMenuTargetEntry: null,
      clipboardSourcePaths: ["/Users/demo/source.txt"],
      currentPath: "/Users/demo",
      focusedPane: "content" as const,
      isSearchMode: false,
      selectedEntry: folder,
      selectedPathCount: 1,
    };
    const contentMenu = (paths: string[], targetPath: string) => ({
      x: 0,
      y: 0,
      paths,
      targetPath,
      surface: "content" as const,
      targetKind: "contentEntry" as const,
      sourceSubview: null,
      scope: "selection" as const,
      folderExpansionLabel: null,
    });

    it("pastes into the one selected folder", () => {
      expect(resolvePasteDestinationPath(base)).toBe("/Users/demo/Folder");
    });

    it("pastes into the current folder when several items are selected", () => {
      expect(resolvePasteDestinationPath({ ...base, selectedPathCount: 2 })).toBe("/Users/demo");
      expect(
        resolvePasteDestinationPath({
          ...base,
          contextMenuState: contentMenu(["/Users/demo/Folder", "/Users/demo/a.txt"], folder.path),
          contextMenuTargetEntry: folder,
        }),
      ).toBe("/Users/demo");
    });

    it("pastes into a right-clicked folder when it is the only item", () => {
      expect(
        resolvePasteDestinationPath({
          ...base,
          contextMenuState: contentMenu([folder.path], folder.path),
          contextMenuTargetEntry: folder,
        }),
      ).toBe("/Users/demo/Folder");
    });

    it("pastes into the folder on screen when the folder picked is itself on the clipboard", () => {
      const onClipboard = { ...base, clipboardSourcePaths: [folder.path] };
      // The keyboard and the item's own menu agree.
      expect(resolvePasteDestinationPath(onClipboard)).toBe("/Users/demo");
      expect(
        resolvePasteDestinationPath({
          ...onClipboard,
          contextMenuState: contentMenu([folder.path], folder.path),
          contextMenuTargetEntry: folder,
        }),
      ).toBe("/Users/demo");
    });

    it("never pastes through a symlinked folder", () => {
      expect(resolvePasteDestinationPath({ ...base, selectedEntry: linkedFolder })).toBe(
        "/Users/demo",
      );
      expect(
        resolvePasteDestinationPath({
          ...base,
          contextMenuState: contentMenu([linkedFolder.path], linkedFolder.path),
          contextMenuTargetEntry: linkedFolder,
        }),
      ).toBe("/Users/demo");
    });

    it("pastes into the folder on screen from the tree or with no focused pane", () => {
      expect(resolvePasteDestinationPath({ ...base, focusedPane: "tree" })).toBe("/Users/demo");
      expect(resolvePasteDestinationPath({ ...base, focusedPane: null })).toBe("/Users/demo");
      expect(
        resolvePasteDestinationPath({ ...base, focusedPane: "tree", currentPath: "" }),
      ).toBeNull();
    });

    it("has no destination in search results", () => {
      expect(resolvePasteDestinationPath({ ...base, isSearchMode: true })).toBeNull();
    });
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

  it("reloads impacted destination branches as well as their parents for a completed subtree move", () => {
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
      "/Users/demo/target/source-folder",
    ]);
  });

  it("treats planned skip partial results as expected", () => {
    const event = createPartialSkipEvent("planned_conflict_policy");

    expect(isExpectedPlannedSkipResult(event)).toBe(true);
    expect(shouldRenderCopyPasteResultDialog(event)).toBe(false);
  });

  it("keeps the result dialog for runtime skip partial results", () => {
    const event = createPartialSkipEvent("runtime_conflict_resolution");

    expect(isExpectedPlannedSkipResult(event)).toBe(false);
    expect(shouldRenderCopyPasteResultDialog(event)).toBe(true);
  });
});

describe("resolveNewFolderTargetPath", () => {
  const entry = (name: string, kind: DirectoryEntry["kind"]): DirectoryEntry => ({
    path: `/Users/demo/${name}`,
    name,
    extension: "",
    kind,
    isHidden: false,
    isSymlink: false,
  });
  const folder = entry("Folder", "directory");
  const file = entry("notes.txt", "file");
  const target = (
    selection: DirectoryEntry[],
    options: { contextScope?: "selection" | "background"; isSearchMode?: boolean } = {},
  ) =>
    resolveNewFolderTargetPath({
      currentPath: "/Users/demo",
      selectedEntry: selection[0] ?? null,
      selectedPaths: selection.map((item) => item.path),
      isSearchMode: options.isSearchMode ?? false,
      ...(options.contextScope ? { contextScope: options.contextScope } : {}),
    });

  it("makes the folder inside the one selected folder, otherwise in the folder on screen", () => {
    expect(target([])).toBe("/Users/demo");
    expect(target([folder])).toBe("/Users/demo/Folder");
    // A file cannot hold it, and several items do not say where: next to them, as in Finder.
    expect(target([file])).toBe("/Users/demo");
    expect(target([folder, file])).toBe("/Users/demo");
    expect(target([file, entry("more.txt", "file")])).toBe("/Users/demo");
  });

  it("offers nothing in the menu opened on a file or on several items", () => {
    expect(target([folder], { contextScope: "selection" })).toBe("/Users/demo/Folder");
    expect(target([file], { contextScope: "selection" })).toBeNull();
    expect(target([folder, file], { contextScope: "selection" })).toBeNull();
    expect(target([], { contextScope: "selection" })).toBe("/Users/demo");
    // The menu opened on empty space is about the folder on screen, whatever is selected.
    expect(target([file], { contextScope: "background" })).toBe("/Users/demo");
  });

  it("has no target in search results or without a folder on screen", () => {
    expect(target([], { isSearchMode: true })).toBeNull();
    expect(target([file], { isSearchMode: true })).toBeNull();
    expect(
      resolveNewFolderTargetPath({
        currentPath: "",
        selectedEntry: file,
        selectedPaths: [file.path],
        isSearchMode: false,
      }),
    ).toBeNull();
  });
});

describe("collectRetrySourcePaths", () => {
  it("retries failed and never-started top-level items, never nested ones on their own", () => {
    const item = (sourcePath: string, status: "completed" | "failed" | "cancelled") => ({
      sourcePath,
      destinationPath: null,
      status,
      error: null,
    });
    expect(
      collectRetrySourcePaths([
        item("/src/a.txt", "completed"),
        item("/src/photos", "failed"),
        item("/src/photos/raw/b.dng", "failed"),
        item("/src/c.txt", "failed"),
        item("/src/d.txt", "cancelled"),
      ]),
    ).toEqual(["/src/photos", "/src/c.txt", "/src/d.txt"]);
  });

  it("does not confuse a sibling with a shared name prefix for a parent", () => {
    const item = (sourcePath: string) => ({
      sourcePath,
      destinationPath: null,
      status: "failed" as const,
      error: null,
    });
    expect(collectRetrySourcePaths([item("/src/photo"), item("/src/photos/a.jpg")])).toEqual([
      "/src/photo",
      "/src/photos/a.jpg",
    ]);
  });

  it("stays fast for very large results", () => {
    const items: WriteOperationResult["items"] = [
      { sourcePath: "/src/big", destinationPath: null, status: "failed", error: null },
    ];
    for (let index = 0; index < 30_000; index += 1) {
      items.push({
        sourcePath: `/src/big/dir-${index % 100}/file-${index}.txt`,
        destinationPath: null,
        status: "failed",
        error: null,
      });
    }
    const startedAt = performance.now();
    expect(collectRetrySourcePaths(items)).toEqual(["/src/big"]);
    // The old pairwise scan took seconds at this size.
    expect(performance.now() - startedAt).toBeLessThan(500);
  });
});

describe("selectTopLevelItems", () => {
  it("keeps items with nothing listed above them, in their original order", () => {
    const items = [
      { sourcePath: "/src/b" },
      { sourcePath: "/src/a/inner.txt" },
      { sourcePath: "/src/a" },
      { sourcePath: "/src/b/deep/x.txt" },
      { sourcePath: null },
    ];
    expect(selectTopLevelItems(items)).toEqual([
      { sourcePath: "/src/b" },
      { sourcePath: "/src/a" },
      { sourcePath: null },
    ]);
  });
});

describe("sortEntriesBySize", () => {
  function sized(
    name: string,
    kind: DirectoryEntry["kind"],
    sizeBytes?: number | null,
  ): DirectoryEntry {
    return {
      path: `/dest/${name}`,
      name,
      extension: "",
      kind,
      isHidden: false,
      isSymlink: kind === "symlink_directory",
      ...(sizeBytes === undefined ? {} : { sizeBytes }),
    };
  }
  const entries = [
    sized("blob_storage", "directory"),
    sized("Cache", "directory"),
    sized("live-status", "directory"),
    sized("Local Storage", "directory"),
    sized("Pending", "directory"),
    sized("App.app", "bundle"),
    sized("Preferences", "file", 41),
    sized("codetrail.sqlite", "file", 1_400_000_000),
    sized("Trust Tokens-journal", "file", 0),
  ];
  const folderSizes: Record<string, number> = {
    "/dest/blob_storage": 0,
    "/dest/Cache": 0,
    "/dest/live-status": 35_000_000,
    "/dest/Local Storage": 10_000,
    "/dest/App.app": 500,
  };
  const getFolderSizeBytes = (path: string) => folderSizes[path] ?? null;

  it("orders folders by their calculated size, like files, with unknown sizes last", () => {
    const sorted = sortEntriesBySize(entries, {
      sortDirection: "asc",
      foldersFirst: true,
      getFolderSizeBytes,
    });
    expect(sorted.map((entry) => entry.name)).toEqual([
      "blob_storage",
      "Cache",
      "Local Storage",
      "live-status",
      "Pending",
      "Trust Tokens-journal",
      "Preferences",
      "App.app",
      "codetrail.sqlite",
    ]);
  });

  it("keeps unknown sizes last when sorting largest first", () => {
    const sorted = sortEntriesBySize(entries, {
      sortDirection: "desc",
      foldersFirst: true,
      getFolderSizeBytes,
    });
    expect(sorted.map((entry) => entry.name)).toEqual([
      "live-status",
      "Local Storage",
      "Cache",
      "blob_storage",
      "Pending",
      "codetrail.sqlite",
      "App.app",
      "Preferences",
      "Trust Tokens-journal",
    ]);
  });

  it("mixes folders and files by size when folders aren't listed first", () => {
    const sorted = sortEntriesBySize(entries, {
      sortDirection: "asc",
      foldersFirst: false,
      getFolderSizeBytes,
    });
    expect(sorted.map((entry) => entry.name)).toEqual([
      "blob_storage",
      "Cache",
      "Trust Tokens-journal",
      "Preferences",
      "App.app",
      "Local Storage",
      "live-status",
      "codetrail.sqlite",
      "Pending",
    ]);
  });
  it("names a few items and counts the rest", () => {
    expect(formatQuotedNames([])).toBe("");
    expect(formatQuotedNames(["/a/report.pdf"])).toBe("“report.pdf”");
    expect(formatQuotedNames(["/a/one", "/a/two"])).toBe("“one” and “two”");
    expect(formatQuotedNames(["/a/1", "/a/2", "/a/3"])).toBe("“1”, “2” and “3”");
    expect(formatQuotedNames(["/a/1", "/a/2", "/a/3", "/a/4", "/a/5"])).toBe(
      "“1”, “2”, “3” and 2 more",
    );
  });

  it("says which clipboard items could not be pasted because they are gone", () => {
    expect(formatMissingClipboardItemsMessage(["/Users/demo/report.pdf"])).toBe(
      "“report.pdf” couldn't be pasted because it no longer exists.",
    );
    expect(formatMissingClipboardItemsMessage(["/a/one", "/a/two"])).toBe(
      "“one” and “two” couldn't be pasted because they no longer exist.",
    );
    expect(formatMissingClipboardItemsMessage(["/a/1", "/a/2", "/a/3", "/a/4"])).toBe(
      "4 items couldn't be pasted because they no longer exist: “1”, “2”, “3” and 1 more.",
    );
  });
  it("suggests a free New Folder name, ignoring case like the disk does", () => {
    expect(resolveFreeNewFolderName([])).toBe("New Folder");
    expect(resolveFreeNewFolderName(["New Folder"])).toBe("New Folder 2");
    expect(resolveFreeNewFolderName(["new folder", "NEW FOLDER 2"])).toBe("New Folder 3");
    expect(resolveFreeNewFolderName(["New Folder", "New Folder 3"])).toBe("New Folder 2");
  });
  it("explains an Empty Trash failure, and how to allow File Trail to control Finder", () => {
    expect(
      describeEmptyTrashFailure(
        "execution error: Not authorized to send Apple events to Finder. (-1743)",
      ),
    ).toEqual({
      title: "The Trash couldn't be emptied.",
      message:
        "File Trail needs permission to control Finder. Turn it on in System Settings > Privacy & Security > Automation, then try again.",
    });
    expect(
      describeEmptyTrashFailure("Finder got an error: The operation can't be completed."),
    ).toEqual({
      title: "The Trash couldn't be emptied.",
      message: "Finder got an error: The operation can't be completed.",
    });
    expect(describeEmptyTrashFailure("  ").message).toBe(
      "Finder didn't empty the Trash. Try again, or empty it in Finder.",
    );
  });
});
