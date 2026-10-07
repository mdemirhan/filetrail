import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { IpcRequest, IpcResponse, WriteOperationProgressEvent } from "@filetrail/contracts";

import {
  type AppPreferences,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_TERMINAL_APPLICATION,
  DETAIL_COLUMN_LABELS,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  SORT_BY_ORDER,
  type SearchResultsSortByPreference,
  VIEW_MODE_NAMES,
  VIEW_MODE_ORDER,
  clampOpenItemLimit,
  clampSearchColumnWidth,
  clampZoomPercent,
} from "../shared/appPreferences";
import { isRendererCommandType } from "../shared/rendererCommands";
import { resolveShortcuts } from "../shared/shortcuts";
import { DEFAULT_TOP_TOOLBAR_ITEMS } from "../shared/toolbarItems";
import { type VisitedFolder, forgetVisitedFolder } from "../shared/visitedFolders";
import { AppDialogs } from "./components/AppDialogs";
import { BatchRenameSheet } from "./components/BatchRenameSheet";
import { ClipboardButton } from "./components/ClipboardButton";
import type { ListColumnSet } from "./components/ContentPane";
import { ExplorerWorkspace } from "./components/ExplorerWorkspace";
import type { InfoPanelSelection } from "./components/GetInfoPanel";
import { InfoRow } from "./components/InfoRow";
import { SearchBar, SearchResultsState } from "./components/SearchBar";
import type { SettingsTab } from "./components/SettingsView";
import { TabStrip } from "./components/TabStrip";
import { ToolbarIcon } from "./components/ToolbarIcon";
import { applyPreferencesPatch, useAppPreferences } from "./hooks/useAppPreferences";
import { getAutoFolderSizePath, useAutoFolderSize } from "./hooks/useAutoFolderSize";
import { useBatchRename } from "./hooks/useBatchRename";
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
import { useFolderWatch } from "./hooks/useFolderWatch";
import { useHiddenItemCount } from "./hooks/useHiddenItemCount";
import { usePreferencesSync } from "./hooks/usePreferencesSync";
import { useSearchSession } from "./hooks/useSearchSession";
import { useTextEditingFocus } from "./hooks/useTextEditingFocus";
import { useTrashState } from "./hooks/useTrashState";
import { useVolumes } from "./hooks/useVolumes";
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
import type { ContextMenuSubmenus } from "./lib/contextMenu";
import { describeClipboard } from "./lib/copyPasteClipboard";
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
  buildSidebarLocations,
  createFavoriteItemId,
  createFileSystemItemId,
  createLocationItemId,
  getDefaultFavorites,
  getFavoriteItemPath,
  getFavoritesRootItemId,
  getFileSystemItemPath,
  getLocationsRootItemId,
  getTrashPath,
  isFavoritePath,
  isFavoritesRootItemId,
  isTrashListingRefused,
  reorderFavorites,
} from "./lib/favorites";
import { measureFileDragImages } from "./lib/fileDragImages";
import { FileIcon, preloadGenericIcons } from "./lib/fileIcons";
import { getLoadedFileThumbnail } from "./lib/fileThumbnails";
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
import {
  buildSearchHighlightPattern,
  formatSearchResultFolder,
  formatSearchStatus,
} from "./lib/searchResults";
import { summarizeSelectionSize } from "./lib/selectionSize";
import { createShortcutDisplay } from "./lib/shortcutDisplay";
import type { canHandleRendererCommand } from "./lib/shortcutPolicy";
import { resolveStartupTabs, toStartupTab } from "./lib/startupNavigation";
import {
  buildContentStatusSummary,
  folderStatusSize,
  selectionStatusSize,
} from "./lib/statusSummary";
import { type ToastEntry, type ToastKind, createToastEntry, enqueueToast } from "./lib/toasts";
import { getVolumeRootPath, isVolumeRootPath } from "./lib/volumes";
import { ExplorerStoreProvider } from "./state/explorerStoreContext";
import { useExplorerServices, useSelectionActions } from "./state/explorerStores";
import { ShortcutDisplayProvider } from "./state/shortcutDisplayContext";

const logger = createRendererLogger("filetrail.renderer");

type PreferencesPersistPayload = IpcRequest<"app:updatePreferences">["preferences"];

