import {
  ACCENT_OPTIONS,
  DEFAULT_ACCENT,
  DEFAULT_APP_PREFERENCES,
  DETAIL_COLUMN_WIDTH_LIMITS,
  clampDetailColumnWidth,
  clampNotificationDurationSeconds,
  clampOpenItemLimit,
  clampPaneWidth,
  clampZoomPercent,
  getThemeLabel,
  getUiFontLabel,
  resolveEffectiveTheme,
} from "./appPreferences";
import { DEFAULT_LEFT_TOOLBAR_ITEMS, DEFAULT_TOP_TOOLBAR_ITEMS } from "./toolbarItems";

describe("appPreferences helpers", () => {
  it("clamps numeric preferences and rounds to whole pixels", () => {
    expect(clampPaneWidth(279.6, 200, 320)).toBe(280);
    expect(clampPaneWidth(99.2, 200, 320)).toBe(200);
    expect(clampNotificationDurationSeconds(1.2)).toBe(2);
    expect(clampNotificationDurationSeconds(10.8)).toBe(10);
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

  it("resolves known labels and falls back to the raw stored value", () => {
    expect(getThemeLabel("tomorrow-night")).toBe("Tomorrow Night");
    expect(getThemeLabel("warm-paper")).toBe("Warm Paper");
    expect(getUiFontLabel("jetbrains-mono")).toBe("JetBrains Mono");
    expect(getThemeLabel("aurora" as never)).toBe("aurora");
    expect(getUiFontLabel("mono" as never)).toBe("mono");
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
      autoLightTheme: "macos-light",
      autoDarkTheme: "macos-dark",
      accent: "#007aff",
      zoomPercent: 100,
      uiFontFamily: "system",
      viewMode: "list",
      sortBy: "name",
      sortDirection: "asc",
      foldersFirst: true,
      singleClickExpandTreeItems: false,
      highlightHoveredItems: false,
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
        modified: 168,
        permissions: 148,
        kind: 148,
        created: 168,
      },
      restoreLastVisitedFolderOnStartup: false,
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      propertiesOpen: false,
      topToolbarItems: DEFAULT_TOP_TOOLBAR_ITEMS,
      leftToolbarItems: {
        main: DEFAULT_LEFT_TOOLBAR_ITEMS.main,
        utility: DEFAULT_LEFT_TOOLBAR_ITEMS.utility,
      },
      defaultTextEditor: {
        appPath: "/System/Applications/TextEdit.app",
        appName: "TextEdit",
      },
      fileActivationAction: "open",
      openItemLimit: 5,
      treeRootPath: null,
      lastVisitedPath: null,
      lastVisitedFavoritePath: null,
      favoritesPlacement: "separate",
    });
  });

  it("resolves auto to the light or dark palette from the macOS appearance", () => {
    expect(resolveEffectiveTheme("auto", false, "sand", "tomorrow-night")).toBe("sand");
    expect(resolveEffectiveTheme("auto", true, "sand", "tomorrow-night")).toBe("tomorrow-night");
    expect(resolveEffectiveTheme("catppuccin-mocha", false, "sand", "tomorrow-night")).toBe(
      "catppuccin-mocha",
    );
    expect(getThemeLabel("auto")).toBe("Auto (follow macOS)");
  });
});
