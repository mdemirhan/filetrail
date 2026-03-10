import { useEffect, useMemo, useRef } from "react";

import type { IpcRequest, IpcResponse, WriteOperationProgressEvent } from "@filetrail/contracts";

import {
  ACCENT_OPTIONS,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TEXT_EDITOR,
  DEFAULT_TERMINAL_APPLICATION,
  type FavoritePreference,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  NOTIFICATION_DURATION_SECONDS_OPTIONS,
  THEME_OPTIONS,
  TYPEAHEAD_DEBOUNCE_OPTIONS,
  UI_FONT_OPTIONS,
  UI_FONT_SIZE_OPTIONS,
  UI_FONT_WEIGHT_OPTIONS,
  clampOpenItemLimit,
  clampZoomPercent,
} from "../shared/appPreferences";
import { AppDialogs } from "./components/AppDialogs";
import { ExplorerWorkspace } from "./components/ExplorerWorkspace";
import { HelpView } from "./components/HelpView";
import { InfoRow } from "./components/InfoRow";
import { SettingsView } from "./components/SettingsView";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { useElementSize } from "./hooks/useElementSize";
import { useExplorerActions } from "./hooks/useExplorerActions";
import { useExplorerNavigation } from "./hooks/useExplorerNavigation";
import { useExplorerNavigationController } from "./hooks/useExplorerNavigationController";
import { useExplorerPaneLayout } from "./hooks/useExplorerPaneLayout";
import { useExplorerSearchController } from "./hooks/useExplorerSearchController";
import { useExplorerShortcuts } from "./hooks/useExplorerShortcuts";
import { useSearchSession } from "./hooks/useSearchSession";
import { useWriteOperations } from "./hooks/useWriteOperations";
import {
  type ContentSelectionState,
  EMPTY_CONTENT_SELECTION,
  setSingleContentSelection as createSingleContentSelection,
} from "./lib/contentSelection";
import { buildPasteRequest } from "./lib/copyPasteClipboard";
import {
  createOpenItemLimitMessage,
  formatPathForShell,
  getPathLeafName,
  isDirectoryLikeEntry,
  isEditableFileEntry,
  resolveNewFolderTargetPath,
  resolvePasteDestinationPath,
  resolveWriteOperationSelectionDirectoryPath,
  shouldRenderCopyPasteResultDialog,
  toDirectoryEntryFromSearchResult,
} from "./lib/explorerAppUtils";
import { type DirectoryEntry } from "./lib/explorerTypes";
import { FileIcon } from "./lib/fileIcons";
import { useFiletrailClient } from "./lib/filetrailClient";
import { formatDateTime, formatPermissionMode, formatSize } from "./lib/formatting";
import { REFERENCE_ITEMS, SHORTCUT_ITEMS } from "./lib/helpContent";
import { EXPLORER_LAYOUT } from "./lib/layoutTokens";
import { createRendererLogger } from "./lib/logging";
import { resolveExplorerToolbarLayout, resolveSinglePanelLayout } from "./lib/responsiveLayout";
import { resolveStartupNavigation } from "./lib/startupNavigation";
import { getThemeAppearanceDefaults } from "./lib/theme";
import { type ToastEntry, type ToastKind, createToastEntry, enqueueToast } from "./lib/toasts";
import {
  createFavorite,
  createFileSystemItemId,
  createFavoriteItemId,
  getFavoriteItemPath,
  getDefaultFavorites,
  isFavoritePath,
} from "./lib/favorites";

const logger = createRendererLogger("filetrail.renderer");

