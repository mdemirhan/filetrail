vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn() },
}));
vi.mock("./originalFileSystem", () => ({
  getFileIcon: vi.fn(),
}));

import { toPreferencePatch } from "./bootstrap/preferencesPatch";
import {
  isValidApplicationBundlePath,
  openInTerminal,
  openPathsWithApplication,
  performEditAction,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
} from "./bootstrap/systemHandlers";

describe("toPreferencePatch", () => {
  it("carries the appearance, sidebar, and Return key preferences", () => {
    expect(
      toPreferencePatch({
        theme: "auto",
        autoLightTheme: "sand",
        autoDarkTheme: "tomorrow-night",
        showSidebarRail: true,
        returnKeyAction: "open",
      }),
    ).toEqual({
      theme: "auto",
      autoLightTheme: "sand",
      autoDarkTheme: "tomorrow-night",
      showSidebarRail: true,
      returnKeyAction: "open",
    });
  });

  it("preserves search result sorting fields", () => {
    expect(
      toPreferencePatch({
        searchResultsSortBy: "name",
        searchResultsSortDirection: "desc",
      }),
    ).toEqual({
      searchResultsSortBy: "name",
      searchResultsSortDirection: "desc",
    });
  });

  it("preserves pane tab switching preferences", () => {
    expect(
      toPreferencePatch({
        tabSwitchesExplorerPanes: false,
      }),
    ).toEqual({
      tabSwitchesExplorerPanes: false,
    });
  });

  it("preserves hovered item highlight preference", () => {
    expect(
      toPreferencePatch({
        highlightHoveredItems: false,
      }),
    ).toEqual({
      highlightHoveredItems: false,
    });
  });

  it("preserves detail view preference fields", () => {
    expect(
      toPreferencePatch({
        compactDetailsView: true,
        detailColumns: {
          size: true,
          modified: false,
          permissions: true,
          kind: true,
          created: false,
        },
        detailColumnWidths: {
          name: 360,
          size: 120,
          modified: 180,
          permissions: 160,
          kind: 148,
          created: 168,
        },
      }),
    ).toEqual({
      compactDetailsView: true,
      detailColumns: {
        size: true,
        modified: false,
        permissions: true,
        kind: true,
        created: false,
      },
      detailColumnWidths: {
        name: 360,
        size: 120,
        modified: 180,
        permissions: 160,
        kind: 148,
        created: 168,
      },
    });
  });

  it("preserves terminal app override preferences", () => {
    expect(
      toPreferencePatch({
        terminalApp: {
          appPath: "/Applications/iTerm.app",
          appName: "iTerm",
        },
      }),
    ).toEqual({
      terminalApp: {
        appPath: "/Applications/iTerm.app",
        appName: "iTerm",
      },
    });
  });

  it("preserves action log preference fields", () => {
    expect(
      toPreferencePatch({
        actionLogEnabled: false,
      }),
    ).toEqual({
      actionLogEnabled: false,
    });
  });

  it("preserves toolbar layout preferences", () => {
    expect(
      toPreferencePatch({
        topToolbarItems: ["back", "search", "copyPath"],
        leftToolbarItems: {
          main: ["home", "copyPath"],
          utility: ["settings", "theme"],
        },
      }),
    ).toEqual({
      topToolbarItems: ["back", "search", "copyPath"],
      leftToolbarItems: {
        main: ["home", "copyPath"],
        utility: ["settings", "theme"],
      },
    });
  });

  it("preserves default editor and file activation preferences", () => {
    expect(
      toPreferencePatch({
        defaultTextEditor: {
          appPath: "/Applications/Zed.app",
          appName: "Zed",
        },
        fileActivationAction: "edit",
        openItemLimit: 9,
      }),
    ).toEqual({
      defaultTextEditor: {
        appPath: "/Applications/Zed.app",
        appName: "Zed",
      },
      fileActivationAction: "edit",
      openItemLimit: 9,
    });
  });

  it("preserves open with application preferences", () => {
    expect(
      toPreferencePatch({
        openWithApplications: [
          {
            id: "zed",
            appPath: "/Applications/Zed.app",
            appName: "Zed",
          },
        ],
      }),
    ).toEqual({
      openWithApplications: [
        {
          id: "zed",
          appPath: "/Applications/Zed.app",
          appName: "Zed",
        },
      ],
    });
  });
});

describe("resolveTerminalApplicationName", () => {
  it("falls back to Terminal when no override is configured", () => {
    expect(resolveTerminalApplicationName(null)).toBe("Terminal");
  });

  it("uses the configured terminal app display name", () => {
    expect(
      resolveTerminalApplicationName({
        appPath: "/Applications/iTerm.app",
        appName: "iTerm",
      }),
    ).toBe("iTerm");
  });

  it("derives the display name from the bundle path when the name is empty", () => {
    expect(
      resolveTerminalApplicationName({
        appPath: "/Applications/iTerm.app",
        appName: "  ",
      }),
    ).toBe("iTerm");
  });

  it("falls back to Terminal when the override has no usable values", () => {
    expect(
      resolveTerminalApplicationName({
        appPath: "  ",
        appName: "",
      }),
    ).toBe("Terminal");
  });
});

