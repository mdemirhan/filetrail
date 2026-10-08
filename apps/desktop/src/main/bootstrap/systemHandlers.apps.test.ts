import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Opening items, apps and Terminal, the open dialogs, Quick Look and the volume figures,
// against a mocked Electron and `open` command.
const electron = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(),
  openPath: vi.fn(),
  openExternal: vi.fn(),
}));
const execFile = vi.hoisted(() => vi.fn());
const icons = vi.hoisted(() => ({
  getFileIcon: vi.fn(),
  getFileThumbnail: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: electron.fromWebContents },
  dialog: { showOpenDialog: electron.showOpenDialog },
  shell: { openPath: electron.openPath, openExternal: electron.openExternal },
}));
vi.mock("node:child_process", () => ({ execFile }));
vi.mock("../originalFileSystem", () => ({
  getFileIcon: icons.getFileIcon,
  getFileThumbnail: icons.getFileThumbnail,
  originalFileSystem: { stat: icons.stat },
}));

import {
  getFileIconHandler,
  getFileThumbnailHandler,
  getVolumeInfo,
  openFullDiskAccessSettings,
  openInTerminal,
  openPath,
  openPathsWithApplication,
  pickApplication,
  pickDirectory,
  quickLookPath,
} from "./systemHandlers";

const sender = {} as never;

function openCommandSucceeds() {
  execFile.mockImplementation((_file, _args, callback) => callback(null, { stdout: "" }));
}

function openCommandFails(message: string) {
  execFile.mockImplementation((_file, _args, callback) => callback(new Error(message)));
}

function openCommandArgs() {
  return execFile.mock.calls.map(([file, args]) => [file, args]);
}

beforeEach(() => {
  vi.clearAllMocks();
  openCommandSucceeds();
});

describe("openPath", () => {
  it("opens the item with its default app", async () => {
    electron.openPath.mockResolvedValue("");
    await expect(openPath({ path: "/Users/demo/notes.txt" })).resolves.toEqual({
      ok: true,
      error: null,
    });
    expect(electron.openPath).toHaveBeenCalledWith("/Users/demo/notes.txt");
  });

  it("reports why macOS could not open it", async () => {
    electron.openPath.mockResolvedValue("No application knows how to open it.");
    await expect(openPath({ path: "/Users/demo/data.xyz" })).resolves.toEqual({
      ok: false,
      error: "No application knows how to open it.",
    });
  });
});

describe("openFullDiskAccessSettings", () => {
  it("opens Full Disk Access in System Settings", async () => {
    electron.openExternal.mockResolvedValue(undefined);
    await expect(openFullDiskAccessSettings()).resolves.toEqual({ ok: true });
    expect(electron.openExternal).toHaveBeenCalledWith(expect.stringContaining("Privacy_AllFiles"));
  });

  it("says so when System Settings can't be opened", async () => {
    electron.openExternal.mockRejectedValue(new Error("no handler"));
    await expect(openFullDiskAccessSettings()).resolves.toEqual({ ok: false });
  });
});

describe("getVolumeInfo", () => {
  it("gives the size and free space of the disk holding a folder", async () => {
    const info = await getVolumeInfo({ path: tmpdir() });
    expect(info.totalBytes).toBeGreaterThan(0);
    expect(info.availableBytes).toBeGreaterThanOrEqual(0);
    expect(info.availableBytes).toBeLessThanOrEqual(info.totalBytes ?? 0);
  });

  it("gives nothing for a path that isn't there", async () => {
    await expect(getVolumeInfo({ path: join(tmpdir(), "missing", "folder") })).resolves.toEqual({
      availableBytes: null,
      totalBytes: null,
    });
  });
});

describe("quickLookPath", () => {
  it("previews the item in the window that asked, titled with its name", () => {
    const previewFile = vi.fn();
    electron.fromWebContents.mockReturnValue({ previewFile });
    expect(quickLookPath({ path: "/Users/demo/photo.jpg" }, { sender })).toEqual({ ok: true });
    expect(previewFile).toHaveBeenCalledWith("/Users/demo/photo.jpg", "photo.jpg");
  });

  it("previews nothing for a relative path or without a window", () => {
    const previewFile = vi.fn();
    electron.fromWebContents.mockReturnValue({ previewFile });
    expect(quickLookPath({ path: "photo.jpg" }, { sender })).toEqual({ ok: false });
    electron.fromWebContents.mockReturnValue(null);
    expect(quickLookPath({ path: "/Users/demo/photo.jpg" }, { sender })).toEqual({ ok: false });
    expect(previewFile).not.toHaveBeenCalled();
  });
});

