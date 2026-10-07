import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { appPreferencesSchema } from "@filetrail/contracts";

import {
  type BatchRenameSettings,
  DEFAULT_BATCH_RENAME_SETTINGS,
  sanitizeBatchRenamePresets,
  sanitizeBatchRenameSettings,
} from "../shared/batchRename";
import { type Random, random } from "./bootstrap/batchRenameMemoryDisk.testkit";

// The Rename sheet's preferences as a new install has them.
const BATCH_RENAME_DEFAULTS = {
  batchRenameSettings: DEFAULT_BATCH_RENAME_SETTINGS,
  batchRenamePresets: [],
};

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
    store.updatePreferences({ favoritesExpanded: false, locationsExpanded: false });
    store.flush();
    const persisted = readFileSync(filePath, "utf8");
    expect(JSON.parse(persisted).preferences.favoritesExpanded).toBe(false);
    expect(JSON.parse(persisted).preferences.locationsExpanded).toBe(false);
    expect(createAppStateStore(filePath).getPreferences().locationsExpanded).toBe(false);
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
    store.addExplorerWindow({
      id: "window-a",
      bounds: { width: 800, height: 500, maximized: false },
      session: store.createWindowSession(),
    });
    store.setExplorerWindowBounds("window-a", {
      x: 10,
      y: 20,
      width: 900,
      height: 600,
      maximized: false,
    });
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
    expect(saved.windows[0].bounds).toMatchObject({ x: 10, width: 900 });
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

  it("keeps the open tabs for the quit-time write, but writes the setting at once", () => {
    const { store, filePath, writes, pendingDelays, runTimers } = createTimedStore();
    const tab = {
      path: "/Users/demo/work",
      treeRootPath: "/Users/demo",
      favoritePath: null,
      viewMode: "details" as const,
      searchViewMode: "details" as const,
      sortBy: "name" as const,
      sortDirection: "asc" as const,
      includeHidden: false,
      foldersFirst: true,
      favoritesExpanded: true,
      locationsExpanded: true,
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
          locationsExpanded: false,
          openTabs: [
            {
              path: "/Users/demo/work",
              viewMode: "details",
              sortBy: "size",
              sortDirection: "desc",
              includeHidden: true,
              favoritesExpanded: false,
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
        searchViewMode: "details",
        sortBy: "size",
        sortDirection: "desc",
        includeHidden: true,
        foldersFirst: true,
        favoritesExpanded: false,
        // Saved before tabs kept their sidebar: the window's setting.
        locationsExpanded: false,
      },
      // A tab without settings of its own takes the defaults, and the window's sidebar.
      {
        path: null,
        treeRootPath: null,
        favoritePath: null,
        viewMode: "icons",
        searchViewMode: "details",
        sortBy: "name",
        sortDirection: "asc",
        includeHidden: false,
        foldersFirst: true,
        favoritesExpanded: true,
        locationsExpanded: false,
      },
    ]);
  });

  it("writes navigation along with the next deliberate change, and nothing for no change", () => {
    const { store, filePath, writes, pendingDelays, runTimers } = createTimedStore();

    store.updatePreferences({ lastVisitedPath: "/Users/demo/work" });
    store.addExplorerWindow({
      id: "window-a",
      bounds: { width: 900, height: 600, maximized: false },
      session: store.createWindowSession(),
    });
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
    store.setExplorerWindowBounds(
      "window-a",
      store.getExplorerWindows()[0]?.bounds ?? {
        width: 0,
        height: 0,
        maximized: false,
      },
    );
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
      viewMode: "icons",
      searchViewMode: "details",
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
      searchColumns: {
        folder: true,
        modified: true,
        size: true,
        kind: false,
        created: false,
        permissions: false,
      },
      searchColumnOrder: ["folder", "modified", "size", "kind", "created", "permissions"],
      searchColumnWidths: {
        name: 300,
        folder: 240,
        modified: 152,
        size: 108,
        kind: 148,
        created: 152,
        permissions: 108,
      },
      notificationsEnabled: true,
      markClipboardItems: true,
      autoCalculateFolderSizes: true,
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
      locationsExpanded: true,
      favoritesInitialized: false,
      ...BATCH_RENAME_DEFAULTS,
    });
    expect(store.getExplorerWindows()).toEqual([]);
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
      searchViewMode: "details",
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
      searchColumns: {
        folder: true,
        modified: true,
        size: true,
        kind: false,
        created: false,
        permissions: false,
      },
      searchColumnOrder: ["folder", "modified", "size", "kind", "created", "permissions"],
      searchColumnWidths: {
        name: 300,
        folder: 240,
        modified: 152,
        size: 108,
        kind: 148,
        created: 152,
        permissions: 108,
      },
      notificationsEnabled: true,
      markClipboardItems: false,
      autoCalculateFolderSizes: false,
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
          searchViewMode: "details",
          sortBy: "size",
          sortDirection: "desc",
          includeHidden: true,
          foldersFirst: false,
          favoritesExpanded: false,
          locationsExpanded: true,
        },
        {
          path: "/Users/demo/Documents",
          treeRootPath: "/Users/demo",
          favoritePath: "/Users/demo/Documents",
          viewMode: "list",
          searchViewMode: "details",
          sortBy: "name",
          sortDirection: "asc",
          includeHidden: false,
          foldersFirst: true,
          favoritesExpanded: true,
          locationsExpanded: false,
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
      locationsExpanded: true,
      favoritesInitialized: true,
      ...BATCH_RENAME_DEFAULTS,
    });
    store.addExplorerWindow({
      id: "window-a",
      bounds: {
        x: 120,
        y: 140,
        width: 1600,
        height: 1000,
        maximized: true,
      } satisfies StoredWindowState,
      session: store.createWindowSession(),
    });
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
      searchViewMode: "details",
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
      searchColumns: {
        folder: true,
        modified: true,
        size: true,
        kind: false,
        created: false,
        permissions: false,
      },
      searchColumnOrder: ["folder", "modified", "size", "kind", "created", "permissions"],
      searchColumnWidths: {
        name: 300,
        folder: 240,
        modified: 152,
        size: 108,
        kind: 148,
        created: 152,
        permissions: 108,
      },
      notificationsEnabled: true,
      markClipboardItems: false,
      autoCalculateFolderSizes: false,
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
          searchViewMode: "details",
          sortBy: "size",
          sortDirection: "desc",
          includeHidden: true,
          foldersFirst: false,
          favoritesExpanded: false,
          locationsExpanded: true,
        },
        {
          path: "/Users/demo/Documents",
          treeRootPath: "/Users/demo",
          favoritePath: "/Users/demo/Documents",
          viewMode: "list",
          searchViewMode: "details",
          sortBy: "name",
          sortDirection: "asc",
          includeHidden: false,
          foldersFirst: true,
          favoritesExpanded: true,
          locationsExpanded: false,
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
      locationsExpanded: true,
      favoritesInitialized: true,
      ...BATCH_RENAME_DEFAULTS,
    });
    expect(reloaded.getExplorerWindows().map((window) => window.bounds)).toEqual([
      {
        x: 120,
        y: 140,
        width: 1600,
        height: 1000,
        maximized: true,
      },
    ]);
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
      searchColumns: { folder: false, kind: "yes", created: true } as never,
      searchColumnOrder: ["size", "name", "size", "folder"] as never,
      searchColumnWidths: { folder: 5, name: 400 } as never,
      searchResultsSortBy: "kind",
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
      permissions: 40,
      kind: 148,
      created: 168,
    });
    // Search results' columns are read the same way, apart from a folder's.
    expect(reloaded.getPreferences().searchColumns).toEqual({
      folder: false,
      modified: true,
      size: true,
      kind: false,
      created: true,
      permissions: false,
    });
    expect(reloaded.getPreferences().searchColumnOrder).toEqual([
      "size",
      "folder",
      "modified",
      "kind",
      "created",
      "permissions",
    ]);
    expect(reloaded.getPreferences().searchColumnWidths).toMatchObject({
      name: 400,
      folder: 80,
      size: 108,
    });
    expect(reloaded.getPreferences().searchResultsSortBy).toBe("kind");
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

  describe("the Rename sheet's saved settings", () => {
    const settingsSchema = appPreferencesSchema.shape.batchRenameSettings;
    const presetsSchema = appPreferencesSchema.shape.batchRenamePresets;

    // A value as a damaged, hand-edited or older file might hold: a right one, a wrong type,
    // too long, out of range, or not a number at all.
    function garbage(rng: Random, depth = 0): unknown {
      const highSurrogate = String.fromCharCode(0xd83d);
      return rng.pick<() => unknown>([
        () => null,
        () => undefined,
        () => rng.chance(0.5),
        () =>
          rng.pick([
            0,
            -0,
            -1,
            1,
            2,
            2.5,
            5,
            1e12,
            -1e12,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            Number.NEGATIVE_INFINITY,
          ]),
        () => rng.pick(["", " ", "auto", "replace", "format", "date", "-", "_", "x".repeat(300)]),
        () => `${"a".repeat(254)}${highSurrogate}\u{1F600}`,
        () => (depth < 2 ? [garbage(rng, depth + 1)] : []),
        () => (depth < 2 ? { value: garbage(rng, depth + 1) } : {}),
      ])();
    }

    function garbageSettings(rng: Random): unknown {
      if (rng.chance(0.1)) {
        return garbage(rng);
      }
      const record: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(DEFAULT_BATCH_RENAME_SETTINGS)) {
        if (rng.chance(0.2)) {
          continue;
        }
        record[key] = rng.chance(0.3) ? value : garbage(rng);
      }
      record.notASetting = garbage(rng);
      return record;
    }

    function garbagePresets(rng: Random): unknown {
      if (rng.chance(0.1)) {
        return garbage(rng);
      }
      const names = [
        "",
        "   ",
        "Photos",
        "photos",
        " Photos ",
        `${"n".repeat(79)} tail`,
        `${"n".repeat(79)}${String.fromCharCode(0xd83d)}\u{1F600}`,
        "x".repeat(200),
      ];
      return Array.from({ length: rng.integer(0, 60) }, (_, index) =>
        rng.chance(0.1)
          ? garbage(rng)
          : {
              name: rng.chance(0.8)
                ? `${rng.pick(names)}${rng.chance(0.5) ? index : ""}`
                : garbage(rng),
              settings: garbageSettings(rng),
            },
      );
    }

    it("are always ones the preferences accept, whatever the file held", () => {
      expect(settingsSchema.safeParse(DEFAULT_BATCH_RENAME_SETTINGS).success).toBe(true);
      for (let seed = 1; seed <= 500; seed += 1) {
        const rng = random(seed);
        const settings = sanitizeBatchRenameSettings(garbageSettings(rng));
        const presets = sanitizeBatchRenamePresets(garbagePresets(rng));
        const parsed = {
          settings: settingsSchema.safeParse(settings).error?.issues ?? null,
          presets: presetsSchema.safeParse(presets).error?.issues ?? null,
        };
        expect({ seed, ...parsed }).toEqual({ seed, settings: null, presets: null });
      }
    });

    it("are read back from a damaged file as preferences the window accepts", () => {
      const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
      const filePath = resolveAppStatePath(userDataPath);
      for (let seed = 1; seed <= 50; seed += 1) {
        const rng = random(seed);
        writeFileSync(
          filePath,
          JSON.stringify({
            preferences: {
              batchRenameSettings: garbageSettings(rng),
              batchRenamePresets: garbagePresets(rng),
            },
          }),
          "utf8",
        );
        const preferences = createAppStateStore(filePath).getPreferences();
        const issues = appPreferencesSchema.safeParse(preferences).error?.issues ?? null;
        expect({ seed, issues }).toEqual({ seed, issues: null });
      }
    });

    it("keep settings and presets that aren't the defaults across a restart", () => {
      const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
      const filePath = resolveAppStatePath(userDataPath);
      const settings: BatchRenameSettings = {
        mode: "format",
        find: "IMG_",
        replaceWith: "Trip $1",
        matchCase: true,
        useRegex: true,
        addText: " (copy)",
        addWhere: "before",
        nameFormat: "date",
        formatWhere: "before",
        customName: "Lisbon",
        keepNames: true,
        startAt: 0,
        step: 10,
        digits: "auto",
        separator: "",
        dateSource: "taken",
        dateFormat: "custom",
        dateSeparator: ".",
        customDatePattern: "[Day] DD.MM.YYYY HH-mm-ss",
        caseStyle: "title",
        applyTo: "both",
        onConflict: "skip",
      };
      const presets = [
        { name: "Photos by date", settings },
        {
          name: "Lower case",
          settings: { ...DEFAULT_BATCH_RENAME_SETTINGS, mode: "case" as const },
        },
      ];
      const store = createAppStateStore(filePath);
      store.updatePreferences({ batchRenameSettings: settings, batchRenamePresets: presets });
      store.flush();

      const reloaded = createAppStateStore(filePath).getPreferences();
      expect(reloaded.batchRenameSettings).toEqual(settings);
      expect(reloaded.batchRenamePresets).toEqual(presets);
      expect(appPreferencesSchema.safeParse(reloaded).success).toBe(true);
    });
  });
});

