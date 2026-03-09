import {
  RAW_EXPLORER_SHORTCUT_IDS,
  RAW_EXPLORER_SHORTCUT_TREE_FOCUS_BUCKETS,
  RENDERER_COMMAND_TREE_FOCUS_BUCKETS,
  canHandleExplorerKeyboardShortcuts,
  canHandleRawExplorerShortcut,
  canHandleRendererCommand,
} from "./shortcutPolicy";
import { RENDERER_COMMAND_TYPES } from "../../shared/rendererCommands";

describe("shortcutPolicy", () => {
  it("allows explorer-scoped commands in the explorer view", () => {
    expect(
      canHandleRendererCommand("copyPath", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(true);
  });

  it("blocks explorer-scoped commands in help and settings views", () => {
    expect(
      canHandleRendererCommand("copyPath", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("copyPath", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "settings",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("focusFileSearch", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("openLocationSheet", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "settings",
      }),
    ).toBe(false);
  });

  it("keeps settings and zoom commands available on non-explorer views", () => {
    expect(
      canHandleRendererCommand("openSettings", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(true);
    expect(
      canHandleRendererCommand("zoomIn", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "settings",
      }),
    ).toBe(true);
  });

  it("keeps generic edit commands available regardless of the active view", () => {
    expect(
      canHandleRendererCommand("editCopy", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(true);
    expect(
      canHandleRendererCommand("editSelectAll", {
        actionNoticeOpen: true,
        copyPasteModalOpen: true,
        focusedPane: "tree",
        locationSheetOpen: true,
        mainView: "settings",
      }),
    ).toBe(true);
  });

  it("blocks content-capturing commands while transient overlays are open", () => {
    expect(
      canHandleRendererCommand("openSelection", {
        actionNoticeOpen: false,
        copyPasteModalOpen: true,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("copySelection", {
        actionNoticeOpen: true,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("openSettings", {
        actionNoticeOpen: true,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
  });

  it("keeps explorer keyboard shortcuts scoped to the explorer surface", () => {
    expect(
      canHandleExplorerKeyboardShortcuts({
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(true);
    expect(
      canHandleExplorerKeyboardShortcuts({
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(false);
    expect(
      canHandleExplorerKeyboardShortcuts({
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "content",
        locationSheetOpen: true,
        mainView: "explorer",
      }),
    ).toBe(false);
  });

  it("blocks content-only renderer commands when the tree is focused", () => {
    expect(
      canHandleRendererCommand("copyPath", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("newFolder", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
  });

  it("keeps global renderer commands available when the tree is focused", () => {
    expect(
      canHandleRendererCommand("focusFileSearch", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(true);
    expect(
      canHandleRendererCommand("refreshOrApplySearchSort", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(true);
  });

  it("blocks content-only raw shortcuts when the tree is focused", () => {
    expect(
      canHandleRawExplorerShortcut("copySelection", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
    expect(
      canHandleRawExplorerShortcut("newFolder", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
  });

  it("keeps allowed raw shortcuts available when the tree is focused", () => {
    expect(
      canHandleRawExplorerShortcut("treeArrowNavigation", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(true);
    expect(
      canHandleRawExplorerShortcut("focusFileSearch", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        focusedPane: "tree",
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(true);
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
