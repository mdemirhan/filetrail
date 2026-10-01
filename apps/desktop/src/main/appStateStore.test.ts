import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type StoredWindowState, createAppStateStore, resolveAppStatePath } from "./appStateStore";

describe("appStateStore", () => {
  it("persists through a temp file so a failed write keeps the previous state", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const store = createAppStateStore(filePath, { defaultTheme: "dark" });
    store.updatePreferences({ favoritesExpanded: false });
    store.flush();
    const persisted = readFileSync(filePath, "utf8");
    expect(JSON.parse(persisted).preferences.favoritesExpanded).toBe(false);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);

    const onPersistError = vi.fn();
    const failingStore = createAppStateStore(filePath, {
      defaultTheme: "dark",
      onPersistError,
      fs: {
        existsSync,
        mkdirSync: () => undefined,
        readFileSync: (path, encoding) => readFileSync(path, encoding),
        writeFileSync: () => {
          throw new Error("disk full");
        },
        renameSync: () => {
          throw new Error("rename should not run after a failed write");
        },
      },
    });
    failingStore.updatePreferences({ favoritesExpanded: true });
    failingStore.flush();

    expect(onPersistError).toHaveBeenCalledWith(new Error("disk full"));
    expect(readFileSync(filePath, "utf8")).toBe(persisted);
  });

  it("returns defaults when no state file exists", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const store = createAppStateStore(resolveAppStatePath(userDataPath), {
      defaultTheme: "tomorrow-night",
    });

    expect(store.getPreferences()).toEqual({
      theme: "tomorrow-night",
      autoLightTheme: "macos-light",
      autoDarkTheme: "macos-dark",
      showSidebarRail: false,
      showSidebarBottomRail: true,
      returnKeyAction: "rename",
      iconTheme: "native",
      accent: "#d4845a",
      accentToolbarButtons: false,
      toolbarAccent: "#d4845a",
      accentFavoriteItems: true,
      accentFavoriteText: false,
      favoriteAccent: "#58b9e8",
      zoomPercent: 100,
      uiFontFamily: "system",
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
      viewMode: "list",
      sortBy: "name",
      sortDirection: "asc",
      foldersFirst: true,
      compactListView: false,
      compactDetailsView: false,
      compactTreeView: false,
      singleClickExpandTreeItems: false,
      highlightHoveredItems: false,
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
      tabSwitchesExplorerPanes: true,
      typeaheadEnabled: true,
      typeaheadDebounceMs: 1000,
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      actionLogEnabled: true,
      propertiesOpen: false,
      detailRowOpen: false,
      topToolbarItems: ["back", "forward", "view", "sort", "infoPanel", "search"],
      leftToolbarItems: {
        main: [
          "home",
          "root",
          "applications",
          "trash",
          "leftSeparator",
          "rerootHome",
          "goToFolder",
          "leftSeparator",
          "foldersFirst",
          "hidden",
          "infoPanel",
          "infoRow",
        ],
        utility: ["actionLog", "help", "leftSeparator", "theme", "settings"],
      },
      terminalApp: null,
      defaultTextEditor: {
        appPath: "/System/Applications/TextEdit.app",
        appName: "TextEdit",
      },
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
      fileActivationAction: "open",
      openItemLimit: 5,
      includeHidden: false,
      searchPatternMode: "regex",
      searchMatchScope: "name",
      searchRecursive: true,
      searchSkipGitFolders: true,
      searchSkipGitIgnored: false,
      searchResultsSortBy: "path",
      searchResultsSortDirection: "asc",
      searchResultsFilterScope: "name",
      treeWidth: 280,
      inspectorWidth: 320,
      restoreLastVisitedFolderOnStartup: false,
      treeRootPath: null,
      lastVisitedPath: null,
      lastVisitedFavoritePath: null,
      lastGoToFolderPath: null,
      favorites: [],
      favoritesPlacement: "separate",
      favoritesPaneHeight: null,
      favoritesExpanded: true,
      favoritesInitialized: false,
    });
    expect(store.getWindowState()).toEqual({
      width: 1480,
      height: 920,
      maximized: false,
    });
  });

  it("persists preferences and window state in one file", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const store = createAppStateStore(resolveAppStatePath(userDataPath), {
      defaultTheme: "dark",
    });

    store.updatePreferences({
      theme: "dark",
      iconTheme: "colorblock",
      accent: "#2cb5a0",
      accentToolbarButtons: false,
      toolbarAccent: "#daa520",
      accentFavoriteItems: true,
      accentFavoriteText: true,
      favoriteAccent: "#e8806a",
      zoomPercent: 115,
      uiFontFamily: "lexend",
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
      viewMode: "details",
      sortBy: "modified",
      sortDirection: "desc",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactTreeView: true,
      singleClickExpandTreeItems: true,
      highlightHoveredItems: false,
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
      tabSwitchesExplorerPanes: false,
      typeaheadEnabled: false,
      typeaheadDebounceMs: 1000,
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      actionLogEnabled: true,
      topToolbarItems: ["back", "search", "copyPath"],
      leftToolbarItems: {
        main: ["home", "copyPath"],
        utility: ["settings", "openInTerminal"],
      },
      terminalApp: {
        appPath: "/Applications/iTerm.app",
        appName: "iTerm",
      },
      defaultTextEditor: {
        appPath: "/Applications/Zed.app",
        appName: "Zed",
      },
      openWithApplications: [
        {
          id: "zed",
          appPath: "/Applications/Zed.app",
          appName: "Zed",
        },
      ],
      fileActivationAction: "edit",
      openItemLimit: 9,
      includeHidden: true,
      searchPatternMode: "glob",
      searchMatchScope: "path",
      searchRecursive: false,
      searchSkipGitFolders: true,
      searchSkipGitIgnored: false,
      searchResultsSortBy: "name",
      searchResultsSortDirection: "desc",
      searchResultsFilterScope: "path",
      propertiesOpen: false,
      detailRowOpen: true,
      treeWidth: 312,
      inspectorWidth: 388,
      restoreLastVisitedFolderOnStartup: true,
      treeRootPath: "/Users/demo",
      lastVisitedPath: "/Users/demo/src",
      lastVisitedFavoritePath: "/Users/demo/Documents",
      lastGoToFolderPath: "/Users/demo/src",
      favorites: [
        { path: "/Users/demo/Documents", icon: "documents" },
        { path: "/Applications", icon: "applications" },
      ],
      favoritesPlacement: "separate",
      favoritesPaneHeight: 224,
      favoritesExpanded: false,
      favoritesInitialized: true,
    });
    store.setWindowState({
      x: 120,
      y: 140,
      width: 1600,
      height: 1000,
      maximized: true,
    } satisfies StoredWindowState);
    store.flush();

    const reloaded = createAppStateStore(resolveAppStatePath(userDataPath), {
      defaultTheme: "dark",
    });
    expect(reloaded.getPreferences()).toEqual({
      theme: "dark",
      autoLightTheme: "macos-light",
      autoDarkTheme: "macos-dark",
      showSidebarRail: false,
      showSidebarBottomRail: true,
      returnKeyAction: "rename",
      iconTheme: "colorblock",
      accent: "#2cb5a0",
      accentToolbarButtons: false,
      toolbarAccent: "#daa520",
      accentFavoriteItems: true,
      accentFavoriteText: true,
      favoriteAccent: "#e8806a",
      zoomPercent: 115,
      uiFontFamily: "lexend",
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
      viewMode: "details",
      sortBy: "modified",
      sortDirection: "desc",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactTreeView: true,
      singleClickExpandTreeItems: true,
      highlightHoveredItems: false,
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
      tabSwitchesExplorerPanes: false,
      typeaheadEnabled: false,
      typeaheadDebounceMs: 1000,
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      actionLogEnabled: true,
      topToolbarItems: ["back", "search", "copyPath"],
      leftToolbarItems: {
        main: ["home", "copyPath"],
        utility: ["settings", "openInTerminal"],
      },
      terminalApp: {
        appPath: "/Applications/iTerm.app",
        appName: "iTerm",
      },
      defaultTextEditor: {
        appPath: "/Applications/Zed.app",
        appName: "Zed",
      },
      openWithApplications: [
        {
          id: "zed",
          appPath: "/Applications/Zed.app",
          appName: "Zed",
        },
      ],
      fileActivationAction: "edit",
      openItemLimit: 9,
      includeHidden: true,
      searchPatternMode: "glob",
      searchMatchScope: "path",
      searchRecursive: false,
      searchSkipGitFolders: true,
      searchSkipGitIgnored: false,
      searchResultsSortBy: "name",
      searchResultsSortDirection: "desc",
      searchResultsFilterScope: "path",
      propertiesOpen: false,
      detailRowOpen: true,
      treeWidth: 312,
      inspectorWidth: 388,
      restoreLastVisitedFolderOnStartup: true,
      treeRootPath: "/Users/demo",
      lastVisitedPath: "/Users/demo/src",
      lastVisitedFavoritePath: "/Users/demo/Documents",
      lastGoToFolderPath: "/Users/demo/src",
      favorites: [
        { path: "/Users/demo/Documents", icon: "documents" },
        { path: "/Applications", icon: "applications" },
      ],
      favoritesPlacement: "separate",
      favoritesPaneHeight: 224,
      favoritesExpanded: false,
      favoritesInitialized: true,
    });
    expect(reloaded.getWindowState()).toEqual({
      x: 120,
      y: 140,
      width: 1600,
      height: 1000,
      maximized: true,
    });
  });

  it("keeps auto themes and rejects auto palettes from the wrong appearance", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    writeFileSync(
      filePath,
      JSON.stringify({
        preferences: { theme: "auto", autoLightTheme: "obsidian", autoDarkTheme: "midnight" },
      }),
      "utf8",
    );

    const preferences = createAppStateStore(filePath, { defaultTheme: "auto" }).getPreferences();

    expect(preferences.theme).toBe("auto");
    expect(preferences.autoLightTheme).toBe("macos-light");
    expect(preferences.autoDarkTheme).toBe("midnight");
  });

  it("upgrades an untouched legacy toolbar to the new default but keeps customized ones", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const legacy = [
      "back",
      "forward",
      "topSeparator",
      "up",
      "down",
      "refresh",
      "topSeparator",
      "view",
      "sort",
      "search",
    ];
    writeFileSync(filePath, JSON.stringify({ preferences: { topToolbarItems: legacy } }), "utf8");
    expect(createAppStateStore(filePath).getPreferences().topToolbarItems).toEqual([
      "back",
      "forward",
      "view",
      "sort",
      "infoPanel",
      "search",
    ]);

    writeFileSync(
      filePath,
      JSON.stringify({ preferences: { topToolbarItems: ["back", "refresh", "search"] } }),
      "utf8",
    );
    expect(createAppStateStore(filePath).getPreferences().topToolbarItems).toEqual([
      "back",
      "refresh",
      "search",
    ]);
  });

  it("adds Macintosh HD to favorites saved before it became a default favorite", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const savedFavorites = [
      { path: "/Users/demo", icon: "home" },
      { path: "/Users/demo/.Trash", icon: "trash" },
    ];
    const withFavorites = (extra: Record<string, unknown>) =>
      JSON.stringify({
        preferences: { favorites: savedFavorites, favoritesInitialized: true, ...extra },
      });

    // Saved by the Locations sidebar (still has its collapse flag): inserted ahead of Trash.
    writeFileSync(filePath, withFavorites({ showSidebarRail: false, locationsExpanded: true }));
    expect(createAppStateStore(filePath).getPreferences().favorites).toEqual([
      { path: "/Users/demo", icon: "home" },
      { path: "/", icon: "drive" },
      { path: "/Users/demo/.Trash", icon: "trash" },
    ]);

    // Saved before the native sidebar existed.
    writeFileSync(filePath, withFavorites({}));
    expect(createAppStateStore(filePath).getPreferences().favorites).toHaveLength(3);

    // Saved after the change: a removed Macintosh HD stays removed.
    writeFileSync(filePath, withFavorites({ showSidebarRail: false }));
    expect(createAppStateStore(filePath).getPreferences().favorites).toEqual(savedFavorites);
  });

  it("sanitizes invalid persisted values", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const store = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });
    store.updatePreferences({
      accent: "bad-accent" as never,
      accentToolbarButtons: "nope" as never,
      toolbarAccent: "bad-accent" as never,
      accentFavoriteItems: "nope" as never,
      accentFavoriteText: "nope" as never,
      favoriteAccent: "bad-accent" as never,
      zoomPercent: 999,
      sortBy: "oops" as never,
      sortDirection: "sideways" as never,
      topToolbarItems: ["back", "search", "search", "theme"] as never,
      leftToolbarItems: {
        main: ["home", "search", "copyPath"],
        utility: ["copyPath", "theme", "sort"],
      } as never,
      uiFontFamily: "bad-font" as never,
      // Settings that no longer exist are dropped when loading.
      ...({ uiFontSize: 15, uiFontWeight: 600 } as object),
      textPrimaryOverride: "oops" as never,
      typeaheadDebounceMs: 9999,
      terminalApp: {
        appPath: "   ",
        appName: "iTerm",
      } as never,
      defaultTextEditor: {
        appPath: "   ",
        appName: "TextEdit",
      } as never,
      openWithApplications: [
        {
          id: "",
          appPath: "/Applications/Bad.app",
          appName: "Bad",
        },
      ] as never,
      compactDetailsView: "yes" as never,
      detailColumns: {
        size: "nope",
        modified: false,
        permissions: true,
      } as never,
      detailColumnWidths: {
        name: 9999,
        size: 1,
        modified: 180,
        permissions: 100,
      } as never,
      fileActivationAction: "launch" as never,
      openItemLimit: 999,
      treeWidth: 1,
      inspectorWidth: 9999,
      treeRootPath: "",
      lastVisitedPath: "",
      lastVisitedFavoritePath: "",
    });
    store.flush();

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });
    expect(reloaded.getPreferences().accent).toBe("#d4845a");
    expect(reloaded.getPreferences().accentToolbarButtons).toBe(false);
    expect(reloaded.getPreferences().toolbarAccent).toBe("#d4845a");
    expect(reloaded.getPreferences().accentFavoriteItems).toBe(true);
    expect(reloaded.getPreferences().accentFavoriteText).toBe(false);
    expect(reloaded.getPreferences().favoriteAccent).toBe("#58b9e8");
    expect(reloaded.getPreferences().zoomPercent).toBe(150);
    expect(reloaded.getPreferences().sortBy).toBe("name");
    expect(reloaded.getPreferences().sortDirection).toBe("asc");
    expect(reloaded.getPreferences().topToolbarItems).toEqual(["back", "search"]);
    expect(reloaded.getPreferences().leftToolbarItems).toEqual({
      main: ["home", "copyPath"],
      utility: ["copyPath", "theme"],
    });
    expect(reloaded.getPreferences().treeWidth).toBe(220);
    expect(reloaded.getPreferences().inspectorWidth).toBe(480);
    expect(reloaded.getPreferences().accent).toBe("#d4845a");
    expect(reloaded.getPreferences().uiFontFamily).toBe("system");
    expect(reloaded.getPreferences()).not.toHaveProperty("uiFontSize");
    expect(reloaded.getPreferences()).not.toHaveProperty("uiFontWeight");
    expect(reloaded.getPreferences().textPrimaryOverride).toBeNull();
    expect(reloaded.getPreferences().typeaheadDebounceMs).toBe(1500);
    expect(reloaded.getPreferences().terminalApp).toBeNull();
    expect(reloaded.getPreferences().defaultTextEditor).toEqual({
      appPath: "/System/Applications/TextEdit.app",
      appName: "TextEdit",
    });
    expect(reloaded.getPreferences().openWithApplications).toEqual([
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
    ]);
    expect(reloaded.getPreferences().compactDetailsView).toBe(false);
    expect(reloaded.getPreferences().detailColumns).toEqual({
      size: true,
      modified: false,
      permissions: true,
    });
    expect(reloaded.getPreferences().detailColumnWidths).toEqual({
      name: 720,
      size: 84,
      modified: 180,
      permissions: 132,
    });
    expect(reloaded.getPreferences().fileActivationAction).toBe("open");
    expect(reloaded.getPreferences().openItemLimit).toBe(50);
    expect(reloaded.getPreferences().treeRootPath).toBeNull();
    expect(reloaded.getPreferences().lastVisitedPath).toBeNull();
    expect(reloaded.getPreferences().lastVisitedFavoritePath).toBeNull();
  });

  it("migrates legacy favorite path arrays into favorite entries", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const store = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });

    store.updatePreferences({
      favoritesExpanded: false,
      favoritesInitialized: true,
    });
    store.flush();

    const fileContents = `{
  "preferences": {
    "theme": "dark",
    "favoritePaths": ["/Users/demo/Documents", "/Applications", "/Users/demo/Documents"],
    "favoritesExpanded": false,
    "favoritesInitialized": true
  }
}\n`;
    writeFileSync(filePath, fileContents, "utf8");

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });

    // State this old also predates Macintosh HD as a default favorite.
    expect(reloaded.getPreferences().favorites).toEqual([
      { path: "/Users/demo/Documents", icon: "documents" },
      { path: "/Applications", icon: "applications" },
      { path: "/", icon: "drive" },
    ]);
    expect(reloaded.getPreferences().lastVisitedFavoritePath).toBeNull();
  });

  it("preserves an explicitly empty open with application list", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const store = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });

    store.updatePreferences({
      openWithApplications: [],
    });
    store.flush();

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });

    expect(reloaded.getPreferences().openWithApplications).toEqual([]);
  });
});
