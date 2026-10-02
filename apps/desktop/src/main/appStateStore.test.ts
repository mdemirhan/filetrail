import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type StoredWindowState, createAppStateStore, resolveAppStatePath } from "./appStateStore";

describe("appStateStore", () => {
  it("persists through a temp file so a failed write keeps the previous state", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const store = createAppStateStore(filePath, { defaultTheme: "macos-dark" });
    store.updatePreferences({ favoritesExpanded: false });
    store.flush();
    const persisted = readFileSync(filePath, "utf8");
    expect(JSON.parse(persisted).preferences.favoritesExpanded).toBe(false);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);

    const onPersistError = vi.fn();
    const failingStore = createAppStateStore(filePath, {
      defaultTheme: "macos-dark",
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

  // A store whose timers only run when the test says so, counting the writes it makes.
  function createTimedStore() {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const timers = new Map<number, { callback: () => void; delayMs: number }>();
    let nextTimerId = 1;
    let writes = 0;
    const store = createAppStateStore(filePath, {
      defaultTheme: "macos-dark",
      timer: {
        setTimeout: (callback, delayMs) => {
          timers.set(nextTimerId, { callback, delayMs });
          return nextTimerId++ as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout: (timer) => {
          timers.delete(timer as unknown as number);
        },
      },
      fs: {
        existsSync,
        mkdirSync: () => undefined,
        readFileSync: (path, encoding) => readFileSync(path, encoding),
        writeFileSync: (path, data, encoding) => {
          writes += 1;
          writeFileSync(path, data, encoding);
        },
        renameSync: (from, to) => renameSync(from, to),
      },
    });
    return {
      store,
      filePath,
      writes: () => writes,
      pendingDelays: () => [...timers.values()].map((timer) => timer.delayMs),
      runTimers: () => {
        for (const [id, timer] of [...timers]) {
          // A timer cancelled by one that ran before it does not run.
          if (timers.delete(id)) {
            timer.callback();
          }
        }
      },
    };
  }

  it("writes a deliberate change promptly", () => {
    const { store, filePath, writes, pendingDelays, runTimers } = createTimedStore();

    store.updatePreferences({ foldersFirst: false });
    store.updatePreferences({ favoritesExpanded: false });
    // A burst of changes is one write, a moment later.
    expect(pendingDelays()).toEqual([150]);
    runTimers();

    expect(writes()).toBe(1);
    expect(JSON.parse(readFileSync(filePath, "utf8")).preferences.foldersFirst).toBe(false);

    store.forgetVisitedFolder("/Users/demo/gone");
    expect(pendingDelays()).toEqual([150]);
  });

  it("keeps where the user is for the quit-time write", () => {
    const { store, filePath, writes, pendingDelays, runTimers } = createTimedStore();

    store.updatePreferences({ lastVisitedPath: "/Users/demo/work", treeRootPath: "/Users/demo" });
    store.recordFolderVisit("/Users/demo/work", 1_000);
    store.setWindowState({ x: 10, y: 20, width: 900, height: 600, maximized: false });
    store.updatePreferences({ lastVisitedPath: "/Users/demo/music" });
    store.recordFolderVisit("/Users/demo/music", 2_000);

    // Nothing is written while browsing; one long timer bounds what a crash can lose, and
    // later navigation does not push it back.
    expect(writes()).toBe(0);
    expect(pendingDelays()).toEqual([5 * 60 * 1000]);

    store.flush();
    expect(writes()).toBe(1);
    expect(pendingDelays()).toEqual([]);
    const saved = JSON.parse(readFileSync(filePath, "utf8"));
    expect(saved.preferences.lastVisitedPath).toBe("/Users/demo/music");
    expect(saved.window).toMatchObject({ x: 10, width: 900 });
    expect(saved.visitedFolders).toHaveLength(2);

    // Nothing has changed since: quitting again writes nothing.
    store.flush();
    expect(writes()).toBe(1);

    // The long timer does write, for a session that stays open.
    store.recordFolderVisit("/Users/demo/work", 3_000);
    runTimers();
    expect(writes()).toBe(2);
  });

  it("keeps the open tabs for the quit-time write, but writes the setting at once", () => {
    const { store, filePath, writes, pendingDelays, runTimers } = createTimedStore();
    const tab = {
      path: "/Users/demo/work",
      treeRootPath: "/Users/demo",
      favoritePath: null,
      viewMode: "details" as const,
      sortBy: "name" as const,
      sortDirection: "asc" as const,
    };

    // Opening, switching and closing tabs is where the user is, not a setting.
    store.updatePreferences({ openTabs: [tab], activeTabIndex: 0 });
    store.updatePreferences({
      openTabs: [tab, { ...tab, path: "/Users/demo/music" }],
      activeTabIndex: 1,
    });
    expect(writes()).toBe(0);
    expect(pendingDelays()).toEqual([5 * 60 * 1000]);

    // Nor are the view mode and sort order, which are those of the tab on screen and change
    // with every switch to a tab that shows its folder differently.
    store.updatePreferences({ viewMode: "details", sortBy: "size", sortDirection: "desc" });
    store.updatePreferences({ searchResultsSortBy: "name", searchResultsSortDirection: "desc" });
    expect(writes()).toBe(0);
    expect(pendingDelays()).toEqual([5 * 60 * 1000]);

    // The same tabs again are not a change.
    store.updatePreferences({
      openTabs: [tab, { ...tab, path: "/Users/demo/music" }],
      activeTabIndex: 1,
    });
    store.flush();
    expect(writes()).toBe(1);
    const saved = JSON.parse(readFileSync(filePath, "utf8")).preferences;
    expect(saved.openTabs.map((savedTab: { path: string }) => savedTab.path)).toEqual([
      "/Users/demo/work",
      "/Users/demo/music",
    ]);
    expect(saved.activeTabIndex).toBe(1);
    expect(saved).toMatchObject({ viewMode: "details", sortBy: "size", sortDirection: "desc" });
    store.flush();
    expect(writes()).toBe(1);

    store.updatePreferences({ restoreOpenTabsOnStartup: true });
    expect(pendingDelays()).toEqual([150]);
    runTimers();
    expect(writes()).toBe(2);
  });

  it("keeps the saved tabs that make sense and drops the rest", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    writeFileSync(
      filePath,
      JSON.stringify({
        preferences: {
          restoreOpenTabsOnStartup: true,
          activeTabIndex: -3,
          openTabs: [
            {
              path: "/Users/demo/work",
              viewMode: "details",
              sortBy: "size",
              sortDirection: "desc",
            },
            "not a tab",
            { path: "", treeRootPath: 7, viewMode: "gallery", sortBy: "colour" },
          ],
        },
      }),
    );

    const preferences = createAppStateStore(filePath).getPreferences();

    expect(preferences.restoreOpenTabsOnStartup).toBe(true);
    expect(preferences.activeTabIndex).toBe(0);
    expect(preferences.openTabs).toEqual([
      {
        path: "/Users/demo/work",
        treeRootPath: null,
        favoritePath: null,
        viewMode: "details",
        sortBy: "size",
        sortDirection: "desc",
      },
      {
        path: null,
        treeRootPath: null,
        favoritePath: null,
        viewMode: "list",
        sortBy: "name",
        sortDirection: "asc",
      },
    ]);
  });

  it("writes navigation along with the next deliberate change, and nothing for no change", () => {
    const { store, filePath, writes, pendingDelays, runTimers } = createTimedStore();

    store.updatePreferences({ lastVisitedPath: "/Users/demo/work" });
    store.setWindowState({ width: 900, height: 600, maximized: false });
    store.updatePreferences({ foldersFirst: false });
    // The prompt write takes the place of the long timer.
    expect(pendingDelays()).toEqual([150]);
    runTimers();

    expect(writes()).toBe(1);
    expect(pendingDelays()).toEqual([]);
    expect(JSON.parse(readFileSync(filePath, "utf8")).preferences.lastVisitedPath).toBe(
      "/Users/demo/work",
    );

    // The same values again, and the same window, are not changes.
    store.updatePreferences({ foldersFirst: false, lastVisitedPath: "/Users/demo/work" });
    store.setWindowState(store.getWindowState());
    runTimers();
    store.flush();
    expect(writes()).toBe(1);
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
      shortcutOverrides: {},
      accent: "#007aff",
      zoomPercent: 100,
      uiFontFamily: "system",
      tabStyle: "accentLine",
      viewMode: "list",
      sortBy: "name",
      sortDirection: "asc",
      foldersFirst: true,
      compactListView: false,
      compactDetailsView: false,
      compactIconView: false,
      compactTreeView: false,
      singleClickExpandTreeItems: false,
      highlightHoveredItems: false,
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
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      highlightClipboardItemsInTree: true,
      highlightClipboardItemsInContent: true,
      notifyClipboardItems: true,
      propertiesOpen: false,
      detailRowOpen: false,
      topToolbarItems: [
        "back",
        "forward",
        "title",
        "view",
        "sort",
        "infoPanel",
        "clipboard",
        "viewOptions",
        "search",
      ],
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
        utility: ["help", "leftSeparator", "theme", "settings"],
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
      searchPatternMode: "text",
      searchMatchScope: "name",
      searchRecursive: true,
      searchSkipGitFolders: true,
      searchSkipGitIgnored: false,
      searchResultsSortBy: "path",
      searchResultsSortDirection: "asc",
      treeWidth: 280,
      inspectorWidth: 320,
      restoreLastVisitedFolderOnStartup: false,
      restoreOpenTabsOnStartup: false,
      openTabs: [],
      activeTabIndex: 0,
      treeRootPath: null,
      lastVisitedPath: null,
      lastVisitedFavoritePath: null,
      favorites: [],
      favoritesPlacement: "separate",
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
      defaultTheme: "macos-dark",
    });

    store.updatePreferences({
      theme: "macos-dark",
      // As a hand-edited file might have them: any order, a key that can not be given
      // out, a command that does not exist, and one that only repeats its default.
      shortcutOverrides: {
        newTab: ["option+cmd+n", "Cmd+C", "D"],
        duplicateSelection: [],
        closeTab: ["Cmd+W"],
        noSuchCommand: ["Cmd+J"],
      },
      accent: "#2cb5a0",
      zoomPercent: 115,
      uiFontFamily: "lexend",
      tabStyle: "cards",
      viewMode: "details",
      sortBy: "modified",
      sortDirection: "desc",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactIconView: true,
      compactTreeView: true,
      singleClickExpandTreeItems: true,
      highlightHoveredItems: false,
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
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      highlightClipboardItemsInTree: true,
      highlightClipboardItemsInContent: true,
      notifyClipboardItems: true,
      topToolbarItems: ["search", "back", "title", "copyPath", "clipboard", "viewOptions"],
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
      propertiesOpen: false,
      detailRowOpen: true,
      treeWidth: 312,
      inspectorWidth: 388,
      restoreLastVisitedFolderOnStartup: true,
      restoreOpenTabsOnStartup: true,
      openTabs: [
        {
          path: "/Users/demo/src",
          treeRootPath: "/Users/demo",
          favoritePath: null,
          viewMode: "details",
          sortBy: "size",
          sortDirection: "desc",
        },
        {
          path: "/Users/demo/Documents",
          treeRootPath: "/Users/demo",
          favoritePath: "/Users/demo/Documents",
          viewMode: "list",
          sortBy: "name",
          sortDirection: "asc",
        },
      ],
      activeTabIndex: 1,
      treeRootPath: "/Users/demo",
      lastVisitedPath: "/Users/demo/src",
      lastVisitedFavoritePath: "/Users/demo/Documents",
      favorites: [
        { path: "/Users/demo/Documents", icon: "documents" },
        { path: "/Applications", icon: "applications" },
      ],
      favoritesPlacement: "separate",
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
      defaultTheme: "macos-dark",
    });
    expect(reloaded.getPreferences()).toEqual({
      theme: "macos-dark",
      autoLightTheme: "macos-light",
      autoDarkTheme: "macos-dark",
      showSidebarRail: false,
      showSidebarBottomRail: true,
      returnKeyAction: "rename",
      shortcutOverrides: { newTab: ["Cmd+Option+N"], duplicateSelection: [] },
      accent: "#2cb5a0",
      zoomPercent: 115,
      uiFontFamily: "lexend",
      tabStyle: "cards",
      viewMode: "details",
      sortBy: "modified",
      sortDirection: "desc",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactIconView: true,
      compactTreeView: true,
      singleClickExpandTreeItems: true,
      highlightHoveredItems: false,
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
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      highlightClipboardItemsInTree: true,
      highlightClipboardItemsInContent: true,
      notifyClipboardItems: true,
      topToolbarItems: ["search", "back", "title", "copyPath", "clipboard", "viewOptions"],
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
      propertiesOpen: false,
      detailRowOpen: true,
      treeWidth: 312,
      inspectorWidth: 388,
      restoreLastVisitedFolderOnStartup: true,
      restoreOpenTabsOnStartup: true,
      openTabs: [
        {
          path: "/Users/demo/src",
          treeRootPath: "/Users/demo",
          favoritePath: null,
          viewMode: "details",
          sortBy: "size",
          sortDirection: "desc",
        },
        {
          path: "/Users/demo/Documents",
          treeRootPath: "/Users/demo",
          favoritePath: "/Users/demo/Documents",
          viewMode: "list",
          sortBy: "name",
          sortDirection: "asc",
        },
      ],
      activeTabIndex: 1,
      treeRootPath: "/Users/demo",
      lastVisitedPath: "/Users/demo/src",
      lastVisitedFavoritePath: "/Users/demo/Documents",
      favorites: [
        { path: "/Users/demo/Documents", icon: "documents" },
        { path: "/Applications", icon: "applications" },
      ],
      favoritesPlacement: "separate",
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
        preferences: {
          theme: "auto",
          autoLightTheme: "tomorrow-night",
          autoDarkTheme: "catppuccin-mocha",
        },
      }),
      "utf8",
    );

    const preferences = createAppStateStore(filePath, { defaultTheme: "auto" }).getPreferences();

    expect(preferences.theme).toBe("auto");
    expect(preferences.autoLightTheme).toBe("macos-light");
    expect(preferences.autoDarkTheme).toBe("catppuccin-mocha");
  });

  it("moves removed palettes to the closest remaining one", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const load = (preferences: Record<string, string>) => {
      writeFileSync(filePath, JSON.stringify({ preferences }), "utf8");
      const loaded = createAppStateStore(filePath, { defaultTheme: "auto" }).getPreferences();
      return [loaded.theme, loaded.autoLightTheme, loaded.autoDarkTheme];
    };

    expect(load({ theme: "light", autoLightTheme: "clean-white", autoDarkTheme: "dark" })).toEqual([
      "macos-light",
      "macos-light",
      "macos-dark",
    ]);
    expect(load({ theme: "midnight", autoLightTheme: "stone", autoDarkTheme: "graphite" })).toEqual(
      ["catppuccin-mocha", "macos-light", "tomorrow-night"],
    );
    expect(load({ theme: "obsidian", autoLightTheme: "sand", autoDarkTheme: "onyx" })).toEqual([
      "macos-dark",
      "sand",
      "macos-dark",
    ]);
    // A removed dark palette saved for the light side is not a light palette: the default wins.
    expect(load({ theme: "auto", autoLightTheme: "obsidian", autoDarkTheme: "onyx" })).toEqual([
      "auto",
      "macos-light",
      "macos-dark",
    ]);
    // Unknown names fall back to the default theme.
    expect(load({ theme: "no-such-theme" })[0]).toBe("auto");
  });

  it("upgrades untouched legacy detail columns to the new defaults but keeps customized ones", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const save = (detailColumns: Record<string, boolean>) =>
      writeFileSync(filePath, JSON.stringify({ preferences: { detailColumns } }), "utf8");

    // Saved before Kind and Date Created existed, still on the old defaults.
    save({ size: true, modified: true, permissions: true });
    expect(createAppStateStore(filePath).getPreferences().detailColumns).toEqual({
      modified: true,
      size: true,
      kind: true,
      created: false,
      permissions: false,
    });

    // A changed choice is kept as it was; the new columns take their defaults.
    save({ size: false, modified: true, permissions: true });
    expect(createAppStateStore(filePath).getPreferences().detailColumns).toEqual({
      modified: true,
      size: false,
      kind: true,
      created: false,
      permissions: true,
    });

    // State that already knows the new columns is never treated as legacy.
    save({ size: true, modified: true, permissions: true, kind: false, created: true });
    expect(createAppStateStore(filePath).getPreferences().detailColumns).toEqual({
      modified: true,
      size: true,
      kind: false,
      created: true,
      permissions: true,
    });
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
      "title",
      "view",
      "sort",
      "infoPanel",
      "clipboard",
      "viewOptions",
      "search",
    ]);

    writeFileSync(
      filePath,
      JSON.stringify({ preferences: { topToolbarItems: ["back", "refresh", "search"] } }),
      "utf8",
    );
    // A customized one keeps its buttons, with the title, the clipboard button and View
    // Options added where they were drawn before they could be moved.
    expect(createAppStateStore(filePath).getPreferences().topToolbarItems).toEqual([
      "back",
      "title",
      "refresh",
      "clipboard",
      "viewOptions",
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

  it("keeps a saved search match mode and defaults to plain text", () => {
    const load = (searchPatternMode: unknown) => {
      const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-")));
      writeFileSync(filePath, JSON.stringify({ preferences: { searchPatternMode } }), "utf8");
      return createAppStateStore(filePath).getPreferences().searchPatternMode;
    };

    // Regex was the default before plain text existed; a profile that has it keeps it.
    expect(load("regex")).toBe("regex");
    expect(load("glob")).toBe("glob");
    expect(load("text")).toBe("text");
    expect(load(undefined)).toBe("text");
    expect(load("fuzzy")).toBe("text");
  });

  it("remembers the folders that are opened across restarts", () => {
    const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-")));
    const store = createAppStateStore(filePath);
    expect(store.getVisitedFolders()).toEqual([]);

    store.recordFolderVisit("/Users/demo/work", 1_000);
    store.recordFolderVisit("/Users/demo/music", 2_000);
    store.recordFolderVisit("/Users/demo/work", 3_000);
    store.flush();

    const reloaded = createAppStateStore(filePath);
    expect(reloaded.getVisitedFolders()).toEqual([
      { path: "/Users/demo/work", visitCount: 2, lastVisitedAt: 3_000 },
      { path: "/Users/demo/music", visitCount: 1, lastVisitedAt: 2_000 },
    ]);
    // Preferences and visits live in the same file without disturbing each other.
    reloaded.updatePreferences({ viewMode: "details" });
    expect(reloaded.forgetVisitedFolder("/Users/demo/work")).toEqual([
      { path: "/Users/demo/music", visitCount: 1, lastVisitedAt: 2_000 },
    ]);
    reloaded.flush();
    const again = createAppStateStore(filePath);
    expect(again.getVisitedFolders().map((folder) => folder.path)).toEqual(["/Users/demo/music"]);
    expect(again.getPreferences().viewMode).toBe("details");
  });

  it("sanitizes invalid persisted values", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const filePath = resolveAppStatePath(userDataPath);
    const store = createAppStateStore(filePath, {
      defaultTheme: "macos-dark",
    });
    store.updatePreferences({
      accent: "bad-accent" as never,
      zoomPercent: 999,
      sortBy: "oops" as never,
      sortDirection: "sideways" as never,
      topToolbarItems: ["back", "search", "search", "theme"] as never,
      leftToolbarItems: {
        main: ["home", "search", "copyPath"],
        utility: ["copyPath", "theme", "sort"],
      } as never,
      uiFontFamily: "bad-font" as never,
      tabStyle: "bad-style" as never,
      // Settings that no longer exist are dropped when loading.
      ...({
        uiFontSize: 15,
        uiFontWeight: 600,
        favoritesPaneHeight: 224,
        typeaheadEnabled: false,
        typeaheadDebounceMs: 9999,
        searchResultsFilterScope: "path",
      } as object),
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
        permissions: 40,
        kind: 148,
        created: 168,
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
      defaultTheme: "macos-dark",
    });
    expect(reloaded.getPreferences().accent).toBe("#007aff");
    expect(reloaded.getPreferences().zoomPercent).toBe(150);
    expect(reloaded.getPreferences().sortBy).toBe("name");
    expect(reloaded.getPreferences().sortDirection).toBe("asc");
    expect(reloaded.getPreferences().topToolbarItems).toEqual([
      "back",
      "title",
      "clipboard",
      "viewOptions",
      "search",
    ]);
    expect(reloaded.getPreferences().leftToolbarItems).toEqual({
      main: ["home", "copyPath"],
      utility: ["copyPath", "theme"],
    });
    expect(reloaded.getPreferences().treeWidth).toBe(220);
    expect(reloaded.getPreferences().inspectorWidth).toBe(480);
    expect(reloaded.getPreferences().accent).toBe("#007aff");
    expect(reloaded.getPreferences().uiFontFamily).toBe("system");
    expect(reloaded.getPreferences().tabStyle).toBe("accentLine");
    expect(reloaded.getPreferences()).not.toHaveProperty("uiFontSize");
    expect(reloaded.getPreferences()).not.toHaveProperty("uiFontWeight");
    expect(reloaded.getPreferences()).not.toHaveProperty("favoritesPaneHeight");
    expect(reloaded.getPreferences()).not.toHaveProperty("typeaheadEnabled");
    expect(reloaded.getPreferences()).not.toHaveProperty("typeaheadDebounceMs");
    expect(reloaded.getPreferences()).not.toHaveProperty("searchResultsFilterScope");
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
      kind: true,
      created: false,
    });
    expect(reloaded.getPreferences().detailColumnWidths).toEqual({
      name: 720,
      size: 84,
      modified: 180,
      permissions: 96,
      kind: 148,
      created: 168,
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
      defaultTheme: "macos-dark",
    });

    store.updatePreferences({
      favoritesExpanded: false,
      favoritesInitialized: true,
    });
    store.flush();

    const fileContents = `{
  "preferences": {
    "theme": "macos-dark",
    "favoritePaths": ["/Users/demo/Documents", "/Applications", "/Users/demo/Documents"],
    "favoritesExpanded": false,
    "favoritesInitialized": true
  }
}\n`;
    writeFileSync(filePath, fileContents, "utf8");

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "macos-dark",
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
      defaultTheme: "macos-dark",
    });

    store.updatePreferences({
      openWithApplications: [],
    });
    store.flush();

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "macos-dark",
    });

    expect(reloaded.getPreferences().openWithApplications).toEqual([]);
  });
});
