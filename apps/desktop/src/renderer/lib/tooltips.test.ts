import { resolveShortcuts } from "../../shared/shortcuts";
import { TOOLBAR_ITEM_DEFINITIONS, type ToolbarItemId } from "../../shared/toolbarItems";
import { listShortcuts } from "./helpContent";
import { DEFAULT_SHORTCUT_DISPLAY, createShortcutDisplay } from "./shortcutDisplay";
import { formatShortcut } from "./shortcutLabels";
import { formatTooltip, getToolbarItemLabel, getToolbarItemTooltip } from "./tooltips";

describe("tooltips", () => {
  it("writes a command's name and then its shortcut as symbols", () => {
    expect(formatTooltip("Move to Trash", "Cmd+Backspace")).toBe("Move to Trash (⌘⌫)");
    expect(formatTooltip("Close Search Results", "Esc")).toBe("Close Search Results (Esc)");
    expect(formatTooltip("Home")).toBe("Home");
  });

  it("writes shortcuts in the order macOS does", () => {
    expect(formatShortcut("Cmd+Shift+.")).toBe("⇧⌘.");
    expect(formatShortcut("Cmd+Option+T")).toBe("⌥⌘T");
    expect(formatShortcut("Ctrl+Cmd+F")).toBe("⌃⌘F");
    expect(formatShortcut("Cmd++")).toBe("⌘+");
    expect(formatShortcut("Return")).toBe("↩");
  });

  it("names toolbar buttons as the menus name their commands", () => {
    const tooltips = Object.fromEntries(
      TOOLBAR_ITEM_DEFINITIONS.filter((item) => item.kind === "button").map((item) => [
        item.id,
        getToolbarItemTooltip(item.id),
      ]),
    );

    expect(tooltips).toEqual({
      back: "Back (⌘[)",
      forward: "Forward (⌘])",
      up: "Enclosing Folder (⌘↑)",
      refresh: "Refresh (⌘R)",
      goToFolder: "Go To (⌘K)",
      newTab: "New Tab (⌘T)",
      openSelection: "Open (⌘O)",
      quickLook: "Quick Look (Space)",
      editSelection: "Edit in Text Editor (⇧⌘E)",
      moveSelection: "Move To (⇧⌘M)",
      renameSelection: "Rename (↩)",
      duplicateSelection: "Duplicate (⌘D)",
      newFolder: "New Folder (⇧⌘N)",
      trashSelection: "Move to Trash (⌘⌫)",
      copySelection: "Copy (⌘C)",
      cutSelection: "Cut (⌘X)",
      pasteSelection: "Paste (⌘V)",
      openInTerminal: "Open in Terminal (⌥⌘T)",
      // No key until one is chosen in Settings.
      showInFinder: "Show in Finder",
      revealInFolder: "Reveal in Folder",
      calculateSize: "Calculate Size",
      copyPath: "Copy Path (⌥⌘C)",
      settings: "Settings (⌘,)",
      help: "File Trail Help (?)",
    });
  });

  it("says what a click on an on/off button will do", () => {
    const off = {
      foldersFirst: false,
      hiddenFilesShown: false,
      infoPanelOpen: false,
      infoRowOpen: false,
    };
    const on = {
      foldersFirst: true,
      hiddenFilesShown: true,
      infoPanelOpen: true,
      infoRowOpen: true,
    };
    const both = (itemId: ToolbarItemId) => [
      getToolbarItemTooltip(itemId, off),
      getToolbarItemTooltip(itemId, on),
    ];

    expect(both("hidden")).toEqual(["Show Hidden Files (⇧⌘.)", "Hide Hidden Files (⇧⌘.)"]);
    expect(both("infoPanel")).toEqual(["Show Info Panel (⌘I)", "Hide Info Panel (⌘I)"]);
    expect(both("infoRow")).toEqual(["Show Info Row (⇧⌘I)", "Hide Info Row (⇧⌘I)"]);
    expect(both("foldersFirst")).toEqual(["List Folders First", "Mix Files and Folders"]);
  });

  it("names the text editor in Edit, as the menus do", () => {
    expect(getToolbarItemLabel("editSelection", { textEditorName: "Zed" })).toBe("Edit in Zed");
    expect(getToolbarItemLabel("editSelection", {})).toBe("Edit in Text Editor");
  });

  it("promises no shortcut that Help does not list", () => {
    const documented = new Set(listShortcuts().map((item) => formatShortcut(item.shortcut)));

    for (const item of TOOLBAR_ITEM_DEFINITIONS) {
      if ("shortcutCommand" in item) {
        const shortcut = DEFAULT_SHORTCUT_DISPLAY.label(item.shortcutCommand);
        expect(
          shortcut === null || documented.has(shortcut),
          `${item.label}: ${shortcut} is missing from Help`,
        ).toBe(true);
      }
    }
  });

  it("shows the keys chosen in Settings, and none for a command left without one", () => {
    const shortcuts = createShortcutDisplay(
      resolveShortcuts({
        trashSelection: ["Cmd+Delete"],
        refreshOrApplySearchSort: [],
        toggleFoldersFirst: ["Cmd+Option+F"],
      }),
      { returnKeyAction: "open" },
    );
    const tooltip = (itemId: ToolbarItemId) => getToolbarItemTooltip(itemId, {}, shortcuts);

    expect(tooltip("trashSelection")).toBe("Move to Trash (⌘⌦)");
    expect(tooltip("refresh")).toBe("Refresh");
    expect(tooltip("foldersFirst")).toBe("List Folders First (⌥⌘F)");
    // Return opens, so Rename is left with the key it was given.
    expect(tooltip("renameSelection")).toBe("Rename (F2)");
    expect(tooltip("copySelection")).toBe("Copy (⌘C)");
  });
});