describe("isValidApplicationBundlePath", () => {
  it("accepts absolute paths to .app bundles", () => {
    expect(isValidApplicationBundlePath("/Applications/Zed.app")).toBe(true);
    expect(isValidApplicationBundlePath("/Applications/Visual Studio Code.app")).toBe(true);
  });

  it("rejects relative paths and bare application names", () => {
    expect(isValidApplicationBundlePath("Finder")).toBe(false);
    expect(isValidApplicationBundlePath("Applications/Zed.app")).toBe(false);
    expect(isValidApplicationBundlePath("")).toBe(false);
  });

  it("rejects paths with parent directory segments", () => {
    expect(isValidApplicationBundlePath("/Applications/../tmp/Evil.app")).toBe(false);
    expect(isValidApplicationBundlePath("/Applications/Safari.app/../../usr/bin/say")).toBe(false);
  });

  it("rejects absolute paths that are not .app bundles", () => {
    expect(isValidApplicationBundlePath("/usr/bin/say")).toBe(false);
    expect(isValidApplicationBundlePath("/Applications/Zed.app/Contents/MacOS/zed")).toBe(false);
  });
});

describe("openInTerminal", () => {
  it("rejects terminal overrides that are not absolute .app bundle paths", async () => {
    const response = await openInTerminal(
      { path: "/Users/demo" },
      {
        appPath: "Applications/iTerm.app",
        appName: "iTerm",
      },
    );

    expect(response.ok).toBe(false);
    expect(response.error).toContain("Invalid application path");
    expect(response.terminalName).toBe("iTerm");
  });
});

describe("resolveApplicationDisplayName", () => {
  it("derives the display name from the app bundle path", () => {
    expect(resolveApplicationDisplayName("/Applications/Visual Studio Code.app")).toBe(
      "Visual Studio Code",
    );
    expect(resolveApplicationDisplayName("Finder")).toBe("Finder");
  });
});

describe("openPathsWithApplication", () => {
  it("launches selected paths with the requested application", async () => {
    const runOpenCommand = vi.fn(async () => undefined);

    await expect(
      openPathsWithApplication(
        {
          applicationPath: "/Applications/Zed.app",
          paths: ["/Users/demo/file.txt", "/Users/demo/folder"],
        },
        runOpenCommand,
      ),
    ).resolves.toEqual({
      ok: true,
      error: null,
    });

    expect(runOpenCommand).toHaveBeenCalledWith("/Applications/Zed.app", [
      "/Users/demo/file.txt",
      "/Users/demo/folder",
    ]);
  });

  it("shows the selected paths in Finder instead of opening them with it", async () => {
    const runOpenCommand = vi.fn(async () => undefined);
    const revealInFinder = vi.fn(async () => undefined);

    await expect(
      openPathsWithApplication(
        {
          applicationPath: "/System/Library/CoreServices/Finder.app",
          paths: ["/Users/demo/file.txt", "/Users/demo/folder", "/Applications/Zed.app"],
        },
        runOpenCommand,
        revealInFinder,
      ),
    ).resolves.toEqual({
      ok: true,
      error: null,
    });

    expect(revealInFinder).toHaveBeenCalledWith([
      "/Users/demo/file.txt",
      "/Users/demo/folder",
      "/Applications/Zed.app",
    ]);
    expect(runOpenCommand).not.toHaveBeenCalled();
  });

  it("returns the launch error when opening with an application fails", async () => {
    await expect(
      openPathsWithApplication(
        {
          applicationPath: "/Applications/Zed.app",
          paths: ["/Users/demo/file.txt"],
        },
        async () => {
          throw new Error("Application not found");
        },
      ),
    ).resolves.toEqual({
      ok: false,
      error: "Application not found",
    });
  });

  it("rejects application paths that are not absolute .app bundles", async () => {
    const runOpenCommand = vi.fn(async () => undefined);

    const response = await openPathsWithApplication(
      {
        applicationPath: "Finder",
        paths: ["/Users/demo/file.txt"],
      },
      runOpenCommand,
    );

    expect(response.ok).toBe(false);
    expect(response.error).toContain("Invalid application path");
    expect(runOpenCommand).not.toHaveBeenCalled();
  });

  it("rejects application paths containing parent directory segments", async () => {
    const runOpenCommand = vi.fn(async () => undefined);

    const response = await openPathsWithApplication(
      {
        applicationPath: "/Applications/../private/Evil.app",
        paths: ["/Users/demo/file.txt"],
      },
      runOpenCommand,
    );

    expect(response.ok).toBe(false);
    expect(response.error).toContain("Invalid application path");
    expect(runOpenCommand).not.toHaveBeenCalled();
  });
});

describe("performEditAction", () => {
  it("dispatches native edit actions to webContents", () => {
    const webContents = {
      copy: vi.fn(),
      cut: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
    };

    expect(performEditAction({ action: "cut" }, webContents)).toEqual({ ok: true });
    expect(performEditAction({ action: "copy" }, webContents)).toEqual({ ok: true });
    expect(performEditAction({ action: "paste" }, webContents)).toEqual({ ok: true });
    expect(performEditAction({ action: "selectAll" }, webContents)).toEqual({ ok: true });

    expect(webContents.cut).toHaveBeenCalledTimes(1);
    expect(webContents.copy).toHaveBeenCalledTimes(1);
    expect(webContents.paste).toHaveBeenCalledTimes(1);
    expect(webContents.selectAll).toHaveBeenCalledTimes(1);
  });
});
