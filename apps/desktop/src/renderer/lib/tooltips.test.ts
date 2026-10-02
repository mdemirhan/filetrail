import { TOOLBAR_ITEM_DEFINITIONS, type ToolbarItemId } from "../../shared/toolbarItems";
import { SHORTCUT_ITEMS } from "./helpContent";
import { formatShortcut } from "./shortcutLabels";
import { formatTooltip, getToolbarItemTooltip } from "./tooltips";

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
      down: "Open Selected Item (⌘↓)",
      refresh: "Refresh (⌘R)",
      home: "Home",
      root: "Macintosh HD",
      applications: "Applications",
      trash: "Trash",
      rerootHome: "Root Tree at Home",
      goToFolder: "Go To (⌘K)",
      help: "Help (?)",
      settings: "Settings (⌘,)",
      openSelection: "Open (⌘O)",
      editSelection: "Edit in Text Editor (⌘E)",
      moveSelection: "Move To (⇧⌘M)",
      renameSelection: "Rename (↩)",
      duplicateSelection: "Duplicate (⌘D)",
      newFolder: "New Folder (⇧⌘N)",
      trashSelection: "Move to Trash (⌘⌫)",
      copySelection: "Copy (⌘C)",
      cutSelection: "Cut (⌘X)",
      pasteSelection: "Paste (⌘V)",
      openInTerminal: "Open in Terminal (⌥⌘T)",
      copyPath: "Copy Path (⌥⌘C)",
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

  it("promises no shortcut that Help does not list", () => {
    const documented = new Set(SHORTCUT_ITEMS.map((item) => formatShortcut(item.shortcut)));

    for (const item of TOOLBAR_ITEM_DEFINITIONS) {
      if ("shortcutLabel" in item) {
        expect(
          documented.has(formatShortcut(item.shortcutLabel)),
          `${item.label}: ${item.shortcutLabel} is missing from Help`,
        ).toBe(true);
      }
    }
  });
});
