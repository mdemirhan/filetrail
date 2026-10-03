import type { Menu, MenuItemConstructorOptions, WebContents } from "electron";

import type { ApplicationMenuState } from "../shared/applicationMenuState";
import { RENDERER_COMMAND_TYPES, type RendererCommandType } from "../shared/rendererCommands";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  type ShortcutBindings,
  type ShortcutCommandId,
  getMenuShortcut,
  isShortcutCommandId,
  toMenuAccelerator,
} from "../shared/shortcuts";

type NativeEditTarget = Pick<WebContents, "cut" | "copy" | "paste" | "selectAll">;

const NATIVE_EDIT_COMMANDS: Partial<Record<RendererCommandType, keyof NativeEditTarget>> = {
  editCut: "cut",
  editCopy: "copy",
  editPaste: "paste",
  editSelectAll: "selectAll",
};

// Written out in the menu: the name Electron would use is the package's
// ("@filetrail/desktop"), which also names the folder the settings are kept in.
export const APP_MENU_NAME = "File Trail";

// The commands that still do something while a window other than the explorer (Settings)
// has the keyboard: the edit commands act on its text field, and ⌘W closes it.
const COMMANDS_FOR_ANY_WINDOW = new Set<RendererCommandType>([
  "editCut",
  "editCopy",
  "editPaste",
  "editSelectAll",
  "closeTab",
]);

// Add to Favorites and Remove from Favorites are two items; one shows at a time.
const FAVORITE_ADD_ITEM_ID = "toggleFavorite:add";
const FAVORITE_REMOVE_ITEM_ID = "toggleFavorite:remove";
const ENTER_FULL_SCREEN_ITEM_ID = "fullScreen:enter";
const EXIT_FULL_SCREEN_ITEM_ID = "fullScreen:exit";