describe("pickApplication", () => {
  it("asks for an app in /Applications as a sheet on the window, and names the one chosen", async () => {
    const window = { id: 1 };
    electron.fromWebContents.mockReturnValue(window);
    electron.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ["/Applications/Visual Studio Code.app"],
    });
    await expect(pickApplication({ sender })).resolves.toEqual({
      canceled: false,
      appPath: "/Applications/Visual Studio Code.app",
      appName: "Visual Studio Code",
    });
    expect(electron.showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        defaultPath: "/Applications",
        properties: ["openFile"],
        filters: [{ name: "Applications", extensions: ["app"] }],
      }),
    );
  });

  it("gives nothing when the dialog is cancelled, or chooses nothing", async () => {
    electron.fromWebContents.mockReturnValue(null);
    electron.showOpenDialog.mockResolvedValue({
      canceled: true,
      filePaths: ["/Applications/X.app"],
    });
    await expect(pickApplication({ sender })).resolves.toEqual({
      canceled: true,
      appPath: null,
      appName: null,
    });
    // Without a window, the dialog stands on its own.
    expect(electron.showOpenDialog.mock.calls[0]).toHaveLength(1);

    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
    await expect(pickApplication({ sender })).resolves.toEqual({
      canceled: false,
      appPath: null,
      appName: null,
    });
  });
});

describe("pickDirectory", () => {
  it("starts at the folder given and returns the one chosen", async () => {
    const window = { id: 1 };
    electron.fromWebContents.mockReturnValue(window);
    electron.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/Users/demo/Work"] });
    await expect(pickDirectory({ defaultPath: "/Users/demo" }, { sender })).resolves.toEqual({
      canceled: false,
      path: "/Users/demo/Work",
    });
    expect(electron.showOpenDialog).toHaveBeenCalledWith(
      window,
      expect.objectContaining({
        defaultPath: "/Users/demo",
        properties: ["openDirectory", "createDirectory"],
      }),
    );
  });

  it("starts wherever macOS likes without a folder, and gives nothing when cancelled", async () => {
    electron.fromWebContents.mockReturnValue(null);
    electron.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(pickDirectory({}, { sender })).resolves.toEqual({ canceled: true, path: null });
    const [options] = electron.showOpenDialog.mock.calls[0] ?? [];
    expect(options).not.toHaveProperty("defaultPath");
  });
});

describe("openPathsWithApplication", () => {
  it("opens the items with the app through `open -a`", async () => {
    await expect(
      openPathsWithApplication({
        applicationPath: "/Applications/Zed.app",
        paths: ["/Users/demo/a.txt", "/Users/demo/b.txt"],
      }),
    ).resolves.toEqual({ ok: true, error: null });
    expect(openCommandArgs()).toEqual([
      ["open", ["-a", "/Applications/Zed.app", "/Users/demo/a.txt", "/Users/demo/b.txt"]],
    ]);
  });

  it("reveals the items in Finder through `open -R` when Finder is the app", async () => {
    await openPathsWithApplication({
      applicationPath: "/System/Library/CoreServices/Finder.app",
      paths: ["/Users/demo/a.txt"],
    });
    expect(openCommandArgs()).toEqual([["open", ["-R", "/Users/demo/a.txt"]]]);
  });

  it("reports why `open` failed", async () => {
    openCommandFails("Unable to find application named 'Gone'");
    await expect(
      openPathsWithApplication({ applicationPath: "/Applications/Gone.app", paths: ["/a"] }),
    ).resolves.toEqual({ ok: false, error: "Unable to find application named 'Gone'" });
  });
});

