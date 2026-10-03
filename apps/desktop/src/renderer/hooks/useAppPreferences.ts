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
  type OpenWithApplication,
  type ReturnKeyAction,
  type ThemePreference,
  resolveEffectiveTheme,
} from "../../shared/appPreferences";
import type { ShortcutOverrides } from "../../shared/shortcuts";
import { applyAppearance } from "../lib/theme";

export function useAppPreferences() {
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(DEFAULT_APP_PREFERENCES.theme);
  const systemPrefersDark = useSystemPrefersDark();
  const effectiveTheme = resolveEffectiveTheme(theme, systemPrefersDark);
  const [accent, setAccent] = useState<AccentMode>(DEFAULT_APP_PREFERENCES.accent);
  const [zoomPercent, setZoomPercent] = useState(DEFAULT_APP_PREFERENCES.zoomPercent);
  const [includeHidden, setIncludeHidden] = useState(DEFAULT_APP_PREFERENCES.includeHidden);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>(DEFAULT_APP_PREFERENCES.viewMode);
  const [foldersFirst, setFoldersFirst] = useState(DEFAULT_APP_PREFERENCES.foldersFirst);
  const [compactListView, setCompactListView] = useState(DEFAULT_APP_PREFERENCES.compactListView);
  const [compactDetailsView, setCompactDetailsView] = useState(
    DEFAULT_APP_PREFERENCES.compactDetailsView,
  );
  const [compactIconView, setCompactIconView] = useState(DEFAULT_APP_PREFERENCES.compactIconView);
  const [compactTreeView, setCompactTreeView] = useState(DEFAULT_APP_PREFERENCES.compactTreeView);
  const [singleClickExpandTreeItems, setSingleClickExpandTreeItems] = useState(
    DEFAULT_APP_PREFERENCES.singleClickExpandTreeItems,
  );
  const [detailColumns, setDetailColumns] = useState<DetailColumnVisibility>(
    DEFAULT_DETAIL_COLUMN_VISIBILITY,
  );
  const [detailColumnWidths, setDetailColumnWidths] = useState<DetailColumnWidths>(
    DEFAULT_DETAIL_COLUMN_WIDTHS,
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    DEFAULT_APP_PREFERENCES.notificationsEnabled,
  );
  const [markClipboardItems, setMarkClipboardItems] = useState(
    DEFAULT_APP_PREFERENCES.markClipboardItems,
  );
  const [topToolbarItems, setTopToolbarItems] = useState(DEFAULT_APP_PREFERENCES.topToolbarItems);
  const [restoreSessionOnStartup, setRestoreSessionOnStartup] = useState(
    DEFAULT_APP_PREFERENCES.restoreSessionOnStartup,
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
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>(
    DEFAULT_APP_PREFERENCES.shortcutOverrides,
  );
  useEffect(() => {
    applyAppearance({ theme: effectiveTheme, accent });
  }, [accent, effectiveTheme]);

  // Everything in the Appearance group of Settings, back as a new install has it.
  function resetAppearanceSettings() {
    setTheme(DEFAULT_APP_PREFERENCES.theme);
    setAccent(DEFAULT_APP_PREFERENCES.accent);
    setZoomPercent(DEFAULT_APP_PREFERENCES.zoomPercent);
  }

  return {
    preferencesReady,
    setPreferencesReady,
    theme,
    setTheme,
    effectiveTheme,
    accent,
    setAccent,
    zoomPercent,
    setZoomPercent,
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
    compactIconView,
    setCompactIconView,
    compactTreeView,
    setCompactTreeView,
    singleClickExpandTreeItems,
    setSingleClickExpandTreeItems,
    detailColumns,
    setDetailColumns,
    detailColumnWidths,
    setDetailColumnWidths,
    notificationsEnabled,
    setNotificationsEnabled,
    markClipboardItems,
    setMarkClipboardItems,
    topToolbarItems,
    setTopToolbarItems,
    restoreSessionOnStartup,
    setRestoreSessionOnStartup,
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
    shortcutOverrides,
    setShortcutOverrides,
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
  set("accent", store.setAccent);
  set("zoomPercent", store.setZoomPercent);
  set("compactListView", store.setCompactListView);
  set("compactDetailsView", store.setCompactDetailsView);
  set("compactIconView", store.setCompactIconView);
  set("compactTreeView", store.setCompactTreeView);
  set("singleClickExpandTreeItems", store.setSingleClickExpandTreeItems);
  set("detailColumns", store.setDetailColumns);
  set("notificationsEnabled", store.setNotificationsEnabled);
  set("markClipboardItems", store.setMarkClipboardItems);
  set("topToolbarItems", store.setTopToolbarItems);
  set("restoreSessionOnStartup", store.setRestoreSessionOnStartup);
  set("favorites", store.setFavorites);
  set("favoritesPlacement", store.setFavoritesPlacement);
  set("terminalApp", store.setTerminalApp);
  set("defaultTextEditor", store.setDefaultTextEditor);
  set("openWithApplications", store.setOpenWithApplications);
  set("fileActivationAction", store.setFileActivationAction);
  set("returnKeyAction", store.setReturnKeyAction);
  set("shortcutOverrides", store.setShortcutOverrides);
  set("openItemLimit", store.setOpenItemLimit);
}
