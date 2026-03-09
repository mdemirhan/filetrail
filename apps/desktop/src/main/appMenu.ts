import type { MenuItemConstructorOptions, WebContents } from "electron";

export type RendererCommand =
  | "focusFileSearch"
  | "openLocationSheet"
  | "openSettings"
  | "openInTerminal"
  | "copyPath"
  | "refreshOrApplySearchSort"
  | "toggleInfoPanel"
  | "toggleInfoRow";

// The native menu emits high-level renderer commands; the renderer owns the actual UI
// transitions so shortcuts, toolbar buttons, and menu items stay behaviorally aligned.
export function createApplicationMenuTemplate(
  webContents: Pick<WebContents, "send">,
): MenuItemConstructorOptions[] {
  return [
    {
      label: "File Trail",
      submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
    },
    {
      label: "File",
      submenu: [
        {
          label: "Open in Terminal",
          accelerator: "CommandOrControl+T",
          click: () => {
            webContents.send("filetrail:command", {
              type: "openInTerminal" satisfies RendererCommand,
            });
          },
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
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          label: "Find Files…",
          accelerator: "CommandOrControl+F",
          click: () => {
            webContents.send("filetrail:command", {
              type: "focusFileSearch" satisfies RendererCommand,
            });
          },
        },
        {
          label: "Go to Folder…",
          accelerator: "CommandOrControl+Shift+G",
          click: () => {
            webContents.send("filetrail:command", {
              type: "openLocationSheet" satisfies RendererCommand,
            });
          },
        },
        {
          label: "Settings…",
          accelerator: "CommandOrControl+,",
          click: () => {
            webContents.send("filetrail:command", {
              type: "openSettings" satisfies RendererCommand,
            });
          },
        },
        {
          label: "Copy Path",
          accelerator: "Alt+CommandOrControl+C",
          click: () => {
            webContents.send("filetrail:command", {
              type: "copyPath" satisfies RendererCommand,
            });
          },
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Info Panel",
          accelerator: "CommandOrControl+I",
          click: () => {
            webContents.send("filetrail:command", {
              type: "toggleInfoPanel" satisfies RendererCommand,
            });
          },
        },
        {
          label: "Toggle Info Row",
          accelerator: "CommandOrControl+Shift+I",
          click: () => {
            webContents.send("filetrail:command", {
              type: "toggleInfoRow" satisfies RendererCommand,
            });
          },
        },
        { type: "separator" },
        {
          label: "Refresh",
          accelerator: "CommandOrControl+R",
          click: () => {
            webContents.send("filetrail:command", {
              type: "refreshOrApplySearchSort" satisfies RendererCommand,
            });
          },
        },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];
}