// The native menu emits high-level renderer commands; the renderer owns the actual UI
// transitions so shortcuts, toolbar buttons, and menu items stay behaviorally aligned.
// An item that sends a command carries the command as its id, which is how
// `resolveApplicationMenuItemStates` finds it.
export function createApplicationMenuTemplate(
  webContents: Pick<WebContents, "send">,
  options: {
    // About and Settings are windows of their own; main opens them when provided.
    onOpenAbout?: () => void;
    onOpenSettings?: () => void;
    // Help is a window too, opened from whichever window has the focus; the Keyboard
    // Shortcuts item opens it on that page.
    onOpenHelp?: (topic?: "shortcuts") => void;
    // Developer Tools belong to development builds.
    includeDeveloperTools?: boolean;
    // Called after an item has sent its command. macOS flips a checkmark or moves a radio
    // mark on its own when the item is chosen; the host uses this to put back what the
    // window last reported, so the marks only ever show what is really on.
    onCommandSent?: () => void;
    // The keys of every command, as chosen in Settings → Shortcuts.
    shortcuts?: ShortcutBindings;
  } = {},
): MenuItemConstructorOptions[] {
  const sendCommand = (type: RendererCommandType, focusedWindow?: unknown) => {
    if ((type === "openHelp" || type === "openKeyboardShortcuts") && options.onOpenHelp) {
      options.onOpenHelp(type === "openKeyboardShortcuts" ? "shortcuts" : undefined);
      return;
    }
    // The menu is shared by every window. When another window (Settings) is focused, edit
    // commands act on its focused text field natively and explorer commands do not apply.
    const focused = focusedWindow as
      | { webContents?: NativeEditTarget; close?: () => void }
      | undefined;
    const focusedContents = focused?.webContents;
    if (focusedContents && (focusedContents as unknown) !== webContents) {
      const nativeEdit = NATIVE_EDIT_COMMANDS[type];
      if (nativeEdit) {
        focusedContents[nativeEdit]();
      }
      // Only the explorer has tabs; ⌘W in any other window closes that window.
      if (type === "closeTab") {
        focused?.close?.();
      }
      return;
    }
    webContents.send("filetrail:command", { type });
  };

  const shortcuts = options.shortcuts ?? DEFAULT_SHORTCUT_BINDINGS;
  // The menu shows and listens for a command's first key that has ⌘ or ⌃. A key without
  // either (Space for Quick Look, F2 for Rename) is handled by the window: as a menu key
  // it would be taken from text fields and dialogs.
  const acceleratorOf = (id: ShortcutCommandId): string | undefined => {
    const shortcut = getMenuShortcut(shortcuts[id]);
    return shortcut ? toMenuAccelerator(shortcut) : undefined;
  };
  const command = (
    type: RendererCommandType,
    label: string,
    extra: Pick<MenuItemConstructorOptions, "id" | "type" | "visible" | "accelerator"> = {},
  ): MenuItemConstructorOptions => {
    const accelerator = isShortcutCommandId(type) ? acceleratorOf(type) : undefined;
    return {
      id: type,
      label,
      ...(accelerator ? { accelerator } : {}),
      ...extra,
      click: (_item, window) => {
        sendCommand(type, window);
        options.onCommandSent?.();
      },
    };
  };
  // A command the app never rebinds: the key is shared with text fields, or is macOS's.
  const fixedAccelerator = (id: ShortcutCommandId): string =>
    toMenuAccelerator(DEFAULT_SHORTCUT_BINDINGS[id][0] ?? "") ?? "";
  const separator: MenuItemConstructorOptions = { type: "separator" };

  return [
    {
      label: APP_MENU_NAME,
      submenu: [
        options.onOpenAbout
          ? { label: `About ${APP_MENU_NAME}`, click: options.onOpenAbout }
          : { role: "about", label: `About ${APP_MENU_NAME}` },
        separator,
        {
          label: "Settings…",
          accelerator: fixedAccelerator("settings"),
          click: () =>
            options.onOpenSettings ? options.onOpenSettings() : sendCommand("openSettings"),
        },
        separator,
        { role: "services" },
        separator,
        { role: "hide", label: `Hide ${APP_MENU_NAME}` },
        { role: "hideOthers" },
        { role: "unhide" },
        separator,
        { role: "quit", label: `Quit ${APP_MENU_NAME}` },
      ],
    },
    {
      label: "File",
      submenu: [
        command("newTab", "New Tab"),
        command("newFolder", "New Folder"),
        separator,
        command("openSelection", "Open"),
        command("openSelectionInNewTab", "Open in New Tab"),
        command("editSelection", "Edit in Text Editor"),
        command("quickLookSelection", "Quick Look"),
        separator,
        command("renameSelection", "Rename"),
        command("duplicateSelection", "Duplicate"),
        command("moveSelection", "Move To…"),
        command("toggleFavorite", "Add to Favorites", { id: FAVORITE_ADD_ITEM_ID }),
        command("toggleFavorite", "Remove from Favorites", {
          id: FAVORITE_REMOVE_ITEM_ID,
          visible: false,
        }),
        separator,
        command("openInTerminal", "Open in Terminal"),
        command("showInFinder", "Show in Finder"),
        separator,
        command("trashSelection", "Move to Trash"),
        separator,
        command("reopenClosedTab", "Reopen Closed Tab"),
        // Closes the window when it has a single view.
        command("closeTab", "Close Tab"),
        { role: "close", label: "Close Window", accelerator: fixedAccelerator("closeWindow") },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        separator,
        command("editCut", "Cut", { accelerator: fixedAccelerator("cut") }),
        command("editCopy", "Copy", { accelerator: fixedAccelerator("copy") }),
        command("editPaste", "Paste", { accelerator: fixedAccelerator("paste") }),
        command("copyPath", "Copy Path"),
        command("editSelectAll", "Select All", { accelerator: fixedAccelerator("selectAll") }),
        separator,
        command("showClipboard", "Show Clipboard"),
        command("clearClipboard", "Clear Clipboard"),
        separator,
        command("focusFileSearch", "Find Files…"),
        command("showLastSearchResults", "Show Last Results"),
      ],
    },
    {
      label: "View",
      submenu: [
        command("viewAsIcons", "as Icons", { type: "radio" }),
        command("viewAsList", "as List", { type: "radio" }),
        command("viewAsDetails", "as Details", { type: "radio" }),
        separator,
        {
          label: "Sort By",
          submenu: [
            command("sortByName", "Name", { type: "radio" }),
            command("sortByModified", "Date Modified", { type: "radio" }),
            command("sortBySize", "Size", { type: "radio" }),
            command("sortByKind", "Kind", { type: "radio" }),
          ],
        },
        command("toggleFoldersFirst", "Folders First", { type: "checkbox" }),
        command("toggleHiddenFiles", "Hidden Files", {
          type: "checkbox",
        }),
        separator,
        command("toggleInfoPanel", "Info Panel", { type: "checkbox" }),
        command("toggleInfoRow", "Info Row", {
          type: "checkbox",
        }),
        separator,
        command("customizeToolbar", "Customize Toolbar…"),
        separator,
        command("refreshOrApplySearchSort", "Refresh"),
        separator,
        command("zoomIn", "Zoom In"),
        command("zoomOut", "Zoom Out"),
        command("resetZoom", "Actual Size"),
        separator,
        // Electron keeps macOS from adding its own full screen item, so the menu has one.
        // The label can not change once the menu is built: two items, one shown at a time.
        { id: ENTER_FULL_SCREEN_ITEM_ID, role: "togglefullscreen", label: "Enter Full Screen" },
        {
          id: EXIT_FULL_SCREEN_ITEM_ID,
          role: "togglefullscreen",
          label: "Exit Full Screen",
          visible: false,
        },
        ...(options.includeDeveloperTools
          ? ([separator, { role: "toggleDevTools" }] satisfies MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: "Go",
      submenu: [
        command("goBack", "Back"),
        command("goForward", "Forward"),
        command("goEnclosingFolder", "Enclosing Folder"),
        separator,
        command("goHomeRootTree", "Home"),
        command("openLocationSheet", "Go To…"),
        separator,
        command("rootTreeAtSelection", "Root Tree at Selected Folder"),
      ],
    },
    {
      // The role makes this the menu macOS adds the open windows (and its own window
      // arrangement items) to.
      role: "windowMenu",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        separator,
        command("selectPreviousTab", "Show Previous Tab"),
        command("selectNextTab", "Show Next Tab"),
        separator,
        command("focusTreePane", "Focus Folder Tree"),
        command("focusContentPane", "Focus File List"),
        separator,
        { role: "front" },
      ],
    },
    {
      // The role gives the menu macOS's search field, which finds any menu item by name.
      role: "help",
      submenu: [
        command("openHelp", `${APP_MENU_NAME} Help`),
        command("openKeyboardShortcuts", "Keyboard Shortcuts"),
      ],
    },
  ];
}

export type ApplicationMenuItemState = {
  id: string;
  enabled?: boolean;
  checked?: boolean;
  visible?: boolean;
};

// What each menu item should show for the state the explorer window last reported.
export function resolveApplicationMenuItemStates(
  state: ApplicationMenuState,
  window: {
    // Whether the explorer window is the one the menu acts on (false while Settings is).
    explorerFocused: boolean;
    fullScreen: boolean;
  },
): ApplicationMenuItemState[] {
  const disabled = new Set<RendererCommandType>(state.disabledCommands);
  const isEnabled = (type: RendererCommandType) =>
    window.explorerFocused ? !disabled.has(type) : COMMANDS_FOR_ANY_WINDOW.has(type);
  const checked: Partial<Record<RendererCommandType, boolean>> = {
    viewAsIcons: state.viewMode === "icons",
    viewAsList: state.viewMode === "list",
    viewAsDetails: state.viewMode === "details",
    sortByName: state.sortBy === "name",
    sortByModified: state.sortBy === "modified",
    sortBySize: state.sortBy === "size",
    sortByKind: state.sortBy === "kind",
    toggleFoldersFirst: state.foldersFirst,
    toggleHiddenFiles: state.hiddenFilesShown,
    toggleInfoPanel: state.infoPanelOpen,
    toggleInfoRow: state.infoRowOpen,
  };

  const items: ApplicationMenuItemState[] = RENDERER_COMMAND_TYPES.filter(
    (type) => type !== "toggleFavorite",
  ).map((type) => ({
    id: type,
    enabled: isEnabled(type),
    ...(checked[type] === undefined ? {} : { checked: checked[type] }),
  }));
  items.push(
    {
      id: FAVORITE_ADD_ITEM_ID,
      enabled: isEnabled("toggleFavorite"),
      visible: !state.favoriteIsSet,
    },
    {
      id: FAVORITE_REMOVE_ITEM_ID,
      enabled: isEnabled("toggleFavorite"),
      visible: state.favoriteIsSet,
    },
    { id: ENTER_FULL_SCREEN_ITEM_ID, visible: !window.fullScreen },
    { id: EXIT_FULL_SCREEN_ITEM_ID, visible: window.fullScreen },
  );
  return items;
}

export function applyApplicationMenuItemStates(
  menu: Pick<Menu, "getMenuItemById">,
  itemStates: readonly ApplicationMenuItemState[],
): void {
  for (const itemState of itemStates) {
    const item = menu.getMenuItemById(itemState.id);
    if (!item) {
      continue;
    }
    if (itemState.enabled !== undefined && item.enabled !== itemState.enabled) {
      item.enabled = itemState.enabled;
    }
    if (itemState.visible !== undefined && item.visible !== itemState.visible) {
      item.visible = itemState.visible;
    }
    // A radio item is only ever switched on: that switches the others in its group off.
    if (
      itemState.checked !== undefined &&
      item.checked !== itemState.checked &&
      (item.type !== "radio" || itemState.checked)
    ) {
      item.checked = itemState.checked;
    }
  }
}
