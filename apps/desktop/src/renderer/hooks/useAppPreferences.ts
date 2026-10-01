import { useEffect, useState } from "react";

import {
  type AccentMode,
  type AppPreferences,
  type ApplicationSelection,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_DETAIL_COLUMN_VISIBILITY,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  type ExplorerViewMode,
  type FavoritePreference,
  type FavoritesPlacement,
  type FileActivationAction,
  type IconThemeMode,
  type LeftToolbarItems,
  type OpenWithApplication,
  type ReturnKeyAction,
  type ThemeMode,
  type ThemePreference,
  type UiFontFamily,
  resolveEffectiveTheme,
} from "../../shared/appPreferences";
import { applyAppearance } from "../lib/theme";

export function useAppPreferences() {
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_APP_PREFERENCES.theme);
  const [autoLightTheme, setAutoLightTheme] = useState<ThemeMode>(
    DEFAULT_APP_PREFERENCES.autoLightTheme,
  );
  const [autoDarkTheme, setAutoDarkTheme] = useState<ThemeMode>(
    DEFAULT_APP_PREFERENCES.autoDarkTheme,
  );
  const systemPrefersDark = useSystemPrefersDark();
  const effectiveTheme = resolveEffectiveTheme(
    theme,
    systemPrefersDark,
    autoLightTheme,
    autoDarkTheme,
  );
  const [iconTheme, setIconTheme] = useState<IconThemeMode>(DEFAULT_APP_PREFERENCES.iconTheme);
  const [accent, setAccent] = useState<AccentMode>(DEFAULT_APP_PREFERENCES.accent);
  const [accentToolbarButtons, setAccentToolbarButtons] = useState(
    DEFAULT_APP_PREFERENCES.accentToolbarButtons,
  );
  const [toolbarAccent, setToolbarAccent] = useState<AccentMode>(
    DEFAULT_APP_PREFERENCES.toolbarAccent,
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
  const [topToolbarItems, setTopToolbarItems] = useState(DEFAULT_APP_PREFERENCES.topToolbarItems);
  const [leftToolbarItems, setLeftToolbarItems] = useState<LeftToolbarItems>(
    DEFAULT_APP_PREFERENCES.leftToolbarItems,
  );
  const [showSidebarRail, setShowSidebarRail] = useState(DEFAULT_APP_PREFERENCES.showSidebarRail);
  const [showSidebarBottomRail, setShowSidebarBottomRail] = useState(
    DEFAULT_APP_PREFERENCES.showSidebarBottomRail,
  );
  const [restoreLastVisitedFolderOnStartup, setRestoreLastVisitedFolderOnStartup] = useState(
    DEFAULT_APP_PREFERENCES.restoreLastVisitedFolderOnStartup,
  );
  const [lastGoToFolderPath, setLastGoToFolderPath] = useState(
    DEFAULT_APP_PREFERENCES.lastGoToFolderPath,
  );
  const [favorites, setFavorites] = useState<FavoritePreference[]>(
    DEFAULT_APP_PREFERENCES.favorites,
  );
  const [favoritesPlacement, setFavoritesPlacement] = useState<FavoritesPlacement>(
    DEFAULT_APP_PREFERENCES.favoritesPlacement,
  );
  const [favoritesExpanded, setFavoritesExpanded] = useState(
    DEFAULT_APP_PREFERENCES.favoritesExpanded,
  );
  const [favoritesInitialized, setFavoritesInitialized] = useState(
    DEFAULT_APP_PREFERENCES.favoritesInitialized,
  );
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
  const [returnKeyAction, setReturnKeyAction] = useState<ReturnKeyAction>(
    DEFAULT_APP_PREFERENCES.returnKeyAction,
  );
  useEffect(() => {
    applyAppearance({
      theme: effectiveTheme,
      iconTheme,
      accent,
      accentToolbarButtons,
      toolbarAccent,
      accentFavoriteItems,
      accentFavoriteText,
      favoriteAccent,
      uiFontFamily,
      textPrimaryOverride,
      textSecondaryOverride,
      textMutedOverride,
    });
  }, [
    accent,
    accentToolbarButtons,
    toolbarAccent,
    accentFavoriteItems,
    accentFavoriteText,
    favoriteAccent,
    iconTheme,
    textMutedOverride,
    textPrimaryOverride,
    textSecondaryOverride,
    effectiveTheme,
    uiFontFamily,
  ]);

  function resetAppearanceSettings() {
    setIconTheme(DEFAULT_APP_PREFERENCES.iconTheme);
    setAccent(DEFAULT_APP_PREFERENCES.accent);
    setZoomPercent(DEFAULT_APP_PREFERENCES.zoomPercent);
    setUiFontFamily(DEFAULT_APP_PREFERENCES.uiFontFamily);
    setTextPrimaryOverride(null);
    setTextSecondaryOverride(null);
    setTextMutedOverride(null);
    setAccentToolbarButtons(DEFAULT_APP_PREFERENCES.accentToolbarButtons);
    setToolbarAccent(DEFAULT_APP_PREFERENCES.toolbarAccent);
    setAccentFavoriteItems(DEFAULT_APP_PREFERENCES.accentFavoriteItems);
    setAccentFavoriteText(DEFAULT_APP_PREFERENCES.accentFavoriteText);
    setFavoriteAccent(DEFAULT_APP_PREFERENCES.favoriteAccent);
  }

  return {
    preferencesReady,
    setPreferencesReady,
    theme,
    setTheme,
    autoLightTheme,
    setAutoLightTheme,
    autoDarkTheme,
    setAutoDarkTheme,
    effectiveTheme,
    iconTheme,
    setIconTheme,
    accent,
    setAccent,
    accentToolbarButtons,
    setAccentToolbarButtons,
    toolbarAccent,
    setToolbarAccent,
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
    topToolbarItems,
    setTopToolbarItems,
    leftToolbarItems,
    setLeftToolbarItems,
    showSidebarRail,
    setShowSidebarRail,
    showSidebarBottomRail,
    setShowSidebarBottomRail,
    restoreLastVisitedFolderOnStartup,
    setRestoreLastVisitedFolderOnStartup,
    lastGoToFolderPath,
    setLastGoToFolderPath,
    favorites,
    setFavorites,
    favoritesPlacement,
    setFavoritesPlacement,
    favoritesExpanded,
    setFavoritesExpanded,
    favoritesInitialized,
    setFavoritesInitialized,
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
    returnKeyAction,
    setReturnKeyAction,
    resetAppearanceSettings,
  };
}

