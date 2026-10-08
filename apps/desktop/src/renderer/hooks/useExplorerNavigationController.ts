import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import type { TreeNodeState } from "../components/TreePane";
import {
  EMPTY_CONTENT_SELECTION,
  setSingleContentSelection as createSingleContentSelection,
  sanitizeContentSelection,
} from "../lib/contentSelection";
import { getDetailsRowHeight } from "../lib/detailsLayout";
import {
  createTreeNode,
  isFolderSizeEligibleKind,
  isPathWithinTreeRoot,
  resolveExplorerTreeRootPath,
} from "../lib/explorerAppUtils";
import {
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getForcedVisiblePackageChildPath,
  getNextSelectionIndex,
  getPageStepItemCount,
  getPagedSelectionIndex,
  getTreeSeedChain,
  isFolderGoneError,
  parentDirectoryPath,
  pathHasHiddenSegmentWithinRoot,
  sameDetailsByPath,
  sameDirectoryEntries,
  withPackageChild,
} from "../lib/explorerNavigation";
import { type ExplorerPane, resolveExplorerPaneRestoreTarget } from "../lib/explorerPaneFocus";
import { getPathAndAncestors } from "../lib/explorerTabs";
import type { DirectoryEntry, DirectoryEntryMetadata } from "../lib/explorerTypes";
import {
  type SidebarLocation,
  type TreeItemId,
  buildTreePresentation,
  createFavoriteItemId,
  createFileSystemItemId,
  createLocationItemId,
  getFavoriteItemPath,
  getFavoriteLabel,
  getFileSystemItemPath,
  getLocationItemPath,
  getShortcutItemPath,
  isFavoriteItemId,
  isFavoritesRootItemId,
  isLocationItemId,
  isLocationsRootItemId,
  isPathInsideTrash,
} from "../lib/favorites";
import { getFlowListColumnStep } from "../lib/flowListLayout";
import { resolveFocusedEditTarget } from "../lib/focusedEditTarget";
import {
  CONTENT_SCROLL_SELECTOR,
  type FolderViewMemory,
  rememberFolderView,
} from "../lib/folderViewMemory";
import { type FolderVisitTracker, createFolderVisitTracker } from "../lib/folderVisitTracker";
import { getIconGridLayout } from "../lib/iconGridLayout";
import { EXPLORER_LAYOUT, getTreeRowHeight } from "../lib/layoutTokens";
import { LIST_FILTER_SPACE_WINDOW_MS, findListFilterSelection } from "../lib/listFilter";
import { createRendererLogger } from "../lib/logging";
import { pageScrollElement, scrollElementByAmount } from "../lib/pagedScroll";
import { expandHomeShortcut } from "../lib/pathUtils";
import { isVolumeRootPath } from "../lib/volumes";
import type {
  ExplorerServices,
  NavigationStore,
  PreferencesStore,
  SearchStore,
  SelectionActions,
  WriteOperationsStore,
} from "../state/explorerStores";

const logger = createRendererLogger("filetrail.renderer");

