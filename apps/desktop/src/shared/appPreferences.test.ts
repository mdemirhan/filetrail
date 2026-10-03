import {
  ACCENT_OPTIONS,
  DEFAULT_ACCENT,
  DEFAULT_APP_PREFERENCES,
  DETAIL_COLUMN_WIDTH_LIMITS,
  THEME_OPTIONS,
  clampDetailColumnWidth,
  clampOpenItemLimit,
  clampPaneWidth,
  clampZoomPercent,
  resolveEffectiveTheme,
  resolveSavedTheme,
} from "./appPreferences";
import { DEFAULT_TOP_TOOLBAR_ITEMS } from "./toolbarItems";

describe("appPreferences helpers", () => {
  it("clamps numeric preferences and rounds to whole pixels", () => {
    expect(clampPaneWidth(279.6, 200, 320)).toBe(280);
    expect(clampPaneWidth(99.2, 200, 320)).toBe(200);
    expect(clampOpenItemLimit(0.3)).toBe(1);
    expect(clampOpenItemLimit(51.2)).toBe(50);
    expect(clampZoomPercent(106.8)).toBe(107);
    expect(clampZoomPercent(500)).toBe(150);
  });

  it("clamps detail column widths using per-column limits", () => {
    expect(clampDetailColumnWidth("name", 719.8)).toBe(720);
    expect(clampDetailColumnWidth("size", 10)).toBe(DETAIL_COLUMN_WIDTH_LIMITS.size.min);
    expect(clampDetailColumnWidth("permissions", 400)).toBe(
      DETAIL_COLUMN_WIDTH_LIMITS.permissions.max,
    );
  });

  it("offers Auto, Light and Dark, and reads a saved palette as its side", () => {
    expect(THEME_OPTIONS.map((option) => option.label)).toEqual(["Auto", "Light", "Dark"]);
    expect(resolveSavedTheme("auto")).toBe("auto");
    expect(resolveSavedTheme("dark")).toBe("dark");
    expect(resolveSavedTheme("macos-light")).toBe("light");
    expect(resolveSavedTheme("warm-paper")).toBe("light");
    expect(resolveSavedTheme("sand")).toBe("light");
    expect(resolveSavedTheme("macos-dark")).toBe("dark");
    expect(resolveSavedTheme("catppuccin-mocha")).toBe("dark");
    expect(resolveSavedTheme("tomorrow-night")).toBe("dark");
    expect(resolveSavedTheme("aurora")).toBeNull();
    expect(resolveSavedTheme(7)).toBeNull();
  });

  it("defaults to blue, the first accent offered", () => {
    expect(ACCENT_OPTIONS[0]).toEqual({ value: "#007aff", label: "Blue" });
    expect(DEFAULT_ACCENT).toBe("#007aff");
    expect(DEFAULT_APP_PREFERENCES.accent).toBe(DEFAULT_ACCENT);
    expect(new Set(ACCENT_OPTIONS.map((option) => option.value)).size).toBe(ACCENT_OPTIONS.length);
  });

  it("ships expected defaults for the persisted preference shape", () => {
    expect(DEFAULT_APP_PREFERENCES).toMatchObject({
      theme: "auto",
      accent: "#007aff",
      zoomPercent: 100,
      viewMode: "details",
      sortBy: "name",
      sortDirection: "asc",
      foldersFirst: true,
      singleClickExpandTreeItems: false,
      terminalApp: null,
      openWithApplications: [
        {
          id: "visual-studio-code",
          appPath: "/Applications/Visual Studio Code.app",
          appName: "Visual Studio Code",
        },
        {
          id: "sublime-text",
          appPath: "/Applications/Sublime Text.app",
          appName: "Sublime Text",
        },
        {
          id: "zed",
          appPath: "/Applications/Zed.app",
          appName: "Zed",
        },
      ],
      detailColumns: {
        modified: true,
        size: true,
        kind: true,
        created: false,
        permissions: false,
      },
      detailColumnWidths: {
        name: 320,
        size: 108,
        modified: 152,
        permissions: 108,
        kind: 148,
        created: 152,
      },
      restoreSessionOnStartup: true,
      notificationsEnabled: true,
      markClipboardItems: true,
      propertiesOpen: false,
      topToolbarItems: DEFAULT_TOP_TOOLBAR_ITEMS,
      defaultTextEditor: {
        appPath: "/System/Applications/TextEdit.app",
        appName: "TextEdit",
      },
      fileActivationAction: "open",
      openItemLimit: 5,
      treeRootPath: null,
      lastVisitedPath: null,
      lastVisitedFavoritePath: null,
      favoritesPlacement: "integrated",
    });
  });

  it("resolves auto to light or dark from the macOS appearance", () => {
    expect(resolveEffectiveTheme("auto", false)).toBe("light");
    expect(resolveEffectiveTheme("auto", true)).toBe("dark");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
  });
});
