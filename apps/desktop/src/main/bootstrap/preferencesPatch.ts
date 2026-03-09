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
  if (value.accent !== undefined) {
    patch.accent = value.accent;
  }
  if (value.accentToolbarButtons !== undefined) {
    patch.accentToolbarButtons = value.accentToolbarButtons;
  }
  if (value.zoomPercent !== undefined) {
    patch.zoomPercent = value.zoomPercent;
  }
  if (value.uiFontFamily !== undefined) {
    patch.uiFontFamily = value.uiFontFamily;
  }
  if (value.uiFontSize !== undefined) {
    patch.uiFontSize = value.uiFontSize;
  }
  if (value.uiFontWeight !== undefined) {
    patch.uiFontWeight = value.uiFontWeight;
  }
  if (value.textPrimaryOverride !== undefined) {
    patch.textPrimaryOverride = value.textPrimaryOverride;
  }
  if (value.textSecondaryOverride !== undefined) {
    patch.textSecondaryOverride = value.textSecondaryOverride;
  }
  if (value.textMutedOverride !== undefined) {
    patch.textMutedOverride = value.textMutedOverride;
  }
  if (value.viewMode !== undefined) {
    patch.viewMode = value.viewMode;
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
  if (value.typeaheadEnabled !== undefined) {
    patch.typeaheadEnabled = value.typeaheadEnabled;
  }
  if (value.typeaheadDebounceMs !== undefined) {
    patch.typeaheadDebounceMs = value.typeaheadDebounceMs;
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
  if (value.searchIncludeHidden !== undefined) {
    patch.searchIncludeHidden = value.searchIncludeHidden;
  }
  if (value.searchResultsSortBy !== undefined) {
    patch.searchResultsSortBy = value.searchResultsSortBy;
  }
  if (value.searchResultsSortDirection !== undefined) {
    patch.searchResultsSortDirection = value.searchResultsSortDirection;
  }
  if (value.searchResultsFilterScope !== undefined) {
    patch.searchResultsFilterScope = value.searchResultsFilterScope;
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
  return patch;
}
