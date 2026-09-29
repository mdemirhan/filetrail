import { execFile } from "node:child_process";
import { mkdtemp, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, normalize, sep } from "node:path";
import { promisify } from "node:util";
import {
  BrowserWindow,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type WebContents,
  dialog,
  shell,
} from "electron";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";
import { toErrorMessage } from "../ipc";
import { getFileIcon } from "../originalFileSystem";

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

// Free space on the volume holding `path`, shown next to the path bar like Finder's status bar.
export async function getVolumeInfo(
  payload: IpcRequest<"system:getVolumeInfo">,
): Promise<IpcResponse<"system:getVolumeInfo">> {
  try {
    const stats = await statfs(payload.path);
    return { availableBytes: Number(stats.bavail) * Number(stats.bsize) };
  } catch {
    return { availableBytes: null };
  }
}

// Quick Look uses the native preview panel attached to the requesting window.
export function quickLookPath(
  payload: IpcRequest<"system:quickLook">,
  event: Pick<IpcMainInvokeEvent, "sender">,
): IpcResponse<"system:quickLook"> {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !isAbsolute(payload.path)) {
    return { ok: false };
  }
  window.previewFile(payload.path, basename(payload.path));
  return { ok: true };
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
  if (!isValidApplicationBundlePath(payload.applicationPath)) {
    return {
      ok: false,
      error: buildInvalidApplicationPathMessage(payload.applicationPath),
    };
  }
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
): Promise<
  IpcResponse<"system:openInTerminal"> & {
    targetPath: string;
    terminalName: string;
  }
> {
  const terminalName = resolveTerminalApplicationName(terminalApp);
  const launchApplicationPath = terminalApp ? terminalApp.appPath.trim() : "";
  const targetPath = await resolveTerminalTargetPath(payload.path);
  if (launchApplicationPath.length > 0 && !isValidApplicationBundlePath(launchApplicationPath)) {
    return {
      ok: false,
      error: buildInvalidApplicationPathMessage(launchApplicationPath),
      targetPath,
      terminalName,
    };
  }
  try {
    // Files open Terminal in their containing directory; directories open directly.
    // `open -a` accepts a full bundle path; fall back to the default Terminal app.
    await execFileAsync("open", [
      "-a",
      launchApplicationPath.length > 0 ? launchApplicationPath : "Terminal",
      targetPath,
    ]);
    return {
      ok: true,
      error: null,
      targetPath,
      terminalName,
    };
  } catch (error) {
    return {
      ok: false,
      error: toErrorMessage(error),
      targetPath,
      terminalName,
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
  const appName = terminalApp.appName.trim();
  if (appName.length > 0) {
    return appName;
  }
  const appPath = terminalApp.appPath.trim();
  return appPath.length > 0 ? resolveApplicationDisplayName(appPath) : "Terminal";
}

export function isValidApplicationBundlePath(applicationPath: string): boolean {
  const trimmed = applicationPath.trim();
  if (trimmed.length === 0 || !isAbsolute(trimmed)) {
    return false;
  }
  if (trimmed.split(sep).includes("..")) {
    return false;
  }
  return normalize(trimmed).toLowerCase().endsWith(".app");
}

function buildInvalidApplicationPathMessage(applicationPath: string): string {
  return `Invalid application path: ${applicationPath}. Expected an absolute path to a .app bundle.`;
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

export async function emptyTrash(): Promise<IpcResponse<"system:emptyTrash">> {
  try {
    await execFileAsync("osascript", ["-e", 'tell application "Finder" to empty trash']);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  }
}

let genericFolderPathPromise: Promise<string> | null = null;

// An empty folder we own, so NSWorkspace returns the ordinary folder icon (folders such as
// "/" or ~/Library carry custom icons and must not stand in for all folders).
function getGenericFolderPath(): Promise<string> {
  genericFolderPathPromise ??= mkdtemp(join(tmpdir(), "filetrail-folder-icon-"));
  return genericFolderPathPromise;
}

export async function getFileIconHandler(
  payload: IpcRequest<"system:getFileIcon">,
): Promise<IpcResponse<"system:getFileIcon">> {
  try {
    const iconPath = payload.genericFolder ? await getGenericFolderPath() : payload.path;
    const buffer = await getFileIcon(iconPath, payload.size);
    return {
      pngBase64: buffer ? buffer.toString("base64") : null,
    };
  } catch {
    return { pngBase64: null };
  }
}
