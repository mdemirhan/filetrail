import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type StoredWindowState, createAppStateStore, resolveAppStatePath } from "./appStateStore";

describe("appStateStore", () => {
  it("returns defaults when no state file exists", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const store = createAppStateStore(resolveAppStatePath(userDataPath), {
      defaultTheme: "tomorrow-night",
    });

    expect(store.getPreferences()).toEqual({
      theme: "tomorrow-night",
      accent: "gold",
      accentToolbarButtons: true,
      zoomPercent: 100,
      uiFontFamily: "lexend",
      uiFontSize: 13,
      uiFontWeight: 500,
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
      viewMode: "list",
      foldersFirst: true,
      compactListView: false,
      compactDetailsView: false,
      compactTreeView: false,
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
      typeaheadDebounceMs: 750,
      notificationsEnabled: true,
      notificationDurationSeconds: 4,
      propertiesOpen: true,
      detailRowOpen: true,
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
      searchIncludeHidden: false,
      searchResultsSortBy: "path",
      searchResultsSortDirection: "asc",
      searchResultsFilterScope: "name",
      treeWidth: 280,
      inspectorWidth: 320,
      restoreLastVisitedFolderOnStartup: false,
      treeRootPath: null,
      lastVisitedPath: null,
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
      accent: "teal",
      accentToolbarButtons: false,
      zoomPercent: 115,
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
      viewMode: "details",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactTreeView: true,
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
      terminalApp: "iTerm",
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
      searchIncludeHidden: true,
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
      accent: "teal",
      accentToolbarButtons: false,
      zoomPercent: 115,
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
      viewMode: "details",
      foldersFirst: false,
      compactListView: true,
      compactDetailsView: true,
      compactTreeView: true,
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
      terminalApp: "iTerm",
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
      searchIncludeHidden: true,
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
    });
    expect(reloaded.getWindowState()).toEqual({
      x: 120,
      y: 140,
      width: 1600,
      height: 1000,
      maximized: true,
    });
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
      zoomPercent: 999,
      uiFontFamily: "bad-font" as never,
      uiFontSize: 999,
      uiFontWeight: 123 as never,
      textPrimaryOverride: "oops" as never,
      typeaheadDebounceMs: 9999,
      terminalApp: "   ",
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
    });
    store.flush();

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });
    expect(reloaded.getPreferences().accent).toBe("gold");
    expect(reloaded.getPreferences().accentToolbarButtons).toBe(true);
    expect(reloaded.getPreferences().zoomPercent).toBe(150);
    expect(reloaded.getPreferences().treeWidth).toBe(220);
    expect(reloaded.getPreferences().inspectorWidth).toBe(480);
    expect(reloaded.getPreferences().accent).toBe("gold");
    expect(reloaded.getPreferences().uiFontFamily).toBe("lexend");
    expect(reloaded.getPreferences().uiFontSize).toBe(15);
    expect(reloaded.getPreferences().uiFontWeight).toBe(500);
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
