import type { AppPreferences } from "../../shared/appPreferences";
import { isPathWithinRoot } from "./pathUtils";

function resolvePersistedStartupRoot(
  persistedRootPath: string | null,
  homePath: string,
  startupPath: string,
): string {
  if (persistedRootPath === "/" || persistedRootPath === homePath) {
    return persistedRootPath;
  }
  // A folder the tree was rooted at by hand is kept while the startup folder is inside it.
  if (persistedRootPath && isPathWithinRoot(startupPath, persistedRootPath)) {
    return persistedRootPath;
  }
  return isPathWithinRoot(startupPath, homePath) ? homePath : "/";
}

// Startup navigation merges explicit launch context, persisted preferences, and home-folder
// fallbacks into one path/root pair the renderer can use immediately.
export function resolveStartupNavigation(
  preferences: Pick<
    AppPreferences,
    | "restoreLastVisitedFolderOnStartup"
    | "lastVisitedPath"
    | "lastVisitedFavoritePath"
    | "treeRootPath"
  >,
  homePath: string,
  startupFolderPath: string | null = null,
): { startupPath: string; startupRootPath: string; startupFavoritePath: string | null } {
  if (startupFolderPath) {
    // OS-provided launch targets always win.
    return {
      startupPath: startupFolderPath,
      startupRootPath: resolvePersistedStartupRoot(null, homePath, startupFolderPath),
      startupFavoritePath: null,
    };
  }

  const startupPath =
    preferences.restoreLastVisitedFolderOnStartup && preferences.lastVisitedPath
      ? preferences.lastVisitedPath
      : homePath;

  if (!preferences.restoreLastVisitedFolderOnStartup || !preferences.lastVisitedPath) {
    // When restore-last-visited is off, startup ignores persisted navigation state and
    // returns to home with a home-rooted tree.
    return {
      startupPath,
      startupRootPath: homePath,
      startupFavoritePath: null,
    };
  }

  return {
    startupPath,
    startupRootPath: resolvePersistedStartupRoot(preferences.treeRootPath, homePath, startupPath),
    startupFavoritePath:
      preferences.lastVisitedFavoritePath === startupPath
        ? preferences.lastVisitedFavoritePath
        : null,
  };
}

// A tab as the window opens it: where it starts and how it shows its folder.
export type StartupTab = {
  path: string;
  rootPath: string;
  favoritePath: string | null;
  viewMode: AppPreferences["viewMode"];
  sortBy: AppPreferences["sortBy"];
  sortDirection: AppPreferences["sortDirection"];
};

// The tabs the window opens with and the one that is on screen. "Restore open tabs" brings
// back the tabs that were open; "Restore last visited folder" decides whether they return
// to their own folders or start at home. A folder the app was launched with is shown in a
// tab of its own, unless one of the restored tabs already has it.
export function resolveStartupTabs(
  preferences: Pick<
    AppPreferences,
    | "restoreLastVisitedFolderOnStartup"
    | "restoreOpenTabsOnStartup"
    | "openTabs"
    | "activeTabIndex"
    | "lastVisitedPath"
    | "lastVisitedFavoritePath"
    | "treeRootPath"
    | "viewMode"
    | "sortBy"
    | "sortDirection"
  >,
  homePath: string,
  startupFolderPath: string | null = null,
): { tabs: StartupTab[]; activeIndex: number } {
  const view = {
    viewMode: preferences.viewMode,
    sortBy: preferences.sortBy,
    sortDirection: preferences.sortDirection,
  };
  if (!preferences.restoreOpenTabsOnStartup || preferences.openTabs.length === 0) {
    const { startupPath, startupRootPath, startupFavoritePath } = resolveStartupNavigation(
      preferences,
      homePath,
      startupFolderPath,
    );
    return {
      tabs: [
        {
          path: startupPath,
          rootPath: startupRootPath,
          favoritePath: startupFavoritePath,
          ...view,
        },
      ],
      activeIndex: 0,
    };
  }

  const tabs = preferences.openTabs.map((tab): StartupTab => {
    const tabView = {
      viewMode: tab.viewMode,
      sortBy: tab.sortBy,
      sortDirection: tab.sortDirection,
    };
    if (!preferences.restoreLastVisitedFolderOnStartup || !tab.path) {
      return { path: homePath, rootPath: homePath, favoritePath: null, ...tabView };
    }
    return {
      path: tab.path,
      rootPath: resolvePersistedStartupRoot(tab.treeRootPath, homePath, tab.path),
      favoritePath: tab.favoritePath === tab.path ? tab.favoritePath : null,
      ...tabView,
    };
  });
  let activeIndex = Math.min(preferences.activeTabIndex, tabs.length - 1);
  if (startupFolderPath) {
    const existingIndex = tabs.findIndex((tab) => tab.path === startupFolderPath);
    if (existingIndex >= 0) {
      activeIndex = existingIndex;
    } else {
      tabs.push({
        path: startupFolderPath,
        rootPath: resolvePersistedStartupRoot(null, homePath, startupFolderPath),
        favoritePath: null,
        ...view,
      });
      activeIndex = tabs.length - 1;
    }
  }
  return { tabs, activeIndex };
}
