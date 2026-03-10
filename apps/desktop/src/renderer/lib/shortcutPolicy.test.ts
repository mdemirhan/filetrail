import {
  RAW_EXPLORER_SHORTCUT_IDS,
  RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS,
  RENDERER_COMMAND_TREE_FOCUS_BUCKETS,
  canHandleExplorerKeyboardShortcuts,
  canHandleRawExplorerShortcut,
  canHandleRendererCommand,
  getContextMenuShortcutLabel,
  type ShortcutContext,
} from "./shortcutPolicy";
import { RENDERER_COMMAND_TYPES } from "../../shared/rendererCommands";

describe("shortcutPolicy", () => {
  function ctx(overrides: Partial<ShortcutContext> = {}): ShortcutContext {
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

  it("allows explorer-scoped commands in the explorer view", () => {
    expect(canHandleRendererCommand("copyPath", ctx())).toBe(true);
  });

  it("blocks explorer-scoped commands in help and settings views", () => {
    expect(canHandleRendererCommand("copyPath", ctx({ mainView: "help" }))).toBe(false);
    expect(canHandleRendererCommand("copyPath", ctx({ mainView: "settings" }))).toBe(false);
    expect(canHandleRendererCommand("focusFileSearch", ctx({ mainView: "help" }))).toBe(false);
    expect(canHandleRendererCommand("openLocationSheet", ctx({ mainView: "settings" }))).toBe(
      false,
    );
  });

  it("keeps settings and zoom commands available on non-explorer views", () => {
    expect(canHandleRendererCommand("openSettings", ctx({ mainView: "help" }))).toBe(true);
    expect(canHandleRendererCommand("zoomIn", ctx({ mainView: "settings" }))).toBe(true);
  });

  it("keeps generic edit commands available regardless of the active view", () => {
    expect(canHandleRendererCommand("editCopy", ctx({ focusedPane: "tree", mainView: "help" }))).toBe(
      true,
    );
    expect(
      canHandleRendererCommand(
        "editSelectAll",
        ctx({
          actionNoticeOpen: true,
          copyPasteModalOpen: true,
          focusedPane: "tree",
          locationSheetOpen: true,
          mainView: "settings",
        }),
      ),
    ).toBe(true);
  });

  it("blocks content-capturing commands while transient overlays are open", () => {
    expect(canHandleRendererCommand("openSelection", ctx({ copyPasteModalOpen: true }))).toBe(false);
    expect(canHandleRendererCommand("copySelection", ctx({ actionNoticeOpen: true }))).toBe(false);
    expect(canHandleRendererCommand("openSettings", ctx({ actionNoticeOpen: true }))).toBe(false);
  });

  it("keeps explorer keyboard shortcuts scoped to the explorer surface", () => {
    expect(canHandleExplorerKeyboardShortcuts(ctx())).toBe(true);
    expect(canHandleExplorerKeyboardShortcuts(ctx({ mainView: "help" }))).toBe(false);
    expect(canHandleExplorerKeyboardShortcuts(ctx({ locationSheetOpen: true }))).toBe(false);
  });

  it("blocks content-only renderer commands when the tree is focused", () => {
    expect(canHandleRendererCommand("newFolder", ctx({ focusedPane: "tree" }))).toBe(false);
  });

  it("keeps global renderer commands available when the tree is focused", () => {
    expect(canHandleRendererCommand("focusFileSearch", ctx({ focusedPane: "tree" }))).toBe(true);
    expect(
      canHandleRendererCommand("refreshOrApplySearchSort", ctx({ focusedPane: "tree" })),
    ).toBe(true);
  });

  it("blocks content-only raw shortcuts when the tree is focused", () => {
    expect(canHandleRawExplorerShortcut("copySelection", ctx({ focusedPane: "tree" }))).toBe(false);
    expect(canHandleRawExplorerShortcut("newFolder", ctx({ focusedPane: "tree" }))).toBe(false);
  });

  it("keeps allowed raw shortcuts available when the tree is focused", () => {
    expect(canHandleRawExplorerShortcut("treeArrowNavigation", ctx({ focusedPane: "tree" }))).toBe(
      true,
    );
    expect(canHandleRawExplorerShortcut("focusFileSearch", ctx({ focusedPane: "tree" }))).toBe(
      true,
    );
  });

  it("allows only the safe content-target commands for filesystem tree folders", () => {
    const treeFolderContext = ctx({
      focusedPane: "tree",
      selectedTreeTargetKind: "filesystemFolder",
    });

    expect(
      RENDERER_COMMAND_TYPES.filter(
        (command) =>
          RENDERER_COMMAND_TREE_FOCUS_BUCKETS[command] === "contentOnly" &&
          canHandleRendererCommand(command, treeFolderContext),
      ),
    ).toEqual(["openSelection", "openInTerminal", "copyPath"]);
    expect(
      RAW_EXPLORER_SHORTCUT_IDS.filter(
        (shortcutId) =>
          RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS[shortcutId] === "contentOnly" &&
          canHandleRawExplorerShortcut(shortcutId, treeFolderContext),
      ),
    ).toEqual(["copyPath", "openInTerminal"]);
  });

  it("allows only the safe content-target commands for favorites", () => {
    const favoriteContext = ctx({
      focusedPane: "tree",
      selectedTreeTargetKind: "favorite",
    });

    expect(
      RENDERER_COMMAND_TYPES.filter(
        (command) =>
          RENDERER_COMMAND_TREE_FOCUS_BUCKETS[command] === "contentOnly" &&
          canHandleRendererCommand(command, favoriteContext),
      ),
    ).toEqual(["openSelection", "openInTerminal", "copyPath"]);
    expect(
      RAW_EXPLORER_SHORTCUT_IDS.filter(
        (shortcutId) =>
          RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS[shortcutId] === "contentOnly" &&
          canHandleRawExplorerShortcut(shortcutId, favoriteContext),
      ),
    ).toEqual(["copyPath", "openInTerminal"]);
  });

  it("blocks content-target actions entirely for the favorites root", () => {
    const favoritesRootContext = ctx({
      focusedPane: "tree",
      selectedTreeTargetKind: "favoritesRoot",
    });

    expect(canHandleRendererCommand("openSelection", favoritesRootContext)).toBe(false);
    expect(canHandleRendererCommand("openInTerminal", favoritesRootContext)).toBe(false);
    expect(canHandleRendererCommand("copyPath", favoritesRootContext)).toBe(false);
    expect(canHandleRawExplorerShortcut("copyPath", favoritesRootContext)).toBe(false);
  });

  it("keeps the dangerous renderer-command denylist fully blocked for tree folders and favorites", () => {
    const dangerousRendererCommands = [
      "editSelection",
      "copySelection",
      "cutSelection",
      "pasteSelection",
      "moveSelection",
      "renameSelection",
      "duplicateSelection",
      "newFolder",
      "trashSelection",
    ] as const;

    for (const selectedTreeTargetKind of ["filesystemFolder", "favorite", "favoritesRoot"] as const) {
      const currentContext = ctx({
        focusedPane: "tree",
        selectedTreeTargetKind,
      });
      expect(
        dangerousRendererCommands.filter((command) => !canHandleRendererCommand(command, currentContext)),
      ).toEqual(dangerousRendererCommands);
    }
  });

  it("keeps the dangerous raw-shortcut denylist fully blocked for tree folders and favorites", () => {
    const dangerousRawShortcutIds = [
      "copySelection",
      "cutSelection",
      "pasteSelection",
      "moveSelection",
      "renameSelection",
      "duplicateSelection",
      "newFolder",
      "trashSelection",
    ] as const;

    for (const selectedTreeTargetKind of ["filesystemFolder", "favorite", "favoritesRoot"] as const) {
      const currentContext = ctx({
        focusedPane: "tree",
        selectedTreeTargetKind,
      });
      expect(
        dangerousRawShortcutIds.filter((shortcutId) => !canHandleRawExplorerShortcut(shortcutId, currentContext)),
      ).toEqual(dangerousRawShortcutIds);
    }
  });

  it("shows context-menu shortcut badges only for enabled tree-folder actions", () => {
    const treeFolderContext = ctx({
      focusedPane: "tree",
      selectedTreeTargetKind: "filesystemFolder",
    });

    expect(getContextMenuShortcutLabel("open", treeFolderContext)).toBe("⌘O");
    expect(getContextMenuShortcutLabel("showInfo", treeFolderContext)).toBe("⌘I");
    expect(getContextMenuShortcutLabel("terminal", treeFolderContext)).toBe("⌘T");
    expect(getContextMenuShortcutLabel("copyPath", treeFolderContext)).toBe("⌥⌘C");
    expect(getContextMenuShortcutLabel("copy", treeFolderContext)).toBeNull();
    expect(getContextMenuShortcutLabel("cut", treeFolderContext)).toBeNull();
    expect(getContextMenuShortcutLabel("paste", treeFolderContext)).toBeNull();
    expect(getContextMenuShortcutLabel("rename", treeFolderContext)).toBeNull();
    expect(getContextMenuShortcutLabel("trash", treeFolderContext)).toBeNull();
  });

  it("shows the same safe context-menu shortcut badges for favorites and none for favorites root", () => {
    const favoriteContext = ctx({
      focusedPane: "tree",
      selectedTreeTargetKind: "favorite",
    });
    const favoritesRootContext = ctx({
      focusedPane: "tree",
      selectedTreeTargetKind: "favoritesRoot",
    });

    expect(getContextMenuShortcutLabel("showInfo", favoriteContext)).toBe("⌘I");
    expect(getContextMenuShortcutLabel("terminal", favoriteContext)).toBe("⌘T");
    expect(getContextMenuShortcutLabel("copyPath", favoriteContext)).toBe("⌥⌘C");
    expect(getContextMenuShortcutLabel("paste", favoriteContext)).toBeNull();
    expect(getContextMenuShortcutLabel("newFolder", favoriteContext)).toBeNull();
    expect(getContextMenuShortcutLabel("showInfo", favoritesRootContext)).toBe("⌘I");
    expect(getContextMenuShortcutLabel("terminal", favoritesRootContext)).toBeNull();
    expect(getContextMenuShortcutLabel("copyPath", favoritesRootContext)).toBeNull();
  });

  it("keeps renderer command tree-focus buckets exhaustive", () => {
    expect(Object.keys(RENDERER_COMMAND_TREE_FOCUS_BUCKETS).sort()).toEqual(
      [...RENDERER_COMMAND_TYPES].sort(),
    );
  });

  it("keeps raw shortcut tree-focus buckets exhaustive", () => {
    expect(Object.keys(RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS).sort()).toEqual(
      [...RAW_EXPLORER_SHORTCUT_IDS].sort(),
    );
  });
});
