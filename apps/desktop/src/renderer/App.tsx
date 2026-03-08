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
  type SearchResultsFilterScopePreference,
  type SearchResultsSortByPreference,
  type SearchResultsSortDirectionPreference,
  THEME_OPTIONS,
  TYPEAHEAD_DEBOUNCE_OPTIONS,
  type ThemeMode,
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
  UI_FONT_WEIGHT_OPTIONS,
  type UiFontFamily,
  type UiFontWeight,
} from "../shared/appPreferences";
import { ActionNoticeDialog } from "./components/ActionNoticeDialog";
import { ContentPane } from "./components/ContentPane";
import { HelpView } from "./components/HelpView";
import {
  BROWSE_CONTEXT_MENU_ITEMS,
  type ContextMenuActionId,
  type ContextMenuSubmenuActionId,
  ItemContextMenu,
  SEARCH_CONTEXT_MENU_ITEMS,
} from "./components/ItemContextMenu";
import { LocationSheet } from "./components/LocationSheet";
import { PropertiesDrawer } from "./components/PropertiesDrawer";
import { SearchResultsPane } from "./components/SearchResultsPane";
import { SettingsView } from "./components/SettingsView";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { type TreeNodeState, TreePane } from "./components/TreePane";
import { useElementSize } from "./hooks/useElementSize";
import { useExplorerPaneLayout } from "./hooks/useExplorerPaneLayout";
import {
  EMPTY_CONTENT_SELECTION,
  extendContentSelectionToPath as extendSelectionStateToPath,
  mergeSelectionPathsInEntryOrder,
  sanitizeContentSelection,
  selectAllContentEntries as selectAllSelectionStateEntries,
  setSingleContentSelection as createSingleContentSelection,
  toggleContentSelection as toggleSelectionState,
  type ContentSelectionState,
} from "./lib/contentSelection";
import {
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getNextSelectionIndex,
  getTreeSeedChain,
  parentDirectoryPath,
  pathHasHiddenSegmentWithinRoot,
} from "./lib/explorerNavigation";
import { FileIcon } from "./lib/fileIcons";
import { useFiletrailClient } from "./lib/filetrailClient";
import { formatDateTime, formatPermissionMode, formatSize } from "./lib/formatting";
import { EXPLORER_LAYOUT } from "./lib/layoutTokens";
import { createRendererLogger } from "./lib/logging";
import { resolveExplorerToolbarLayout, resolveSinglePanelLayout } from "./lib/responsiveLayout";
import { appendSearchResults, filterSearchResults, sortSearchResults } from "./lib/searchResults";
import { resolveStartupNavigation } from "./lib/startupNavigation";
import { applyAppearance, getThemeAppearanceDefaults } from "./lib/theme";
import { getTreeKeyboardAction } from "./lib/treeView";
import {
  findContentTypeaheadMatch,
  findTreeTypeaheadMatch,
  isTypeaheadCharacterKey,
} from "./lib/typeahead";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];
type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
type SearchJobStatus = IpcResponse<"search:getUpdate">["status"];
type SearchResultsFilterScope = SearchResultsFilterScopePreference;
type SearchResultsSortBy = SearchResultsSortByPreference;
type SearchResultsSortDirection = SearchResultsSortDirectionPreference;
type ContextMenuState = {
  x: number;
  y: number;
  paths: string[];
  source: "browse" | "search";
  scope: "selection" | "background";
};

