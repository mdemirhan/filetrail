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

type NativeEditTarget = Pick<WebContents, "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll">;

const NATIVE_EDIT_COMMANDS: Partial<Record<RendererCommandType, keyof NativeEditTarget>> = {
  undo: "undo",
  redo: "redo",
  editCut: "cut",
  editCopy: "copy",
  editPaste: "paste",
  editSelectAll: "selectAll",
};

// Written out in the menu: the name Electron would use is the package's
// ("@filetrail/desktop"), which also names the folder the settings are kept in.
export const APP_MENU_NAME = "File Trail";

// The commands that still do something while a window other than an explorer window
// (Settings) has the keyboard: the edit commands act on its text field, ⌘W closes it, and
// New Window opens one beside the explorer window in front (the host opens it).
const COMMANDS_FOR_ANY_WINDOW = new Set<RendererCommandType>([
  "undo",
  "redo",
  "editCut",
  "editCopy",
  "editPaste",
  "editSelectAll",
  "closeTab",
  "newWindow",
]);

// What the menu still does with no explorer window open, as Finder's does: New Window, and
// the Go menu's places, which open a window there. The host opens the window.
export const COMMANDS_WITHOUT_EXPLORER_WINDOW = new Set<RendererCommandType>([
  "newWindow",
  "goHomeRootTree",
  "goDocuments",
  "goDesktop",
  "goDownloads",
  "goLibrary",
  "goMacintoshHD",
  "goApplications",
  "goTrash",
  "openLocationSheet",
]);

// Where an explorer command goes: the explorer window that has the keyboard, or the one in
// front while another window (Settings) has it. `focused` says which of the two it is.
export type ExplorerCommandTarget = { contents: Pick<WebContents, "send">; focused: boolean };

// The explorer windows the menu sends commands to. A single web contents is the one
// explorer window there is.
export type ExplorerMenuTarget =
  | Pick<WebContents, "send">
  | { explorerFor: (focusedWindow: unknown) => ExplorerCommandTarget | null };

function toExplorerFor(
  target: ExplorerMenuTarget,
): (focusedWindow: unknown) => ExplorerCommandTarget | null {
  if ("explorerFor" in target) {
    return target.explorerFor;
  }
  return (focusedWindow) => {
    const focusedContents = (focusedWindow as { webContents?: unknown } | undefined)?.webContents;
    return { contents: target, focused: !focusedContents || focusedContents === target };
  };
}

// Add to Favorites and Remove from Favorites are two items; one shows at a time.
const FAVORITE_ADD_ITEM_ID = "toggleFavorite:add";
const FAVORITE_REMOVE_ITEM_ID = "toggleFavorite:remove";
// Hide Folder Tree and Show Folder Tree too.
const FOLDER_TREE_HIDE_ITEM_ID = "toggleFolderTree:hide";
const FOLDER_TREE_SHOW_ITEM_ID = "toggleFolderTree:show";

