import {
  DEFAULT_APP_PREFERENCES,
  DETAIL_COLUMN_WIDTH_LIMITS,
  clampDetailColumnWidth,
  clampFontSize,
  clampFontWeight,
  clampNotificationDurationSeconds,
  clampOpenItemLimit,
  clampPaneWidth,
  clampTypeaheadDebounceMs,
  clampZoomPercent,
  getAccentLabel,
  getThemeLabel,
  getUiFontLabel,
} from "./appPreferences";

describe("appPreferences helpers", () => {
  it("clamps numeric preferences and rounds to whole pixels", () => {
    expect(clampPaneWidth(279.6, 200, 320)).toBe(280);
    expect(clampPaneWidth(99.2, 200, 320)).toBe(200);
    expect(clampFontSize(14.6, 12, 15)).toBe(15);
    expect(clampTypeaheadDebounceMs(1600.4, 250, 1500)).toBe(1500);
    expect(clampNotificationDurationSeconds(1.2)).toBe(2);
    expect(clampNotificationDurationSeconds(10.8)).toBe(10);
    expect(clampOpenItemLimit(0.3)).toBe(1);
    expect(clampOpenItemLimit(51.2)).toBe(50);
    expect(clampZoomPercent(106.8)).toBe(107);
    expect(clampZoomPercent(500)).toBe(150);
  });

  it("keeps font weight within the allowed set", () => {
    expect(clampFontWeight(500, [400, 500, 600])).toBe(500);
    expect(clampFontWeight(700, [400, 500, 600])).toBe(400);
    expect(clampFontWeight(700, [400, 500, 600], 600)).toBe(600);
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
    expect(getThemeLabel("midnight")).toBe("Midnight");
    expect(getAccentLabel("lavender")).toBe("Lavender");
    expect(getAccentLabel("emerald")).toBe("Emerald");
    expect(getUiFontLabel("jetbrains-mono")).toBe("JetBrains Mono");
    expect(getThemeLabel("aurora" as never)).toBe("aurora");
    expect(getAccentLabel("sunset" as never)).toBe("sunset");
    expect(getUiFontLabel("mono" as never)).toBe("mono");
  });

  it("ships expected defaults for the persisted preference shape", () => {
    expect(DEFAULT_APP_PREFERENCES).toMatchObject({
      theme: "dark",
      accent: "copper",
      accentToolbarButtons: false,
      accentFavoriteItems: true,
      favoriteAccent: "sky",
      zoomPercent: 100,
      uiFontFamily: "lexend",
      uiFontSize: 13,
      uiFontWeight: 500,
      viewMode: "list",
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
        size: true,
        modified: true,
        permissions: true,
      },
      detailColumnWidths: {
        name: 320,
        size: 108,
        modified: 168,
        permissions: 148,
      },
      restoreLastVisitedFolderOnStartup: false,
      typeaheadDebounceMs: 1000,
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      propertiesOpen: false,
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
      favoritesPaneHeight: null,
    });
  });
});
