export type ThemeMode = "light" | "dark";
export type ExplorerViewMode = "list" | "details";

export type AppPreferences = {
  theme: ThemeMode;
  viewMode: ExplorerViewMode;
  propertiesOpen: boolean;
  includeHidden: boolean;
  treeWidth: number;
  inspectorWidth: number;
  restoreLastVisitedFolderOnStartup: boolean;
  treeRootPath: string | null;
  lastVisitedPath: string | null;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  theme: "light",
  viewMode: "list",
  propertiesOpen: true,
  includeHidden: false,
  treeWidth: 280,
  inspectorWidth: 320,
  restoreLastVisitedFolderOnStartup: false,
  treeRootPath: null,
  lastVisitedPath: null,
};

export function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, value)));
}
