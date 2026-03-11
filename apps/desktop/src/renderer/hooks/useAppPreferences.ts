import { useEffect, useState } from "react";

import {
  type AccentMode,
  type ApplicationSelection,
  type CopyPasteReviewDialogSize,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_DETAIL_COLUMN_VISIBILITY,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  type ExplorerViewMode,
  type FavoritePreference,
  type FavoritesPlacement,
  type FileActivationAction,
  type OpenWithApplication,
  type ThemeMode,
  type UiFontFamily,
  type UiFontWeight,
} from "../../shared/appPreferences";
import { applyAppearance } from "../lib/theme";

export function useAppPreferences() {
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(DEFAULT_APP_PREFERENCES.theme);
  const [accent, setAccent] = useState<AccentMode>(DEFAULT_APP_PREFERENCES.accent);
  const [accentToolbarButtons, setAccentToolbarButtons] = useState(
    DEFAULT_APP_PREFERENCES.accentToolbarButtons,
  );
  const [accentFavoriteItems, setAccentFavoriteItems] = useState(
    DEFAULT_APP_PREFERENCES.accentFavoriteItems,
  );
  const [accentFavoriteText, setAccentFavoriteText] = useState(
    DEFAULT_APP_PREFERENCES.accentFavoriteText,
  );
  const [favoriteAccent, setFavoriteAccent] = useState<AccentMode>(
    DEFAULT_APP_PREFERENCES.favoriteAccent,
  );
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_APP_PREFERENCES.zoomPercent);
  const [uiFontFamily, setUiFontFamily] = useState<UiFontFamily>(
    DEFAULT_APP_PREFERENCES.uiFontFamily,
  );
  const [uiFontSize, setUiFontSize] = useState(DEFAULT_APP_PREFERENCES.uiFontSize);
  const [uiFontWeight, setUiFontWeight] = useState<UiFontWeight>(
    DEFAULT_APP_PREFERENCES.uiFontWeight,
  );
  const [textPrimaryOverride, setTextPrimaryOverride] = useState(
    DEFAULT_APP_PREFERENCES.textPrimaryOverride,
  );
  const [textSecondaryOverride, setTextSecondaryOverride] = useState(
    DEFAULT_APP_PREFERENCES.textSecondaryOverride,
  );
  const [textMutedOverride, setTextMutedOverride] = useState(
    DEFAULT_APP_PREFERENCES.textMutedOverride,
  );
  const [includeHidden, setIncludeHidden] = useState(DEFAULT_APP_PREFERENCES.includeHidden);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>(DEFAULT_APP_PREFERENCES.viewMode);
  const [foldersFirst, setFoldersFirst] = useState(DEFAULT_APP_PREFERENCES.foldersFirst);
  const [compactListView, setCompactListView] = useState(DEFAULT_APP_PREFERENCES.compactListView);
  const [compactDetailsView, setCompactDetailsView] = useState(
    DEFAULT_APP_PREFERENCES.compactDetailsView,
  );
  const [compactTreeView, setCompactTreeView] = useState(DEFAULT_APP_PREFERENCES.compactTreeView);
  const [singleClickExpandTreeItems, setSingleClickExpandTreeItems] = useState(
    DEFAULT_APP_PREFERENCES.singleClickExpandTreeItems,
  );
  const [highlightHoveredItems, setHighlightHoveredItems] = useState(
    DEFAULT_APP_PREFERENCES.highlightHoveredItems,
  );
  const [detailColumns, setDetailColumns] = useState<DetailColumnVisibility>(
    DEFAULT_DETAIL_COLUMN_VISIBILITY,
  );
  const [detailColumnWidths, setDetailColumnWidths] = useState<DetailColumnWidths>(
    DEFAULT_DETAIL_COLUMN_WIDTHS,
  );
  const [tabSwitchesExplorerPanes, setTabSwitchesExplorerPanes] = useState(
    DEFAULT_APP_PREFERENCES.tabSwitchesExplorerPanes,
  );
  const [typeaheadEnabled, setTypeaheadEnabled] = useState(
    DEFAULT_APP_PREFERENCES.typeaheadEnabled,
  );
  const [typeaheadDebounceMs, setTypeaheadDebounceMs] = useState(
    DEFAULT_APP_PREFERENCES.typeaheadDebounceMs,
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    DEFAULT_APP_PREFERENCES.notificationsEnabled,
  );
  const [notificationDurationSeconds, setNotificationDurationSeconds] = useState(
    DEFAULT_APP_PREFERENCES.notificationDurationSeconds,
  );
  const [actionLogEnabled, setActionLogEnabled] = useState(
    DEFAULT_APP_PREFERENCES.actionLogEnabled,
  );
  const [restoreLastVisitedFolderOnStartup, setRestoreLastVisitedFolderOnStartup] = useState(
    DEFAULT_APP_PREFERENCES.restoreLastVisitedFolderOnStartup,
  );
  const [favorites, setFavorites] = useState<FavoritePreference[]>(
    DEFAULT_APP_PREFERENCES.favorites,
  );
  const [favoritesPlacement, setFavoritesPlacement] = useState<FavoritesPlacement>(
    DEFAULT_APP_PREFERENCES.favoritesPlacement,
  );
  const [favoritesPaneHeight, setFavoritesPaneHeight] = useState<number | null>(
    DEFAULT_APP_PREFERENCES.favoritesPaneHeight,
  );
  const [favoritesExpanded, setFavoritesExpanded] = useState(
    DEFAULT_APP_PREFERENCES.favoritesExpanded,
  );
  const [favoritesInitialized, setFavoritesInitialized] = useState(
    DEFAULT_APP_PREFERENCES.favoritesInitialized,
  );
  const [copyPasteReviewDialogSize, setCopyPasteReviewDialogSize] =
    useState<CopyPasteReviewDialogSize | null>(DEFAULT_APP_PREFERENCES.copyPasteReviewDialogSize);
  const [terminalApp, setTerminalApp] = useState<ApplicationSelection | null>(
    DEFAULT_APP_PREFERENCES.terminalApp,
  );
  const [defaultTextEditor, setDefaultTextEditor] = useState<ApplicationSelection>(
    DEFAULT_APP_PREFERENCES.defaultTextEditor,
  );
  const [openWithApplications, setOpenWithApplications] = useState<OpenWithApplication[]>(
    DEFAULT_APP_PREFERENCES.openWithApplications,
  );
  const [fileActivationAction, setFileActivationAction] = useState<FileActivationAction>(
    DEFAULT_APP_PREFERENCES.fileActivationAction,
  );
  const [openItemLimit, setOpenItemLimit] = useState(DEFAULT_APP_PREFERENCES.openItemLimit);
  useEffect(() => {
    applyAppearance({
      theme,
      accent,
      accentToolbarButtons,
      accentFavoriteItems,
      accentFavoriteText,
      favoriteAccent,
      uiFontFamily,
      uiFontSize,
      uiFontWeight,
      textPrimaryOverride,
      textSecondaryOverride,
      textMutedOverride,
    });
  }, [
    accent,
    accentToolbarButtons,
    accentFavoriteItems,
    accentFavoriteText,
    favoriteAccent,
    textMutedOverride,
    textPrimaryOverride,
    textSecondaryOverride,
    theme,
    uiFontFamily,
    uiFontSize,
    uiFontWeight,
  ]);

  function resetAppearanceSettings() {
    setAccent(DEFAULT_APP_PREFERENCES.accent);
    setZoomPercent(DEFAULT_APP_PREFERENCES.zoomPercent);
    setUiFontFamily(DEFAULT_APP_PREFERENCES.uiFontFamily);
    setUiFontSize(DEFAULT_APP_PREFERENCES.uiFontSize);
    setUiFontWeight(DEFAULT_APP_PREFERENCES.uiFontWeight);
    setTextPrimaryOverride(null);
    setTextSecondaryOverride(null);
    setTextMutedOverride(null);
    setAccentToolbarButtons(DEFAULT_APP_PREFERENCES.accentToolbarButtons);
    setAccentFavoriteItems(DEFAULT_APP_PREFERENCES.accentFavoriteItems);
    setAccentFavoriteText(DEFAULT_APP_PREFERENCES.accentFavoriteText);
    setFavoriteAccent(DEFAULT_APP_PREFERENCES.favoriteAccent);
  }

  return {
    preferencesReady,
    setPreferencesReady,
    theme,
    setTheme,
    accent,
    setAccent,
    accentToolbarButtons,
    setAccentToolbarButtons,
    accentFavoriteItems,
    setAccentFavoriteItems,
    accentFavoriteText,
    setAccentFavoriteText,
    favoriteAccent,
    setFavoriteAccent,
    zoomPercent,
    setZoomPercent,
    uiFontFamily,
    setUiFontFamily,
    uiFontSize,
    setUiFontSize,
    uiFontWeight,
    setUiFontWeight,
    textPrimaryOverride,
    setTextPrimaryOverride,
    textSecondaryOverride,
    setTextSecondaryOverride,
    textMutedOverride,
    setTextMutedOverride,
    includeHidden,
    setIncludeHidden,
    viewMode,
    setViewMode,
    foldersFirst,
    setFoldersFirst,
    compactListView,
    setCompactListView,
    compactDetailsView,
    setCompactDetailsView,
    compactTreeView,
    setCompactTreeView,
    singleClickExpandTreeItems,
    setSingleClickExpandTreeItems,
    highlightHoveredItems,
    setHighlightHoveredItems,
    detailColumns,
    setDetailColumns,
    detailColumnWidths,
    setDetailColumnWidths,
    tabSwitchesExplorerPanes,
    setTabSwitchesExplorerPanes,
    typeaheadEnabled,
    setTypeaheadEnabled,
    typeaheadDebounceMs,
    setTypeaheadDebounceMs,
    notificationsEnabled,
    setNotificationsEnabled,
    notificationDurationSeconds,
    setNotificationDurationSeconds,
    actionLogEnabled,
    setActionLogEnabled,
    restoreLastVisitedFolderOnStartup,
    setRestoreLastVisitedFolderOnStartup,
    favorites,
    setFavorites,
    favoritesPlacement,
    setFavoritesPlacement,
    favoritesPaneHeight,
    setFavoritesPaneHeight,
    favoritesExpanded,
    setFavoritesExpanded,
    favoritesInitialized,
    setFavoritesInitialized,
    copyPasteReviewDialogSize,
    setCopyPasteReviewDialogSize,
    terminalApp,
    setTerminalApp,
    defaultTextEditor,
    setDefaultTextEditor,
    openWithApplications,
    setOpenWithApplications,
    fileActivationAction,
    setFileActivationAction,
    openItemLimit,
    setOpenItemLimit,
    resetAppearanceSettings,
  };
}
