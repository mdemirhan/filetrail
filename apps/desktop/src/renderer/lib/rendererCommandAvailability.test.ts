import { describe, expect, it } from "vitest";

import { EMPTY_COPY_PASTE_CLIPBOARD, setCopyPasteClipboard } from "./copyPasteClipboard";
import { canRunToolbarRendererCommand, type RendererCommandAvailabilityContext } from "./rendererCommandAvailability";
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
          copyPasteClipboard: setCopyPasteClipboard("copy", ["/Users/demo/file.txt"], "2026-03-12T00:00:00.000Z"),
          pasteDestinationPath: null,
        }),
      ),
    ).toBe(false);

    expect(
      canRunToolbarRendererCommand(
        "pasteSelection",
        availabilityContext({
          copyPasteClipboard: setCopyPasteClipboard("copy", ["/Users/demo/file.txt"], "2026-03-12T00:00:00.000Z"),
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

  it("allows new folder only when the target path can be resolved", () => {
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

    expect(
      canRunToolbarRendererCommand(
        "newFolder",
        availabilityContext({
          selectedPathsInViewOrder: ["/Users/demo/file.txt", "/Users/demo/notes.md"],
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

  it("disables write-locked commands while a write operation is in flight", () => {
    const context = availabilityContext({
      writeOperationLocked: true,
      copyPasteClipboard: setCopyPasteClipboard("copy", ["/Users/demo/file.txt"], "2026-03-12T00:00:00.000Z"),
    });

    expect(canRunToolbarRendererCommand("copySelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("pasteSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("moveSelection", context)).toBe(false);
    expect(canRunToolbarRendererCommand("newFolder", context)).toBe(false);
    expect(canRunToolbarRendererCommand("copyPath", context)).toBe(false);
    expect(canRunToolbarRendererCommand("openSelection", context)).toBe(true);
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
