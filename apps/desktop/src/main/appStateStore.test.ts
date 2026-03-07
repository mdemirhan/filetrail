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
      uiFontFamily: "dm-sans",
      uiFontSize: 13,
      uiFontWeight: 400,
      monoFontFamily: "jetbrains-mono",
      monoFontSize: 12,
      monoFontWeight: 500,
      textPrimaryOverride: null,
      textSecondaryOverride: null,
      textMutedOverride: null,
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
      theme: "tomorrow-night",
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      monoFontFamily: "fira-code",
      monoFontSize: 13,
      monoFontWeight: 600,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
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
      theme: "tomorrow-night",
      uiFontFamily: "lexend",
      uiFontSize: 14,
      uiFontWeight: 500,
      monoFontFamily: "fira-code",
      monoFontSize: 13,
      monoFontWeight: 600,
      textPrimaryOverride: "#ffffff",
      textSecondaryOverride: "#cccccc",
      textMutedOverride: "#999999",
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
      uiFontFamily: "bad-font" as never,
      uiFontSize: 999,
      uiFontWeight: 123 as never,
      monoFontFamily: "bad-mono" as never,
      monoFontSize: 1,
      monoFontWeight: 900 as never,
      textPrimaryOverride: "oops" as never,
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
    expect(reloaded.getPreferences().uiFontFamily).toBe("dm-sans");
    expect(reloaded.getPreferences().uiFontSize).toBe(15);
    expect(reloaded.getPreferences().uiFontWeight).toBe(400);
    expect(reloaded.getPreferences().monoFontFamily).toBe("jetbrains-mono");
    expect(reloaded.getPreferences().monoFontSize).toBe(11);
    expect(reloaded.getPreferences().monoFontWeight).toBe(400);
    expect(reloaded.getPreferences().textPrimaryOverride).toBeNull();
    expect(reloaded.getPreferences().treeRootPath).toBeNull();
    expect(reloaded.getPreferences().lastVisitedPath).toBeNull();
  });
});
