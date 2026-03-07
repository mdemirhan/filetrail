import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type StoredWindowState, createAppStateStore, resolveAppStatePath } from "./appStateStore";

describe("appStateStore", () => {
  it("returns defaults when no state file exists", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-app-state-"));
    const store = createAppStateStore(resolveAppStatePath(userDataPath), {
      defaultTheme: "dark",
    });

    expect(store.getPreferences()).toEqual({
      theme: "dark",
      viewMode: "list",
      propertiesOpen: true,
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
      defaultTheme: "light",
    });

    store.updatePreferences({
      theme: "dark",
      viewMode: "details",
      includeHidden: true,
      propertiesOpen: false,
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
      defaultTheme: "light",
    });
    expect(reloaded.getPreferences()).toEqual({
      theme: "dark",
      viewMode: "details",
      includeHidden: true,
      propertiesOpen: false,
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
      defaultTheme: "light",
    });
    store.updatePreferences({
      treeWidth: 1,
      inspectorWidth: 9999,
      treeRootPath: "",
      lastVisitedPath: "",
    });
    store.flush();

    const reloaded = createAppStateStore(filePath, {
      defaultTheme: "light",
    });
    expect(reloaded.getPreferences().treeWidth).toBe(220);
    expect(reloaded.getPreferences().inspectorWidth).toBe(480);
    expect(reloaded.getPreferences().treeRootPath).toBeNull();
    expect(reloaded.getPreferences().lastVisitedPath).toBeNull();
  });
});
