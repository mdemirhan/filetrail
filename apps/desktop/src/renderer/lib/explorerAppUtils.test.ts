import type { WriteOperationProgressEvent } from "@filetrail/contracts";

import {
  collectFollowedMoves,
  collectRetrySourcePaths,
  describeDragRefusedWhileBusy,
  describeEmptyTrashFailure,
  formatMissingClipboardItemsMessage,
  formatQuotedNames,
  isExpectedPlannedSkipResult,
  isFolderSizeEligibleKind,
  isPathWithinTreeRoot,
  pathsLeftByWrite,
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

  it("roots the tree at the disk for a folder on another disk", () => {
    expect(resolveExplorerTreeRootPath("/Volumes/Backup/Photos", "/Users/demo")).toBe(
      "/Volumes/Backup",
    );
    expect(resolveExplorerTreeRootPath("/Volumes/Backup", "/Users/demo")).toBe("/Volumes/Backup");
    // /Volumes itself is a folder of Macintosh HD.
    expect(resolveExplorerTreeRootPath("/Volumes", "/Users/demo")).toBe("/");
  });

  it("keeps other disks out of a tree rooted at Macintosh HD", () => {
    expect(isPathWithinTreeRoot("/Applications/Utilities", "/")).toBe(true);
    expect(isPathWithinTreeRoot("/Volumes", "/")).toBe(true);
    expect(isPathWithinTreeRoot("/Volumes/Backup/Photos", "/")).toBe(false);
    // A tree rooted on a disk, or at /Volumes by hand, holds what is inside it.
    expect(isPathWithinTreeRoot("/Volumes/Backup/Photos", "/Volumes/Backup")).toBe(true);
    expect(isPathWithinTreeRoot("/Volumes/Backup/Photos", "/Volumes")).toBe(true);
    expect(isPathWithinTreeRoot("/Volumes/Backup 2", "/Volumes/Backup")).toBe(false);
  });

  it("treats bundles as eligible for folder size controls without making them navigable folders", () => {
    expect(isFolderSizeEligibleKind("bundle")).toBe(true);
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
      isSearchMode: false,
      homePath: "/Users/demo",
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

    // Like Finder: a selected folder (often the one just pasted) isn't a target, so a
    // second ⌘V doesn't land out of sight inside it.
    it("pastes into the folder on screen from the keyboard or menu bar, whatever is selected", () => {
      expect(resolvePasteDestinationPath(base)).toBe("/Users/demo");
      expect(resolvePasteDestinationPath({ ...base, currentPath: "" })).toBeNull();
    });

    it("pastes into the current folder from the menu of several items", () => {
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

    it("pastes into the folder on screen when the folder right-clicked is itself on the clipboard", () => {
      expect(
        resolvePasteDestinationPath({
          ...base,
          clipboardSourcePaths: [folder.path],
          contextMenuState: contentMenu([folder.path], folder.path),
          contextMenuTargetEntry: folder,
        }),
      ).toBe("/Users/demo");
    });

    it("never pastes through a symlinked folder", () => {
      expect(
        resolvePasteDestinationPath({
          ...base,
          contextMenuState: contentMenu([linkedFolder.path], linkedFolder.path),
          contextMenuTargetEntry: linkedFolder,
        }),
      ).toBe("/Users/demo");
    });

    it("has no destination in search results", () => {
      expect(resolvePasteDestinationPath({ ...base, isSearchMode: true })).toBeNull();
    });

    // Finder's Trash has no Paste: Move to Trash puts items there.
    it("never pastes into the Trash or a folder in it", () => {
      expect(
        resolvePasteDestinationPath({ ...base, currentPath: "/Users/demo/.Trash" }),
      ).toBeNull();
      const trashedFolder = { ...folder, path: "/Users/demo/.Trash/Old" };
      expect(
        resolvePasteDestinationPath({
          ...base,
          contextMenuState: contentMenu([trashedFolder.path], trashedFolder.path),
          contextMenuTargetEntry: trashedFolder,
        }),
      ).toBeNull();
      expect(
        resolvePasteDestinationPath({
          ...base,
          contextMenuState: {
            ...contentMenu([], "/Users/demo/.Trash"),
            surface: "favorite",
            targetKind: "favorite",
          },
        }),
      ).toBeNull();
      expect(
        resolvePasteDestinationPath({ ...base, currentPath: "/Volumes/USB/.Trashes/501" }),
      ).toBeNull();
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

  it("follows a folder moved by Cut and Paste or a drag, but not one copied", () => {
    const pasted = (mode: "copy" | "cut") =>
      ({
        action: "paste",
        mode,
        targetPath: "/Users/demo/Other",
        items: [
          {
            sourcePath: "/Users/demo/Folder",
            destinationPath: "/Users/demo/Other/Folder",
            status: "completed",
            error: null,
          },
        ],
      }) as WriteOperationResult;

    expect(resolveWriteOperationRefreshPath(pasted("cut"), "/Users/demo/Folder/Inner")).toBe(
      "/Users/demo/Other/Folder/Inner",
    );
    expect(resolveWriteOperationTreeSelectionPath(pasted("cut"), "/Users/demo/Folder")).toBe(
      "/Users/demo/Other/Folder",
    );
    expect(resolveWriteOperationRefreshPath(pasted("copy"), "/Users/demo/Folder/Inner")).toBe(
      "/Users/demo/Folder/Inner",
    );
    expect(resolveWriteOperationTreeSelectionPath(pasted("copy"), "/Users/demo/Folder")).toBe(null);
  });

  it("tells what a write took out of its folder: trashed, deleted or moved elsewhere, not renamed", () => {
    const result = (
      action: WriteOperationResult["action"],
      items: Array<[string, string | null]>,
      mode?: "copy" | "cut",
    ) =>
      ({
        action,
        ...(mode ? { mode } : {}),
        targetPath: null,
        items: items.map(([sourcePath, destinationPath]) => ({
          sourcePath,
          destinationPath,
          status: "completed",
          error: null,
        })),
      }) as WriteOperationResult;

    expect(pathsLeftByWrite(result("trash", [["/a/x", null]]))).toEqual(["/a/x"]);
    expect(pathsLeftByWrite(result("delete_immediately", [["/a/x", null]]))).toEqual(["/a/x"]);
    expect(pathsLeftByWrite(result("move_to", [["/a/x", "/b/x"]]))).toEqual(["/a/x"]);
    expect(pathsLeftByWrite(result("paste", [["/a/x", "/b/x"]], "cut"))).toEqual(["/a/x"]);
    // A rename stays in its folder, and a copy leaves the original where it was.
    expect(pathsLeftByWrite(result("rename", [["/a/x", "/a/y"]]))).toEqual([]);
    expect(pathsLeftByWrite(result("paste", [["/a/x", "/b/x"]], "copy"))).toEqual([]);
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

  it("tells of a rename of several that skipped an item, even when the rest went", () => {
    const skipped = createPartialSkipEvent("runtime_conflict_resolution");
    const event = {
      ...skipped,
      action: "batch_rename",
      status: "completed",
      result: skipped.result && { ...skipped.result, action: "batch_rename", status: "completed" },
    } as WriteOperationProgressEvent;
    expect(shouldRenderCopyPasteResultDialog(event)).toBe(true);
    expect(
      shouldRenderCopyPasteResultDialog({
        ...event,
        result: event.result && {
          ...event.result,
          summary: { ...event.result.summary, skippedItemCount: 0 },
        },
      }),
    ).toBe(false);
  });
});

describe("collectFollowedMoves", () => {
  const result = (action: WriteOperationResult["action"]) =>
    ({
      action,
      items: [
        { sourcePath: "/a", destinationPath: "/b", status: "completed", error: null },
        { sourcePath: "/c", destinationPath: "/c 2", status: "failed", error: "Taken." },
        { sourcePath: "/d", destinationPath: null, status: "failed", error: "Locked." },
        { sourcePath: "/e", destinationPath: "/e", status: "completed", error: null },
      ],
    }) as WriteOperationResult;

  it("follows what was renamed, and an item of several put back under another name", () => {
    expect(collectFollowedMoves(result("batch_rename"))).toEqual([
      { from: "/a", to: "/b" },
      { from: "/c", to: "/c 2" },
    ]);
  });

  it("follows only what a move finished: a failed item stayed where it was", () => {
    expect(collectFollowedMoves(result("move_to"))).toEqual([{ from: "/a", to: "/b" }]);
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
      homePath: "/Users/demo",
      ...(options.contextScope ? { contextScope: options.contextScope } : {}),
    });

  // As in Finder: ⇧⌘N makes it in the folder on screen whatever is selected, so two in a
  // row don't nest the second inside the first (which is selected once made).
  it("makes the folder in the folder on screen from the keyboard, whatever is selected", () => {
    expect(target([])).toBe("/Users/demo");
    expect(target([folder])).toBe("/Users/demo");
    expect(target([file])).toBe("/Users/demo");
    expect(target([folder, file])).toBe("/Users/demo");
    expect(target([file, entry("more.txt", "file")])).toBe("/Users/demo");
  });

  it("makes it inside a folder from that folder's own menu, and offers nothing for a file or several items", () => {
    expect(target([folder], { contextScope: "selection" })).toBe("/Users/demo/Folder");
    expect(target([file], { contextScope: "selection" })).toBeNull();
    expect(target([folder, file], { contextScope: "selection" })).toBeNull();
    expect(target([], { contextScope: "selection" })).toBe("/Users/demo");
    // The menu opened on empty space is about the folder on screen, whatever is selected.
    expect(target([file], { contextScope: "background" })).toBe("/Users/demo");
  });

  it("makes nothing in the Trash", () => {
    expect(
      resolveNewFolderTargetPath({
        currentPath: "/Users/demo/.Trash",
        selectedEntry: null,
        selectedPaths: [],
        isSearchMode: false,
        homePath: "/Users/demo",
      }),
    ).toBeNull();
    const trashed = { ...folder, path: "/Users/demo/.Trash/Old" };
    expect(
      resolveNewFolderTargetPath({
        currentPath: "/Users/demo",
        selectedEntry: trashed,
        selectedPaths: [trashed.path],
        isSearchMode: false,
        homePath: "/Users/demo",
        contextScope: "selection",
      }),
    ).toBeNull();
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
        homePath: "/Users/demo",
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
      "“report.pdf” couldn’t be pasted because it was moved, deleted or replaced since it was copied.",
    );
    expect(formatMissingClipboardItemsMessage(["/a/one", "/a/two"])).toBe(
      "“one” and “two” couldn’t be pasted because they were moved, deleted or replaced since they were copied.",
    );
    expect(formatMissingClipboardItemsMessage(["/a/1", "/a/2", "/a/3", "/a/4"])).toBe(
      "4 items couldn’t be pasted because they were moved, deleted or replaced since they were copied: “1”, “2”, “3” and 1 more.",
    );
    expect(formatMissingClipboardItemsMessage(["/a/one", "/a/two"], "moved")).toBe(
      "“one” and “two” couldn’t be moved because they were deleted, replaced or moved elsewhere since they were cut.",
    );
  });
  it("suggests a free New Folder name, ignoring case like the disk does", () => {
    expect(resolveFreeNewFolderName([])).toBe("untitled folder");
    expect(resolveFreeNewFolderName(["untitled folder"])).toBe("untitled folder 2");
    expect(resolveFreeNewFolderName(["Untitled Folder", "UNTITLED FOLDER 2"])).toBe(
      "untitled folder 3",
    );
    expect(resolveFreeNewFolderName(["untitled folder", "untitled folder 3"])).toBe(
      "untitled folder 2",
    );
  });
  it("explains an Empty Trash failure, and how to allow File Trail to control Finder", () => {
    expect(
      describeEmptyTrashFailure(
        "execution error: Not authorized to send Apple events to Finder. (-1743)",
      ),
    ).toEqual({
      title: "Couldn’t Empty the Trash",
      message:
        "File Trail needs permission to control Finder. Turn it on in System Settings > Privacy & Security > Automation, then try again.",
    });
    expect(
      describeEmptyTrashFailure("Finder got an error: The operation can't be completed."),
    ).toEqual({
      title: "Couldn’t Empty the Trash",
      message: "Finder got an error: The operation can't be completed.",
    });
    // A large Trash takes Finder longer than AppleScript waited before (two minutes).
    expect(
      describeEmptyTrashFailure(
        "execution error: Finder got an error: AppleEvent timed out. (-1712)",
      ).message,
    ).toBe("Finder took too long to answer. It may still be emptying the Trash.");
    expect(describeEmptyTrashFailure("execution error: User canceled. (-128)").message).toBe(
      "Emptying the Trash was stopped in Finder.",
    );
    // Only the reason: never the command that ran or the error number.
    expect(
      describeEmptyTrashFailure(
        "0:46: execution error: Finder got an error: The operation can’t be completed. (-8003)",
      ).message,
    ).toBe("Finder got an error: The operation can’t be completed.");
    expect(describeEmptyTrashFailure("  ").message).toBe(
      "Finder didn't empty the Trash. Try again, or empty it in Finder.",
    );
  });
});

describe("describeDragRefusedWhileBusy", () => {
  it("names what is running and the item it is on", () => {
    expect(describeDragRefusedWhileBusy("paste", "/Users/demo/Photos")).toBe(
      "Can't drag while “Photos” is being copied",
    );
    expect(describeDragRefusedWhileBusy("move_to", null)).toBe(
      "Can't drag while items are being moved",
    );
    expect(describeDragRefusedWhileBusy("trash", "/Users/demo/a.txt")).toBe(
      "Can't drag while “a.txt” is being moved to the Trash",
    );
    expect(describeDragRefusedWhileBusy("delete_immediately", null)).toBe(
      "Can't drag while items are being deleted",
    );
    expect(describeDragRefusedWhileBusy("rename", "/Users/demo/a.txt")).toBe(
      "Can't drag while “a.txt” is being renamed",
    );
    expect(describeDragRefusedWhileBusy("new_folder", null)).toBe(
      "Can't drag while a folder is being made",
    );
  });

  it("says a drop can't be made, for a drag from another app", () => {
    expect(describeDragRefusedWhileBusy("paste", "/Users/demo/Photos", "drop")).toBe(
      "Can't drop while “Photos” is being copied",
    );
    expect(describeDragRefusedWhileBusy("new_folder", null, "drop")).toBe(
      "Can't drop while a folder is being made",
    );
  });
});
