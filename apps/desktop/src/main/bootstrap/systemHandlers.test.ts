import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  shell: {},
}));

import {
  emptyTrash,
  getOpenWithApplications,
  getTrashState,
  setDefaultApplicationHandler,
} from "./systemHandlers";

describe("emptyTrash", () => {
  // AppleScript stops waiting for Finder after two minutes, which a large Trash takes
  // longer than; File Trail then said it failed while Finder went on emptying.
  it("asks Finder with a wait of a day, not AppleScript's two minutes", async () => {
    const run = vi.fn(async () => undefined);

    await expect(emptyTrash(run)).resolves.toEqual({ ok: true, error: null });
    expect(run).toHaveBeenCalledWith("osascript", [
      "-e",
      "with timeout of 86400 seconds",
      "-e",
      'tell application "Finder" to empty trash',
      "-e",
      "end timeout",
    ]);
  });

  it("reports osascript's own error line, not the command that ran", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("Command failed: osascript -e with timeout …"), {
        stderr: "0:46: execution error: Not authorized to send Apple events to Finder. (-1743)\n",
      });
    });

    await expect(emptyTrash(run)).resolves.toEqual({
      ok: false,
      error: "0:46: execution error: Not authorized to send Apple events to Finder. (-1743)",
    });
  });
});

describe("getTrashState", () => {
  function reader(folders: Record<string, string[] | NodeJS.ErrnoException>) {
    return vi.fn(async (path: string) => {
      const found = folders[path];
      if (found === undefined) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      }
      if (found instanceof Error) {
        throw found;
      }
      return found;
    });
  }

  it("is empty when no Trash holds anything but Finder's .DS_Store", async () => {
    const read = reader({
      "/Users/demo/.Trash": [".DS_Store"],
      "/Volumes": ["Macintosh HD", "USB"],
      "/Volumes/USB/.Trashes/501": [],
    });
    await expect(getTrashState("/Users/demo", 501, read)).resolves.toEqual({ empty: true });
  });

  // Finder's Empty Trash empties every disk's Trash, so one with items makes it worth it.
  it("isn't empty when another disk's Trash holds something", async () => {
    const read = reader({
      "/Users/demo/.Trash": [],
      "/Volumes": ["USB"],
      "/Volumes/USB/.Trashes/501": ["old.txt"],
    });
    await expect(getTrashState("/Users/demo", 501, read)).resolves.toEqual({ empty: false });
  });

  // Without Full Disk Access macOS refuses to list the Trash: nothing says it is empty.
  it("can't tell when the Trash can't be read", async () => {
    const read = reader({
      "/Users/demo/.Trash": Object.assign(new Error("EPERM"), { code: "EPERM" }),
      "/Volumes": [],
    });
    await expect(getTrashState("/Users/demo", 501, read)).resolves.toEqual({ empty: null });
  });
});

describe("getOpenWithApplications", () => {
  const zed = { path: "/Applications/Zed.app", name: "Zed", bundleId: "dev.zed.Zed", version: "1" };

  it("passes on what Launch Services says, the pinned apps by the paths asked", async () => {
    const lookUp = vi.fn(async () => ({
      defaultApp: zed,
      apps: [zed],
      kinds: [{ contentType: "net.daringfireball.markdown", name: "Markdown", isFolder: false }],
      appInfo: [null],
    }));

    await expect(
      getOpenWithApplications(
        { paths: ["/Users/demo/a.md"], pinnedAppPaths: ["/Applications/Gone.app"] },
        lookUp,
      ),
    ).resolves.toEqual({
      defaultApp: zed,
      apps: [zed],
      kinds: [{ contentType: "net.daringfireball.markdown", name: "Markdown", isFolder: false }],
      pinnedApps: [null],
    });
    expect(lookUp).toHaveBeenCalledWith(["/Users/demo/a.md"], ["/Applications/Gone.app"]);
  });

  // The menu still lists the pinned apps that are on disk, and Other….
  it("falls back to the pinned apps found on disk when Launch Services can't be asked", async () => {
    const lookUp = vi.fn(async () => {
      throw new Error("no answer");
    });

    await expect(
      getOpenWithApplications(
        {
          paths: ["/Users/demo/a.md"],
          pinnedAppPaths: ["/Applications/Zed.app", "/Applications/Gone.app", "/etc/passwd"],
        },
        lookUp,
        (path) => path !== "/Applications/Gone.app",
      ),
    ).resolves.toEqual({
      defaultApp: null,
      apps: [],
      kinds: [],
      pinnedApps: [
        { path: "/Applications/Zed.app", name: "Zed", bundleId: null, version: null },
        null,
        null,
      ],
    });
  });
});

describe("setDefaultApplicationHandler", () => {
  it("sets the app for the kind", async () => {
    const setDefault = vi.fn(async () => undefined);

    await expect(
      setDefaultApplicationHandler(
        { applicationPath: "/Applications/Zed.app", contentType: "public.plain-text" },
        setDefault,
      ),
    ).resolves.toEqual({ ok: true, error: null });
    expect(setDefault).toHaveBeenCalledWith("/Applications/Zed.app", "public.plain-text");
  });

  it("refuses a path that isn't an app, without asking macOS", async () => {
    const setDefault = vi.fn(async () => undefined);

    const response = await setDefaultApplicationHandler(
      { applicationPath: "/bin/sh", contentType: "public.plain-text" },
      setDefault,
    );

    expect(response.ok).toBe(false);
    expect(setDefault).not.toHaveBeenCalled();
  });

  it("says why macOS refused", async () => {
    const setDefault = vi.fn(async () => {
      throw new Error("Folders, apps and packages keep the app they open in.");
    });

    await expect(
      setDefaultApplicationHandler(
        { applicationPath: "/Applications/Zed.app", contentType: "public.folder" },
        setDefault,
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Folders, apps and packages keep the app they open in.",
    });
  });
});
