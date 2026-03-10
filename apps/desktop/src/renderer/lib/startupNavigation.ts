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
  return isPathWithinRoot(startupPath, homePath) ? homePath : "/";
}

// Startup navigation merges explicit launch context, persisted preferences, and home-folder
// fallbacks into one path/root pair the renderer can use immediately.
export function resolveStartupNavigation(
  preferences: Pick<
    AppPreferences,
    "restoreLastVisitedFolderOnStartup" | "lastVisitedPath" | "lastVisitedFavoritePath" | "treeRootPath"
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
      preferences.lastVisitedFavoritePath === startupPath ? preferences.lastVisitedFavoritePath : null,
  };
}
