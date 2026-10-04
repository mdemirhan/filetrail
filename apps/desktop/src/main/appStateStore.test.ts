import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import {
  type StoredWindowState,
  createAppStateStore,
  resolveAppStatePath,
  resolveVisitedFoldersPath,
} from "./appStateStore";

// The real file system, except that only the named applications are installed.
function fileSystemWithApplications(installed: string[]) {
  return {
    existsSync: (path: string) =>
      path.endsWith(".app") ? installed.includes(path) : existsSync(path),
    mkdirSync: () => undefined,
    readFileSync: (path: string, encoding: "utf8") => readFileSync(path, encoding),
    writeFileSync: (path: string, data: string, encoding: "utf8") =>
      writeFileSync(path, data, encoding),
    renameSync: (from: string, to: string) => renameSync(from, to),
  };
}

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

  // A store whose timers only run when the test says so, counting the writes it makes.
  function createTimedStore(
    filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-"))),
  ) {
    const timers = new Map<number, { callback: () => void; delayMs: number }>();
    let nextTimerId = 1;
    const written: string[] = [];
    const store = createAppStateStore(filePath, {
      defaultTheme: "dark",
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
          written.push(basename(path, ".tmp"));
          writeFileSync(path, data, encoding);
        },
        renameSync: (from, to) => renameSync(from, to),
      },
    });
    return {
      store,
      filePath,
      writes: () => written.length,
      /** The files written, by name, in order. */
      written: () => [...written],
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

    // Forgetting a folder Go To does not list changes nothing.
    store.forgetVisitedFolder("/Users/demo/gone");
    expect(pendingDelays()).toEqual([]);
    store.recordFolderVisit("/Users/demo/gone", "stay", 1_000);
    store.forgetVisitedFolder("/Users/demo/gone");
    expect(pendingDelays()).toEqual([150]);
  });

  it("keeps where the user is for the quit-time write", () => {
    const { store, filePath, writes, written, pendingDelays, runTimers } = createTimedStore();

    store.updatePreferences({ lastVisitedPath: "/Users/demo/work", treeRootPath: "/Users/demo" });
    store.recordFolderVisit("/Users/demo/work", "goTo", 1_000);
    store.setWindowState({ x: 10, y: 20, width: 900, height: 600, maximized: false });
    store.updatePreferences({ lastVisitedPath: "/Users/demo/music" });
    store.recordFolderVisit("/Users/demo/music", "stay", 2_000);

    // Nothing is written while browsing; one long timer bounds what a crash can lose, and
    // later navigation does not push it back.
    expect(writes()).toBe(0);
    expect(pendingDelays()).toEqual([5 * 60 * 1000]);

    store.flush();
    expect(written()).toEqual(["visited-folders.json", "app-state.json"]);
    expect(pendingDelays()).toEqual([]);
    const saved = JSON.parse(readFileSync(filePath, "utf8"));
    expect(saved.preferences.lastVisitedPath).toBe("/Users/demo/music");
    expect(saved.window).toMatchObject({ x: 10, width: 900 });
    expect(saved.visitedFolders).toBeUndefined();
    const visits = JSON.parse(readFileSync(resolveVisitedFoldersPath(filePath), "utf8"));
    expect(visits.folders).toHaveLength(2);

    // Nothing has changed since: quitting again writes nothing.
    store.flush();
    expect(writes()).toBe(2);
    // Nor does passing through a folder already known.
    store.recordFolderVisit("/Users/demo/work", "passThrough", 2_500);
    expect(pendingDelays()).toEqual([]);

    // The long timer does write, for a session that stays open, and only what changed.
    store.recordFolderVisit("/Users/demo/work", "stay", 3_000);
    runTimers();
    expect(written().slice(2)).toEqual(["visited-folders.json"]);
  });

  it("moves the opened folders out of the state file into their own", () => {
    const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-")));
    writeFileSync(
      filePath,
      JSON.stringify({
        preferences: { viewMode: "details" },
        visitedFolders: [{ path: "/Users/demo/work", visitCount: 2, lastVisitedAt: 1_000 }],
      }),
      "utf8",
    );
    const { written, runTimers } = createTimedStore(filePath);
    runTimers();

    // The new file is written before the old one loses the list.
    expect(written()).toEqual(["visited-folders.json", "app-state.json"]);
    expect(JSON.parse(readFileSync(filePath, "utf8")).visitedFolders).toBeUndefined();
    const reloaded = createAppStateStore(filePath);
    expect(reloaded.getVisitedFolders()).toEqual([
      {
        path: "/Users/demo/work",
        visits: [
          { at: 1_000, kind: "stay" },
          { at: 1_000, kind: "stay" },
        ],
      },
    ]);
    expect(reloaded.getPreferences().viewMode).toBe("details");
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
      includeHidden: false,
      foldersFirst: true,
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

    store.updatePreferences({ restoreSessionOnStartup: false });
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
          restoreSessionOnStartup: true,
          activeTabIndex: -3,
          openTabs: [
            {
              path: "/Users/demo/work",
              viewMode: "details",
              sortBy: "size",
              sortDirection: "desc",
              includeHidden: true,
            },
            "not a tab",
            { path: "", treeRootPath: 7, viewMode: "gallery", sortBy: "colour" },
          ],
        },
      }),
    );

    const preferences = createAppStateStore(filePath).getPreferences();

    expect(preferences.restoreSessionOnStartup).toBe(true);
    expect(preferences.activeTabIndex).toBe(0);
    expect(preferences.openTabs).toEqual([
      {
        path: "/Users/demo/work",
        treeRootPath: null,
        favoritePath: null,
        viewMode: "details",
        sortBy: "size",
        sortDirection: "desc",
        includeHidden: true,
        foldersFirst: true,
      },
      // A tab without settings of its own takes the defaults.
      {
        path: null,
        treeRootPath: null,
        favoritePath: null,
        viewMode: "details",
        sortBy: "name",
        sortDirection: "asc",
        includeHidden: false,
        foldersFirst: true,
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
      defaultTheme: "dark",
      // Open With starts with the suggested applications that are installed.
      fs: fileSystemWithApplications(["/Applications/Zed.app"]),
    });

    expect(store.getPreferences()).toEqual({
      theme: "dark",
      returnKeyAction: "rename",
      shortcutOverrides: {},
      accent: "#007aff",
      zoomPercent: 100,
      viewMode: "details",
      sortBy: "name",
      sortDirection: "asc",
      foldersFirst: true,
      compactListView: false,
      compactDetailsView: false,
      compactIconView: false,
      compactTreeView: false,
      singleClickExpandTreeItems: false,
      detailColumns: {
        modified: true,
        size: true,
        kind: true,
        created: false,
        permissions: false,
      },
      detailColumnOrder: ["modified", "size", "kind", "created", "permissions"],
      detailColumnWidths: {
        name: 320,
        size: 108,
        modified: 152,
        permissions: 108,
        kind: 148,
        created: 152,
      },
      notificationsEnabled: true,
      markClipboardItems: true,
      folderTreeOpen: true,
      propertiesOpen: false,
      detailRowOpen: false,
      topToolbarItems: [
        "folderTree",
        "topSeparator",
        "back",
        "forward",
        "title",
        "clipboard",
        "view",
        "sort",
        "search",
        "viewOptions",
        "infoPanel",
      ],
      terminalApp: null,
      defaultTextEditor: {
        appPath: "/System/Applications/TextEdit.app",
        appName: "TextEdit",
      },
      openWithApplications: [
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
      restoreSessionOnStartup: true,
      openTabs: [],
      activeTabIndex: 0,
      treeRootPath: null,
      lastVisitedPath: null,
      lastVisitedFavoritePath: null,
      favorites: [],
      favoritesPlacement: "integrated",
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
      viewMode: "details",
      sortBy: "modified",
      sortDirection: "desc",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactIconView: true,
      compactTreeView: true,
      singleClickExpandTreeItems: true,
      detailColumns: {
        size: true,
        modified: false,
        permissions: true,
        kind: true,
        created: false,
      },
      detailColumnOrder: ["kind", "size", "modified", "permissions", "created"],
      detailColumnWidths: {
        name: 360,
        size: 120,
        modified: 180,
        permissions: 160,
        kind: 148,
        created: 168,
      },
      notificationsEnabled: true,
      markClipboardItems: false,
      topToolbarItems: ["search", "back", "title", "copyPath", "clipboard", "viewOptions"],
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
      folderTreeOpen: true,
      propertiesOpen: false,
      detailRowOpen: true,
      treeWidth: 312,
      inspectorWidth: 388,
      restoreSessionOnStartup: false,
      openTabs: [
        {
          path: "/Users/demo/src",
          treeRootPath: "/Users/demo",
          favoritePath: null,
          viewMode: "details",
          sortBy: "size",
          sortDirection: "desc",
          includeHidden: true,
          foldersFirst: false,
        },
        {
          path: "/Users/demo/Documents",
          treeRootPath: "/Users/demo",
          favoritePath: "/Users/demo/Documents",
          viewMode: "list",
          sortBy: "name",
          sortDirection: "asc",
          includeHidden: false,
          foldersFirst: true,
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
      defaultTheme: "dark",
    });
    expect(reloaded.getPreferences()).toEqual({
      theme: "dark",
      returnKeyAction: "rename",
      shortcutOverrides: { newTab: ["Cmd+Option+N"], duplicateSelection: [] },
      accent: "#2cb5a0",
      zoomPercent: 115,
      viewMode: "details",
      sortBy: "modified",
      sortDirection: "desc",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactIconView: true,
      compactTreeView: true,
      singleClickExpandTreeItems: true,
      detailColumns: {
        size: true,
        modified: false,
        permissions: true,
        kind: true,
        created: false,
      },
      detailColumnOrder: ["kind", "size", "modified", "permissions", "created"],
      detailColumnWidths: {
        name: 360,
        size: 120,
        modified: 180,
        permissions: 160,
        kind: 148,
        created: 168,
      },
      notificationsEnabled: true,
      markClipboardItems: false,
      topToolbarItems: ["search", "back", "title", "copyPath", "clipboard", "viewOptions"],
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
      folderTreeOpen: true,
      propertiesOpen: false,
      detailRowOpen: true,
      treeWidth: 312,
      inspectorWidth: 388,
      restoreSessionOnStartup: false,
      openTabs: [
        {
          path: "/Users/demo/src",
          treeRootPath: "/Users/demo",
          favoritePath: null,
          viewMode: "details",
          sortBy: "size",
          sortDirection: "desc",
          includeHidden: true,
          foldersFirst: false,
        },
        {
          path: "/Users/demo/Documents",
          treeRootPath: "/Users/demo",
          favoritePath: "/Users/demo/Documents",
          viewMode: "list",
          sortBy: "name",
          sortDirection: "asc",
          includeHidden: false,
          foldersFirst: true,
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

  it("keeps a saved theme and defaults any other value", () => {
    const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-")));
    const load = (theme: unknown) => {
      writeFileSync(filePath, JSON.stringify({ preferences: { theme } }), "utf8");
      return createAppStateStore(filePath, { defaultTheme: "auto" }).getPreferences().theme;
    };

    expect(load("light")).toBe("light");
    expect(load("dark")).toBe("dark");
    expect(load("auto")).toBe("auto");
    expect(load("macos-light")).toBe("auto");
    expect(load(7)).toBe("auto");
  });

  it("keeps a saved search match mode and defaults to plain text", () => {
    const load = (searchPatternMode: unknown) => {
      const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-")));
      writeFileSync(filePath, JSON.stringify({ preferences: { searchPatternMode } }), "utf8");
      return createAppStateStore(filePath).getPreferences().searchPatternMode;
    };

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

    store.recordFolderVisit("/Users/demo/work", "stay", 1_000);
    store.recordFolderVisit("/Users/demo/music", "goTo", 2_000);
    store.recordFolderVisit("/Users/demo/work", "goTo", 3_000);
    store.flush();

    const reloaded = createAppStateStore(filePath);
    expect(reloaded.getVisitedFolders()).toEqual([
      {
        path: "/Users/demo/work",
        visits: [
          { at: 3_000, kind: "goTo" },
          { at: 1_000, kind: "stay" },
        ],
      },
      { path: "/Users/demo/music", visits: [{ at: 2_000, kind: "goTo" }] },
    ]);
    // Preferences and visits are saved together without disturbing each other.
    reloaded.updatePreferences({ viewMode: "details" });
    expect(reloaded.forgetVisitedFolder("/Users/demo/work")).toEqual([
      { path: "/Users/demo/music", visits: [{ at: 2_000, kind: "goTo" }] },
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
      defaultTheme: "dark",
      fs: fileSystemWithApplications(["/Applications/Visual Studio Code.app"]),
    });
    store.updatePreferences({
      accent: "bad-accent" as never,
      zoomPercent: 999,
      sortBy: "oops" as never,
      sortDirection: "sideways" as never,
      topToolbarItems: ["back", "search", "search", "home"] as never,
      // Settings that no longer exist are dropped when loading.
      ...({
        uiFontFamily: "lexend",
        tabStyle: "cards",
        highlightHoveredItems: true,
        notificationDurationSeconds: 8,
        notifyClipboardItems: false,
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
      // A repeated key, one that does not exist, and three left out.
      detailColumnOrder: ["kind", "kind", "bogus", "size"] as never,
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
      defaultTheme: "dark",
      fs: fileSystemWithApplications(["/Applications/Visual Studio Code.app"]),
    });
    expect(reloaded.getPreferences().accent).toBe("#007aff");
    expect(reloaded.getPreferences().zoomPercent).toBe(150);
    expect(reloaded.getPreferences().sortBy).toBe("name");
    expect(reloaded.getPreferences().sortDirection).toBe("asc");
    expect(reloaded.getPreferences().topToolbarItems).toEqual([
      "back",
      "search",
      "title",
      "clipboard",
      "viewOptions",
    ]);
    expect(reloaded.getPreferences().treeWidth).toBe(220);
    expect(reloaded.getPreferences().inspectorWidth).toBe(480);
    expect(reloaded.getPreferences().accent).toBe("#007aff");
    for (const removed of [
      "uiFontFamily",
      "tabStyle",
      "highlightHoveredItems",
      "notificationDurationSeconds",
      "notifyClipboardItems",
    ]) {
      expect(reloaded.getPreferences()).not.toHaveProperty(removed);
    }
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
    ]);
    expect(reloaded.getPreferences().compactDetailsView).toBe(false);
    expect(reloaded.getPreferences().detailColumns).toEqual({
      size: true,
      modified: false,
      permissions: true,
      kind: true,
      created: false,
    });
    expect(reloaded.getPreferences().detailColumnOrder).toEqual([
      "kind",
      "size",
      "modified",
      "created",
      "permissions",
    ]);
    expect(reloaded.getPreferences().detailColumnWidths).toEqual({
      name: 720,
      size: 60,
      modified: 180,
      permissions: 52,
      kind: 148,
      created: 168,
    });
    expect(reloaded.getPreferences().fileActivationAction).toBe("open");
    expect(reloaded.getPreferences().openItemLimit).toBe(50);
    expect(reloaded.getPreferences().treeRootPath).toBeNull();
    expect(reloaded.getPreferences().lastVisitedPath).toBeNull();
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
