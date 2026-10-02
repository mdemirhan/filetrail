import { execFile } from "node:child_process";
import { chmod, mkdir, readdir, rmdir, statfs, writeFile } from "node:fs/promises";
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
import { FINDER_APP_PATH } from "../../shared/finder";
import { toErrorMessage } from "../ipc";
import { getFileIcon, getFileThumbnail, originalFileSystem } from "../originalFileSystem";

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
  revealInFinder: (paths: string[]) => Promise<void> = (paths) =>
    execFileAsync("open", ["-R", ...paths]).then(() => undefined),
): Promise<IpcResponse<"system:openPathsWithApplication">> {
  if (!isValidApplicationBundlePath(payload.applicationPath)) {
    return {
      ok: false,
      error: buildInvalidApplicationPathMessage(payload.applicationPath),
    };
  }
  try {
    // Finder refuses to open a document handed to it with `open -a`, so choosing Finder shows
    // the items selected in their folder instead: files, folders and packages alike.
    if (normalize(payload.applicationPath.trim()) === FINDER_APP_PATH) {
      await revealInFinder([...payload.paths]);
    } else {
      await runOpenCommand(payload.applicationPath, [...payload.paths]);
    }
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

type GenericIconKind = NonNullable<IpcRequest<"system:getFileIcon">["generic"]>;

let iconSamplesPromise: Promise<Record<GenericIconKind, string>> | null = null;

// Items we own, so NSWorkspace returns the ordinary icon for their kind: an empty folder
// (folders such as "/" or ~/Library carry custom icons and must not stand in for all
// folders), and an empty file without an extension, once plain and once executable. They
// live in one fixed folder that every launch reuses.
function getIconSamples(): Promise<Record<GenericIconKind, string>> {
  iconSamplesPromise ??= createIconSamples().catch((error: unknown) => {
    iconSamplesPromise = null;
    throw error;
  });
  return iconSamplesPromise;
}

async function createIconSamples(): Promise<Record<GenericIconKind, string>> {
  const root = join(tmpdir(), "filetrail-icon-samples");
  const samples = {
    folder: join(root, "folder"),
    file: join(root, "document"),
    executable: join(root, "executable"),
  };
  await mkdir(samples.folder, { recursive: true });
  await writeFile(samples.file, "");
  await writeFile(samples.executable, "");
  await chmod(samples.file, 0o644);
  await chmod(samples.executable, 0o755);
  void removeLegacyIconSampleFolders();
  return samples;
}

// Earlier versions made a new empty folder for the folder icon on every launch and left it
// behind. `rmdir` only removes a folder that is empty.
async function removeLegacyIconSampleFolders(): Promise<void> {
  const names = await readdir(tmpdir()).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name.startsWith("filetrail-folder-icon-"))
      .map((name) => rmdir(join(tmpdir(), name)).catch(() => undefined)),
  );
}

export async function getFileIconHandler(
  payload: IpcRequest<"system:getFileIcon">,
): Promise<IpcResponse<"system:getFileIcon">> {
  try {
    const iconPath = payload.generic ? (await getIconSamples())[payload.generic] : payload.path;
    const buffer = await getFileIcon(iconPath, payload.size);
    return {
      pngBase64: buffer ? buffer.toString("base64") : null,
    };
  } catch {
    return { pngBase64: null };
  }
}

// The picture Quick Look draws of a file's content, for icon view. The version is the
// file's size and modification time: a window that already holds the picture for that
// version is told so instead of being sent it again.
export async function getFileThumbnailHandler(
  payload: IpcRequest<"system:getFileThumbnail">,
): Promise<IpcResponse<"system:getFileThumbnail">> {
  try {
    const stats = await originalFileSystem.stat(payload.path);
    const version = `${stats.mtimeMs ?? 0}:${stats.size}`;
    if (payload.knownVersion === version) {
      return { version, unchanged: true, dataUrl: null };
    }
    const buffer = await getFileThumbnail(payload.path, payload.size);
    if (!buffer) {
      return { version, unchanged: false, dataUrl: null };
    }
    // JPEG data starts with FF D8; everything else the addon returns is PNG.
    const mime = buffer[0] === 0xff && buffer[1] === 0xd8 ? "image/jpeg" : "image/png";
    return {
      version,
      unchanged: false,
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
    };
  } catch {
    return { version: null, unchanged: false, dataUrl: null };
  }
}
