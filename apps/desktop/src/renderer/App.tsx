import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CopyPasteProgressEvent, IpcRequest, IpcResponse } from "@filetrail/contracts";

import {
  ACCENT_OPTIONS,
  DEFAULT_DETAIL_COLUMN_VISIBILITY,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  DEFAULT_APP_PREFERENCES,
  clampZoomPercent,
  type AccentMode,
  type DetailColumnVisibility,
  type DetailColumnWidths,
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
import { FEATURE_FLAGS } from "../shared/featureFlags";
import { ActionNoticeDialog } from "./components/ActionNoticeDialog";
import { CopyPasteDialog } from "./components/CopyPasteDialog";
import { CopyPasteProgressCard } from "./components/CopyPasteProgressCard";
import { ContentPane } from "./components/ContentPane";
import { HelpView } from "./components/HelpView";
import {
  BROWSE_CONTEXT_MENU_ITEMS,
  type ContextMenuActionId,
  type ContextMenuSubmenuActionId,
  ItemContextMenu,
  SEARCH_CONTEXT_MENU_ITEMS,
} from "./components/ItemContextMenu";
import { InfoPanel } from "./components/GetInfoPanel";
import { LocationSheet } from "./components/LocationSheet";
import { SEARCH_RESULT_ROW_HEIGHT, SearchResultsPane } from "./components/SearchResultsPane";
import { SettingsView } from "./components/SettingsView";
import { ToastViewport } from "./components/ToastViewport";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { type TreeNodeState, TreePane } from "./components/TreePane";
import { useElementSize } from "./hooks/useElementSize";
import { useExplorerPaneLayout } from "./hooks/useExplorerPaneLayout";
import {
  EMPTY_COPY_PASTE_CLIPBOARD,
  buildPasteRequest,
  clearClipboardAfterSuccessfulPaste,
  hasClipboardItems,
  setCopyPasteClipboard,
  type CopyPasteClipboardState,
} from "./lib/copyPasteClipboard";
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
  flattenVisibleTreePaths,
  getPageStepItemCount,
  getPagedSelectionIndex,
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getNextSelectionIndex,
  getTreeSeedChain,
  parentDirectoryPath,
  pathHasHiddenSegmentWithinRoot,
} from "./lib/explorerNavigation";
import { resolveExplorerPaneRestoreTarget, type ExplorerPane } from "./lib/explorerPaneFocus";
import { FileIcon } from "./lib/fileIcons";
import { useFiletrailClient } from "./lib/filetrailClient";
import { getDetailsRowHeight } from "./lib/detailsLayout";
import { getFlowListColumnStep } from "./lib/flowListLayout";
import { formatDateTime, formatPermissionMode, formatSize } from "./lib/formatting";
import { REFERENCE_ITEMS, SHORTCUT_ITEMS } from "./lib/helpContent";
import { EXPLORER_LAYOUT } from "./lib/layoutTokens";
import { createRendererLogger } from "./lib/logging";
import { pageScrollElement, scrollElementByAmount } from "./lib/pagedScroll";
import { resolveExplorerToolbarLayout, resolveSinglePanelLayout } from "./lib/responsiveLayout";
import { appendSearchResults, filterSearchResults, sortSearchResults } from "./lib/searchResults";
import { resolveOpenInTerminalPaths } from "./lib/shortcutTargets";
import { resolveStartupNavigation } from "./lib/startupNavigation";
import { createToastEntry, enqueueToast, type ToastEntry, type ToastKind } from "./lib/toasts";
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
  targetPath: string | null;
  source: "browse" | "search";
  scope: "selection" | "background";
};
type CopyPastePlan = IpcResponse<"copyPaste:plan">;
type CopyPasteDialogState =
  | {
      type: "plan";
      plan: CopyPastePlan;
    }
  | {
      type: "result";
      event: CopyPasteProgressEvent;
    }
  | null;

const logger = createRendererLogger("filetrail.renderer");
const SEARCH_POLL_INTERVAL_MS = 120;
const CONTEXT_MENU_WIDTH = 240;
const CONTEXT_SUBMENU_WIDTH = 180;
const CONTEXT_MENU_SAFE_MARGIN = 12;
const CONTEXT_MENU_MAX_HEIGHT = 420;