const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

// Electron keeps prefers-color-scheme in sync with the macOS appearance, so this tracks
// Light/Dark switches (including scheduled Auto) while the app is running.
function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => readSystemPrefersDark());
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(DARK_SCHEME_QUERY);
    const update = () => setPrefersDark(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return prefersDark;
}

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(DARK_SCHEME_QUERY).matches;
}

type AppPreferencesStore = ReturnType<typeof useAppPreferences>;
type IncomingPreferences = Partial<AppPreferences>;

// Applies preferences edited in another window. Only user-facing settings are mapped;
// window-local state (navigation, pane sizes, search session) stays with its window.
export function applyPreferencesPatch(store: AppPreferencesStore, patch: IncomingPreferences) {
  const set = <K extends keyof AppPreferences>(
    key: K,
    setter: (value: AppPreferences[K]) => void,
  ) => {
    const value = patch[key];
    if (value !== undefined) {
      setter(value as AppPreferences[K]);
    }
  };
  set("theme", store.setTheme);
  set("autoLightTheme", store.setAutoLightTheme);
  set("autoDarkTheme", store.setAutoDarkTheme);
  set("iconTheme", store.setIconTheme);
  set("accent", store.setAccent);
  set("accentToolbarButtons", store.setAccentToolbarButtons);
  set("toolbarAccent", store.setToolbarAccent);
  set("accentFavoriteItems", store.setAccentFavoriteItems);
  set("accentFavoriteText", store.setAccentFavoriteText);
  set("favoriteAccent", store.setFavoriteAccent);
  set("zoomPercent", store.setZoomPercent);
  set("uiFontFamily", store.setUiFontFamily);
  set("textPrimaryOverride", store.setTextPrimaryOverride);
  set("textSecondaryOverride", store.setTextSecondaryOverride);
  set("textMutedOverride", store.setTextMutedOverride);
  set("compactListView", store.setCompactListView);
  set("compactDetailsView", store.setCompactDetailsView);
  set("compactTreeView", store.setCompactTreeView);
  set("singleClickExpandTreeItems", store.setSingleClickExpandTreeItems);
  set("highlightHoveredItems", store.setHighlightHoveredItems);
  set("detailColumns", store.setDetailColumns);
  set("tabSwitchesExplorerPanes", store.setTabSwitchesExplorerPanes);
  set("typeaheadEnabled", store.setTypeaheadEnabled);
  set("typeaheadDebounceMs", store.setTypeaheadDebounceMs);
  set("notificationsEnabled", store.setNotificationsEnabled);
  set("notificationDurationSeconds", store.setNotificationDurationSeconds);
  set("actionLogEnabled", store.setActionLogEnabled);
  set("topToolbarItems", store.setTopToolbarItems);
  set("leftToolbarItems", store.setLeftToolbarItems);
  set("showSidebarRail", store.setShowSidebarRail);
  set("showSidebarBottomRail", store.setShowSidebarBottomRail);
  set("restoreLastVisitedFolderOnStartup", store.setRestoreLastVisitedFolderOnStartup);
  set("favorites", store.setFavorites);
  set("favoritesPlacement", store.setFavoritesPlacement);
  set("terminalApp", store.setTerminalApp);
  set("defaultTextEditor", store.setDefaultTextEditor);
  set("openWithApplications", store.setOpenWithApplications);
  set("fileActivationAction", store.setFileActivationAction);
  set("returnKeyAction", store.setReturnKeyAction);
  set("openItemLimit", store.setOpenItemLimit);
}
