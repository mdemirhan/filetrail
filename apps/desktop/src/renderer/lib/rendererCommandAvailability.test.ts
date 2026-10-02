import { describe, expect, it } from "vitest";

import { EMPTY_COPY_PASTE_CLIPBOARD, setCopyPasteClipboard } from "./copyPasteClipboard";
import {
  type RendererCommandAvailabilityContext,
  canRunToolbarRendererCommand,
  resolveFavoriteTargetPath,
  resolveNewTabTargetPath,
  resolveShowInFinderPaths,
} from "./rendererCommandAvailability";
import type { ShortcutContext } from "./shortcutPolicy";

function file(path: string) {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    extension: path.split(".").at(-1) ?? "",
    kind: "file" as const,
    isHidden: false,
    isSymlink: false,
  };
}

function directory(path: string) {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    extension: "",
    kind: "directory" as const,
    isHidden: false,
    isSymlink: false,
  };
}

function shortcutContext(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
  return {
    actionNoticeOpen: false,
    copyPasteModalOpen: false,
    focusedPane: "content",
    locationSheetOpen: false,
    mainView: "explorer",
    selectedTreeTargetKind: null,
    ...overrides,
  };
}

function availabilityContext(
  overrides: Partial<RendererCommandAvailabilityContext> = {},
): RendererCommandAvailabilityContext {
  const activeContentEntries = [file("/Users/demo/file.txt"), file("/Users/demo/notes.md")];
  return {
    shortcutContext: shortcutContext(),
    currentPath: "/Users/demo",
    selectedPathsInViewOrder: ["/Users/demo/file.txt"],
    activeContentEntries,
    selectedEntry: activeContentEntries[0] ?? null,
    selectedTreeTargetPath: null,
    copyPasteClipboard: EMPTY_COPY_PASTE_CLIPBOARD,
    pasteDestinationPath: "/Users/demo",
    isSearchMode: false,
    openItemLimit: 5,
    writeOperationLocked: false,
    ...overrides,
  };
}

