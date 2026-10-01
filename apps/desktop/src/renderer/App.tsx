import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  ActionLogEntry,
  IpcRequest,
  IpcResponse,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";

import {
  type AppPreferences,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TERMINAL_APPLICATION,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  clampOpenItemLimit,
  clampZoomPercent,
} from "../shared/appPreferences";
import { DEFAULT_TOP_TOOLBAR_ITEMS } from "../shared/toolbarItems";
import { ActionLogView } from "./components/ActionLogView";
import { AppDialogs } from "./components/AppDialogs";
import { ExplorerWorkspace } from "./components/ExplorerWorkspace";
import { HelpView } from "./components/HelpView";
import { InfoRow } from "./components/InfoRow";
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
import { useFolderSizeCache } from "./hooks/useFolderSizeCache";
import { usePreferencesSync } from "./hooks/usePreferencesSync";
import { useSearchSession } from "./hooks/useSearchSession";
import { useWriteOperations } from "./hooks/useWriteOperations";
import {
  type ContentSelectionState,
  setSingleContentSelection as createSingleContentSelection,
} from "./lib/contentSelection";
import { buildPasteRequest } from "./lib/copyPasteClipboard";
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
import { FileIcon, IconThemeProvider } from "./lib/fileIcons";
import { useFiletrailClient } from "./lib/filetrailClient";
import { formatDateTime, formatPermissionMode, formatSize } from "./lib/formatting";
import { resolveInfoItem } from "./lib/infoPreview";
import { EXPLORER_LAYOUT } from "./lib/layoutTokens";
import { createRendererLogger } from "./lib/logging";
import { expandHomeShortcut } from "./lib/pathUtils";
import { canRunToolbarRendererCommand } from "./lib/rendererCommandAvailability";
import { resolveExplorerToolbarLayout, resolveSinglePanelLayout } from "./lib/responsiveLayout";
import { formatSearchStatus } from "./lib/searchResults";
import type { canHandleRendererCommand } from "./lib/shortcutPolicy";
import { resolveStartupNavigation } from "./lib/startupNavigation";
import { buildContentStatusSummary } from "./lib/statusSummary";
import { type ToastEntry, type ToastKind, createToastEntry, enqueueToast } from "./lib/toasts";
import { ExplorerStoreProvider } from "./state/explorerStoreContext";
import { useExplorerServices, useSelectionActions } from "./state/explorerStores";

const logger = createRendererLogger("filetrail.renderer");

type PreferencesPersistPayload = IpcRequest<"app:updatePreferences">["preferences"];