export function App() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const client = useFiletrailClient();
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(DEFAULT_APP_PREFERENCES.theme);
  const [accent, setAccent] = useState<AccentMode>(DEFAULT_APP_PREFERENCES.accent);
  const [accentToolbarButtons, setAccentToolbarButtons] = useState(
    DEFAULT_APP_PREFERENCES.accentToolbarButtons,
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
  const [compactDetailsView, setCompactDetailsView] = useState(
    DEFAULT_APP_PREFERENCES.compactDetailsView,
  );
  const [compactTreeView, setCompactTreeView] = useState(DEFAULT_APP_PREFERENCES.compactTreeView);
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
  const [restoreLastVisitedFolderOnStartup, setRestoreLastVisitedFolderOnStartup] = useState(
    DEFAULT_APP_PREFERENCES.restoreLastVisitedFolderOnStartup,
  );
  const [terminalApp, setTerminalApp] = useState(DEFAULT_APP_PREFERENCES.terminalApp);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [infoPanelOpen, setInfoPanelOpen] = useState(DEFAULT_APP_PREFERENCES.propertiesOpen);
  const [infoRowOpen, setInfoRowOpen] = useState(DEFAULT_APP_PREFERENCES.detailRowOpen);
  const [contentSelection, setContentSelection] =
    useState<ContentSelectionState>(EMPTY_CONTENT_SELECTION);
  const [historyPaths, setHistoryPaths] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [visiblePaths, setVisiblePaths] = useState<string[]>([]);
  const [contentColumns, setContentColumns] = useState(1);
  const [getInfoLoading, setGetInfoLoading] = useState(false);
  const [getInfoItem, setGetInfoItem] = useState<IpcResponse<"item:getProperties">["item"] | null>(
    null,
  );
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
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [copyPasteClipboard, setCopyPasteClipboardState] =
    useState<CopyPasteClipboardState>(EMPTY_COPY_PASTE_CLIPBOARD);
  const [copyPasteDialogState, setCopyPasteDialogState] = useState<CopyPasteDialogState>(null);
  const [copyPasteProgressEvent, setCopyPasteProgressEvent] = useState<CopyPasteProgressEvent | null>(
    null,
  );
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
  const getInfoRequestRef = useRef(0);
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
  const metadataCacheRef = useRef<Map<string, DirectoryEntryMetadata>>(new Map());
  const metadataInflightRef = useRef<Set<string>>(new Set());
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeaheadQueryRef = useRef("");
  const typeaheadPaneRef = useRef<"tree" | "content" | null>(null);
  const actionNoticeReturnFocusPaneRef = useRef<"tree" | "content" | null>(null);
  const lastExplorerFocusPaneRef = useRef<"tree" | "content" | null>(null);
  const activeCopyPasteOperationIdRef = useRef<string | null>(null);
  const nextToastIdRef = useRef(0);
  const copyPasteClipboardRef = useRef<CopyPasteClipboardState>(EMPTY_COPY_PASTE_CLIPBOARD);
  const currentPathRef = useRef(currentPath);
  const isSearchModeRef = useRef(false);
  const selectedPathsInViewOrderRef = useRef<string[]>([]);
  const selectedEntryRef = useRef<DirectoryEntry | null>(null);
  const pendingPasteSelectionRef = useRef<{
    directoryPath: string;
    selectedPaths: string[];
  } | null>(null);
  const panes = useExplorerPaneLayout({
    initialTreeWidth: DEFAULT_APP_PREFERENCES.treeWidth,
    initialInspectorWidth: DEFAULT_APP_PREFERENCES.inspectorWidth,
    inspectorVisible: infoPanelOpen,
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
  const contextMenuTargetEntry = useMemo(
    () =>
      contextMenuState?.targetPath
        ? activeContentEntries.find((entry) => entry.path === contextMenuState.targetPath) ?? null
        : null,
    [activeContentEntries, contextMenuState],
  );
  const pasteDestinationPath = useMemo(
    () =>
      resolvePasteDestinationPath({
        contextMenuState,
        contextMenuTargetEntry,
        currentPath,
        focusedPane,
        isSearchMode,
        selectedEntry,
      }),
    [contextMenuState, contextMenuTargetEntry, currentPath, focusedPane, isSearchMode, selectedEntry],
  );
  const canPasteAtResolvedDestination =
    FEATURE_FLAGS.copyPaste &&
    hasClipboardItems(copyPasteClipboard) &&
    pasteDestinationPath !== null;
  const showCopyPasteProgressCard = isCopyPasteProgressActive(copyPasteProgressEvent);
  const showCopyPasteResultDialog = shouldRenderCopyPasteResultDialog(copyPasteProgressEvent);
  const copyPasteModalOpen = copyPasteDialogState !== null || showCopyPasteResultDialog;
  const contextMenuDisabledActionIds = useMemo(() => {
    if (!contextMenuState) {
      return [] as ContextMenuActionId[];
    }
    const disabled = new Set<ContextMenuActionId>();
    if (!FEATURE_FLAGS.copyPaste) {
      disabled.add("copy");
      disabled.add("cut");
      disabled.add("paste");
    }
    if (!canPasteAtResolvedDestination) {
      disabled.add("paste");
    }
    if (contextMenuTargetEntries.length > 0) {
      return Array.from(disabled);
    }
    const items =
      contextMenuState.source === "search" ? SEARCH_CONTEXT_MENU_ITEMS : BROWSE_CONTEXT_MENU_ITEMS;
    for (const item of items) {
      if (item.type === "separator" || item.id === "newFolder") {
        continue;
      }
      if (item.id !== "paste") {
        disabled.add(item.id);
      }
    }
    return Array.from(disabled);
  }, [
    canPasteAtResolvedDestination,
    contextMenuState,
    contextMenuTargetEntries.length,
    copyPasteClipboard,
  ]);

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
    setContentSelection((current) => {
      const nextSelection = sanitizeContentSelection(current, activeContentEntries);
      syncContentSelectionRefs(nextSelection, activeContentEntries);
      return nextSelection;
    });
  }, [activeContentEntries]);

  useEffect(() => {
    if (isSearchMode) {
      cachedSearchSelectionRef.current = contentSelection;
      return;
    }
    browseSelectionRef.current = contentSelection;
  }, [contentSelection, isSearchMode]);

  useLayoutEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useLayoutEffect(() => {
    isSearchModeRef.current = isSearchMode;
  }, [isSearchMode]);

  useLayoutEffect(() => {
    selectedPathsInViewOrderRef.current = selectedPathsInViewOrder;
  }, [selectedPathsInViewOrder]);

  useLayoutEffect(() => {
    selectedEntryRef.current = selectedEntry;
  }, [selectedEntry]);

  useLayoutEffect(() => {
    copyPasteClipboardRef.current = copyPasteClipboard;
  }, [copyPasteClipboard]);

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
    restoreExplorerPaneFocus();
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
      accent,
      accentToolbarButtons,
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
    accent,
    accentToolbarButtons,
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
        accent,
        accentToolbarButtons,
        zoomPercent,
        uiFontFamily,
        uiFontSize,
        uiFontWeight,
        textPrimaryOverride,
        textSecondaryOverride,
        textMutedOverride,
        viewMode,
        foldersFirst,
        compactListView,
        compactDetailsView,
        compactTreeView,
        detailColumns,
        detailColumnWidths,
        tabSwitchesExplorerPanes,
        typeaheadEnabled,
        typeaheadDebounceMs,
        propertiesOpen: infoPanelOpen,
        detailRowOpen: infoRowOpen,
        terminalApp,
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
    infoPanelOpen,
    infoRowOpen,
    foldersFirst,
    compactListView,
    compactDetailsView,
    compactTreeView,
    detailColumns,
    detailColumnWidths,
    accent,
    accentToolbarButtons,
    zoomPercent,
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
    terminalApp,
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
        setAccent(preferences.accent);
        setAccentToolbarButtons(preferences.accentToolbarButtons);
        setZoomPercent(preferences.zoomPercent);
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
        setCompactDetailsView(preferences.compactDetailsView);
        setCompactTreeView(preferences.compactTreeView);
        setDetailColumns(preferences.detailColumns);
        setDetailColumnWidths(preferences.detailColumnWidths);
        setTabSwitchesExplorerPanes(preferences.tabSwitchesExplorerPanes);
        setTypeaheadEnabled(preferences.typeaheadEnabled);
        setTypeaheadDebounceMs(preferences.typeaheadDebounceMs);
        setInfoPanelOpen(preferences.propertiesOpen);
        setInfoRowOpen(preferences.detailRowOpen);
        setRestoreLastVisitedFolderOnStartup(preferences.restoreLastVisitedFolderOnStartup);
        setTerminalApp(preferences.terminalApp);
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
    if (
      restoredPaneWidths === null ||
      panes.treeWidth !== restoredPaneWidths.treeWidth ||
      panes.inspectorWidth !== restoredPaneWidths.inspectorWidth
    ) {
      return;
    }
    setRestoredPaneWidths(null);
  }, [panes.inspectorWidth, panes.treeWidth, restoredPaneWidths]);

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
      if (command.type === "openInTerminal") {
        const pathsToOpen = resolveOpenInTerminalPaths({
          focusedPane,
          lastFocusedPane: lastExplorerFocusPaneRef.current,
          contextMenuPaths: contextMenuState?.paths ?? [],
          selectedContentPaths: selectedPathsInViewOrder,
          currentPath,
        });
        const firstPath = pathsToOpen[0];
        if (firstPath) {
          void openPathInTerminal(firstPath);
        }
        return;
      }
      if (command.type === "copySelection") {
        void runCopyClipboardAction("copy");
        return;
      }
      if (command.type === "cutSelection") {
        void runCopyClipboardAction("cut");
        return;
      }
      if (command.type === "pasteSelection") {
        void startPasteFromClipboard();
        return;
      }
      if (command.type === "openLocationSheet") {
        openLocationSheet();
        return;
      }
      if (command.type === "openSettings") {
        openSettingsView();
        return;
      }
      if (command.type === "zoomIn") {
        setZoomPercent((value) => clampZoomPercent(value + 10));
        return;
      }
      if (command.type === "zoomOut") {
        setZoomPercent((value) => clampZoomPercent(value - 10));
        return;
      }
      if (command.type === "resetZoom") {
        setZoomPercent(100);
        return;
      }
      if (command.type === "copyPath") {
        const pathsToCopy =
          (contextMenuState?.paths.length ?? 0) > 0
            ? (contextMenuState?.paths ?? [])
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
      if (command.type === "toggleInfoPanel") {
        setInfoPanelOpen((value: boolean) => !value);
        return;
      }
      if (command.type === "toggleInfoRow") {
        setInfoRowOpen((value: boolean) => !value);
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
          applyContentSelection(
            sanitizeContentSelection(cachedSearchSelectionRef.current, searchResultEntries),
            searchResultEntries,
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
    focusedPane,
    isSearchMode,
    searchResultEntries,
    selectedPathsInViewOrder,
  ]);

  useEffect(() => {
    const unsubscribe = client.onCopyPasteProgress((event) => {
      if (event.operationId !== activeCopyPasteOperationIdRef.current) {
        return;
      }
      if (isCopyPasteProgressActive(event)) {
        setCopyPasteProgressEvent(event);
      }
      if (
        event.status === "completed" ||
        event.status === "failed" ||
        event.status === "cancelled" ||
        event.status === "partial"
      ) {
        activeCopyPasteOperationIdRef.current = null;
        if (event.result) {
          queuePasteSelection(event.result);
        }
        if (shouldClearClipboardAfterPasteResult(event)) {
          applyCopyPasteClipboardState(
            clearClipboardAfterSuccessfulPaste(copyPasteClipboardRef.current),
          );
        }
        if (shouldRenderCopyPasteResultDialog(event)) {
          setCopyPasteProgressEvent(event);
        } else {
          setCopyPasteProgressEvent(null);
          pushTerminalCopyPasteToast(event);
        }
        void refreshDirectory();
      }
    });
    return unsubscribe;
  }, [applyCopyPasteClipboardState, client, pushTerminalCopyPasteToast, refreshDirectory]);

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
    const entryIndexByPath = new Map(currentEntries.map((entry, index) => [entry.path, index]));
    const prioritizedPaths = new Set(visiblePaths.filter((path) => entryIndexByPath.has(path)));
    if (visiblePaths.length > 0 && currentEntries.length > visiblePaths.length) {
      const lastVisibleIndex = visiblePaths.reduce((maxIndex, path) => {
        const index = entryIndexByPath.get(path);
        return index === undefined ? maxIndex : Math.max(maxIndex, index);
      }, -1);
      if (lastVisibleIndex >= 0) {
        for (
          let index = lastVisibleIndex + 1;
          index < Math.min(currentEntries.length, lastVisibleIndex + 1 + visiblePaths.length);
          index += 1
        ) {
          const entry = currentEntries[index];
          if (entry) {
            prioritizedPaths.add(entry.path);
          }
        }
      }
    }

    const cachedItems: DirectoryEntryMetadata[] = [];
    const missingPaths: string[] = [];
    for (const path of prioritizedPaths) {
      if (metadataByPath[path]) {
        continue;
      }
      const cached = metadataCacheRef.current.get(path);
      if (cached) {
        cachedItems.push(cached);
        continue;
      }
      if (metadataInflightRef.current.has(path)) {
        continue;
      }
      missingPaths.push(path);
    }

    if (cachedItems.length > 0) {
      setMetadataByPath((current) => {
        const next = { ...current };
        for (const item of cachedItems) {
          next[item.path] = item;
        }
        return next;
      });
    }

    if (missingPaths.length === 0) {
      return;
    }
    for (const path of missingPaths) {
      metadataInflightRef.current.add(path);
    }
    void client
      .invoke("directory:getMetadataBatch", {
        directoryPath: currentPath,
        paths: missingPaths,
      })
      .then((response) => {
        for (const item of response.items) {
          metadataCacheRef.current.set(item.path, item);
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
      })
      .finally(() => {
        for (const path of missingPaths) {
          metadataInflightRef.current.delete(path);
        }
      });
  }, [
    client,
    currentEntries,
    currentPath,
    compactDetailsView,
    directoryLoading,
    isSearchMode,
    metadataByPath,
    viewMode,
    visiblePaths,
  ]);

  useEffect(() => {
    if ((!infoPanelOpen && !infoRowOpen) || currentPath.length === 0) {
      return;
    }
    const targetPath = contentSelection.leadPath || currentPath;
    const requestId = ++getInfoRequestRef.current;
    setGetInfoLoading(true);
    void client
      .invoke("item:getProperties", { path: targetPath })
      .then((response) => {
        if (getInfoRequestRef.current !== requestId) {
          return;
        }
        setGetInfoItem(response.item);
      })
      .catch((error) => {
        if (getInfoRequestRef.current !== requestId) {
          return;
        }
        setGetInfoItem(null);
        logger.error("Info Panel load failed", error);
      })
      .finally(() => {
        if (getInfoRequestRef.current === requestId) {
          setGetInfoLoading(false);
        }
      });
  }, [client, contentSelection.leadPath, currentPath, infoPanelOpen, infoRowOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
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
      if (event.metaKey && event.key === ",") {
        event.preventDefault();
        openSettingsView();
        return;
      }
      if (copyPasteModalOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          handleCopyPasteDialogEscape();
          return;
        }
        if (targetElement?.closest(".copy-paste-dialog")) {
          return;
        }
        event.preventDefault();
        return;
      }
      if (mainView !== "explorer") {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        if (event.key.toLowerCase() === "c") {
          event.preventDefault();
          void runCopyClipboardAction("copy");
          return;
        }
        if (event.key.toLowerCase() === "x") {
          event.preventDefault();
          void runCopyClipboardAction("cut");
          return;
        }
        if (event.key.toLowerCase() === "v") {
          event.preventDefault();
          void startPasteFromClipboard();
          return;
        }
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
      if (
        event.metaKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "g"
      ) {
        event.preventDefault();
        openLocationSheet();
        return;
      }
      if (
        event.metaKey &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === "i"
      ) {
        event.preventDefault();
        setInfoRowOpen((value: boolean) => !value);
        return;
      }
      if (event.metaKey && event.key.toLowerCase() === "i") {
        event.preventDefault();
        setInfoPanelOpen((value: boolean) => !value);
        return;
      }
      if (event.key === "Escape" && focusedPane === "content" && isSearchMode) {
        event.preventDefault();
        hideSearchResults();
        focusContentPane();
        return;
      }
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key.toLowerCase() === "u" || event.key.toLowerCase() === "d")
      ) {
        const didHandle = handlePagedPaneScroll(
          event.key.toLowerCase() === "d" ? "forward" : "backward",
        );
        if (!didHandle) {
          return;
        }
        event.preventDefault();
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
    copyPasteModalOpen,
    copyPasteDialogState,
    copyPasteProgressEvent,
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
    compactDetailsView,
    compactTreeView,
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

  function openLocationSheet() {
    setMainView("explorer");
    setLocationError(null);
    setLocationSheetOpen(true);
  }

  function openSettingsView() {
    setLocationSheetOpen(false);
    setLocationError(null);
    setThemeMenuOpen(false);
    setSearchPopoverOpen(false);
    setMainView("settings");
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

  function restoreExplorerPaneFocus(preferredPane: ExplorerPane | null = null) {
    const targetPane = resolveExplorerPaneRestoreTarget({
      preferredPane,
      lastFocusedPane: lastExplorerFocusPaneRef.current,
      hasTreePane: treePaneRef.current !== null,
      hasContentPane: contentPaneRef.current !== null,
    });
    if (targetPane === "tree") {
      focusTreePane();
      return;
    }
    if (targetPane === "content") {
      focusContentPane();
    }
  }

  function getFocusedScrollTarget(): {
    axis: "horizontal" | "vertical";
    element: HTMLElement;
  } | null {
    // Tree, details, search, and flow-list views each scroll a different inner element.
    // Centralizing that lookup keeps paging shortcuts and selection reveal logic pointed
    // at the same DOM node the user is actually scrolling.
    if (focusedPane === "tree") {
      const element = treePaneRef.current?.querySelector<HTMLElement>(".tree-scroll");
      return element ? { axis: "vertical", element } : null;
    }
    if (focusedPane !== "content") {
      return null;
    }
    if (isSearchMode) {
      const element = contentPaneRef.current?.querySelector<HTMLElement>(".search-results-scroll");
      return element ? { axis: "vertical", element } : null;
    }
    if (viewMode === "details") {
      const element = contentPaneRef.current?.querySelector<HTMLElement>(".details-scroll");
      return element ? { axis: "vertical", element } : null;
    }
    const element = contentPaneRef.current?.querySelector<HTMLElement>(".flow-list");
    return element ? { axis: "horizontal", element } : null;
  }

  function handlePagedPaneScroll(direction: "backward" | "forward") {
    const target = getFocusedScrollTarget();
    if (!target) {
      return false;
    }

    if (focusedPane === "tree") {
      const didScroll = pageScrollElement(target.element, target.axis, direction);
      const orderedPaths = flattenVisibleTreePaths(treeRootPath, treeNodes);
      if (orderedPaths.length === 0) {
        return didScroll;
      }
      // Tree page movement scrolls the viewport and advances selection by roughly one
      // visible page with a single-row overlap, mirroring terminal-style Ctrl+U / Ctrl+D.
      const currentIndex = orderedPaths.findIndex((path) => path === currentPath);
      const stepItems = getPageStepItemCount(
        target.element.clientHeight,
        compactTreeView ? 25 : 32,
      );
      const nextIndex = getPagedSelectionIndex({
        itemCount: orderedPaths.length,
        currentIndex,
        stepItems,
        direction,
      });
      const nextPath = orderedPaths[nextIndex];
      if (nextPath && nextPath !== currentPath) {
        void navigateTo(nextPath, "push");
      }
      return didScroll || nextPath !== undefined;
    }

    if (focusedPane !== "content") {
      return false;
    }

    if (!isSearchMode && viewMode === "list") {
      if (contentSelection.paths.length === 1) {
        const currentIndex = activeContentEntries.findIndex(
          (entry) => entry.path === contentSelection.leadPath,
        );
        if (currentIndex < 0) {
          return false;
        }

        const nextIndex = getPagedSelectionIndex({
          itemCount: activeContentEntries.length,
          currentIndex,
          stepItems: Math.max(1, contentColumns),
          direction,
        });
        const nextEntry = activeContentEntries[nextIndex];
        if (nextEntry && nextEntry.path !== contentSelection.leadPath) {
          setSingleContentSelection(nextEntry.path);
          return true;
        }
        return false;
      }

      // List view pages horizontally by one rendered column because the list layout flows
      // top-to-bottom before creating the next column.
      return scrollElementByAmount(
        target.element,
        "horizontal",
        (direction === "forward" ? 1 : -1) * getFlowListColumnStep(compactListView),
      );
    }

    const didScroll = pageScrollElement(target.element, target.axis, direction);

    if (contentSelection.paths.length === 1) {
      const currentIndex = activeContentEntries.findIndex(
        (entry) => entry.path === contentSelection.leadPath,
      );
      if (currentIndex < 0) {
        return didScroll;
      }

      // Details and search both use vertical row paging. Search must use the shared
      // `SEARCH_RESULT_ROW_HEIGHT` contract so physical scrolling and logical selection
      // movement stay aligned when row density changes.
      const stepItems = getPageStepItemCount(
        target.element.clientHeight,
        isSearchMode ? SEARCH_RESULT_ROW_HEIGHT : getDetailsRowHeight(compactDetailsView),
      );
      const nextIndex = getPagedSelectionIndex({
        itemCount: activeContentEntries.length,
        currentIndex,
        stepItems,
        direction,
      });
      const nextEntry = activeContentEntries[nextIndex];
      if (nextEntry && nextEntry.path !== contentSelection.leadPath) {
        setSingleContentSelection(nextEntry.path);
        return true;
      }
    }

    return didScroll;
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
    applyContentSelection(EMPTY_CONTENT_SELECTION);
  }

  function setSingleContentSelection(path: string) {
    applyContentSelection(createSingleContentSelection(path));
  }

  function toggleContentSelection(path: string) {
    setContentSelection((current) => {
      const nextSelection = toggleSelectionState(current, activeContentEntries, path);
      syncContentSelectionRefs(nextSelection, activeContentEntries);
      return nextSelection;
    });
  }

  function extendContentSelectionToPath(path: string, additive = false) {
    setContentSelection((current) => {
      const nextSelection = extendSelectionStateToPath(
        current,
        activeContentEntries,
        path,
        additive,
      );
      syncContentSelectionRefs(nextSelection, activeContentEntries);
      return nextSelection;
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
    applyContentSelection(selectAllSelectionStateEntries(activeContentEntries));
  }

  function syncContentSelectionRefs(
    selection: ContentSelectionState,
    entries: DirectoryEntry[] = activeContentEntries,
  ) {
    const selectedPaths = entries
      .filter((entry) => selection.paths.includes(entry.path))
      .map((entry) => entry.path);
    selectedPathsInViewOrderRef.current = selectedPaths;
    selectedEntryRef.current =
      entries.find((entry) => entry.path === selection.leadPath) ??
      entries.find((entry) => selectedPaths.includes(entry.path)) ??
      null;
  }

  function applyContentSelection(
    selection: ContentSelectionState,
    entries: DirectoryEntry[] = activeContentEntries,
  ) {
    syncContentSelectionRefs(selection, entries);
    setContentSelection(selection);
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
      targetPath: path,
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
    restoreExplorerPaneFocus(paneToRestore);
  }

  function dismissToast(id: string) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  function pushToast(input: {
    kind: ToastKind;
    title: string;
    message?: string;
  }) {
    const id = `toast-${nextToastIdRef.current}`;
    nextToastIdRef.current += 1;
    setToasts((current) => enqueueToast(current, createToastEntry(id, input)));
  }

  function applyCopyPasteClipboardState(nextClipboard: CopyPasteClipboardState) {
    copyPasteClipboardRef.current = nextClipboard;
    setCopyPasteClipboardState(nextClipboard);
  }

  function pushTerminalCopyPasteToast(event: CopyPasteProgressEvent) {
    const result = event.result;
    if (!result) {
      return;
    }
    if (event.status === "completed") {
      pushToast({
        kind: "success",
        title: `${result.mode === "cut" ? "Moved" : "Pasted"} ${result.summary.topLevelItemCount} item${result.summary.topLevelItemCount === 1 ? "" : "s"} into ${getPathLeafName(result.destinationDirectoryPath)}`,
      });
      return;
    }
    if (event.status === "cancelled") {
      pushToast({
        kind: "info",
        title: result.mode === "cut" ? "Move cancelled" : "Paste cancelled",
      });
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
      pushToast({
        kind: "success",
        title: paths.length === 1 ? "Copied path" : `Copied ${paths.length} paths`,
      });
    } catch (error) {
      logger.error("copy path failed", error);
      pushToast({
        kind: "error",
        title: "Unable to copy the selected path(s)",
      });
    }
  }

  function resolveClipboardSourcePaths(): string[] {
    if (contextMenuState && contextMenuState.paths.length > 0) {
      return contextMenuState.paths;
    }
    if (selectedPathsInViewOrderRef.current.length > 0) {
      return selectedPathsInViewOrderRef.current;
    }
    if (selectedEntryRef.current) {
      return [selectedEntryRef.current.path];
    }
    if (currentPathRef.current.length > 0) {
      return [currentPathRef.current];
    }
    return [];
  }

  async function runCopyClipboardAction(mode: "copy" | "cut") {
    if (!FEATURE_FLAGS.copyPaste) {
      showNotImplementedNotice(mode === "copy" ? "Copy" : "Cut");
      return;
    }
    const paths = resolveClipboardSourcePaths();
    if (paths.length === 0) {
      pushToast({
        kind: "warning",
        title: `Select at least one item to ${mode}.`,
      });
      return;
    }
    applyCopyPasteClipboardState(setCopyPasteClipboard(mode, paths, new Date().toISOString()));
    pushToast({
      kind: mode === "copy" ? "success" : "info",
      title:
        mode === "copy"
          ? paths.length === 1
            ? "Copied 1 item"
            : `Copied ${paths.length} items`
          : paths.length === 1
            ? "Ready to move 1 item"
            : `Ready to move ${paths.length} items`,
    });
    closeContextMenu();
  }

  async function startPasteFromClipboard(
    conflictResolution: IpcRequest<"copyPaste:plan">["conflictResolution"] = "error",
  ) {
    if (!FEATURE_FLAGS.copyPaste) {
      showNotImplementedNotice("Paste");
      return;
    }
    if (activeCopyPasteOperationIdRef.current) {
      pushToast({
        kind: "warning",
        title: "Wait for the current paste to finish",
      });
      return;
    }
    if (pasteDestinationPath === null) {
      pushToast({
        kind: "warning",
        title: "Select a destination folder to paste into",
      });
      return;
    }
    const request = buildPasteRequest(
      copyPasteClipboardRef.current,
      pasteDestinationPath,
      conflictResolution,
    );
    if (!request) {
      pushToast({
        kind: "warning",
        title: "Clipboard is empty",
      });
      return;
    }
    try {
      const plan = await client.invoke("copyPaste:plan", request);
      if (plan.conflicts.length > 0) {
        setCopyPasteDialogState({
          type: "plan",
          plan,
        });
        return;
      }
      if (plan.issues.length > 0) {
        pushToast({
          kind: "error",
          title: plan.issues[0]?.message ?? "Paste cannot continue.",
        });
        return;
      }
      await executePastePlan(plan);
    } catch (error) {
      logger.error("copy paste planning failed", error);
      pushToast({
        kind: "error",
        title: "Unable to prepare paste",
      });
    }
  }

  async function executePastePlan(plan: CopyPastePlan) {
    try {
      const response = await client.invoke("copyPaste:start", {
        mode: plan.mode,
        sourcePaths: plan.sourcePaths,
        destinationDirectoryPath: plan.destinationDirectoryPath,
        conflictResolution: plan.conflictResolution,
      });
      activeCopyPasteOperationIdRef.current = response.operationId;
      setCopyPasteProgressEvent({
        operationId: response.operationId,
        mode: plan.mode,
        status: "queued",
        completedItemCount: 0,
        totalItemCount: plan.summary.totalItemCount,
        completedByteCount: 0,
        totalBytes: plan.summary.totalBytes,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: null,
      });
      setCopyPasteDialogState(null);
      closeContextMenu();
      pushToast({
        kind: "info",
        title:
          plan.mode === "cut"
            ? `Moving into ${getPathLeafName(plan.destinationDirectoryPath)}`
            : `Pasting into ${getPathLeafName(plan.destinationDirectoryPath)}`,
      });
    } catch (error) {
      logger.error("copy paste start failed", error);
      pushToast({
        kind: "error",
        title: "Unable to start paste",
      });
    }
  }

  async function cancelCopyPasteOperation() {
    const operationId = activeCopyPasteOperationIdRef.current;
    if (!operationId) {
      return;
    }
    try {
      await client.invoke("copyPaste:cancel", { operationId });
    } catch (error) {
      logger.error("copy paste cancel failed", error);
      pushToast({
        kind: "error",
        title: "Unable to cancel paste",
      });
    }
  }

  async function retryFailedCopyPasteItems(event: CopyPasteProgressEvent) {
    const result = event.result;
    if (!result) {
      return;
    }
    const failedSourcePaths = result.items
      .filter((item) => item.status === "failed")
      .map((item) => item.sourcePath);
    if (failedSourcePaths.length === 0) {
      dismissCopyPasteDialog();
      return;
    }
    setCopyPasteProgressEvent(null);
    setCopyPasteDialogState(null);
    try {
      const plan = await client.invoke("copyPaste:plan", {
        mode: result.mode,
        sourcePaths: failedSourcePaths,
        destinationDirectoryPath: result.destinationDirectoryPath,
        conflictResolution: "error",
      });
      if (plan.conflicts.length > 0) {
        setCopyPasteDialogState({
          type: "plan",
          plan,
        });
        return;
      }
      if (plan.issues.length > 0) {
        pushToast({
          kind: "error",
          title: plan.issues[0]?.message ?? "Paste cannot continue.",
        });
        return;
      }
      await executePastePlan(plan);
    } catch (error) {
      logger.error("copy paste retry planning failed", error);
      pushToast({
        kind: "error",
        title: "Unable to retry failed items",
      });
    }
  }

  function dismissCopyPasteDialog() {
    setCopyPasteDialogState(null);
    setCopyPasteProgressEvent(null);
    activeCopyPasteOperationIdRef.current = null;
  }

  function handleCopyPasteDialogEscape() {
    if (copyPasteProgressEvent) {
      if (copyPasteProgressEvent.status === "running" || copyPasteProgressEvent.status === "queued") {
        void cancelCopyPasteOperation();
        return;
      }
      dismissCopyPasteDialog();
      return;
    }
    if (copyPasteDialogState) {
      setCopyPasteDialogState(null);
    }
  }

  function queuePasteSelection(result: NonNullable<CopyPasteProgressEvent["result"]>) {
    if (isSearchModeRef.current || currentPathRef.current !== result.destinationDirectoryPath) {
      pendingPasteSelectionRef.current = null;
      return;
    }
    const selectedPaths = result.items
      .filter((item) => item.status === "completed")
      .map((item) => item.destinationPath);
    pendingPasteSelectionRef.current =
      selectedPaths.length > 0
        ? {
            directoryPath: result.destinationDirectoryPath,
            selectedPaths,
          }
        : null;
  }

  async function copyGetInfoPath(path: string): Promise<boolean> {
    try {
      await client.invoke("system:copyText", { text: path });
      return true;
    } catch (error) {
      logger.error("Info Panel copy path failed", error);
      setActionNotice({
        title: "Copy Path",
        message: "Unable to copy this path to the clipboard.",
      });
      return false;
    }
  }

  async function openPathInTerminal(path: string) {
    try {
      const response = await client.invoke("system:openInTerminal", { path });
      if (!response.ok) {
        throw new Error(response.error ?? "Unable to open Terminal for the selected path.");
      }
    } catch (error) {
      logger.error("open in Terminal failed", error);
      setActionNotice({
        title: "Terminal",
        message: "Unable to open Terminal for this location.",
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

  async function activatePathFromContextMenu(path: string) {
    const browseEntry = currentEntries.find((entry) => entry.path === path);
    if (browseEntry) {
      await activateEntry(browseEntry);
      return;
    }

    const searchResult = searchResults.find((result) => result.path === path);
    if (!searchResult) {
      return;
    }

    const entry: DirectoryEntry = {
      path: searchResult.path,
      name: searchResult.name,
      extension: searchResult.extension,
      kind: searchResult.kind,
      isHidden: searchResult.isHidden,
      isSymlink: searchResult.isSymlink,
    };
    await activateEntry(entry);
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
    if (actionId === "copy") {
      await runCopyClipboardAction("copy");
      return;
    }
    if (actionId === "cut") {
      await runCopyClipboardAction("cut");
      return;
    }
    if (actionId === "paste") {
      await startPasteFromClipboard();
      return;
    }
    if (actionId === "open") {
      const firstPath = paths[0];
      if (firstPath) {
        await activatePathFromContextMenu(firstPath);
      }
      return;
    }
    if (actionId === "toggleInfoPanel") {
      setInfoPanelOpen(true);
      return;
    }
    if (actionId === "terminal") {
      const firstPath = paths[0];
      if (firstPath) {
        await openPathInTerminal(firstPath);
      }
      return;
    }
    const title =
      actionId === "move"
          ? "Move To…"
          : actionId === "rename"
            ? "Rename"
            : actionId === "duplicate"
              ? "Duplicate"
              : actionId === "compress"
                ? "Compress"
                : actionId === "newFolder"
                  ? "New Folder"
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
    // Search results can be hidden temporarily while keeping the last result set and its
    // selection around. This lets Cmd+Shift+F reopen the pane without rerunning fd.
    if (!hasCachedSearch) {
      return;
    }
    setSearchResultsVisible(true);
    applyContentSelection(
      sanitizeContentSelection(cachedSearchSelectionRef.current, searchResultEntries),
      searchResultEntries,
    );
    if (options?.focusPane) {
      focusContentPane();
    }
  }

  function hideSearchResults() {
    setSearchResultsVisible(false);
    applyContentSelection(
      sanitizeContentSelection(browseSelectionRef.current, currentEntries),
      currentEntries,
    );
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
    applyContentSelection(
      sanitizeContentSelection(browseSelectionRef.current, currentEntries),
      currentEntries,
    );
  }

  function pollSearch(jobId: string, cursor: number, sessionId: number): void {
    // `sessionId` guards against older async polls mutating state after the user has
    // started a newer search or cleared the current one.
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
    // Starting a search snapshots the current browse selection so hiding the search pane
    // later can restore the pre-search browsing context.
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
    applyContentSelection(EMPTY_CONTENT_SELECTION, searchResultEntries);

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
    // Search option changes re-run the committed search immediately so the pane behaves
    // like a live search session once results already exist.
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
    setSearchResults((current) => sortSearchResults(current, sortBy, sortDirection));
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
    setAccent(DEFAULT_APP_PREFERENCES.accent);
    setZoomPercent(DEFAULT_APP_PREFERENCES.zoomPercent);
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
    // Typeahead is shared across panes, but the accumulated query expires quickly so stale
    // keystrokes do not affect later navigation.
    typeaheadTimeoutRef.current = setTimeout(() => {
      typeaheadTimeoutRef.current = null;
      typeaheadQueryRef.current = "";
      typeaheadPaneRef.current = null;
      setTypeaheadQuery("");
      setTypeaheadPane(null);
    }, typeaheadDebounceMs);
  }

  function handleTypeaheadInput(key: string, pane: "tree" | "content") {
    // The active pane owns the query buffer. Switching panes starts a fresh prefix instead
    // of concatenating unrelated keystrokes across tree/content contexts.
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

  // Tree loading consults `treeNodesRef.current` synchronously inside async flows such as
  // refresh -> navigateTo -> syncTreeToPath -> loadTreeChildren. Updating only React state
  // is not enough there because the ref would still point at the previous tree model until
  // the next render commits, which can make refresh incorrectly treat stale nodes as loaded.
  function replaceTreeNodes(nextNodes: Record<string, TreeNodeState>) {
    treeNodesRef.current = nextNodes;
    setTreeNodes(nextNodes);
  }

  // Same rationale as `replaceTreeNodes`, but for functional updates. The ref and state
  // must advance together so synchronous reads during in-flight async work see the same tree.
  function updateTreeNodes(
    updater: (current: Record<string, TreeNodeState>) => Record<string, TreeNodeState>,
  ) {
    setTreeNodes((current) => {
      const next = updater(current);
      treeNodesRef.current = next;
      return next;
    });
  }

  function initializeTree(path: string) {
    // Tree initialization starts with only the root node. Descendants are loaded lazily
    // as navigation and expansion demand them.
    treeRequestRef.current = {};
    treeRootPathRef.current = path;
    setTreeRootPath(path);
    replaceTreeNodes({
      [path]: createTreeNode(path, true),
    });
  }

  function reinitializeTree(rootPath: string, focusPath: string) {
    // Re-rooting seeds just the ancestor chain to the focused path so the tree can render
    // a meaningful branch immediately before the async child loads complete.
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
    replaceTreeNodes(seededNodes);
  }

  async function navigateTo(
    path: string,
    historyMode: "push" | "replace" | "skip",
    includeHiddenOverride = includeHidden,
    sortByOverride = sortBy,
    sortDirectionOverride = sortDirection,
    foldersFirstOverride = foldersFirst,
  ): Promise<boolean> {
    // `directoryRequestRef` is a monotonic request token so slower snapshots cannot win
    // over a newer navigation and roll the UI back to an older folder.
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
      const cachedMetadata = Object.fromEntries(
        response.entries.flatMap((entry) => {
          const cached = metadataCacheRef.current.get(entry.path);
          return cached ? [[entry.path, cached] as const] : [];
        }),
      );
      // Keep only metadata for currently visible entries; metadata is cheap to rehydrate
      // and pruning here prevents unbounded growth as the user navigates.
      metadataCacheRef.current = new Map(Object.entries(cachedMetadata));
      metadataInflightRef.current.clear();
      setCurrentPath(response.path);
      setCurrentEntries(response.entries);
      setVisiblePaths([]);
      setMetadataByPath(cachedMetadata);
      if (searchResultsVisibleRef.current) {
        setSearchResultsVisible(false);
      }
      const pendingPasteSelection =
        pendingPasteSelectionRef.current?.directoryPath === response.path
          ? pendingPasteSelectionRef.current
          : null;
      if (pendingPasteSelection) {
        pendingPasteSelectionRef.current = null;
      }
      const selectedPastePaths = pendingPasteSelection
        ? response.entries
            .filter((entry) => pendingPasteSelection.selectedPaths.includes(entry.path))
            .map((entry) => entry.path)
        : [];
      applyContentSelection(
        selectedPastePaths.length > 0
          ? {
              paths: selectedPastePaths,
              anchorPath: selectedPastePaths[0] ?? null,
              leadPath: selectedPastePaths.at(-1) ?? null,
            }
          : response.entries[0]
            ? createSingleContentSelection(response.entries[0].path)
            : EMPTY_CONTENT_SELECTION,
        response.entries,
      );
      setGetInfoItem(null);
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
    updateTreeNodes((current) => {
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
    // Tree loading must account for the case where hidden files are globally disabled but
    // the active path still lives under a hidden child. In that case we keep just the
    // active hidden branch visible so navigation remains coherent.
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
        updateTreeNodes((current) => ({
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

    // Use the ref-synced helper here as well; otherwise a refresh can seed a new tree,
    // then immediately overwrite it with loading state derived from the pre-refresh tree.
    updateTreeNodes((current) => ({
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
      // Ignore stale responses for the same node if a newer request was started.
      if (treeRequestRef.current[path] !== requestId) {
        return;
      }
      updateTreeNodes((current) => {
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
      updateTreeNodes((current) => ({
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
    // If navigation escapes the current tree root, the tree is re-rooted to the new path
    // and then expanded along the ancestor chain needed to reveal the active location.
    const currentRootPath = treeRootPathRef.current;
    const nextRootPath =
      currentRootPath.length === 0 || !isPathWithinRoot(path, currentRootPath)
        ? path
        : currentRootPath;

    if (nextRootPath !== currentRootPath) {
      treeRequestRef.current = {};
      treeRootPathRef.current = nextRootPath;
      setTreeRootPath(nextRootPath);
      replaceTreeNodes({
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
    // Hidden mode can be forced per request when a hidden descendant must remain visible
    // to represent the current path in the tree.
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
    updateTreeNodes((current) => ({
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
    // Refresh clears only main-process caches; the next navigation repopulates renderer
    // metadata caches from the freshly fetched snapshot.
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
                          <button
                            type="button"
                            className={
                              searchRecursive ? "toolbar-search-pill active" : "toolbar-search-pill"
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
                      <div className="toolbar-search-meta">
                        <span className="toolbar-search-status">Press Enter to search</span>
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
                  infoPanelOpen
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
                onOpenLocation={openLocationSheet}
                onQuickAccess={goQuickAccess}
                foldersFirst={foldersFirst}
                onToggleFoldersFirst={toggleFoldersFirst}
                infoPanelOpen={infoPanelOpen}
                onToggleInfoPanel={() => setInfoPanelOpen((value) => !value)}
                infoRowOpen={infoRowOpen}
                onToggleInfoRow={() => setInfoRowOpen((value) => !value)}
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
                onOpenSettings={openSettingsView}
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
                    onTypeaheadInput={(key) => handleTypeaheadInput(key, "content")}
                    typeaheadQuery={focusedPane === "content" ? typeaheadQuery : ""}
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
                    onTypeaheadInput={(key) => handleTypeaheadInput(key, "content")}
                    onItemContextMenu={(path, position) => {
                      openItemContextMenu(path, position, "browse");
                    }}
                    compactListView={compactListView}
                    compactDetailsView={compactDetailsView}
                    detailColumns={detailColumns}
                    detailColumnWidths={detailColumnWidths}
                    onDetailColumnWidthsChange={setDetailColumnWidths}
                    tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
                    searchQuery=""
                    typeaheadQuery={focusedPane === "content" ? typeaheadQuery : ""}
                  />
                )}
                <InfoRow
                  open={infoRowOpen}
                  currentPath={currentPath}
                  currentEntries={currentEntries}
                  selectedEntry={selectedEntry}
                  item={getInfoItem}
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
              {infoPanelOpen ? (
                <>
                  <div
                    className="pane-resizer"
                    onPointerDown={panes.beginResize("inspector")}
                    role="separator"
                    tabIndex={0}
                    aria-orientation="vertical"
                    aria-label="Resize Info Panel pane"
                    onKeyDown={(event) => handlePaneResizeKey("inspector", event)}
                  />
                  <InfoPanel
                    open={infoPanelOpen}
                    loading={getInfoLoading}
                    item={getInfoItem}
                    onClose={() => setInfoPanelOpen(false)}
                    onNavigateToPath={(path) => {
                      void navigateTo(path, path === currentPath ? "replace" : "push");
                    }}
                    onOpen={() => {
                      if (getInfoItem) {
                        void openExternally(getInfoItem.path);
                      }
                    }}
                    onOpenInTerminal={() => {
                      if (getInfoItem) {
                        void openPathInTerminal(getInfoItem.path);
                      }
                    }}
                    onCopyPath={() => (getInfoItem ? copyGetInfoPath(getInfoItem.path) : false)}
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
                theme={theme}
                accent={accent}
              />
            ) : (
              <SettingsView
                theme={theme}
                accent={accent}
                accentToolbarButtons={accentToolbarButtons}
                zoomPercent={zoomPercent}
                uiFontFamily={uiFontFamily}
                uiFontSize={uiFontSize}
                uiFontWeight={uiFontWeight}
                effectiveTextPrimaryColor={effectiveThemeColors.primary}
                effectiveTextSecondaryColor={effectiveThemeColors.secondary}
                effectiveTextMutedColor={effectiveThemeColors.muted}
                compactListView={compactListView}
                compactDetailsView={compactDetailsView}
                compactTreeView={compactTreeView}
                detailColumns={detailColumns}
                layoutMode={singlePanelLayout}
                tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
                typeaheadEnabled={typeaheadEnabled}
                typeaheadDebounceMs={typeaheadDebounceMs}
                restoreLastVisitedFolderOnStartup={restoreLastVisitedFolderOnStartup}
                terminalApp={terminalApp}
                themeOptions={[...THEME_OPTIONS]}
                accentOptions={[...ACCENT_OPTIONS]}
                uiFontOptions={[...UI_FONT_OPTIONS]}
                uiFontSizeOptions={[...UI_FONT_SIZE_OPTIONS]}
                uiFontWeightOptions={[...UI_FONT_WEIGHT_OPTIONS]}
                typeaheadDebounceOptions={[...TYPEAHEAD_DEBOUNCE_OPTIONS]}
                onThemeChange={setTheme}
                onAccentChange={setAccent}
                onAccentToolbarButtonsChange={setAccentToolbarButtons}
                onZoomPercentChange={setZoomPercent}
                onUiFontFamilyChange={setUiFontFamily}
                onUiFontSizeChange={setUiFontSize}
                onUiFontWeightChange={setUiFontWeight}
                onTextPrimaryColorChange={setTextPrimaryOverride}
                onTextSecondaryColorChange={setTextSecondaryOverride}
                onTextMutedColorChange={setTextMutedOverride}
                onResetAppearance={resetAppearanceSettings}
                onCompactListViewChange={setCompactListView}
                onCompactDetailsViewChange={setCompactDetailsView}
                onCompactTreeViewChange={setCompactTreeView}
                onDetailColumnsChange={setDetailColumns}
                onTabSwitchesExplorerPanesChange={setTabSwitchesExplorerPanes}
                onTypeaheadEnabledChange={setTypeaheadEnabled}
                onTypeaheadDebounceMsChange={setTypeaheadDebounceMs}
                onRestoreLastVisitedFolderOnStartupChange={setRestoreLastVisitedFolderOnStartup}
                onTerminalAppChange={setTerminalApp}
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
      {copyPasteDialogState?.type === "plan" ? (
        <CopyPasteDialog
          title="Paste Requires Review"
          message="Some destination items already exist. You can skip those conflicts or cancel."
          detailLines={buildCopyPastePlanDetailLines(copyPasteDialogState.plan)}
          primaryAction={
            {
              label: "Skip Conflicts",
              onClick: () =>
                void executePastePlan({
                  ...copyPasteDialogState.plan,
                  conflictResolution: "skip",
                }),
              destructive: copyPasteDialogState.plan.mode === "cut",
            }
          }
          secondaryAction={
            {
              label: "Cancel",
              onClick: () => setCopyPasteDialogState(null),
            }
          }
        />
      ) : null}
      {showCopyPasteProgressCard && copyPasteProgressEvent ? (
        <CopyPasteProgressCard
          title={copyPasteProgressEvent.mode === "cut" ? "Cut/Paste In Progress" : "Paste In Progress"}
          message={
            copyPasteProgressEvent.status === "queued"
              ? "The copy/paste operation is queued."
              : "File Trail is writing to disk through the protected copy/paste pipeline."
          }
          progressLabel={`${copyPasteProgressEvent.completedItemCount} / ${copyPasteProgressEvent.totalItemCount} steps`}
          detailLines={[
            copyPasteProgressEvent.currentSourcePath
              ? `Current source: ${copyPasteProgressEvent.currentSourcePath}`
              : "Waiting for the next filesystem step.",
          ]}
          onCancel={() => {
            void cancelCopyPasteOperation();
          }}
        />
      ) : null}
      {showCopyPasteResultDialog && copyPasteProgressEvent ? (
        <CopyPasteDialog
          title="Paste Result"
          message={
            copyPasteProgressEvent.result?.error ??
            "The copy/paste operation has finished."
          }
          detailLines={buildCopyPasteResultDetailLines(copyPasteProgressEvent)}
          primaryAction={
            copyPasteProgressEvent.result?.items.some((item) => item.status === "failed")
              ? {
                  label: "Retry Failed Items",
                  onClick: () => {
                    void retryFailedCopyPasteItems(copyPasteProgressEvent);
                  },
                }
              : {
                  label: "Close",
                  onClick: dismissCopyPasteDialog,
                }
          }
          secondaryAction={
            copyPasteProgressEvent.result?.items.some((item) => item.status === "failed")
              ? {
                  label: "Close",
                  onClick: dismissCopyPasteDialog,
                }
              : undefined
          }
        />
      ) : null}
      <ToastViewport toasts={toasts} onDismiss={dismissToast} offsetBottom={showCopyPasteProgressCard ? 176 : 16} />
    </main>
  );
}

function formatPathForShell(path: string): string {
  if (!/\s/.test(path)) {
    return path;
  }
  return `'${path.replaceAll("'", "'\\''")}'`;
}

function getPathLeafName(path: string): string {
  const trimmedPath = path.replace(/\/+$/u, "");
  return trimmedPath.split("/").filter(Boolean).at(-1) ?? path;
}

function isCopyPasteProgressActive(event: CopyPasteProgressEvent | null): boolean {
  return event?.status === "queued" || event?.status === "running";
}

function shouldRenderCopyPasteResultDialog(event: CopyPasteProgressEvent | null): boolean {
  if (!event || !event.result) {
    return false;
  }
  if (event.status === "failed" || event.status === "partial") {
    return true;
  }
  if (event.status !== "cancelled") {
    return false;
  }
  return (
    event.result.summary.completedItemCount > 0 ||
    event.result.summary.failedItemCount > 0 ||
    event.result.summary.skippedItemCount > 0
  );
}

function buildCopyPastePlanDetailLines(plan: CopyPastePlan): string[] {
  const lines = [
    `${plan.summary.topLevelItemCount} selected item${plan.summary.topLevelItemCount === 1 ? "" : "s"}`,
    `${plan.summary.totalItemCount} filesystem write step${plan.summary.totalItemCount === 1 ? "" : "s"}`,
  ];
  if (plan.summary.totalBytes !== null) {
    lines.push(`${formatSize(plan.summary.totalBytes, "ready")}`);
  }
  if (plan.conflicts.length > 0) {
    lines.push(`${plan.conflicts.length} conflicting destination item${plan.conflicts.length === 1 ? "" : "s"}`);
  }
  for (const issue of plan.issues.slice(0, 3)) {
    lines.push(issue.message);
  }
  return lines;
}

function buildCopyPasteResultDetailLines(event: CopyPasteProgressEvent): string[] {
  const result = event.result;
  if (!result) {
    return [];
  }
  const lines = [
    `${result.summary.completedItemCount} of ${result.summary.totalItemCount} steps completed`,
  ];
  if (result.summary.failedItemCount > 0) {
    lines.push(`${result.summary.failedItemCount} item${result.summary.failedItemCount === 1 ? "" : "s"} failed`);
  }
  if (result.summary.skippedItemCount > 0) {
    lines.push(`${result.summary.skippedItemCount} item${result.summary.skippedItemCount === 1 ? "" : "s"} skipped`);
  }
  if (result.summary.cancelledItemCount > 0) {
    lines.push(
      `${result.summary.cancelledItemCount} item${result.summary.cancelledItemCount === 1 ? "" : "s"} cancelled`,
    );
  }
  for (const item of result.items.filter((entry) => entry.error).slice(0, 3)) {
    lines.push(item.error ?? "");
  }
  return lines;
}

function shouldClearClipboardAfterPasteResult(event: CopyPasteProgressEvent): boolean {
  const result = event.result;
  if (!result) {
    return false;
  }
  if (result.mode === "cut") {
    return true;
  }
  return result.status === "completed" || result.status === "partial";
}

function resolvePasteDestinationPath(args: {
  contextMenuState: ContextMenuState | null;
  contextMenuTargetEntry: DirectoryEntry | null;
  currentPath: string;
  focusedPane: "tree" | "content" | null;
  isSearchMode: boolean;
  selectedEntry: DirectoryEntry | null;
}): string | null {
  const {
    contextMenuState,
    contextMenuTargetEntry,
    currentPath,
    focusedPane,
    isSearchMode,
    selectedEntry,
  } = args;
  if (isSearchMode) {
    return null;
  }
  if (contextMenuState) {
    if (isDirectoryLikeEntry(contextMenuTargetEntry)) {
      return contextMenuTargetEntry.path;
    }
    return currentPath.length > 0 ? currentPath : null;
  }
  if (focusedPane === "tree") {
    return currentPath.length > 0 ? currentPath : null;
  }
  if (focusedPane === "content" && isDirectoryLikeEntry(selectedEntry)) {
    return selectedEntry.path;
  }
  return currentPath.length > 0 ? currentPath : null;
}

function isDirectoryLikeEntry(entry: DirectoryEntry | null): entry is DirectoryEntry {
  return entry?.kind === "directory" || entry?.kind === "symlink_directory";
}

function InfoRow({
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
    return <div className={`info-row${open ? " open" : ""}`} />;
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
    <div className={`info-row${open ? " open" : ""}`}>
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