export function App() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const client = useFiletrailClient();
  const {
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
    restoreLastVisitedFolderOnStartup,
    setRestoreLastVisitedFolderOnStartup,
    favorites,
    setFavorites,
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
    resetAppearanceSettings,
  } = useAppPreferences();
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
    themeMenuOpen,
    setThemeMenuOpen,
    typeaheadQuery,
    setTypeaheadQuery,
    typeaheadPane,
    setTypeaheadPane,
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
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
  } = useExplorerNavigation();
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
    searchIncludeHidden,
    setSearchIncludeHidden,
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
  } = useSearchSession();
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
  } = useWriteOperations();
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
  function applyContentSelectionBridge(
    selection: ContentSelectionState,
    entries: DirectoryEntry[],
  ) {
    selectedPathsInViewOrderRef.current = entries
      .filter((entry) => selection.paths.includes(entry.path))
      .map((entry) => entry.path);
    selectedEntryRef.current =
      entries.find((entry) => entry.path === selection.leadPath) ??
      entries.find((entry) => selection.paths.includes(entry.path)) ??
      null;
    setContentSelection(selection);
  }
  function clearTypeaheadBridge() {
    if (typeaheadTimeoutRef.current) {
      clearTimeout(typeaheadTimeoutRef.current);
      typeaheadTimeoutRef.current = null;
    }
    typeaheadQueryRef.current = "";
    typeaheadPaneRef.current = null;
    setTypeaheadQuery("");
    setTypeaheadPane(null);
  }
  function focusContentPaneBridge() {
    setFocusedPane("content");
    clearTypeaheadBridge();
    window.requestAnimationFrame(() => {
      contentPaneRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        contentPaneRef.current?.focus({ preventScroll: true });
      });
    });
  }
  const {
    applySearchResultsSort,
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
    updateSearchIncludeHidden,
    updateSearchMatchScope,
    updateSearchPatternMode,
    updateSearchRecursive,
    updateSearchResultsFilterQuery,
    updateSearchResultsFilterScope,
    updateSearchResultsSortBy,
  } = useExplorerSearchController({
    client,
    currentPath,
    currentEntries,
    contentSelection,
    applyContentSelection: applyContentSelectionBridge,
    focusContentPane: focusContentPaneBridge,
    searchInputRef,
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
    searchIncludeHidden,
    setSearchIncludeHidden,
    searchResultsSortBy,
    setSearchResultsSortBy,
    searchResultsSortDirection,
    setSearchResultsSortDirection,
    setSearchPopoverOpen,
    searchResultsVisible,
    setSearchResultsVisible,
    searchResults,
    setSearchResults,
    setSearchResultsScrollTop,
    setSearchResultsFilterQuery,
    debouncedSearchResultsFilterQuery,
    setDebouncedSearchResultsFilterQuery,
    searchResultsFilterScope,
    setSearchResultsFilterScope,
    setSearchStatus,
    setSearchError,
    setSearchTruncated,
    searchPollTimeoutRef,
    searchSessionRef,
    searchJobIdRef,
    searchCommittedQueryRef,
    searchResultsVisibleRef,
    searchResultsSortByRef,
    searchResultsSortDirectionRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
  });
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
  function setSingleContentSelectionBridge(path: string) {
    applyContentSelectionBridge(createSingleContentSelection(path), activeContentEntries);
  }
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
        ? (activeContentEntries.find((entry) => entry.path === contextMenuState.targetPath) ?? null)
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
    [
      contextMenuState,
      contextMenuTargetEntry,
      currentPath,
      focusedPane,
      isSearchMode,
      selectedEntry,
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
    goQuickAccess,
    navigateToParentFolder,
    navigateTreeSelectionToParent,
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
    client,
    preferencesReady,
    mainView,
    locationDialogOpen,
    explorerFocusSuppressed,
    actionNotice,
    contextMenuState,
    searchShellRef,
    searchPointerIntentRef,
    treePaneRef,
    contentPaneRef,
    typeaheadTimeoutRef,
    typeaheadQueryRef,
    typeaheadPaneRef,
    typeaheadDebounceMs,
    typeaheadEnabled,
    homePath,
    treeRootPath,
    setTreeRootPath,
    treeNodes,
    setTreeNodes,
    favorites,
    favoritesExpanded,
    setFavoritesExpanded,
    selectedTreeItemId,
    setSelectedTreeItemId,
    currentPath,
    setCurrentPath,
    currentEntries,
    setCurrentEntries,
    activeContentEntries,
    metadataByPath,
    setMetadataByPath,
    directoryLoading,
    setDirectoryLoading,
    setDirectoryError,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    foldersFirst,
    setFoldersFirst,
    includeHidden,
    setIncludeHidden,
    viewMode,
    compactListView,
    compactDetailsView,
    compactTreeView,
    contentSelection,
    contentColumns,
    setVisiblePaths,
    visiblePaths,
    historyPaths,
    setHistoryPaths,
    historyIndex,
    setHistoryIndex,
    locationSubmitting,
    setLocationSubmitting,
    setLocationSheetOpen,
    setLocationError,
    focusedPane,
    setFocusedPane,
    typeaheadQuery,
    typeaheadPane,
    setTypeaheadPane,
    setTypeaheadQuery,
    infoPanelOpen,
    infoRowOpen,
    setGetInfoLoading,
    setGetInfoItem,
    panes,
    searchCommittedQuery,
    searchResultsVisible,
    setSearchResultsVisible,
    searchResultsVisibleRef,
    isSearchModeRef,
    applyContentSelection: applyContentSelectionBridge,
    setSingleContentSelection: setSingleContentSelectionBridge,
    directoryRequestRef,
    getInfoRequestRef,
    treeRequestRef,
    treeNodesRef,
    selectedTreeItemIdRef,
    treeRootPathRef,
    metadataCacheRef,
    metadataInflightRef,
    currentPathRef,
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
    pendingPasteSelectionRef,
  });
  const {
    addOpenWithApplication,
    activateContentEntry,
    activateContentPaths,
    applyContentSelection,
    browseDefaultTextEditor,
    browseForDirectoryPath,
    browseOpenWithApplication,
    browseTerminalApplication,
    cancelWriteOperation,
    clearContentSelection,
    contextMenuDisabledActionIds,
    contextMenuFavoriteToggleLabel,
    contextMenuHiddenActionIds,
    contextMenuSubmenuItems,
    copyGetInfoPath,
    dismissActionNotice,
    dismissCopyPasteDialog,
    dismissToast,
    editPaths,
    executeCopyLikePlan,
    extendContentSelectionToPath,
    handleContentSelectionGesture,
    handleCopyPasteDialogEscape,
    moveOpenWithApplication,
    openItemContextMenu,
    openNewFolderDialog,
    openPathExternally,
    openPathInTerminal,
    openPaths,
    openRenameDialog,
    openMoveDialog,
    removeOpenWithApplication,
    resolveContentActionPaths,
    retryFailedCopyPasteItems,
    runContextMenuAction,
    runContextSubmenuAction,
    runCopyClipboardAction,
    runCopyPathAction,
    selectAllContentEntries,
    setSingleContentSelection,
    showCopyPasteProgressCard,
    showCopyPasteResultDialog,
    startDuplicatePaths,
    startPasteFromClipboard,
    startTrashPaths,
    submitMoveDialog,
    submitNewFolderDialog,
    submitRenameDialog,
    toggleContentSelection,
  } = useExplorerActions({
    client,
    mainView,
    focusedPane,
    setFocusedPane,
    setInfoPanelOpen,
    homePath,
    currentPath,
    currentEntries,
    activeContentEntries,
    selectedEntry,
    selectedPathsInViewOrder,
    selectedPathSet,
    contextMenuTargetEntries,
    contextMenuTargetEntry,
    favorites,
    setFavorites,
    pasteDestinationPath,
    isSearchMode,
    openItemLimit,
    notificationsEnabled,
    notificationDurationSeconds,
    fileActivationAction,
    defaultTextEditor,
    setDefaultTextEditor,
    setTerminalApp,
    openWithApplications,
    setOpenWithApplications,
    contentPaneRef,
    searchInputRef,
    setSearchPopoverOpen,
    clearTypeahead,
    focusContentPane,
    restoreExplorerPaneFocus,
    navigateTo,
    refreshDirectory,
    contentSelection,
    setContentSelection,
    currentPathRef,
    isSearchModeRef,
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
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
  });
  const copyPasteModalOpen =
    copyPasteDialogState !== null ||
    showCopyPasteResultDialog ||
    renameDialogState !== null ||
    newFolderDialogState !== null ||
    moveDialogState !== null;
  const shortcutContext = useMemo(
    () => ({
      actionNoticeOpen: actionNotice !== null,
      copyPasteModalOpen,
      focusedPane,
      locationSheetOpen: locationDialogOpen,
      mainView,
    }),
    [actionNotice, copyPasteModalOpen, focusedPane, locationDialogOpen, mainView],
  );

  useExplorerShortcuts({
    client,
    shortcutContext,
    actionNotice,
    dismissActionNotice,
    copyPasteModalOpen,
    handleCopyPasteDialogEscape,
    contextMenuState,
    setContextMenuState,
    locationDialogOpen,
    mainView,
    setMainView,
    openSettingsView,
    openLocationSheet,
    focusFileSearch,
    focusedPane,
    setFocusedPane,
    lastExplorerFocusPaneRef,
    treePaneRef,
    contentPaneRef,
    searchInputRef,
    clearTypeahead,
    setSearchPopoverOpen,
    setSearchResultsVisible,
    searchPointerIntentRef,
    searchCommittedQueryRef,
    cachedSearchSelectionRef,
    searchResultEntries,
    applyContentSelection,
    selectedPathsInViewOrder,
    currentPath,
    selectedEntry,
    activeContentEntries,
    contentSelection,
    contentColumns,
    isSearchMode,
    hasCachedSearch,
    tabSwitchesExplorerPanes,
    typeaheadEnabled,
    viewMode,
    showCachedSearchResults,
    hideSearchResults,
    goBack,
    goForward,
    navigateTo,
    openTreeNode,
    toggleHiddenFiles,
    refreshDirectory,
    applySearchResultsSort,
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
    setInfoPanelOpen,
    setInfoRowOpen,
    setZoomPercent,
  });

  useEffect(
    () => () => {
      if (typeaheadTimeoutRef.current) {
        clearTimeout(typeaheadTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!preferencesReady) {
      return;
    }
    void client.invoke("app:updatePreferences", {
      preferences: {
        theme,
        accent,
        accentToolbarButtons,
        accentFavoriteItems,
        accentFavoriteText,
        favoriteAccent,
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
        highlightHoveredItems,
        detailColumns,
        detailColumnWidths,
        tabSwitchesExplorerPanes,
        typeaheadEnabled,
        typeaheadDebounceMs,
        notificationsEnabled,
        notificationDurationSeconds,
        propertiesOpen: infoPanelOpen,
        detailRowOpen: infoRowOpen,
        terminalApp,
        defaultTextEditor,
        openWithApplications,
        fileActivationAction,
        openItemLimit,
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
        lastVisitedFavoritePath:
          getFavoriteItemPath(selectedTreeItemId) === currentPath
            ? getFavoriteItemPath(selectedTreeItemId)
            : null,
        favorites,
        favoritesExpanded,
        favoritesInitialized,
      },
    });
  }, [
    client,
    currentPath,
    selectedTreeItemId,
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
    highlightHoveredItems,
    detailColumns,
    detailColumnWidths,
    accent,
    accentToolbarButtons,
    accentFavoriteItems,
    accentFavoriteText,
    favoriteAccent,
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
    notificationDurationSeconds,
    openWithApplications,
    notificationsEnabled,
    openItemLimit,
    restoreLastVisitedFolderOnStartup,
    favorites,
    favoritesExpanded,
    favoritesInitialized,
    terminalApp,
    defaultTextEditor,
    theme,
    uiFontFamily,
    uiFontSize,
    textMutedOverride,
    textPrimaryOverride,
    textSecondaryOverride,
    treeRootPath,
    uiFontWeight,
    viewMode,
    fileActivationAction,
  ]);

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
        setTheme(preferences.theme);
        setAccent(preferences.accent);
        setAccentToolbarButtons(preferences.accentToolbarButtons);
        setAccentFavoriteItems(preferences.accentFavoriteItems);
        setAccentFavoriteText(preferences.accentFavoriteText);
        setFavoriteAccent(preferences.favoriteAccent);
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
        setHighlightHoveredItems(preferences.highlightHoveredItems);
        setDetailColumns(preferences.detailColumns);
        setDetailColumnWidths(preferences.detailColumnWidths);
        setTabSwitchesExplorerPanes(preferences.tabSwitchesExplorerPanes);
        setTypeaheadEnabled(preferences.typeaheadEnabled);
        setTypeaheadDebounceMs(preferences.typeaheadDebounceMs);
        setNotificationsEnabled(preferences.notificationsEnabled);
        setNotificationDurationSeconds(preferences.notificationDurationSeconds);
        setInfoPanelOpen(preferences.propertiesOpen);
        setInfoRowOpen(preferences.detailRowOpen);
        setRestoreLastVisitedFolderOnStartup(preferences.restoreLastVisitedFolderOnStartup);
        setFavorites(preferences.favorites);
        setFavoritesExpanded(preferences.favoritesExpanded);
        setFavoritesInitialized(preferences.favoritesInitialized);
        setTerminalApp(preferences.terminalApp);
        setDefaultTextEditor(preferences.defaultTextEditor);
        setOpenWithApplications(preferences.openWithApplications);
        setFileActivationAction(preferences.fileActivationAction);
        setOpenItemLimit(preferences.openItemLimit);
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
        if (restoredFavoritePath) {
          await loadTreeChildren(startupRootPath, preferences.includeHidden, false, startupRootPath);
        }
        void navigateTo(
          startupPath,
          "replace",
          preferences.includeHidden,
          undefined,
          undefined,
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
    setLocationSheetOpen(true);
  }

  function openSettingsView() {
    setLocationSheetOpen(false);
    setLocationError(null);
    setThemeMenuOpen(false);
    setSearchPopoverOpen(false);
    setMainView("settings");
  }

  async function addFavoriteFromSettings() {
    const pickedPath = await browseForDirectoryPath(currentPath || homePath);
    if (!pickedPath || isFavoritePath(favorites, pickedPath)) {
      return;
    }
    setFavorites((current) => [...current, createFavorite(pickedPath, homePath)]);
  }

  async function browseFavoriteInSettings(index: number) {
    const currentFavorite = favorites[index];
    if (!currentFavorite) {
      return;
    }
    const pickedPath = await browseForDirectoryPath(currentFavorite.path);
    if (!pickedPath) {
      return;
    }
    if (favorites.some((favorite, favoriteIndex) => favoriteIndex !== index && favorite.path === pickedPath)) {
      return;
    }
    setFavorites((current) =>
      current.map((favorite, favoriteIndex) =>
        favoriteIndex === index
          ? {
              path: pickedPath,
              icon: favorite.icon,
            }
          : favorite,
      ),
    );
  }

  function moveFavoriteInSettings(index: number, direction: "up" | "down") {
    setFavorites((current) => {
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || index >= current.length || targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [favorite] = next.splice(index, 1);
      if (!favorite) {
        return current;
      }
      next.splice(targetIndex, 0, favorite);
      return next;
    });
  }

  function removeFavoriteInSettings(index: number) {
    setFavorites((current) => current.filter((_, favoriteIndex) => favoriteIndex !== index));
  }

  function updateFavoriteIconInSettings(index: number, icon: FavoritePreference["icon"]) {
    setFavorites((current) =>
      current.map((favorite, favoriteIndex) =>
        favoriteIndex === index
          ? {
              ...favorite,
              icon,
            }
          : favorite,
      ),
    );
  }

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

  return (
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
            homePath,
            selectedTreeItemId,
            compactTreeView,
            nodes: treeNodes,
            favorites,
            favoritesExpanded,
            rootPath: treeRootPath,
            onFocusChange: (focused) => setFocusedPane(focused ? "tree" : null),
            onGoHome: goHome,
            onRerootHome: rerootTreeAtHome,
            onOpenLocation: openLocationSheet,
            onQuickAccess: goQuickAccess,
            foldersFirst,
            onToggleFoldersFirst: toggleFoldersFirst,
            infoPanelOpen,
            onToggleInfoPanel: () => setInfoPanelOpen((value) => !value),
            infoRowOpen,
            onToggleInfoRow: () => setInfoRowOpen((value) => !value),
            theme,
            themeMenuOpen,
            themeButtonRef,
            themeMenuRef,
            onToggleThemeMenu: () => setThemeMenuOpen((value) => !value),
            onSelectTheme: (nextTheme) => {
              setTheme(nextTheme);
              setThemeMenuOpen(false);
            },
            onOpenHelp: () => setMainView("help"),
            onOpenSettings: openSettingsView,
            includeHidden,
            onToggleHidden: toggleHiddenFiles,
            onNavigate: (path) => navigateTreeFileSystemPath(path, "push"),
            onNavigateFavorite: (path) =>
              navigateTo(path, "push", undefined, undefined, undefined, undefined, {
                syncTree: false,
                treeSelectionMode: "favorite",
                favoritePath: path,
                persistOnError: true,
              }),
            onToggleExpand: toggleTreeNode,
            onToggleFavoritesExpanded: () => setFavoritesExpanded((value) => !value),
            typeaheadQuery: focusedPane === "tree" ? typeaheadQuery : "",
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
              onSortByChange: updateSearchResultsSortBy,
              onSortDirectionToggle: toggleSearchResultsSortDirection,
              onApplySort: applySearchResultsSort,
              onSelectionGesture: handleContentSelectionGesture,
              onClearSelection: clearContentSelection,
              onActivateResult: (item) => {
                void activateContentEntry(toDirectoryEntryFromSearchResult(item));
              },
              onItemContextMenu: (path, position) => {
                openItemContextMenu(path, position, "search");
              },
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
              entries: currentEntries,
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
                  inputPath,
                }),
              onTypeaheadInput: (key) => handleTypeaheadInput(key, "content"),
              onItemContextMenu: (path, position) => {
                openItemContextMenu(path, position, "browse");
              },
              compactListView,
              compactDetailsView,
              highlightHoveredItems,
              detailColumns,
              detailColumnWidths,
              onDetailColumnWidthsChange: setDetailColumnWidths,
              tabSwitchesExplorerPanes,
              typeaheadQuery: focusedPane === "content" ? typeaheadQuery : "",
            },
            infoRow: (
              <InfoRow
                open={infoRowOpen}
                currentPath={currentPath}
                currentEntries={currentEntries}
                selectedEntry={selectedEntry}
                item={getInfoItem}
              />
            ),
            statusLabel: isSearchMode
              ? searchStatus === "running"
                ? `${filteredSearchResults.length} / ${searchResults.length} matches so far`
                : `${filteredSearchResults.length} / ${searchResults.length} matches`
              : `${currentEntries.length} items`,
            statusPathLabel: isSearchMode ? `Search root: ${searchRootPath}` : currentPath,
          }}
          infoPanelProps={{
            loading: getInfoLoading,
            item: getInfoItem,
            onClose: () => setInfoPanelOpen(false),
            onNavigateToPath: (path) => {
              void navigateTo(path, path === currentPath ? "replace" : "push");
            },
            onOpen: () => {
              if (getInfoItem) {
                void openPathExternally(getInfoItem.path);
              }
            },
            onOpenInTerminal: () => {
              if (getInfoItem) {
                void openPathInTerminal(getInfoItem.path);
              }
            },
            onCopyPath: () => (getInfoItem ? copyGetInfoPath(getInfoItem.path) : false),
            copyPathDisabled: isWriteOperationLocked,
          }}
          currentPath={currentPath}
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
          searchIncludeHidden={searchIncludeHidden}
          onSearchIncludeHiddenChange={updateSearchIncludeHidden}
          onPaneResizeKey={handlePaneResizeKey}
        />
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
                accentFavoriteItems={accentFavoriteItems}
                accentFavoriteText={accentFavoriteText}
                favoriteAccent={favoriteAccent}
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
                highlightHoveredItems={highlightHoveredItems}
                detailColumns={detailColumns}
                layoutMode={singlePanelLayout}
                tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
                typeaheadEnabled={typeaheadEnabled}
                typeaheadDebounceMs={typeaheadDebounceMs}
                notificationsEnabled={notificationsEnabled}
                notificationDurationSeconds={notificationDurationSeconds}
                restoreLastVisitedFolderOnStartup={restoreLastVisitedFolderOnStartup}
                homePath={homePath}
                terminalApp={terminalApp}
                defaultTextEditor={defaultTextEditor}
                favorites={favorites}
                openWithApplications={openWithApplications}
                fileActivationAction={fileActivationAction}
                openItemLimit={openItemLimit}
                themeOptions={[...THEME_OPTIONS]}
                accentOptions={[...ACCENT_OPTIONS]}
                uiFontOptions={[...UI_FONT_OPTIONS]}
                uiFontSizeOptions={[...UI_FONT_SIZE_OPTIONS]}
                uiFontWeightOptions={[...UI_FONT_WEIGHT_OPTIONS]}
                typeaheadDebounceOptions={[...TYPEAHEAD_DEBOUNCE_OPTIONS]}
                notificationDurationSecondsOptions={[...NOTIFICATION_DURATION_SECONDS_OPTIONS]}
                onThemeChange={setTheme}
                onAccentChange={setAccent}
                onAccentToolbarButtonsChange={setAccentToolbarButtons}
                onAccentFavoriteItemsChange={setAccentFavoriteItems}
                onAccentFavoriteTextChange={setAccentFavoriteText}
                onFavoriteAccentChange={setFavoriteAccent}
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
                onHighlightHoveredItemsChange={setHighlightHoveredItems}
                onDetailColumnsChange={setDetailColumns}
                onTabSwitchesExplorerPanesChange={setTabSwitchesExplorerPanes}
                onTypeaheadEnabledChange={setTypeaheadEnabled}
                onTypeaheadDebounceMsChange={setTypeaheadDebounceMs}
                onNotificationsEnabledChange={setNotificationsEnabled}
                onNotificationDurationSecondsChange={setNotificationDurationSeconds}
                onRestoreLastVisitedFolderOnStartupChange={setRestoreLastVisitedFolderOnStartup}
                onBrowseTerminalApp={() => {
                  void browseTerminalApplication();
                }}
                onClearTerminalApp={() => setTerminalApp(null)}
                onBrowseDefaultTextEditor={() => {
                  void browseDefaultTextEditor();
                }}
                onClearDefaultTextEditor={() => setDefaultTextEditor(DEFAULT_TEXT_EDITOR)}
                onAddFavorite={() => {
                  void addFavoriteFromSettings();
                }}
                onBrowseFavorite={(index) => {
                  void browseFavoriteInSettings(index);
                }}
                onMoveFavorite={moveFavoriteInSettings}
                onRemoveFavorite={removeFavoriteInSettings}
                onFavoriteIconChange={updateFavoriteIconInSettings}
                onAddOpenWithApplication={() => {
                  void addOpenWithApplication();
                }}
                onBrowseOpenWithApplication={(entryId) => {
                  void browseOpenWithApplication(entryId);
                }}
                onMoveOpenWithApplication={moveOpenWithApplication}
                onRemoveOpenWithApplication={removeOpenWithApplication}
                onFileActivationActionChange={setFileActivationAction}
                onOpenItemLimitChange={setOpenItemLimit}
              />
            )}
          </section>
        </section>
      )}
      <AppDialogs
        locationSheetOpen={locationSheetOpen}
        currentPath={currentPath}
        locationSubmitting={locationSubmitting}
        locationError={locationError}
        tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
        onRequestPathSuggestions={(inputPath) =>
          requestPathSuggestions({ client, includeHidden, inputPath })
        }
        onCloseLocationSheet={() => setLocationSheetOpen(false)}
        onSubmitLocationPath={(path) => void submitLocationPath(path)}
        moveDialogState={moveDialogState}
        onBrowseForDirectoryPath={browseForDirectoryPath}
        onCloseMoveDialog={() => setMoveDialogState(null)}
        onSubmitMoveDialog={(path) => void submitMoveDialog(path)}
        contextMenuState={contextMenuState}
        contextMenuDisabledActionIds={contextMenuDisabledActionIds}
        contextMenuFavoriteToggleLabel={contextMenuFavoriteToggleLabel}
        contextMenuHiddenActionIds={contextMenuHiddenActionIds}
        contextMenuSubmenuItems={contextMenuSubmenuItems}
        onRunContextMenuAction={(actionId, paths) => {
          void runContextMenuAction(actionId, paths);
        }}
        onRunContextSubmenuAction={(action, paths) => {
          void runContextSubmenuAction(action, paths);
        }}
        actionNotice={actionNotice}
        onDismissActionNotice={dismissActionNotice}
        renameDialogState={renameDialogState}
        onCloseRenameDialog={() => setRenameDialogState(null)}
        onSubmitRenameDialog={(value) => void submitRenameDialog(value)}
        newFolderDialogState={newFolderDialogState}
        onCloseNewFolderDialog={() => setNewFolderDialogState(null)}
        onSubmitNewFolderDialog={(value) => void submitNewFolderDialog(value)}
        copyPasteDialogState={copyPasteDialogState}
        onExecuteCopyLikePlan={(plan, action, options) => {
          void executeCopyLikePlan(plan, action, options);
        }}
        onCloseCopyPasteDialog={dismissCopyPasteDialog}
        showCopyPasteProgressCard={showCopyPasteProgressCard}
        writeOperationCardState={writeOperationCardState}
        onCancelWriteOperation={() => {
          void cancelWriteOperation();
        }}
        showCopyPasteResultDialog={showCopyPasteResultDialog}
        writeOperationProgressEvent={writeOperationProgressEvent}
        onRetryFailedCopyPasteItems={(event) => {
          void retryFailedCopyPasteItems(event);
        }}
        toasts={toasts}
        onDismissToast={dismissToast}
      />
    </main>
  );
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