describe("canRunToolbarRendererCommand", () => {
  it("disables selection commands without a content selection", () => {
    const context = availabilityContext({
      selectedPathsInViewOrder: [],
      selectedEntry: null,
    });

    expect(canRunToolbarRendererCommand("openSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("editSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("copySelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("cutSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("moveSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("renameSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("duplicateSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("trashSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("copyPath", context)).toBe(false);
  });

  it("requires a ready clipboard and destination for paste", () => {
    expect(
      canRunToolbarRendererCommand(
        "pasteSelection",
        availabilityContext({
          copyPasteClipboard: EMPTY_COPY_PASTE_CLIPBOARD,
        }),
      ),
    ).toBe(false);

    expect(
      canRunToolbarRendererCommand(
        "pasteSelection",
        availabilityContext({
          copyPasteClipboard: setCopyPasteClipboard(
            "copy",
            ["/Users/demo/file.txt"],
            "2026-03-12T00:00:00.000Z",
          ),
          pasteDestinationPath: null,
        }),
      ),
    ).toBe(false);

    expect(
      canRunToolbarRendererCommand(
        "pasteSelection",
        availabilityContext({
          copyPasteClipboard: setCopyPasteClipboard(
            "copy",
            ["/Users/demo/file.txt"],
            "2026-03-12T00:00:00.000Z",
          ),
        }),
      ),
    ).toBe(true);
  });

  it("requires editable files and respects the open item limit for edit", () => {
    const textFile = file("/Users/demo/file.txt");
    const directoryEntry = directory("/Users/demo/Folder");

    expect(
      canRunToolbarRendererCommand(
        "editSelection",
        availabilityContext({
          selectedPathsInViewOrder: [textFile.path],
          activeContentEntries: [textFile],
          selectedEntry: textFile,
        }),
      ),
    ).toBe(true);

    expect(
      canRunToolbarRendererCommand(
        "editSelection",
        availabilityContext({
          selectedPathsInViewOrder: [directoryEntry.path],
          activeContentEntries: [directoryEntry],
          selectedEntry: directoryEntry,
        }),
      ),
    ).toBe(false);

    expect(
      canRunToolbarRendererCommand(
        "editSelection",
        availabilityContext({
          selectedPathsInViewOrder: ["/Users/demo/file.txt", "/Users/demo/notes.md"],
          activeContentEntries: [textFile, file("/Users/demo/notes.md")],
          selectedEntry: textFile,
          openItemLimit: 1,
        }),
      ),
    ).toBe(false);
  });

  it("requires a selected item and respects the open item limit for open", () => {
    expect(
      canRunToolbarRendererCommand(
        "openSelection",
        availabilityContext({
          selectedPathsInViewOrder: [],
          selectedEntry: null,
        }),
      ),
    ).toBe(false);

    expect(
      canRunToolbarRendererCommand(
        "openSelection",
        availabilityContext({
          selectedPathsInViewOrder: ["/Users/demo/file.txt", "/Users/demo/notes.md"],
          openItemLimit: 1,
        }),
      ),
    ).toBe(false);
  });

  it("allows tree-safe open, terminal, and copy path commands only with a tree target", () => {
    const baseTreeContext = availabilityContext({
      shortcutContext: shortcutContext({
        focusedPane: "tree",
        selectedTreeTargetKind: "filesystemFolder",
      }),
      selectedPathsInViewOrder: [],
      selectedEntry: null,
      selectedTreeTargetPath: "/Users/demo/Folder",
    });

    expect(canRunToolbarRendererCommand("openSelection", baseTreeContext)).toBe(true);
    expect(canRunToolbarRendererCommand("openInTerminal", baseTreeContext)).toBe(true);
    expect(canRunToolbarRendererCommand("copyPath", baseTreeContext)).toBe(true);

    const noTreeTargetContext = availabilityContext({
      shortcutContext: shortcutContext({
        focusedPane: "tree",
        selectedTreeTargetKind: "filesystemFolder",
      }),
      selectedPathsInViewOrder: [],
      selectedEntry: null,
      selectedTreeTargetPath: null,
    });

    expect(canRunToolbarRendererCommand("openSelection", noTreeTargetContext)).toBe(false);
    expect(canRunToolbarRendererCommand("openInTerminal", noTreeTargetContext)).toBe(false);
    expect(canRunToolbarRendererCommand("copyPath", noTreeTargetContext)).toBe(false);
  });

  it("allows open in terminal from content with no selection when a folder is open", () => {
    expect(
      canRunToolbarRendererCommand(
        "openInTerminal",
        availabilityContext({
          selectedPathsInViewOrder: [],
          selectedEntry: null,
          currentPath: "/Users/demo",
        }),
      ),
    ).toBe(true);
  });

  it("disables move, rename, duplicate, trash, and paste on search results when invalid there", () => {
    const searchContext = availabilityContext({
      isSearchMode: true,
      selectedPathsInViewOrder: ["/Users/demo/file.txt"],
      pasteDestinationPath: null,
    });

    expect(canRunToolbarRendererCommand("moveSelection", searchContext)).toBe(false);
    expect(canRunToolbarRendererCommand("renameSelection", searchContext)).toBe(false);
    expect(canRunToolbarRendererCommand("duplicateSelection", searchContext)).toBe(false);
    expect(canRunToolbarRendererCommand("newFolder", searchContext)).toBe(false);
    expect(canRunToolbarRendererCommand("trashSelection", searchContext)).toBe(false);
    expect(canRunToolbarRendererCommand("pasteSelection", searchContext)).toBe(false);
  });

  it("allows new folder whenever there is a folder to make it in", () => {
    expect(
      canRunToolbarRendererCommand(
        "newFolder",
        availabilityContext({
          selectedPathsInViewOrder: [],
          selectedEntry: null,
        }),
      ),
    ).toBe(true);

    expect(
      canRunToolbarRendererCommand(
        "newFolder",
        availabilityContext({
          selectedPathsInViewOrder: ["/Users/demo/Folder"],
          activeContentEntries: [directory("/Users/demo/Folder")],
          selectedEntry: directory("/Users/demo/Folder"),
        }),
      ),
    ).toBe(true);

    // With files selected, or several items, the folder goes into the folder on screen.
    expect(
      canRunToolbarRendererCommand(
        "newFolder",
        availabilityContext({
          selectedPathsInViewOrder: ["/Users/demo/file.txt", "/Users/demo/notes.md"],
        }),
      ),
    ).toBe(true);
    expect(
      canRunToolbarRendererCommand(
        "newFolder",
        availabilityContext({
          currentPath: "",
          selectedPathsInViewOrder: ["/Users/demo/file.txt"],
        }),
      ),
    ).toBe(false);
  });

  it("requires a single selection for rename", () => {
    expect(
      canRunToolbarRendererCommand(
        "renameSelection",
        availabilityContext({
          selectedPathsInViewOrder: ["/Users/demo/file.txt"],
        }),
      ),
    ).toBe(true);

    expect(
      canRunToolbarRendererCommand(
        "renameSelection",
        availabilityContext({
          selectedPathsInViewOrder: ["/Users/demo/file.txt", "/Users/demo/notes.md"],
        }),
      ),
    ).toBe(false);
  });

  it("disables what would start another operation while a write operation is in flight", () => {
    const context = availabilityContext({
      writeOperationLocked: true,
      copyPasteClipboard: setCopyPasteClipboard(
        "copy",
        ["/Users/demo/file.txt"],
        "2026-03-12T00:00:00.000Z",
      ),
    });

    expect(canRunToolbarRendererCommand("pasteSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("moveSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("newFolder", context)).toBe(false);
    expect(canRunToolbarRendererCommand("openSelection", context)).toBe(true);
    // Filling the clipboard starts nothing, so it is not held back.
    expect(canRunToolbarRendererCommand("copySelection", context)).toBe(true);
    expect(canRunToolbarRendererCommand("cutSelection", context)).toBe(true);
    expect(canRunToolbarRendererCommand("copyPath", context)).toBe(true);
  });

  it("still requires content focus for content-only actions", () => {
    expect(
      canRunToolbarRendererCommand(
        "copySelection",
        availabilityContext({
          shortcutContext: shortcutContext({ focusedPane: null }),
        }),
      ),
    ).toBe(false);
  });
});

describe("menu commands", () => {
  const folder = directory("/Users/demo/Projects");
  const note = file("/Users/demo/notes.md");
  const entries = [folder, note];
  const select = (...selected: Array<typeof folder | typeof note>) =>
    availabilityContext({
      activeContentEntries: entries,
      selectedPathsInViewOrder: selected.map((entry) => entry.path),
      selectedEntry: selected[0] ?? null,
    });
  const treeFocused = (selectedTreeTargetPath: string | null) =>
    availabilityContext({
      shortcutContext: shortcutContext({
        focusedPane: "tree",
        selectedTreeTargetKind: selectedTreeTargetPath ? "filesystemFolder" : null,
      }),
      activeContentEntries: entries,
      selectedPathsInViewOrder: [],
      selectedEntry: null,
      selectedTreeTargetPath,
    });

  it("opens one selected folder, or the tree's folder, in a new tab", () => {
    expect(canRunToolbarRendererCommand("openSelectionInNewTab", select(folder))).toBe(true);
    expect(canRunToolbarRendererCommand("openSelectionInNewTab", select(note))).toBe(false);
    expect(canRunToolbarRendererCommand("openSelectionInNewTab", select(folder, note))).toBe(false);
    expect(canRunToolbarRendererCommand("openSelectionInNewTab", select())).toBe(false);
    expect(canRunToolbarRendererCommand("openSelectionInNewTab", treeFocused("/Users"))).toBe(true);
    expect(canRunToolbarRendererCommand("openSelectionInNewTab", treeFocused(null))).toBe(false);
    expect(resolveNewTabTargetPath({ ...treeFocused("/Users"), focusedPane: "tree" })).toBe(
      "/Users",
    );
  });

  it("needs a selected item for Quick Look", () => {
    expect(canRunToolbarRendererCommand("quickLookSelection", select(note))).toBe(true);
    expect(canRunToolbarRendererCommand("quickLookSelection", select())).toBe(false);
    expect(canRunToolbarRendererCommand("quickLookSelection", treeFocused("/Users"))).toBe(false);
  });

  it("adds the selected folder to the favorites, or the folder on screen with nothing selected", () => {
    const target = (context: RendererCommandAvailabilityContext) =>
      resolveFavoriteTargetPath({
        ...context,
        focusedPane: context.shortcutContext.focusedPane,
      });

    expect(target(select(folder))).toBe("/Users/demo/Projects");
    expect(target(select())).toBe("/Users/demo");
    expect(target(select(note))).toBeNull();
    expect(target(select(folder, note))).toBeNull();
    expect(target(treeFocused("/Users"))).toBe("/Users");
    // Search results are not a folder, and Trash is a favorite that stays.
    expect(target({ ...select(), isSearchMode: true })).toBeNull();
    expect(target({ ...treeFocused("/Users/demo/.Trash"), trashPath: "/Users/demo/.Trash" })).toBe(
      null,
    );
    expect(canRunToolbarRendererCommand("toggleFavorite", select(folder))).toBe(true);
    expect(canRunToolbarRendererCommand("toggleFavorite", select(note))).toBe(false);
  });

  it("shows the selection in Finder, or the folder on screen with nothing selected", () => {
    const paths = (context: RendererCommandAvailabilityContext) =>
      resolveShowInFinderPaths({ ...context, focusedPane: context.shortcutContext.focusedPane });

    expect(paths(select(folder, note))).toEqual(["/Users/demo/Projects", "/Users/demo/notes.md"]);
    expect(paths(select())).toEqual(["/Users/demo"]);
    expect(paths(treeFocused("/Users"))).toEqual(["/Users"]);
    expect(canRunToolbarRendererCommand("showInFinder", select())).toBe(true);
    expect(canRunToolbarRendererCommand("showInFinder", { ...select(), currentPath: "" })).toBe(
      false,
    );
  });

  it("follows the history for Back and Forward", () => {
    expect(canRunToolbarRendererCommand("goBack", { ...select(), canGoBack: false })).toBe(false);
    expect(canRunToolbarRendererCommand("goBack", { ...select(), canGoBack: true })).toBe(true);
    expect(canRunToolbarRendererCommand("goForward", { ...select(), canGoForward: false })).toBe(
      false,
    );
    expect(canRunToolbarRendererCommand("goForward", { ...select(), canGoForward: true })).toBe(
      true,
    );
  });

  it("has no enclosing folder at the top of the disk", () => {
    expect(canRunToolbarRendererCommand("goEnclosingFolder", select())).toBe(true);
    expect(
      canRunToolbarRendererCommand("goEnclosingFolder", { ...select(), currentPath: "/" }),
    ).toBe(false);
    expect(
      canRunToolbarRendererCommand("goEnclosingFolder", { ...select(), currentPath: "" }),
    ).toBe(false);
  });

  it("leaves the order of search results to the results bar", () => {
    const searching = { ...select(), isSearchMode: true };
    for (const command of [
      "sortByName",
      "sortByModified",
      "sortBySize",
      "sortByKind",
      "toggleFoldersFirst",
    ] as const) {
      expect(canRunToolbarRendererCommand(command, select()), command).toBe(true);
      expect(canRunToolbarRendererCommand(command, searching), command).toBe(false);
    }
  });

  it("brings back the last results only when there are some and they are not on screen", () => {
    const withSearch = { ...select(), hasCachedSearch: true };

    expect(canRunToolbarRendererCommand("showLastSearchResults", withSearch)).toBe(true);
    expect(
      canRunToolbarRendererCommand("showLastSearchResults", {
        ...select(),
        hasCachedSearch: false,
      }),
    ).toBe(false);
    expect(
      canRunToolbarRendererCommand("showLastSearchResults", { ...withSearch, isSearchMode: true }),
    ).toBe(false);
  });

  it("needs a second tab to move between tabs", () => {
    expect(canRunToolbarRendererCommand("selectNextTab", { ...select(), tabCount: 1 })).toBe(false);
    expect(canRunToolbarRendererCommand("selectPreviousTab", { ...select(), tabCount: 3 })).toBe(
      true,
    );
  });

  it("opens Help from the Help page too, but not over a dialog", () => {
    const onHelp = { ...select(), shortcutContext: shortcutContext({ mainView: "help" }) };
    const overDialog = {
      ...select(),
      shortcutContext: shortcutContext({ copyPasteModalOpen: true }),
    };

    expect(canRunToolbarRendererCommand("openKeyboardShortcuts", onHelp)).toBe(true);
    expect(canRunToolbarRendererCommand("goBack", onHelp)).toBe(false);
    expect(canRunToolbarRendererCommand("openHelp", overDialog)).toBe(false);
  });
});
