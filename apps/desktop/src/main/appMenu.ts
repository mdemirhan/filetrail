import type { MenuItemConstructorOptions, WebContents } from "electron";

import type { RendererCommandType } from "../shared/rendererCommands";

// The native menu emits high-level renderer commands; the renderer owns the actual UI
// transitions so shortcuts, toolbar buttons, and menu items stay behaviorally aligned.
export function createApplicationMenuTemplate(
  webContents: Pick<WebContents, "send">,
): MenuItemConstructorOptions[] {
  const sendCommand = (type: RendererCommandType) => {
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
          label: "Open",
          accelerator: "CommandOrControl+O",
          click: () => sendCommand("openSelection"),
        },
        {
          label: "Edit",
          accelerator: "CommandOrControl+E",
          click: () => sendCommand("editSelection"),
        },
        {
          label: "Move To…",
          accelerator: "CommandOrControl+Shift+M",
          click: () => sendCommand("moveSelection"),
        },
        {
          label: "Rename",
          accelerator: "F2",
          click: () => sendCommand("renameSelection"),
        },
        {
          label: "Duplicate",
          accelerator: "CommandOrControl+D",
          click: () => sendCommand("duplicateSelection"),
        },
        {
          label: "New Folder",
          accelerator: "CommandOrControl+Shift+N",
          click: () => sendCommand("newFolder"),
        },
        {
          label: "Move to Trash",
          accelerator: "CommandOrControl+Backspace",
          click: () => sendCommand("trashSelection"),
        },
        { type: "separator" },
        {
          label: "Open in Terminal",
          accelerator: "CommandOrControl+T",
          click: () => sendCommand("openInTerminal"),
        },
        { type: "separator" },
        { role: "close" },
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
          click: () => sendCommand("editCut"),
        },
        {
          label: "Copy",
          accelerator: "CommandOrControl+C",
          click: () => sendCommand("editCopy"),
        },
        {
          label: "Paste",
          accelerator: "CommandOrControl+V",
          click: () => sendCommand("editPaste"),
        },
        {
          label: "Select All",
          accelerator: "CommandOrControl+A",
          click: () => sendCommand("editSelectAll"),
        },
        { type: "separator" },
        {
          label: "Find Files…",
          accelerator: "CommandOrControl+F",
          click: () => sendCommand("focusFileSearch"),
        },
        {
          label: "Go to Folder…",
          accelerator: "CommandOrControl+Shift+G",
          click: () => sendCommand("openLocationSheet"),
        },
        {
          label: "Settings…",
          accelerator: "CommandOrControl+,",
          click: () => sendCommand("openSettings"),
        },
        {
          label: "Copy Path",
          accelerator: "Alt+CommandOrControl+C",
          click: () => sendCommand("copyPath"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Info Panel",
          accelerator: "CommandOrControl+I",
          click: () => sendCommand("toggleInfoPanel"),
        },
        {
          label: "Toggle Info Row",
          accelerator: "CommandOrControl+Shift+I",
          click: () => sendCommand("toggleInfoRow"),
        },
        { type: "separator" },
        {
          label: "Refresh",
          accelerator: "CommandOrControl+R",
          click: () => sendCommand("refreshOrApplySearchSort"),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          accelerator: "CommandOrControl+Plus",
          click: () => sendCommand("zoomIn"),
        },
        {
          label: "Zoom Out",
          accelerator: "CommandOrControl+-",
          click: () => sendCommand("zoomOut"),
        },
        {
          label: "Actual Size",
          accelerator: "CommandOrControl+0",
          click: () => sendCommand("resetZoom"),
        },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];
}