// The native menu emits high-level renderer commands; the renderer owns the actual UI
// transitions so shortcuts, toolbar buttons, and menu items stay behaviorally aligned.
// An item that sends a command carries the command as its id, which is how
// `resolveApplicationMenuItemStates` finds it.
export function createApplicationMenuTemplate(
  explorer: ExplorerMenuTarget,
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
    // The text editor chosen in Settings → Files, which Edit names.
    textEditorName?: string | undefined;
    // What Undo and Redo say ("Undo Move of “a.txt”"): see undoMenuLabels.
    undoLabels?: { undo: string; redo: string };
    // A command chosen with no explorer window open (COMMANDS_WITHOUT_EXPLORER_WINDOW).
    onCommandWithoutExplorerWindow?: (type: RendererCommandType) => void;
    // New Window chosen while another window (Settings) has the keyboard: the host opens it
    // beside the explorer window in front, which may not be able to take the command.
    onNewWindowFromOtherWindow?: () => void;
  } = {},
): MenuItemConstructorOptions[] {
  const explorerFor = toExplorerFor(explorer);
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
    const target = explorerFor(focusedWindow);
    if (!target && COMMANDS_WITHOUT_EXPLORER_WINDOW.has(type)) {
      options.onCommandWithoutExplorerWindow?.(type);
      return;
    }
    if (focusedContents && !target?.focused) {
      const nativeEdit = NATIVE_EDIT_COMMANDS[type];
      if (nativeEdit) {
        focusedContents[nativeEdit]();
      }
      // Only the explorer has tabs; ⌘W in any other window closes that window.
      if (type === "closeTab") {
        focused?.close?.();
      }
      if (type === "newWindow") {
        options.onNewWindowFromOtherWindow?.();
      }
      return;
    }
    target?.contents.send("filetrail:command", { type });
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
        command("emptyTrash", "Empty Trash…"),
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
        command("newWindow", "New Window"),
        command("newTab", "New Tab"),
        command("newFolder", "New Folder"),
        separator,
        command("openSelection", "Open"),
        command("openSelectionInNewTab", "Open in New Tab"),
        command("openSelectionInNewWindow", "Open in New Window"),
        command("editSelection", `Edit in ${options.textEditorName ?? "Text Editor"}`),
        command("quickLookSelection", "Quick Look"),
        // Search results only, as Finder's Show in Enclosing Folder.
        command("revealInFolder", "Reveal in Folder"),
        separator,
        command("calculateSize", "Calculate Size"),
        separator,
        command("renameSelection", "Rename"),
        command("duplicateSelection", "Duplicate"),
        command("moveSelection", "Move to…"),
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
        // Not the "undo" and "redo" roles: the window decides whether a text field or the
        // files are undone, and sends a text field's to it (see NATIVE_EDIT_COMMANDS).
        command("undo", options.undoLabels?.undo ?? "Undo", {
          accelerator: fixedAccelerator("undo"),
        }),
        command("redo", options.undoLabels?.redo ?? "Redo", {
          accelerator: fixedAccelerator("redo"),
        }),
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
        command("showLastSearchResults", "Show Last Search Results"),
      ],
    },
    {
      label: "View",
      submenu: [
        command("viewAsIcons", "as Icons", { type: "radio" }),
        command("viewAsDetails", "as List", { type: "radio" }),
        command("viewAsList", "as Compact List", { type: "radio" }),
        separator,
        {
          label: "Sort By",
          submenu: [
            command("sortByName", "Name", { type: "radio" }),
            command("sortByKind", "Kind", { type: "radio" }),
            command("sortByModified", "Date Modified", { type: "radio" }),
            command("sortBySize", "Size", { type: "radio" }),
          ],
        },
        command("toggleFoldersFirst", "Folders First", { type: "checkbox" }),
        command("toggleHiddenFiles", "Hidden Files", {
          type: "checkbox",
        }),
        command("refreshOrApplySearchSort", "Refresh"),
        separator,
        command("toggleFolderTree", "Hide Folder Tree", { id: FOLDER_TREE_HIDE_ITEM_ID }),
        command("toggleFolderTree", "Show Folder Tree", {
          id: FOLDER_TREE_SHOW_ITEM_ID,
          visible: false,
        }),
        command("toggleInfoPanel", "Info Panel", { type: "checkbox" }),
        command("toggleInfoRow", "Info Row", {
          type: "checkbox",
        }),
        separator,
        command("customizeToolbar", "Customize Toolbar…"),
        separator,
        command("zoomIn", "Zoom In"),
        command("zoomOut", "Zoom Out"),
        command("resetZoom", "Actual Size"),
        separator,
        // macOS adds its own Enter Full Screen item here (🌐F), which names what it does.
        // This hidden one keeps ⌃⌘F, which a hidden item's key still runs on macOS.
        { role: "togglefullscreen", visible: false, acceleratorWorksWhenHidden: true },
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
        // Finder's places, in Finder's order, and the Trash of the sidebar's Locations.
        command("goDocuments", "Documents"),
        command("goDesktop", "Desktop"),
        command("goDownloads", "Downloads"),
        command("goHomeRootTree", "Home"),
        command("goLibrary", "Library"),
        command("goMacintoshHD", "Macintosh HD"),
        command("goApplications", "Applications"),
        command("goTrash", "Trash"),
        separator,
        command("openLocationSheet", "Go to Folder…"),
        separator,
        command("rootTreeAtSelection", "Use as Tree Root"),
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
        command("moveTabToNewWindow", "Move Tab to New Window"),
        command("mergeAllWindows", "Merge All Windows"),
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

// What Undo and Redo say. While a text field (or another window) has the keyboard they are
// its own and say just "Undo" and "Redo", as Finder's do while a name is being edited;
// otherwise they name the file operation, or say there is one that can't be undone.
export function undoMenuLabels(
  history: { undo: string | null; redo: string | null; cantUndo: boolean },
  textEditing: boolean,
): { undo: string; redo: string } {
  if (textEditing) {
    return { undo: "Undo", redo: "Redo" };
  }
  return {
    undo: history.cantUndo ? "Can’t Undo" : history.undo ? `Undo ${history.undo}` : "Undo",
    redo: history.redo ? `Redo ${history.redo}` : "Redo",
  };
}

// What each menu item should show for the state the explorer window last reported.
export function resolveApplicationMenuItemStates(
  state: ApplicationMenuState,
  window: {
    // Whether the explorer window is the one the menu acts on (false while Settings is).
    explorerFocused: boolean;
    // How many explorer windows are open (left out: one). Merging needs two; with none,
    // only COMMANDS_WITHOUT_EXPLORER_WINDOW do anything, besides another window's own.
    explorerWindowCount?: number;
    // Whether a window other than an explorer window (Settings) has the keyboard, rather
    // than no window at all (left out: it has, when the explorer isn't focused).
    otherWindowFocused?: boolean;
    // Whether there is a file operation to undo and to redo (left out: there is).
    undoAvailable?: { undo: boolean; redo: boolean };
  },
): ApplicationMenuItemState[] {
  const disabled = new Set<RendererCommandType>(state.disabledCommands);
  const isEnabled = (type: RendererCommandType) => {
    if (!window.explorerFocused) {
      if (window.explorerWindowCount === 0 && COMMANDS_WITHOUT_EXPLORER_WINDOW.has(type)) {
        return true;
      }
      return window.otherWindowFocused !== false && COMMANDS_FOR_ANY_WINDOW.has(type);
    }
    if (disabled.has(type)) {
      return false;
    }
    if (type === "mergeAllWindows") {
      return (window.explorerWindowCount ?? 1) > 1;
    }
    // A text field's own Undo is always there; the files' only when there is one.
    if ((type === "undo" || type === "redo") && !state.textEditing) {
      return window.undoAvailable?.[type] ?? true;
    }
    return true;
  };
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
    (type) => type !== "toggleFavorite" && type !== "toggleFolderTree",
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
    {
      id: FOLDER_TREE_HIDE_ITEM_ID,
      enabled: isEnabled("toggleFolderTree"),
      visible: state.folderTreeOpen,
    },
    {
      id: FOLDER_TREE_SHOW_ITEM_ID,
      enabled: isEnabled("toggleFolderTree"),
      visible: !state.folderTreeOpen,
    },
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