export function useExplorerNavigationController(args: {
  services: ExplorerServices;
  navigation: NavigationStore;
  preferences: PreferencesStore;
  search: SearchStore;
  writeOperations: WriteOperationsStore;
  selection: SelectionActions;
  derived: {
    activeContentEntries: DirectoryEntry[];
    /** The list on screen before the typed filter narrows it. */
    unfilteredContentEntries: DirectoryEntry[];
    /** What a filter text would leave of that list. */
    filterContentEntries: (query: string) => DirectoryEntry[];
    locationDialogOpen: boolean;
    explorerFocusSuppressed: boolean;
    /** The sidebar's Locations: Macintosh HD and the other disks mounted. */
    locations: SidebarLocation[];
    locationsExpanded: boolean;
  };
}) {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const { services, navigation, preferences, search, writeOperations, selection, derived } = args;
  const {
    client,
    panes,
    searchShellRef,
    treePaneRef,
    contentPaneRef,
    typeaheadTimeoutRef,
    typeaheadQueryRef,
    typeaheadPaneRef,
  } = services;
  const {
    mainView,
    homePath,
    treeRootPath,
    setTreeRootPath,
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
    setDirectoryError,
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    contentSelection,
    contentColumns,
    setVisiblePaths,
    visiblePaths,
    historyPaths,
    setHistoryPaths,
    historyIndex,
    setHistoryIndex,
    setLocationSubmitting,
    setLocationSheetOpen,
    setLocationError,
    focusedPane,
    setFocusedPane,
    leftPaneSubview,
    setLeftPaneSubview,
    listFilterQuery,
    setListFilterQuery,
    typeaheadQuery,
    typeaheadPane,
    setTypeaheadPane,
    setTypeaheadQuery,
    infoTargetPathOverride,
    setInfoTargetPathOverride,
    infoPanelOpen,
    infoRowOpen,
    setGetInfoLoading,
    setGetInfoItem,
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
    leftPaneSubviewRef,
    lastLeftPaneSubviewRef,
    viewEpochRef,
    folderViewMemoriesRef,
  } = navigation;

  // Resolves to whether the view that was on screen when it was made still is. Anything
  // that waits for the disk checks it afterwards: another tab may have come to the front
  // meanwhile, and what was read belongs to the tab that asked.
  function createViewGuard(): () => boolean {
    const epoch = viewEpochRef.current;
    return () => viewEpochRef.current === epoch;
  }

  const {
    preferencesReady,
    favorites,
    favoritesPlacement,
    favoritesExpanded,
    foldersFirst,
    setFoldersFirst,
    includeHidden,
    setIncludeHidden,
    compactListView,
    compactDetailsView,
    compactIconView,
    compactTreeView,
  } = preferences;
  const {
    searchCommittedQuery,
    searchResultsVisible,
    setSearchResultsVisible,
    setSearchDraftQuery,
    searchResultsVisibleRef,
    searchPointerIntentRef,
  } = search;
  const { actionNotice, contextMenuState, pendingPasteSelectionRef } = writeOperations;
  const { applyContentSelection, setSingleContentSelection } = selection;
  const {
    activeContentEntries,
    unfilteredContentEntries,
    filterContentEntries,
    locationDialogOpen,
    explorerFocusSuppressed,
  } = derived;

  const hasCachedSearch = searchCommittedQuery.trim().length > 0;
  const isSearchMode = searchResultsVisible && hasCachedSearch;
  // The view on screen: search results have their own in each tab.
  const viewMode = isSearchMode ? preferences.searchViewMode : preferences.viewMode;

  // Typeahead/content-focus actions live in the shared selection store; they
  // are re-exported from this controller's return value for its consumers.
  const { clearTypeahead, focusContentPane } = selection;

  // `unlessFocusMoves`: see focusContentPane.
  const focusTreePane = useCallback(
    (options: { unlessFocusMoves?: boolean } = {}) => {
      const focusedAtStart = document.activeElement;
      setFocusedPane("tree");
      clearTypeahead();
      window.requestAnimationFrame(() => {
        if (options.unlessFocusMoves && document.activeElement !== focusedAtStart) {
          return;
        }
        // A collapsed Favorites section renders no rows; fall back to the folder tree then.
        const favoritesRowsVisible =
          treePaneRef.current?.querySelector(".favorites-pane-section .tree-label") != null;
        const targetSubview =
          favoritesPlacement === "separate" && favoritesRowsVisible
            ? lastLeftPaneSubviewRef.current
            : "tree";
        const selectedSelector =
          targetSubview === "favorites"
            ? ".favorites-pane-section .tree-row.active .tree-label"
            : ".sidebar-tree .tree-row.active .tree-label";
        const fallbackSelector =
          targetSubview === "favorites"
            ? ".favorites-pane-section .tree-label"
            : ".sidebar-tree .tree-label";
        const focusTarget =
          treePaneRef.current?.querySelector<HTMLElement>(selectedSelector) ??
          treePaneRef.current?.querySelector<HTMLElement>(fallbackSelector);
        if (focusTarget) {
          focusTarget.focus({ preventScroll: true });
        } else {
          treePaneRef.current?.focus({ preventScroll: true });
        }
        const focusedNow = document.activeElement;
        window.requestAnimationFrame(() => {
          if (options.unlessFocusMoves && document.activeElement !== focusedNow) {
            return;
          }
          if (focusTarget) {
            focusTarget.focus({ preventScroll: true });
          } else {
            treePaneRef.current?.focus({ preventScroll: true });
          }
        });
      });
    },
    [clearTypeahead, favoritesPlacement, lastLeftPaneSubviewRef, treePaneRef, setFocusedPane],
  );

  function getTreePresentationState() {
    return buildTreePresentation({
      favorites,
      favoritesExpanded,
      homePath,
      rootPath: treeRootPathRef.current,
      nodes: treeNodesRef.current,
      includeFavorites: favoritesPlacement === "integrated",
      locations: derived.locations,
      locationsExpanded: derived.locationsExpanded,
    });
  }

  function setTreeSelection(itemId: TreeItemId | null) {
    selectedTreeItemIdRef.current = itemId;
    setSelectedTreeItemId(itemId);
  }

  function clearTreeSelection() {
    setTreeSelection(null);
    applyEmptyDirectorySnapshot();
  }

  function applyHistoryUpdate(path: string, historyMode: "push" | "replace" | "skip") {
    if (historyMode === "push") {
      setHistoryPaths((current) => {
        const base = current.slice(0, historyIndex + 1);
        return [...base, path];
      });
      setHistoryIndex((current) => current + 1);
      return;
    }
    if (historyMode === "replace") {
      setHistoryPaths((current) => {
        if (current.length === 0) {
          return [path];
        }
        const next = [...current];
        next[Math.max(0, historyIndex)] = path;
        return next;
      });
      setHistoryIndex((current) => (current < 0 ? 0 : current));
    }
  }

  function resolveTreeItemLabel(itemId: TreeItemId): string {
    const presentation = getTreePresentationState();
    return presentation.items[itemId]?.label ?? "";
  }

  // The rows of the separate Favorites list, then those of the Locations below it: arrow
  // keys move through both as one list.
  function getFavoriteItemIds(): TreeItemId[] {
    return [
      ...favorites.map((favorite) => createFavoriteItemId(favorite.path)),
      ...(derived.locationsExpanded
        ? derived.locations.map((location) => createLocationItemId(location.path))
        : []),
    ];
  }

  function getFavoriteLabelById(itemId: TreeItemId): string {
    const locationPath = getLocationItemPath(itemId);
    if (locationPath !== null) {
      return derived.locations.find((location) => location.path === locationPath)?.label ?? "";
    }
    const favoritePath = getFavoriteItemPath(itemId);
    return favoritePath ? getFavoriteLabel(favoritePath, homePath) : "";
  }

  function getSelectedTreeReloadOptions(path: string) {
    const shortcutItemId = selectedTreeItemIdRef.current;
    const favoritePath = getShortcutItemPath(shortcutItemId);
    if (!shortcutItemId || !favoritePath || favoritePath !== path) {
      const selectedTreePath = getFileSystemItemPath(selectedTreeItemIdRef.current);
      if (!selectedTreePath) {
        return undefined;
      }
      const selectedTreeNode = treeNodesRef.current[selectedTreePath];
      if (!selectedTreeNode?.isSymlink) {
        return undefined;
      }
      return {
        syncTree: false,
        treeSelectionMode: "preserve" as const,
        persistOnError: true,
      };
    }
    return {
      syncTree: false,
      treeSelectionMode: "favorite" as const,
      favoritePath,
      shortcutItemId,
      persistOnError: true,
    };
  }

  const restoreExplorerPaneFocus = useCallback(
    (preferredPane: ExplorerPane | null = null) => {
      const targetPane = resolveExplorerPaneRestoreTarget({
        preferredPane,
        lastFocusedPane: lastExplorerFocusPaneRef.current,
        hasTreePane: treePaneRef.current !== null,
        hasContentPane: contentPaneRef.current !== null,
      });
      if (targetPane === "tree") {
        focusTreePane({ unlessFocusMoves: true });
        return;
      }
      if (targetPane === "content") {
        focusContentPane({ unlessFocusMoves: true });
      }
    },
    [contentPaneRef, focusContentPane, focusTreePane, lastExplorerFocusPaneRef, treePaneRef],
  );

  function getFocusedScrollTarget(): {
    axis: "horizontal" | "vertical";
    element: HTMLElement;
  } | null {
    if (focusedPane === "tree") {
      if (favoritesPlacement === "separate" && leftPaneSubviewRef.current === "favorites") {
        const element = treePaneRef.current?.querySelector<HTMLElement>(".sidebar-sections");
        return element ? { axis: "vertical", element } : null;
      }
      const element = treePaneRef.current?.querySelector<HTMLElement>(".tree-scroll");
      return element ? { axis: "vertical", element } : null;
    }
    if (focusedPane !== "content") {
      return null;
    }
    if (viewMode === "details") {
      const element = contentPaneRef.current?.querySelector<HTMLElement>(".details-scroll");
      return element ? { axis: "vertical", element } : null;
    }
    if (viewMode === "icons") {
      const element = contentPaneRef.current?.querySelector<HTMLElement>(".icon-grid");
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
      if (favoritesPlacement === "separate" && leftPaneSubviewRef.current === "favorites") {
        const favoriteItemIds = getFavoriteItemIds();
        if (favoriteItemIds.length === 0) {
          return didScroll;
        }
        const currentIndex = favoriteItemIds.findIndex(
          (itemId) => itemId === selectedTreeItemIdRef.current,
        );
        const stepItems = getPageStepItemCount(
          target.element.clientHeight,
          getTreeRowHeight(compactTreeView),
        );
        const nextIndex = getPagedSelectionIndex({
          itemCount: favoriteItemIds.length,
          currentIndex,
          stepItems,
          direction,
        });
        const nextItemId = favoriteItemIds[nextIndex];
        if (nextItemId && nextItemId !== selectedTreeItemIdRef.current) {
          void selectTreeItem(nextItemId, "push");
        }
        return didScroll || nextItemId !== undefined;
      }
      // Paging goes past the Favorites and Locations headings, as the arrow keys do: a
      // heading is never selected.
      const visibleItemIds = getTreePresentationState().visibleItemIds.filter(
        (itemId) => !isFavoritesRootItemId(itemId) && !isLocationsRootItemId(itemId),
      );
      if (visibleItemIds.length === 0) {
        return didScroll;
      }
      const currentIndex = visibleItemIds.findIndex(
        (itemId) => itemId === selectedTreeItemIdRef.current,
      );
      const stepItems = getPageStepItemCount(
        target.element.clientHeight,
        getTreeRowHeight(compactTreeView),
      );
      const nextIndex = getPagedSelectionIndex({
        itemCount: visibleItemIds.length,
        currentIndex,
        stepItems,
        direction,
      });
      const nextItemId = visibleItemIds[nextIndex];
      if (nextItemId && nextItemId !== selectedTreeItemIdRef.current) {
        void selectTreeItem(nextItemId, "push");
      }
      return didScroll || nextItemId !== undefined;
    }

    if (focusedPane !== "content") {
      return false;
    }

    if (viewMode === "list") {
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
      // Icon view pages by rows, and every row holds a full set of columns.
      const pagesIconRows = viewMode === "icons";
      const stepItems =
        getPageStepItemCount(
          target.element.clientHeight,
          pagesIconRows
            ? getIconGridLayout(compactIconView).rowHeight
            : getDetailsRowHeight(compactDetailsView),
        ) * (pagesIconRows ? Math.max(1, contentColumns) : 1);
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

  // The folder being opened, while it is (see navigateTo); a refresh after a write leaves it
  // alone.
  const pendingNavigationRef = useRef<{ requestId: number; path: string } | null>(null);

  // ── Typing in the file list filters it ────────────────────────────────────────────────
  const listFilterQueryRef = useRef(listFilterQuery);
  const lastListFilterInputAtRef = useRef(0);

  // Narrows the list on screen to `nextQuery` and selects what type-to-select would have:
  // the first name starting with the text, otherwise the first match.
  function applyListFilter(nextQuery: string) {
    listFilterQueryRef.current = nextQuery;
    setListFilterQuery(nextQuery);
    if (nextQuery.length === 0) {
      return;
    }
    const matches = filterContentEntries(nextQuery);
    const selected = findListFilterSelection(matches, nextQuery);
    applyContentSelection(
      selected ? createSingleContentSelection(selected.path) : EMPTY_CONTENT_SELECTION,
      matches,
    );
  }

  // The filter field of the search results sets the whole text at once.
  function setListFilter(nextQuery: string) {
    lastListFilterInputAtRef.current = Date.now();
    applyListFilter(nextQuery);
  }

  function typeIntoListFilter(text: string) {
    lastListFilterInputAtRef.current = Date.now();
    applyListFilter(`${listFilterQueryRef.current}${text}`);
  }

  // Backspace takes the last character back; the selection stays where it is.
  function eraseListFilterCharacter() {
    lastListFilterInputAtRef.current = Date.now();
    applyListFilter(listFilterQueryRef.current.slice(0, -1));
  }

  // Esc, the ✕, or leaving the folder: the whole list returns and the selection is kept,
  // so something found by filtering can then be seen among its neighbours.
  const clearListFilter = useCallback(() => {
    listFilterQueryRef.current = "";
    setListFilterQuery("");
  }, [setListFilterQuery]);

  // Space is part of the text while typing is under way ("my doc"); after a pause it is
  // Quick Look again.
  function listFilterTakesSpace() {
    return (
      listFilterQueryRef.current.length > 0 &&
      Date.now() - lastListFilterInputAtRef.current < LIST_FILTER_SPACE_WINDOW_MS
    );
  }

  useEffect(() => {
    listFilterQueryRef.current = listFilterQuery;
  }, [listFilterQuery]);

  // A filter belongs to the list it was typed into: it is dropped when the folder or the
  // kind of list changes. `listFilterOwnerRef` names the list the filter on screen was
  // typed into, so a tab that is shown again can bring its filter back with its list.
  const listFilterOwner = getListFilterOwner(currentPath, isSearchMode, searchCommittedQuery);
  const listFilterOwnerRef = useRef(listFilterOwner);
  useEffect(() => {
    if (listFilterOwnerRef.current === listFilterOwner) {
      return;
    }
    listFilterOwnerRef.current = listFilterOwner;
    clearListFilter();
  }, [listFilterOwner, clearListFilter]);

  // Puts back the filter a tab had when it was left, along with the list it belongs to.
  function restoreListFilter(
    query: string,
    list: { currentPath: string; isSearchMode: boolean; searchCommittedQuery: string },
  ) {
    listFilterOwnerRef.current = getListFilterOwner(
      list.currentPath,
      list.isSearchMode,
      list.searchCommittedQuery,
    );
    listFilterQueryRef.current = query;
    lastListFilterInputAtRef.current = 0;
    setListFilterQuery(query);
  }

  // Something outside the filter was selected (a new folder, a pasted or renamed item, a
  // reveal): show the whole list again so the selection is on screen.
  useEffect(() => {
    const leadPath = contentSelection.leadPath;
    if (listFilterQuery.length === 0 || leadPath === null) {
      return;
    }
    if (activeContentEntries.some((entry) => entry.path === leadPath)) {
      return;
    }
    if (unfilteredContentEntries.some((entry) => entry.path === leadPath)) {
      clearListFilter();
    }
  }, [
    activeContentEntries,
    clearListFilter,
    contentSelection.leadPath,
    listFilterQuery,
    unfilteredContentEntries,
  ]);

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
    }, TREE_TYPEAHEAD_RESET_MS);
  }

  // Typing in the file list filters it; typing in the sidebar selects the first visible
  // item whose name starts with the text.
  function handleTypeaheadInput(key: string, pane: "tree" | "content") {
    if (pane === "content") {
      typeIntoListFilter(key);
      return;
    }
    const baseQuery = typeaheadPaneRef.current === pane ? typeaheadQueryRef.current : "";
    const nextQuery = `${baseQuery}${key}`;
    typeaheadQueryRef.current = nextQuery;
    typeaheadPaneRef.current = pane;
    setTypeaheadQuery(nextQuery);
    setTypeaheadPane(pane);
    scheduleTypeaheadClear();

    const normalizedQuery = nextQuery.trim().toLocaleLowerCase();
    if (normalizedQuery.length === 0) {
      return;
    }
    if (favoritesPlacement === "separate" && leftPaneSubviewRef.current === "favorites") {
      const match = getFavoriteItemIds().find((itemId) =>
        getFavoriteLabelById(itemId).toLocaleLowerCase().startsWith(normalizedQuery),
      );
      if (match) {
        void selectTreeItem(match, "push");
      }
      return;
    }
    const { visibleItemIds } = getTreePresentationState();
    const match = visibleItemIds.find((itemId) =>
      resolveTreeItemLabel(itemId).toLocaleLowerCase().startsWith(normalizedQuery),
    );
    if (match) {
      void selectTreeItem(match, "push");
    }
  }

  function goBack() {
    const nextPath = historyPaths[historyIndex - 1];
    if (!nextPath) {
      return;
    }
    setHistoryIndex(historyIndex - 1);
    void navigateTo(nextPath, "skip", undefined, undefined, undefined, undefined, {
      restoreView: true,
    });
  }

  function goForward() {
    const nextPath = historyPaths[historyIndex + 1];
    if (!nextPath) {
      return;
    }
    setHistoryIndex(historyIndex + 1);
    void navigateTo(nextPath, "skip", undefined, undefined, undefined, undefined, {
      restoreView: true,
    });
  }

  // Jumps straight to a folder in the history (from the Back or Forward hold menu). Like
  // Back and Forward themselves, it moves within the history instead of adding to it.
  function goToHistoryIndex(index: number) {
    const nextPath = historyPaths[index];
    if (!nextPath || index === historyIndex) {
      return;
    }
    setHistoryIndex(index);
    void navigateTo(nextPath, "skip", undefined, undefined, undefined, undefined, {
      restoreView: true,
    });
  }

  // Opens `path` and makes it the top of the folder tree. The tree keeps that root until a
  // folder outside it is opened, when `syncTreeToPath` falls back to home or `/`.
  function rootTreeAtPath(path: string) {
    if (path.length === 0) {
      return;
    }
    void navigateTo(
      path,
      path === currentPathRef.current ? "replace" : "push",
      undefined,
      undefined,
      undefined,
      undefined,
      { rerootTree: true },
    );
  }

  function goHomeAndRootTree() {
    rootTreeAtPath(homePath);
  }

  function navigateToParentFolder() {
    const nextPath = parentDirectoryPath(currentPath);
    if (nextPath) {
      void navigateTo(nextPath, "push");
    }
  }

  function replaceTreeNodes(nextNodes: Record<string, TreeNodeState>) {
    treeNodesRef.current = nextNodes;
    setTreeNodes(nextNodes);
  }

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
    treeRequestRef.current = {};
    treeRootPathRef.current = path;
    setTreeRootPath(path);
    replaceTreeNodes({
      [path]: createTreeNode(path, true),
    });
  }

  function reinitializeTree(rootPath: string, focusPath: string) {
    treeRequestRef.current = {};
    treeRootPathRef.current = rootPath;
    setTreeRootPath(rootPath);
    const seededNodes = Object.fromEntries(
      getTreeSeedChain(rootPath, focusPath).map(({ path, childPath }) => {
        const node = createTreeNode(path, childPath !== null);
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

  // Items whose details changed on disk since they were read (see
  // reloadFolderAfterOutsideChange): what is shown for them stays until it is read again.
  const staleMetadataPathsRef = useRef(new Set<string>());
  // Counts the times items went stale: the details on screen are then looked over again.
  const [staleDetailsCheck, setStaleDetailsCheck] = useState(0);

  function applyEmptyDirectorySnapshot() {
    metadataCacheRef.current = new Map();
    staleMetadataPathsRef.current.clear();
    metadataInflightRef.current.clear();
    pendingPasteSelectionRef.current = null;
    currentPathRef.current = "";
    selectedPathsInViewOrderRef.current = [];
    selectedEntryRef.current = null;
    setCurrentPath("");
    setCurrentEntries([]);
    setVisiblePaths([]);
    setMetadataByPath({});
    setDirectoryError(null);
    setLocationError(null);
    setInfoTargetPathOverride(null);
    setGetInfoLoading(false);
    if (searchResultsVisibleRef.current) {
      searchResultsVisibleRef.current = false;
      setSearchResultsVisible(false);
    }
    applyContentSelection(
      {
        paths: [],
        anchorPath: null,
        leadPath: null,
      },
      [],
    );
    setGetInfoItem(null);
  }

  function applyDirectorySnapshot(
    path: string,
    entries: DirectoryEntry[],
    cachedMetadata: Record<string, DirectoryEntryMetadata>,
    options: {
      keepSelection?: boolean;
      keepSearchResults?: boolean;
      changedPaths?: readonly string[] | null;
    } = {},
  ) {
    const sameFolder = path === currentPathRef.current;
    if (!sameFolder) {
      staleMetadataPathsRef.current.clear();
    }
    metadataCacheRef.current = new Map(Object.entries(cachedMetadata));
    metadataInflightRef.current.clear();
    // At once, not when the window next draws: what asks about the folder on screen in
    // between (a change made outside the app to the folder just left) must hear of this one.
    currentPathRef.current = path;
    setCurrentPath(path);
    // The same folder read again as it was (a file in it written to, say) keeps the listing
    // and details on screen as they are, so nothing is drawn again for it. Kept only while
    // they are still the ones compared to.
    const sameListing = sameFolder && sameDirectoryEntries(currentEntries, entries);
    const sameDetails = sameFolder && sameDetailsByPath(metadataByPath, cachedMetadata);
    setCurrentEntries((shown) => (sameListing && shown === currentEntries ? shown : entries));
    // The same folder read again keeps the rows on screen: the list tells of them again only
    // when they change, and the details of those that changed are read again from them.
    if (!sameFolder) {
      setVisiblePaths([]);
    }
    setMetadataByPath((shown) =>
      sameDetails && shown === metadataByPath ? shown : cachedMetadata,
    );
    if (
      searchResultsVisibleRef.current &&
      !keepSearchResultsOnReloadRef.current &&
      !options.keepSearchResults
    ) {
      // Opening a folder leaves the search; the field is cleared with it so it never shows
      // a query for results that are no longer on screen.
      setSearchResultsVisible(false);
      setSearchDraftQuery("");
    }
    const pendingPasteSelection =
      pendingPasteSelectionRef.current?.directoryPath === path
        ? pendingPasteSelectionRef.current
        : null;
    if (pendingPasteSelection) {
      pendingPasteSelectionRef.current = null;
    }
    // A set: what a paste made can be many thousands of paths (see syncContentSelectionRefs).
    const pastedPaths = new Set(pendingPasteSelection?.selectedPaths ?? []);
    const selectedPastePaths = entries
      .filter((entry) => pastedPaths.has(entry.path))
      .map((entry) => entry.path);
    // A folder read again in place keeps its selection; whatever of it is gone from the
    // new listing is dropped when the list updates.
    if (selectedPastePaths.length > 0 || !options.keepSelection) {
      applyContentSelection(
        selectedPastePaths.length > 0
          ? {
              paths: selectedPastePaths,
              anchorPath: selectedPastePaths[0] ?? null,
              leadPath: selectedPastePaths.at(-1) ?? null,
            }
          : {
              paths: [],
              anchorPath: null,
              leadPath: null,
            },
        entries,
      );
    }
    // Reloading a folder (a new sort, a change on disk, a paste) keeps what the info views
    // show and asks for it again, instead of blanking them until the selection changes.
    // After a change made outside the app, only when what they show may have changed.
    if (
      options.changedPaths === undefined ||
      infoMayHaveChanged(path, options.changedPaths, !sameListing)
    ) {
      setInfoRefreshKey((key) => key + 1);
    }
  }

  // Whether what the info views show may have changed, after a change made outside the app
  // to `changedPaths` in the folder at `folderPath` (null: to anything in it).
  function infoMayHaveChanged(
    folderPath: string,
    changedPaths: readonly string[] | null,
    listingChanged: boolean,
  ): boolean {
    if (!infoPanelOpen && !infoRowOpen) {
      return false;
    }
    const shownPath = infoTargetPathOverride ?? contentSelection.leadPath ?? folderPath;
    if (changedPaths === null) {
      return true;
    }
    // The folder itself changes (its modification time) only when items come or go.
    return shownPath === folderPath ? listingChanged : changedPaths.includes(shownPath);
  }

  // Decides how much each folder opened counts for the Go To box.
  const folderVisitTrackerRef = useRef<FolderVisitTracker | null>(null);
  if (folderVisitTrackerRef.current === null) {
    folderVisitTrackerRef.current = createFolderVisitTracker((path, kind) => {
      void client.invoke("places:recordVisit", { path, kind }).catch(() => undefined);
    });
  }
  useEffect(() => () => folderVisitTrackerRef.current?.dispose(), []);

  // Something was done in the folder on screen, so opening it counts as a visit.
  function noteFolderUsed() {
    folderVisitTrackerRef.current?.use();
  }

  // A jump from a favorite or a location: the tree goes back to the place's own top (Home,
  // the disk, or Macintosh HD), keeping it as it is when it is there already. Returns the
  // folder to open the tree down to: the place itself, or the top for a hidden one (the
  // Trash), which is not brought out in the tree.
  function resetTreeForSidebarJump(path: string, includeHiddenOverride: boolean): string {
    const treeTopPath = resolveExplorerTreeRootPath(path, homePath);
    if (treeTopPath !== treeRootPathRef.current) {
      initializeTree(treeTopPath);
    }
    return !includeHiddenOverride && pathHasHiddenSegmentWithinRoot(path, treeTopPath)
      ? treeTopPath
      : path;
  }

  // Notes how the folder on screen is left (see FolderViewMemory). Search results are not
  // the folder, so leaving them notes nothing.
  function rememberFolderViewOnLeaving() {
    const path = currentPathRef.current;
    if (path.length === 0 || searchResultsVisibleRef.current) {
      return;
    }
    const contentScroller =
      contentPaneRef.current?.querySelector<HTMLElement>(CONTENT_SCROLL_SELECTOR) ?? null;
    folderViewMemoriesRef.current = rememberFolderView(
      folderViewMemoriesRef.current,
      path,
      {
        selection: contentSelection,
        contentScroll: {
          top: contentScroller?.scrollTop ?? 0,
          left: contentScroller?.scrollLeft ?? 0,
        },
      },
      historyPaths,
    );
  }

  // The list's scroll position to put back once the window has drawn the folder.
  const pendingContentScrollRef = useRef<FolderViewMemory["contentScroll"] | null>(null);
  const [scrollRestoreCount, setScrollRestoreCount] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per restore asked for.
  useLayoutEffect(() => {
    const contentScroll = pendingContentScrollRef.current;
    pendingContentScrollRef.current = null;
    const contentScroller =
      contentPaneRef.current?.querySelector<HTMLElement>(CONTENT_SCROLL_SELECTOR) ?? null;
    if (contentScroll && contentScroller) {
      contentScroller.scrollTop = contentScroll.top;
      contentScroller.scrollLeft = contentScroll.left;
    }
  }, [scrollRestoreCount]);

  async function navigateTo(
    path: string,
    historyMode: "push" | "replace" | "skip",
    includeHiddenOverride = includeHidden,
    sortByOverride = sortBy,
    sortDirectionOverride = sortDirection,
    foldersFirstOverride = foldersFirst,
    requestedOptions: {
      syncTree?: boolean;
      treeSelectionMode?: "filesystem" | "favorite" | "preserve";
      favoritePath?: string;
      /** The sidebar row to select with "favorite": a location's, when not a favorite's. */
      shortcutItemId?: TreeItemId;
      /** A folder that can't be read is still opened, showing why (true), or is unless it
       *  is gone ("unlessGone"): then nothing is opened, so the folder above can be. */
      persistOnError?: boolean | "unlessGone";
      forceTreeReload?: boolean;
      rerootTree?: boolean;
      /** Gone to from the sidebar. A location (Home, Macintosh HD, a disk) is the tree's top:
       *  the tree is rooted there. A favorite opens down within the tree, which moves to the
       *  favorite's own top only when it is outside the tree, as any folder does. */
      fromSidebar?: "location" | "favorite";
      /** The folder is read again where it stands: the selection is kept. */
      keepSelection?: boolean;
      /** Search results on screen stay there; only the folder underneath is read again. */
      keepSearchResults?: boolean;
      /** The folder is already on screen and is only checked for changes: no "Loading…". */
      quiet?: boolean;
      /** The folder was picked in the Go To box, which counts most for it there. */
      viaGoTo?: boolean;
      /** What the Info panel shows stays, even when it isn't the selection. */
      keepInfoTarget?: boolean;
      /** Back or Forward: the folder comes back as it was left (see FolderViewMemory). */
      restoreView?: boolean;
      /** Read again after a change made outside the app to these items in it (null: to
       *  anything in it): the info views ask again only if what they show is among them. */
      changedPaths?: readonly string[] | null;
    } = {},
  ): Promise<boolean> {
    if (path !== currentPathRef.current) {
      rememberFolderViewOnLeaving();
    }
    // The Trash, gone to from the sidebar, leaves the tree as it is: it is not a folder the
    // tree shows.
    const options =
      requestedOptions.fromSidebar !== undefined && isPathInsideTrash(path, homePath)
        ? { ...requestedOptions, fromSidebar: undefined, syncTree: false }
        : requestedOptions;
    const requestId = ++directoryRequestRef.current;
    pendingNavigationRef.current = { requestId, path };
    const isSameView = createViewGuard();
    if (!options.keepInfoTarget) {
      setInfoTargetPathOverride(null);
    }
    // A folder checked quietly keeps the error it shows until it is read: an unreadable one
    // read again would otherwise flash as empty.
    if (!options.quiet) {
      setDirectoryLoading(true);
      setDirectoryError(null);
      setLocationError(null);
    }
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
      if (options.quiet) {
        setDirectoryError(null);
        setLocationError(null);
      }
      const cachedMetadata = Object.fromEntries(
        response.entries.flatMap((entry) => {
          const cached = metadataCacheRef.current.get(entry.path);
          return cached ? [[entry.path, cached] as const] : [];
        }),
      );
      applyDirectorySnapshot(response.path, response.entries, cachedMetadata, options);
      const memory = options.restoreView ? folderViewMemoriesRef.current[response.path] : undefined;
      if (memory) {
        applyContentSelection(
          sanitizeContentSelection(memory.selection, response.entries),
          response.entries,
        );
        pendingContentScrollRef.current = memory.contentScroll;
        setScrollRestoreCount((count) => count + 1);
      }
      // The folder is on screen from here on, so it is in the history from here on: what
      // follows waits for the tree, and the tab may be left before the tree has answered.
      applyHistoryUpdate(response.path, historyMode);
      if (historyMode === "push") {
        // Going somewhere can count as a visit for the Go To box; Back, Forward and
        // reloads do not.
        folderVisitTrackerRef.current?.arrive(response.path, options.viaGoTo ?? false);
      }
      if (options.rerootTree) {
        initializeTree(response.path);
      }
      const treeRevealPath =
        options.fromSidebar === "location"
          ? resetTreeForSidebarJump(response.path, includeHiddenOverride)
          : response.path;
      if (options.syncTree !== false) {
        await syncTreeToPath(treeRevealPath, includeHiddenOverride, {
          forceReload: options.forceTreeReload ?? false,
          isCurrent: isSameView,
        });
        // The tree selection that follows is that of the tab that navigated; it may no
        // longer be the one on screen.
        if (!isSameView()) {
          return false;
        }
      }
      if (options.treeSelectionMode === "favorite") {
        setTreeSelection(
          options.shortcutItemId ?? createFavoriteItemId(options.favoritePath ?? response.path),
        );
        if (favoritesPlacement === "separate") {
          setLeftPaneSubview("favorites");
        }
      } else if (options.treeSelectionMode !== "preserve") {
        setTreeSelection(createFileSystemItemId(response.path));
        setLeftPaneSubview("tree");
      }
      return true;
    } catch (error) {
      if (directoryRequestRef.current !== requestId) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      setDirectoryError(message);
      setLocationError(message);
      if (
        options.persistOnError === true ||
        (options.persistOnError === "unlessGone" && !isFolderGoneError(message))
      ) {
        applyDirectorySnapshot(path, [], {}, options);
        // A folder that can't be listed (the Trash, without Full Disk Access) still takes
        // the tree back to its top.
        if (options.fromSidebar === "location") {
          const treeTopPath = resolveExplorerTreeRootPath(path, homePath);
          resetTreeForSidebarJump(path, includeHiddenOverride);
          void syncTreeToPath(treeTopPath, includeHiddenOverride, { isCurrent: isSameView });
        }
        if (options.treeSelectionMode === "favorite") {
          setTreeSelection(
            options.shortcutItemId ?? createFavoriteItemId(options.favoritePath ?? path),
          );
          if (favoritesPlacement === "separate") {
            setLeftPaneSubview("favorites");
          }
        } else if (options.treeSelectionMode === "filesystem") {
          setTreeSelection(createFileSystemItemId(path));
          setLeftPaneSubview("tree");
        }
        applyHistoryUpdate(path, historyMode);
        logger.error("directory navigation failed", error);
        return true;
      }
      logger.error("directory navigation failed", error);
      return false;
    } finally {
      if (directoryRequestRef.current === requestId) {
        setDirectoryLoading(false);
      }
      if (pendingNavigationRef.current?.requestId === requestId) {
        pendingNavigationRef.current = null;
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

  async function loadTreeChildren(
    path: string,
    includeHiddenOverride = includeHidden,
    expandOnSuccess = false,
    activePath = currentPath,
    forceReload = false,
  ) {
    const currentNode = treeNodesRef.current[path];
    const rootPath = treeRootPathRef.current;
    const forcedVisibleHiddenChildPath =
      includeHiddenOverride || rootPath.length === 0
        ? null
        : getForcedVisibleHiddenChildPath(path, activePath);
    const forcedVisiblePackageChildPath =
      rootPath.length === 0 ? null : getForcedVisiblePackageChildPath(path, activePath);
    if (currentNode?.loading && !forceReload) {
      return;
    }
    if (
      !forceReload &&
      currentNode?.loaded &&
      currentNode.loadedIncludeHidden === includeHiddenOverride &&
      (currentNode.forcedVisibleHiddenChildPath ?? null) === forcedVisibleHiddenChildPath &&
      (currentNode.forcedVisiblePackageChildPath ?? null) === forcedVisiblePackageChildPath
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

    // Numbered across the whole tree, not per folder: forgetting the requests under way
    // (a new root, another tab) can then never make an old answer look like a new one.
    nextTreeRequestId += 1;
    const requestId = nextTreeRequestId;
    treeRequestRef.current[path] = requestId;

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
      if (treeRequestRef.current[path] !== requestId) {
        return;
      }
      updateTreeNodes((current) => {
        const next = { ...current };
        const existingNode = current[path] ?? createTreeNode(path, true);
        // Macintosh HD's Volumes folder, where the other disks are mounted, is left out as
        // Finder leaves it out: those disks are under Locations.
        const children = response.children.filter(
          (child) => includeHiddenOverride || child.path !== "/Volumes",
        );
        const listedChildren =
          forcedVisibleHiddenChildPath === null
            ? children.filter((child) => includeHiddenOverride || !child.isHidden)
            : children.filter(
                (child) => !child.isHidden || child.path === forcedVisibleHiddenChildPath,
              );
        const visibleChildren =
          forcedVisiblePackageChildPath === null
            ? listedChildren
            : withPackageChild(listedChildren, forcedVisiblePackageChildPath);
        next[path] = {
          ...existingNode,
          expanded: existingNode.expanded || expandOnSuccess,
          loading: false,
          loaded: true,
          loadedIncludeHidden: includeHiddenOverride,
          forcedVisibleHiddenChildPath,
          forcedVisiblePackageChildPath,
          childPaths: visibleChildren.map((child) => child.path),
        };
        for (const child of visibleChildren) {
          const existingChildNode = current[child.path];
          next[child.path] = {
            path: child.path,
            name: child.name,
            kind: child.kind,
            isHidden: child.isHidden,
            isSymlink: child.isSymlink,
            expanded:
              existingChildNode?.expanded === true &&
              (existingChildNode.loaded ||
                existingChildNode.loading ||
                existingChildNode.childPaths.length > 0),
            loading: existingChildNode?.loading ?? false,
            loaded: existingChildNode?.loaded ?? false,
            loadedIncludeHidden: existingChildNode?.loadedIncludeHidden ?? false,
            forcedVisibleHiddenChildPath: existingChildNode?.forcedVisibleHiddenChildPath ?? null,
            forcedVisiblePackageChildPath: existingChildNode?.forcedVisiblePackageChildPath ?? null,
            error: null,
            childPaths: existingChildNode?.childPaths ?? [],
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

  async function syncTreeToPath(
    path: string,
    includeHiddenOverride: boolean,
    options: { forceReload?: boolean; isCurrent?: () => boolean } = {},
  ) {
    const forceReload = options.forceReload ?? false;
    const isCurrent = options.isCurrent ?? createViewGuard();
    const currentRootPath = treeRootPathRef.current;
    const nextRootPath =
      currentRootPath.length === 0 || !isPathWithinTreeRoot(path, currentRootPath)
        ? resolveExplorerTreeRootPath(path, homePath)
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

    await loadTreeChildren(nextRootPath, includeHiddenOverride, false, path, forceReload);

    if (path === nextRootPath || !isCurrent()) {
      return;
    }

    const ancestorChain = getAncestorChain(nextRootPath, path).slice(1, -1);
    for (const ancestorPath of ancestorChain) {
      ensureTreeNode(ancestorPath, true);
      await loadTreeChildren(ancestorPath, includeHiddenOverride, true, path, forceReload);
      if (!isCurrent()) {
        return;
      }
    }

    const focusedNode = treeNodesRef.current[path];
    if (path !== nextRootPath && (focusedNode?.expanded || forceReload)) {
      ensureTreeNode(path, focusedNode?.expanded ?? false);
      await loadTreeChildren(path, includeHiddenOverride, false, path, forceReload);
    }
  }

  async function navigateTreeFileSystemPath(
    path: string,
    historyMode: "push" | "replace" | "skip",
  ) {
    setTreeSelection(createFileSystemItemId(path));
    setLeftPaneSubview("tree");
    const node = treeNodesRef.current[path];
    if (node?.isSymlink) {
      await navigateTo(path, historyMode, undefined, undefined, undefined, undefined, {
        syncTree: false,
        treeSelectionMode: "preserve",
        persistOnError: true,
      });
      return;
    }
    await navigateTo(path, historyMode);
  }

  function toggleTreeNode(path: string) {
    const node = treeNodesRef.current[path];
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

  async function selectTreeItem(itemId: TreeItemId, historyMode: "push" | "replace" | "skip") {
    // The Favorites and Locations headings are not places: they are never selected, and the
    // folder on screen stays.
    if (isFavoritesRootItemId(itemId) || isLocationsRootItemId(itemId)) {
      return;
    }
    // A location: its row stays selected, and the folder tree shows it from its top.
    const locationPath = getLocationItemPath(itemId);
    if (locationPath) {
      setTreeSelection(itemId);
      if (favoritesPlacement === "separate") {
        setLeftPaneSubview("favorites");
      }
      await navigateTo(locationPath, historyMode, undefined, undefined, undefined, undefined, {
        fromSidebar: "location",
        treeSelectionMode: "favorite",
        shortcutItemId: itemId,
        persistOnError: true,
      });
      return;
    }
    const favoritePath = getFavoriteItemPath(itemId);
    if (favoritePath) {
      setTreeSelection(itemId);
      if (favoritesPlacement === "separate") {
        setLeftPaneSubview("favorites");
      }
      await navigateTo(favoritePath, historyMode, undefined, undefined, undefined, undefined, {
        fromSidebar: "favorite",
        treeSelectionMode: "favorite",
        favoritePath,
        persistOnError: true,
      });
      return;
    }
    const fileSystemPath = getFileSystemItemPath(itemId);
    if (!fileSystemPath) {
      return;
    }
    setLeftPaneSubview("tree");
    await navigateTreeFileSystemPath(fileSystemPath, historyMode);
  }

  async function openTreeNode() {
    const currentItemId = selectedTreeItemIdRef.current;
    if (favoritesPlacement === "separate" && leftPaneSubviewRef.current === "favorites") {
      const favoritePath = getShortcutItemPath(currentItemId);
      if (currentItemId && favoritePath) {
        await selectTreeItem(currentItemId, "push");
      }
      return;
    }
    if (isFavoritesRootItemId(currentItemId) || isLocationsRootItemId(currentItemId)) {
      return;
    }
    const favoritePath = getShortcutItemPath(currentItemId);
    if (currentItemId && favoritePath) {
      await selectTreeItem(currentItemId, "push");
      return;
    }
    const path = getFileSystemItemPath(currentItemId);
    if (!path) {
      return;
    }
    const node = treeNodesRef.current[path];
    if (!node) {
      return;
    }
    if (node.isSymlink) {
      await navigateTreeFileSystemPath(path, "push");
      return;
    }
    if (!node.loaded) {
      await loadTreeChildren(path, includeHidden, true);
      return;
    }
    toggleTreeNode(path);
  }

  async function navigateTreeSelectionToParent() {
    const currentItemId = selectedTreeItemIdRef.current;
    if (favoritesPlacement === "separate" && leftPaneSubviewRef.current === "favorites") {
      return;
    }
    // A favorite or a location has nothing above it: its heading is not a place.
    if (isFavoriteItemId(currentItemId) || isLocationItemId(currentItemId)) {
      return;
    }
    const path = getFileSystemItemPath(currentItemId);
    if (!path || isVolumeRootPath(path)) {
      return;
    }
    const nextPath = parentDirectoryPath(path);
    if (nextPath && nextPath !== path) {
      await selectTreeItem(createFileSystemItemId(nextPath), "push");
    }
  }

  async function handleTreeKeyboardAction(
    key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End",
  ): Promise<boolean> {
    if (favoritesPlacement === "separate" && leftPaneSubviewRef.current === "favorites") {
      const favoriteItemIds = getFavoriteItemIds();
      if (favoriteItemIds.length === 0) {
        return false;
      }
      const currentItemId = selectedTreeItemIdRef.current;
      const currentIndex = favoriteItemIds.findIndex((itemId) => itemId === currentItemId);
      const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
      if (key === "Home") {
        const firstFavoriteId = favoriteItemIds[0];
        if (!firstFavoriteId) {
          return false;
        }
        await selectTreeItem(firstFavoriteId, "push");
        return true;
      }
      if (key === "End") {
        const lastFavoriteId = favoriteItemIds.at(-1);
        if (!lastFavoriteId) {
          return false;
        }
        await selectTreeItem(lastFavoriteId, "push");
        return true;
      }
      if (key === "ArrowLeft" || key === "ArrowRight") {
        return false;
      }
      if (key === "ArrowUp") {
        const previousId = favoriteItemIds[safeCurrentIndex - 1];
        if (!previousId) {
          return false;
        }
        await selectTreeItem(previousId, "push");
        return true;
      }
      if (key === "ArrowDown") {
        const nextFavoriteId = favoriteItemIds[safeCurrentIndex + 1];
        if (nextFavoriteId) {
          await selectTreeItem(nextFavoriteId, "push");
          return true;
        }
        const firstTreeId = getTreePresentationState().visibleItemIds[0];
        if (!firstTreeId) {
          return false;
        }
        setLeftPaneSubview("tree");
        await selectTreeItem(firstTreeId, "push");
        return true;
      }
      return false;
    }

    const { items, visibleItemIds: allVisibleItemIds } = getTreePresentationState();
    // The arrow keys go past the Favorites and Locations headings, as in Finder's sidebar.
    const visibleItemIds = allVisibleItemIds.filter(
      (itemId) => !isFavoritesRootItemId(itemId) && !isLocationsRootItemId(itemId),
    );
    if (visibleItemIds.length === 0) {
      if (
        favoritesPlacement === "separate" &&
        leftPaneSubviewRef.current === "tree" &&
        key === "ArrowUp"
      ) {
        const favoriteItemIds = getFavoriteItemIds();
        const lastFavoriteId = favoriteItemIds.at(-1);
        if (lastFavoriteId) {
          setLeftPaneSubview("favorites");
          await selectTreeItem(lastFavoriteId, "push");
          return true;
        }
      }
      return false;
    }
    const currentItemId = selectedTreeItemIdRef.current;
    const currentIndex = visibleItemIds.findIndex((itemId) => itemId === currentItemId);
    const safeCurrentId = currentIndex >= 0 ? currentItemId : (visibleItemIds[0] ?? null);
    if (!safeCurrentId) {
      return false;
    }
    const currentItem = items[safeCurrentId];
    if (!currentItem) {
      return false;
    }

    if (key === "Home") {
      const firstId = visibleItemIds[0];
      if (firstId) {
        await selectTreeItem(firstId, "push");
        return true;
      }
      return false;
    }
    if (key === "End") {
      const lastId = visibleItemIds.at(-1);
      if (lastId) {
        await selectTreeItem(lastId, "push");
        return true;
      }
      return false;
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      if (
        favoritesPlacement === "separate" &&
        leftPaneSubviewRef.current === "tree" &&
        key === "ArrowUp" &&
        baseIndex === 0
      ) {
        const favoriteItemIds = getFavoriteItemIds();
        const lastFavoriteId = favoriteItemIds.at(-1);
        if (lastFavoriteId) {
          setLeftPaneSubview("favorites");
          await selectTreeItem(lastFavoriteId, "push");
          return true;
        }
      }
      const nextIndex =
        key === "ArrowUp"
          ? Math.max(0, baseIndex - 1)
          : Math.min(visibleItemIds.length - 1, baseIndex + 1);
      const nextId = visibleItemIds[nextIndex];
      if (!nextId) {
        return false;
      }
      await selectTreeItem(nextId, "push");
      return true;
    }
    if (key === "ArrowRight") {
      if (isFavoriteItemId(safeCurrentId) || isLocationItemId(safeCurrentId)) {
        return false;
      }
      const path = getFileSystemItemPath(safeCurrentId);
      const node = path ? treeNodesRef.current[path] : null;
      if (!path || !node || node.isSymlink) {
        return false;
      }
      if (!node.loaded) {
        await loadTreeChildren(path, includeHidden, true);
        return true;
      }
      if (!node.expanded && node.childPaths.length > 0) {
        toggleTreeNode(path);
        return true;
      }
      if (node.expanded && node.childPaths.length > 0) {
        const firstChildPath = node.childPaths[0];
        if (firstChildPath) {
          await selectTreeItem(createFileSystemItemId(firstChildPath), "push");
          return true;
        }
      }
      return false;
    }

    // A favorite or a location has nothing above it to go to.
    if (isFavoriteItemId(safeCurrentId) || isLocationItemId(safeCurrentId)) {
      return false;
    }
    const path = getFileSystemItemPath(safeCurrentId);
    const node = path ? treeNodesRef.current[path] : null;
    if (!path || !node) {
      return false;
    }
    if (node.expanded && node.childPaths.length > 0) {
      toggleTreeNode(path);
      return true;
    }
    // The top of the tree, or of a disk: there is nothing above it to go to.
    if (path === treeRootPathRef.current || isVolumeRootPath(path)) {
      return false;
    }
    const parentPath = parentDirectoryPath(path);
    if (!parentPath || parentPath === path) {
      return false;
    }
    await selectTreeItem(createFileSystemItemId(parentPath), "push");
    return true;
  }

  // Set while the folder reloads for a hidden-files change made with search results on
  // screen: search follows that setting and runs again (useExplorerSearchController), so the
  // reload underneath must not close the results as a navigation would.
  const keepSearchResultsOnReloadRef = useRef(false);

  function toggleHiddenFiles() {
    const nextValue = !includeHidden;
    setIncludeHidden(nextValue);
    if (!currentPath) {
      return;
    }
    const reloadOptions = getSelectedTreeReloadOptions(currentPath);
    if (!reloadOptions) {
      reinitializeTree(treeRootPath || currentPath, currentPath);
    }
    keepSearchResultsOnReloadRef.current = searchResultsVisibleRef.current;
    void navigateTo(
      currentPath,
      "replace",
      nextValue,
      undefined,
      undefined,
      undefined,
      reloadOptions,
    ).finally(() => {
      keepSearchResultsOnReloadRef.current = false;
    });
  }

  async function refreshVisibleTreePath(
    path: string,
    activePath = currentPathRef.current,
    options: {
      recursive?: boolean;
      visitedPaths?: Set<string>;
      isCurrent?: () => boolean;
    } = {},
  ) {
    const recursive = options.recursive ?? false;
    const visitedPaths = options.visitedPaths ?? new Set<string>();
    const isCurrent = options.isCurrent ?? createViewGuard();
    if (visitedPaths.has(path)) {
      return;
    }
    visitedPaths.add(path);
    const treeRootPath = treeRootPathRef.current;
    if (path.length === 0 || !isPathWithinTreeRoot(path, treeRootPath)) {
      return;
    }
    const node = treeNodesRef.current[path];
    if (!node) {
      return;
    }
    await loadTreeChildren(path, includeHidden, node.expanded, activePath, true);
    if (!recursive || !isCurrent()) {
      return;
    }
    const refreshedNode = treeNodesRef.current[path];
    if (!refreshedNode?.expanded) {
      return;
    }
    for (const childPath of refreshedNode.childPaths) {
      const childNode = treeNodesRef.current[childPath];
      if (!childNode?.expanded) {
        continue;
      }
      await refreshVisibleTreePath(childPath, activePath, {
        recursive: true,
        visitedPaths,
        isCurrent,
      });
      if (!isCurrent()) {
        return;
      }
    }
  }

  async function refreshDirectory(
    options: {
      path?: string;
      treeSelectionPath?: string | null;
      extraTreeReloadPaths?: string[];
    } = {},
  ) {
    // The folder, and the paths it was asked with, belong to the tab on screen now. If
    // another tab comes to the front while this waits, the refresh stops: that tab reads
    // its own folder again when it is shown.
    const isSameView = createViewGuard();
    // Stale caches only cost a slower or older listing; the folder is still read again.
    await client.invoke("app:clearCaches", {}).catch((error: unknown) => {
      logger.error("clear caches failed", error);
    });
    if (!isSameView()) {
      return;
    }
    const targetPath = options.path ?? currentPathRef.current;
    if (!targetPath) {
      return;
    }
    // A folder the person is opening right now wins: reading the old one again would take
    // its place and send them back.
    const pendingNavigation = pendingNavigationRef.current;
    if (pendingNavigation !== null && pendingNavigation.path !== targetPath) {
      return;
    }
    const reloadOptions = getSelectedTreeReloadOptions(targetPath);
    await navigateTo(targetPath, "replace", undefined, undefined, undefined, undefined, {
      ...reloadOptions,
      forceTreeReload: true,
      // Read again in place: what is selected stays selected (what the operation made is
      // selected instead, when it asks for that), and search results stay on screen.
      keepSelection: targetPath === currentPathRef.current,
      keepSearchResults: true,
    });
    if (!isSameView()) {
      return;
    }
    if (options.treeSelectionPath) {
      await syncTreeToPath(options.treeSelectionPath, includeHidden, {
        forceReload: true,
        isCurrent: isSameView,
      });
      if (!isSameView()) {
        return;
      }
      setTreeSelection(createFileSystemItemId(options.treeSelectionPath));
      setLeftPaneSubview("tree");
    }
    const visitedTreeReloadPaths = new Set<string>();
    for (const extraTreeReloadPath of [...new Set(options.extraTreeReloadPaths ?? [])]) {
      await refreshVisibleTreePath(extraTreeReloadPath, targetPath, {
        recursive: true,
        visitedPaths: visitedTreeReloadPaths,
        isCurrent: isSameView,
      });
      if (!isSameView()) {
        return;
      }
    }
  }

  // Opens `path`, or the nearest folder above it that still exists. Resolves to whether a
  // folder was opened; a newer navigation that takes over ends the attempt.
  async function navigateToNearestExistingFolder(
    path: string,
    historyMode: "push" | "replace" | "skip",
    options: Parameters<typeof navigateTo>[6] = {},
  ): Promise<boolean> {
    for (const candidatePath of getPathAndAncestors(path)) {
      const requestId = directoryRequestRef.current + 1;
      const didOpen = await navigateTo(
        candidatePath,
        candidatePath === path ? historyMode : "replace",
        undefined,
        undefined,
        undefined,
        undefined,
        candidatePath === path ? options : {},
      );
      if (didOpen) {
        return true;
      }
      if (directoryRequestRef.current !== requestId) {
        return false;
      }
    }
    return false;
  }

  // Reads the folder on screen again where it stands: its selection, its search results
  // and its place in the history are kept. A tab does this when it comes back on screen,
  // since its folder may have changed while another tab was in front. If the folder is
  // gone, the nearest folder above it that still exists is opened instead.
  async function reloadFolderInPlace(options: { refreshExpandedTree?: boolean } = {}) {
    const targetPath = currentPathRef.current;
    if (!targetPath) {
      return;
    }
    const isSameView = createViewGuard();
    const didOpen = await navigateToNearestExistingFolder(targetPath, "skip", {
      ...getSelectedTreeReloadOptions(targetPath),
      // One that can't be read (the Trash, without Full Disk Access) stays, showing why.
      persistOnError: "unlessGone",
      forceTreeReload: true,
      keepSelection: true,
      keepSearchResults: true,
      quiet: true,
    });
    if (didOpen && options.refreshExpandedTree && isSameView()) {
      await refreshVisibleTreePath(treeRootPathRef.current, currentPathRef.current, {
        recursive: true,
        isCurrent: isSameView,
      });
    }
  }

  // Reads the folder on screen again after a change made outside the app, as quietly as can
  // be: the selection, the search results, the tree and what the Info panel shows all stay.
  // `changedPaths` are the items in `folderPath` that changed (null when that isn't known):
  // their details are read again. If the folder is gone, the nearest folder above it is
  // opened instead; one that can't be read stays, showing why. Resolves to false when it has
  // to wait: the folder is being read already, and that read may have started before the
  // change.
  async function reloadFolderAfterOutsideChange(
    folderPath: string,
    changedPaths: readonly string[] | null,
  ): Promise<boolean> {
    const targetPath = currentPathRef.current;
    // A folder left behind, even just now, is not read again: that would go back to it.
    if (!targetPath || targetPath !== folderPath) {
      return true;
    }
    const pendingNavigation = pendingNavigationRef.current;
    if (pendingNavigation !== null) {
      // Another folder being opened leaves this one behind.
      return pendingNavigation.path !== targetPath;
    }
    const stalePaths = staleMetadataPathsRef.current;
    let newlyStale = false;
    for (const path of changedPaths ?? currentEntries.map((entry) => entry.path)) {
      if (metadataCacheRef.current.has(path) && !stalePaths.has(path)) {
        stalePaths.add(path);
        newlyStale = true;
      }
    }
    const didOpen = await navigateToNearestExistingFolder(targetPath, "skip", {
      syncTree: false,
      treeSelectionMode: "preserve",
      persistOnError: "unlessGone",
      keepSelection: true,
      keepSearchResults: true,
      keepInfoTarget: true,
      quiet: true,
      changedPaths,
    });
    // The listing may be the same as before, which leaves the details on screen as they
    // were: those of the items that changed are asked for again all the same.
    if (didOpen && newlyStale) {
      setStaleDetailsCheck((count) => count + 1);
    }
    return true;
  }

  function handleSortChange(nextSortBy: SortBy) {
    const nextSortDirection: SortDirection =
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
      getSelectedTreeReloadOptions(currentPath),
    );
  }

  function toggleFoldersFirst() {
    const nextValue = !foldersFirst;
    setFoldersFirst(nextValue);
    if (!currentPath) {
      return;
    }
    void navigateTo(
      currentPath,
      "replace",
      includeHidden,
      sortBy,
      sortDirection,
      nextValue,
      getSelectedTreeReloadOptions(currentPath),
    );
  }

  // Resolves to whether the folder was opened; the box stays up with the error otherwise.
  async function submitLocationPath(path: string): Promise<boolean> {
    setLocationSubmitting(true);
    try {
      const trimmedPath = path.trim();
      const expandedPath = expandHomeShortcut(trimmedPath, homePath);
      const didNavigate = await navigateTo(
        expandedPath,
        "push",
        undefined,
        undefined,
        undefined,
        undefined,
        { viaGoTo: true },
      );
      if (didNavigate) {
        setLocationSheetOpen(false);
      }
      return didNavigate;
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
    // The tree grows to the right, the Info panel to the left.
    const towardPane = pane === "tree" ? event.key === "ArrowRight" : event.key === "ArrowLeft";
    panes.nudgeWidth(pane, towardPane ? step : -step);
  }

  useEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes, treeNodesRef]);

  useEffect(() => {
    selectedTreeItemIdRef.current = selectedTreeItemId;
  }, [selectedTreeItemId, selectedTreeItemIdRef]);

  useLayoutEffect(() => {
    currentPathRef.current = currentPath;
    folderVisitTrackerRef.current?.showing(currentPath);
  }, [currentPath, currentPathRef]);

  useLayoutEffect(() => {
    isSearchModeRef.current = isSearchMode;
  }, [isSearchMode, isSearchModeRef]);

  useEffect(() => {
    treeRootPathRef.current = treeRootPath;
  }, [treeRootPath, treeRootPathRef]);

  useEffect(() => {
    typeaheadQueryRef.current = typeaheadQuery;
  }, [typeaheadQuery, typeaheadQueryRef]);

  useEffect(() => {
    typeaheadPaneRef.current = typeaheadPane;
  }, [typeaheadPane, typeaheadPaneRef]);

  useEffect(() => {
    if (focusedPane === null) {
      clearTypeahead();
      return;
    }
    if (typeaheadPane && focusedPane !== typeaheadPane) {
      clearTypeahead();
    }
  }, [clearTypeahead, focusedPane, typeaheadPane]);

  useEffect(() => {
    if (focusedPane === "tree" || focusedPane === "content") {
      lastExplorerFocusPaneRef.current = focusedPane;
    }
  }, [focusedPane, lastExplorerFocusPaneRef]);

  useEffect(() => {
    leftPaneSubviewRef.current = leftPaneSubview;
    lastLeftPaneSubviewRef.current = leftPaneSubview;
  }, [leftPaneSubview, leftPaneSubviewRef, lastLeftPaneSubviewRef]);

  useEffect(() => {
    if (
      !preferencesReady ||
      mainView !== "explorer" ||
      locationDialogOpen ||
      explorerFocusSuppressed ||
      actionNotice ||
      contextMenuState ||
      focusedPane !== null
    ) {
      return;
    }
    const activeElement = document.activeElement;
    // A text field that has focus keeps it: the search results' filter and the path bar's
    // field leave no pane focused, and taking it back would leave them without a caret.
    if (
      searchPointerIntentRef.current ||
      (activeElement instanceof Node &&
        (searchShellRef.current?.contains(activeElement) ?? false)) ||
      resolveFocusedEditTarget(activeElement) === "editable-text"
    ) {
      return;
    }
    restoreExplorerPaneFocus();
  }, [
    actionNotice,
    contextMenuState,
    explorerFocusSuppressed,
    focusedPane,
    locationDialogOpen,
    mainView,
    preferencesReady,
    restoreExplorerPaneFocus,
    searchPointerIntentRef,
    searchShellRef,
  ]);

  // The details of the items on screen in the Details view, which shows them, and of several
  // selected files in any view, whose sizes the Info Row and the Info panel add up.
  // biome-ignore lint/correctness/useExhaustiveDependencies: staleDetailsCheck looks again at the items whose details went stale.
  useEffect(() => {
    if (isSearchMode || currentPath.length === 0 || directoryLoading) {
      return;
    }
    const entryIndexByPath = new Map(currentEntries.map((entry, index) => [entry.path, index]));
    const prioritizedPaths = new Set<string>();
    if (contentSelection.paths.length > 1) {
      for (const path of contentSelection.paths) {
        const entry = currentEntries[entryIndexByPath.get(path) ?? -1];
        if (entry && !isFolderSizeEligibleKind(entry.kind)) {
          prioritizedPaths.add(path);
        }
      }
    }
    if (viewMode === "details") {
      for (const path of visiblePaths) {
        if (entryIndexByPath.has(path)) {
          prioritizedPaths.add(path);
        }
      }
    }
    if (
      viewMode === "details" &&
      visiblePaths.length > 0 &&
      currentEntries.length > visiblePaths.length
    ) {
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
    const stalePaths = staleMetadataPathsRef.current;
    for (const path of prioritizedPaths) {
      // An item that changed on disk keeps what is shown for it until it is read again.
      const stale = stalePaths.has(path);
      if (metadataByPath[path] && !stale) {
        continue;
      }
      const cached = stale ? undefined : metadataCacheRef.current.get(path);
      if (cached) {
        cachedItems.push(cached);
        continue;
      }
      if (metadataInflightRef.current.has(path)) {
        continue;
      }
      stalePaths.delete(path);
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
        // Nothing new (the items are gone): the list stays as it is, or this would ask again.
        if (response.items.length === 0) {
          return;
        }
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
      .catch(() => undefined)
      .finally(() => {
        for (const path of missingPaths) {
          metadataInflightRef.current.delete(path);
        }
      });
  }, [
    client,
    contentSelection.paths,
    currentEntries,
    currentPath,
    directoryLoading,
    isSearchMode,
    metadataByPath,
    setMetadataByPath,
    viewMode,
    visiblePaths,
    metadataCacheRef,
    metadataInflightRef,
    staleDetailsCheck,
  ]);

  // Properties of recently shown items, so moving back to one shows it at once; it is still
  // asked for again in the background in case it changed.
  const infoPropertiesCacheRef = useRef(new Map<string, ItemProperties>());
  const [infoRefreshKey, setInfoRefreshKey] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: infoRefreshKey asks again after the folder reloads.
  useEffect(() => {
    if ((!infoPanelOpen && !infoRowOpen) || currentPath.length === 0) {
      return;
    }
    const targetPath = infoTargetPathOverride ?? contentSelection.leadPath ?? currentPath;
    const requestId = ++getInfoRequestRef.current;
    const cached = infoPropertiesCacheRef.current.get(targetPath);
    if (cached) {
      setGetInfoItem(cached);
    }
    setGetInfoLoading(!cached);
    // A short pause, so holding an arrow key doesn't ask for every item passed on the way.
    const timer = window.setTimeout(() => {
      void client
        .invoke("item:getProperties", { path: targetPath })
        .then((response) => {
          rememberInfoProperties(infoPropertiesCacheRef.current, response.item);
          if (getInfoRequestRef.current !== requestId) {
            return;
          }
          setGetInfoItem(response.item);
        })
        .catch((error) => {
          infoPropertiesCacheRef.current.delete(targetPath);
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
    }, INFO_FETCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    client,
    contentSelection.leadPath,
    currentPath,
    getInfoRequestRef,
    infoRefreshKey,
    infoTargetPathOverride,
    infoPanelOpen,
    infoRowOpen,
    setGetInfoItem,
    setGetInfoLoading,
  ]);

  return {
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
    reinitializeTree,
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
  };
}

type ItemProperties = IpcResponse<"item:getProperties">["item"];

let nextTreeRequestId = 0;

// Names the list a typed filter belongs to: a folder, or one search.
function getListFilterOwner(
  currentPath: string,
  isSearchMode: boolean,
  searchCommittedQuery: string,
): string {
  return `${currentPath}\n${isSearchMode ? "search" : "folder"}\n${searchCommittedQuery}`;
}

// The sidebar's type-to-select forgets what was typed after this long without a key.
const TREE_TYPEAHEAD_RESET_MS = 1000;
const INFO_FETCH_DELAY_MS = 80;
const INFO_PROPERTIES_CACHE_LIMIT = 200;

function rememberInfoProperties(cache: Map<string, ItemProperties>, item: ItemProperties): void {
  cache.delete(item.path);
  cache.set(item.path, item);
  for (const path of cache.keys()) {
    if (cache.size <= INFO_PROPERTIES_CACHE_LIMIT) {
      break;
    }
    cache.delete(path);
  }
}
