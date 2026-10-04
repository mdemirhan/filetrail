import { useEffect, useState } from "react";

import {
  ACCENT_OPTIONS,
  type AppPreferences,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TEXT_EDITOR,
  type FavoritePreference,
} from "../shared/appPreferences";
import { PushButton } from "./components/PushButton";
import { type SearchDefaults, type SettingsTab, SettingsView } from "./components/SettingsView";
import { applyPreferencesPatch, useAppPreferences } from "./hooks/useAppPreferences";
import { type PreferencesPatch, usePreferencesSync } from "./hooks/usePreferencesSync";
import { createFavorite, getDefaultFavorites, isFavoritePath } from "./lib/favorites";
import { useFiletrailClient } from "./lib/filetrailClient";

const SETTINGS_TABS: ReadonlyArray<{ id: SettingsTab; label: string; icon: string }> = [
  {
    id: "general",
    label: "General",
    icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  },
  {
    id: "browsing",
    label: "Browsing",
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
    id: "shortcuts",
    label: "Shortcuts",
    icon: "M5 6.5h14A2.5 2.5 0 0 1 21.5 9v6a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 15V9A2.5 2.5 0 0 1 5 6.5zM6.5 10.5h.01M10 10.5h.01M13.5 10.5h.01M17 10.5h.01M8 14h8",
  },
];

