import { resolveTerminalApplicationName, toPreferencePatch } from "./bootstrap";

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
