import { useEffect, useState } from "react";

import {
  AUTO_THEME_OPTION,
  type AppPreferences,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TEXT_EDITOR,
  type FavoritePreference,
  MACOS_ACCENT_OPTIONS,
  NOTIFICATION_DURATION_SECONDS_OPTIONS,
  THEME_OPTIONS,
  TYPEAHEAD_DEBOUNCE_OPTIONS,
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
  UI_FONT_WEIGHT_OPTIONS,
} from "../shared/appPreferences";
import { DEFAULT_LEFT_TOOLBAR_ITEMS, DEFAULT_TOP_TOOLBAR_ITEMS } from "../shared/toolbarItems";
import { type SearchDefaults, type SettingsTab, SettingsView } from "./components/SettingsView";
import { applyPreferencesPatch, useAppPreferences } from "./hooks/useAppPreferences";
import { type PreferencesPatch, usePreferencesSync } from "./hooks/usePreferencesSync";
import { createFavorite, getDefaultFavorites, isFavoritePath } from "./lib/favorites";
import { useFiletrailClient } from "./lib/filetrailClient";
import { getThemeAppearanceDefaults } from "./lib/theme";

const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: string }> = [
  {
    id: "general",
    label: "General",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: "M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.5 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.8.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7.8-9-7.8zM7.5 11h.01M9.5 7.5h.01M14 7h.01M17 10h.01",
  },
  {
    id: "explorer",
    label: "Explorer",
    icon: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 3v18",
  },
  {
    id: "search",
    label: "Search",
    icon: "M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM20 20l-4.2-4.2",
  },
  {
    id: "files",
    label: "Files",
    icon: "M8 3h7l5 5v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15 3v5h5",
  },
  {
    id: "toolbars",
    label: "Toolbars",
    icon: "M3 5h18M3 12h18M3 19h18M7 3v4M15 10v4M11 17v4",
  },
];