export function App() {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const client = useFiletrailClient();
  // The Rename sheet for several items.
  const batchRename = useBatchRename(client);
  const { trashIsEmpty, refreshTrashState } = useTrashState(client);
  // The disks mounted besides the startup disk, kept up to date as they come and go.
  const volumes = useVolumes(client);
  // The plain folder and document icons, asked for before the first folder is drawn.
  useEffect(() => {
    preloadGenericIcons(client);
  }, [client]);
  // The folders that have been opened, loaded each time the Go To or Move To box opens.
  const [visitedFolders, setVisitedFolders] = useState<VisitedFolder[]>([]);
  // Capacity and free space of the volume the Info panel describes, when it is a volume's
  // root (Macintosh HD, a disk under /Volumes).
  const [infoPanelVolume, setInfoPanelVolume] = useState<{
    path: string;
    totalBytes: number | null;
    availableBytes: number | null;
  } | null>(null);
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
    effectiveTheme,
    accent,
    setAccent,
    zoomPercent,
    setZoomPercent,
    includeHidden,
    setIncludeHidden,
    viewMode,
    setViewMode,
    searchViewMode,
    setSearchViewMode,
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
    detailColumnOrder,
    setDetailColumnOrder,
    detailColumnWidths,
    setDetailColumnWidths,
    searchColumns,
    setSearchColumns,
    searchColumnOrder,
    setSearchColumnOrder,
    searchColumnWidths,
    setSearchColumnWidths,
    notificationsEnabled,
    setNotificationsEnabled,
    markClipboardItems,
    setMarkClipboardItems,
    autoCalculateFolderSizes,
    setAutoCalculateFolderSizes,
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
    locationsExpanded,
    setLocationsExpanded,
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
    folderTreeOpen,
    setFolderTreeOpen,
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
  const folderSizeCache = useFolderSizeCache(client, homePath);
  // The sidebar's Locations, as in Finder's: Home, Macintosh HD, the other disks, the Trash.
  const sidebarLocations = useMemo(
    () => buildSidebarLocations(volumes, homePath),
    [volumes, homePath],
  );
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
    foreignWriteOperation,
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
  // a folder gets a bar once its size has been calculated (calculating the folder it is in,
  // in the Info panel, sizes every folder inside).
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
  const hiddenItemCount = useHiddenItemCount(
    client,
    currentPath,
    !includeHidden && currentEntries.length === 0 && !directoryLoading && !directoryError,
  );
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
  // The view on screen: search results have one of their own in each tab, List to begin with.
  const shownViewMode = isSearchMode ? searchViewMode : viewMode;
  const setShownViewMode = isSearchMode ? setSearchViewMode : setViewMode;
  // Search results' List view: the columns chosen for search results in Settings, Name
  // first, with widths of their own. Name, Folder and Kind sort the results; the dates, size
  // and permissions load only for the rows on screen.
  const searchListColumns = useMemo<ListColumnSet>(
    () => ({
      keys: ["name", ...searchColumnOrder.filter((key) => searchColumns[key])],
      widths: searchColumnWidths,
      clampWidth: clampSearchColumnWidth,
      onWidthsChange: setSearchColumnWidths,
      getSortKey: (key) =>
        key === "name" ? "name" : key === "folder" ? "path" : key === "kind" ? "kind" : null,
      sortBy: searchResultsSortBy,
      sortDirection: searchResultsSortDirection,
      onSortChange: (sortKey) =>
        sortSearchResultsByColumn(sortKey as SearchResultsSortByPreference),
      getFolderLabel: (entry) => formatSearchResultFolder(entry.path, searchRootPath),
    }),
    [
      searchColumnOrder,
      searchColumnWidths,
      searchColumns,
      searchResultsSortBy,
      searchResultsSortDirection,
      searchRootPath,
      setSearchColumnWidths,
      sortSearchResultsByColumn,
    ],
  );
  const searchNameHighlight = useMemo(
    () => buildSearchHighlightPattern(searchCommittedQuery, searchPatternMode, searchMatchScope),
    [searchCommittedQuery, searchMatchScope, searchPatternMode],
  );
  const selectedPathSet = useMemo(() => new Set(contentSelection.paths), [contentSelection.paths]);
  const selectedPathsInViewOrder = useMemo(
    () =>
      activeContentEntries
        .filter((entry) => selectedPathSet.has(entry.path))
        .map((entry) => entry.path),
    [activeContentEntries, selectedPathSet],
  );
  // The size of several selected items, for the Info Row and the Info panel: files from the
  // list, folders from the folder size cache, and a total only once every size is known.
  // biome-ignore lint/correctness/useExhaustiveDependencies: folderSizeVersion changes whenever a cached folder size does; getEntry reads that cache.
  const selectionSize = useMemo(() => {
    if (selectedPathSet.size < 2) {
      return null;
    }
    return summarizeSelectionSize(
      activeContentEntries.filter((entry) => selectedPathSet.has(entry.path)),
      (path) => {
        // Search results have sizes of their own, read as they are shown.
        const metadata = (isSearchMode ? searchMetadataByPath : metadataByPath)[path];
        return metadata?.sizeStatus === "ready" ? metadata.sizeBytes : null;
      },
      getFolderSizeEntry,
    );
  }, [
    activeContentEntries,
    folderSizeVersion,
    getFolderSizeEntry,
    isSearchMode,
    metadataByPath,
    searchMetadataByPath,
    selectedPathSet,
  ]);
  const selectionTotalBytes = selectionSize?.totalBytes ?? null;
  // The size in the status bar: the selection's, or the folder on screen's with nothing
  // selected (search results have no folder of their own).
  // biome-ignore lint/correctness/useExhaustiveDependencies: folderSizeVersion changes whenever a cached folder size does; getEntry reads that cache.
  const statusSize = useMemo(() => {
    if (selectedPathSet.size === 0) {
      return isSearchMode || currentPath.length === 0
        ? null
        : folderStatusSize(getFolderSizeEntry(currentPath));
    }
    return selectionStatusSize(
      summarizeSelectionSize(
        unfilteredContentEntries.filter((entry) => selectedPathSet.has(entry.path)),
        (path) => {
          const metadata = (isSearchMode ? searchMetadataByPath : metadataByPath)[path];
          return metadata?.sizeStatus === "ready" ? metadata.sizeBytes : null;
        },
        getFolderSizeEntry,
      ),
    );
  }, [
    currentPath,
    folderSizeVersion,
    getFolderSizeEntry,
    isSearchMode,
    metadataByPath,
    searchMetadataByPath,
    selectedPathSet,
    unfilteredContentEntries,
  ]);
  // Several selected items, summed up in the Info panel.
  const infoPanelSelection = useMemo<InfoPanelSelection | null>(() => {
    if (selectedPathSet.size < 2) {
      return null;
    }
    let folderCount = 0;
    let fileCount = 0;
    const parents = new Set<string>();
    for (const entry of activeContentEntries) {
      if (!selectedPathSet.has(entry.path)) {
        continue;
      }
      if (entry.kind === "directory") {
        folderCount += 1;
      } else {
        fileCount += 1;
      }
      parents.add(entry.path.slice(0, Math.max(1, entry.path.lastIndexOf("/"))));
    }
    return {
      count: folderCount + fileCount,
      folderCount,
      fileCount,
      totalBytes: selectionTotalBytes,
      parentPath: parents.size === 1 ? ([...parents][0] ?? null) : null,
    };
  }, [activeContentEntries, selectedPathSet, selectionTotalBytes]);
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
  // With the Info panel showing it, the one folder selected is measured by itself, unless
  // that is turned off in Settings.
  useAutoFolderSize(
    getAutoFolderSizePath({
      infoPanelOpen:
        autoCalculateFolderSizes &&
        infoPanelOpen &&
        mainView === "explorer" &&
        infoTargetPathOverride === null,
      selectedPaths: contentSelection.paths,
      selectedEntry,
      homePath,
    }),
    folderSizeCache,
  );
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
    return markClipboardItems ? { tree: marks, content: marks } : { tree: null, content: null };
  }, [copyPasteClipboard, clipboardFlashing, markClipboardItems]);
  const pasteDestinationPath = useMemo(
    () =>
      resolvePasteDestinationPath({
        contextMenuState,
        contextMenuTargetEntry,
        clipboardSourcePaths,
        currentPath,
        isSearchMode,
        homePath,
      }),
    [
      contextMenuState,
      contextMenuTargetEntry,
      clipboardSourcePaths,
      currentPath,
      isSearchMode,
      homePath,
    ],
  );
  // One operation at a time in the whole app: this window's, or another window's.
  const isWriteOperationLocked = writeOperationCardState !== null || foreignWriteOperation !== null;
  const locationDialogOpen = locationSheetOpen || moveDialogState !== null;
  // While the toolbar is customized, in place, the rest of the window waits as it does
  // under a sheet: no shortcuts, menu commands, drags or focus for the panes.
  const [toolbarCustomizing, setToolbarCustomizing] = useState(false);
  const sheetOpen = locationDialogOpen || toolbarCustomizing;
  const explorerFocusSuppressed =
    copyPasteDialogState !== null ||
    writeOperationProgressEvent !== null ||
    renameDialogState !== null ||
    newFolderDialogState !== null ||
    moveDialogState !== null ||
    batchRename.sheet !== null;
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
    reloadFolderAfterOutsideChange,
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
    noteFolderUsed,
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
      locationDialogOpen: sheetOpen,
      explorerFocusSuppressed,
      locations: sidebarLocations,
      locationsExpanded,
    },
  });
  // Hiding the tree while it has the keyboard gives the keyboard to the list.
  useEffect(() => {
    if (!folderTreeOpen && focusedPane === "tree") {
      focusContentPane();
    }
  }, [folderTreeOpen, focusedPane, focusContentPane]);
  const navigateFavoritePath = useCallback(
    (path: string, historyMode: "push" | "replace" | "skip") =>
      navigateTo(path, historyMode, undefined, undefined, undefined, undefined, {
        fromSidebar: "favorite",
        treeSelectionMode: "favorite",
        favoritePath: path,
        persistOnError: true,
      }),
    [navigateTo],
  );
  // Tabs are set up after the actions (they need to know whether a dialog is open), so the
  // actions reach "open in a new tab" through this.
  const openPathInNewTabRef = useRef<(path: string) => void>(() => undefined);
  const openPathInNewWindowRef = useRef<(path: string) => void>(() => undefined);
  // The menu command this window was opened to run (see app:getLaunchContext).
  const initialCommandRef = useRef<string | null>(null);
  const {
    closeContextMenu,
    activateContentEntry,
    activateContentPaths,
    openFolderInNewTab,
    applyContentSelection,
    browseForDirectoryPath,
    cancelWriteOperation,
    clearContentSelection,
    confirmDotNameDialog,
    contextMenuDisabledActionIds,
    contextMenuOptions,
    contextMenuHiddenActionIds,
    openWithMenuItems,
    copyGetInfoPath,
    copyGetInfoName,
    dismissActionNotice,
    dismissCopyPasteDialog,
    closeConfirmationDialog,
    dismissToast,
    noticeDragRefusedWhileBusy,
    editPaths,
    extendContentSelectionToPath,
    handleContentSelectionGesture,
    selectContentPaths,
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
    startBatchRename,
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
    startCopyToDestination,
    startDuplicatePaths,
    startDuplicateOfSelection,
    requestEmptyTrash,
    confirmEmptyTrash,
    startMoveToDestination,
    startPasteFromClipboard,
    startTrashPaths,
    startDeleteImmediatelyPaths,
    startUndo,
    answerUndoQuestion,
    submitMoveDialog,
    submitNewFolderDialog,
    submitRenameDialog,
    toggleContentSelection,
    updateCopyPasteChoices,
    followItemsGoneElsewhere,
  } = useExplorerActions({
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    selection: selectionActions,
    derived: {
      activeContentEntries,
      unfilteredContentEntries,
      selectedPathsInViewOrder,
      selectedPathSet,
      contextMenuTargetEntries,
      contextMenuTargetEntry,
      pasteDestinationPath,
      isSearchMode,
      trashIsEmpty,
    },
    navActions: {
      restoreExplorerPaneFocus,
      navigateTo,
      navigateTreeFileSystemPath,
      rootTreeAtPath,
      toggleTreeNode,
      refreshDirectory,
      noteFolderUsed,
    },
    callbacks: {
      openPathInNewTab: (path) => openPathInNewTabRef.current(path),
      openPathInNewWindow: (path) => openPathInNewWindowRef.current(path),
      calculateFolderSize: (path) => folderSizeCache.recalculateFolderSize(path),
      calculateFolderSizes: (paths) => void folderSizeCache.calculateFolderSizes(paths),
      openBatchRename: (targets) => void batchRename.open(targets),
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
  // The background menu's View As and Sort By tick the current choice; Open With lists the
  // apps chosen in Settings.
  const contextMenuSubmenus = useMemo<ContextMenuSubmenus>(
    () => ({
      openWith: openWithMenuItems,
      viewAs: VIEW_MODE_ORDER.map((mode) => ({
        action: {
          kind: "viewMode",
          id: mode,
          label: VIEW_MODE_NAMES[mode],
          checked: shownViewMode === mode,
        },
      })),
      sortBy: SORT_BY_ORDER.map((value) => ({
        action: {
          kind: "sortBy",
          id: value,
          label: DETAIL_COLUMN_LABELS[value],
          checked: sortBy === value,
        },
      })),
    }),
    [openWithMenuItems, shownViewMode, sortBy],
  );
  const copyPasteModalOpen =
    (copyPasteDialogState !== null && copyPasteDialogState.type !== "analysis") ||
    showCopyPasteResultDialog ||
    // The "changed while pasting" prompt blocks the explorer until it is answered.
    (writeOperationProgressEvent?.status === "awaiting_resolution" &&
      Boolean(writeOperationProgressEvent.runtimeConflict)) ||
    renameDialogState !== null ||
    newFolderDialogState !== null ||
    moveDialogState !== null ||
    batchRename.sheet !== null;
  const {
    openTabs,
    activeTabIndex,
    restoreTabs,
    addTabs,
    openNewWindow,
    openPathInNewWindow,
    moveTabToNewWindow,
    sidebarScrollHeld,
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
    leaveUnmountedDisksInBackgroundTabs,
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
      blocked: copyPasteModalOpen || sheetOpen || actionNotice !== null,
    },
  });
  // The window goes by its front tab's name in the Window menu, ⌘` and Mission Control,
  // as a Finder window goes by its folder's.
  const activeTabLabel = tabItems.find((tab) => tab.active)?.label ?? "";
  useEffect(() => {
    document.title = activeTabLabel.length > 0 ? activeTabLabel : "File Trail";
  }, [activeTabLabel]);
  openPathInNewTabRef.current = openPathInNewTab;
  openPathInNewWindowRef.current = openPathInNewWindow;
  // Window › Merge All Windows: the other windows close and their tabs come here.
  const mergeAllWindows = () => {
    void client
      .invoke("app:mergeAllWindows", {})
      .then(({ tabs }) =>
        addTabs(
          tabs.map((tab) => {
            const startupTab = toStartupTab(tab, homePath);
            // A favorite that was removed since is opened as the plain folder it is.
            return startupTab.favoritePath && !isFavoritePath(favorites, startupTab.favoritePath)
              ? { ...startupTab, favoritePath: null }
              : startupTab;
          }),
          favoritesPlacement,
        ),
      )
      .catch(() => undefined);
  };
  // A disk unmounted takes its folders with it: tabs showing one go Home.
  const mountedDiskPathsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const mounted = new Set(volumes.map((volume) => volume.path));
    const unmounted = new Set(
      [...mountedDiskPathsRef.current].filter((path) => !mounted.has(path)),
    );
    mountedDiskPathsRef.current = mounted;
    if (unmounted.size === 0) {
      return;
    }
    leaveUnmountedDisksInBackgroundTabs(unmounted);
    if (unmounted.has(getVolumeRootPath(currentPath)) && homePath.length > 0) {
      void navigateTo(homePath, "push");
    }
  }, [volumes, leaveUnmountedDisksInBackgroundTabs, navigateTo, homePath, currentPath]);
  // A drop from another app is made while that app is in front. A question or an error about
  // it brings the window forward, until its work is done or the window is in front anyway.
  const externalDropInFlightRef = useRef(false);
  const dragDropBlocked =
    mainView !== "explorer" ||
    actionNotice !== null ||
    sheetOpen ||
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
    handleContentBackgroundDragOver,
    handleContentBackgroundDragLeave,
    handleContentBackgroundDrop,
    backgroundDropIndicator,
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
    onDropItems: async (sourcePaths, destinationDirectoryPath, { operation, ...options }) => {
      const fromOtherApp = options.sourceSurface === "external";
      if (fromOtherApp) {
        externalDropInFlightRef.current = true;
      }
      // A copying drop copies into the folder the way a paste does; a moving one, the way a
      // cut and paste does. Each is named for what it is, not for the paste it works like.
      const action = operation === "copy" ? "copy_to" : "move_to";
      const outcome =
        operation === "copy"
          ? await startCopyToDestination(sourcePaths, destinationDirectoryPath, options)
          : await startMoveToDestination(sourcePaths, destinationDirectoryPath, options);
      if (outcome.status === "blocked" || outcome.status === "error") {
        surfaceCopyLikePreStartFailureNotice(action, outcome);
      }
      if (fromOtherApp && outcome.status === "cancelled") {
        externalDropInFlightRef.current = false;
      }
      return outcome.status === "queued" || outcome.status === "review";
    },
    onToggleTreeNode: toggleTreeNode,
    onActivateTab: activateTab,
    getDiskIds: async (paths) => (await client.invoke("system:getDiskIds", { paths })).ids,
    currentPath,
    // Folders in the content pane spring open under a held drag, as in Finder. The tab
    // comes back to where it was, history and all, when the drag ends without a drop here.
    springLoading: isSearchMode
      ? null
      : {
          openFolder: (path) => {
            void navigateTo(path, "push");
          },
          remember: () => ({ tabId: activeTabId, path: currentPath, historyPaths, historyIndex }),
          restore: (start) => {
            const noted = start as {
              tabId: string;
              path: string;
              historyPaths: string[];
              historyIndex: number;
            };
            // Another tab came to the front meanwhile: this one is left as the drag left it.
            if (noted.tabId !== activeTabId) {
              return;
            }
            setHistoryPaths(noted.historyPaths);
            setHistoryIndex(noted.historyIndex);
            void navigateTo(noted.path, "skip", undefined, undefined, undefined, undefined, {
              restoreView: true,
            });
          },
        },
    startFileDrag: (paths) =>
      client.invoke("system:startFileDrag", {
        paths,
        images: measureFileDragImages(paths, getLoadedFileThumbnail),
      }),
    findDraggedAway: async (paths) =>
      (await client.invoke("system:findDraggedAway", { paths })).gone,
    onDraggedAway: (gonePaths, { intoTrash }) => {
      folderSizeCache.forgetChangedSizes(gonePaths, { intoTrash });
      followItemsGoneElsewhere(gonePaths);
    },
    onDragRefused: (gesture) => {
      if (isWriteOperationLocked) {
        noticeDragRefusedWhileBusy(gesture);
      }
    },
    // Files dragged in from Finder and other apps, read from the drag as it comes in.
    readDraggedIn: () => client.invoke("system:readDraggedIn", {}),
    contentShowsSearchResults: isSearchMode,
  });
  const dropDialogOpen = copyPasteModalOpen || actionNotice !== null;
  useEffect(() => {
    if (!externalDropInFlightRef.current) {
      return;
    }
    if (dropDialogOpen) {
      if (!document.hasFocus()) {
        void client.invoke("system:bringWindowToFront", {}).catch(() => undefined);
      }
      return;
    }
    if (!isWriteOperationLocked && copyPasteDialogState === null) {
      externalDropInFlightRef.current = false;
    }
  }, [client, dropDialogOpen, isWriteOperationLocked, copyPasteDialogState]);
  useEffect(() => {
    const forgetDrop = () => {
      externalDropInFlightRef.current = false;
    };
    window.addEventListener("focus", forgetDrop);
    return () => window.removeEventListener("focus", forgetDrop);
  }, []);
  // A change made outside the app to the folder on screen shows without a refresh. It waits
  // while the person is in the middle of something the list changing under would upset.
  useFolderWatch({
    client,
    path: currentPath.length > 0 ? currentPath : null,
    held:
      mainView !== "explorer" ||
      explorerFocusSuppressed ||
      copyPasteModalOpen ||
      sheetOpen ||
      actionNotice !== null ||
      contextMenuState !== null ||
      isWriteOperationLocked ||
      dragActive,
    reload: reloadFolderAfterOutsideChange,
  });
  const trashPath = homePath ? getTrashPath(homePath) : null;
  const shortcutContext = useMemo(
    () => ({
      actionNoticeOpen: actionNotice !== null,
      copyPasteModalOpen,
      focusedPane,
      locationSheetOpen: sheetOpen,
      mainView,
      selectedTreeTargetKind,
    }),
    [actionNotice, copyPasteModalOpen, focusedPane, sheetOpen, mainView, selectedTreeTargetKind],
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
        homePath,
        trashIsEmpty,
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
      homePath,
      trashIsEmpty,
    ],
  );
  const openFullDiskAccessSettings = useCallback(() => {
    void client.invoke("system:openFullDiskAccessSettings", {}).catch((error) => {
      logger.error("open Full Disk Access settings failed", error);
    });
  }, [client]);

  // Help is a window of its own, beside the files. It opens on the page asked for, or on
  // the one it was left on (the main process remembers it while the app runs).
  const openHelp = useCallback(
    (topic?: HelpTopicId) => {
      void client.invoke("app:openHelpWindow", topic ? { topic } : {}).catch((error) => {
        logger.error("open help window failed", error);
      });
    },
    [client],
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
  const textEditing = useTextEditingFocus();
  const applicationMenuState = useMemo(
    () =>
      buildApplicationMenuState({
        canRun: canRunRendererCommand,
        viewMode: shownViewMode,
        sortBy,
        foldersFirst,
        hiddenFilesShown: includeHidden,
        folderTreeOpen,
        infoPanelOpen,
        infoRowOpen,
        favoriteIsSet: favoriteTargetPath !== null && isFavoritePath(favorites, favoriteTargetPath),
        textEditing,
      }),
    [
      canRunRendererCommand,
      shownViewMode,
      sortBy,
      foldersFirst,
      includeHidden,
      folderTreeOpen,
      infoPanelOpen,
      infoRowOpen,
      favoriteTargetPath,
      favorites,
      textEditing,
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
      // "Preparing to Paste…" leaves the window working (Copy, Cut, menus), but Escape is
      // its Cancel, never a key for the list behind it.
      preparingSheetOpen: copyPasteDialogState?.type === "analysis",
      locationDialogOpen: sheetOpen,
      selectedTreeTargetPath,
      selectedPathsInViewOrder,
      selectedEntry,
      activeContentEntries,
      isSearchMode,
      hasCachedSearch,
      trashPath,
      homePath,
    },
    actions: {
      dismissActionNotice,
      // Escape closes the Rename sheet too, wherever the focus is.
      handleCopyPasteDialogEscape: () =>
        batchRename.sheet ? batchRename.close() : handleCopyPasteDialogEscape(),
      openSettingsView: () => openSettingsView(),
      customizeToolbar: startCustomizingToolbar,
      openLocationSheet,
      focusFileSearch,
      clearTypeahead,
      showCachedSearchResults,
      hideSearchResults,
      goBack,
      goForward,
      goHomeAndRootTree,
      openSidebarLocation: (path) => void selectTreeItem(createLocationItemId(path), "push"),
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
      startUndo,
      resolveContentActionPaths,
      startDuplicateOfSelection,
      startTrashPaths,
      requestEmptyTrash,
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
      openNewWindow,
      moveTabToNewWindow,
      mergeAllWindows,
      reopenClosedTab,
      closeTab,
      activateAdjacentTab,
      openFolderInNewTab,
      toggleFavoritePath,
      showPathsInFinder,
      revealPathInFolder,
      calculateFolderSize: (path) => folderSizeCache.recalculateFolderSize(path),
      calculateFolderSizes: (paths) => void folderSizeCache.calculateFolderSizes(paths),
      handleSortChange,
      toggleFoldersFirst,
      openHelp,
    },
  });

  // A place in the Go menu chosen while no window was open: this window was opened for it,
  // and goes there once it has opened.
  useEffect(() => {
    const command = initialCommandRef.current;
    if (!preferencesReady || command === null) {
      return;
    }
    initialCommandRef.current = null;
    if (isRendererCommandType(command)) {
      runRendererCommand(command);
    }
  }, [preferencesReady, runRendererCommand]);

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
    accent,
    zoomPercent,
    viewMode,
    searchViewMode,
    sortBy,
    sortDirection,
    foldersFirst,
    compactListView,
    compactDetailsView,
    compactIconView,
    compactTreeView,
    singleClickExpandTreeItems,
    detailColumns,
    detailColumnOrder,
    detailColumnWidths,
    searchColumns,
    searchColumnOrder,
    searchColumnWidths,
    notificationsEnabled,
    markClipboardItems,
    autoCalculateFolderSizes,
    topToolbarItems,
    folderTreeOpen,
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
    treeWidth: panes.preferredTreeWidth,
    inspectorWidth: panes.preferredInspectorWidth,
    restoreSessionOnStartup,
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
    locationsExpanded,
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

  // A volume's capacity and free space, for the Info panel while it describes the volume's
  // root; asked again each time the panel comes to it.
  const infoPanelVolumeRootPath =
    infoPanelOpen && infoPanelTargetPath && isVolumeRootPath(infoPanelTargetPath)
      ? infoPanelTargetPath
      : null;
  useEffect(() => {
    if (infoPanelVolumeRootPath === null) {
      setInfoPanelVolume(null);
      return;
    }
    let cancelled = false;
    void Promise.resolve()
      .then(() => client.invoke("system:getVolumeInfo", { path: infoPanelVolumeRootPath }))
      .then((response) => {
        if (!cancelled) {
          setInfoPanelVolume({ path: infoPanelVolumeRootPath, ...response });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInfoPanelVolume(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, infoPanelVolumeRootPath]);

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
        setAccent(preferences.accent);
        setZoomPercent(preferences.zoomPercent);
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
        setSearchViewMode(preferences.searchViewMode);
        setFoldersFirst(preferences.foldersFirst);
        setCompactListView(preferences.compactListView);
        setCompactDetailsView(preferences.compactDetailsView);
        setCompactIconView(preferences.compactIconView);
        setCompactTreeView(preferences.compactTreeView);
        setSingleClickExpandTreeItems(preferences.singleClickExpandTreeItems);
        setDetailColumns(preferences.detailColumns);
        setDetailColumnOrder(preferences.detailColumnOrder);
        setDetailColumnWidths(preferences.detailColumnWidths);
        setSearchColumns(preferences.searchColumns);
        setSearchColumnOrder(preferences.searchColumnOrder);
        setSearchColumnWidths(preferences.searchColumnWidths);
        setNotificationsEnabled(preferences.notificationsEnabled);
        setMarkClipboardItems(preferences.markClipboardItems);
        setAutoCalculateFolderSizes(preferences.autoCalculateFolderSizes);
        setTopToolbarItems(preferences.topToolbarItems);
        setFolderTreeOpen(preferences.folderTreeOpen);
        setInfoPanelOpen(preferences.propertiesOpen);
        setInfoRowOpen(preferences.detailRowOpen);
        setSortBy(preferences.sortBy);
        setSortDirection(preferences.sortDirection);
        setRestoreSessionOnStartup(preferences.restoreSessionOnStartup);
        setFavorites(preferences.favorites);
        setFavoritesPlacement(preferences.favoritesPlacement);
        setFavoritesExpanded(preferences.favoritesExpanded);
        setLocationsExpanded(preferences.locationsExpanded);
        setFavoritesInitialized(preferences.favoritesInitialized);
        setTerminalApp(preferences.terminalApp);
        setDefaultTextEditor(preferences.defaultTextEditor);
        setOpenWithApplications(preferences.openWithApplications);
        setFileActivationAction(preferences.fileActivationAction);
        setOpenItemLimit(preferences.openItemLimit);
        setReturnKeyAction(preferences.returnKeyAction);
        setShortcutOverrides(preferences.shortcutOverrides);
        panes.restoreWidths({
          treeWidth: preferences.treeWidth,
          inspectorWidth: preferences.inspectorWidth,
        });
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
          launchContextResponse.restoreTabs === true,
        );
        initialCommandRef.current = launchContextResponse.initialCommand ?? null;
        // A favorite that was removed since is opened as the plain folder it is. Favorites
        // set up just now are shown open.
        const startupTabs = startup.tabs.map((tab) => ({
          ...tab,
          favoritePath:
            tab.favoritePath && isFavoritePath(preferences.favorites, tab.favoritePath)
              ? tab.favoritePath
              : null,
          favoritesExpanded: preferences.favoritesInitialized ? tab.favoritesExpanded : true,
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
        setSearchViewMode(startupTab.searchViewMode);
        setIncludeHidden(startupTab.includeHidden);
        setFoldersFirst(startupTab.foldersFirst);
        setFavoritesExpanded(startupTab.favoritesExpanded);
        setLocationsExpanded(startupTab.locationsExpanded);
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
          await loadTreeChildren(startupRootPath, startupTab.includeHidden, false, startupRootPath);
        }
        void navigateTo(
          startupPath,
          "replace",
          startupTab.includeHidden,
          startupTab.sortBy,
          startupTab.sortDirection,
          startupTab.foldersFirst,
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
            startupTab.includeHidden,
            startupTab.sortBy,
            startupTab.sortDirection,
            startupTab.foldersFirst,
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
  }, [client, panes.restoreWidths]);

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

  // Customize Toolbar… (in the View menu, View Options and the toolbar's right-click menu):
  // the toolbar is edited where it is, with a panel of the items to add under it.
  function startCustomizingToolbar() {
    setSearchPopoverOpen(false);
    setFocusedPane(null);
    setToolbarCustomizing(true);
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
  // With several items selected, the size controls work on all their folders at once.
  const selectionFolderPaths = selectionSize?.folderPaths ?? [];
  const selectionSizeControls =
    selectionSize?.folderSizeEntry != null
      ? {
          entry: selectionSize.folderSizeEntry,
          onCalculate: () => void folderSizeCache.calculateFolderSizes(selectionFolderPaths),
          onRecalculate: () =>
            void folderSizeCache.calculateFolderSizes(selectionFolderPaths, true),
          onCancel: () => folderSizeCache.cancelFolderSizes(selectionFolderPaths),
        }
      : null;
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
            folderTreeOpen={folderTreeOpen}
            onToggleFolderTree={() => setFolderTreeOpen((value) => !value)}
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
              holdScrollPosition: sidebarScrollHeld,
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
                  fromSidebar: "favorite",
                  treeSelectionMode: "favorite",
                  favoritePath: path,
                  persistOnError: true,
                }),
              onOpenInNewTab: openPathInNewTab,
              onClearSelection: clearTreeSelection,
              locations: sidebarLocations,
              locationsExpanded,
              onToggleLocationsExpanded: () => setLocationsExpanded((value) => !value),
              // A disk under Locations, or the Locations row itself.
              onReorderFavorites: (movedPath, targetPath, position) =>
                setFavorites((current) =>
                  reorderFavorites(current, movedPath, targetPath, position),
                ),
              onSelectItem: async (itemId) => {
                await selectTreeItem(itemId, itemId === getLocationsRootItemId() ? "skip" : "push");
                return true;
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
                  // A location (a disk, Home, the Trash) has a favorite's menu: no Rename,
                  // Move to Trash or Delete for it.
                  targetKind:
                    item.kind === "favorite" || item.kind === "location"
                      ? "favorite"
                      : "treeFolder",
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
                getTreeItemDropIndicator(
                  item.path,
                  item.kind === "favorite" || item.kind === "location" ? "favorite" : "tree",
                ),
              onToggleExpand: toggleTreeNode,
              onToggleFavoritesExpanded: () => setFavoritesExpanded((value) => !value),
              typeaheadQuery: focusedPane === "tree" ? typeaheadQuery : "",
            }}
            searchWorkspaceProps={{
              contentPaneProps: {
                paneRef: contentPaneRef,
                isFocused: focusedPane === "content",
                currentPath,
                entries: isSearchMode ? searchResultEntries : visibleBrowseEntries,
                // Search results are narrowed in the search bar's own field.
                filterQuery: isSearchMode ? "" : listFilterQuery,
                filterTotalCount: browseEntries.length,
                onClearFilter: clearListFilter,
                onSearchForFilter: searchFromListFilter,
                loading: isSearchMode ? false : directoryLoading,
                error: isSearchMode ? null : directoryError,
                onOpenFullDiskAccess:
                  !isSearchMode && isTrashListingRefused(currentPath, directoryError, homePath)
                    ? openFullDiskAccessSettings
                    : null,
                hiddenItemCount,
                metadataByPath: isSearchMode ? searchMetadataByPath : metadataByPath,
                selectedPaths: contentSelection.paths,
                selectionLeadPath: contentSelection.leadPath,
                viewMode: shownViewMode,
                onSelectionGesture: handleContentSelectionGesture,
                onSelectPaths: selectContentPaths,
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
                onVisiblePathsChange: isSearchMode ? loadSearchResultMetadata : setVisiblePaths,
                onNavigatePath: (path) => {
                  // In search results the path bar ends with the selected result, which
                  // opens as a double-click would open it.
                  if (isSearchMode && selectedEntry && path === selectedEntry.path) {
                    void activateContentEntry(selectedEntry);
                    return;
                  }
                  void navigateTo(path, "push");
                },
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
                  openItemContextMenu(path, position, isSearchMode ? "search" : "content");
                },
                onItemDragStart: (entry, event) =>
                  isSearchMode
                    ? handleSearchDragStart(entry, "search", event)
                    : handleContentDragStart(entry, "content", event),
                onItemDragEnd: handleDragEnd,
                // Folders in search results take drops from other apps.
                onItemDragEnter: handleContentDragEnter,
                onItemDragOver: handleContentDragOver,
                onItemDragLeave: handleContentDragLeave,
                onItemDrop: handleContentDrop,
                getItemDropIndicator: getContentItemDropIndicator,
                ...(isSearchMode
                  ? {}
                  : {
                      onBackgroundDragOver: handleContentBackgroundDragOver,
                      onBackgroundDragLeave: handleContentBackgroundDragLeave,
                      onBackgroundDrop: handleContentBackgroundDrop,
                      backgroundDropIndicator,
                    }),
                compactListView,
                compactDetailsView,
                compactIconView,
                detailColumns,
                detailColumnOrder,
                detailColumnWidths,
                onDetailColumnWidthsChange: setDetailColumnWidths,
                inlineRename: renameDialogState?.inline
                  ? {
                      path: renameDialogState.sourcePath,
                      error: renameDialogState.error,
                      refusalCount: renameDialogState.refusalCount,
                      sessionId: renameDialogState.sessionId,
                    }
                  : null,
                onInlineRenameSubmit: (nextName) => void submitRenameDialog(nextName),
                onInlineRenameCancel: () => setRenameDialogState(null),
                statusSummary: isSearchMode
                  ? formatSearchStatus({
                      isSearching: searchStatus === "running",
                      shown: filteredSearchResults.length,
                      totalCount: allSearchResultEntries.length,
                      selectedCount: contentSelection.paths.length,
                      selectionSize: statusSize,
                    })
                  : buildContentStatusSummary({
                      itemCount: currentEntries.length,
                      shownCount: visibleBrowseEntries.length,
                      selectedCount: contentSelection.paths.length,
                      size: statusSize,
                    }),
                sizeBars: isSearchMode ? null : sizeBars,
                ...(isSearchMode
                  ? {
                      header: (
                        <SearchBar
                          isFocused={focusedPane === "content"}
                          rootPath={searchRootPath}
                          scopeOptions={buildSearchScopeOptions(currentPath, homePath)}
                          onScopeChange={changeSearchRoot}
                          status={searchStatus}
                          truncated={searchTruncated}
                          filterQuery={listFilterQuery}
                          onFilterQueryChange={setListFilter}
                          onFocusResults={focusContentPane}
                          onStopSearch={() => {
                            void stopSearch();
                          }}
                          onCloseResults={() => {
                            setSearchPopoverOpen(false);
                            searchInputRef.current?.blur();
                            hideSearchResults();
                            focusContentPane();
                          }}
                        />
                      ),
                      // The status bar shows where the selected result is, as Finder's does.
                      pathbarPath:
                        contentSelection.paths.length === 1 && selectedEntry
                          ? selectedEntry.path
                          : searchRootPath,
                      viewKey: `search:${searchRootPath}:${searchCommittedQuery}`,
                      listColumns: searchListColumns,
                      contentStateOverride: (
                        <SearchResultsState
                          status={searchStatus}
                          shownCount={filteredSearchResults.length}
                          totalCount={allSearchResultEntries.length}
                          error={searchError}
                          errorIsQuiet={searchStartedLive && searchPatternMode !== "text"}
                          filterQuery={listFilterQuery}
                        />
                      ),
                      nameHighlight: searchNameHighlight,
                    }
                  : {}),
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
                  selectionCount={selectedPathSet.size}
                  selectionTotalBytes={selectionTotalBytes}
                  item={getInfoItem}
                  folderSizeEntry={
                    selectionSize
                      ? selectionSizeControls?.entry
                      : infoRowFolderSizePath
                        ? folderSizeCache.getEntry(infoRowFolderSizePath)
                        : undefined
                  }
                  onCalculateFolderSize={
                    selectionSize
                      ? selectionSizeControls?.onCalculate
                      : infoRowFolderSizePath
                        ? () => void folderSizeCache.calculateFolderSize(infoRowFolderSizePath)
                        : undefined
                  }
                  onRecalculateFolderSize={
                    selectionSize
                      ? selectionSizeControls?.onRecalculate
                      : infoRowFolderSizePath
                        ? () => folderSizeCache.recalculateFolderSize(infoRowFolderSizePath)
                        : undefined
                  }
                  onCancelFolderSize={
                    selectionSize
                      ? selectionSizeControls?.onCancel
                      : infoRowFolderSizePath
                        ? () => void folderSizeCache.cancelFolderSize(infoRowFolderSizePath)
                        : undefined
                  }
                />
              ),
            }}
            infoPanelProps={{
              loading: getInfoLoading,
              item: infoPanelItem,
              selection: infoPanelSelection,
              volume:
                infoPanelVolume && infoPanelVolume.path === infoPanelItem?.path
                  ? infoPanelVolume
                  : null,
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
              textEditorName: defaultTextEditor.appName,
              isFavorite: infoPanelCanFavorite && isFavoritePath(favorites, infoPanelItem.path),
              onToggleFavorite: infoPanelCanFavorite
                ? () => toggleFavoritePath(infoPanelItem.path)
                : undefined,
              onRootTree: infoPanelCanRootTree
                ? () => rootTreeAtPath(infoPanelItem.path)
                : undefined,
              openWithItems: openWithMenuItems,
              onOpenWith: (action) => {
                if (infoPanelItem) {
                  void runContextSubmenuAction(action, [infoPanelItem.path]);
                }
              },
              ...(selectionSize
                ? {
                    folderSizeEntry: selectionSizeControls?.entry,
                    onCalculateFolderSize: selectionSizeControls?.onCalculate,
                    onRecalculateFolderSize: selectionSizeControls?.onRecalculate,
                    onCancelFolderSize: selectionSizeControls?.onCancel,
                  }
                : {
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
                  }),
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
            viewMode={shownViewMode}
            onViewModeChange={setShownViewMode}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
            foldersFirst={foldersFirst}
            onToggleFoldersFirst={toggleFoldersFirst}
            includeHidden={includeHidden}
            textEditorName={defaultTextEditor.appName}
            onToggleHidden={toggleHiddenFiles}
            onToggleInfoPanel={() => setInfoPanelOpen((value) => !value)}
            infoRowOpen={infoRowOpen}
            onToggleInfoRow={() => setInfoRowOpen((value) => !value)}
            theme={theme}
            onSelectTheme={setTheme}
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
            onCustomizeToolbar={startCustomizingToolbar}
            customizingToolbar={toolbarCustomizing}
            onFinishCustomizingToolbar={() => setToolbarCustomizing(false)}
            onTopToolbarItemsChange={setTopToolbarItems}
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
                  onSelectTab={activateTab}
                  onCloseTab={closeTab}
                  onCloseOtherTabs={closeOtherTabs}
                  onDuplicateTab={duplicateTab}
                  onMoveTabToNewWindow={moveTabToNewWindow}
                  onMergeAllWindows={mergeAllWindows}
                  countWindows={async () =>
                    (await client.invoke("app:getExplorerWindowCount", {})).count
                  }
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
            // How the search is going is in the status bar, as a folder's item count is.
            toolbarSubtitle=""
          />
        ) : null}
        {batchRename.sheet && batchRename.plan ? (
          <BatchRenameSheet
            targets={batchRename.sheet.targets}
            settings={batchRename.settings}
            onSettingsChange={batchRename.setSettings}
            plan={batchRename.plan}
            checking={batchRename.sheet.inspect === null && batchRename.sheet.inspectError === null}
            checkError={batchRename.sheet.inspectError}
            presets={batchRename.presets}
            onSavePreset={batchRename.savePreset}
            onDeletePreset={batchRename.deletePreset}
            canRename={batchRename.request !== null}
            onCancel={batchRename.close}
            onRename={() => {
              const request = batchRename.request;
              if (!request) {
                return;
              }
              batchRename.close();
              void startBatchRename(request);
            }}
          />
        ) : null}
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
          contextMenuOptions={contextMenuOptions}
          contextMenuHiddenActionIds={contextMenuHiddenActionIds}
          contextMenuSubmenus={contextMenuSubmenus}
          shortcutContext={shortcutContext}
          onRunContextMenuAction={(actionId, paths) => {
            void runContextMenuAction(actionId, paths);
          }}
          onRunContextSubmenuAction={(action, paths) => {
            // View As and Sort By set the view of the folder on screen.
            if (action.kind === "viewMode") {
              closeContextMenu();
              setShownViewMode(action.id);
              return;
            }
            if (action.kind === "sortBy") {
              closeContextMenu();
              if (action.id !== sortBy) {
                handleSortChange(action.id);
              }
              return;
            }
            void runContextSubmenuAction(action, paths);
          }}
          onDismissActionNotice={dismissActionNotice}
          onSubmitRenameDialog={(value) => void submitRenameDialog(value)}
          onSubmitNewFolderDialog={(value) => void submitNewFolderDialog(value)}
          onRequestCopyLikePlanStart={requestCopyLikePlanStart}
          onUpdateCopyPasteChoices={updateCopyPasteChoices}
          onCloseCopyPasteDialog={dismissCopyPasteDialog}
          onCloseConfirmationDialog={closeConfirmationDialog}
          onConfirmTrashDialog={(paths) => {
            void startTrashPaths(paths);
          }}
          onConfirmDeleteImmediatelyDialog={(paths) => {
            void startDeleteImmediatelyPaths(paths);
          }}
          onConfirmEmptyTrashDialog={() => {
            void confirmEmptyTrash().finally(refreshTrashState);
          }}
          onConfirmDotNameDialog={() => {
            void confirmDotNameDialog();
          }}
          onAnswerUndoQuestion={answerUndoQuestion}
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

// Search scopes: the folder being browsed, Home, the disk it is on when that is another
// disk, and Macintosh HD (deduplicated).
function buildSearchScopeOptions(
  currentPath: string,
  homePath: string,
): Array<{ path: string; label: string }> {
  const options: Array<{ path: string; label: string }> = [];
  const volumeRootPath = getVolumeRootPath(currentPath);
  for (const [path, label] of [
    [currentPath, `“${getFolderDisplayName(currentPath)}”`],
    [homePath, "Home"],
    ...(volumeRootPath === "/"
      ? []
      : [[volumeRootPath, getFolderDisplayName(volumeRootPath)] as const]),
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
