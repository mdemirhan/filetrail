import { canHandleExplorerKeyboardShortcuts, canHandleRendererCommand } from "./shortcutPolicy";

describe("shortcutPolicy", () => {
  it("allows explorer-scoped commands in the explorer view", () => {
    expect(
      canHandleRendererCommand("copyPath", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
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
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("copyPath", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        locationSheetOpen: false,
        mainView: "settings",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("focusFileSearch", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("openLocationSheet", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
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
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(true);
    expect(
      canHandleRendererCommand("zoomIn", {
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        locationSheetOpen: false,
        mainView: "settings",
      }),
    ).toBe(true);
  });

  it("blocks content-capturing commands while transient overlays are open", () => {
    expect(
      canHandleRendererCommand("openSelection", {
        actionNoticeOpen: false,
        copyPasteModalOpen: true,
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("copySelection", {
        actionNoticeOpen: true,
        copyPasteModalOpen: false,
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(false);
    expect(
      canHandleRendererCommand("openSettings", {
        actionNoticeOpen: true,
        copyPasteModalOpen: false,
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
        locationSheetOpen: false,
        mainView: "explorer",
      }),
    ).toBe(true);
    expect(
      canHandleExplorerKeyboardShortcuts({
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        locationSheetOpen: false,
        mainView: "help",
      }),
    ).toBe(false);
    expect(
      canHandleExplorerKeyboardShortcuts({
        actionNoticeOpen: false,
        copyPasteModalOpen: false,
        locationSheetOpen: true,
        mainView: "explorer",
      }),
    ).toBe(false);
  });
});
