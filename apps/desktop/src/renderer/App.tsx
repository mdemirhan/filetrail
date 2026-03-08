import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import {
  DEFAULT_APP_PREFERENCES,
  type ExplorerViewMode,
  THEME_OPTIONS,
  type ThemeMode,
  TYPEAHEAD_DEBOUNCE_OPTIONS,
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
  UI_FONT_WEIGHT_OPTIONS,
  type UiFontFamily,
  type UiFontWeight,
} from "../shared/appPreferences";
import { ContentPane } from "./components/ContentPane";
import { HelpView } from "./components/HelpView";
import { LocationSheet } from "./components/LocationSheet";
import { PropertiesDrawer } from "./components/PropertiesDrawer";
import { SettingsView } from "./components/SettingsView";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { type TreeNodeState, TreePane } from "./components/TreePane";
import { useExplorerPaneLayout } from "./hooks/useExplorerPaneLayout";
import {
  getAncestorChain,
  getNextSelectionIndex,
  pathHasHiddenSegmentWithinRoot,
  parentDirectoryPath,
} from "./lib/explorerNavigation";
import { FileIcon } from "./lib/fileIcons";
import { useFiletrailClient } from "./lib/filetrailClient";
import { formatDateTime, formatPermissionMode, formatSize } from "./lib/formatting";
import { createRendererLogger } from "./lib/logging";
import { EXPLORER_LAYOUT } from "./lib/layoutTokens";
import { resolveStartupNavigation } from "./lib/startupNavigation";
import { applyAppearance, getThemeAppearanceDefaults } from "./lib/theme";
import {
  findContentTypeaheadMatch,
  findTreeTypeaheadMatch,
  isTypeaheadCharacterKey,
} from "./lib/typeahead";
import { getTreeKeyboardAction } from "./lib/treeView";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];

const logger = createRendererLogger("filetrail.renderer");
const SHORTCUT_ITEMS = [
  { group: "Navigation", shortcut: "Cmd+Left", description: "Go back to the previous folder" },
  { group: "Navigation", shortcut: "Cmd+Right", description: "Go forward to the next folder" },
  {
    group: "Navigation",
    shortcut: "Cmd+Up",
    description: "Open the parent folder from the file list",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+Down",
    description:
      "Open the selected item from the file list, or expand the current folder in the tree",
  },
  { group: "Navigation", shortcut: "Cmd+L", description: "Open Go to Folder" },
  { group: "Navigation", shortcut: "Cmd+R", description: "Refresh the current folder" },
  {
    group: "Navigation",
    shortcut: "Cmd+Shift+.",
    description: "Toggle hidden files",
  },
  { group: "Panels", shortcut: "Cmd+I", description: "Toggle the inspector drawer" },
  {
    group: "Panels",
    shortcut: "Tab",
    description: "Move focus between the folder tree and file list",
  },
  {
    group: "Panels",
    shortcut: "Shift+Tab",
    description: "Move focus back between the file list and folder tree",
  },
  { group: "Views", shortcut: "?", description: "Open help" },
  { group: "Views", shortcut: "Esc", description: "Return from Help or Settings to Explorer" },
] as const;

const REFERENCE_ITEMS = [
  {
    label: "Single click path segment",
    description: "Navigate directly to that folder in the current browsing history.",
  },
  {
    label: "Double click path bar",
    description: "Switch the path bar into editable mode without opening a separate dialog.",
  },
  {
    label: "Inline path suggestions",
    description: "Autocomplete shows real directory names under the typed parent folder.",
  },
  {
    label: "List view activation",
    description: "Double click a folder to enter it, or double click a file to open it in macOS.",
  },
] as const;