function createOpenWithApplicationId(): string {
  return `open-with-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The Settings window: its own renderer entry (`#settings`) with a macOS preferences
// toolbar of tabs. Edits persist through the same IPC as the explorer window and are
// broadcast to it by the main process.
export function SettingsWindowApp() {
  const client = useFiletrailClient();
  const preferences = useAppPreferences();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [homePath, setHomePath] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Search defaults live in the explorer's search session; Settings edits the persisted values.
  const [searchDefaults, setSearchDefaults] = useState<SearchDefaults>({
    searchPatternMode: DEFAULT_APP_PREFERENCES.searchPatternMode,
    searchMatchScope: DEFAULT_APP_PREFERENCES.searchMatchScope,
    searchRecursive: DEFAULT_APP_PREFERENCES.searchRecursive,
    searchIncludeHidden: DEFAULT_APP_PREFERENCES.searchIncludeHidden,
    searchResultsFilterScope: DEFAULT_APP_PREFERENCES.searchResultsFilterScope,
  });
  const {
    preferencesReady,
    setPreferencesReady,
    theme,
    effectiveTheme,
    textPrimaryOverride,
    textSecondaryOverride,
    textMutedOverride,
  } = preferences;

  const payload: PreferencesPatch = {
    theme: preferences.theme,
    autoLightTheme: preferences.autoLightTheme,
    autoDarkTheme: preferences.autoDarkTheme,
    iconTheme: preferences.iconTheme,
    accent: preferences.accent,
    accentToolbarButtons: preferences.accentToolbarButtons,
    toolbarAccent: preferences.toolbarAccent,
    accentFavoriteItems: preferences.accentFavoriteItems,
    accentFavoriteText: preferences.accentFavoriteText,
    favoriteAccent: preferences.favoriteAccent,
    zoomPercent: preferences.zoomPercent,
    uiFontFamily: preferences.uiFontFamily,
    uiFontSize: preferences.uiFontSize,
    uiFontWeight: preferences.uiFontWeight,
    textPrimaryOverride,
    textSecondaryOverride,
    textMutedOverride,
    compactListView: preferences.compactListView,
    compactDetailsView: preferences.compactDetailsView,
    compactTreeView: preferences.compactTreeView,
    singleClickExpandTreeItems: preferences.singleClickExpandTreeItems,
    highlightHoveredItems: preferences.highlightHoveredItems,
    detailColumns: preferences.detailColumns,
    tabSwitchesExplorerPanes: preferences.tabSwitchesExplorerPanes,
    typeaheadEnabled: preferences.typeaheadEnabled,
    typeaheadDebounceMs: preferences.typeaheadDebounceMs,
    notificationsEnabled: preferences.notificationsEnabled,
    notificationDurationSeconds: preferences.notificationDurationSeconds,
    actionLogEnabled: preferences.actionLogEnabled,
    topToolbarItems: preferences.topToolbarItems,
    leftToolbarItems: preferences.leftToolbarItems,
    showSidebarRail: preferences.showSidebarRail,
    restoreLastVisitedFolderOnStartup: preferences.restoreLastVisitedFolderOnStartup,
    favorites: preferences.favorites,
    favoritesPlacement: preferences.favoritesPlacement,
    terminalApp: preferences.terminalApp,
    defaultTextEditor: preferences.defaultTextEditor,
    openWithApplications: preferences.openWithApplications,
    fileActivationAction: preferences.fileActivationAction,
    returnKeyAction: preferences.returnKeyAction,
    openItemLimit: preferences.openItemLimit,
    ...searchDefaults,
  };

  const { markSynced } = usePreferencesSync({
    client,
    ready: preferencesReady,
    payload,
    onRemotePatch: (patch) => {
      applyPreferencesPatch(preferences, patch as Partial<AppPreferences>);
      applySearchDefaultsPatch(patch as Partial<AppPreferences>);
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: load persisted preferences once per client.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      client.invoke("app:getPreferences", {}),
      client.invoke("app:getHomeDirectory", {}),
    ])
      .then(([preferencesResponse, homeResponse]) => {
        if (cancelled) {
          return;
        }
        markSynced(preferencesResponse.preferences);
        applyPreferencesPatch(preferences, preferencesResponse.preferences);
        applySearchDefaultsPatch(preferencesResponse.preferences);
        setHomePath(homeResponse.path);
        setPreferencesReady(true);
      })
      .catch(() => {
        setNotice("Unable to load settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    document.title = "Settings";
    document.body.classList.add("settings-window-body");
    return () => document.body.classList.remove("settings-window-body");
  }, []);

  const defaults = getThemeAppearanceDefaults(effectiveTheme);

  function applySearchDefaultsPatch(patch: Partial<AppPreferences>) {
    setSearchDefaults((current) => ({
      searchPatternMode: patch.searchPatternMode ?? current.searchPatternMode,
      searchMatchScope: patch.searchMatchScope ?? current.searchMatchScope,
      searchRecursive: patch.searchRecursive ?? current.searchRecursive,
      searchIncludeHidden: patch.searchIncludeHidden ?? current.searchIncludeHidden,
      searchResultsFilterScope: patch.searchResultsFilterScope ?? current.searchResultsFilterScope,
    }));
  }

  async function pickApplication(failureMessage: string) {
    try {
      const response = await client.invoke("system:pickApplication", {});
      if (response.canceled || !response.appPath || !response.appName) {
        return null;
      }
      return { appPath: response.appPath, appName: response.appName };
    } catch {
      setNotice(failureMessage);
      return null;
    }
  }

  async function pickDirectory(defaultPath: string | null) {
    try {
      const response = await client.invoke("system:pickDirectory", { defaultPath });
      return response.canceled ? null : response.path;
    } catch {
      setNotice("Unable to choose a folder.");
      return null;
    }
  }

  async function addFavorite() {
    const pickedPath = await pickDirectory(homePath || null);
    if (!pickedPath || isFavoritePath(preferences.favorites, pickedPath)) {
      return;
    }
    preferences.setFavorites((current) => [...current, createFavorite(pickedPath, homePath)]);
  }

  async function browseFavorite(index: number) {
    const currentFavorite = preferences.favorites[index];
    if (!currentFavorite) {
      return;
    }
    const pickedPath = await pickDirectory(currentFavorite.path);
    if (
      !pickedPath ||
      preferences.favorites.some(
        (favorite, favoriteIndex) => favoriteIndex !== index && favorite.path === pickedPath,
      )
    ) {
      return;
    }
    preferences.setFavorites((current) =>
      current.map((favorite, favoriteIndex) =>
        favoriteIndex === index ? { path: pickedPath, icon: favorite.icon } : favorite,
      ),
    );
  }

  function moveItem<T>(items: T[], index: number, direction: "up" | "down"): T[] {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || index >= items.length || targetIndex < 0 || targetIndex >= items.length) {
      return items;
    }
    const next = [...items];
    const [item] = next.splice(index, 1);
    if (item === undefined) {
      return items;
    }
    next.splice(targetIndex, 0, item);
    return next;
  }

  async function addOpenWithApplication() {
    const selection = await pickApplication("Unable to choose an application.");
    if (!selection) {
      return;
    }
    preferences.setOpenWithApplications((current) => [
      ...current,
      { id: createOpenWithApplicationId(), ...selection },
    ]);
  }

  async function browseOpenWithApplication(entryId: string) {
    const selection = await pickApplication("Unable to choose an application.");
    if (!selection) {
      return;
    }
    preferences.setOpenWithApplications((current) =>
      current.map((entry) => (entry.id === entryId ? { ...entry, ...selection } : entry)),
    );
  }

  return (
    <main className="settings-window">
      <header className="settings-window-toolbar">
        <div className="settings-window-title">
          {SETTINGS_TABS.find((tab) => tab.id === activeTab)?.label}
        </div>
        <nav className="settings-window-tabs" aria-label="Settings sections">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`settings-window-tab${tab.id === activeTab ? " active" : ""}`}
              aria-pressed={tab.id === activeTab}
              onClick={() => setActiveTab(tab.id)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="settings-window-tab-icon">
                <path d={tab.icon} />
              </svg>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </header>
      {notice ? (
        <output className="settings-window-notice">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </output>
      ) : null}
      <div className="settings-window-body-scroll">
        {preferencesReady ? (
          <SettingsView
            activeTab={activeTab}
            searchDefaults={searchDefaults}
            onSearchDefaultsChange={(patch) =>
              setSearchDefaults((current) => ({ ...current, ...patch }))
            }
            theme={theme}
            effectiveTheme={effectiveTheme}
            autoLightTheme={preferences.autoLightTheme}
            autoDarkTheme={preferences.autoDarkTheme}
            onAutoLightThemeChange={preferences.setAutoLightTheme}
            onAutoDarkThemeChange={preferences.setAutoDarkTheme}
            iconTheme={preferences.iconTheme}
            accent={preferences.accent}
            accentToolbarButtons={preferences.accentToolbarButtons}
            toolbarAccent={preferences.toolbarAccent}
            accentFavoriteItems={preferences.accentFavoriteItems}
            accentFavoriteText={preferences.accentFavoriteText}
            favoriteAccent={preferences.favoriteAccent}
            zoomPercent={preferences.zoomPercent}
            uiFontFamily={preferences.uiFontFamily}
            uiFontSize={preferences.uiFontSize}
            uiFontWeight={preferences.uiFontWeight}
            effectiveTextPrimaryColor={textPrimaryOverride ?? defaults.primary}
            effectiveTextSecondaryColor={textSecondaryOverride ?? defaults.secondary}
            effectiveTextMutedColor={textMutedOverride ?? defaults.muted}
            compactListView={preferences.compactListView}
            compactDetailsView={preferences.compactDetailsView}
            compactTreeView={preferences.compactTreeView}
            singleClickExpandTreeItems={preferences.singleClickExpandTreeItems}
            highlightHoveredItems={preferences.highlightHoveredItems}
            detailColumns={preferences.detailColumns}
            layoutMode="wide"
            tabSwitchesExplorerPanes={preferences.tabSwitchesExplorerPanes}
            typeaheadEnabled={preferences.typeaheadEnabled}
            typeaheadDebounceMs={preferences.typeaheadDebounceMs}
            notificationsEnabled={preferences.notificationsEnabled}
            notificationDurationSeconds={preferences.notificationDurationSeconds}
            actionLogEnabled={preferences.actionLogEnabled}
            topToolbarItems={preferences.topToolbarItems}
            leftToolbarItems={preferences.leftToolbarItems}
            showSidebarRail={preferences.showSidebarRail}
            onShowSidebarRailChange={preferences.setShowSidebarRail}
            restoreLastVisitedFolderOnStartup={preferences.restoreLastVisitedFolderOnStartup}
            homePath={homePath}
            terminalApp={preferences.terminalApp}
            defaultTextEditor={preferences.defaultTextEditor}
            favorites={preferences.favorites}
            favoritesPlacement={preferences.favoritesPlacement}
            openWithApplications={preferences.openWithApplications}
            fileActivationAction={preferences.fileActivationAction}
            returnKeyAction={preferences.returnKeyAction}
            onReturnKeyActionChange={preferences.setReturnKeyAction}
            openItemLimit={preferences.openItemLimit}
            themeOptions={[AUTO_THEME_OPTION, ...THEME_OPTIONS]}
            accentOptions={[...MACOS_ACCENT_OPTIONS]}
            uiFontOptions={[...UI_FONT_OPTIONS]}
            uiFontSizeOptions={[...UI_FONT_SIZE_OPTIONS]}
            uiFontWeightOptions={[...UI_FONT_WEIGHT_OPTIONS]}
            typeaheadDebounceOptions={[...TYPEAHEAD_DEBOUNCE_OPTIONS]}
            notificationDurationSecondsOptions={[...NOTIFICATION_DURATION_SECONDS_OPTIONS]}
            onThemeChange={preferences.setTheme}
            onIconThemeChange={preferences.setIconTheme}
            onAccentChange={preferences.setAccent}
            onAccentToolbarButtonsChange={preferences.setAccentToolbarButtons}
            onToolbarAccentChange={preferences.setToolbarAccent}
            onAccentFavoriteItemsChange={preferences.setAccentFavoriteItems}
            onAccentFavoriteTextChange={preferences.setAccentFavoriteText}
            onFavoriteAccentChange={preferences.setFavoriteAccent}
            onZoomPercentChange={preferences.setZoomPercent}
            onUiFontFamilyChange={preferences.setUiFontFamily}
            onUiFontSizeChange={preferences.setUiFontSize}
            onUiFontWeightChange={preferences.setUiFontWeight}
            onTextPrimaryColorChange={preferences.setTextPrimaryOverride}
            onTextSecondaryColorChange={preferences.setTextSecondaryOverride}
            onTextMutedColorChange={preferences.setTextMutedOverride}
            onResetAppearance={preferences.resetAppearanceSettings}
            onCompactListViewChange={preferences.setCompactListView}
            onCompactDetailsViewChange={preferences.setCompactDetailsView}
            onCompactTreeViewChange={preferences.setCompactTreeView}
            onSingleClickExpandTreeItemsChange={preferences.setSingleClickExpandTreeItems}
            onHighlightHoveredItemsChange={preferences.setHighlightHoveredItems}
            onDetailColumnsChange={preferences.setDetailColumns}
            onTabSwitchesExplorerPanesChange={preferences.setTabSwitchesExplorerPanes}
            onTypeaheadEnabledChange={preferences.setTypeaheadEnabled}
            onTypeaheadDebounceMsChange={preferences.setTypeaheadDebounceMs}
            onNotificationsEnabledChange={preferences.setNotificationsEnabled}
            onNotificationDurationSecondsChange={preferences.setNotificationDurationSeconds}
            onActionLogEnabledChange={preferences.setActionLogEnabled}
            onTopToolbarItemsChange={preferences.setTopToolbarItems}
            onLeftToolbarItemsChange={preferences.setLeftToolbarItems}
            onResetTopToolbar={() => preferences.setTopToolbarItems([...DEFAULT_TOP_TOOLBAR_ITEMS])}
            onResetLeftToolbar={() =>
              preferences.setLeftToolbarItems({
                main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
                utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
              })
            }
            onResetToolbars={() => {
              preferences.setTopToolbarItems([...DEFAULT_TOP_TOOLBAR_ITEMS]);
              preferences.setLeftToolbarItems({
                main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
                utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
              });
            }}
            onRestoreLastVisitedFolderOnStartupChange={
              preferences.setRestoreLastVisitedFolderOnStartup
            }
            onBrowseTerminalApp={() => {
              void pickApplication("Unable to choose a terminal application.").then(
                (selection) => selection && preferences.setTerminalApp(selection),
              );
            }}
            onClearTerminalApp={() => preferences.setTerminalApp(null)}
            onBrowseDefaultTextEditor={() => {
              void pickApplication("Unable to choose a default text editor.").then(
                (selection) => selection && preferences.setDefaultTextEditor(selection),
              );
            }}
            onClearDefaultTextEditor={() => preferences.setDefaultTextEditor(DEFAULT_TEXT_EDITOR)}
            onAddFavorite={() => {
              void addFavorite();
            }}
            onBrowseFavorite={(index) => {
              void browseFavorite(index);
            }}
            onMoveFavorite={(index, direction) =>
              preferences.setFavorites((current) => moveItem(current, index, direction))
            }
            onRemoveFavorite={(index) =>
              preferences.setFavorites((current) =>
                current.filter((_, favoriteIndex) => favoriteIndex !== index),
              )
            }
            onRestoreDefaultFavorites={() =>
              preferences.setFavorites(getDefaultFavorites(homePath))
            }
            onFavoriteIconChange={(index, icon: FavoritePreference["icon"]) =>
              preferences.setFavorites((current) =>
                current.map((favorite, favoriteIndex) =>
                  favoriteIndex === index ? { ...favorite, icon } : favorite,
                ),
              )
            }
            onFavoritesPlacementChange={preferences.setFavoritesPlacement}
            onAddOpenWithApplication={() => {
              void addOpenWithApplication();
            }}
            onBrowseOpenWithApplication={(entryId) => {
              void browseOpenWithApplication(entryId);
            }}
            onMoveOpenWithApplication={(entryId, direction) =>
              preferences.setOpenWithApplications((current) =>
                moveItem(
                  current,
                  current.findIndex((entry) => entry.id === entryId),
                  direction,
                ),
              )
            }
            onRemoveOpenWithApplication={(entryId) =>
              preferences.setOpenWithApplications((current) =>
                current.filter((entry) => entry.id !== entryId),
              )
            }
            onFileActivationActionChange={preferences.setFileActivationAction}
            onOpenItemLimitChange={preferences.setOpenItemLimit}
          />
        ) : null}
      </div>
    </main>
  );
}
