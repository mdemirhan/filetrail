import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { IpcRequest, IpcResponse, WriteOperationProgressEvent } from "@filetrail/contracts";

import {
  type AppPreferences,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TERMINAL_APPLICATION,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  clampOpenItemLimit,
  clampZoomPercent,
  themeChoicePatch,
} from "../shared/appPreferences";
import { resolveShortcuts } from "../shared/shortcuts";
import { DEFAULT_TOP_TOOLBAR_ITEMS } from "../shared/toolbarItems";
import { type VisitedFolder, forgetVisitedFolder } from "../shared/visitedFolders";
import { AppDialogs } from "./components/AppDialogs";
import { ClipboardButton } from "./components/ClipboardButton";
import { ExplorerWorkspace } from "./components/ExplorerWorkspace";
import { HelpView } from "./components/HelpView";
import { InfoRow } from "./components/InfoRow";
import type { SettingsTab } from "./components/SettingsView";
import { TabStrip } from "./components/TabStrip";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { applyPreferencesPatch, useAppPreferences } from "./hooks/useAppPreferences";
import { useElementSize } from "./hooks/useElementSize";
import { useExplorerActions } from "./hooks/useExplorerActions";
import { useExplorerDragAndDrop } from "./hooks/useExplorerDragAndDrop";
import { useExplorerNavigation } from "./hooks/useExplorerNavigation";
import { useExplorerNavigationController } from "./hooks/useExplorerNavigationController";
import { useExplorerPaneLayout } from "./hooks/useExplorerPaneLayout";
import { useExplorerSearchController } from "./hooks/useExplorerSearchController";
import { useExplorerShortcuts } from "./hooks/useExplorerShortcuts";
import { useExplorerTabs } from "./hooks/useExplorerTabs";
import { useFolderSizeCache } from "./hooks/useFolderSizeCache";
import { usePreferencesSync } from "./hooks/usePreferencesSync";
import { useSearchSession } from "./hooks/useSearchSession";
import { useWriteOperations } from "./hooks/useWriteOperations";
import { buildApplicationMenuState } from "./lib/applicationMenuState";
import {
  CLIPBOARD_FLASH_MS,
  type ClipboardMarksBySurface,
  ClipboardMarksProvider,
} from "./lib/clipboardMarks";
import {
  type ContentSelectionState,
  setSingleContentSelection as createSingleContentSelection,
} from "./lib/contentSelection";
import { buildPasteRequest, describeClipboard } from "./lib/copyPasteClipboard";
import {
  createOpenItemLimitMessage,
  formatPathForShell,
  getPathLeafName,
  isDirectoryLikeEntry,
  isEditableFileEntry,
  isFolderSizeEligibleKind,
  resolveNewFolderTargetPath,
  resolvePasteDestinationPath,
  resolveWriteOperationSelectionDirectoryPath,
  shouldRenderCopyPasteResultDialog,
  sortEntriesBySize,
  toDirectoryEntryFromSearchResult,
} from "./lib/explorerAppUtils";
import { parentDirectoryPath } from "./lib/explorerNavigation";
import { getFolderDisplayName } from "./lib/explorerTabs";
import type { DirectoryEntry, DirectoryEntryMetadata } from "./lib/explorerTypes";
import {
  createFavoriteItemId,
  createFileSystemItemId,
  getDefaultFavorites,
  getFavoriteItemPath,
  getFavoritesRootItemId,
  getFileSystemItemPath,
  getTrashPath,
  isFavoritePath,
  isFavoritesRootItemId,
} from "./lib/favorites";
import { FileIcon, preloadGenericIcons } from "./lib/fileIcons";
import { useFiletrailClient } from "./lib/filetrailClient";
import { formatDateTime, formatPermissionMode, formatSize } from "./lib/formatting";
import type { HelpTopicId } from "./lib/helpContent";
import { getBackHistoryEntries, getForwardHistoryEntries } from "./lib/historyMenu";
import { resolveInfoItem } from "./lib/infoPreview";
import { EXPLORER_LAYOUT } from "./lib/layoutTokens";
import { filterEntriesByName } from "./lib/listFilter";
import { createRendererLogger } from "./lib/logging";
import { expandHomeShortcut } from "./lib/pathUtils";
import { buildPlaces } from "./lib/places";
import {
  canRunToolbarRendererCommand,
  resolveFavoriteTargetPath,
} from "./lib/rendererCommandAvailability";
import { resolveSinglePanelLayout } from "./lib/responsiveLayout";
import { formatSearchStatus } from "./lib/searchResults";
import { createShortcutDisplay } from "./lib/shortcutDisplay";
import type { canHandleRendererCommand } from "./lib/shortcutPolicy";
import { resolveStartupTabs } from "./lib/startupNavigation";
import { buildContentStatusSummary } from "./lib/statusSummary";
import { type ToastEntry, type ToastKind, createToastEntry, enqueueToast } from "./lib/toasts";
import { ExplorerStoreProvider } from "./state/explorerStoreContext";
import { useExplorerServices, useSelectionActions } from "./state/explorerStores";
import { ShortcutDisplayProvider } from "./state/shortcutDisplayContext";

const logger = createRendererLogger("filetrail.renderer");

type PreferencesPersistPayload = IpcRequest<"app:updatePreferences">["preferences"];