export function App() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const client = useFiletrailClient();
  const folderSizeCache = useFolderSizeCache(client);
  const [actionLogEntries, setActionLogEntries] = useState<ActionLogEntry[]>([]);
  const [actionLogLoading, setActionLogLoading] = useState(false);
  const [actionLogError, setActionLogError] = useState<string | null>(null);
  const [locationSheetInitialPath, setLocationSheetInitialPath] = useState("");
  const [volumeAvailableBytes, setVolumeAvailableBytes] = useState<number | null>(null);
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
    favoritesPaneHeight,
    setFavoritesPaneHeight,
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
  } = preferences;
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
    themeMenuOpen,
    setThemeMenuOpen,
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
    searchResultsFilterQuery,
    setSearchResultsFilterQuery,
    debouncedSearchResultsFilterQuery,
    setDebouncedSearchResultsFilterQuery,
    searchResultsFilterScope,
    setSearchResultsFilterScope,
    searchStatus,
    setSearchStatus,
    searchError,
    setSearchError,
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
  const toolbarRef = useRef<HTMLElement | null>(null);
  const singlePanelRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchShellRef = useRef<HTMLDivElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const themeButtonRef = useRef<HTMLButtonElement | null>(null);
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typeaheadQueryRef = useRef("");
  const typeaheadPaneRef = useRef<"tree" | "content" | null>(null);
  const panes = useExplorerPaneLayout({
    initialTreeWidth: DEFAULT_APP_PREFERENCES.treeWidth,
    initialInspectorWidth: DEFAULT_APP_PREFERENCES.inspectorWidth,
    inspectorVisible: infoPanelOpen,
    minContentWidth: EXPLORER_LAYOUT.minContentWidth,
  });
  const { width: toolbarWidth } = useElementSize(toolbarRef);
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
    showCachedSearchResults,
    startSearch,
    stopSearch,
    toggleSearchResultsSortDirection,
    updateSearchMatchScope,
    updateSearchPatternMode,
    updateSearchRecursive,
    updateSearchSkipGitFolders,
    updateSearchSkipGitIgnored,
    updateSearchResultsFilterQuery,
    updateSearchResultsFilterScope,
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
  const activeContentEntries = useMemo(
    () => (isSearchMode ? searchResultEntries : browseEntries),
    [browseEntries, isSearchMode, searchResultEntries],
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
    handleTreeKeyboardAction,
    goBack,
    goForward,
    goHome,
    rerootTreeAtHome,
    rootTreeAtPath,
    goHomeAndRootTree,
    goQuickAccess,
    navigateToParentFolder,
    navigateTreeSelectionToParent,
    selectTreeItem,
    clearTreeSelection,
    initializeTree,
    navigateTo,
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
      locationDialogOpen,
      explorerFocusSuppressed,
    },
    callbacks: {
      onLocationPathSubmitted: setLastGoToFolderPath,
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
  const {
    closeContextMenu,
    activateContentEntry,
    activateContentPaths,
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
    runCopyPathAction,
    selectAllContentEntries,
    setSingleContentSelection,
    showCopyPasteProgressCard,
    showCopyPasteResultDialog,
    surfaceCopyLikePreStartFailureToast,
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
  } = useExplorerDragAndDrop({
    activeEntries: activeContentEntries,
    selectedPathsInViewOrder,
    homePath,
    blocked: dragDropBlocked,
    onMoveToDestination: async (sourcePaths, destinationDirectoryPath, options) => {
      const outcome = await startMoveToDestination(sourcePaths, destinationDirectoryPath, options);
      if (outcome.status === "blocked" || outcome.status === "error") {
        surfaceCopyLikePreStartFailureToast("move_to", outcome);
      }
      return outcome.status === "queued" || outcome.status === "review";
    },
    onToggleTreeNode: toggleTreeNode,
  });
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
    ],
  );

  const { runRendererCommand } = useExplorerShortcuts({
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    derived: {
      shortcutContext,
      copyPasteModalOpen,
      locationDialogOpen,
      searchResultEntries,
      selectedTreeTargetPath,
      selectedPathsInViewOrder,
      selectedEntry,
      activeContentEntries,
      isSearchMode,
      hasCachedSearch,
    },
    actions: {
      dismissActionNotice,
      handleCopyPasteDialogEscape,
      openActionLogView,
      openSettingsView,
      openLocationSheet,
      focusFileSearch,
      clearTypeahead,
      applyContentSelection,
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
      handleTreeKeyboardAction,
      navigateTreeSelectionToParent,
      activateContentPaths,
      extendContentSelectionToPath,
      setSingleContentSelection,
      selectAllContentEntries,
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
    iconTheme,
    accent,
    accentToolbarButtons,
    toolbarAccent,
    accentFavoriteItems,
    accentFavoriteText,
    favoriteAccent,
    zoomPercent,
    uiFontFamily,
    textPrimaryOverride,
    textSecondaryOverride,
    textMutedOverride,
    viewMode,
    sortBy,
    sortDirection,
    foldersFirst,
    compactListView,
    compactDetailsView,
    compactTreeView,
    singleClickExpandTreeItems,
    highlightHoveredItems,
    detailColumns,
    detailColumnWidths,
    tabSwitchesExplorerPanes,
    typeaheadEnabled,
    typeaheadDebounceMs,
    notificationsEnabled,
    notificationDurationSeconds,
    actionLogEnabled,
    topToolbarItems,
    leftToolbarItems,
    showSidebarRail,
    showSidebarBottomRail,
    propertiesOpen: infoPanelOpen,
    detailRowOpen: infoRowOpen,
    terminalApp,
    defaultTextEditor,
    openWithApplications,
    fileActivationAction,
    returnKeyAction,
    openItemLimit,
    includeHidden,
    // The search options (pattern, match, subfolders, Git skipping, filter scope) are left
    // out on purpose: what is chosen in the search field or results bar lasts for this run
    // only. Settings owns the saved defaults, which each launch starts from.
    searchResultsSortBy,
    searchResultsSortDirection,
    treeWidth: panes.treeWidth,
    inspectorWidth: panes.inspectorWidth,
    restoreLastVisitedFolderOnStartup,
    treeRootPath: treeRootPath || null,
    lastVisitedPath: currentPath || null,
    lastVisitedFavoritePath:
      getFavoriteItemPath(selectedTreeItemId) === currentPath
        ? getFavoriteItemPath(selectedTreeItemId)
        : null,
    lastGoToFolderPath,
    favorites,
    favoritesPlacement,
    favoritesPaneHeight,
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
      if (patch.searchResultsFilterScope !== undefined) {
        setSearchResultsFilterScope(patch.searchResultsFilterScope);
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
        setIconTheme(preferences.iconTheme);
        setAccent(preferences.accent);
        setAccentToolbarButtons(preferences.accentToolbarButtons);
        setToolbarAccent(preferences.toolbarAccent);
        setAccentFavoriteItems(preferences.accentFavoriteItems);
        setAccentFavoriteText(preferences.accentFavoriteText);
        setFavoriteAccent(preferences.favoriteAccent);
        setZoomPercent(preferences.zoomPercent);
        setUiFontFamily(preferences.uiFontFamily);
        setTextPrimaryOverride(preferences.textPrimaryOverride);
        setTextSecondaryOverride(preferences.textSecondaryOverride);
        setTextMutedOverride(preferences.textMutedOverride);
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
        setSearchResultsFilterScope(preferences.searchResultsFilterScope);
        setViewMode(preferences.viewMode);
        setFoldersFirst(preferences.foldersFirst);
        setCompactListView(preferences.compactListView);
        setCompactDetailsView(preferences.compactDetailsView);
        setCompactTreeView(preferences.compactTreeView);
        setSingleClickExpandTreeItems(preferences.singleClickExpandTreeItems);
        setHighlightHoveredItems(preferences.highlightHoveredItems);
        setDetailColumns(preferences.detailColumns);
        setDetailColumnWidths(preferences.detailColumnWidths);
        setTabSwitchesExplorerPanes(preferences.tabSwitchesExplorerPanes);
        setTypeaheadEnabled(preferences.typeaheadEnabled);
        setTypeaheadDebounceMs(preferences.typeaheadDebounceMs);
        setNotificationsEnabled(preferences.notificationsEnabled);
        setNotificationDurationSeconds(preferences.notificationDurationSeconds);
        setActionLogEnabled(preferences.actionLogEnabled);
        setTopToolbarItems(preferences.topToolbarItems);
        setLeftToolbarItems(preferences.leftToolbarItems);
        setShowSidebarRail(preferences.showSidebarRail);
        setShowSidebarBottomRail(preferences.showSidebarBottomRail);
        setInfoPanelOpen(preferences.propertiesOpen);
        setInfoRowOpen(preferences.detailRowOpen);
        setSortBy(preferences.sortBy);
        setSortDirection(preferences.sortDirection);
        setRestoreLastVisitedFolderOnStartup(preferences.restoreLastVisitedFolderOnStartup);
        setLastGoToFolderPath(preferences.lastGoToFolderPath);
        setFavorites(preferences.favorites);
        setFavoritesPlacement(preferences.favoritesPlacement);
        setFavoritesPaneHeight(preferences.favoritesPaneHeight);
        setFavoritesExpanded(preferences.favoritesExpanded);
        setFavoritesInitialized(preferences.favoritesInitialized);
        setTerminalApp(preferences.terminalApp);
        setDefaultTextEditor(preferences.defaultTextEditor);
        setOpenWithApplications(preferences.openWithApplications);
        setFileActivationAction(preferences.fileActivationAction);
        setOpenItemLimit(preferences.openItemLimit);
        setReturnKeyAction(preferences.returnKeyAction);
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
        const { startupPath, startupRootPath, startupFavoritePath } = resolveStartupNavigation(
          preferences,
          homeResponse.path,
          launchContextResponse.startupFolderPath,
        );
        initializeTree(startupRootPath);
        const restoredFavoritePath =
          startupFavoritePath && isFavoritePath(preferences.favorites, startupFavoritePath)
            ? startupFavoritePath
            : null;
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
          preferences.sortBy,
          preferences.sortDirection,
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
            preferences.sortBy,
            preferences.sortDirection,
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
  }, [setThemeMenuOpen, themeMenuOpen]);

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
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setMainView("explorer");
    setLocationError(null);
    setFocusedPane(null);
    setLocationSheetInitialPath(currentPath);
    setLocationSheetOpen(true);
    void (async () => {
      const rememberedPath = lastGoToFolderPath?.trim() ?? "";
      if (rememberedPath.length === 0 || rememberedPath === currentPath) {
        return;
      }
      try {
        const response = await client.invoke("item:getProperties", { path: rememberedPath });
        if (
          response.item &&
          (response.item.kind === "directory" || response.item.kind === "symlink_directory")
        ) {
          setLocationSheetInitialPath(rememberedPath);
        }
      } catch {
        return;
      }
    })();
  }

  // Settings is a separate window (like any macOS app); main opens or focuses it.
  function openSettingsView() {
    setThemeMenuOpen(false);
    setSearchPopoverOpen(false);
    void client.invoke("app:openSettingsWindow", {}).catch((error) => {
      logger.error("open settings window failed", error);
    });
  }

  function openActionLogView() {
    if (!actionLogEnabled) {
      return;
    }
    setLocationSheetOpen(false);
    setLocationError(null);
    setThemeMenuOpen(false);
    setSearchPopoverOpen(false);
    setMainView("action-log");
  }

  const refreshActionLog = useCallback(async () => {
    if (!actionLogEnabled) {
      setActionLogEntries([]);
      setActionLogError(null);
      return;
    }
    setActionLogLoading(true);
    setActionLogError(null);
    try {
      const response = await client.invoke("actionLog:list", {});
      setActionLogEntries(response.items);
    } catch (error) {
      logger.error("action log load failed", error);
      setActionLogError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionLogLoading(false);
    }
  }, [actionLogEnabled, client]);

  async function copyActionLogEntryText(text: string) {
    await client.invoke("system:copyText", { text });
  }

  useEffect(() => {
    if (!actionLogEnabled && mainView === "action-log") {
      setMainView("explorer");
      return;
    }
    if (mainView !== "action-log" || !actionLogEnabled) {
      return;
    }
    void refreshActionLog();
  }, [actionLogEnabled, mainView, refreshActionLog, setMainView]);

  function navigateDownAction() {
    if (focusedPane === "tree") {
      void openTreeNode();
      return;
    }
    if (selectedEntry) {
      const pathsToActivate =
        selectedPathsInViewOrder.length > 0 ? selectedPathsInViewOrder : [selectedEntry.path];
      void activateContentPaths(pathsToActivate);
    }
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
            toolbarRef={toolbarRef}
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
              onGoHome: goHome,
              canGoBack,
              onGoBack: goBack,
              canGoForward,
              onGoForward: goForward,
              canNavigateToParent: parentDirectoryPath(currentPath) !== null,
              onNavigateToParent: navigateToParentFolder,
              canNavigateDown: focusedPane === "tree" || selectedEntry !== null,
              onNavigateDown: navigateDownAction,
              onRerootHome: rerootTreeAtHome,
              onOpenLocation: openLocationSheet,
              onQuickAccess: goQuickAccess,
              foldersFirst,
              onToggleFoldersFirst: toggleFoldersFirst,
              infoPanelOpen,
              onToggleInfoPanel: () => setInfoPanelOpen((value) => !value),
              infoRowOpen,
              onToggleInfoRow: () => setInfoRowOpen((value) => !value),
              leftToolbarItems,
              theme,
              themeMenuOpen,
              themeButtonRef,
              themeMenuRef,
              onToggleThemeMenu: () => setThemeMenuOpen((value) => !value),
              onSelectTheme: (nextTheme) => {
                setTheme(nextTheme);
                setThemeMenuOpen(false);
              },
              actionLogEnabled,
              onOpenActionLog: openActionLogView,
              onOpenHelp: () => setMainView("help"),
              onOpenSettings: openSettingsView,
              includeHidden,
              onToggleHidden: toggleHiddenFiles,
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
              onClearSelection: clearTreeSelection,
              onSelectFavoritesRoot: async () => {
                await selectTreeItem(getFavoritesRootItemId(), "skip");
                return undefined;
              },
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
              canRunRendererCommand,
              onRendererCommand: runRendererCommand,
            }}
            searchWorkspaceProps={{
              isSearchMode,
              searchResultsKey: `${searchRootPath}:${searchCommittedQuery}`,
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
                truncated: searchTruncated,
                filterQuery: searchResultsFilterQuery,
                filterScope: searchResultsFilterScope,
                totalCount: searchResults.length,
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
                onFilterQueryChange: updateSearchResultsFilterQuery,
                onFilterScopeChange: updateSearchResultsFilterScope,
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
                onActivateResult: (item) => {
                  void activateContentEntry(toDirectoryEntryFromSearchResult(item));
                },
                onItemContextMenu: (path, position) => {
                  openItemContextMenu(path, position, "search");
                },
                onItemDragStart: (item, event) =>
                  handleSearchDragStart(toDirectoryEntryFromSearchResult(item), "search", event),
                onItemDragEnd: handleDragEnd,
                onFocusChange: (focused) => setFocusedPane(focused ? "content" : null),
                onTypeaheadInput: (key) => handleTypeaheadInput(key, "content"),
                typeaheadQuery: focusedPane === "content" ? typeaheadQuery : "",
                scrollTop: searchResultsScrollTop,
                onScrollTopChange: setSearchResultsScrollTop,
              },
              contentPaneProps: {
                paneRef: contentPaneRef,
                isFocused: focusedPane === "content",
                currentPath,
                entries: browseEntries,
                loading: directoryLoading,
                error: directoryError,
                includeHidden,
                metadataByPath,
                selectedPaths: contentSelection.paths,
                selectionLeadPath: contentSelection.leadPath,
                viewMode,
                onSelectionGesture: handleContentSelectionGesture,
                onClearSelection: clearContentSelection,
                onActivateEntry: (entry) => {
                  void activateContentEntry(entry);
                },
                onFocusChange: (focused) => setFocusedPane(focused ? "content" : null),
                sortBy,
                sortDirection,
                onSortChange: handleSortChange,
                onLayoutColumnsChange: setContentColumns,
                onVisiblePathsChange: setVisiblePaths,
                onNavigatePath: (path) => void navigateTo(path, "push"),
                onRequestPathSuggestions: (inputPath) =>
                  requestPathSuggestions({
                    client,
                    includeHidden,
                    homePath,
                    inputPath,
                  }),
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
                highlightHoveredItems,
                detailColumns,
                detailColumnWidths,
                onDetailColumnWidthsChange: setDetailColumnWidths,
                tabSwitchesExplorerPanes,
                typeaheadQuery: focusedPane === "content" ? typeaheadQuery : "",
                statusSummary: buildContentStatusSummary({
                  itemCount: currentEntries.length,
                  selectedPaths: contentSelection.paths,
                  getKnownSizeBytes: (path) => {
                    const folderSize = folderSizeCache.getEntry(path);
                    if (folderSize.status === "ready") {
                      return folderSize.sizeBytes;
                    }
                    const metadata = metadataByPath[path];
                    const entry = currentEntries.find((candidate) => candidate.path === path);
                    if (!entry || entry.kind === "directory" || entry.kind === "bundle") {
                      return null;
                    }
                    return metadata?.sizeStatus === "ready" ? metadata.sizeBytes : null;
                  },
                  availableBytes: volumeAvailableBytes,
                }),
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
              copyPathDisabled: isWriteOperationLocked,
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
            explorerToolbarLayout={explorerToolbarLayout}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            focusedPane={focusedPane}
            selectedEntryExists={selectedEntry !== null}
            goBack={goBack}
            goForward={goForward}
            navigateToParentFolder={navigateToParentFolder}
            navigateDownAction={navigateDownAction}
            refreshDirectory={refreshDirectory}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
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
              void startSearch(searchDraftQuery).finally(() => {
                dismissFileSearch({ focusBelow: true });
              });
            }}
            searchInputRef={searchInputRef}
            searchDraftQuery={searchDraftQuery}
            onSearchInputFocus={() => {
              searchPointerIntentRef.current = false;
              setFocusedPane(null);
              clearTypeahead();
              setSearchPopoverOpen(true);
              showCachedSearchResults();
            }}
            onSearchDraftQueryChange={(nextValue) => {
              setSearchDraftQuery(nextValue);
              if (nextValue.trim().length === 0) {
                void clearCommittedSearch();
              }
            }}
            onSearchInputEscape={() => {
              dismissFileSearch({ focusBelow: true });
            }}
            onClearSearchDraft={() => {
              setSearchDraftQuery("");
              void clearCommittedSearch().finally(() => {
                focusFileSearch(false);
              });
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
            onPaneResizeKey={handlePaneResizeKey}
            showSidebarRail={showSidebarRail}
            showSidebarBottomRail={showSidebarBottomRail}
            toolbarTitle={
              isSearchMode
                ? `Searching “${getFolderDisplayName(searchRootPath)}”`
                : getFolderDisplayName(currentPath)
            }
            toolbarSubtitle={
              isSearchMode
                ? formatSearchStatus({
                    isSearching: searchStatus === "running",
                    shown: filteredSearchResults.length,
                    totalCount: searchResults.length,
                    elapsedMs: searchElapsedMs,
                    selectedCount: contentSelection.paths.length,
                  })
                : directoryLoading
                  ? "Loading…"
                  : `${currentEntries.length} ${currentEntries.length === 1 ? "item" : "items"}`
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
              <span className="single-panel-title">
                {mainView === "action-log" ? "Action Log" : "Help"}
              </span>
            </header>
            <section ref={singlePanelRef} className="pane single-panel-pane">
              {mainView === "help" ? (
                <HelpView layoutMode={singlePanelLayout} />
              ) : mainView === "action-log" ? (
                <ActionLogView
                  entries={actionLogEntries}
                  loading={actionLogLoading}
                  error={actionLogError}
                  theme={effectiveTheme}
                  accent={accent}
                  layoutMode={singlePanelLayout}
                  onCopyEntryText={copyActionLogEntryText}
                  onRefresh={() => {
                    void refreshActionLog();
                  }}
                />
              ) : null}
            </section>
          </section>
        )}
        <AppDialogs
          currentPath={locationSheetInitialPath || currentPath}
          onRequestPathSuggestions={(inputPath) =>
            requestPathSuggestions({ client, includeHidden, homePath, inputPath })
          }
          onSubmitLocationPath={(path) => void submitLocationPath(path)}
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
  // Icons take the icon theme from here so a change re-renders them all at once.
  return <IconThemeProvider value={iconTheme}>{workspace}</IconThemeProvider>;
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

function getFolderDisplayName(path: string): string {
  if (path === "/") {
    return "Macintosh HD";
  }
  return path.length > 0 ? getPathLeafName(path) : "";
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