const logger = createRendererLogger("filetrail.renderer");
const SEARCH_POLL_INTERVAL_MS = 120;
const CONTEXT_MENU_WIDTH = 240;
const CONTEXT_SUBMENU_WIDTH = 180;
const CONTEXT_MENU_SAFE_MARGIN = 12;
const CONTEXT_MENU_MAX_HEIGHT = 420;
const SHORTCUT_ITEMS = [
  { group: "Navigation", shortcut: "Cmd+Left", description: "Go back to the previous folder" },
  { group: "Navigation", shortcut: "Cmd+Right", description: "Go forward to the next folder" },
  {
    group: "Navigation",
    shortcut: "Cmd+Up",
    description: "Open the parent folder",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+Down",
    description:
      "Open the selected item from the file list, or expand the current folder in the tree",
  },
  { group: "Navigation", shortcut: "Cmd+L", description: "Open Go to Folder" },
  {
    group: "Navigation",
    shortcut: "Cmd+R",
    description: "Refresh the current folder when search results are not visible",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+Option+C",
    description: "Copy the selected item path, or the current folder if nothing is selected",
  },
  {
    group: "Navigation",
    shortcut: "Cmd+Shift+.",
    description: "Toggle hidden files",
  },
  { group: "Search", shortcut: "Cmd+F", description: "Focus file search" },
  {
    group: "Search",
    shortcut: "Cmd+Shift+F",
    description: "Show cached search results without opening the search box",
  },
  {
    group: "Search",
    shortcut: "Cmd+R",
    description: "Apply the selected sort to the current search results",
  },
  {
    group: "Search",
    shortcut: "Esc",
    description: "Close visible search results and return to normal browsing",
  },
  {
    group: "Panels",
    shortcut: "Tab",
    description:
      "Move focus between the folder tree and file list when pane tab switching is enabled",
  },
  {
    group: "Panels",
    shortcut: "Shift+Tab",
    description:
      "Move focus back between the file list and folder tree when pane tab switching is enabled",
  },
  { group: "Panels", shortcut: "Cmd+1", description: "Focus the folder tree" },
  { group: "Panels", shortcut: "Cmd+2", description: "Focus the file list" },
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
  const [searchDraftQuery, setSearchDraftQuery] = useState("");
  const [searchCommittedQuery, setSearchCommittedQuery] = useState("");
  const [searchRootPath, setSearchRootPath] = useState("");
  const [searchPatternMode, setSearchPatternMode] = useState<SearchPatternMode>(
    DEFAULT_APP_PREFERENCES.searchPatternMode,
  );
  const [searchMatchScope, setSearchMatchScope] = useState<SearchMatchScope>(
    DEFAULT_APP_PREFERENCES.searchMatchScope,
  );
  const [searchRecursive, setSearchRecursive] = useState(DEFAULT_APP_PREFERENCES.searchRecursive);
  const [searchIncludeHidden, setSearchIncludeHidden] = useState(
    DEFAULT_APP_PREFERENCES.searchIncludeHidden,
  );
  const [searchResultsSortBy, setSearchResultsSortBy] = useState<SearchResultsSortBy>(
    DEFAULT_APP_PREFERENCES.searchResultsSortBy,
  );
  const [searchResultsSortDirection, setSearchResultsSortDirection] =
    useState<SearchResultsSortDirection>(DEFAULT_APP_PREFERENCES.searchResultsSortDirection);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [searchResultsVisible, setSearchResultsVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchResultsScrollTop, setSearchResultsScrollTop] = useState(0);
  const [searchResultsFilterQuery, setSearchResultsFilterQuery] = useState("");
  const [debouncedSearchResultsFilterQuery, setDebouncedSearchResultsFilterQuery] = useState("");
  const [searchResultsFilterScope, setSearchResultsFilterScope] =
    useState<SearchResultsFilterScope>(DEFAULT_APP_PREFERENCES.searchResultsFilterScope);
  const [searchStatus, setSearchStatus] = useState<SearchJobStatus | "idle">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [includeHidden, setIncludeHidden] = useState(DEFAULT_APP_PREFERENCES.includeHidden);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>(DEFAULT_APP_PREFERENCES.viewMode);
  const [foldersFirst, setFoldersFirst] = useState(DEFAULT_APP_PREFERENCES.foldersFirst);
  const [compactListView, setCompactListView] = useState(DEFAULT_APP_PREFERENCES.compactListView);
  const [compactTreeView, setCompactTreeView] = useState(DEFAULT_APP_PREFERENCES.compactTreeView);
  const [tabSwitchesExplorerPanes, setTabSwitchesExplorerPanes] = useState(
    DEFAULT_APP_PREFERENCES.tabSwitchesExplorerPanes,
  );
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
  const [contentSelection, setContentSelection] =
    useState<ContentSelectionState>(EMPTY_CONTENT_SELECTION);
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
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const [actionNotice, setActionNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const [restoredPaneWidths, setRestoredPaneWidths] = useState<{
    treeWidth: number;
    inspectorWidth: number;
  } | null>(null);
  const treePaneRef = useRef<HTMLElement | null>(null);
  const contentPaneRef = useRef<HTMLElement | null>(null);
  const toolbarRef = useRef<HTMLElement | null>(null);
  const singlePanelRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const directoryRequestRef = useRef(0);
  const metadataRequestRef = useRef(0);
  const propertiesRequestRef = useRef(0);
  const searchPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSessionRef = useRef(0);
  const searchJobIdRef = useRef<string | null>(null);
  const searchPointerIntentRef = useRef(false);
  const searchCommittedQueryRef = useRef("");
  const searchResultsRef = useRef<SearchResultItem[]>([]);
  const searchResultsVisibleRef = useRef(false);
  const searchResultsSortByRef = useRef<SearchResultsSortBy>(
    DEFAULT_APP_PREFERENCES.searchResultsSortBy,
  );
  const searchResultsSortDirectionRef = useRef<SearchResultsSortDirection>(
    DEFAULT_APP_PREFERENCES.searchResultsSortDirection,
  );
  const browseSelectionRef = useRef<ContentSelectionState>(EMPTY_CONTENT_SELECTION);
  const cachedSearchSelectionRef = useRef<ContentSelectionState>(EMPTY_CONTENT_SELECTION);
  const treeRequestRef = useRef<Record<string, number>>({});
  const treeNodesRef = useRef<Record<string, TreeNodeState>>({});
  const treeRootPathRef = useRef(treeRootPath);
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeaheadQueryRef = useRef("");
  const typeaheadPaneRef = useRef<"tree" | "content" | null>(null);
  const actionNoticeReturnFocusPaneRef = useRef<"tree" | "content" | null>(null);
  const lastExplorerFocusPaneRef = useRef<"tree" | "content" | null>(null);
  const panes = useExplorerPaneLayout({
    initialTreeWidth: DEFAULT_APP_PREFERENCES.treeWidth,
    initialInspectorWidth: DEFAULT_APP_PREFERENCES.inspectorWidth,
    inspectorVisible: propertiesOpen,
    minContentWidth: EXPLORER_LAYOUT.minContentWidth,
  });
  const { width: toolbarWidth } = useElementSize(toolbarRef);
  const { width: singlePanelWidth } = useElementSize(singlePanelRef);
  const filteredSearchResults = useMemo(
    () =>
      filterSearchResults(
        searchResults,
        debouncedSearchResultsFilterQuery,
        searchResultsFilterScope,
      ),
    [debouncedSearchResultsFilterQuery, searchResults, searchResultsFilterScope],
  );
  const searchResultEntries = useMemo(
    () => filteredSearchResults.map((result) => toDirectoryEntryFromSearchResult(result)),
    [filteredSearchResults],
  );
  const hasCachedSearch = searchCommittedQuery.trim().length > 0;
  const isSearchMode = searchResultsVisible && hasCachedSearch;
  const activeContentEntries = useMemo(
    () => (isSearchMode ? searchResultEntries : currentEntries),
    [currentEntries, isSearchMode, searchResultEntries],
  );
  const selectedPathSet = useMemo(() => new Set(contentSelection.paths), [contentSelection.paths]);
  const selectedPathsInViewOrder = useMemo(
    () =>
      activeContentEntries
        .filter((entry) => selectedPathSet.has(entry.path))
        .map((entry) => entry.path),
    [activeContentEntries, selectedPathSet],
  );
  const selectedEntry = useMemo(
    () =>
      activeContentEntries.find((entry) => entry.path === contentSelection.leadPath) ??
      activeContentEntries.find((entry) => selectedPathSet.has(entry.path)) ??
      null,
    [activeContentEntries, contentSelection.leadPath, selectedPathSet],
  );
  const contextMenuTargetEntries = useMemo(
    () =>
      contextMenuState
        ? contextMenuState.paths
            .map((path) => activeContentEntries.find((entry) => entry.path === path) ?? null)
            .filter((entry): entry is DirectoryEntry => entry !== null)
        : [],
    [activeContentEntries, contextMenuState],
  );
  const contextMenuDisabledActionIds = useMemo(() => {
    if (!contextMenuState || contextMenuTargetEntries.length > 0) {
      return [] as ContextMenuActionId[];
    }
    const items =
      contextMenuState.source === "search" ? SEARCH_CONTEXT_MENU_ITEMS : BROWSE_CONTEXT_MENU_ITEMS;
    return items.flatMap((item) => {
      if (item.type === "separator" || item.id === "newFolder") {
        return [];
      }
      return [item.id];
    });
  }, [contextMenuState, contextMenuTargetEntries.length]);

  useEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes]);

  useEffect(() => {
    searchResultsVisibleRef.current = searchResultsVisible;
  }, [searchResultsVisible]);

  useEffect(() => {
    searchCommittedQueryRef.current = searchCommittedQuery;
  }, [searchCommittedQuery]);

  useEffect(() => {
    searchResultsRef.current = searchResults;
  }, [searchResults]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchResultsFilterQuery(searchResultsFilterQuery);
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchResultsFilterQuery]);

  useEffect(() => {
    searchResultsSortByRef.current = searchResultsSortBy;
  }, [searchResultsSortBy]);

  useEffect(() => {
    searchResultsSortDirectionRef.current = searchResultsSortDirection;
  }, [searchResultsSortDirection]);

  useEffect(() => {
    setContentSelection((current) => sanitizeContentSelection(current, activeContentEntries));
  }, [activeContentEntries]);

  useEffect(() => {
    if (isSearchMode) {
      cachedSearchSelectionRef.current = contentSelection;
      return;
    }
    browseSelectionRef.current = contentSelection;
  }, [contentSelection, isSearchMode]);

  useEffect(() => {
    treeRootPathRef.current = treeRootPath;
  }, [treeRootPath]);

  useEffect(() => {
    typeaheadQueryRef.current = typeaheadQuery;
  }, [typeaheadQuery]);

  useEffect(() => {
    typeaheadPaneRef.current = typeaheadPane;
  }, [typeaheadPane]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }
    if (
      contextMenuState.paths.some(
        (path) => !activeContentEntries.some((entry) => entry.path === path),
      )
    ) {
      setContextMenuState(null);
    }
  }, [activeContentEntries, contextMenuState]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }
    if (mainView !== "explorer" || locationSheetOpen) {
      setContextMenuState(null);
    }
  }, [contextMenuState, locationSheetOpen, mainView]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".context-menu-layer")) {
        return;
      }
      setContextMenuState(null);
    };
    const closeMenu = () => setContextMenuState(null);
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [contextMenuState]);

  useEffect(
    () => () => {
      if (typeaheadTimeoutRef.current) {
        clearTimeout(typeaheadTimeoutRef.current);
      }
      if (searchPollTimeoutRef.current) {
        clearTimeout(searchPollTimeoutRef.current);
      }
      if (searchJobIdRef.current) {
        void client
          .invoke("search:cancel", { jobId: searchJobIdRef.current })
          .catch(() => undefined);
      }
    },
    [client],
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
    if (focusedPane === "tree" || focusedPane === "content") {
      lastExplorerFocusPaneRef.current = focusedPane;
    }
  }, [focusedPane]);

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
      actionNotice ||
      contextMenuState ||
      focusedPane !== null
    ) {
      return;
    }
    const activeElement = document.activeElement;
    if (
      searchPointerIntentRef.current ||
      (activeElement instanceof Node && (searchShellRef.current?.contains(activeElement) ?? false))
    ) {
      return;
    }
    const nextPane = contentPaneRef.current ?? treePaneRef.current;
    if (!nextPane) {
      return;
    }
    nextPane.focus({ preventScroll: true });
    setFocusedPane(contentPaneRef.current ? "content" : "tree");
  }, [
    actionNotice,
    contextMenuState,
    focusedPane,
    isSearchMode,
    locationSheetOpen,
    mainView,
    preferencesReady,
  ]);

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
        compactListView,
        compactTreeView,
        tabSwitchesExplorerPanes,
        typeaheadEnabled,
        typeaheadDebounceMs,
        propertiesOpen,
        detailRowOpen,
        includeHidden,
        searchPatternMode,
        searchMatchScope,
        searchRecursive,
        searchIncludeHidden,
        searchResultsSortBy,
        searchResultsSortDirection,
        searchResultsFilterScope,
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
    compactListView,
    compactTreeView,
    searchIncludeHidden,
    searchResultsSortBy,
    searchResultsSortDirection,
    searchResultsFilterScope,
    searchMatchScope,
    searchPatternMode,
    searchRecursive,
    tabSwitchesExplorerPanes,
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
      client.invoke("app:getLaunchContext", {}),
    ])
      .then(([preferencesResponse, homeResponse, launchContextResponse]) => {
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
        setSearchPatternMode(preferences.searchPatternMode);
        setSearchMatchScope(preferences.searchMatchScope);
        setSearchRecursive(preferences.searchRecursive);
        setSearchIncludeHidden(preferences.searchIncludeHidden);
        searchResultsSortByRef.current = preferences.searchResultsSortBy;
        searchResultsSortDirectionRef.current = preferences.searchResultsSortDirection;
        setSearchResultsSortBy(preferences.searchResultsSortBy);
        setSearchResultsSortDirection(preferences.searchResultsSortDirection);
        setSearchResultsFilterScope(preferences.searchResultsFilterScope);
        setViewMode(preferences.viewMode);
        setFoldersFirst(preferences.foldersFirst);
        setCompactListView(preferences.compactListView);
        setCompactTreeView(preferences.compactTreeView);
        setTabSwitchesExplorerPanes(preferences.tabSwitchesExplorerPanes);
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
          launchContextResponse.startupFolderPath,
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
    const unsubscribe = client.onCommand((command) => {
      if (command.type === "copyPath") {
        const pathsToCopy =
          (contextMenuState?.paths.length ?? 0) > 0
            ? contextMenuState?.paths ?? []
            : selectedPathsInViewOrder.length > 0
              ? selectedPathsInViewOrder
              : currentPath
                ? [currentPath]
                : [];
        if (pathsToCopy.length > 0) {
          void runCopyPathAction(pathsToCopy);
        }
        return;
      }
      if (command.type === "refreshOrApplySearchSort") {
        if (isSearchMode) {
          applySearchResultsSort();
          return;
        }
        void refreshDirectory();
        return;
      }
      if (command.type !== "focusFileSearch") {
        return;
      }
      setMainView("explorer");
      window.requestAnimationFrame(() => {
        searchPointerIntentRef.current = true;
        setFocusedPane(null);
        clearTypeahead();
        setSearchPopoverOpen(true);
        if (searchCommittedQueryRef.current.trim().length > 0) {
          setSearchResultsVisible(true);
          setContentSelection(
            sanitizeContentSelection(cachedSearchSelectionRef.current, searchResultEntries),
          );
        }
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          searchPointerIntentRef.current = false;
        });
      });
    });
    return unsubscribe;
  }, [
    applySearchResultsSort,
    client,
    contextMenuState,
    currentPath,
    isSearchMode,
    searchResultEntries,
    selectedPathsInViewOrder,
  ]);

  useEffect(() => {
    if (!searchPopoverOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && searchShellRef.current?.contains(target)) {
        return;
      }
      setSearchPopoverOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [searchPopoverOpen]);

  useEffect(() => {
    if (isSearchMode || viewMode !== "details" || currentPath.length === 0 || directoryLoading) {
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
    isSearchMode,
    metadataByPath,
    viewMode,
    visiblePaths,
  ]);

  useEffect(() => {
    if ((!propertiesOpen && !detailRowOpen) || currentPath.length === 0) {
      return;
    }
    const targetPath = contentSelection.leadPath || currentPath;
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
  }, [client, contentSelection.leadPath, currentPath, detailRowOpen, propertiesOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const targetElement = target instanceof HTMLElement ? target : null;
      if (actionNotice) {
        if (event.key === "Escape" || event.key === "Enter") {
          event.preventDefault();
          dismissActionNotice();
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          return;
        }
        if (!event.metaKey && !event.ctrlKey && !event.altKey) {
          event.preventDefault();
          return;
        }
        return;
      }
      if (event.key === "Escape" && contextMenuState) {
        event.preventDefault();
        setContextMenuState(null);
        return;
      }
      if (event.key === "Escape" && locationSheetOpen) {
        return;
      }
      if (event.key === "Escape" && mainView !== "explorer") {
        event.preventDefault();
        setMainView("explorer");
        return;
      }
      const currentSelectedEntry = selectedEntry;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (targetElement?.closest(".pathbar-editor-shell")) {
        return;
      }
      if (locationSheetOpen) {
        return;
      }
      if (
        tabSwitchesExplorerPanes &&
        event.key === "Tab" &&
        mainView === "explorer" &&
        !locationSheetOpen
      ) {
        const isAutocompleteContext =
          targetElement?.closest(".pathbar-editor-shell, .location-sheet-input-shell") !== null;
        if (isAutocompleteContext) {
          return;
        }
        const isTreeFocusTarget = target instanceof Node && !!treePaneRef.current?.contains(target);
        const isContentFocusTarget =
          target instanceof Node && !!contentPaneRef.current?.contains(target);
        const shouldHandlePaneTab =
          isTreeFocusTarget ||
          isContentFocusTarget ||
          (document.activeElement === document.body && focusedPane !== null);
        if (!shouldHandlePaneTab) {
          return;
        }
        event.preventDefault();
        if (isTreeFocusTarget || focusedPane === "tree") {
          contentPaneRef.current?.focus({ preventScroll: true });
          setFocusedPane("content");
          return;
        }
        treePaneRef.current?.focus({ preventScroll: true });
        setFocusedPane("tree");
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
      if (event.metaKey && event.key.toLowerCase() === "a" && focusedPane === "content") {
        event.preventDefault();
        selectAllContentEntries();
        return;
      }
      if (event.metaKey && event.key === "1") {
        event.preventDefault();
        treePaneRef.current?.focus({ preventScroll: true });
        setFocusedPane("tree");
        return;
      }
      if (event.metaKey && event.key === "2") {
        event.preventDefault();
        contentPaneRef.current?.focus({ preventScroll: true });
        setFocusedPane("content");
        return;
      }
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "f" && hasCachedSearch) {
        event.preventDefault();
        showCachedSearchResults({ focusPane: true });
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusFileSearch(true);
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
        if (isSearchMode) {
          applySearchResultsSort();
          return;
        }
        void refreshDirectory();
        return;
      }
      if (
        event.metaKey &&
        event.altKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.code === "KeyC"
      ) {
        const pathsToCopy =
          contextMenuState && contextMenuState.paths.length > 0
            ? contextMenuState.paths
            : selectedPathsInViewOrder.length > 0
              ? selectedPathsInViewOrder
              : currentPath
                ? [currentPath]
                : [];
        if (pathsToCopy.length > 0) {
          event.preventDefault();
          void runCopyPathAction(pathsToCopy);
        }
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
      if (event.key === "Escape" && focusedPane === "content" && isSearchMode) {
        event.preventDefault();
        hideSearchResults();
        focusContentPane();
        return;
      }
      if (
        typeaheadEnabled &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isSearchMode &&
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
        if (focusedPane !== "content" || activeContentEntries.length === 0) {
          return;
        }
        event.preventDefault();
        const currentIndex = activeContentEntries.findIndex(
          (entry) => entry.path === contentSelection.leadPath,
        );
        const nextIndex = getNextSelectionIndex({
          itemCount: activeContentEntries.length,
          currentIndex,
          key: event.key,
          columns: isSearchMode ? 1 : viewMode === "list" ? contentColumns : 1,
          viewMode: isSearchMode ? "details" : viewMode,
        });
        const nextEntry = activeContentEntries[nextIndex];
        if (nextEntry) {
          if (event.shiftKey) {
            extendContentSelectionToPath(nextEntry.path);
          } else {
            setSingleContentSelection(nextEntry.path);
          }
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
    activeContentEntries,
    contentSelection.leadPath,
    contentColumns,
    currentPath,
    focusedPane,
    hasCachedSearch,
    actionNotice,
    includeHidden,
    isSearchMode,
    contextMenuState,
    locationSheetOpen,
    mainView,
    selectedEntry,
    selectedPathsInViewOrder,
    treeNodes,
    treeRootPath,
    tabSwitchesExplorerPanes,
    typeaheadEnabled,
    viewMode,
  ]);

  const effectiveThemeColors = useMemo(() => {
    const defaults = getThemeAppearanceDefaults(theme);
    return {
      primary: textPrimaryOverride ?? defaults.primary,
      secondary: textSecondaryOverride ?? defaults.secondary,
      muted: textMutedOverride ?? defaults.muted,
    };
  }, [textMutedOverride, textPrimaryOverride, textSecondaryOverride, theme]);
  const explorerToolbarLayout = useMemo(
    () => (toolbarWidth > 0 ? resolveExplorerToolbarLayout(toolbarWidth) : "full"),
    [toolbarWidth],
  );
  const singlePanelLayout = useMemo(
    () => (singlePanelWidth > 0 ? resolveSinglePanelLayout(singlePanelWidth) : "wide"),
    [singlePanelWidth],
  );
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyPaths.length - 1;
  const showUpButton = explorerToolbarLayout !== "minimal";
  const showDownButton = explorerToolbarLayout !== "minimal";
  const showRefreshButton = explorerToolbarLayout !== "minimal";
  const showInspectorButton =
    explorerToolbarLayout === "full" || explorerToolbarLayout === "condensed";
  const showSortControls = explorerToolbarLayout !== "minimal";

  function focusFileSearch(selectContents = false) {
    searchPointerIntentRef.current = true;
    setFocusedPane(null);
    clearTypeahead();
    setSearchPopoverOpen(true);
    showCachedSearchResults();
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      if (selectContents) {
        searchInputRef.current?.select();
      }
      searchPointerIntentRef.current = false;
    });
  }

  function focusContentPane() {
    setFocusedPane("content");
    clearTypeahead();
    window.requestAnimationFrame(() => {
      contentPaneRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        contentPaneRef.current?.focus({ preventScroll: true });
      });
    });
  }

  function focusTreePane() {
    setFocusedPane("tree");
    clearTypeahead();
    window.requestAnimationFrame(() => {
      treePaneRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        treePaneRef.current?.focus({ preventScroll: true });
      });
    });
  }

  function closeContextMenu() {
    setContextMenuState(null);
  }

  function resolveContextMenuPosition(x: number, y: number) {
    const maxX =
      window.innerWidth - (CONTEXT_MENU_WIDTH + CONTEXT_SUBMENU_WIDTH + CONTEXT_MENU_SAFE_MARGIN);
    const maxY = window.innerHeight - (CONTEXT_MENU_MAX_HEIGHT + CONTEXT_MENU_SAFE_MARGIN);
    return {
      x: Math.max(CONTEXT_MENU_SAFE_MARGIN, Math.min(x, maxX)),
      y: Math.max(CONTEXT_MENU_SAFE_MARGIN, Math.min(y, maxY)),
    };
  }

  function clearContentSelection() {
    setContentSelection(EMPTY_CONTENT_SELECTION);
  }

  function setSingleContentSelection(path: string) {
    setContentSelection(createSingleContentSelection(path));
  }

  function toggleContentSelection(path: string) {
    setContentSelection((current) => toggleSelectionState(current, activeContentEntries, path));
  }

  function extendContentSelectionToPath(path: string, additive = false) {
    setContentSelection((current) => {
      return extendSelectionStateToPath(current, activeContentEntries, path, additive);
    });
  }

  function handleContentSelectionGesture(
    path: string,
    modifiers: { metaKey: boolean; shiftKey: boolean },
  ) {
    if (modifiers.metaKey && modifiers.shiftKey) {
      extendContentSelectionToPath(path, true);
      return;
    }
    if (modifiers.shiftKey) {
      extendContentSelectionToPath(path);
      return;
    }
    if (modifiers.metaKey) {
      toggleContentSelection(path);
      return;
    }
    setSingleContentSelection(path);
  }

  function selectAllContentEntries() {
    setContentSelection(selectAllSelectionStateEntries(activeContentEntries));
  }

  function openItemContextMenu(
    path: string | null,
    position: { x: number; y: number },
    source: "browse" | "search" = "browse",
  ) {
    const resolvedPosition = resolveContextMenuPosition(position.x, position.y);
    let contextPaths: string[] = [];
    if (path) {
      if (selectedPathSet.has(path)) {
        contextPaths = selectedPathsInViewOrder;
      } else {
        contextPaths = [path];
        setSingleContentSelection(path);
      }
    } else {
      clearContentSelection();
    }
    setFocusedPane("content");
    window.requestAnimationFrame(() => {
      contentPaneRef.current?.focus({ preventScroll: true });
    });
    setContextMenuState({
      ...resolvedPosition,
      paths: contextPaths,
      source,
      scope: contextPaths.length > 0 ? "selection" : "background",
    });
  }

  function showNotImplementedNotice(title: string) {
    actionNoticeReturnFocusPaneRef.current =
      focusedPane ?? lastExplorerFocusPaneRef.current ?? (contextMenuState ? "content" : null);
    setActionNotice({
      title,
      message: `${title} is not implemented yet.`,
    });
  }

  function dismissActionNotice() {
    const paneToRestore = actionNoticeReturnFocusPaneRef.current;
    actionNoticeReturnFocusPaneRef.current = null;
    setActionNotice(null);
    if (paneToRestore === "content") {
      focusContentPane();
      return;
    }
    if (paneToRestore === "tree") {
      focusTreePane();
    }
  }

  async function copyPathsToClipboard(paths: string[]) {
    await client.invoke("system:copyText", {
      text: paths.map((path) => formatPathForShell(path)).join("\n"),
    });
  }

  async function runCopyPathAction(paths: string[]) {
    try {
      await copyPathsToClipboard(paths);
    } catch (error) {
      logger.error("copy path failed", error);
      setActionNotice({
        title: "Copy Path",
        message: "Unable to copy the selected paths to the clipboard.",
      });
    }
  }

  async function revealSearchResultInFolder(path: string) {
    const folderPath = parentDirectoryPath(path);
    if (!folderPath) {
      return;
    }
    setSearchPopoverOpen(false);
    searchInputRef.current?.blur();
    const didNavigate = await navigateTo(
      folderPath,
      folderPath === currentPath ? "replace" : "push",
    );
    if (!didNavigate) {
      return;
    }
    setSingleContentSelection(path);
    focusContentPane();
  }

  async function runContextMenuAction(actionId: ContextMenuActionId, paths: string[]) {
    closeContextMenu();
    if (actionId === "revealInFolder") {
      const firstPath = paths[0];
      if (firstPath) {
        await revealSearchResultInFolder(firstPath);
      }
      return;
    }
    if (actionId === "copyPath") {
      if (paths.length > 0) {
        await runCopyPathAction(paths);
      }
      return;
    }
    const title =
      actionId === "open"
        ? "Open"
        : actionId === "info"
          ? "Get Info"
          : actionId === "copy"
            ? "Copy"
            : actionId === "move"
              ? "Move To…"
              : actionId === "rename"
                ? "Rename"
                : actionId === "duplicate"
                  ? "Duplicate"
                  : actionId === "compress"
                    ? "Compress"
                    : actionId === "newFolder"
                      ? "New Folder"
                      : actionId === "terminal"
                        ? "Open in Terminal"
                        : actionId === "trash"
                          ? "Move to Trash"
                          : "Open With";
    showNotImplementedNotice(title);
  }

  function runContextSubmenuAction(actionId: ContextMenuSubmenuActionId) {
    closeContextMenu();
    const title =
      actionId === "vscode"
        ? "Open With Visual Studio Code"
        : actionId === "sublime"
          ? "Open With Sublime Text"
          : actionId === "nvim"
            ? "Open With Neovim"
            : actionId === "finder"
              ? "Open With Finder"
              : "Open With Other…";
    showNotImplementedNotice(title);
  }

  function showCachedSearchResults(options?: { focusPane?: boolean }) {
    if (!hasCachedSearch) {
      return;
    }
    setSearchResultsVisible(true);
    setContentSelection(sanitizeContentSelection(cachedSearchSelectionRef.current, searchResultEntries));
    if (options?.focusPane) {
      focusContentPane();
    }
  }

  function hideSearchResults() {
    setSearchResultsVisible(false);
    setContentSelection(sanitizeContentSelection(browseSelectionRef.current, currentEntries));
  }

  function dismissFileSearch(options?: { focusBelow?: boolean }) {
    setSearchPopoverOpen(false);
    searchInputRef.current?.blur();
    if (options?.focusBelow) {
      focusContentPane();
    }
  }

  function clearSearchPolling() {
    if (searchPollTimeoutRef.current) {
      clearTimeout(searchPollTimeoutRef.current);
      searchPollTimeoutRef.current = null;
    }
  }

  async function cancelActiveSearch() {
    const activeJobId = searchJobIdRef.current;
    clearSearchPolling();
    searchJobIdRef.current = null;
    if (!activeJobId) {
      return;
    }
    try {
      await client.invoke("search:cancel", { jobId: activeJobId });
    } catch (error) {
      logger.debug("search cancel failed", error);
    }
  }

  async function stopSearch() {
    await cancelActiveSearch();
    setSearchStatus("cancelled");
    setSearchError(null);
  }

  async function clearCommittedSearch() {
    await cancelActiveSearch();
    searchSessionRef.current += 1;
    setSearchCommittedQuery("");
    setSearchRootPath("");
    setSearchResults([]);
    setSearchResultsScrollTop(0);
    setSearchResultsFilterQuery("");
    setDebouncedSearchResultsFilterQuery("");
    setSearchStatus("idle");
    setSearchError(null);
    setSearchTruncated(false);
    setSearchResultsVisible(false);
    cachedSearchSelectionRef.current = EMPTY_CONTENT_SELECTION;
    setContentSelection(sanitizeContentSelection(browseSelectionRef.current, currentEntries));
  }

  function pollSearch(jobId: string, cursor: number, sessionId: number): void {
    void client
      .invoke("search:getUpdate", { jobId, cursor })
      .then((response) => {
        if (searchSessionRef.current !== sessionId || searchJobIdRef.current !== jobId) {
          return;
        }
        setSearchResults((current) =>
          response.items.length > 0 ? appendSearchResults(current, response.items) : current,
        );
        setSearchStatus(response.status);
        setSearchError(response.error);
        setSearchTruncated(response.truncated);
        if (response.done) {
          searchJobIdRef.current = null;
          clearSearchPolling();
          return;
        }
        searchPollTimeoutRef.current = setTimeout(() => {
          pollSearch(jobId, response.nextCursor, sessionId);
        }, SEARCH_POLL_INTERVAL_MS);
      })
      .catch((error) => {
        if (searchSessionRef.current !== sessionId || searchJobIdRef.current !== jobId) {
          return;
        }
        searchJobIdRef.current = null;
        clearSearchPolling();
        setSearchStatus("error");
        setSearchError(error instanceof Error ? error.message : String(error));
      });
  }

  async function startSearch(
    query: string,
    overrides: Partial<{
      patternMode: SearchPatternMode;
      matchScope: SearchMatchScope;
      recursive: boolean;
      includeHidden: boolean;
      rootPath: string;
    }> = {},
  ) {
    const trimmedQuery = query.trim();
    const rootPath = overrides.rootPath ?? currentPath;
    if (trimmedQuery.length === 0) {
      await clearCommittedSearch();
      return;
    }
    if (rootPath.length === 0) {
      return;
    }
    await cancelActiveSearch();
    browseSelectionRef.current = contentSelection;
    const sessionId = searchSessionRef.current + 1;
    searchSessionRef.current = sessionId;
    setSearchCommittedQuery(trimmedQuery);
    setSearchRootPath(rootPath);
    setSearchResultsVisible(true);
    setSearchResults([]);
    setSearchResultsScrollTop(0);
    setSearchResultsFilterQuery("");
    setDebouncedSearchResultsFilterQuery("");
    setSearchStatus("running");
    setSearchError(null);
    setSearchTruncated(false);
    cachedSearchSelectionRef.current = EMPTY_CONTENT_SELECTION;
    setContentSelection(EMPTY_CONTENT_SELECTION);

    try {
      const response = await client.invoke("search:start", {
        rootPath,
        query: trimmedQuery,
        patternMode: overrides.patternMode ?? searchPatternMode,
        matchScope: overrides.matchScope ?? searchMatchScope,
        recursive: overrides.recursive ?? searchRecursive,
        includeHidden: overrides.includeHidden ?? searchIncludeHidden,
      });
      if (searchSessionRef.current !== sessionId) {
        await client.invoke("search:cancel", { jobId: response.jobId }).catch(() => undefined);
        return;
      }
      searchJobIdRef.current = response.jobId;
      setSearchStatus(response.status);
      pollSearch(response.jobId, 0, sessionId);
    } catch (error) {
      if (searchSessionRef.current !== sessionId) {
        return;
      }
      searchJobIdRef.current = null;
      clearSearchPolling();
      setSearchStatus("error");
      setSearchError(error instanceof Error ? error.message : String(error));
    }
  }

  function updateSearchPatternMode(nextValue: SearchPatternMode) {
    setSearchPatternMode(nextValue);
    if (hasCachedSearch) {
      void startSearch(searchCommittedQuery, {
        patternMode: nextValue,
        rootPath: searchRootPath || currentPath,
      });
    }
  }

  function updateSearchMatchScope(nextValue: SearchMatchScope) {
    setSearchMatchScope(nextValue);
    if (hasCachedSearch) {
      void startSearch(searchCommittedQuery, {
        matchScope: nextValue,
        rootPath: searchRootPath || currentPath,
      });
    }
  }

  function updateSearchRecursive(nextValue: boolean) {
    setSearchRecursive(nextValue);
    if (hasCachedSearch) {
      void startSearch(searchCommittedQuery, {
        recursive: nextValue,
        rootPath: searchRootPath || currentPath,
      });
    }
  }

  function applySearchResultsSort() {
    const sortBy = searchResultsSortByRef.current;
    const sortDirection = searchResultsSortDirectionRef.current;
    setSearchResults((current) =>
      sortSearchResults(current, sortBy, sortDirection),
    );
  }

  function updateSearchResultsSortBy(nextValue: SearchResultsSortBy) {
    searchResultsSortByRef.current = nextValue;
    setSearchResultsSortBy(nextValue);
  }

  function updateSearchResultsFilterQuery(nextValue: string) {
    setSearchResultsFilterQuery(nextValue);
    setSearchResultsScrollTop(0);
  }

  function updateSearchResultsFilterScope(nextValue: SearchResultsFilterScope) {
    setSearchResultsFilterScope(nextValue);
    setSearchResultsScrollTop(0);
  }

  function toggleSearchResultsSortDirection() {
    setSearchResultsSortDirection((current) => {
      const nextValue = current === "asc" ? "desc" : "asc";
      searchResultsSortDirectionRef.current = nextValue;
      return nextValue;
    });
  }

  function updateSearchIncludeHidden(nextValue: boolean) {
    setSearchIncludeHidden(nextValue);
    if (hasCachedSearch) {
      void startSearch(searchCommittedQuery, {
        includeHidden: nextValue,
        rootPath: searchRootPath || currentPath,
      });
    }
  }

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
      const match = findContentTypeaheadMatch(activeContentEntries, nextQuery);
      if (match) {
        setSingleContentSelection(match.path);
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

  function rerootTreeAtHome() {
    if (!homePath) {
      return;
    }
    const targetPath = isPathWithinRoot(currentPath, homePath) ? currentPath : homePath;
    reinitializeTree(homePath, targetPath);
    void navigateTo(targetPath, targetPath === currentPath ? "replace" : "push");
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
    const seededNodes = Object.fromEntries(
      getTreeSeedChain(rootPath, focusPath).map(({ path, childPath }) => {
        const node = createTreeNode(path, true);
        return [
          path,
          {
            ...node,
            childPaths: childPath ? [childPath] : [],
          },
        ];
      }),
    );
    setTreeNodes(seededNodes);
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
      if (searchResultsVisibleRef.current) {
        setSearchResultsVisible(false);
      }
      setContentSelection(EMPTY_CONTENT_SELECTION);
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
    const rootPath = treeRootPathRef.current;
    const forcedVisibleHiddenChildPath =
      includeHiddenOverride || rootPath.length === 0
        ? null
        : getForcedVisibleHiddenChildPath(path, activePath);
    if (currentNode?.loading) {
      return;
    }
    if (
      currentNode?.loaded &&
      currentNode.loadedIncludeHidden === includeHiddenOverride &&
      (currentNode.forcedVisibleHiddenChildPath ?? null) === forcedVisibleHiddenChildPath
    ) {
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
        const visibleChildren =
          forcedVisibleHiddenChildPath === null
            ? response.children.filter((child) => includeHiddenOverride || !child.isHidden)
            : response.children.filter(
                (child) => !child.isHidden || child.path === forcedVisibleHiddenChildPath,
              );
        next[path] = {
          ...existingNode,
          expanded: existingNode.expanded || expandOnSuccess,
          loading: false,
          loaded: true,
          loadedIncludeHidden: includeHiddenOverride,
          forcedVisibleHiddenChildPath,
          childPaths: visibleChildren.map((child) => child.path),
        };
        for (const child of visibleChildren) {
          next[child.path] = {
            path: child.path,
            name: child.name,
            kind: child.kind,
            isHidden: child.isHidden,
            isSymlink: child.isSymlink,
            expanded: current[child.path]?.expanded ?? false,
            loading: false,
            loaded: current[child.path]?.loaded ?? false,
            loadedIncludeHidden: current[child.path]?.loadedIncludeHidden ?? false,
            forcedVisibleHiddenChildPath: current[child.path]?.forcedVisibleHiddenChildPath ?? null,
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
    return getForcedVisibleHiddenChildPath(path, activePath) !== null;
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
    reinitializeTree(resolveRefreshRootPath(currentPath, treeRootPath, homePath), currentPath);
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
          <header ref={toolbarRef} className="window-toolbar">
            <div className="window-toolbar-brand">
              <span className="window-toolbar-title">File Trail</span>
            </div>
            <div className="titlebar-actions" data-layout={explorerToolbarLayout}>
              <div className="toolbar-group toolbar-group-nav">
                <button
                  type="button"
                  className="tb-btn tb-btn-icon toolbar-btn-muted"
                  disabled={!canGoBack}
                  onClick={goBack}
                  title="Back (Cmd+Left)"
                  aria-label="Back"
                >
                  <ToolbarIcon name="back" />
                </button>
                <button
                  type="button"
                  className="tb-btn tb-btn-icon toolbar-btn-muted"
                  disabled={!canGoForward}
                  onClick={goForward}
                  title="Forward (Cmd+Right)"
                  aria-label="Forward"
                >
                  <ToolbarIcon name="forward" />
                </button>
                {showUpButton ? (
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
                ) : null}
                {showDownButton ? (
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
                ) : null}
              </div>
              {showRefreshButton ? (
                <>
                  <span className="titlebar-divider" aria-hidden />
                  <div className="toolbar-group">
                    <button
                      type="button"
                      className="tb-btn tb-btn-icon"
                      onClick={() => void refreshDirectory()}
                      title="Refresh current folder (Cmd+R)"
                      aria-label="Refresh current folder"
                    >
                      <ToolbarIcon name="refresh" />
                    </button>
                  </div>
                </>
              ) : null}
              {showInspectorButton ? (
                <>
                  <span className="titlebar-divider" aria-hidden />
                  <div className="toolbar-group">
                    <button
                      type="button"
                      className={
                        propertiesOpen ? "tb-btn tb-btn-icon active" : "tb-btn tb-btn-icon"
                      }
                      onClick={() => setPropertiesOpen((value: boolean) => !value)}
                      title="Inspector (Cmd+I)"
                      aria-label="Inspector"
                    >
                      <ToolbarIcon name="drawer" />
                    </button>
                  </div>
                </>
              ) : null}
              <span className="titlebar-divider" aria-hidden />
              <div className="toolbar-group toolbar-group-view">
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
              </div>
              {showSortControls ? (
                <>
                  <span className="titlebar-divider" aria-hidden />
                  <div className="toolbar-group">
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
                  </div>
                </>
              ) : null}
              <div className="toolbar-search-slot">
                <div
                  ref={searchShellRef}
                  className={`toolbar-search-shell${searchPopoverOpen ? " active" : ""}`}
                  onBlurCapture={(event) => {
                    const nextTarget = event.relatedTarget;
                    if (
                      nextTarget instanceof Node &&
                      (searchShellRef.current?.contains(nextTarget) ?? false)
                    ) {
                      return;
                    }
                    setSearchPopoverOpen(false);
                  }}
                >
                  <form
                    className="toolbar-search"
                    aria-label="Find files in current folder"
                    onMouseDownCapture={(event) => {
                      const target = event.target;
                      if (!(target instanceof HTMLElement)) {
                        return;
                      }
                      if (target.closest(".toolbar-search-clear") !== null) {
                        return;
                      }
                      searchPointerIntentRef.current = true;
                      setFocusedPane(null);
                      clearTypeahead();
                      window.requestAnimationFrame(() => {
                        searchInputRef.current?.focus();
                        searchPointerIntentRef.current = false;
                      });
                    }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void startSearch(searchDraftQuery).finally(() => {
                        dismissFileSearch({ focusBelow: true });
                      });
                    }}
                  >
                    <div className="toolbar-search-row">
                      <span className="toolbar-search-icon">
                        <ToolbarIcon name="search" />
                      </span>
                      <input
                        ref={searchInputRef}
                        className="toolbar-search-input"
                        type="text"
                        value={searchDraftQuery}
                        onFocus={() => {
                          searchPointerIntentRef.current = false;
                          setFocusedPane(null);
                          clearTypeahead();
                          setSearchPopoverOpen(true);
                          showCachedSearchResults();
                        }}
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;
                          setSearchDraftQuery(nextValue);
                          if (nextValue.trim().length === 0) {
                            void clearCommittedSearch();
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") {
                            return;
                          }
                          event.preventDefault();
                          event.stopPropagation();
                          dismissFileSearch({ focusBelow: true });
                        }}
                        placeholder="Find files…"
                        spellCheck={false}
                      />
                      {searchDraftQuery.trim().length > 0 ? (
                        <button
                          type="button"
                          className="toolbar-search-clear"
                          aria-label="Clear file search"
                          onMouseDown={(event) => {
                            event.preventDefault();
                          }}
                          onClick={() => {
                            setSearchDraftQuery("");
                            void clearCommittedSearch().finally(() => {
                              focusFileSearch(false);
                            });
                          }}
                        >
                          <ToolbarIcon name="close" />
                        </button>
                      ) : (
                        <span className="toolbar-search-shortcut" aria-hidden="true">
                          ⌘F
                        </span>
                      )}
                    </div>
                  </form>
                  {searchPopoverOpen ? (
                    <div className="toolbar-search-popover">
                      <div className="toolbar-search-options">
                        <div className="toolbar-search-option-row toolbar-search-option-row-primary">
                          <label className="toolbar-search-listbox">
                            <span className="toolbar-search-listbox-label">Pattern</span>
                            <select
                              className="toolbar-search-select"
                              value={searchPatternMode}
                              onChange={(event) =>
                                updateSearchPatternMode(
                                  event.currentTarget.value as SearchPatternMode,
                                )
                              }
                              aria-label="Search pattern mode"
                            >
                              <option value="regex">Regex</option>
                              <option value="glob">Glob</option>
                            </select>
                          </label>
                          <label className="toolbar-search-listbox">
                            <span className="toolbar-search-listbox-label">Match</span>
                            <select
                              className="toolbar-search-select"
                              value={searchMatchScope}
                              onChange={(event) =>
                                updateSearchMatchScope(
                                  event.currentTarget.value as SearchMatchScope,
                                )
                              }
                              aria-label="Search match scope"
                            >
                              <option value="name">Name</option>
                              <option value="path">Path</option>
                            </select>
                          </label>
                        </div>
                        <div className="toolbar-search-option-row toolbar-search-option-row-secondary">
                          <div className="toolbar-search-option-group">
                            <button
                              type="button"
                              className={
                                searchRecursive
                                  ? "toolbar-search-pill active"
                                  : "toolbar-search-pill"
                              }
                              onClick={() => updateSearchRecursive(!searchRecursive)}
                              aria-pressed={searchRecursive}
                            >
                              Recursive
                            </button>
                            <button
                              type="button"
                              className={
                                searchIncludeHidden
                                  ? "toolbar-search-pill active"
                                  : "toolbar-search-pill"
                              }
                              onClick={() => updateSearchIncludeHidden(!searchIncludeHidden)}
                              aria-pressed={searchIncludeHidden}
                            >
                              Hidden
                            </button>
                          </div>
                        </div>
                      </div>
                      <div className="toolbar-search-meta">
                        <span className="toolbar-search-status">
                          {searchDraftQuery.trim().length > 0 &&
                          searchDraftQuery.trim() !== searchCommittedQuery
                            ? "Press Enter to search"
                            : searchStatus === "running"
                              ? "Searching…"
                              : ""}
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
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
                compactTreeView={compactTreeView}
                nodes={treeNodes}
                rootPath={treeRootPath}
                onFocusChange={(focused) => setFocusedPane(focused ? "tree" : null)}
                onGoHome={goHome}
                onRerootHome={rerootTreeAtHome}
                onQuickAccess={goQuickAccess}
                foldersFirst={foldersFirst}
                onToggleFoldersFirst={toggleFoldersFirst}
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
                {isSearchMode ? (
                  <SearchResultsPane
                    key={`${searchRootPath}:${searchCommittedQuery}`}
                    paneRef={contentPaneRef}
                    isFocused={focusedPane === "content"}
                    rootPath={searchRootPath}
                    query={searchCommittedQuery}
                    status={searchStatus}
                    results={filteredSearchResults}
                    selectedPaths={contentSelection.paths}
                    selectionLeadPath={contentSelection.leadPath}
                    error={searchError}
                    truncated={searchTruncated}
                    filterQuery={searchResultsFilterQuery}
                    filterScope={searchResultsFilterScope}
                    totalCount={searchResults.length}
                    sortBy={searchResultsSortBy}
                    sortDirection={searchResultsSortDirection}
                    onStopSearch={() => {
                      void stopSearch();
                    }}
                    onClearResults={() => {
                      void clearCommittedSearch().finally(() => {
                        focusContentPane();
                      });
                    }}
                    onCloseResults={() => {
                      setSearchPopoverOpen(false);
                      searchInputRef.current?.blur();
                      hideSearchResults();
                      focusContentPane();
                    }}
                    onFilterQueryChange={updateSearchResultsFilterQuery}
                    onFilterScopeChange={updateSearchResultsFilterScope}
                    onSortByChange={updateSearchResultsSortBy}
                    onSortDirectionToggle={toggleSearchResultsSortDirection}
                    onApplySort={applySearchResultsSort}
                    onSelectionGesture={handleContentSelectionGesture}
                    onClearSelection={clearContentSelection}
                    onActivateResult={(item) => {
                      void activateEntry(toDirectoryEntryFromSearchResult(item));
                    }}
                    onItemContextMenu={(path, position) => {
                      openItemContextMenu(path, position, "search");
                    }}
                    onFocusChange={(focused) => setFocusedPane(focused ? "content" : null)}
                    scrollTop={searchResultsScrollTop}
                    onScrollTopChange={setSearchResultsScrollTop}
                  />
                ) : (
                  <ContentPane
                    paneRef={contentPaneRef}
                    isFocused={focusedPane === "content"}
                    currentPath={currentPath}
                    entries={currentEntries}
                    loading={directoryLoading}
                    error={directoryError}
                    includeHidden={includeHidden}
                    metadataByPath={metadataByPath}
                    selectedPaths={contentSelection.paths}
                    selectionLeadPath={contentSelection.leadPath}
                    viewMode={viewMode}
                    onSelectionGesture={handleContentSelectionGesture}
                    onClearSelection={clearContentSelection}
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
                    onItemContextMenu={(path, position) => {
                      openItemContextMenu(path, position, "browse");
                    }}
                    compactListView={compactListView}
                    tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
                    searchQuery=""
                    typeaheadQuery={focusedPane === "content" ? typeaheadQuery : ""}
                  />
                )}
                <DetailRow
                  open={detailRowOpen}
                  currentPath={currentPath}
                  currentEntries={currentEntries}
                  selectedEntry={selectedEntry}
                  item={propertiesItem}
                />
                <footer className="status-bar">
                  <span>
                    {isSearchMode
                      ? searchStatus === "running"
                        ? `${filteredSearchResults.length} / ${searchResults.length} matches so far`
                        : `${filteredSearchResults.length} / ${searchResults.length} matches`
                      : `${currentEntries.length} items`}
                  </span>
                  <span className="status-path">
                    {isSearchMode ? `Search root: ${searchRootPath}` : currentPath}
                  </span>
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
          <section ref={singlePanelRef} className="pane single-panel-pane">
            {mainView === "help" ? (
              <HelpView
                shortcutItems={[...SHORTCUT_ITEMS]}
                referenceItems={[...REFERENCE_ITEMS]}
                layoutMode={singlePanelLayout}
              />
            ) : (
              <SettingsView
                theme={theme}
                uiFontFamily={uiFontFamily}
                uiFontSize={uiFontSize}
                uiFontWeight={uiFontWeight}
                effectiveTextPrimaryColor={effectiveThemeColors.primary}
                effectiveTextSecondaryColor={effectiveThemeColors.secondary}
                effectiveTextMutedColor={effectiveThemeColors.muted}
                compactListView={compactListView}
                compactTreeView={compactTreeView}
                layoutMode={singlePanelLayout}
                tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
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
                onCompactListViewChange={setCompactListView}
                onCompactTreeViewChange={setCompactTreeView}
                onTabSwitchesExplorerPanesChange={setTabSwitchesExplorerPanes}
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
        tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
        onRequestPathSuggestions={(inputPath) =>
          requestPathSuggestions({ client, includeHidden, inputPath })
        }
        onClose={() => setLocationSheetOpen(false)}
        onSubmit={(path) => void submitLocationPath(path)}
      />
      {contextMenuState ? (
        <ItemContextMenu
          anchorX={contextMenuState.x}
          anchorY={contextMenuState.y}
          variant={contextMenuState.source}
          disabledActionIds={contextMenuDisabledActionIds}
          open
          onAction={(actionId) => {
            void runContextMenuAction(actionId, contextMenuState.paths);
          }}
          onSubmenuAction={runContextSubmenuAction}
        />
      ) : null}
      {actionNotice ? (
        <ActionNoticeDialog
          title={actionNotice.title}
          message={actionNotice.message}
          onClose={dismissActionNotice}
        />
      ) : null}
    </main>
  );
}

function formatPathForShell(path: string): string {
  if (!/\s/.test(path)) {
    return path;
  }
  return `'${path.replaceAll("'", "'\\''")}'`;
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

function toDirectoryEntryFromSearchResult(result: SearchResultItem): DirectoryEntry {
  return {
    path: result.path,
    name: result.name,
    extension: result.extension,
    kind: result.kind,
    isHidden: result.isHidden,
    isSymlink: result.isSymlink,
  };
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
    loadedIncludeHidden: false,
    forcedVisibleHiddenChildPath: null,
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

function resolveRefreshRootPath(
  currentPath: string,
  treeRootPath: string,
  homePath: string,
): string {
  if (
    homePath &&
    isPathWithinRoot(currentPath, homePath) &&
    (treeRootPath === "/" || isPathWithinRoot(homePath, treeRootPath))
  ) {
    return homePath;
  }
  return treeRootPath || currentPath;
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