export function App() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const client = useFiletrailClient();
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(DEFAULT_APP_PREFERENCES.theme);
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
  const [mainView, setMainView] = useState<"explorer" | "help" | "settings">("explorer");
  const [treeRootPath, setTreeRootPath] = useState("");
  const [homePath, setHomePath] = useState("");
  const [treeNodes, setTreeNodes] = useState<Record<string, TreeNodeState>>({});
  const [currentPath, setCurrentPath] = useState("");
  const [currentEntries, setCurrentEntries] = useState<DirectoryEntry[]>([]);
  const [metadataByPath, setMetadataByPath] = useState<Record<string, DirectoryEntryMetadata>>({});
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [includeHidden, setIncludeHidden] = useState(DEFAULT_APP_PREFERENCES.includeHidden);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>(DEFAULT_APP_PREFERENCES.viewMode);
  const [foldersFirst, setFoldersFirst] = useState(DEFAULT_APP_PREFERENCES.foldersFirst);
  const [typeaheadEnabled, setTypeaheadEnabled] = useState(
    DEFAULT_APP_PREFERENCES.typeaheadEnabled,
  );
  const [typeaheadDebounceMs, setTypeaheadDebounceMs] = useState(
    DEFAULT_APP_PREFERENCES.typeaheadDebounceMs,
  );
  const [restoreLastVisitedFolderOnStartup, setRestoreLastVisitedFolderOnStartup] = useState(
    DEFAULT_APP_PREFERENCES.restoreLastVisitedFolderOnStartup,
  );
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [propertiesOpen, setPropertiesOpen] = useState(DEFAULT_APP_PREFERENCES.propertiesOpen);
  const [detailRowOpen, setDetailRowOpen] = useState(DEFAULT_APP_PREFERENCES.detailRowOpen);
  const [selectedPath, setSelectedPath] = useState("");
  const [historyPaths, setHistoryPaths] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [visiblePaths, setVisiblePaths] = useState<string[]>([]);
  const [contentColumns, setContentColumns] = useState(1);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [propertiesItem, setPropertiesItem] = useState<
    IpcResponse<"item:getProperties">["item"] | null
  >(null);
  const [locationSheetOpen, setLocationSheetOpen] = useState(false);
  const [locationSubmitting, setLocationSubmitting] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<"tree" | "content" | null>(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [typeaheadQuery, setTypeaheadQuery] = useState("");
  const [typeaheadPane, setTypeaheadPane] = useState<"tree" | "content" | null>(null);
  const [restoredPaneWidths, setRestoredPaneWidths] = useState<{
    treeWidth: number;
    inspectorWidth: number;
  } | null>(null);
  const treePaneRef = useRef<HTMLElement | null>(null);
  const contentPaneRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const directoryRequestRef = useRef(0);
  const metadataRequestRef = useRef(0);
  const propertiesRequestRef = useRef(0);
  const treeRequestRef = useRef<Record<string, number>>({});
  const treeNodesRef = useRef<Record<string, TreeNodeState>>({});
  const treeRootPathRef = useRef(treeRootPath);
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeaheadQueryRef = useRef("");
  const typeaheadPaneRef = useRef<"tree" | "content" | null>(null);
  const panes = useExplorerPaneLayout({
    initialTreeWidth: DEFAULT_APP_PREFERENCES.treeWidth,
    initialInspectorWidth: DEFAULT_APP_PREFERENCES.inspectorWidth,
    inspectorVisible: propertiesOpen,
    minContentWidth: EXPLORER_LAYOUT.minContentWidth,
  });

  useEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes]);

  useEffect(() => {
    treeRootPathRef.current = treeRootPath;
  }, [treeRootPath]);

  useEffect(() => {
    typeaheadQueryRef.current = typeaheadQuery;
  }, [typeaheadQuery]);

  useEffect(() => {
    typeaheadPaneRef.current = typeaheadPane;
  }, [typeaheadPane]);

  useEffect(
    () => () => {
      if (typeaheadTimeoutRef.current) {
        clearTimeout(typeaheadTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (focusedPane === null) {
      clearTypeahead();
      return;
    }
    if (typeaheadPane && focusedPane !== typeaheadPane) {
      clearTypeahead();
    }
  }, [focusedPane, typeaheadPane]);

  useEffect(() => {
    if (typeaheadEnabled) {
      return;
    }
    clearTypeahead();
  }, [typeaheadEnabled]);

  useEffect(() => {
    if (
      !preferencesReady ||
      mainView !== "explorer" ||
      locationSheetOpen ||
      focusedPane !== null
    ) {
      return;
    }
    const treePane = treePaneRef.current;
    if (!treePane) {
      return;
    }
    treePane.focus({ preventScroll: true });
    setFocusedPane("tree");
  }, [focusedPane, locationSheetOpen, mainView, preferencesReady]);

  useEffect(() => {
    applyAppearance({
      theme,
      uiFontFamily,
      uiFontSize,
      uiFontWeight,
      textPrimaryOverride,
      textSecondaryOverride,
      textMutedOverride,
    });
  }, [
    textMutedOverride,
    textPrimaryOverride,
    textSecondaryOverride,
    theme,
    uiFontFamily,
    uiFontSize,
    uiFontWeight,
  ]);

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }
    void client.invoke("app:updatePreferences", {
      preferences: {
        theme,
        uiFontFamily,
        uiFontSize,
        uiFontWeight,
        textPrimaryOverride,
        textSecondaryOverride,
        textMutedOverride,
        viewMode,
        foldersFirst,
        typeaheadEnabled,
        typeaheadDebounceMs,
        propertiesOpen,
        detailRowOpen,
        includeHidden,
        treeWidth: panes.treeWidth,
        inspectorWidth: panes.inspectorWidth,
        restoreLastVisitedFolderOnStartup,
        treeRootPath: treeRootPath || null,
        lastVisitedPath: currentPath || null,
      },
    });
  }, [
    client,
    currentPath,
    includeHidden,
    panes.inspectorWidth,
    panes.treeWidth,
    preferencesReady,
    propertiesOpen,
    detailRowOpen,
    foldersFirst,
    typeaheadDebounceMs,
    typeaheadEnabled,
    restoreLastVisitedFolderOnStartup,
    theme,
    uiFontFamily,
    uiFontSize,
    textMutedOverride,
    textPrimaryOverride,
    textSecondaryOverride,
    treeRootPath,
    uiFontWeight,
    viewMode,
  ]);

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
        const preferences = preferencesResponse.preferences;
        setTheme(preferences.theme);
        setUiFontFamily(preferences.uiFontFamily);
        setUiFontSize(preferences.uiFontSize);
        setUiFontWeight(preferences.uiFontWeight);
        setTextPrimaryOverride(preferences.textPrimaryOverride);
        setTextSecondaryOverride(preferences.textSecondaryOverride);
        setTextMutedOverride(preferences.textMutedOverride);
        setIncludeHidden(preferences.includeHidden);
        setViewMode(preferences.viewMode);
        setFoldersFirst(preferences.foldersFirst);
        setTypeaheadEnabled(preferences.typeaheadEnabled);
        setTypeaheadDebounceMs(preferences.typeaheadDebounceMs);
        setPropertiesOpen(preferences.propertiesOpen);
        setDetailRowOpen(preferences.detailRowOpen);
        setRestoreLastVisitedFolderOnStartup(preferences.restoreLastVisitedFolderOnStartup);
        panes.setTreeWidth(preferences.treeWidth);
        panes.setInspectorWidth(preferences.inspectorWidth);
        setRestoredPaneWidths({
          treeWidth: preferences.treeWidth,
          inspectorWidth: preferences.inspectorWidth,
        });
        setHomePath(homeResponse.path);
        const { startupPath, startupRootPath } = resolveStartupNavigation(
          preferences,
          homeResponse.path,
        );
        initializeTree(startupRootPath);
        void navigateTo(
          startupPath,
          "replace",
          preferences.includeHidden,
          undefined,
          undefined,
          preferences.foldersFirst,
        ).then((didNavigate) => {
          if (cancelled || didNavigate || startupPath === homeResponse.path) {
            setPreferencesReady(true);
            return;
          }
          initializeTree(homeResponse.path);
          void navigateTo(
            homeResponse.path,
            "replace",
            preferences.includeHidden,
            undefined,
            undefined,
            preferences.foldersFirst,
          ).finally(() => {
            if (!cancelled) {
              setPreferencesReady(true);
            }
          });
        });
      })
      .catch((error) => {
        logger.error("initial preferences load failed", error);
        if (!cancelled) {
          setPreferencesReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, panes.setInspectorWidth, panes.setTreeWidth]);

  useEffect(() => {
    if (!themeMenuOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (themeMenuRef.current?.contains(target) || themeButtonRef.current?.contains(target)) {
        return;
      }
      setThemeMenuOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setThemeMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [themeMenuOpen]);

  useEffect(() => {
    if (viewMode !== "details" || currentPath.length === 0 || directoryLoading) {
      return;
    }
    const currentEntryPaths = new Set(currentEntries.map((entry) => entry.path));
    const missingPaths = visiblePaths.filter(
      (path) => currentEntryPaths.has(path) && !metadataByPath[path],
    );
    if (missingPaths.length === 0) {
      return;
    }
    const requestId = ++metadataRequestRef.current;
    void client
      .invoke("directory:getMetadataBatch", {
        directoryPath: currentPath,
        paths: missingPaths,
      })
      .then((response) => {
        if (metadataRequestRef.current !== requestId) {
          return;
        }
        setMetadataByPath((current) => {
          const next = { ...current };
          for (const item of response.items) {
            next[item.path] = item;
          }
          return next;
        });
      })
      .catch((error) => {
        logger.debug("metadata batch failed", error);
      });
  }, [
    client,
    currentEntries,
    currentPath,
    directoryLoading,
    metadataByPath,
    viewMode,
    visiblePaths,
  ]);

  useEffect(() => {
    if ((!propertiesOpen && !detailRowOpen) || currentPath.length === 0) {
      return;
    }
    const targetPath = selectedPath || currentPath;
    const requestId = ++propertiesRequestRef.current;
    setPropertiesLoading(true);
    void client
      .invoke("item:getProperties", { path: targetPath })
      .then((response) => {
        if (propertiesRequestRef.current !== requestId) {
          return;
        }
        setPropertiesItem(response.item);
      })
      .catch((error) => {
        if (propertiesRequestRef.current !== requestId) {
          return;
        }
        setPropertiesItem(null);
        logger.error("properties load failed", error);
      })
      .finally(() => {
        if (propertiesRequestRef.current === requestId) {
          setPropertiesLoading(false);
        }
      });
  }, [client, currentPath, detailRowOpen, propertiesOpen, selectedPath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && locationSheetOpen) {
        return;
      }
      if (event.key === "Escape" && mainView !== "explorer") {
        event.preventDefault();
        setMainView("explorer");
        return;
      }
      const currentSelectedEntry =
        currentEntries.find((entry) => entry.path === selectedPath) ?? null;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (locationSheetOpen) {
        return;
      }
      if (event.key === "Tab" && mainView === "explorer" && !locationSheetOpen) {
        event.preventDefault();
        const treePane = treePaneRef.current;
        const contentPane = contentPaneRef.current;
        if (!treePane || !contentPane) {
          return;
        }
        const activeElement = document.activeElement;
        const focusTree = () => treePane.focus({ preventScroll: true });
        const focusContent = () => contentPane.focus({ preventScroll: true });
        if (activeElement instanceof Node && treePane.contains(activeElement)) {
          focusContent();
          return;
        }
        if (activeElement instanceof Node && contentPane.contains(activeElement)) {
          focusTree();
          return;
        }
        if (event.shiftKey) {
          focusTree();
        } else {
          focusContent();
        }
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setMainView((value) => (value === "help" ? "explorer" : "help"));
        return;
      }
      if (mainView !== "explorer") {
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.metaKey && event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.metaKey && event.key === "ArrowRight") {
        event.preventDefault();
        goForward();
        return;
      }
      if (event.metaKey && event.key === "ArrowUp" && focusedPane === "tree") {
        event.preventDefault();
        const nextPath = parentDirectoryPath(currentPath);
        if (nextPath && nextPath !== currentPath) {
          void navigateTo(nextPath, "push");
        }
        return;
      }
      if (event.metaKey && event.key === "ArrowUp" && focusedPane === "content") {
        event.preventDefault();
        const nextPath = parentDirectoryPath(currentPath);
        if (nextPath) {
          void navigateTo(nextPath, "push");
        }
        return;
      }
      if (
        event.metaKey &&
        event.key === "ArrowDown" &&
        focusedPane === "content" &&
        currentSelectedEntry
      ) {
        event.preventDefault();
        void activateEntry(currentSelectedEntry);
        return;
      }
      if (event.metaKey && event.key === "ArrowDown" && focusedPane === "tree") {
        event.preventDefault();
        void openTreeNode(currentPath);
        return;
      }
      if (event.metaKey && event.shiftKey && event.key === ".") {
        event.preventDefault();
        toggleHiddenFiles();
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        void refreshDirectory();
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        setLocationError(null);
        setLocationSheetOpen(true);
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setPropertiesOpen((value: boolean) => !value);
        return;
      }
      if (
        typeaheadEnabled &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        (focusedPane === "tree" || focusedPane === "content") &&
        isTypeaheadCharacterKey(event.key)
      ) {
        event.preventDefault();
        handleTypeaheadInput(event.key, focusedPane);
        return;
      }
      if (
        event.key === "ArrowUp" ||
        event.key === "ArrowDown" ||
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "Home" ||
        event.key === "End"
      ) {
        if (event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        if (focusedPane === "tree") {
          const action = getTreeKeyboardAction({
            key: event.key,
            currentPath,
            rootPath: treeRootPath,
            nodes: treeNodes,
          });
          if (action.type === "none") {
            return;
          }
          event.preventDefault();
          if (action.type === "navigate") {
            void navigateTo(action.path, "push");
            return;
          }
          if (action.type === "expand" || action.type === "collapse") {
            toggleTreeNode(action.path);
            return;
          }
          if (action.type === "load") {
            void loadTreeChildren(action.path, includeHidden, true);
            return;
          }
          return;
        }
        if (focusedPane !== "content" || currentEntries.length === 0) {
          return;
        }
        event.preventDefault();
        const currentIndex = currentEntries.findIndex((entry) => entry.path === selectedPath);
        const nextIndex = getNextSelectionIndex({
          itemCount: currentEntries.length,
          currentIndex,
          key: event.key,
          columns: viewMode === "list" ? contentColumns : 1,
          viewMode,
        });
        const nextEntry = currentEntries[nextIndex];
        if (nextEntry) {
          setSelectedPath(nextEntry.path);
        }
        return;
      }
      if (event.key === "Enter" && focusedPane === "tree") {
        event.preventDefault();
        void openTreeNode(currentPath);
        return;
      }
      if (event.key === "Enter" && focusedPane === "content" && currentSelectedEntry) {
        event.preventDefault();
        void activateEntry(currentSelectedEntry);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    contentColumns,
    currentEntries,
    currentPath,
    focusedPane,
    includeHidden,
    locationSheetOpen,
    mainView,
    selectedPath,
    treeNodes,
    treeRootPath,
    typeaheadEnabled,
    viewMode,
    locationSheetOpen,
  ]);

  const selectedEntry = useMemo(
    () => currentEntries.find((entry) => entry.path === selectedPath) ?? null,
    [currentEntries, selectedPath],
  );
  const effectiveThemeColors = useMemo(() => {
    const defaults = getThemeAppearanceDefaults(theme);
    return {
      primary: textPrimaryOverride ?? defaults.primary,
      secondary: textSecondaryOverride ?? defaults.secondary,
      muted: textMutedOverride ?? defaults.muted,
    };
  }, [textMutedOverride, textPrimaryOverride, textSecondaryOverride, theme]);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyPaths.length - 1;

  function resetAppearanceSettings() {
    setUiFontFamily(DEFAULT_APP_PREFERENCES.uiFontFamily);
    setUiFontSize(DEFAULT_APP_PREFERENCES.uiFontSize);
    setUiFontWeight(DEFAULT_APP_PREFERENCES.uiFontWeight);
    setTextPrimaryOverride(null);
    setTextSecondaryOverride(null);
    setTextMutedOverride(null);
  }

  function clearTypeahead() {
    if (typeaheadTimeoutRef.current) {
      clearTimeout(typeaheadTimeoutRef.current);
      typeaheadTimeoutRef.current = null;
    }
    typeaheadQueryRef.current = "";
    typeaheadPaneRef.current = null;
    setTypeaheadQuery("");
    setTypeaheadPane(null);
  }

  function scheduleTypeaheadClear() {
    if (typeaheadTimeoutRef.current) {
      clearTimeout(typeaheadTimeoutRef.current);
    }
    typeaheadTimeoutRef.current = setTimeout(() => {
      typeaheadTimeoutRef.current = null;
      typeaheadQueryRef.current = "";
      typeaheadPaneRef.current = null;
      setTypeaheadQuery("");
      setTypeaheadPane(null);
    }, typeaheadDebounceMs);
  }

  function handleTypeaheadInput(key: string, pane: "tree" | "content") {
    const baseQuery = typeaheadPaneRef.current === pane ? typeaheadQueryRef.current : "";
    const nextQuery = `${baseQuery}${key}`;
    typeaheadQueryRef.current = nextQuery;
    typeaheadPaneRef.current = pane;
    setTypeaheadQuery(nextQuery);
    setTypeaheadPane(pane);
    scheduleTypeaheadClear();

    if (pane === "content") {
      const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
      const typeaheadEntries =
        normalizedSearchQuery.length === 0
          ? currentEntries
          : currentEntries.filter((entry) =>
              entry.name.toLocaleLowerCase().includes(normalizedSearchQuery),
            );
      const match = findContentTypeaheadMatch(typeaheadEntries, nextQuery);
      if (match) {
        setSelectedPath(match.path);
      }
      return;
    }

    const match = findTreeTypeaheadMatch({
      rootPath: treeRootPathRef.current,
      nodes: treeNodesRef.current,
      query: nextQuery,
    });
    if (match) {
      void navigateTo(match.path, "push");
    }
  }

  function goBack() {
    const nextPath = historyPaths[historyIndex - 1];
    if (!nextPath) {
      return;
    }
    setHistoryIndex(historyIndex - 1);
    void navigateTo(nextPath, "skip");
  }

  function goForward() {
    const nextPath = historyPaths[historyIndex + 1];
    if (!nextPath) {
      return;
    }
    setHistoryIndex(historyIndex + 1);
    void navigateTo(nextPath, "skip");
  }

  function goHome() {
    if (homePath) {
      void navigateTo(homePath, "push");
    }
  }

  function goQuickAccess(location: "desktop" | "downloads" | "documents" | "source") {
    if (!homePath) {
      return;
    }
    const suffix =
      location === "desktop"
        ? "/Desktop"
        : location === "downloads"
          ? "/Downloads"
          : location === "documents"
            ? "/Documents"
            : "/src";
    void navigateTo(`${homePath}${suffix}`, "push");
  }

  function navigateToParentFolder() {
    const nextPath = parentDirectoryPath(currentPath);
    if (nextPath) {
      void navigateTo(nextPath, "push");
    }
  }

  function navigateDownAction() {
    if (focusedPane === "tree") {
      void openTreeNode(currentPath);
      return;
    }
    if (selectedEntry) {
      void activateEntry(selectedEntry);
    }
  }

  function initializeTree(path: string) {
    treeRequestRef.current = {};
    treeRootPathRef.current = path;
    setTreeRootPath(path);
    setTreeNodes({
      [path]: createTreeNode(path, true),
    });
  }

  function reinitializeTree(rootPath: string, focusPath: string) {
    treeRequestRef.current = {};
    treeRootPathRef.current = rootPath;
    setTreeRootPath(rootPath);
    setTreeNodes({
      [rootPath]: createTreeNode(rootPath, true),
      ...(focusPath !== rootPath ? { [focusPath]: createTreeNode(focusPath, true) } : {}),
    });
  }

  async function navigateTo(
    path: string,
    historyMode: "push" | "replace" | "skip",
    includeHiddenOverride = includeHidden,
    sortByOverride = sortBy,
    sortDirectionOverride = sortDirection,
    foldersFirstOverride = foldersFirst,
  ): Promise<boolean> {
    const requestId = ++directoryRequestRef.current;
    setDirectoryLoading(true);
    setDirectoryError(null);
    setLocationError(null);
    try {
      const response = await client.invoke("directory:getSnapshot", {
        path,
        includeHidden: includeHiddenOverride,
        sortBy: sortByOverride,
        sortDirection: sortDirectionOverride,
        foldersFirst: foldersFirstOverride,
      });
      if (directoryRequestRef.current !== requestId) {
        return false;
      }
      setCurrentPath(response.path);
      setCurrentEntries(response.entries);
      setVisiblePaths([]);
      setMetadataByPath({});
      metadataRequestRef.current += 1;
      setSelectedPath(response.entries[0]?.path ?? "");
      setPropertiesItem(null);
      await syncTreeToPath(response.path, includeHiddenOverride);
      if (historyMode === "push") {
        setHistoryPaths((current) => {
          const base = current.slice(0, historyIndex + 1);
          return [...base, response.path];
        });
        setHistoryIndex((current) => current + 1);
      } else if (historyMode === "replace") {
        setHistoryPaths((current) => {
          if (current.length === 0) {
            return [response.path];
          }
          const next = [...current];
          next[Math.max(0, historyIndex)] = response.path;
          return next;
        });
        setHistoryIndex((current) => (current < 0 ? 0 : current));
      }
      return true;
    } catch (error) {
      if (directoryRequestRef.current !== requestId) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      setDirectoryError(message);
      setLocationError(message);
      logger.error("directory navigation failed", error);
      return false;
    } finally {
      if (directoryRequestRef.current === requestId) {
        setDirectoryLoading(false);
      }
    }
  }

  function ensureTreeNode(path: string, expanded = false) {
    setTreeNodes((current) => {
      if (current[path]) {
        if (!expanded || current[path].expanded) {
          return current;
        }
        return {
          ...current,
          [path]: {
            ...current[path],
            expanded,
          },
        };
      }
      return {
        ...current,
        [path]: createTreeNode(path, expanded),
      };
    });
  }

  async function loadTreeChildren(
    path: string,
    includeHiddenOverride = includeHidden,
    expandOnSuccess = false,
    activePath = currentPath,
  ) {
    const currentNode = treeNodesRef.current[path];
    if (currentNode?.loading) {
      return;
    }
    if (currentNode?.loaded) {
      if (expandOnSuccess && !currentNode.expanded) {
        setTreeNodes((current) => ({
          ...current,
          [path]: {
            ...currentNode,
            expanded: true,
          },
        }));
      }
      return;
    }

    const requestId = (treeRequestRef.current[path] ?? 0) + 1;
    treeRequestRef.current[path] = requestId;

    setTreeNodes((current) => ({
      ...current,
      [path]: {
        ...(current[path] ?? createTreeNode(path, true)),
        loading: true,
        error: null,
      },
    }));
    try {
      const effectiveIncludeHidden = getEffectiveTreeIncludeHidden(
        includeHiddenOverride,
        path,
        activePath,
      );
      const response = await client.invoke("tree:getChildren", {
        path,
        includeHidden: effectiveIncludeHidden,
      });
      if (treeRequestRef.current[path] !== requestId) {
        return;
      }
      setTreeNodes((current) => {
        const next = { ...current };
        const existingNode = current[path] ?? createTreeNode(path, true);
        next[path] = {
          ...existingNode,
          expanded: existingNode.expanded || expandOnSuccess,
          loading: false,
          loaded: true,
          childPaths: response.children.map((child) => child.path),
        };
        for (const child of response.children) {
          next[child.path] = {
            path: child.path,
            name: child.name,
            kind: child.kind,
            isHidden: child.isHidden,
            isSymlink: child.isSymlink,
            expanded: current[child.path]?.expanded ?? false,
            loading: false,
            loaded: current[child.path]?.loaded ?? false,
            error: null,
            childPaths: current[child.path]?.childPaths ?? [],
          };
        }
        return next;
      });
    } catch (error) {
      if (treeRequestRef.current[path] !== requestId) {
        return;
      }
      setTreeNodes((current) => ({
        ...current,
        [path]: {
          ...(current[path] ?? createTreeNode(path, true)),
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
      logger.error("tree load failed", error);
    }
  }

  async function syncTreeToPath(path: string, includeHiddenOverride: boolean) {
    const currentRootPath = treeRootPathRef.current;
    const nextRootPath =
      currentRootPath.length === 0 || !isPathWithinRoot(path, currentRootPath)
        ? path
        : currentRootPath;

    if (nextRootPath !== currentRootPath) {
      treeRequestRef.current = {};
      treeRootPathRef.current = nextRootPath;
      setTreeRootPath(nextRootPath);
      setTreeNodes({
        [nextRootPath]: createTreeNode(nextRootPath, true),
      });
    } else {
      ensureTreeNode(nextRootPath, true);
    }

    await loadTreeChildren(nextRootPath, includeHiddenOverride, false, path);

    if (path === nextRootPath) {
      return;
    }

    const ancestorChain = getAncestorChain(nextRootPath, path).slice(1, -1);
    for (const ancestorPath of ancestorChain) {
      ensureTreeNode(ancestorPath, true);
      await loadTreeChildren(ancestorPath, includeHiddenOverride, true, path);
    }
  }

  function getEffectiveTreeIncludeHidden(
    includeHiddenOverride: boolean,
    path: string,
    activePath: string,
  ): boolean {
    if (includeHiddenOverride) {
      return true;
    }
    const rootPath = treeRootPathRef.current;
    if (rootPath.length === 0) {
      return pathHasHiddenSegmentWithinRoot(path, path);
    }
    return (
      pathHasHiddenSegmentWithinRoot(activePath, rootPath) ||
      pathHasHiddenSegmentWithinRoot(path, rootPath)
    );
  }

  function toggleTreeNode(path: string) {
    const node = treeNodes[path];
    if (!node || node.isSymlink) {
      return;
    }
    if (!node.loaded) {
      if (!node.loading) {
        void loadTreeChildren(path, includeHidden, true);
      }
      return;
    }
    const nextExpanded = !node.expanded;
    setTreeNodes((current) => ({
      ...current,
      [path]: {
        ...node,
        expanded: nextExpanded,
      },
    }));
  }

  async function openTreeNode(path: string) {
    const node = treeNodes[path];
    if (!node) {
      return;
    }
    if (!node.loaded) {
      await loadTreeChildren(path, includeHidden, true);
      return;
    }
    toggleTreeNode(path);
  }

  async function resolveTargetPath(path: string): Promise<string | null> {
    try {
      const response = await client.invoke("path:resolve", { path });
      return response.resolvedPath;
    } catch (error) {
      logger.error("resolve target path failed", error);
      return null;
    }
  }

  async function activateEntry(entry: DirectoryEntry) {
    if (entry.kind === "directory") {
      await navigateTo(entry.path, "push");
      return;
    }
    if (entry.kind === "symlink_directory") {
      const targetPath = await resolveTargetPath(entry.path);
      if (targetPath) {
        await navigateTo(targetPath, "push");
      }
      return;
    }
    if (entry.kind === "symlink_file") {
      const targetPath = await resolveTargetPath(entry.path);
      if (targetPath) {
        await openExternally(targetPath);
      }
      return;
    }
    if (entry.kind === "file") {
      await openExternally(entry.path);
    }
  }

  async function openExternally(path: string) {
    try {
      await client.invoke("system:openPath", { path });
    } catch (error) {
      logger.error("open in macOS failed", error);
    }
  }

  function toggleHiddenFiles() {
    const nextValue = !includeHidden;
    setIncludeHidden(nextValue);
    if (!currentPath) {
      return;
    }
    reinitializeTree(treeRootPath || currentPath, currentPath);
    void navigateTo(currentPath, "replace", nextValue);
  }

  async function refreshDirectory() {
    await client.invoke("app:clearCaches", {});
    if (!currentPath) {
      return;
    }
    reinitializeTree(treeRootPath || currentPath, currentPath);
    await navigateTo(currentPath, "replace");
  }

  function handleSortChange(nextSortBy: SortBy) {
    const nextSortDirection =
      nextSortBy === sortBy
        ? sortDirection === "asc"
          ? "desc"
          : "asc"
        : nextSortBy === "modified" || nextSortBy === "size"
          ? "desc"
          : "asc";

    if (nextSortBy !== sortBy) {
      setSortBy(nextSortBy);
    }
    setSortDirection(nextSortDirection);

    if (!currentPath) {
      return;
    }
    void navigateTo(
      currentPath,
      "replace",
      includeHidden,
      nextSortBy,
      nextSortDirection,
      foldersFirst,
    );
  }

  function toggleFoldersFirst() {
    const nextValue = !foldersFirst;
    setFoldersFirst(nextValue);
    if (!currentPath) {
      return;
    }
    void navigateTo(currentPath, "replace", includeHidden, sortBy, sortDirection, nextValue);
  }

  async function submitLocationPath(path: string) {
    setLocationSubmitting(true);
    try {
      const didNavigate = await navigateTo(path.trim(), "push");
      if (didNavigate) {
        setLocationSheetOpen(false);
      }
    } finally {
      setLocationSubmitting(false);
    }
  }

  function handlePaneResizeKey(
    pane: "tree" | "inspector",
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    const step = event.shiftKey
      ? EXPLORER_LAYOUT.paneResizeStepLarge
      : EXPLORER_LAYOUT.paneResizeStep;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    if (pane === "tree") {
      panes.setTreeWidth((current) =>
        Math.max(
          EXPLORER_LAYOUT.treeMinWidth,
          Math.min(
            EXPLORER_LAYOUT.treeMaxWidth,
            current + (event.key === "ArrowRight" ? step : -step),
          ),
        ),
      );
      return;
    }
    panes.setInspectorWidth((current) =>
      Math.max(
        EXPLORER_LAYOUT.inspectorMinWidth,
        Math.min(
          EXPLORER_LAYOUT.inspectorMaxWidth,
          current + (event.key === "ArrowLeft" ? step : -step),
        ),
      ),
    );
  }

  return (
    <main className="app-shell">
      {mainView === "explorer" ? (
        <section className="workspace explorer-workspace">
          <header className="window-toolbar">
            <div className="window-toolbar-brand">
              <span className="window-toolbar-title">File Trail</span>
            </div>
            <div className="titlebar-actions">
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={!canGoBack}
                onClick={goBack}
                title="Back (Cmd+Left)"
                aria-label="Back"
              >
                <ToolbarIcon name="back" />
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={!canGoForward}
                onClick={goForward}
                title="Forward (Cmd+Right)"
                aria-label="Forward"
              >
                <ToolbarIcon name="forward" />
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={!parentDirectoryPath(currentPath)}
                onClick={navigateToParentFolder}
                title="Enclosing Folder (Cmd+Up)"
                aria-label="Enclosing Folder"
              >
                <ToolbarIcon name="up" />
              </button>
              <button
                type="button"
                className="tb-btn tb-btn-icon"
                disabled={focusedPane !== "tree" && !selectedEntry}
                onClick={navigateDownAction}
                title="Open selected item (Cmd+Down)"
                aria-label="Open selected item"
              >
                <ToolbarIcon name="down" />
              </button>
              <span className="titlebar-divider" aria-hidden />
              <button
                type="button"
                className={propertiesOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
                onClick={() => setPropertiesOpen((value: boolean) => !value)}
                title="Inspector (Cmd+I)"
                aria-label="Inspector"
              >
                <ToolbarIcon name="drawer" />
              </button>
              <span className="titlebar-divider" aria-hidden />
              <fieldset className="toolbar-segmented">
                <legend className="sr-only">View mode</legend>
                <button
                  type="button"
                  className={
                    viewMode === "list" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
                  }
                  onClick={() => setViewMode("list")}
                  title="List view"
                  aria-label="List view"
                >
                  <ToolbarIcon name="list" />
                </button>
                <button
                  type="button"
                  className={
                    viewMode === "details" ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
                  }
                  onClick={() => setViewMode("details")}
                  title="Details view"
                  aria-label="Details view"
                >
                  <ToolbarIcon name="details" />
                </button>
              </fieldset>
              <button
                type="button"
                className={foldersFirst ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"}
                onClick={toggleFoldersFirst}
                title={foldersFirst ? "Folders first" : "Mixed file and folder order"}
                aria-label="Toggle folders first"
                aria-pressed={foldersFirst}
              >
                <ToolbarIcon name="foldersFirst" />
              </button>
              <span className="titlebar-divider" aria-hidden />
              <fieldset className="toolbar-select-group">
                <legend className="sr-only">Sorting controls</legend>
                <button
                  type="button"
                  className="tb-btn tb-btn-icon"
                  onClick={() => handleSortChange(sortBy)}
                  title={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
                  aria-label={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
                >
                  <ToolbarIcon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} />
                </button>
                <select
                  className="toolbar-select"
                  value={sortBy}
                  onChange={(event) => handleSortChange(event.currentTarget.value as SortBy)}
                  title="Sort by"
                  aria-label="Sort by"
                >
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                  <option value="modified">Date Modified</option>
                  <option value="kind">Kind</option>
                </select>
              </fieldset>
              <div className="toolbar-spacer" />
              <label className="toolbar-search" aria-label="Search current folder">
                <span className="toolbar-search-icon">
                  <ToolbarIcon name="search" />
                </span>
                <input
                  ref={searchInputRef}
                  className="toolbar-search-input"
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder="Search... ⌘F"
                />
              </label>
            </div>
          </header>
          {!preferencesReady ||
          (restoredPaneWidths !== null &&
            (panes.treeWidth !== restoredPaneWidths.treeWidth ||
              panes.inspectorWidth !== restoredPaneWidths.inspectorWidth)) ? (
            <section className="workspace-body workspace-loading" />
          ) : (
            <section
              className="workspace-body tomorrow-night-layout"
              style={{
                gridTemplateColumns: `${panes.treeWidth}px ${EXPLORER_LAYOUT.resizerWidth}px minmax(0, 1fr)${
                  propertiesOpen
                    ? ` ${EXPLORER_LAYOUT.resizerWidth}px ${panes.inspectorWidth}px`
                    : ""
                }`,
              }}
            >
              <TreePane
                paneRef={treePaneRef}
                isFocused={focusedPane === "tree"}
                homePath={homePath}
                currentPath={currentPath}
                nodes={treeNodes}
                rootPath={treeRootPath}
                onFocusChange={(focused) => setFocusedPane(focused ? "tree" : null)}
                onGoHome={goHome}
                onQuickAccess={goQuickAccess}
                detailRowOpen={detailRowOpen}
                onToggleDetailRow={() => setDetailRowOpen((value) => !value)}
                theme={theme}
                themeMenuOpen={themeMenuOpen}
                themeButtonRef={themeButtonRef}
                themeMenuRef={themeMenuRef}
                onToggleThemeMenu={() => setThemeMenuOpen((value) => !value)}
                onSelectTheme={(nextTheme) => {
                  setTheme(nextTheme);
                  setThemeMenuOpen(false);
                }}
                onOpenHelp={() => setMainView("help")}
                onOpenSettings={() => setMainView("settings")}
                includeHidden={includeHidden}
                onToggleHidden={toggleHiddenFiles}
                onNavigate={(path) => void navigateTo(path, "push")}
                onToggleExpand={toggleTreeNode}
                typeaheadQuery={focusedPane === "tree" ? typeaheadQuery : ""}
              />
              <div
                className="pane-resizer"
                onPointerDown={panes.beginResize("tree")}
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Resize folders pane"
                onKeyDown={(event) => handlePaneResizeKey("tree", event)}
              />
              <section className="main-shell">
                <ContentPane
                  paneRef={contentPaneRef}
                  isFocused={focusedPane === "content"}
                  currentPath={currentPath}
                  entries={currentEntries}
                  loading={directoryLoading}
                  error={directoryError}
                  includeHidden={includeHidden}
                  metadataByPath={metadataByPath}
                  selectedPath={selectedPath}
                  viewMode={viewMode}
                  onSelectPath={setSelectedPath}
                  onActivateEntry={(entry) => {
                    void activateEntry(entry);
                  }}
                  onFocusChange={(focused) => setFocusedPane(focused ? "content" : null)}
                  sortBy={sortBy}
                  sortDirection={sortDirection}
                  onSortChange={handleSortChange}
                  onLayoutColumnsChange={setContentColumns}
                  onVisiblePathsChange={setVisiblePaths}
                  onNavigatePath={(path) => void navigateTo(path, "push")}
                  onRequestPathSuggestions={(inputPath) =>
                    requestPathSuggestions({
                      client,
                      includeHidden,
                      inputPath,
                    })
                  }
                  searchQuery={searchQuery}
                  typeaheadQuery={focusedPane === "content" ? typeaheadQuery : ""}
                />
                <DetailRow
                  open={detailRowOpen}
                  currentPath={currentPath}
                  currentEntries={currentEntries}
                  selectedEntry={selectedEntry}
                  item={propertiesItem}
                />
                <footer className="status-bar">
                  <span>{currentEntries.length} items</span>
                  <span className="status-path">{currentPath}</span>
                </footer>
              </section>
              {propertiesOpen ? (
                <>
                  <div
                    className="pane-resizer"
                    onPointerDown={panes.beginResize("inspector")}
                    role="separator"
                    tabIndex={0}
                    aria-orientation="vertical"
                    aria-label="Resize inspector pane"
                    onKeyDown={(event) => handlePaneResizeKey("inspector", event)}
                  />
                  <PropertiesDrawer
                    open={propertiesOpen}
                    loading={propertiesLoading}
                    item={propertiesItem}
                    itemCount={propertiesItem?.path === currentPath ? currentEntries.length : null}
                    onClose={() => setPropertiesOpen(false)}
                  />
                </>
              ) : null}
            </section>
          )}
        </section>
      ) : (
        <section className="workspace single-panel-layout">
          <section className="pane single-panel-pane">
            {mainView === "help" ? (
              <HelpView shortcutItems={[...SHORTCUT_ITEMS]} referenceItems={[...REFERENCE_ITEMS]} />
            ) : (
              <SettingsView
                theme={theme}
                uiFontFamily={uiFontFamily}
                uiFontSize={uiFontSize}
                uiFontWeight={uiFontWeight}
                effectiveTextPrimaryColor={effectiveThemeColors.primary}
                effectiveTextSecondaryColor={effectiveThemeColors.secondary}
                effectiveTextMutedColor={effectiveThemeColors.muted}
                typeaheadEnabled={typeaheadEnabled}
                typeaheadDebounceMs={typeaheadDebounceMs}
                restoreLastVisitedFolderOnStartup={restoreLastVisitedFolderOnStartup}
                themeOptions={[...THEME_OPTIONS]}
                uiFontOptions={[...UI_FONT_OPTIONS]}
                uiFontSizeOptions={[...UI_FONT_SIZE_OPTIONS]}
                uiFontWeightOptions={[...UI_FONT_WEIGHT_OPTIONS]}
                typeaheadDebounceOptions={[...TYPEAHEAD_DEBOUNCE_OPTIONS]}
                onThemeChange={setTheme}
                onUiFontFamilyChange={setUiFontFamily}
                onUiFontSizeChange={setUiFontSize}
                onUiFontWeightChange={setUiFontWeight}
                onTextPrimaryColorChange={setTextPrimaryOverride}
                onTextSecondaryColorChange={setTextSecondaryOverride}
                onTextMutedColorChange={setTextMutedOverride}
                onResetAppearance={resetAppearanceSettings}
                onTypeaheadEnabledChange={setTypeaheadEnabled}
                onTypeaheadDebounceMsChange={setTypeaheadDebounceMs}
                onRestoreLastVisitedFolderOnStartupChange={setRestoreLastVisitedFolderOnStartup}
              />
            )}
          </section>
        </section>
      )}

      <LocationSheet
        open={locationSheetOpen}
        currentPath={currentPath}
        submitting={locationSubmitting}
        error={locationError}
        onRequestPathSuggestions={(inputPath) =>
          requestPathSuggestions({ client, includeHidden, inputPath })
        }
        onClose={() => setLocationSheetOpen(false)}
        onSubmit={(path) => void submitLocationPath(path)}
      />
    </main>
  );
}

function DetailRow({
  open,
  currentPath,
  currentEntries,
  selectedEntry,
  item,
}: {
  open: boolean;
  currentPath: string;
  currentEntries: DirectoryEntry[];
  selectedEntry: DirectoryEntry | null;
  item: IpcResponse<"item:getProperties">["item"] | null;
}) {
  const activeEntry =
    selectedEntry ??
    (currentPath
      ? {
          path: currentPath,
          name: currentPath.split("/").filter(Boolean).at(-1) ?? "Macintosh HD",
          extension: "",
          kind: "directory" as const,
          isHidden: false,
          isSymlink: false,
        }
      : null);

  if (!activeEntry) {
    return <div className={`detail-row${open ? " open" : ""}`} />;
  }

  const activeItem = item?.path === activeEntry.path ? item : null;
  const isDirectoryLike =
    activeEntry.kind === "directory" || activeEntry.kind === "symlink_directory";
  const kindLabel =
    activeItem?.kindLabel ??
    (activeEntry.kind === "directory"
      ? "Folder"
      : activeEntry.kind === "symlink_directory"
        ? "Alias Folder"
        : activeEntry.extension
          ? `${activeEntry.extension.toUpperCase()} File`
          : "File");
  const sizeLabel = isDirectoryLike
    ? activeEntry.path === currentPath
      ? `${currentEntries.length} items`
      : "—"
    : activeItem
      ? formatSize(activeItem.sizeBytes, activeItem.sizeStatus)
      : "—";
  const modifiedLabel = activeItem ? formatDateTime(activeItem.modifiedAt) : "—";
  const permissionsLabel = activeItem ? formatPermissionMode(activeItem.permissionMode) : "—";

  return (
    <div className={`detail-row${open ? " open" : ""}`}>
      <div className="detail-inner">
        <div className="dt-hero">
          <div>
            <FileIcon entry={activeEntry} />
          </div>
          <div>
            <div className="dt-name">{activeEntry.name}</div>
            <div className="dt-type">{kindLabel}</div>
          </div>
        </div>
        <div className="dt-meta">
          <div className="dt-pair">
            <div className="dt-lbl">Size</div>
            <div className="dt-val">{sizeLabel}</div>
          </div>
          <div className="dt-pair">
            <div className="dt-lbl">Modified</div>
            <div className="dt-val">{modifiedLabel}</div>
          </div>
          <div className="dt-pair">
            <div className="dt-lbl">Permissions</div>
            <div className="dt-val">{permissionsLabel}</div>
          </div>
          <div className="dt-pair dt-pair-path">
            <div className="dt-lbl">Path</div>
            <div className="dt-val pth">{activeEntry.path}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function createTreeNode(path: string, expanded: boolean): TreeNodeState {
  return {
    path,
    name: path === "/" ? "/" : (path.split("/").filter(Boolean).at(-1) ?? path),
    kind: "directory",
    isHidden: false,
    isSymlink: false,
    expanded,
    loading: false,
    loaded: false,
    error: null,
    childPaths: [],
  };
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  if (rootPath === "/") {
    return true;
  }
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

async function requestPathSuggestions(args: {
  client: ReturnType<typeof useFiletrailClient>;
  includeHidden: boolean;
  inputPath: string;
}): Promise<IpcResponse<"path:getSuggestions">> {
  const { client, includeHidden, inputPath } = args;
  const limit = 12;
  return (
    (await client
      .invoke("path:getSuggestions", {
        inputPath,
        includeHidden,
        limit,
      })
      .catch(() => null)) ?? {
      inputPath,
      basePath: null,
      suggestions: [],
    }
  );
}
