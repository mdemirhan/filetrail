import type { MenuItemConstructorOptions } from "electron";

import {
  type ApplicationMenuState,
  INITIAL_APPLICATION_MENU_STATE,
} from "../shared/applicationMenuState";
import { RENDERER_COMMAND_TYPES } from "../shared/rendererCommands";
import { resolveShortcuts } from "../shared/shortcuts";
import {
  applyApplicationMenuItemStates,
  createApplicationMenuTemplate,
  resolveApplicationMenuItemStates,
} from "./appMenu";

type Template = MenuItemConstructorOptions[];

function submenuOf(template: Template, name: string): Template {
  const menu = template.find((item) => item.label === name || item.role === name);
  if (!menu || !Array.isArray(menu.submenu)) {
    throw new Error(`${name} menu missing.`);
  }
  return menu.submenu;
}

function itemOf(items: Template, label: string): MenuItemConstructorOptions {
  const item = items.find((candidate) => candidate.label === label);
  if (!item) {
    throw new Error(`${label} menu item missing.`);
  }
  return item;
}

function choose(item: MenuItemConstructorOptions, focusedWindow?: unknown): void {
  if (typeof item.click !== "function") {
    throw new Error(`${item.label} has no action.`);
  }
  item.click(undefined as never, focusedWindow as never, undefined as never);
}

// Every item of every menu, submenus included.
function flatten(items: Template): Template {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}

function labels(items: Template): string[] {
  return items.map((item) => (item.type === "separator" ? "-" : (item.label ?? `(${item.role})`)));
}

