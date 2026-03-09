import type { AppPreferences } from "../../shared/appPreferences";
import { isPathWithinRoot } from "./pathUtils";

// Startup navigation merges explicit launch context, persisted preferences, and home-folder
// fallbacks into one path/root pair the renderer can use immediately.
export function resolveStartupNavigation(
  preferences: Pick<
    AppPreferences,
    "restoreLastVisitedFolderOnStartup" | "lastVisitedPath" | "treeRootPath"
  >,
  homePath: string,
  startupFolderPath: string | null = null,
): { startupPath: string; startupRootPath: string } {
  if (startupFolderPath) {
    // OS-provided launch targets always win.
    return {
      startupPath: startupFolderPath,
      startupRootPath: isPathWithinRoot(startupFolderPath, homePath) ? homePath : "/",
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
    };
  }

  return {
    startupPath,
    // Restored startup prefers the home directory as a stable tree root when possible.
    startupRootPath: isPathWithinRoot(startupPath, homePath) ? homePath : "/",
  };
}
