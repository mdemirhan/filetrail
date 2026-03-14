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
  openPathsWithApplication,
  performEditAction,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
} from "./bootstrap/systemHandlers";

describe("toPreferencePatch", () => {
  it("preserves search result sorting fields", () => {
    expect(
      toPreferencePatch({
        searchResultsSortBy: "name",
        searchResultsSortDirection: "desc",
        searchResultsFilterScope: "path",
      }),
    ).toEqual({
      searchResultsSortBy: "name",
      searchResultsSortDirection: "desc",
      searchResultsFilterScope: "path",
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
        },
        detailColumnWidths: {
          name: 360,
          size: 120,
          modified: 180,
          permissions: 160,
        },
      }),
    ).toEqual({
      compactDetailsView: true,
      detailColumns: {
        size: true,
        modified: false,
        permissions: true,
      },
      detailColumnWidths: {
        name: 360,
        size: 120,
        modified: 180,
        permissions: 160,
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

  it("uses the configured terminal app override", () => {
    expect(
      resolveTerminalApplicationName({
        appPath: "/Applications/iTerm.app",
        appName: "iTerm",
      }),
    ).toBe("/Applications/iTerm.app");
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

  it("returns the launch error when opening with an application fails", async () => {
    await expect(
      openPathsWithApplication(
        {
          applicationPath: "Finder",
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