describe("createApplicationMenuTemplate", () => {
  it("lays the menus out the way a Mac app does", () => {
    const template = createApplicationMenuTemplate({ send: vi.fn() });

    expect(template.map((menu) => menu.label ?? `(${menu.role})`)).toEqual([
      "File Trail",
      "File",
      "Edit",
      "View",
      "Go",
      "(windowMenu)",
      "(help)",
    ]);
    expect(labels(submenuOf(template, "File Trail"))).toEqual([
      "About File Trail",
      "-",
      "Settings…",
      "-",
      "(services)",
      "-",
      "Hide File Trail",
      "(hideOthers)",
      "(unhide)",
      "-",
      "Quit File Trail",
    ]);
    expect(labels(submenuOf(template, "File"))).toEqual([
      "New Tab",
      "New Folder",
      "-",
      "Open",
      "Open in New Tab",
      "Edit in Text Editor",
      "Quick Look",
      "-",
      "Rename",
      "Duplicate",
      "Move To…",
      "Add to Favorites",
      "Remove from Favorites",
      "-",
      "Open in Terminal",
      "Show in Finder",
      "-",
      "Move to Trash",
      "-",
      "Reopen Closed Tab",
      "Close Tab",
      "Close Window",
    ]);
    expect(labels(submenuOf(template, "Edit"))).toEqual([
      "(undo)",
      "(redo)",
      "-",
      "Cut",
      "Copy",
      "Paste",
      "Copy Path",
      "Select All",
      "-",
      "Show Clipboard",
      "Clear Clipboard",
      "-",
      "Find Files…",
      "Show Last Results",
    ]);
    expect(labels(submenuOf(template, "View"))).toEqual([
      "as Icons",
      "as List",
      "as Details",
      "-",
      "Sort By",
      "Folders First",
      "Hidden Files",
      "-",
      "Info Panel",
      "Info Row",
      "-",
      "Customize Toolbar…",
      "-",
      "Refresh",
      "-",
      "Zoom In",
      "Zoom Out",
      "Actual Size",
      "-",
      "Enter Full Screen",
      "Exit Full Screen",
    ]);
    expect(labels(submenuOf(template, "Go"))).toEqual([
      "Back",
      "Forward",
      "Enclosing Folder",
      "-",
      "Home",
      "Go To…",
      "-",
      "Root Tree at Selected Folder",
    ]);
    expect(labels(submenuOf(template, "windowMenu"))).toEqual([
      "(minimize)",
      "(zoom)",
      "-",
      "Show Previous Tab",
      "Show Next Tab",
      "-",
      "Focus Folder Tree",
      "Focus File List",
      "-",
      "(front)",
    ]);
    expect(labels(submenuOf(template, "help"))).toEqual(["File Trail Help", "Keyboard Shortcuts"]);
  });

  it("names the app itself rather than its package", () => {
    const appMenu = submenuOf(createApplicationMenuTemplate({ send: vi.fn() }), "File Trail");

    expect(itemOf(appMenu, "About File Trail").role).toBe("about");
    expect(itemOf(appMenu, "Hide File Trail").role).toBe("hide");
    expect(itemOf(appMenu, "Quit File Trail").role).toBe("quit");
  });

  it("opens the app's own About window in place of the standard panel", () => {
    const onOpenAbout = vi.fn();
    const appMenu = submenuOf(
      createApplicationMenuTemplate({ send: vi.fn() }, { onOpenAbout }),
      "File Trail",
    );
    const about = itemOf(appMenu, "About File Trail");

    expect(about.role).toBeUndefined();
    about.click?.({} as never, undefined, {} as never);
    expect(onOpenAbout).toHaveBeenCalledTimes(1);
  });

  it("sends each item's command to the explorer window, on its shortcut", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send });
    const expected = [
      ["File", "New Tab", "Command+T", "newTab"],
      ["File", "New Folder", "Command+Shift+N", "newFolder"],
      ["File", "Open", "Command+O", "openSelection"],
      ["File", "Open in New Tab", undefined, "openSelectionInNewTab"],
      ["File", "Edit in Text Editor", "Command+E", "editSelection"],
      ["File", "Quick Look", undefined, "quickLookSelection"],
      // Space and F2 work from the window itself: as menu shortcuts they would be taken
      // from text fields and dialogs.
      ["File", "Rename", undefined, "renameSelection"],
      ["File", "Duplicate", "Command+D", "duplicateSelection"],
      ["File", "Move To…", "Command+Shift+M", "moveSelection"],
      ["File", "Add to Favorites", undefined, "toggleFavorite"],
      ["File", "Remove from Favorites", undefined, "toggleFavorite"],
      ["File", "Open in Terminal", "Command+Alt+T", "openInTerminal"],
      ["File", "Show in Finder", undefined, "showInFinder"],
      ["File", "Move to Trash", "Command+Backspace", "trashSelection"],
      ["File", "Reopen Closed Tab", "Command+Shift+T", "reopenClosedTab"],
      ["File", "Close Tab", "Command+W", "closeTab"],
      ["Edit", "Cut", "Command+X", "editCut"],
      ["Edit", "Copy", "Command+C", "editCopy"],
      ["Edit", "Paste", "Command+V", "editPaste"],
      ["Edit", "Copy Path", "Command+Alt+C", "copyPath"],
      ["Edit", "Select All", "Command+A", "editSelectAll"],
      ["Edit", "Find Files…", "Command+F", "focusFileSearch"],
      ["Edit", "Show Last Results", "Command+Shift+F", "showLastSearchResults"],
      ["View", "as Icons", undefined, "viewAsIcons"],
      ["View", "as List", undefined, "viewAsList"],
      ["View", "as Details", undefined, "viewAsDetails"],
      ["View", "Folders First", undefined, "toggleFoldersFirst"],
      ["View", "Hidden Files", "Command+Shift+.", "toggleHiddenFiles"],
      ["View", "Info Panel", "Command+I", "toggleInfoPanel"],
      ["View", "Info Row", "Command+Shift+I", "toggleInfoRow"],
      ["View", "Refresh", "Command+R", "refreshOrApplySearchSort"],
      ["View", "Zoom In", "Command+Plus", "zoomIn"],
      ["View", "Zoom Out", "Command+-", "zoomOut"],
      ["View", "Actual Size", "Command+0", "resetZoom"],
      ["Go", "Back", "Command+[", "goBack"],
      ["Go", "Forward", "Command+]", "goForward"],
      ["Go", "Enclosing Folder", "Command+Up", "goEnclosingFolder"],
      ["Go", "Home", "Command+Shift+H", "goHomeRootTree"],
      ["Go", "Go To…", "Command+K", "openLocationSheet"],
      ["Go", "Root Tree at Selected Folder", "Command+Shift+R", "rootTreeAtSelection"],
      ["windowMenu", "Show Previous Tab", "Control+Shift+Tab", "selectPreviousTab"],
      ["windowMenu", "Show Next Tab", "Control+Tab", "selectNextTab"],
      ["windowMenu", "Focus Folder Tree", "Command+1", "focusTreePane"],
      ["windowMenu", "Focus File List", "Command+2", "focusContentPane"],
      ["help", "File Trail Help", undefined, "openHelp"],
      ["help", "Keyboard Shortcuts", undefined, "openKeyboardShortcuts"],
    ] as const;

    for (const [menu, label, accelerator, type] of expected) {
      const item = itemOf(submenuOf(template, menu), label);
      expect(item.accelerator, label).toBe(accelerator);
      send.mockClear();
      choose(item);
      expect(send, label).toHaveBeenCalledWith("filetrail:command", { type });
    }
  });

  it("sorts from the Sort By submenu", () => {
    const send = vi.fn();
    const sortBy = itemOf(
      submenuOf(createApplicationMenuTemplate({ send }), "View"),
      "Sort By",
    ).submenu;
    if (!Array.isArray(sortBy)) {
      throw new Error("Sort By has no submenu.");
    }
    const expected = [
      ["Name", "sortByName"],
      ["Date Modified", "sortByModified"],
      ["Size", "sortBySize"],
      ["Kind", "sortByKind"],
    ] as const;

    expect(labels(sortBy)).toEqual(expected.map(([label]) => label));
    for (const [label, type] of expected) {
      const item = itemOf(sortBy, label);
      expect(item.type).toBe("radio");
      choose(item);
      expect(send).toHaveBeenCalledWith("filetrail:command", { type });
    }
  });

  it("gives every item that sends a command an id of its own", () => {
    const items = flatten(createApplicationMenuTemplate({ send: vi.fn() }));
    const ids = items.flatMap((item) => (item.id ? [item.id] : []));

    expect(new Set(ids).size).toBe(ids.length);
    for (const item of items) {
      if (typeof item.click === "function" && item.label !== "Settings…") {
        expect(item.id, item.label).toBeTruthy();
      }
    }
  });

  it("keeps Developer Tools out of the menu unless the host asks for them", () => {
    const viewLabels = (includeDeveloperTools: boolean) =>
      labels(
        submenuOf(
          createApplicationMenuTemplate({ send: vi.fn() }, { includeDeveloperTools }),
          "View",
        ),
      );

    expect(viewLabels(false)).not.toContain("(toggleDevTools)");
    expect(viewLabels(true).slice(-2)).toEqual(["-", "(toggleDevTools)"]);
  });

  it("applies edit commands natively in another focused window instead of the explorer", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send });
    const settingsContents = { cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn() };

    choose(itemOf(submenuOf(template, "Edit"), "Copy"), { webContents: settingsContents });

    expect(settingsContents.copy).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("closes another focused window with ⌘W instead of a tab of the explorer", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send });
    const close = vi.fn();

    choose(itemOf(submenuOf(template, "File"), "Close Tab"), { webContents: {}, close });

    expect(close).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves the explorer alone when another window is focused", () => {
    const send = vi.fn();
    const template = createApplicationMenuTemplate({ send });

    choose(itemOf(submenuOf(template, "Go"), "Back"), { webContents: {} });

    expect(send).not.toHaveBeenCalled();
  });

  it("opens the Settings window directly when the host provides it", () => {
    const send = vi.fn();
    const onOpenSettings = vi.fn();
    const settingsItem = itemOf(
      submenuOf(createApplicationMenuTemplate({ send }, { onOpenSettings }), "File Trail"),
      "Settings…",
    );

    expect(settingsItem.accelerator).toBe("Command+,");
    choose(settingsItem);

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the keys chosen in Settings, and leaves a key without ⌘ or ⌃ to the window", () => {
    const { bindings } = resolveShortcuts({
      newTab: ["Cmd+Option+N"],
      duplicateSelection: [],
      quickLookSelection: ["Space", "Cmd+Y"],
      showInFinder: ["F5", "Ctrl+Shift+R"],
    });
    const template = createApplicationMenuTemplate({ send: vi.fn() }, { shortcuts: bindings });
    const file = submenuOf(template, "File");

    expect(itemOf(file, "New Tab").accelerator).toBe("Command+Alt+N");
    expect(itemOf(file, "Duplicate").accelerator).toBeUndefined();
    // The menu takes the first key it can listen for; Space and F5 stay with the window.
    expect(itemOf(file, "Quick Look").accelerator).toBe("Command+Y");
    expect(itemOf(file, "Show in Finder").accelerator).toBe("Control+Shift+R");
    // Commands that were left alone keep their keys, and Copy is never changed.
    expect(itemOf(file, "New Folder").accelerator).toBe("Command+Shift+N");
    expect(itemOf(submenuOf(template, "Edit"), "Copy").accelerator).toBe("Command+C");
  });

  it("opens Help's window from any window, on the Keyboard Shortcuts page for that item", () => {
    const send = vi.fn();
    const onOpenHelp = vi.fn();
    const template = createApplicationMenuTemplate({ send }, { onOpenHelp });
    const help = submenuOf(template, "help");
    const settingsWindow = { webContents: { copy: vi.fn() } };

    choose(itemOf(help, "File Trail Help"), settingsWindow);
    choose(itemOf(help, "Keyboard Shortcuts"));

    expect(onOpenHelp.mock.calls).toEqual([[undefined], ["shortcuts"]]);
    expect(send).not.toHaveBeenCalled();
  });

  it("tells the host after each command, so it can put the checkmarks back", () => {
    const onCommandSent = vi.fn();
    const template = createApplicationMenuTemplate({ send: vi.fn() }, { onCommandSent });

    choose(itemOf(submenuOf(template, "View"), "Hidden Files"));

    expect(onCommandSent).toHaveBeenCalledTimes(1);
  });
});