describe("appStateStore explorer windows", () => {
  const tab = (path: string) => ({
    path,
    treeRootPath: "/Users/demo",
    favoritePath: null,
    viewMode: "list" as const,
    searchViewMode: "details" as const,
    sortBy: "name" as const,
    sortDirection: "asc" as const,
    includeHidden: false,
    foldersFirst: true,
    favoritesExpanded: true,
    locationsExpanded: true,
  });

  function storeWithFile(contents: unknown) {
    const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-")));
    writeFileSync(filePath, JSON.stringify(contents), "utf8");
    return { filePath, store: createAppStateStore(filePath, { defaultTheme: "dark" }) };
  }

  it("reads a file saved with one window as that window, with its tabs and panels", () => {
    const { store } = storeWithFile({
      preferences: {
        openTabs: [tab("/Users/demo/work"), tab("/Users/demo/music")],
        activeTabIndex: 1,
        treeWidth: 300,
        propertiesOpen: true,
      },
      window: { x: 10, y: 20, width: 900, height: 600, maximized: false },
    });

    const [window, ...others] = store.getExplorerWindows();
    expect(others).toEqual([]);
    expect(window?.bounds).toEqual({ x: 10, y: 20, width: 900, height: 600, maximized: false });
    expect(window?.session.openTabs.map((open) => open.path)).toEqual([
      "/Users/demo/work",
      "/Users/demo/music",
    ]);
    expect(window?.session.activeTabIndex).toBe(1);
    expect(window?.session.treeWidth).toBe(300);
    expect(window?.session.propertiesOpen).toBe(true);
  });

  it("keeps each window's tabs, panels and column widths to itself", () => {
    const { store } = storeWithFile({ preferences: {}, windows: [] });
    store.addExplorerWindow({
      id: "window-b",
      bounds: { width: 900, height: 600, maximized: false },
      session: store.createWindowSession(),
    });
    store.addExplorerWindow({
      id: "window-a",
      bounds: { width: 900, height: 600, maximized: false },
      session: store.createWindowSession(),
    });
    const widths = store.getPreferences().detailColumnWidths;

    store.updateWindowPreferences("window-a", {
      openTabs: [tab("/Users/demo/work")],
      propertiesOpen: true,
      detailColumnWidths: { ...widths, name: 410 },
      // Not a window's own: every window shares it.
      notificationsEnabled: false,
    });

    const a = store.getWindowPreferences("window-a");
    const b = store.getWindowPreferences("window-b");
    expect(a.openTabs.map((open) => open.path)).toEqual(["/Users/demo/work"]);
    expect(a.propertiesOpen).toBe(true);
    expect(a.detailColumnWidths.name).toBe(410);
    expect(b.openTabs).toEqual([]);
    expect(b.propertiesOpen).toBe(false);
    expect(b.detailColumnWidths.name).toBe(widths.name);
    expect(b.notificationsEnabled).toBe(false);
    // The app keeps the values set last, for a window that opens without its own.
    expect(store.getPreferences().detailColumnWidths.name).toBe(410);
    expect(store.createWindowSession().propertiesOpen).toBe(true);
  });

  it("keeps the windows front to back across a restart, without those closed", () => {
    const { store, filePath } = storeWithFile({ preferences: {}, windows: [] });
    for (const id of ["window-c", "window-b", "window-a"]) {
      store.addExplorerWindow({
        id,
        bounds: { width: 900, height: 600, maximized: false },
        session: store.createWindowSession({ openTabs: [tab(`/Users/demo/${id}`)] }),
      });
    }
    store.moveExplorerWindowToFront("window-c");
    store.removeExplorerWindow("window-b");
    store.flush();

    const reloaded = createAppStateStore(filePath, { defaultTheme: "dark" });
    expect(reloaded.getExplorerWindows().map((window) => window.id)).toEqual([
      "window-c",
      "window-a",
    ]);
    expect(reloaded.getWindowPreferences("window-c").openTabs[0]?.path).toBe(
      "/Users/demo/window-c",
    );
  });

  it("writes a window's panels at once, and where it is at quit", () => {
    const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-app-state-")));
    writeFileSync(filePath, JSON.stringify({ preferences: {}, windows: [] }), "utf8");
    const delays: number[] = [];
    const store = createAppStateStore(filePath, {
      defaultTheme: "dark",
      timer: {
        setTimeout: (_callback, delayMs) => {
          delays.push(delayMs);
          return delays.length as unknown as ReturnType<typeof setTimeout>;
        },
        clearTimeout: () => undefined,
      },
    });
    store.addExplorerWindow({
      id: "window-a",
      bounds: { width: 900, height: 600, maximized: false },
      session: store.createWindowSession(),
    });
    store.addExplorerWindow({
      id: "window-b",
      bounds: { width: 900, height: 600, maximized: false },
      session: store.createWindowSession(),
    });
    expect(delays).toEqual([5 * 60 * 1000]);
    delays.length = 0;
    store.updateWindowPreferences("window-a", { treeWidth: 333 });
    expect(new Set(delays)).toEqual(new Set([150]));
    delays.length = 0;

    // The app already has this width (window A set it); window B's own changes, and is
    // written promptly all the same.
    store.updateWindowPreferences("window-b", { treeWidth: 333 });
    expect(delays).toEqual([150]);
  });

  it("remembers the window closed last with its front tab, across a restart", () => {
    const { store, filePath } = storeWithFile({ preferences: {}, windows: [] });
    expect(store.getLastClosedWindow()).toBeNull();
    store.addExplorerWindow({
      id: "window-a",
      bounds: { x: 40, y: 60, width: 900, height: 600, maximized: false },
      session: store.createWindowSession({
        openTabs: [tab("/Users/demo/work"), tab("/Users/demo/music")],
        activeTabIndex: 1,
        propertiesOpen: true,
      }),
    });

    store.rememberClosedWindow("window-a");
    store.removeExplorerWindow("window-a");
    store.rememberClosedWindow("window-gone");
    store.flush();

    const reloaded = createAppStateStore(filePath, { defaultTheme: "dark" });
    expect(reloaded.getExplorerWindows()).toEqual([]);
    const lastClosed = reloaded.getLastClosedWindow();
    expect(lastClosed?.bounds).toEqual({ x: 40, y: 60, width: 900, height: 600, maximized: false });
    expect(lastClosed?.session.openTabs.map((open) => open.path)).toEqual(["/Users/demo/music"]);
    expect(lastClosed?.session.activeTabIndex).toBe(0);
    expect(lastClosed?.session.propertiesOpen).toBe(true);
  });

  it("keeps the windows of a damaged file that make sense", () => {
    const { store } = storeWithFile({
      preferences: { treeWidth: 300 },
      windows: [
        "not a window",
        { id: "", bounds: {} },
        { id: "window-a", bounds: { width: 10 }, session: { treeWidth: "wide", openTabs: 3 } },
        { id: "window-a", session: { treeWidth: 400 } },
        ...Array.from({ length: 60 }, (_, index) => ({ id: `window-${index + 1000}` })),
      ],
    });

    const windows = store.getExplorerWindows();
    expect(windows).toHaveLength(50);
    expect(windows[0]?.id).toBe("window-a");
    // A missing or bad value takes the app's.
    expect(windows[0]?.session.treeWidth).toBe(300);
    expect(windows[0]?.session.openTabs).toEqual([]);
    expect(windows[0]?.bounds).toEqual({ width: 1200, height: 760, maximized: false });
  });
});
