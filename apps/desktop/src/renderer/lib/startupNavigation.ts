import type { AppPreferences, OpenTabPreference } from "../../shared/appPreferences";
import { isPathWithinRoot } from "./pathUtils";
import { getVolumeRootPath } from "./volumes";

function resolvePersistedStartupRoot(
  persistedRootPath: string | null,
  homePath: string,
  startupPath: string,
): string {
  const startupVolumeRootPath = getVolumeRootPath(startupPath);
  // Macintosh HD holds its own folders only: a folder on another disk is shown from that
  // disk's top.
  if (
    persistedRootPath === homePath ||
    (persistedRootPath === "/" && startupVolumeRootPath === "/")
  ) {
    return persistedRootPath;
  }
  // A folder the tree was rooted at by hand is kept while the startup folder is inside it.
  if (
    persistedRootPath &&
    persistedRootPath !== "/" &&
    isPathWithinRoot(startupPath, persistedRootPath)
  ) {
    return persistedRootPath;
  }
  return isPathWithinRoot(startupPath, homePath) ? homePath : startupVolumeRootPath;
}

// Startup navigation merges explicit launch context, persisted preferences, and home-folder
// fallbacks into one path/root pair the renderer can use immediately.
export function resolveStartupNavigation(
  preferences: Pick<
    AppPreferences,
    "restoreSessionOnStartup" | "lastVisitedPath" | "lastVisitedFavoritePath" | "treeRootPath"
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
    preferences.restoreSessionOnStartup && preferences.lastVisitedPath
      ? preferences.lastVisitedPath
      : homePath;

  if (!preferences.restoreSessionOnStartup || !preferences.lastVisitedPath) {
    // Without the last session, startup ignores persisted navigation state and returns to
    // home with a home-rooted tree.
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
  searchViewMode: AppPreferences["searchViewMode"];
  sortBy: AppPreferences["sortBy"];
  sortDirection: AppPreferences["sortDirection"];
  includeHidden: boolean;
  foldersFirst: boolean;
  favoritesExpanded: boolean;
  locationsExpanded: boolean;
};

// A saved tab as a window opens it: in its folder, with the tree rooted where it was when
// the folder is still inside that root.
export function toStartupTab(tab: OpenTabPreference, homePath: string): StartupTab {
  const tabView = {
    viewMode: tab.viewMode,
    searchViewMode: tab.searchViewMode,
    sortBy: tab.sortBy,
    sortDirection: tab.sortDirection,
    includeHidden: tab.includeHidden,
    foldersFirst: tab.foldersFirst,
    favoritesExpanded: tab.favoritesExpanded,
    locationsExpanded: tab.locationsExpanded,
  };
  if (!tab.path) {
    return { path: homePath, rootPath: homePath, favoritePath: null, ...tabView };
  }
  return {
    path: tab.path,
    rootPath: resolvePersistedStartupRoot(tab.treeRootPath, homePath, tab.path),
    favoritePath: tab.favoritePath === tab.path ? tab.favoritePath : null,
    ...tabView,
  };
}

// The tabs the window opens with and the one that is on screen. "Reopen the last folder and
// tabs" brings back the tabs that were open, each in its own folder; without it the window
// opens one tab at home. A window opened while the app runs (`restoreTabs`) always opens
// the tabs it was given. A folder the app was launched with is shown in a tab of its own,
// unless one of the restored tabs already has it.
export function resolveStartupTabs(
  preferences: Pick<
    AppPreferences,
    | "restoreSessionOnStartup"
    | "openTabs"
    | "activeTabIndex"
    | "lastVisitedPath"
    | "lastVisitedFavoritePath"
    | "treeRootPath"
    | "viewMode"
    | "searchViewMode"
    | "sortBy"
    | "sortDirection"
    | "includeHidden"
    | "foldersFirst"
    | "favoritesExpanded"
    | "locationsExpanded"
  >,
  homePath: string,
  startupFolderPath: string | null = null,
  restoreTabs = false,
): { tabs: StartupTab[]; activeIndex: number } {
  const view = {
    viewMode: preferences.viewMode,
    searchViewMode: preferences.searchViewMode,
    sortBy: preferences.sortBy,
    sortDirection: preferences.sortDirection,
    includeHidden: preferences.includeHidden,
    foldersFirst: preferences.foldersFirst,
    favoritesExpanded: preferences.favoritesExpanded,
    locationsExpanded: preferences.locationsExpanded,
  };
  if (!(preferences.restoreSessionOnStartup || restoreTabs) || preferences.openTabs.length === 0) {
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

  const tabs = preferences.openTabs.map((tab) => toStartupTab(tab, homePath));
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