describe("openInTerminal", () => {
  const terminal = { appPath: "/Applications/iTerm.app", appName: "iTerm" };

  it("opens a folder itself in Terminal when no other terminal is chosen", async () => {
    const folder = join(tmpdir(), "terminal-folder");
    await mkdir(folder, { recursive: true });
    await expect(openInTerminal({ path: folder }, null)).resolves.toEqual({
      ok: true,
      error: null,
      targetPath: folder,
      terminalName: "Terminal",
    });
    expect(openCommandArgs()).toEqual([["open", ["-a", "Terminal", folder]]]);
  });

  it("opens a file's folder, with the chosen terminal", async () => {
    const folder = join(tmpdir(), "terminal-file");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "notes.txt"), "");
    const response = await openInTerminal({ path: join(folder, "notes.txt") }, terminal);
    expect(response).toMatchObject({ ok: true, targetPath: folder, terminalName: "iTerm" });
    expect(openCommandArgs()).toEqual([["open", ["-a", "/Applications/iTerm.app", folder]]]);
  });

  it("opens the folder an item that is gone was in", async () => {
    const response = await openInTerminal({ path: "/Users/demo/gone/notes.txt" }, terminal);
    expect(response.targetPath).toBe("/Users/demo/gone");
  });

  it("uses Terminal when the chosen terminal has no path", async () => {
    await openInTerminal({ path: "/Users/demo/gone/notes.txt" }, { appPath: "  ", appName: "" });
    expect(openCommandArgs()).toEqual([["open", ["-a", "Terminal", "/Users/demo/gone"]]]);
  });

  it("reports why the terminal didn't open", async () => {
    openCommandFails("LSOpenURLsWithRole() failed");
    await expect(openInTerminal({ path: "/Users/demo/gone/a" }, terminal)).resolves.toEqual({
      ok: false,
      error: "LSOpenURLsWithRole() failed",
      targetPath: "/Users/demo/gone",
      terminalName: "iTerm",
    });
  });
});

describe("getFileIconHandler", () => {
  it("returns the item's own icon as PNG data", async () => {
    icons.getFileIcon.mockResolvedValue(Buffer.from("png"));
    await expect(getFileIconHandler({ path: "/Users/demo/a.txt", size: 32 })).resolves.toEqual({
      pngBase64: Buffer.from("png").toString("base64"),
    });
    expect(icons.getFileIcon).toHaveBeenCalledWith("/Users/demo/a.txt", 32);
  });

  it("returns the ordinary icon of a kind from a sample item of that kind", async () => {
    icons.getFileIcon.mockResolvedValue(Buffer.from("png"));
    await getFileIconHandler({ path: "/", size: 64, generic: "folder" });
    await getFileIconHandler({ path: "/", size: 64, generic: "executable" });
    const [folderSample, executableSample] = icons.getFileIcon.mock.calls.map(([path]) => path);
    expect(folderSample).not.toBe("/");
    expect(folderSample).toMatch(/filetrail-icon-samples/);
    expect(executableSample).toMatch(/filetrail-icon-samples/);
    expect(executableSample).not.toBe(folderSample);
  });

  it("returns no icon when there is none or it can't be made", async () => {
    icons.getFileIcon.mockResolvedValue(null);
    await expect(getFileIconHandler({ path: "/a", size: 32 })).resolves.toEqual({
      pngBase64: null,
    });
    icons.getFileIcon.mockRejectedValue(new Error("addon failed"));
    await expect(getFileIconHandler({ path: "/a", size: 32 })).resolves.toEqual({
      pngBase64: null,
    });
  });
});

describe("getFileThumbnailHandler", () => {
  it("returns no picture for a file Quick Look can't draw, or that is gone", async () => {
    icons.stat.mockResolvedValue({ mtimeMs: 5, size: 10 });
    icons.getFileThumbnail.mockResolvedValue(null);
    await expect(getFileThumbnailHandler({ path: "/a.bin", size: 64 })).resolves.toEqual({
      version: "5:10",
      unchanged: false,
      dataUrl: null,
    });
    icons.stat.mockRejectedValue(new Error("ENOENT"));
    await expect(getFileThumbnailHandler({ path: "/a.bin", size: 64 })).resolves.toEqual({
      version: null,
      unchanged: false,
      dataUrl: null,
    });
  });
});