describe("resolveApplicationMenuItemStates", () => {
  const explorerWindow = { explorerFocused: true, fullScreen: false };
  const stateOf = (id: string, state: ApplicationMenuState, window = explorerWindow) => {
    const item = resolveApplicationMenuItemStates(state, window).find(
      (candidate) => candidate.id === id,
    );
    if (!item) {
      throw new Error(`No state for ${id}.`);
    }
    return item;
  };

  it("has a state for every item of the menu that sends a command", () => {
    const stateIds = new Set(
      resolveApplicationMenuItemStates(INITIAL_APPLICATION_MENU_STATE, explorerWindow).map(
        (item) => item.id,
      ),
    );
    const menuIds = flatten(createApplicationMenuTemplate({ send: vi.fn() })).flatMap((item) =>
      item.id ? [item.id] : [],
    );

    expect(menuIds.length).toBeGreaterThan(40);
    for (const id of menuIds) {
      expect(stateIds.has(id), id).toBe(true);
    }
  });

  it("dims the commands the window says can not run", () => {
    const state: ApplicationMenuState = {
      ...INITIAL_APPLICATION_MENU_STATE,
      disabledCommands: ["renameSelection", "goBack", "toggleFavorite"],
    };

    expect(stateOf("renameSelection", state).enabled).toBe(false);
    expect(stateOf("goBack", state).enabled).toBe(false);
    expect(stateOf("toggleFavorite:add", state).enabled).toBe(false);
    expect(stateOf("toggleFavorite:remove", state).enabled).toBe(false);
    expect(stateOf("goForward", state).enabled).toBe(true);
    expect(stateOf("newTab", state).enabled).toBe(true);
  });

  it("checks what the window shows", () => {
    const state: ApplicationMenuState = {
      ...INITIAL_APPLICATION_MENU_STATE,
      viewMode: "details",
      sortBy: "size",
      foldersFirst: false,
      hiddenFilesShown: true,
      infoPanelOpen: true,
      infoRowOpen: false,
    };
    const checked = Object.fromEntries(
      resolveApplicationMenuItemStates(state, explorerWindow)
        .filter((item) => item.checked !== undefined)
        .map((item) => [item.id, item.checked]),
    );

    expect(checked).toEqual({
      viewAsIcons: false,
      viewAsList: false,
      viewAsDetails: true,
      sortByName: false,
      sortByModified: false,
      sortBySize: true,
      sortByKind: false,
      toggleFoldersFirst: false,
      toggleHiddenFiles: true,
      toggleInfoPanel: true,
      toggleInfoRow: false,
    });
  });

  it("offers to add the folder to the favorites, or to remove it once it is one", () => {
    const added = { ...INITIAL_APPLICATION_MENU_STATE, favoriteIsSet: true };

    expect(stateOf("toggleFavorite:add", INITIAL_APPLICATION_MENU_STATE).visible).toBe(true);
    expect(stateOf("toggleFavorite:remove", INITIAL_APPLICATION_MENU_STATE).visible).toBe(false);
    expect(stateOf("toggleFavorite:add", added).visible).toBe(false);
    expect(stateOf("toggleFavorite:remove", added).visible).toBe(true);
  });

  it("names the full screen item for what choosing it does", () => {
    const fullScreen = { explorerFocused: true, fullScreen: true };

    expect(stateOf("fullScreen:enter", INITIAL_APPLICATION_MENU_STATE).visible).toBe(true);
    expect(stateOf("fullScreen:exit", INITIAL_APPLICATION_MENU_STATE).visible).toBe(false);
    expect(stateOf("fullScreen:enter", INITIAL_APPLICATION_MENU_STATE, fullScreen).visible).toBe(
      false,
    );
    expect(stateOf("fullScreen:exit", INITIAL_APPLICATION_MENU_STATE, fullScreen).visible).toBe(
      true,
    );
  });

  it("keeps only the edit commands and ⌘W while another window has the keyboard", () => {
    const settingsFocused = { explorerFocused: false, fullScreen: false };
    const enabled = RENDERER_COMMAND_TYPES.filter(
      (type) =>
        type !== "toggleFavorite" &&
        stateOf(type, INITIAL_APPLICATION_MENU_STATE, settingsFocused).enabled,
    );

    expect(enabled).toEqual(["editCut", "editCopy", "editPaste", "editSelectAll", "closeTab"]);
    expect(
      stateOf("toggleFavorite:add", INITIAL_APPLICATION_MENU_STATE, settingsFocused).enabled,
    ).toBe(false);
  });
});

