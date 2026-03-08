import type { MenuItemConstructorOptions, WebContents } from "electron";

export type RendererCommand = "focusFileSearch" | "copyPath";

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
      submenu: [{ role: "close" }],
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
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];
}
