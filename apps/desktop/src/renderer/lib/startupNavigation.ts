import type { AppPreferences } from "../../shared/appPreferences";

export function resolveStartupNavigation(
  preferences: Pick<
    AppPreferences,
    "restoreLastVisitedFolderOnStartup" | "lastVisitedPath" | "treeRootPath"
  >,
  homePath: string,
): { startupPath: string; startupRootPath: string } {
  const startupPath =
    preferences.restoreLastVisitedFolderOnStartup && preferences.lastVisitedPath
      ? preferences.lastVisitedPath
      : homePath;

  if (!preferences.restoreLastVisitedFolderOnStartup || !preferences.lastVisitedPath) {
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
    startupRootPath: isPathWithinRoot(startupPath, homePath) ? homePath : "/",
  };
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}