describe("applyApplicationMenuItemStates", () => {
  function fakeMenu(items: Record<string, { type?: string; [key: string]: unknown }>) {
    return {
      getMenuItemById: (id: string) => (items[id] ?? null) as never,
    };
  }

  it("sets what changed and skips items the menu does not have", () => {
    const rename = { enabled: true, visible: true, checked: false };
    const hidden = { enabled: true, visible: true, checked: false, type: "checkbox" };

    applyApplicationMenuItemStates(
      fakeMenu({ renameSelection: rename, toggleHiddenFiles: hidden }),
      [
        { id: "renameSelection", enabled: false },
        { id: "toggleHiddenFiles", enabled: true, checked: true },
        { id: "copySelection", enabled: false },
      ],
    );

    expect(rename).toEqual({ enabled: false, visible: true, checked: false });
    expect(hidden).toMatchObject({ enabled: true, checked: true });
  });

  it("only ever switches a radio item on", () => {
    const list = { enabled: true, visible: true, checked: true, type: "radio" };
    const details = { enabled: true, visible: true, checked: false, type: "radio" };

    applyApplicationMenuItemStates(fakeMenu({ viewAsList: list, viewAsDetails: details }), [
      { id: "viewAsList", checked: false },
      { id: "viewAsDetails", checked: true },
    ]);

    // Electron switches the rest of the group off when one is switched on.
    expect(list.checked).toBe(true);
    expect(details.checked).toBe(true);
  });
});
