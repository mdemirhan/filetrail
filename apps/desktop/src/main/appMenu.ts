import type { MenuItemConstructorOptions, WebContents } from "electron";

import type { RendererCommandType } from "../shared/rendererCommands";

type NativeEditTarget = Pick<WebContents, "cut" | "copy" | "paste" | "selectAll">;

const NATIVE_EDIT_COMMANDS: Partial<Record<RendererCommandType, keyof NativeEditTarget>> = {
  editCut: "cut",
  editCopy: "copy",
  editPaste: "paste",
  editSelectAll: "selectAll",
};

// The native menu emits high-level renderer commands; the renderer owns the actual UI
// transitions so shortcuts, toolbar buttons, and menu items stay behaviorally aligned.
export function createApplicationMenuTemplate(
  webContents: Pick<WebContents, "send">,
  options: {
    // Settings is its own window; main opens it directly when provided.
    onOpenSettings?: () => void;
  } = {},
): MenuItemConstructorOptions[] {
  const sendCommand = (type: RendererCommandType, focusedWindow?: unknown) => {
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

  return [
    {
      label: "File Trail",
      submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CommandOrControl+T",
          click: (_item, window) => sendCommand("newTab", window),
        },
        {
          label: "Reopen Closed Tab",
          accelerator: "Shift+CommandOrControl+T",
          click: (_item, window) => sendCommand("reopenClosedTab", window),
        },
        { type: "separator" },
        {
          label: "Open",
          accelerator: "CommandOrControl+O",
          click: (_item, window) => sendCommand("openSelection", window),
        },
        {
          label: "Edit",
          accelerator: "CommandOrControl+E",
          click: (_item, window) => sendCommand("editSelection", window),
        },
        {
          label: "Move To…",
          accelerator: "CommandOrControl+Shift+M",
          click: (_item, window) => sendCommand("moveSelection", window),
        },
        {
          // Return and F2 are handled in the renderer: a menu accelerator for Return would
          // swallow it in text fields and dialogs.
          label: "Rename",
          click: (_item, window) => sendCommand("renameSelection", window),
        },
        {
          label: "Duplicate",
          accelerator: "CommandOrControl+D",
          click: (_item, window) => sendCommand("duplicateSelection", window),
        },
        {
          label: "New Folder",
          accelerator: "CommandOrControl+Shift+N",
          click: (_item, window) => sendCommand("newFolder", window),
        },
        {
          label: "Move to Trash",
          accelerator: "CommandOrControl+Backspace",
          click: (_item, window) => sendCommand("trashSelection", window),
        },
        { type: "separator" },
        {
          label: "Open in Terminal",
          accelerator: "Alt+CommandOrControl+T",
          click: (_item, window) => sendCommand("openInTerminal", window),
        },
        { type: "separator" },
        {
          // Closes the window when it has a single view.
          label: "Close Tab",
          accelerator: "CommandOrControl+W",
          click: (_item, window) => sendCommand("closeTab", window),
        },
        { role: "close", label: "Close Window", accelerator: "Shift+CommandOrControl+W" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        {
          label: "Cut",
          accelerator: "CommandOrControl+X",
          click: (_item, window) => sendCommand("editCut", window),
        },
        {
          label: "Copy",
          accelerator: "CommandOrControl+C",
          click: (_item, window) => sendCommand("editCopy", window),
        },
        {
          label: "Paste",
          accelerator: "CommandOrControl+V",
          click: (_item, window) => sendCommand("editPaste", window),
        },
        {
          label: "Select All",
          accelerator: "CommandOrControl+A",
          click: (_item, window) => sendCommand("editSelectAll", window),
        },
        { type: "separator" },
        {
          label: "Find Files…",
          accelerator: "CommandOrControl+F",
          click: (_item, window) => sendCommand("focusFileSearch", window),
        },
        {
          // ⇧⌘G opens it as well; the window handles that key itself.
          label: "Go To…",
          accelerator: "CommandOrControl+K",
          click: (_item, window) => sendCommand("openLocationSheet", window),
        },
        {
          label: "Settings…",
          accelerator: "CommandOrControl+,",
          click: () =>
            options.onOpenSettings ? options.onOpenSettings() : sendCommand("openSettings"),
        },
        {
          label: "Copy Path",
          accelerator: "Alt+CommandOrControl+C",
          click: (_item, window) => sendCommand("copyPath", window),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Info Panel",
          accelerator: "CommandOrControl+I",
          click: (_item, window) => sendCommand("toggleInfoPanel", window),
        },
        {
          label: "Toggle Info Row",
          accelerator: "CommandOrControl+Shift+I",
          click: (_item, window) => sendCommand("toggleInfoRow", window),
        },
        { type: "separator" },
        {
          label: "Refresh",
          accelerator: "CommandOrControl+R",
          click: (_item, window) => sendCommand("refreshOrApplySearchSort", window),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          accelerator: "CommandOrControl+Plus",
          click: (_item, window) => sendCommand("zoomIn", window),
        },
        {
          label: "Zoom Out",
          accelerator: "CommandOrControl+-",
          click: (_item, window) => sendCommand("zoomOut", window),
        },
        {
          label: "Actual Size",
          accelerator: "CommandOrControl+0",
          click: (_item, window) => sendCommand("resetZoom", window),
        },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Go",
      submenu: [
        {
          label: "Home",
          accelerator: "CommandOrControl+Shift+H",
          click: (_item, window) => sendCommand("goHomeRootTree", window),
        },
        {
          label: "Root Tree at Selected Folder",
          accelerator: "CommandOrControl+Shift+R",
          click: (_item, window) => sendCommand("rootTreeAtSelection", window),
        },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        {
          label: "Show Previous Tab",
          accelerator: "Ctrl+Shift+Tab",
          click: (_item, window) => sendCommand("selectPreviousTab", window),
        },
        {
          label: "Show Next Tab",
          accelerator: "Ctrl+Tab",
          click: (_item, window) => sendCommand("selectNextTab", window),
        },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];
}