// The tab named after "#settings/" in the window's address, when it was opened on one.
function readRequestedTab(): SettingsTab | null {
  const requested = window.location.hash.replace(/^#settings\/?/, "");
  return SETTINGS_TABS.find((tab) => tab.id === requested)?.id ?? null;
}

function createOpenWithApplicationId(): string {
  return `open-with-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// The Settings window: its own renderer entry (`#settings`) with a macOS preferences
// toolbar of tabs. Edits persist through the same IPC as the explorer window and are
// broadcast to it by the main process.
export function SettingsWindowApp() {
  const client = useFiletrailClient();
  const preferences = useAppPreferences();
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => readRequestedTab() ?? "general");
  const [homePath, setHomePath] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Search defaults live in the explorer's search session; Settings edits the persisted values.
  const [searchDefaults, setSearchDefaults] = useState<SearchDefaults>({
    searchPatternMode: DEFAULT_APP_PREFERENCES.searchPatternMode,
    searchMatchScope: DEFAULT_APP_PREFERENCES.searchMatchScope,
    searchRecursive: DEFAULT_APP_PREFERENCES.searchRecursive,
    searchSkipGitFolders: DEFAULT_APP_PREFERENCES.searchSkipGitFolders,
    searchSkipGitIgnored: DEFAULT_APP_PREFERENCES.searchSkipGitIgnored,
  });
  const { preferencesReady, setPreferencesReady, theme } = preferences;

  // The tab on screen is kept in the window's address, where the main process reads it to
  // open Settings on the same tab next time.
  useEffect(() => {
    window.history.replaceState(null, "", `#settings/${activeTab}`);
  }, [activeTab]);

  const payload: PreferencesPatch = {
    theme: preferences.theme,
    accent: preferences.accent,
    zoomPercent: preferences.zoomPercent,
    compactListView: preferences.compactListView,
    compactDetailsView: preferences.compactDetailsView,
    compactIconView: preferences.compactIconView,
    compactTreeView: preferences.compactTreeView,
    singleClickExpandTreeItems: preferences.singleClickExpandTreeItems,
    detailColumns: preferences.detailColumns,
    detailColumnOrder: preferences.detailColumnOrder,
    searchColumns: preferences.searchColumns,
    searchColumnOrder: preferences.searchColumnOrder,
    notificationsEnabled: preferences.notificationsEnabled,
    markClipboardItems: preferences.markClipboardItems,
    restoreSessionOnStartup: preferences.restoreSessionOnStartup,
    favorites: preferences.favorites,
    favoritesPlacement: preferences.favoritesPlacement,
    terminalApp: preferences.terminalApp,
    defaultTextEditor: preferences.defaultTextEditor,
    openWithApplications: preferences.openWithApplications,
    fileActivationAction: preferences.fileActivationAction,
    returnKeyAction: preferences.returnKeyAction,
    shortcutOverrides: preferences.shortcutOverrides,
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
        setNotice("Couldn’t load the settings.");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Escape closes Settings, like ⌘W. A pop-up inside Settings (the accent or icon picker)
  // takes the key first and marks it used, so that Escape only closes the pop-up.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
        return;
      }
      event.preventDefault();
      window.close();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Help's Customize… button asks an open Settings window for the Shortcuts tab.
  useEffect(() => {
    const unsubscribe = client.onShowSettingsTab?.((tab) => {
      if (SETTINGS_TABS.some((candidate) => candidate.id === tab)) {
        setActiveTab(tab);
      }
    });
    return () => unsubscribe?.();
  }, [client]);

  useEffect(() => {
    document.title = "Settings";
    document.body.classList.add("settings-window-body");
    return () => document.body.classList.remove("settings-window-body");
  }, []);

  function applySearchDefaultsPatch(patch: Partial<AppPreferences>) {
    setSearchDefaults((current) => ({
      searchPatternMode: patch.searchPatternMode ?? current.searchPatternMode,
      searchMatchScope: patch.searchMatchScope ?? current.searchMatchScope,
      searchRecursive: patch.searchRecursive ?? current.searchRecursive,
      searchSkipGitFolders: patch.searchSkipGitFolders ?? current.searchSkipGitFolders,
      searchSkipGitIgnored: patch.searchSkipGitIgnored ?? current.searchSkipGitIgnored,
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
      setNotice("Couldn’t choose a folder.");
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

  // Moves an item of a list to another place in it, as a dragged row in Settings does.
  function moveItem<T>(items: T[], index: number, targetIndex: number): T[] {
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
    const selection = await pickApplication("Couldn’t choose an app.");
    if (!selection) {
      return;
    }
    preferences.setOpenWithApplications((current) => [
      ...current,
      { id: createOpenWithApplicationId(), ...selection },
    ]);
  }

  async function browseOpenWithApplication(entryId: string) {
    const selection = await pickApplication("Couldn’t choose an app.");
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
          <PushButton className="is-small" onClick={() => setNotice(null)}>
            Dismiss
          </PushButton>
        </output>
      ) : null}
      <div className="settings-window-body-scroll overlay-scroll">
        {preferencesReady ? (
          <SettingsView
            activeTab={activeTab}
            searchDefaults={searchDefaults}
            onSearchDefaultsChange={(patch) =>
              setSearchDefaults((current) => ({ ...current, ...patch }))
            }
            theme={theme}
            accent={preferences.accent}
            zoomPercent={preferences.zoomPercent}
            compactListView={preferences.compactListView}
            compactDetailsView={preferences.compactDetailsView}
            compactIconView={preferences.compactIconView}
            compactTreeView={preferences.compactTreeView}
            singleClickExpandTreeItems={preferences.singleClickExpandTreeItems}
            detailColumns={preferences.detailColumns}
            detailColumnOrder={preferences.detailColumnOrder}
            searchColumns={preferences.searchColumns}
            searchColumnOrder={preferences.searchColumnOrder}
            layoutMode="wide"
            notificationsEnabled={preferences.notificationsEnabled}
            markClipboardItems={preferences.markClipboardItems}
            restoreSessionOnStartup={preferences.restoreSessionOnStartup}
            homePath={homePath}
            terminalApp={preferences.terminalApp}
            defaultTextEditor={preferences.defaultTextEditor}
            favorites={preferences.favorites}
            favoritesPlacement={preferences.favoritesPlacement}
            openWithApplications={preferences.openWithApplications}
            fileActivationAction={preferences.fileActivationAction}
            returnKeyAction={preferences.returnKeyAction}
            onReturnKeyActionChange={preferences.setReturnKeyAction}
            shortcutOverrides={preferences.shortcutOverrides}
            onShortcutOverridesChange={preferences.setShortcutOverrides}
            openItemLimit={preferences.openItemLimit}
            accentOptions={ACCENT_OPTIONS}
            onThemeChange={preferences.setTheme}
            onAccentChange={preferences.setAccent}
            onZoomPercentChange={preferences.setZoomPercent}
            onResetAppearance={preferences.resetAppearanceSettings}
            onCompactListViewChange={preferences.setCompactListView}
            onCompactDetailsViewChange={preferences.setCompactDetailsView}
            onCompactIconViewChange={preferences.setCompactIconView}
            onCompactTreeViewChange={preferences.setCompactTreeView}
            onSingleClickExpandTreeItemsChange={preferences.setSingleClickExpandTreeItems}
            onDetailColumnsChange={preferences.setDetailColumns}
            onDetailColumnOrderChange={preferences.setDetailColumnOrder}
            onSearchColumnsChange={preferences.setSearchColumns}
            onSearchColumnOrderChange={preferences.setSearchColumnOrder}
            onNotificationsEnabledChange={preferences.setNotificationsEnabled}
            onMarkClipboardItemsChange={preferences.setMarkClipboardItems}
            onRestoreSessionOnStartupChange={preferences.setRestoreSessionOnStartup}
            onBrowseTerminalApp={() => {
              void pickApplication("Couldn’t choose the terminal app.").then(
                (selection) => selection && preferences.setTerminalApp(selection),
              );
            }}
            onClearTerminalApp={() => preferences.setTerminalApp(null)}
            onBrowseDefaultTextEditor={() => {
              void pickApplication("Couldn’t choose the text editor.").then(
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
            onMoveFavorite={(index, targetIndex) =>
              preferences.setFavorites((current) => moveItem(current, index, targetIndex))
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
            onMoveOpenWithApplication={(entryId, targetIndex) =>
              preferences.setOpenWithApplications((current) =>
                moveItem(
                  current,
                  current.findIndex((entry) => entry.id === entryId),
                  targetIndex,
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
