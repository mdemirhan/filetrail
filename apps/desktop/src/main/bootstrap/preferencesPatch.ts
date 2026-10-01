import type { IpcRequest } from "@filetrail/contracts";
import type { AppPreferences } from "../../shared/appPreferences";

export function toPreferencePatch(
  value: IpcRequest<"app:updatePreferences">["preferences"],
): Partial<AppPreferences> {
  // Map fields explicitly so new preference keys are added intentionally rather than
  // silently flowing through as unchecked transport payload.
  const patch: Partial<AppPreferences> = {};
  if (value.theme !== undefined) {
    patch.theme = value.theme;
  }
  if (value.autoLightTheme !== undefined) {
    patch.autoLightTheme = value.autoLightTheme;
  }
  if (value.autoDarkTheme !== undefined) {
    patch.autoDarkTheme = value.autoDarkTheme;
  }
  if (value.showSidebarRail !== undefined) {
    patch.showSidebarRail = value.showSidebarRail;
  }
  if (value.showSidebarBottomRail !== undefined) {
    patch.showSidebarBottomRail = value.showSidebarBottomRail;
  }
  if (value.returnKeyAction !== undefined) {
    patch.returnKeyAction = value.returnKeyAction;
  }
  if (value.accent !== undefined) {
    patch.accent = value.accent;
  }
  if (value.zoomPercent !== undefined) {
    patch.zoomPercent = value.zoomPercent;
  }
  if (value.uiFontFamily !== undefined) {
    patch.uiFontFamily = value.uiFontFamily;
  }
  if (value.viewMode !== undefined) {
    patch.viewMode = value.viewMode;
  }
  if (value.sortBy !== undefined) {
    patch.sortBy = value.sortBy;
  }
  if (value.sortDirection !== undefined) {
    patch.sortDirection = value.sortDirection;
  }
  if (value.foldersFirst !== undefined) {
    patch.foldersFirst = value.foldersFirst;
  }
  if (value.compactListView !== undefined) {
    patch.compactListView = value.compactListView;
  }
  if (value.compactDetailsView !== undefined) {
    patch.compactDetailsView = value.compactDetailsView;
  }
  if (value.compactTreeView !== undefined) {
    patch.compactTreeView = value.compactTreeView;
  }
  if (value.highlightHoveredItems !== undefined) {
    patch.highlightHoveredItems = value.highlightHoveredItems;
  }
  if (value.detailColumns !== undefined) {
    patch.detailColumns = value.detailColumns;
  }
  if (value.detailColumnWidths !== undefined) {
    patch.detailColumnWidths = value.detailColumnWidths;
  }
  if (value.tabSwitchesExplorerPanes !== undefined) {
    patch.tabSwitchesExplorerPanes = value.tabSwitchesExplorerPanes;
  }
  if (value.notificationsEnabled !== undefined) {
    patch.notificationsEnabled = value.notificationsEnabled;
  }
  if (value.notificationDurationSeconds !== undefined) {
    patch.notificationDurationSeconds = value.notificationDurationSeconds;
  }
  if (value.propertiesOpen !== undefined) {
    patch.propertiesOpen = value.propertiesOpen;
  }
  if (value.detailRowOpen !== undefined) {
    patch.detailRowOpen = value.detailRowOpen;
  }
  if (value.topToolbarItems !== undefined) {
    patch.topToolbarItems = value.topToolbarItems;
  }
  if (value.leftToolbarItems !== undefined) {
    patch.leftToolbarItems = value.leftToolbarItems;
  }
  if (value.terminalApp !== undefined) {
    patch.terminalApp = value.terminalApp;
  }
  if (value.defaultTextEditor !== undefined) {
    patch.defaultTextEditor = value.defaultTextEditor;
  }
  if (value.openWithApplications !== undefined) {
    patch.openWithApplications = value.openWithApplications;
  }
  if (value.fileActivationAction !== undefined) {
    patch.fileActivationAction = value.fileActivationAction;
  }
  if (value.openItemLimit !== undefined) {
    patch.openItemLimit = value.openItemLimit;
  }
  if (value.includeHidden !== undefined) {
    patch.includeHidden = value.includeHidden;
  }
  if (value.searchPatternMode !== undefined) {
    patch.searchPatternMode = value.searchPatternMode;
  }
  if (value.searchMatchScope !== undefined) {
    patch.searchMatchScope = value.searchMatchScope;
  }
  if (value.searchRecursive !== undefined) {
    patch.searchRecursive = value.searchRecursive;
  }
  if (value.searchSkipGitFolders !== undefined) {
    patch.searchSkipGitFolders = value.searchSkipGitFolders;
  }
  if (value.searchSkipGitIgnored !== undefined) {
    patch.searchSkipGitIgnored = value.searchSkipGitIgnored;
  }
  if (value.searchResultsSortBy !== undefined) {
    patch.searchResultsSortBy = value.searchResultsSortBy;
  }
  if (value.searchResultsSortDirection !== undefined) {
    patch.searchResultsSortDirection = value.searchResultsSortDirection;
  }
  if (value.treeWidth !== undefined) {
    patch.treeWidth = value.treeWidth;
  }
  if (value.inspectorWidth !== undefined) {
    patch.inspectorWidth = value.inspectorWidth;
  }
  if (value.restoreLastVisitedFolderOnStartup !== undefined) {
    patch.restoreLastVisitedFolderOnStartup = value.restoreLastVisitedFolderOnStartup;
  }
  if (value.treeRootPath !== undefined) {
    patch.treeRootPath = value.treeRootPath;
  }
  if (value.lastVisitedPath !== undefined) {
    patch.lastVisitedPath = value.lastVisitedPath;
  }
  if (value.lastVisitedFavoritePath !== undefined) {
    patch.lastVisitedFavoritePath = value.lastVisitedFavoritePath;
  }
  if (value.favorites !== undefined) {
    patch.favorites = value.favorites;
  }
  if (value.favoritesPlacement !== undefined) {
    patch.favoritesPlacement = value.favoritesPlacement;
  }
  if (value.favoritesExpanded !== undefined) {
    patch.favoritesExpanded = value.favoritesExpanded;
  }
  if (value.favoritesInitialized !== undefined) {
    patch.favoritesInitialized = value.favoritesInitialized;
  }
  if (value.singleClickExpandTreeItems !== undefined) {
    patch.singleClickExpandTreeItems = value.singleClickExpandTreeItems;
  }
  return patch;
}
