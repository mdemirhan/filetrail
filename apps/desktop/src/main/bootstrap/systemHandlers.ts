import { execFile } from "node:child_process";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  dialog,
  shell,
  type WebContents,
} from "electron";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";
import { toErrorMessage } from "../ipc";

const execFileAsync = promisify(execFile);

export async function openPath(
  payload: IpcRequest<"system:openPath">,
): Promise<IpcResponse<"system:openPath">> {
  const error = await shell.openPath(payload.path);
  return {
    ok: error.length === 0,
    error: error.length === 0 ? null : error,
  };
}

export async function pickApplication(
  event: Pick<IpcMainInvokeEvent, "sender">,
): Promise<IpcResponse<"system:pickApplication">> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions: OpenDialogOptions = {
    title: "Choose Application",
    buttonLabel: "Choose App",
    defaultPath: "/Applications",
    properties: ["openFile"],
    filters: [
      {
        name: "Applications",
        extensions: ["app"],
      },
    ],
  };
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  const appPath = result.canceled ? null : (result.filePaths[0] ?? null);
  const appName = appPath ? resolveApplicationDisplayName(appPath) : null;
  return {
    canceled: result.canceled,
    appPath,
    appName,
  };
}

export async function pickDirectory(
  payload: IpcRequest<"system:pickDirectory">,
  event: Pick<IpcMainInvokeEvent, "sender">,
): Promise<IpcResponse<"system:pickDirectory">> {
  const window = BrowserWindow.fromWebContents(event.sender);
  const dialogOptions: OpenDialogOptions = {
    title: "Choose Folder",
    buttonLabel: "Choose Folder",
    properties: ["openDirectory", "createDirectory"],
  };
  if (payload.defaultPath) {
    dialogOptions.defaultPath = payload.defaultPath;
  }
  const result = window
    ? await dialog.showOpenDialog(window, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  return {
    canceled: result.canceled,
    path: result.canceled ? null : (result.filePaths[0] ?? null),
  };
}

export async function openPathsWithApplication(
  payload: IpcRequest<"system:openPathsWithApplication">,
  runOpenCommand: (applicationPath: string, paths: string[]) => Promise<void> = (
    applicationPath,
    paths,
  ) => execFileAsync("open", ["-a", applicationPath, ...paths]).then(() => undefined),
): Promise<IpcResponse<"system:openPathsWithApplication">> {
  try {
    await runOpenCommand(payload.applicationPath, [...payload.paths]);
    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  }
}

export async function openInTerminal(
  payload: IpcRequest<"system:openInTerminal">,
  terminalApp: { appPath: string; appName: string } | null,
): Promise<IpcResponse<"system:openInTerminal">> {
  try {
    // Files open Terminal in their containing directory; directories open directly.
    const targetPath = await resolveTerminalTargetPath(payload.path);
    await execFileAsync("open", ["-a", resolveTerminalApplicationName(terminalApp), targetPath]);
    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
    };
  }
}

export function performEditAction(
  payload: IpcRequest<"system:performEditAction">,
  webContents: Pick<WebContents, "copy" | "cut" | "paste" | "selectAll">,
): IpcResponse<"system:performEditAction"> {
  if (payload.action === "cut") {
    webContents.cut();
  } else if (payload.action === "copy") {
    webContents.copy();
  } else if (payload.action === "paste") {
    webContents.paste();
  } else {
    webContents.selectAll();
  }

  return { ok: true };
}

export function resolveTerminalApplicationName(
  terminalApp: { appPath: string; appName: string } | null,
): string {
  if (!terminalApp) {
    return "Terminal";
  }
  const appPath = terminalApp.appPath.trim();
  return appPath.length > 0 ? appPath : "Terminal";
}

export function resolveApplicationDisplayName(applicationPath: string): string {
  const trimmed = applicationPath.trim();
  const bundleName = basename(trimmed);
  return bundleName.toLowerCase().endsWith(".app")
    ? bundleName.slice(0, -4) || trimmed
    : bundleName || trimmed;
}

async function resolveTerminalTargetPath(path: string): Promise<string> {
  try {
    const stats = await import("node:fs/promises").then(({ stat }) => stat(path));
    return stats.isDirectory() ? path : dirname(path);
  } catch {
    return dirname(path);
  }
}
