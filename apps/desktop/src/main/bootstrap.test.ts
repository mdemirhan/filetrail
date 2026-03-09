import {
  openPathsWithApplication,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
  toPreferencePatch,
} from "./bootstrap";

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
        terminalApp: "iTerm",
      }),
    ).toEqual({
      terminalApp: "iTerm",
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
    expect(resolveTerminalApplicationName("   ")).toBe("Terminal");
  });

  it("uses the configured terminal app override", () => {
    expect(resolveTerminalApplicationName("iTerm")).toBe("iTerm");
    expect(resolveTerminalApplicationName("  Ghostty  ")).toBe("Ghostty");
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
