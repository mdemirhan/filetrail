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
      uiFontFamily: "lexend",
      uiFontSize: 13,
      uiFontWeight: 500,
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
      viewMode: "list",
      foldersFirst: true,
      compactListView: false,
      tabSwitchesExplorerPanes: true,
      typeaheadEnabled: true,
      typeaheadDebounceMs: 750,
      propertiesOpen: true,
      detailRowOpen: true,
      includeHidden: false,
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
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
      viewMode: "details",
      foldersFirst: false,
      compactListView: true,
      tabSwitchesExplorerPanes: false,
      typeaheadEnabled: false,
      typeaheadDebounceMs: 1000,
      includeHidden: true,
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
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
      viewMode: "details",
      foldersFirst: false,
      compactListView: true,
      tabSwitchesExplorerPanes: false,
      typeaheadEnabled: false,
      typeaheadDebounceMs: 1000,
      includeHidden: true,
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
      uiFontFamily: "bad-font" as never,
      uiFontSize: 999,
      uiFontWeight: 123 as never,
      textPrimaryOverride: "oops" as never,
      typeaheadDebounceMs: 9999,
      treeWidth: 1,
      inspectorWidth: 9999,
      treeRootPath: "",
      lastVisitedPath: "",
    });
    store.flush();

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "dark",
    });
    expect(reloaded.getPreferences().treeWidth).toBe(220);
    expect(reloaded.getPreferences().inspectorWidth).toBe(480);
    expect(reloaded.getPreferences().uiFontFamily).toBe("lexend");
    expect(reloaded.getPreferences().uiFontSize).toBe(15);
    expect(reloaded.getPreferences().uiFontWeight).toBe(500);
    expect(reloaded.getPreferences().textPrimaryOverride).toBeNull();
    expect(reloaded.getPreferences().typeaheadDebounceMs).toBe(1500);
    expect(reloaded.getPreferences().treeRootPath).toBeNull();
    expect(reloaded.getPreferences().lastVisitedPath).toBeNull();
  });
});