export function App() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const client = useFiletrailClient();
  const folderSizeCache = useFolderSizeCache(client);
  // The plain folder and document icons, asked for before the first folder is drawn.
  useEffect(() => {
    preloadGenericIcons(client);
  }, [client]);
  // The folders that have been opened, loaded each time the Go To or Move To box opens.
  const [visitedFolders, setVisitedFolders] = useState<VisitedFolder[]>([]);
  const [volumeAvailableBytes, setVolumeAvailableBytes] = useState<number | null>(null);
  // The Help topic asked for last; `id` changes with each request so an open Help page
  // moves to the topic.
  const [helpRequest, setHelpRequest] = useState<{ topic: HelpTopicId; id: number }>({
    topic: "navigation",
    id: 0,
  });
  // Modified date and size for search results, fetched for the rows on screen.
  const [searchMetadataByPath, setSearchMetadataByPath] = useState<
    Record<string, DirectoryEntryMetadata>
  >({});
  const searchMetadataRequestedRef = useRef(new Set<string>());
  const preferences = useAppPreferences();
  const navigation = useExplorerNavigation();
  const search = useSearchSession();
  const writeOperations = useWriteOperations();
  const {
    preferencesReady,
    setPreferencesReady,
    theme,
    setTheme,
    autoLightTheme,
    setAutoLightTheme,
    autoDarkTheme,
    setAutoDarkTheme,
    effectiveTheme,
    accent,
    setAccent,
    zoomPercent,
    setZoomPercent,
    uiFontFamily,
    setUiFontFamily,
    tabStyle,
    setTabStyle,
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
    highlightHoveredItems,
    setHighlightHoveredItems,
    detailColumns,
    setDetailColumns,
    detailColumnWidths,
    setDetailColumnWidths,
    notificationsEnabled,
    setNotificationsEnabled,
    notificationDurationSeconds,
    setNotificationDurationSeconds,
    highlightClipboardItemsInTree,
    setHighlightClipboardItemsInTree,
    highlightClipboardItemsInContent,
    setHighlightClipboardItemsInContent,
    notifyClipboardItems,
    setNotifyClipboardItems,
    topToolbarItems,
    setTopToolbarItems,
    restoreLastVisitedFolderOnStartup,
    setRestoreLastVisitedFolderOnStartup,
    restoreOpenTabsOnStartup,
    setRestoreOpenTabsOnStartup,
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
  } = preferences;
  // The keys every command has (Settings → Shortcuts), and how they are shown.
  const shortcuts = useMemo(() => resolveShortcuts(shortcutOverrides), [shortcutOverrides]);
  const shortcutDisplay = useMemo(
    () => createShortcutDisplay(shortcuts, { returnKeyAction }),
    [shortcuts, returnKeyAction],
  );
  const {
    mainView,
    setMainView,
    treeRootPath,
    setTreeRootPath,
    homePath,
    setHomePath,
    treeNodes,
    setTreeNodes,
    selectedTreeItemId,
    setSelectedTreeItemId,
    currentPath,
    setCurrentPath,
    currentEntries,
    setCurrentEntries,
    metadataByPath,
    setMetadataByPath,
    directoryLoading,
    setDirectoryLoading,
    directoryError,
    setDirectoryError,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    contentSelection,
    setContentSelection,
    historyPaths,
    setHistoryPaths,
    historyIndex,
    setHistoryIndex,
    visiblePaths,
    setVisiblePaths,
    contentColumns,
    setContentColumns,
    getInfoLoading,
    setGetInfoLoading,
    getInfoItem,
    setGetInfoItem,
    locationSheetOpen,
    setLocationSheetOpen,
    locationSubmitting,
    setLocationSubmitting,
    locationError,
    setLocationError,
    focusedPane,
    setFocusedPane,
    leftPaneSubview,
    setLeftPaneSubview,
    listFilterQuery,
    typeaheadQuery,
    setTypeaheadQuery,
    typeaheadPane,
    setTypeaheadPane,
    infoTargetPathOverride,
    setInfoTargetPathOverride,
    infoPanelOpen,
    setInfoPanelOpen,
    infoRowOpen,
    setInfoRowOpen,
    restoredPaneWidths,
    setRestoredPaneWidths,
    directoryRequestRef,
    getInfoRequestRef,
    treeRequestRef,
    treeNodesRef,
    selectedTreeItemIdRef,
    treeRootPathRef,
    metadataCacheRef,
    metadataInflightRef,
    currentPathRef,
    isSearchModeRef,
    activeContentEntriesRef,
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
    leftPaneSubviewRef,
    lastLeftPaneSubviewRef,
  } = navigation;
  const {
    searchDraftQuery,
    setSearchDraftQuery,
    searchCommittedQuery,
    setSearchCommittedQuery,
    searchRootPath,
    setSearchRootPath,
    searchPatternMode,
    setSearchPatternMode,
    searchMatchScope,
    setSearchMatchScope,
    searchRecursive,
    setSearchRecursive,
    searchSkipGitFolders,
    setSearchSkipGitFolders,
    searchSkipGitIgnored,
    setSearchSkipGitIgnored,
    searchResultsSortBy,
    setSearchResultsSortBy,
    searchResultsSortDirection,
    setSearchResultsSortDirection,
    searchPopoverOpen,
    setSearchPopoverOpen,
    searchResultsVisible,
    setSearchResultsVisible,
    searchResults,
    setSearchResults,
    searchResultsScrollTop,
    setSearchResultsScrollTop,
    searchStatus,
    setSearchStatus,
    searchError,
    setSearchError,
    searchStartedLive,
    searchTruncated,
    searchElapsedMs,
    setSearchTruncated,
    searchPollTimeoutRef,
    searchSessionRef,
    searchJobIdRef,
    searchPointerIntentRef,
    searchCommittedQueryRef,
    searchResultsVisibleRef,
    searchResultsSortByRef,
    searchResultsSortDirectionRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
  } = search;
  const {
    contextMenuState,
    setContextMenuState,
    actionNotice,
    setActionNotice,
    toasts,
    setToasts,
    copyPasteClipboard,
    setCopyPasteClipboardState,
    copyPasteDialogState,
    setCopyPasteDialogState,
    writeOperationCardState,
    setWriteOperationCardState,
    writeOperationProgressEvent,
    setWriteOperationProgressEvent,
    renameDialogState,
    setRenameDialogState,
    newFolderDialogState,
    setNewFolderDialogState,
    moveDialogState,
    setMoveDialogState,
    actionNoticeReturnFocusPaneRef,
    activeWriteOperationIdRef,
    nextPasteAttemptIdRef,
    pendingPasteAttemptRef,
    nextToastIdRef,
    copyPasteClipboardRef,
    writeOperationLockedRef,
    pendingPasteSelectionRef,
    pendingTreeSelectionPathRef,
  } = writeOperations;
  const treePaneRef = useRef<HTMLElement | null>(null);
  const contentPaneRef = useRef<HTMLElement | null>(null);
  const singlePanelRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeaheadQueryRef = useRef("");
  const typeaheadPaneRef = useRef<"tree" | "content" | null>(null);
  const panes = useExplorerPaneLayout({
    initialTreeWidth: DEFAULT_APP_PREFERENCES.treeWidth,
    initialInspectorWidth: DEFAULT_APP_PREFERENCES.inspectorWidth,
    inspectorVisible: infoPanelOpen,
    minContentWidth: EXPLORER_LAYOUT.minContentWidth,
  });
  const { width: singlePanelWidth } = useElementSize(singlePanelRef);
  const services = useExplorerServices({
    client,
    panes,
    treePaneRef,
    contentPaneRef,
    searchInputRef,
    searchShellRef,
    typeaheadTimeoutRef,
    typeaheadQueryRef,
    typeaheadPaneRef,
  });
  const selectionActions = useSelectionActions({ navigation, services });
  const {
    detachSearchSession,
    attachSearchSession,
    createEmptySearchSession,
    rerunSearch,
    changeSearchRoot,
    sortSearchResultsByColumn,
    clearCommittedSearch,
    dismissFileSearch,
    filteredSearchResults,
    hasCachedSearch,
    hideSearchResults,
    isSearchMode,
    searchResultEntries,
    allSearchResultEntries,
    filterSearchResultEntries,
    showCachedSearchResults,
    startSearch,
    stopSearch,
    submitSearch,
    abandonSearchDraft,
    updateSearchDraftQuery,
    toggleSearchResultsSortDirection,
    updateSearchMatchScope,
    updateSearchPatternMode,
    updateSearchRecursive,
    updateSearchSkipGitFolders,
    updateSearchSkipGitIgnored,
    updateSearchResultsSortBy,
  } = useExplorerSearchController({
    services,
    navigation,
    search,
    selection: selectionActions,
    includeHidden,
  });
  // Folder sizes are learned after the listing arrives, so the size order is completed
  // here and updated as each folder size comes in.
  const folderSizeVersion = folderSizeCache.version;
  const getFolderSizeEntry = folderSizeCache.getEntry;
  // biome-ignore lint/correctness/useExhaustiveDependencies: folderSizeVersion changes whenever a cached folder size does; getEntry reads that cache.
  const browseEntries = useMemo(() => {
    if (sortBy !== "size") {
      return currentEntries;
    }
    return sortEntriesBySize(currentEntries, {
      sortDirection,
      foldersFirst,
      getFolderSizeBytes: (path) => {
        const entry = getFolderSizeEntry(path);
        return entry.status === "ready" ? entry.sizeBytes : null;
      },
    });
  }, [currentEntries, sortBy, sortDirection, foldersFirst, getFolderSizeEntry, folderSizeVersion]);
  // While the list is sorted by size, the Details view draws a bar behind each size: the
  // item's share of the largest size in the folder. Files have their size from the listing;
  // a folder gets a bar once its size has been calculated (Calculate Size on the folder it
  // is in sizes every folder inside).
  // biome-ignore lint/correctness/useExhaustiveDependencies: folderSizeVersion changes whenever a cached folder size does; getEntry reads that cache.
  const sizeBars = useMemo(() => {
    if (sortBy !== "size") {
      return null;
    }
    const getSizeBytes = (entry: DirectoryEntry) => {
      if (!isFolderSizeEligibleKind(entry.kind)) {
        return entry.sizeBytes ?? null;
      }
      const folderSize = getFolderSizeEntry(entry.path);
      return folderSize.status === "ready" ? folderSize.sizeBytes : null;
    };
    let maxBytes = 0;
    for (const entry of currentEntries) {
      maxBytes = Math.max(maxBytes, getSizeBytes(entry) ?? 0);
    }
    return maxBytes > 0 ? { maxBytes, getSizeBytes } : null;
  }, [currentEntries, sortBy, getFolderSizeEntry, folderSizeVersion]);
  // The info panel shows the selected item, or the folder on screen when nothing is
  // selected, updating in place from what the list knows until its details arrive.
  const infoPanelTargetPath = currentPath
    ? (infoTargetPathOverride ?? contentSelection.leadPath ?? currentPath)
    : null;
  const infoPanelView = useMemo(
    () =>
      resolveInfoItem({
        path: infoPanelTargetPath,
        currentPath,
        entries: isSearchMode ? searchResultEntries : browseEntries,
        metadataByPath,
        properties: getInfoItem,
      }),
    [
      browseEntries,
      currentPath,
      getInfoItem,
      infoPanelTargetPath,
      isSearchMode,
      metadataByPath,
      searchResultEntries,
    ],
  );
  // Typing in the list narrows it by name; the search results are narrowed in their
  // controller the same way.
  const visibleBrowseEntries = useMemo(
    () => filterEntriesByName(browseEntries, listFilterQuery),
    [browseEntries, listFilterQuery],
  );
  const activeContentEntries = useMemo(
    () => (isSearchMode ? searchResultEntries : visibleBrowseEntries),
    [isSearchMode, searchResultEntries, visibleBrowseEntries],
  );
  const unfilteredContentEntries = isSearchMode ? allSearchResultEntries : browseEntries;
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
  // Keep the shadow refs in sync with the memos above; callbacks that need the
  // freshest values within the same tick (selection actions, shortcut handlers)
  // read these refs instead of re-deriving the same state.
  useLayoutEffect(() => {
    activeContentEntriesRef.current = activeContentEntries;
  }, [activeContentEntries, activeContentEntriesRef]);
  useLayoutEffect(() => {
    selectedPathsInViewOrderRef.current = selectedPathsInViewOrder;
    selectedEntryRef.current = selectedEntry;
  }, [selectedEntry, selectedEntryRef, selectedPathsInViewOrder, selectedPathsInViewOrderRef]);
  const contextMenuTargetEntries = useMemo(
    // Content-menu target entries are resolved from the visible content listing only.
    // Tree and favorite menus intentionally do not rely on this memo.
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
        ? (activeContentEntries.find((entry) => entry.path === contextMenuState.targetPath) ?? null)
        : null,
    [activeContentEntries, contextMenuState],
  );
  const selectedTreeTargetPath = useMemo(
    () => getFavoriteItemPath(selectedTreeItemId) ?? getFileSystemItemPath(selectedTreeItemId),
    [selectedTreeItemId],
  );
  const selectedTreeTargetKind = useMemo(() => {
    if (isFavoritesRootItemId(selectedTreeItemId)) {
      return "favoritesRoot" as const;
    }
    if (getFavoriteItemPath(selectedTreeItemId)) {
      return "favorite" as const;
    }
    if (getFileSystemItemPath(selectedTreeItemId)) {
      return "filesystemFolder" as const;
    }
    return null;
  }, [selectedTreeItemId]);
  const clipboardSourcePaths = useMemo(() => {
    if (copyPasteClipboard.type !== "ready" || copyPasteClipboard.sourcePaths.length === 0) {
      return [];
    }
    return copyPasteClipboard.sourcePaths;
  }, [copyPasteClipboard]);
  const clipboardSummary = useMemo(
    () => describeClipboard(copyPasteClipboard),
    [copyPasteClipboard],
  );
  const [clipboardMenuOpen, setClipboardMenuOpen] = useState(false);
  const hasClipboardSummary = clipboardSummary !== null;
  useEffect(() => {
    if (!hasClipboardSummary) {
      setClipboardMenuOpen(false);
    }
  }, [hasClipboardSummary]);
  // Items flash once when they are copied or cut. `capturedAt` changes with every copy and
  // cut, and with nothing else: taking one item off the clipboard keeps it.
  const clipboardCapturedAt =
    copyPasteClipboard.type === "ready" ? copyPasteClipboard.capturedAt : null;
  const [clipboardFlashing, setClipboardFlashing] = useState(false);
  useEffect(() => {
    if (clipboardCapturedAt === null) {
      setClipboardFlashing(false);
      return;
    }
    setClipboardFlashing(true);
    const timer = window.setTimeout(() => setClipboardFlashing(false), CLIPBOARD_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [clipboardCapturedAt]);
  const clipboardMarks = useMemo<ClipboardMarksBySurface>(() => {
    if (copyPasteClipboard.type !== "ready") {
      return { tree: null, content: null };
    }
    const marks = {
      paths: new Set(copyPasteClipboard.sourcePaths),
      mode: copyPasteClipboard.mode,
      flashing: clipboardFlashing,
    };
    return {
      tree: highlightClipboardItemsInTree ? marks : null,
      content: highlightClipboardItemsInContent ? marks : null,
    };
  }, [
    copyPasteClipboard,
    clipboardFlashing,
    highlightClipboardItemsInTree,
    highlightClipboardItemsInContent,
  ]);
  const pasteDestinationPath = useMemo(
    () =>
      resolvePasteDestinationPath({
        contextMenuState,
        contextMenuTargetEntry,
        clipboardSourcePaths,
        currentPath,
        focusedPane,
        isSearchMode,
        selectedEntry,
        selectedPathCount: selectedPathsInViewOrder.length,
      }),
    [
      contextMenuState,
      contextMenuTargetEntry,
      clipboardSourcePaths,
      currentPath,
      focusedPane,
      isSearchMode,
      selectedEntry,
      selectedPathsInViewOrder.length,
    ],
  );
  const isWriteOperationLocked = writeOperationCardState !== null;
  const locationDialogOpen = locationSheetOpen || moveDialogState !== null;
  const explorerFocusSuppressed =
    copyPasteDialogState !== null ||
    writeOperationProgressEvent !== null ||
    renameDialogState !== null ||
    newFolderDialogState !== null ||
    moveDialogState !== null;
  const {
    clearTypeahead,
    focusContentPane,
    focusTreePane,
    restoreExplorerPaneFocus,
    handlePagedPaneScroll,
    handleTypeaheadInput,
    eraseListFilterCharacter,
    clearListFilter,
    setListFilter,
    listFilterTakesSpace,
    handleTreeKeyboardAction,
    goBack,
    goForward,
    goToHistoryIndex,
    rootTreeAtPath,
    goHomeAndRootTree,
    navigateToParentFolder,
    navigateTreeSelectionToParent,
    selectTreeItem,
    clearTreeSelection,
    initializeTree,
    navigateTo,
    navigateToNearestExistingFolder,
    reloadFolderInPlace,
    restoreListFilter,
    navigateTreeFileSystemPath,
    loadTreeChildren,
    toggleTreeNode,
    openTreeNode,
    toggleHiddenFiles,
    refreshDirectory,
    handleSortChange,
    toggleFoldersFirst,
    submitLocationPath,
    handlePaneResizeKey,
  } = useExplorerNavigationController({
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    selection: selectionActions,
    derived: {
      activeContentEntries,
      unfilteredContentEntries,
      filterContentEntries: (query) =>
        isSearchMode ? filterSearchResultEntries(query) : filterEntriesByName(browseEntries, query),
      locationDialogOpen,
      explorerFocusSuppressed,
    },
  });
  const navigateFavoritePath = useCallback(
    (path: string, historyMode: "push" | "replace" | "skip") =>
      navigateTo(path, historyMode, undefined, undefined, undefined, undefined, {
        syncTree: false,
        treeSelectionMode: "favorite",
        favoritePath: path,
        persistOnError: true,
      }),
    [navigateTo],
  );
  // Tabs are set up after the actions (they need to know whether a dialog is open), so the
  // actions reach "open in a new tab" through this.
  const openPathInNewTabRef = useRef<(path: string) => void>(() => undefined);
  const {
    closeContextMenu,
    activateContentEntry,
    activateContentPaths,
    openFolderInNewTab,
    applyContentSelection,
    browseForDirectoryPath,
    cancelWriteOperation,
    clearContentSelection,
    contextMenuDisabledActionIds,
    contextMenuFavoriteToggleLabel,
    contextMenuHiddenActionIds,
    contextMenuSubmenuItems,
    copyGetInfoPath,
    copyGetInfoName,
    dismissActionNotice,
    dismissCopyPasteDialog,
    dismissToast,
    editPaths,
    extendContentSelectionToPath,
    handleContentSelectionGesture,
    handleCopyPasteDialogEscape,
    openItemContextMenu,
    openTreeItemContextMenu,
    openNewFolderDialog,
    openPathExternally,
    openPathInTerminal,
    showPathsInFinder,
    editPathInTextEditor,
    toggleFavoritePath,
    openPaths,
    openRenameDialog,
    openMoveDialog,
    requestCopyLikePlanStart,
    resolveContentActionPaths,
    resolveRuntimeConflict,
    retryFailedCopyPasteItems,
    runContextMenuAction,
    runContextSubmenuAction,
    runCopyClipboardAction,
    removeClipboardPath,
    clearClipboard,
    revealPathInFolder,
    runCopyPathAction,
    selectAllContentEntries,
    setSingleContentSelection,
    showCopyPasteProgressCard,
    showCopyPasteResultDialog,
    surfaceCopyLikePreStartFailureNotice,
    startDuplicatePaths,
    startMoveToDestination,
    startPasteFromClipboard,
    startTrashPaths,
    startDeleteImmediatelyPaths,
    submitMoveDialog,
    submitNewFolderDialog,
    submitRenameDialog,
    toggleContentSelection,
    updateCopyPasteChoices,
  } = useExplorerActions({
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    selection: selectionActions,
    derived: {
      activeContentEntries,
      selectedPathsInViewOrder,
      selectedPathSet,
      contextMenuTargetEntries,
      contextMenuTargetEntry,
      pasteDestinationPath,
      isSearchMode,
    },
    navActions: {
      restoreExplorerPaneFocus,
      navigateTo,
      navigateTreeFileSystemPath,
      navigateFavoritePath,
      rootTreeAtPath,
      toggleTreeNode,
      refreshDirectory,
    },
    callbacks: {
      openPathInNewTab: (path) => openPathInNewTabRef.current(path),
      restartActiveSearch: async () => {
        if (searchCommittedQuery.trim().length === 0) {
          return;
        }
        await startSearch(searchCommittedQuery, {
          rootPath: searchRootPath || currentPath,
        });
      },
    },
  });
  const copyPasteModalOpen =
    (copyPasteDialogState !== null && copyPasteDialogState.type !== "analysis") ||
    showCopyPasteResultDialog ||
    // The "changed while pasting" prompt blocks the explorer until it is answered.
    (writeOperationProgressEvent?.status === "awaiting_resolution" &&
      Boolean(writeOperationProgressEvent.runtimeConflict)) ||
    renameDialogState !== null ||
    newFolderDialogState !== null ||
    moveDialogState !== null;
  const {
    openTabs,
    activeTabIndex,
    restoreTabs,
    activeTabId,
    tabItems,
    tabCount,
    activateTab,
    activateAdjacentTab,
    openNewTab,
    openPathInNewTab,
    closeTab,
    closeOtherTabs,
    duplicateTab,
    reopenClosedTab,
    moveTab,
  } = useExplorerTabs({
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    selection: selectionActions,
    searchSession: {
      detach: detachSearchSession,
      attach: attachSearchSession,
      createEmpty: createEmptySearchSession,
      rerun: rerunSearch,
    },
    navActions: {
      navigateToNearestExistingFolder,
      reloadFolderInPlace,
      focusTreePane,
      loadTreeChildren: (path) => loadTreeChildren(path),
      restoreListFilter,
    },
    derived: {
      isSearchMode,
      blocked: copyPasteModalOpen || locationDialogOpen || actionNotice !== null,
    },
  });
  openPathInNewTabRef.current = openPathInNewTab;
  const dragDropBlocked =
    mainView !== "explorer" ||
    actionNotice !== null ||
    locationDialogOpen ||
    copyPasteModalOpen ||
    isWriteOperationLocked;
  const {
    dragActive,
    getContentItemDropIndicator,
    getTreeItemDropIndicator,
    handleContentDragEnter,
    handleContentDragLeave,
    handleContentDragOver,
    handleContentDragStart,
    handleContentDrop,
    handleDragEnd,
    handleSearchDragStart,
    handleTreeDragEnter,
    handleTreeDragOver,
    handleTreeDrop,
    handleTabDragOver,
    handleTabDragLeave,
    handleTabDrop,
    getTabDropIndicator,
  } = useExplorerDragAndDrop({
    activeEntries: activeContentEntries,
    selectedPathsInViewOrder,
    homePath,
    blocked: dragDropBlocked,
    onMoveToDestination: async (sourcePaths, destinationDirectoryPath, options) => {
      const outcome = await startMoveToDestination(sourcePaths, destinationDirectoryPath, options);
      if (outcome.status === "blocked" || outcome.status === "error") {
        surfaceCopyLikePreStartFailureNotice("move_to", outcome);
      }
      return outcome.status === "queued" || outcome.status === "review";
    },
    onToggleTreeNode: toggleTreeNode,
    onActivateTab: activateTab,
  });
  const trashPath = homePath ? getTrashPath(homePath) : null;
  const shortcutContext = useMemo(
    () => ({
      actionNoticeOpen: actionNotice !== null,
      copyPasteModalOpen,
      focusedPane,
      locationSheetOpen: locationDialogOpen,
      mainView,
      selectedTreeTargetKind,
    }),
    [
      actionNotice,
      copyPasteModalOpen,
      focusedPane,
      locationDialogOpen,
      mainView,
      selectedTreeTargetKind,
    ],
  );
  const canRunRendererCommand = useCallback(
    (commandType: Parameters<typeof canHandleRendererCommand>[0]) =>
      canRunToolbarRendererCommand(commandType, {
        shortcutContext,
        currentPath,
        selectedPathsInViewOrder,
        activeContentEntries,
        selectedEntry,
        selectedTreeTargetPath,
        copyPasteClipboard,
        pasteDestinationPath,
        isSearchMode,
        openItemLimit,
        writeOperationLocked: isWriteOperationLocked,
        canGoBack: historyIndex > 0,
        canGoForward: historyIndex >= 0 && historyIndex < historyPaths.length - 1,
        hasCachedSearch,
        tabCount,
        trashPath,
      }),
    [
      shortcutContext,
      currentPath,
      selectedPathsInViewOrder,
      activeContentEntries,
      selectedEntry,
      selectedTreeTargetPath,
      copyPasteClipboard,
      pasteDestinationPath,
      isSearchMode,
      openItemLimit,
      isWriteOperationLocked,
      historyIndex,
      historyPaths.length,
      hasCachedSearch,
      tabCount,
      trashPath,
    ],
  );
  // Help opens on the page asked for, or on the one it was left on. That page is remembered
  // only while the app runs.
  const lastHelpTopicRef = useRef<HelpTopicId>("navigation");
  const openHelp = useCallback(
    (topic?: HelpTopicId) => {
      setHelpRequest((current) => ({
        topic: topic ?? lastHelpTopicRef.current,
        id: current.id + 1,
      }));
      setMainView("help");
    },
    [setMainView],
  );

  // The application menu lives in the main process; it is told which commands can run and
  // which checkmarks are on whenever that changes.
  const favoriteTargetPath = resolveFavoriteTargetPath({
    focusedPane,
    currentPath,
    selectedPathsInViewOrder,
    activeContentEntries,
    selectedTreeTargetPath,
    isSearchMode,
    trashPath,
  });
  const applicationMenuState = useMemo(
    () =>
      buildApplicationMenuState({
        canRun: canRunRendererCommand,
        viewMode,
        sortBy,
        foldersFirst,
        hiddenFilesShown: includeHidden,
        infoPanelOpen,
        infoRowOpen,
        favoriteIsSet: favoriteTargetPath !== null && isFavoritePath(favorites, favoriteTargetPath),
      }),
    [
      canRunRendererCommand,
      viewMode,
      sortBy,
      foldersFirst,
      includeHidden,
      infoPanelOpen,
      infoRowOpen,
      favoriteTargetPath,
      favorites,
    ],
  );
  const sentApplicationMenuStateRef = useRef("");
  useEffect(() => {
    const serialized = JSON.stringify(applicationMenuState);
    if (serialized === sentApplicationMenuStateRef.current) {
      return;
    }
    sentApplicationMenuStateRef.current = serialized;
    void client.invoke("app:setMenuState", { state: applicationMenuState }).catch(() => undefined);
  }, [applicationMenuState, client]);

  const { runRendererCommand } = useExplorerShortcuts({
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    derived: {
      shortcuts,
      shortcutContext,
      copyPasteModalOpen,
      locationDialogOpen,
      selectedTreeTargetPath,
      selectedPathsInViewOrder,
      selectedEntry,
      activeContentEntries,
      isSearchMode,
      hasCachedSearch,
      trashPath,
    },
    actions: {
      dismissActionNotice,
      handleCopyPasteDialogEscape,
      openSettingsView: () => openSettingsView(),
      openLocationSheet,
      focusFileSearch,
      clearTypeahead,
      showCachedSearchResults,
      hideSearchResults,
      goBack,
      goForward,
      goHomeAndRootTree,
      rootTreeAtPath,
      navigateTo,
      navigateTreeFileSystemPath,
      navigateFavoritePath,
      openTreeNode,
      toggleHiddenFiles,
      refreshDirectory,
      rerunSearch,
      runCopyClipboardAction,
      // Nothing to list while the clipboard is empty; the button is not even there.
      showClipboard: () => setClipboardMenuOpen(copyPasteClipboardRef.current.type === "ready"),
      clearClipboard,
      startPasteFromClipboard,
      resolveContentActionPaths,
      startDuplicatePaths,
      startTrashPaths,
      openMoveDialog,
      openRenameDialog,
      openNewFolderDialog,
      runCopyPathAction,
      openPaths,
      editPaths,
      openPathInTerminal,
      focusContentPane,
      handlePagedPaneScroll,
      handleTypeaheadInput,
      eraseListFilterCharacter,
      clearListFilter,
      listFilterTakesSpace,
      handleTreeKeyboardAction,
      navigateTreeSelectionToParent,
      activateContentPaths,
      extendContentSelectionToPath,
      setSingleContentSelection,
      selectAllContentEntries,
      openNewTab,
      reopenClosedTab,
      closeTab,
      activateAdjacentTab,
      openFolderInNewTab,
      toggleFavoritePath,
      showPathsInFinder,
      handleSortChange,
      toggleFoldersFirst,
      openHelp,
    },
  });

  useEffect(
    () => () => {
      if (typeaheadTimeoutRef.current) {
        clearTimeout(typeaheadTimeoutRef.current);
      }
    },
    [],
  );

  // Snapshot the full preferences payload on every render so the debounced
  // persist below always writes the latest values without depending on each
  // individual field.
  const preferencesPersistPayload: PreferencesPersistPayload = {
    theme,
    autoLightTheme,
    autoDarkTheme,
    accent,
    zoomPercent,
    uiFontFamily,
    tabStyle,
    viewMode,
    sortBy,
    sortDirection,
    foldersFirst,
    compactListView,
    compactDetailsView,
    compactIconView,
    compactTreeView,
    singleClickExpandTreeItems,
    highlightHoveredItems,
    detailColumns,
    detailColumnWidths,
    notificationsEnabled,
    notificationDurationSeconds,
    highlightClipboardItemsInTree,
    highlightClipboardItemsInContent,
    notifyClipboardItems,
    topToolbarItems,
    propertiesOpen: infoPanelOpen,
    detailRowOpen: infoRowOpen,
    terminalApp,
    defaultTextEditor,
    openWithApplications,
    fileActivationAction,
    returnKeyAction,
    openItemLimit,
    includeHidden,
    // The search options (match mode, match scope, subfolders, Git skipping) are left
    // out on purpose: what is chosen in the search field or results bar lasts for this run
    // only. Settings owns the saved defaults, which each launch starts from.
    searchResultsSortBy,
    searchResultsSortDirection,
    treeWidth: panes.treeWidth,
    inspectorWidth: panes.inspectorWidth,
    restoreLastVisitedFolderOnStartup,
    restoreOpenTabsOnStartup,
    openTabs,
    activeTabIndex,
    treeRootPath: treeRootPath || null,
    lastVisitedPath: currentPath || null,
    lastVisitedFavoritePath:
      getFavoriteItemPath(selectedTreeItemId) === currentPath
        ? getFavoriteItemPath(selectedTreeItemId)
        : null,
    favorites,
    favoritesPlacement,
    favoritesExpanded,
    favoritesInitialized,
  };
  // A new search (query or root) starts with fresh result metadata.
  useEffect(() => {
    void searchCommittedQuery;
    void searchRootPath;
    searchMetadataRequestedRef.current = new Set();
    setSearchMetadataByPath({});
  }, [searchCommittedQuery, searchRootPath]);

  // Results can live anywhere below the search root, so metadata is requested per parent
  // folder (the batch IPC only accepts direct children of one directory).
  const loadSearchResultMetadata = useCallback(
    (paths: string[]) => {
      const missing = paths.filter((path) => !searchMetadataRequestedRef.current.has(path));
      if (missing.length === 0) {
        return;
      }
      const byParent = new Map<string, string[]>();
      for (const path of missing) {
        searchMetadataRequestedRef.current.add(path);
        const parent = parentDirectoryPath(path);
        if (!parent) {
          continue;
        }
        byParent.set(parent, [...(byParent.get(parent) ?? []), path]);
      }
      for (const [directoryPath, childPaths] of byParent) {
        void Promise.resolve()
          .then(() =>
            client.invoke("directory:getMetadataBatch", { directoryPath, paths: childPaths }),
          )
          .then((response) => {
            setSearchMetadataByPath((current) => {
              const next = { ...current };
              for (const item of response.items) {
                next[item.path] = item;
              }
              return next;
            });
          })
          .catch(() => undefined);
      }
    },
    [client],
  );

  // Free space for the path bar summary; refreshed when the folder changes.
  useEffect(() => {
    if (currentPath.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.resolve()
      .then(() => client.invoke("system:getVolumeInfo", { path: currentPath }))
      .then((response) => {
        if (!cancelled) {
          setVolumeAvailableBytes(response.availableBytes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setVolumeAvailableBytes(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, currentPath]);

  // Writes only changed keys (debounced) and applies edits made in the Settings window.
  const { markSynced } = usePreferencesSync({
    client,
    ready: preferencesReady,
    payload: preferencesPersistPayload,
    onRemotePatch: (patch) => {
      applyPreferencesPatch(preferences, patch as Partial<AppPreferences>);
      // Search defaults edited in Settings apply to the next search.
      if (patch.searchPatternMode !== undefined) setSearchPatternMode(patch.searchPatternMode);
      if (patch.searchMatchScope !== undefined) setSearchMatchScope(patch.searchMatchScope);
      if (patch.searchRecursive !== undefined) setSearchRecursive(patch.searchRecursive);
      if (patch.searchSkipGitFolders !== undefined) {
        setSearchSkipGitFolders(patch.searchSkipGitFolders);
      }
      if (patch.searchSkipGitIgnored !== undefined) {
        setSearchSkipGitIgnored(patch.searchSkipGitIgnored);
      }
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: startup bootstrapping should run once per client/pane wiring; including callback identities would cause repeated initialization.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      client.invoke("app:getPreferences", {}),
      client.invoke("app:getHomeDirectory", {}),
      client.invoke("app:getLaunchContext", {}),
    ])
      .then(async ([preferencesResponse, homeResponse, launchContextResponse]) => {
        if (cancelled) {
          return;
        }
        const preferences = preferencesResponse.preferences;
        markSynced(preferences);
        setTheme(preferences.theme);
        setAutoLightTheme(preferences.autoLightTheme);
        setAutoDarkTheme(preferences.autoDarkTheme);
        setAccent(preferences.accent);
        setZoomPercent(preferences.zoomPercent);
        setUiFontFamily(preferences.uiFontFamily);
        setTabStyle(preferences.tabStyle);
        setIncludeHidden(preferences.includeHidden);
        setSearchPatternMode(preferences.searchPatternMode);
        setSearchMatchScope(preferences.searchMatchScope);
        setSearchRecursive(preferences.searchRecursive);
        setSearchSkipGitFolders(preferences.searchSkipGitFolders);
        setSearchSkipGitIgnored(preferences.searchSkipGitIgnored);
        searchResultsSortByRef.current = preferences.searchResultsSortBy;
        searchResultsSortDirectionRef.current = preferences.searchResultsSortDirection;
        setSearchResultsSortBy(preferences.searchResultsSortBy);
        setSearchResultsSortDirection(preferences.searchResultsSortDirection);
        setViewMode(preferences.viewMode);
        setFoldersFirst(preferences.foldersFirst);
        setCompactListView(preferences.compactListView);
        setCompactDetailsView(preferences.compactDetailsView);
        setCompactIconView(preferences.compactIconView);
        setCompactTreeView(preferences.compactTreeView);
        setSingleClickExpandTreeItems(preferences.singleClickExpandTreeItems);
        setHighlightHoveredItems(preferences.highlightHoveredItems);
        setDetailColumns(preferences.detailColumns);
        setDetailColumnWidths(preferences.detailColumnWidths);
        setNotificationsEnabled(preferences.notificationsEnabled);
        setNotificationDurationSeconds(preferences.notificationDurationSeconds);
        setHighlightClipboardItemsInTree(preferences.highlightClipboardItemsInTree);
        setHighlightClipboardItemsInContent(preferences.highlightClipboardItemsInContent);
        setNotifyClipboardItems(preferences.notifyClipboardItems);
        setTopToolbarItems(preferences.topToolbarItems);
        setInfoPanelOpen(preferences.propertiesOpen);
        setInfoRowOpen(preferences.detailRowOpen);
        setSortBy(preferences.sortBy);
        setSortDirection(preferences.sortDirection);
        setRestoreLastVisitedFolderOnStartup(preferences.restoreLastVisitedFolderOnStartup);
        setRestoreOpenTabsOnStartup(preferences.restoreOpenTabsOnStartup);
        setFavorites(preferences.favorites);
        setFavoritesPlacement(preferences.favoritesPlacement);
        setFavoritesExpanded(preferences.favoritesExpanded);
        setFavoritesInitialized(preferences.favoritesInitialized);
        setTerminalApp(preferences.terminalApp);
        setDefaultTextEditor(preferences.defaultTextEditor);
        setOpenWithApplications(preferences.openWithApplications);
        setFileActivationAction(preferences.fileActivationAction);
        setOpenItemLimit(preferences.openItemLimit);
        setReturnKeyAction(preferences.returnKeyAction);
        setShortcutOverrides(preferences.shortcutOverrides);
        panes.setTreeWidth(preferences.treeWidth);
        panes.setInspectorWidth(preferences.inspectorWidth);
        setRestoredPaneWidths({
          treeWidth: preferences.treeWidth,
          inspectorWidth: preferences.inspectorWidth,
        });
        setHomePath(homeResponse.path);
        if (!preferences.favoritesInitialized) {
          setFavorites(getDefaultFavorites(homeResponse.path));
          setFavoritesExpanded(true);
          setFavoritesInitialized(true);
        }
        const startup = resolveStartupTabs(
          preferences,
          homeResponse.path,
          launchContextResponse.startupFolderPath,
        );
        // A favorite that was removed since is opened as the plain folder it is.
        const startupTabs = startup.tabs.map((tab) => ({
          ...tab,
          favoritePath:
            tab.favoritePath && isFavoritePath(preferences.favorites, tab.favoritePath)
              ? tab.favoritePath
              : null,
        }));
        const startupTab = startupTabs[startup.activeIndex];
        if (!startupTab) {
          setPreferencesReady(true);
          return;
        }
        // The tab on screen is loaded here; the other tabs are read when they are shown.
        restoreTabs(startupTabs, startup.activeIndex, preferences.favoritesPlacement);
        const startupPath = startupTab.path;
        const startupRootPath = startupTab.rootPath;
        const restoredFavoritePath = startupTab.favoritePath;
        setViewMode(startupTab.viewMode);
        setSortBy(startupTab.sortBy);
        setSortDirection(startupTab.sortDirection);
        initializeTree(startupRootPath);
        setSelectedTreeItemId(
          restoredFavoritePath
            ? createFavoriteItemId(restoredFavoritePath)
            : createFileSystemItemId(startupPath),
        );
        setLeftPaneSubview(
          preferences.favoritesPlacement === "separate" && restoredFavoritePath
            ? "favorites"
            : "tree",
        );
        if (restoredFavoritePath) {
          await loadTreeChildren(
            startupRootPath,
            preferences.includeHidden,
            false,
            startupRootPath,
          );
        }
        void navigateTo(
          startupPath,
          "replace",
          preferences.includeHidden,
          startupTab.sortBy,
          startupTab.sortDirection,
          preferences.foldersFirst,
          restoredFavoritePath
            ? {
                syncTree: false,
                treeSelectionMode: "favorite",
                favoritePath: restoredFavoritePath,
                persistOnError: true,
              }
            : undefined,
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
            startupTab.sortBy,
            startupTab.sortDirection,
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
  }, [panes.inspectorWidth, panes.treeWidth, restoredPaneWidths, setRestoredPaneWidths]);

  useEffect(() => {
    if (!searchPopoverOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && searchShellRef.current?.contains(target)) {
        return;
      }
      // The search options menu is drawn outside the field but belongs to it.
      if (target instanceof Element && target.closest(".toolbar-search-menu")) {
        return;
      }
      setSearchPopoverOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [searchPopoverOpen, setSearchPopoverOpen]);

  const singlePanelLayout = useMemo(
    () => (singlePanelWidth > 0 ? resolveSinglePanelLayout(singlePanelWidth) : "wide"),
    [singlePanelWidth],
  );
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < historyPaths.length - 1;
  // What holding Back or Forward lists.
  const backHistory = useMemo(
    () => getBackHistoryEntries(historyPaths, historyIndex, homePath),
    [historyPaths, historyIndex, homePath],
  );
  const forwardHistory = useMemo(
    () => getForwardHistoryEntries(historyPaths, historyIndex, homePath),
    [historyPaths, historyIndex, homePath],
  );

  // Moving from the search field into the results starts at the first one.
  function selectFirstSearchResult() {
    const firstResult = searchResultEntries[0];
    if (firstResult && contentSelection.paths.length === 0) {
      setSingleContentSelection(firstResult.path);
    }
  }

  // Return starts a search and moves into results that are not there yet; the first one is
  // selected once the search has finished and the order is final.
  const selectFirstSearchResultWhenDoneRef = useRef(false);
  // It was asked for in the tab that was on screen then, not in the one shown since.
  // biome-ignore lint/correctness/useExhaustiveDependencies: forgets the request whenever another tab is shown.
  useLayoutEffect(() => {
    selectFirstSearchResultWhenDoneRef.current = false;
  }, [activeTabId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the search settles; it reads the latest results and selection.
  useEffect(() => {
    if (!selectFirstSearchResultWhenDoneRef.current || searchStatus === "running") {
      return;
    }
    selectFirstSearchResultWhenDoneRef.current = false;
    if (isSearchMode && focusedPane === "content") {
      selectFirstSearchResult();
    }
  }, [searchStatus]);

  // What was typed to filter the folder becomes the search text; the search runs as if it
  // had been typed into the search field.
  function searchFromListFilter() {
    const text = listFilterQuery;
    clearListFilter();
    setSearchDraftQuery(text);
    // Searched at once and in this folder, whatever search was made here before.
    void startSearch(text, { rootPath: currentPath, live: true });
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchPointerIntentRef.current = false;
    });
  }

  function focusFileSearch(selectContents = false) {
    searchPointerIntentRef.current = true;
    setFocusedPane(null);
    clearTypeahead();
    setSearchPopoverOpen(true);
    if (listFilterQuery.length > 0 && !isSearchMode) {
      // ⌘F with a filter typed: look for the same text in the subfolders too.
      searchFromListFilter();
      return;
    }
    showCachedSearchResults({ fromField: true });
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      if (selectContents) {
        searchInputRef.current?.select();
      }
      searchPointerIntentRef.current = false;
    });
  }

  function openLocationSheet() {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setMainView("explorer");
    setLocationError(null);
    setFocusedPane(null);
    setLocationSheetOpen(true);
  }

  // The Go To and Move To boxes rank the folders that have been opened; the list is read
  // again whenever one of them opens.
  useEffect(() => {
    if (!locationDialogOpen) {
      return;
    }
    let cancelled = false;
    void client
      .invoke("places:list", {})
      .then((response) => {
        if (!cancelled) {
          setVisitedFolders(response.folders);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, locationDialogOpen]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ranked as of when the box opened; a visit made meanwhile does not reshuffle it.
  const places = useMemo(
    () =>
      buildPlaces({
        visitedFolders,
        favoritePaths: favorites.map((favorite) => favorite.path),
        currentPath,
        homePath,
        now: Date.now(),
      }),
    [visitedFolders, favorites, currentPath, homePath, locationDialogOpen],
  );

  function forgetPlace(path: string) {
    setVisitedFolders((current) => forgetVisitedFolder(current, path));
    void client.invoke("places:forget", { path }).catch(() => undefined);
  }

  // A folder from the list that no longer exists is dropped from it. One that only could
  // not be opened this time (no permission, a disk that is not connected) is kept.
  async function goToPath(path: string) {
    const didOpen = await submitLocationPath(path);
    if (didOpen || !visitedFolders.some((folder) => folder.path === path)) {
      return;
    }
    const stillExists = await client.invoke("item:getProperties", { path }).then(
      (response) => response.item !== null,
      () => true,
    );
    if (!stillExists) {
      forgetPlace(path);
    }
  }

  // Settings is a separate window (like any macOS app); main opens or focuses it.
  function openSettingsView(tab?: SettingsTab) {
    setSearchPopoverOpen(false);
    void client.invoke("app:openSettingsWindow", tab ? { tab } : {}).catch((error) => {
      logger.error("open settings window failed", error);
    });
  }

  // Derive folder size paths for the info panel and info row.
  // The info panel always shows the getInfoItem (which is the selected or inspected item).
  // The info row shows the selected entry, falling back to the current directory.
  const infoPanelItem = infoPanelView?.item ?? null;
  // Files can be edited; folders can be favorites, except the Trash, which always is one.
  const infoPanelCanEdit =
    infoPanelItem !== null &&
    (infoPanelItem.kind === "file" || infoPanelItem.kind === "symlink_file");
  const infoPanelCanFavorite =
    infoPanelItem !== null &&
    (infoPanelItem.kind === "directory" || infoPanelItem.kind === "symlink_directory") &&
    infoPanelItem.path !== getTrashPath(homePath);
  const infoPanelCanRootTree =
    infoPanelItem !== null &&
    (infoPanelItem.kind === "directory" || infoPanelItem.kind === "symlink_directory");
  const infoPanelFolderSizePath =
    infoPanelItem && isFolderSizeEligibleKind(infoPanelItem.kind) ? infoPanelItem.path : null;
  const infoRowActiveEntry =
    selectedEntry ?? (currentPath ? { path: currentPath, kind: "directory" as const } : null);
  const infoRowFolderSizePath =
    infoRowActiveEntry && isFolderSizeEligibleKind(infoRowActiveEntry.kind)
      ? infoRowActiveEntry.path
      : null;

  const workspace = (
    <ExplorerStoreProvider
      navigation={navigation}
      dialogs={writeOperations}
      preferences={preferences}
    >
      <main className="app-shell">
        {mainView === "explorer" ? (
          <ExplorerWorkspace
            preferencesReady={preferencesReady}
            restoredPaneWidths={restoredPaneWidths}
            treeWidth={panes.treeWidth}
            inspectorWidth={panes.inspectorWidth}
            beginResize={panes.beginResize}
            infoPanelOpen={infoPanelOpen}
            treePaneProps={{
              paneRef: treePaneRef,
              isFocused: focusedPane === "tree",
              dragActive,
              homePath,
              selectedTreeItemId,
              compactTreeView,
              singleClickExpandTreeItems,
              nodes: treeNodes,
              favorites,
              favoritesPlacement,
              activeLeftPaneSubview: leftPaneSubview,
              favoritesExpanded,
              rootPath: treeRootPath,
              onFocusChange: (focused) => setFocusedPane(focused ? "tree" : null),
              onLeftPaneSubviewChange: setLeftPaneSubview,
              includeHidden,
              onNavigate: async (path) => {
                await navigateTreeFileSystemPath(path, "push");
                return undefined;
              },
              onNavigateFavorite: (path) =>
                navigateTo(path, "push", undefined, undefined, undefined, undefined, {
                  syncTree: false,
                  treeSelectionMode: "favorite",
                  favoritePath: path,
                  persistOnError: true,
                }),
              onOpenInNewTab: openPathInNewTab,
              onClearSelection: clearTreeSelection,
              onSelectFavoritesRoot: async () => {
                await selectTreeItem(getFavoritesRootItemId(), "skip");
                return undefined;
              },
              contextMenuTarget:
                contextMenuState?.targetPath &&
                contextMenuState.sourceSubview &&
                (contextMenuState.surface === "treeFolder" ||
                  contextMenuState.surface === "favorite")
                  ? {
                      path: contextMenuState.targetPath,
                      subview: contextMenuState.sourceSubview,
                      kind: contextMenuState.surface,
                    }
                  : null,
              onItemContextMenu: (item, subview, position) => {
                if (!item.path || item.kind === "favorites-root") {
                  return;
                }
                openTreeItemContextMenu({
                  path: item.path,
                  sourceSubview: subview,
                  targetKind: item.kind === "favorite" ? "favorite" : "treeFolder",
                  folderExpansionLabel:
                    item.kind === "filesystem" && !item.isSymlink
                      ? item.expanded
                        ? "Collapse"
                        : "Expand"
                      : null,
                  position,
                });
              },
              onItemDragEnter: handleTreeDragEnter,
              onItemDragOver: handleTreeDragOver,
              onItemDrop: handleTreeDrop,
              getItemDropIndicator: (item, subview) =>
                getTreeItemDropIndicator(item.path, item.kind === "favorite" ? "favorite" : "tree"),
              onToggleExpand: toggleTreeNode,
              onToggleFavoritesExpanded: () => setFavoritesExpanded((value) => !value),
              typeaheadQuery: focusedPane === "tree" ? typeaheadQuery : "",
            }}
            searchWorkspaceProps={{
              isSearchMode,
              searchResultsPaneProps: {
                paneRef: contentPaneRef,
                isFocused: focusedPane === "content",
                rootPath: searchRootPath,
                query: searchCommittedQuery,
                status: searchStatus,
                results: filteredSearchResults,
                selectedPaths: contentSelection.paths,
                selectionLeadPath: contentSelection.leadPath,
                highlightHoveredItems,
                error: searchError,
                // A pattern that does not parse while it is being typed is not a failure yet.
                errorIsQuiet: searchStartedLive && searchPatternMode !== "text",
                truncated: searchTruncated,
                totalCount: allSearchResultEntries.length,
                sortBy: searchResultsSortBy,
                sortDirection: searchResultsSortDirection,
                onStopSearch: () => {
                  void stopSearch();
                },
                onClearResults: () => {
                  void clearCommittedSearch().finally(() => {
                    focusContentPane();
                  });
                },
                onCloseResults: () => {
                  setSearchPopoverOpen(false);
                  searchInputRef.current?.blur();
                  hideSearchResults();
                  focusContentPane();
                },
                onSortColumn: sortSearchResultsByColumn,
                metadataByPath: searchMetadataByPath,
                onVisiblePathsChange: loadSearchResultMetadata,
                elapsedMs: searchElapsedMs,
                scopeOptions: buildSearchScopeOptions(currentPath, homePath),
                onScopeChange: changeSearchRoot,
                patternMode: searchPatternMode,
                onPatternModeChange: updateSearchPatternMode,
                matchScope: searchMatchScope,
                onMatchScopeChange: updateSearchMatchScope,
                recursive: searchRecursive,
                onRecursiveChange: updateSearchRecursive,
                skipGitFolders: searchSkipGitFolders,
                onSkipGitFoldersChange: updateSearchSkipGitFolders,
                skipGitIgnored: searchSkipGitIgnored,
                onSkipGitIgnoredChange: updateSearchSkipGitIgnored,
                onSelectionGesture: handleContentSelectionGesture,
                onClearSelection: clearContentSelection,
                onActivateResult: (item, inNewTab) => {
                  const entry = toDirectoryEntryFromSearchResult(item);
                  if (inNewTab && isDirectoryLikeEntry(entry)) {
                    void openFolderInNewTab(entry.path);
                    return;
                  }
                  void activateContentEntry(entry);
                },
                onItemContextMenu: (path, position) => {
                  openItemContextMenu(path, position, "search");
                },
                onItemDragStart: (item, event) =>
                  handleSearchDragStart(toDirectoryEntryFromSearchResult(item), "search", event),
                onItemDragEnd: handleDragEnd,
                onFocusChange: (focused) => setFocusedPane(focused ? "content" : null),
                onTypeaheadInput: (key) => handleTypeaheadInput(key, "content"),
                filterQuery: listFilterQuery,
                onFilterQueryChange: setListFilter,
                scrollTop: searchResultsScrollTop,
                onScrollTopChange: setSearchResultsScrollTop,
              },
              contentPaneProps: {
                paneRef: contentPaneRef,
                isFocused: focusedPane === "content",
                currentPath,
                entries: visibleBrowseEntries,
                filterQuery: listFilterQuery,
                filterTotalCount: browseEntries.length,
                onClearFilter: clearListFilter,
                onSearchForFilter: searchFromListFilter,
                loading: directoryLoading,
                error: directoryError,
                includeHidden,
                metadataByPath,
                selectedPaths: contentSelection.paths,
                selectionLeadPath: contentSelection.leadPath,
                viewMode,
                onSelectionGesture: handleContentSelectionGesture,
                onClearSelection: clearContentSelection,
                onActivateEntry: (entry, inNewTab) => {
                  // ⌘-double-click opens a folder in a new tab, as in Finder.
                  if (inNewTab && isDirectoryLikeEntry(entry)) {
                    void openFolderInNewTab(entry.path);
                    return;
                  }
                  void activateContentEntry(entry);
                },
                onFocusChange: (focused) => setFocusedPane(focused ? "content" : null),
                sortBy,
                sortDirection,
                onSortChange: handleSortChange,
                onLayoutColumnsChange: setContentColumns,
                onVisiblePathsChange: setVisiblePaths,
                onNavigatePath: (path) => void navigateTo(path, "push"),
                onOpenPathInNewTab: openPathInNewTab,
                onRequestPathSuggestions: (inputPath) =>
                  requestPathSuggestions({
                    client,
                    includeHidden,
                    homePath,
                    inputPath,
                  }),
                onRequestFolderChildren: async (path) =>
                  (await client.invoke("tree:getChildren", { path, includeHidden })).children,
                onTypeaheadInput: (key) => handleTypeaheadInput(key, "content"),
                onItemContextMenu: (path, position) => {
                  openItemContextMenu(path, position, "content");
                },
                onItemDragStart: (entry, event) => handleContentDragStart(entry, "content", event),
                onItemDragEnd: handleDragEnd,
                onItemDragEnter: handleContentDragEnter,
                onItemDragOver: handleContentDragOver,
                onItemDragLeave: handleContentDragLeave,
                onItemDrop: handleContentDrop,
                getItemDropIndicator: getContentItemDropIndicator,
                compactListView,
                compactDetailsView,
                compactIconView,
                highlightHoveredItems,
                detailColumns,
                detailColumnWidths,
                onDetailColumnWidthsChange: setDetailColumnWidths,
                inlineRename: renameDialogState?.inline
                  ? { path: renameDialogState.sourcePath, error: renameDialogState.error }
                  : null,
                onInlineRenameSubmit: (nextName) => void submitRenameDialog(nextName),
                onInlineRenameCancel: () => setRenameDialogState(null),
                statusSummary: buildContentStatusSummary({
                  itemCount: currentEntries.length,
                  shownCount: visibleBrowseEntries.length,
                  selectedPaths: contentSelection.paths,
                  getKnownSizeBytes: (path) => {
                    const entry = currentEntries.find((candidate) => candidate.path === path);
                    if (!entry) {
                      return null;
                    }
                    // Only folders have a calculated size to look up; asking for a file's
                    // would send a request that can never find one.
                    if (isFolderSizeEligibleKind(entry.kind)) {
                      const folderSize = folderSizeCache.getEntry(path);
                      if (folderSize.status === "ready") {
                        return folderSize.sizeBytes;
                      }
                    }
                    if (entry.kind === "directory" || entry.kind === "bundle") {
                      return null;
                    }
                    const metadata = metadataByPath[path];
                    return metadata?.sizeStatus === "ready" ? metadata.sizeBytes : null;
                  },
                  availableBytes: volumeAvailableBytes,
                }),
                sizeBars,
                getFolderSizeLabel: (path) => {
                  const entry = folderSizeCache.getEntry(path);
                  if (entry.status === "ready") {
                    return formatSize(entry.sizeBytes, "ready");
                  }
                  return entry.status === "calculating" ? "Calculating…" : null;
                },
              },
              infoRow: (
                <InfoRow
                  open={infoRowOpen}
                  currentPath={currentPath}
                  selectedEntry={selectedEntry}
                  metadata={selectedEntry ? (metadataByPath[selectedEntry.path] ?? null) : null}
                  item={getInfoItem}
                  folderSizeEntry={
                    infoRowFolderSizePath
                      ? folderSizeCache.getEntry(infoRowFolderSizePath)
                      : undefined
                  }
                  onCalculateFolderSize={
                    infoRowFolderSizePath
                      ? () => void folderSizeCache.calculateFolderSize(infoRowFolderSizePath)
                      : undefined
                  }
                  onRecalculateFolderSize={
                    infoRowFolderSizePath
                      ? () => folderSizeCache.recalculateFolderSize(infoRowFolderSizePath)
                      : undefined
                  }
                  onCancelFolderSize={
                    infoRowFolderSizePath
                      ? () => void folderSizeCache.cancelFolderSize(infoRowFolderSizePath)
                      : undefined
                  }
                />
              ),
            }}
            infoPanelProps={{
              loading: getInfoLoading,
              item: infoPanelItem,
              pending: infoPanelView?.pending ?? false,
              onClose: () => setInfoPanelOpen(false),
              onNavigateToPath: (path) => {
                void navigateTo(path, path === currentPath ? "replace" : "push");
              },
              onOpen: () => {
                if (infoPanelItem) {
                  void openPathExternally(infoPanelItem.path);
                }
              },
              onOpenInTerminal: () => {
                if (infoPanelItem) {
                  void openPathInTerminal(infoPanelItem.path);
                }
              },
              onShowInFinder: () => {
                if (infoPanelItem) {
                  void showPathsInFinder([infoPanelItem.path]);
                }
              },
              onCopyPath: () => (infoPanelItem ? copyGetInfoPath(infoPanelItem.path) : false),
              onCopyName: () => (infoPanelItem ? copyGetInfoName(infoPanelItem.name) : false),
              onQuickLook: () => {
                if (infoPanelItem) {
                  void client
                    .invoke("system:quickLook", { path: infoPanelItem.path })
                    .catch(() => undefined);
                }
              },
              onEdit: infoPanelCanEdit
                ? () => void editPathInTextEditor(infoPanelItem.path)
                : undefined,
              isFavorite: infoPanelCanFavorite && isFavoritePath(favorites, infoPanelItem.path),
              onToggleFavorite: infoPanelCanFavorite
                ? () => toggleFavoritePath(infoPanelItem.path)
                : undefined,
              onRootTree: infoPanelCanRootTree
                ? () => rootTreeAtPath(infoPanelItem.path)
                : undefined,
              openWithItems: contextMenuSubmenuItems,
              onOpenWith: (action) => {
                if (infoPanelItem) {
                  void runContextSubmenuAction(action, [infoPanelItem.path]);
                }
              },
              folderSizeEntry: infoPanelFolderSizePath
                ? folderSizeCache.getEntry(infoPanelFolderSizePath)
                : undefined,
              onCalculateFolderSize: infoPanelFolderSizePath
                ? () => void folderSizeCache.calculateFolderSize(infoPanelFolderSizePath)
                : undefined,
              onRecalculateFolderSize: infoPanelFolderSizePath
                ? () => folderSizeCache.recalculateFolderSize(infoPanelFolderSizePath)
                : undefined,
              onCancelFolderSize: infoPanelFolderSizePath
                ? () => void folderSizeCache.cancelFolderSize(infoPanelFolderSizePath)
                : undefined,
            }}
            currentPath={currentPath}
            topToolbarItems={topToolbarItems}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            backHistory={backHistory}
            forwardHistory={forwardHistory}
            onGoToHistoryIndex={goToHistoryIndex}
            focusedPane={focusedPane}
            selectedEntryExists={selectedEntry !== null}
            goBack={goBack}
            goForward={goForward}
            navigateToParentFolder={navigateToParentFolder}
            refreshDirectory={refreshDirectory}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            foldersFirst={foldersFirst}
            onToggleFoldersFirst={toggleFoldersFirst}
            includeHidden={includeHidden}
            onToggleHidden={toggleHiddenFiles}
            onToggleInfoPanel={() => setInfoPanelOpen((value) => !value)}
            infoRowOpen={infoRowOpen}
            onToggleInfoRow={() => setInfoRowOpen((value) => !value)}
            theme={theme}
            onSelectTheme={(nextTheme) => {
              // A palette picked here also becomes the palette of its side for Auto.
              const patch = themeChoicePatch(nextTheme);
              setTheme(nextTheme);
              if (patch.autoLightTheme) {
                setAutoLightTheme(patch.autoLightTheme);
              }
              if (patch.autoDarkTheme) {
                setAutoDarkTheme(patch.autoDarkTheme);
              }
            }}
            searchShellRef={searchShellRef}
            searchPopoverOpen={searchPopoverOpen}
            onSearchShellBlur={(event) => {
              const nextTarget = event.relatedTarget;
              if (
                nextTarget instanceof Node &&
                (searchShellRef.current?.contains(nextTarget) ?? false)
              ) {
                return;
              }
              setSearchPopoverOpen(false);
            }}
            searchPointerIntentRef={searchPointerIntentRef}
            onSearchShellPointerIntent={() => {
              setFocusedPane(null);
              clearTypeahead();
              window.requestAnimationFrame(() => {
                searchInputRef.current?.focus();
                searchPointerIntentRef.current = false;
              });
            }}
            onSearchSubmit={() => {
              void submitSearch(searchDraftQuery).then((resultsOnScreen) => {
                dismissFileSearch({ focusBelow: true });
                if (resultsOnScreen) {
                  selectFirstSearchResult();
                } else {
                  selectFirstSearchResultWhenDoneRef.current = true;
                }
              });
            }}
            onSearchInputArrowDown={() => {
              // ↓ steps from the field into the results that typing found.
              if (isSearchMode) {
                dismissFileSearch({ focusBelow: true });
                selectFirstSearchResult();
              }
            }}
            searchInputRef={searchInputRef}
            searchDraftQuery={searchDraftQuery}
            onSearchInputFocus={() => {
              searchPointerIntentRef.current = false;
              setFocusedPane(null);
              clearTypeahead();
              setSearchPopoverOpen(true);
              showCachedSearchResults({ fromField: true });
            }}
            onSearchDraftQueryChange={updateSearchDraftQuery}
            onSearchInputEscape={() => {
              // Esc ends the search and shows the folder again (⇧⌘F brings the results back).
              if (isSearchMode) {
                hideSearchResults();
              } else {
                // Nothing was searched yet: drop what was typed and the search about to start.
                abandonSearchDraft();
              }
              dismissFileSearch({ focusBelow: true });
            }}
            onClearSearchDraft={() => {
              // The ✕ empties the field and forgets the search; the field keeps the keyboard.
              abandonSearchDraft();
              void clearCommittedSearch();
              searchInputRef.current?.focus();
            }}
            searchPatternMode={searchPatternMode}
            onSearchPatternModeChange={updateSearchPatternMode}
            searchMatchScope={searchMatchScope}
            onSearchMatchScopeChange={updateSearchMatchScope}
            searchRecursive={searchRecursive}
            onSearchRecursiveChange={updateSearchRecursive}
            searchSkipGitFolders={searchSkipGitFolders}
            onSearchSkipGitFoldersChange={updateSearchSkipGitFolders}
            searchSkipGitIgnored={searchSkipGitIgnored}
            onSearchSkipGitIgnoredChange={updateSearchSkipGitIgnored}
            canRunRendererCommand={canRunRendererCommand}
            onRendererCommand={runRendererCommand}
            onCustomizeToolbar={() => openSettingsView("toolbars")}
            onPaneResizeKey={handlePaneResizeKey}
            clipboardButton={
              clipboardSummary ? (
                <ClipboardButton
                  summary={clipboardSummary}
                  open={clipboardMenuOpen}
                  onOpenChange={setClipboardMenuOpen}
                  onRevealItem={(path) => void revealPathInFolder(path)}
                  onRemoveItem={removeClipboardPath}
                  onClear={clearClipboard}
                />
              ) : null
            }
            tabStrip={
              tabCount > 1 ? (
                <TabStrip
                  tabs={tabItems}
                  tabStyle={tabStyle}
                  onSelectTab={activateTab}
                  onCloseTab={closeTab}
                  onCloseOtherTabs={closeOtherTabs}
                  onDuplicateTab={duplicateTab}
                  onMoveTab={moveTab}
                  onNewTab={openNewTab}
                  onItemDragOver={handleTabDragOver}
                  onItemDragLeave={handleTabDragLeave}
                  onItemDrop={(tab, event) => void handleTabDrop(tab, event)}
                  getDropIndicator={getTabDropIndicator}
                />
              ) : null
            }
            toolbarTitle={
              isSearchMode
                ? `Searching “${getFolderDisplayName(searchRootPath)}”`
                : getFolderDisplayName(currentPath)
            }
            // Under the name while searching: how the search is going. A folder's item count
            // is in the status bar, and is not said twice.
            toolbarSubtitle={
              isSearchMode
                ? formatSearchStatus({
                    isSearching: searchStatus === "running",
                    shown: filteredSearchResults.length,
                    totalCount: allSearchResultEntries.length,
                    elapsedMs: searchElapsedMs,
                    selectedCount: contentSelection.paths.length,
                  })
                : ""
            }
          />
        ) : (
          <section className="workspace single-panel-layout">
            <header className="single-panel-toolbar">
              <button
                type="button"
                className="single-panel-back"
                onClick={() => setMainView("explorer")}
                title="Back to Files (Esc)"
              >
                <ToolbarIcon name="back" />
                <span>Files</span>
              </button>
              <span className="single-panel-title">Help</span>
            </header>
            <section ref={singlePanelRef} className="pane single-panel-pane">
              {mainView === "help" ? (
                <HelpView
                  key={helpRequest.id}
                  layoutMode={singlePanelLayout}
                  initialTopic={helpRequest.topic}
                  onTopicChange={(topic) => {
                    lastHelpTopicRef.current = topic;
                  }}
                  onCustomizeShortcuts={() => openSettingsView("shortcuts")}
                />
              ) : null}
            </section>
          </section>
        )}
        <AppDialogs
          currentPath={currentPath}
          places={places}
          onForgetPlace={forgetPlace}
          onRequestPathSuggestions={(inputPath) =>
            requestPathSuggestions({ client, includeHidden, homePath, inputPath })
          }
          onSubmitLocationPath={(path) => void goToPath(path)}
          onBrowseForDirectoryPath={browseForDirectoryPath}
          onSubmitMoveDialog={(path) => void submitMoveDialog(path)}
          contextMenuDisabledActionIds={contextMenuDisabledActionIds}
          contextMenuFavoriteToggleLabel={contextMenuFavoriteToggleLabel}
          contextMenuHiddenActionIds={contextMenuHiddenActionIds}
          contextMenuSubmenuItems={contextMenuSubmenuItems}
          shortcutContext={shortcutContext}
          onRunContextMenuAction={(actionId, paths) => {
            const [folderPath] = paths;
            if (actionId === "calculateSize" && folderPath) {
              closeContextMenu();
              void folderSizeCache.calculateFolderSize(folderPath);
              return;
            }
            void runContextMenuAction(actionId, paths);
          }}
          onRunContextSubmenuAction={(action, paths) => {
            void runContextSubmenuAction(action, paths);
          }}
          onDismissActionNotice={dismissActionNotice}
          onSubmitRenameDialog={(value) => void submitRenameDialog(value)}
          onSubmitNewFolderDialog={(value) => void submitNewFolderDialog(value)}
          onRequestCopyLikePlanStart={requestCopyLikePlanStart}
          onUpdateCopyPasteChoices={updateCopyPasteChoices}
          onCloseCopyPasteDialog={dismissCopyPasteDialog}
          onConfirmTrashDialog={(paths) => {
            void startTrashPaths(paths);
          }}
          onConfirmDeleteImmediatelyDialog={(paths) => {
            void startDeleteImmediatelyPaths(paths);
          }}
          showCopyPasteProgressCard={showCopyPasteProgressCard}
          onCancelWriteOperation={() => {
            void cancelWriteOperation();
          }}
          showCopyPasteResultDialog={showCopyPasteResultDialog}
          onResolveRuntimeConflict={(conflictId, resolution, applyToRemaining) => {
            void resolveRuntimeConflict(conflictId, resolution, applyToRemaining);
          }}
          onRetryFailedCopyPasteItems={(event) => {
            void retryFailedCopyPasteItems(event);
          }}
          onDismissToast={dismissToast}
        />
      </main>
    </ExplorerStoreProvider>
  );
  return (
    <ShortcutDisplayProvider value={shortcutDisplay}>
      <ClipboardMarksProvider value={clipboardMarks}>{workspace}</ClipboardMarksProvider>
    </ShortcutDisplayProvider>
  );
}

// Search scopes: the folder being browsed, Home, and the whole disk (deduplicated).
function buildSearchScopeOptions(
  currentPath: string,
  homePath: string,
): Array<{ path: string; label: string }> {
  const options: Array<{ path: string; label: string }> = [];
  for (const [path, label] of [
    [currentPath, `“${getFolderDisplayName(currentPath)}”`],
    [homePath, "Home"],
    ["/", "Macintosh HD"],
  ] as const) {
    if (path.length > 0 && !options.some((option) => option.path === path)) {
      options.push({ path, label });
    }
  }
  return options;
}

async function requestPathSuggestions(args: {
  client: ReturnType<typeof useFiletrailClient>;
  includeHidden: boolean;
  homePath: string;
  inputPath: string;
}): Promise<IpcResponse<"path:getSuggestions">> {
  const { client, includeHidden, homePath, inputPath } = args;
  const limit = 12;
  const resolvedInputPath = expandHomeShortcut(inputPath.trim(), homePath);
  return (
    (await client
      .invoke("path:getSuggestions", {
        inputPath: resolvedInputPath,
        includeHidden,
        limit,
      })
      .catch(() => null)) ?? {
      inputPath: resolvedInputPath,
      basePath: null,
      suggestions: [],
    }
  );
}
