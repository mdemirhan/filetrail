import type { AppPreferences } from "../../shared/appPreferences";

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
    // Only reuse a saved tree root if the startup path still sits inside that root.
    return {
      startupPath,
      startupRootPath:
        preferences.treeRootPath && isPathWithinRoot(startupPath, preferences.treeRootPath)
          ? preferences.treeRootPath
          : startupPath,
    };
  }

  return {
    startupPath,
    // Restored startup prefers the home directory as a stable tree root when possible.
    startupRootPath: isPathWithinRoot(startupPath, homePath) ? homePath : "/",
  };
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}
