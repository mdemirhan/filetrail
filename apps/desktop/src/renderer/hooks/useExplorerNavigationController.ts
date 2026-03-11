import {
  type Dispatch,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
} from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";
import type { FavoritePreference, FavoritesPlacement } from "../../shared/appPreferences";

import { SEARCH_RESULT_ROW_HEIGHT } from "../components/SearchResultsPane";
import type { TreeNodeState } from "../components/TreePane";
import type { ContentSelectionState } from "../lib/contentSelection";
import { getDetailsRowHeight } from "../lib/detailsLayout";
import {
  createTreeNode,
  isPathWithinRoot,
  resolveExplorerTreeRootPath,
} from "../lib/explorerAppUtils";
import {
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getNextSelectionIndex,
  getPageStepItemCount,
  getPagedSelectionIndex,
  getTreeSeedChain,
  parentDirectoryPath,
  pathHasHiddenSegmentWithinRoot,
} from "../lib/explorerNavigation";
import { type ExplorerPane, resolveExplorerPaneRestoreTarget } from "../lib/explorerPaneFocus";
import type { DirectoryEntry, DirectoryEntryMetadata } from "../lib/explorerTypes";
import {
  type TreeItemId,
  buildTreePresentation,
  createFavoriteItemId,
  createFileSystemItemId,
  getFavoriteItemPath,
  getFavoriteLabel,
  getFavoritesRootItemId,
  getFileSystemItemPath,
  getTrashPath,
  isFavoriteItemId,
  isFavoritesRootItemId,
} from "../lib/favorites";
import type { useFiletrailClient } from "../lib/filetrailClient";
import { getFlowListColumnStep } from "../lib/flowListLayout";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { createRendererLogger } from "../lib/logging";
import { pageScrollElement, scrollElementByAmount } from "../lib/pagedScroll";
import { findContentTypeaheadMatch } from "../lib/typeahead";

const logger = createRendererLogger("filetrail.renderer");

export function useExplorerNavigationController(args: {
  client: ReturnType<typeof useFiletrailClient>;
  preferencesReady: boolean;
  mainView: "explorer" | "help" | "settings" | "action-log";
  locationDialogOpen: boolean;
  explorerFocusSuppressed: boolean;
  actionNotice: { title: string; message: string } | null;
  contextMenuState: { paths: string[]; targetPath: string | null } | null;
  searchShellRef: RefObject<HTMLDivElement | null>;
  searchPointerIntentRef: MutableRefObject<boolean>;
  treePaneRef: RefObject<HTMLElement | null>;
  contentPaneRef: RefObject<HTMLElement | null>;
  typeaheadTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  typeaheadQueryRef: MutableRefObject<string>;
  typeaheadPaneRef: MutableRefObject<"tree" | "content" | null>;
  typeaheadDebounceMs: number;
  typeaheadEnabled: boolean;
  homePath: string;
  treeRootPath: string;
  setTreeRootPath: Dispatch<SetStateAction<string>>;
  treeNodes: Record<string, TreeNodeState>;
  setTreeNodes: Dispatch<SetStateAction<Record<string, TreeNodeState>>>;
  favorites: FavoritePreference[];
  favoritesPlacement: FavoritesPlacement;
  favoritesExpanded: boolean;
  setFavoritesExpanded: Dispatch<SetStateAction<boolean>>;
  selectedTreeItemId: TreeItemId | null;
  setSelectedTreeItemId: Dispatch<SetStateAction<TreeItemId | null>>;
  currentPath: string;
  setCurrentPath: Dispatch<SetStateAction<string>>;
  currentEntries: DirectoryEntry[];
  setCurrentEntries: Dispatch<SetStateAction<DirectoryEntry[]>>;
  activeContentEntries: DirectoryEntry[];
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  setMetadataByPath: Dispatch<SetStateAction<Record<string, DirectoryEntryMetadata>>>;
  directoryLoading: boolean;
  setDirectoryLoading: Dispatch<SetStateAction<boolean>>;
  setDirectoryError: Dispatch<SetStateAction<string | null>>;
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"];
  setSortBy: Dispatch<SetStateAction<IpcRequest<"directory:getSnapshot">["sortBy"]>>;
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"];
  setSortDirection: Dispatch<SetStateAction<IpcRequest<"directory:getSnapshot">["sortDirection"]>>;
  foldersFirst: boolean;
  setFoldersFirst: Dispatch<SetStateAction<boolean>>;
  includeHidden: boolean;
  setIncludeHidden: Dispatch<SetStateAction<boolean>>;
  viewMode: "list" | "details";
  compactListView: boolean;
  compactDetailsView: boolean;
  compactTreeView: boolean;
  contentSelection: ContentSelectionState;
  contentColumns: number;
  setVisiblePaths: Dispatch<SetStateAction<string[]>>;
  visiblePaths: string[];
  historyPaths: string[];
  setHistoryPaths: Dispatch<SetStateAction<string[]>>;
  historyIndex: number;
  setHistoryIndex: Dispatch<SetStateAction<number>>;
  locationSubmitting: boolean;
  setLocationSubmitting: Dispatch<SetStateAction<boolean>>;
  setLocationSheetOpen: Dispatch<SetStateAction<boolean>>;
  setLocationError: Dispatch<SetStateAction<string | null>>;
  focusedPane: "tree" | "content" | null;
  setFocusedPane: Dispatch<SetStateAction<"tree" | "content" | null>>;
  leftPaneSubview: "favorites" | "tree";
  setLeftPaneSubview: Dispatch<SetStateAction<"favorites" | "tree">>;
  typeaheadQuery: string;
  typeaheadPane: "tree" | "content" | null;
  setTypeaheadPane: Dispatch<SetStateAction<"tree" | "content" | null>>;
  setTypeaheadQuery: Dispatch<SetStateAction<string>>;
  infoTargetPathOverride: string | null;
  setInfoTargetPathOverride: Dispatch<SetStateAction<string | null>>;
  infoPanelOpen: boolean;
  infoRowOpen: boolean;
  setGetInfoLoading: Dispatch<SetStateAction<boolean>>;
  setGetInfoItem: Dispatch<SetStateAction<IpcResponse<"item:getProperties">["item"] | null>>;
  panes: {
    setTreeWidth: Dispatch<SetStateAction<number>>;
    setInspectorWidth: Dispatch<SetStateAction<number>>;
  };
  searchCommittedQuery: string;
  searchResultsVisible: boolean;
  setSearchResultsVisible: Dispatch<SetStateAction<boolean>>;
  searchResultsVisibleRef: MutableRefObject<boolean>;
  isSearchModeRef: MutableRefObject<boolean>;
  applyContentSelection: (selection: ContentSelectionState, entries: DirectoryEntry[]) => void;
  setSingleContentSelection: (path: string) => void;
  directoryRequestRef: MutableRefObject<number>;
  getInfoRequestRef: MutableRefObject<number>;
  treeRequestRef: MutableRefObject<Record<string, number>>;
  treeNodesRef: MutableRefObject<Record<string, TreeNodeState>>;
  selectedTreeItemIdRef: MutableRefObject<TreeItemId | null>;
  treeRootPathRef: MutableRefObject<string>;
  metadataCacheRef: MutableRefObject<Map<string, DirectoryEntryMetadata>>;
  metadataInflightRef: MutableRefObject<Set<string>>;
  currentPathRef: MutableRefObject<string>;
  selectedPathsInViewOrderRef: MutableRefObject<string[]>;
  selectedEntryRef: MutableRefObject<DirectoryEntry | null>;
  lastExplorerFocusPaneRef: MutableRefObject<"tree" | "content" | null>;
  leftPaneSubviewRef: MutableRefObject<"favorites" | "tree">;
  lastLeftPaneSubviewRef: MutableRefObject<"favorites" | "tree">;
  pendingPasteSelectionRef: MutableRefObject<{
    directoryPath: string;
    selectedPaths: string[];
  } | null>;
}) {
  type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
  type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];

  const {
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
    favoritesPlacement,
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
    setLocationSubmitting,
    setLocationSheetOpen,
    setLocationError,
    focusedPane,
    setFocusedPane,
    leftPaneSubview,
    setLeftPaneSubview,
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
    panes,
    searchCommittedQuery,
    searchResultsVisible,
    setSearchResultsVisible,
    searchResultsVisibleRef,
    isSearchModeRef,
    applyContentSelection,
    setSingleContentSelection,
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
    leftPaneSubviewRef,
    lastLeftPaneSubviewRef,
    pendingPasteSelectionRef,
  } = args;

  const hasCachedSearch = searchCommittedQuery.trim().length > 0;
  const isSearchMode = searchResultsVisible && hasCachedSearch;

  const clearTypeahead = useCallback(() => {
    if (typeaheadTimeoutRef.current) {
      clearTimeout(typeaheadTimeoutRef.current);
      typeaheadTimeoutRef.current = null;
    }
    typeaheadQueryRef.current = "";
    typeaheadPaneRef.current = null;
    setTypeaheadQuery("");
    setTypeaheadPane(null);
  }, [
    setTypeaheadPane,
    setTypeaheadQuery,
    typeaheadPaneRef,
    typeaheadQueryRef,
    typeaheadTimeoutRef,
  ]);

  const focusContentPane = useCallback(() => {
    setFocusedPane("content");
    clearTypeahead();
    window.requestAnimationFrame(() => {
      contentPaneRef.current?.focus({ preventScroll: true });
      window.requestAnimationFrame(() => {
        contentPaneRef.current?.focus({ preventScroll: true });
      });
    });
  }, [clearTypeahead, contentPaneRef, setFocusedPane]);

  const focusTreePane = useCallback(() => {
    setFocusedPane("tree");
    clearTypeahead();
    window.requestAnimationFrame(() => {
      const targetSubview =
        favoritesPlacement === "separate" ? lastLeftPaneSubviewRef.current : "tree";
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
      window.requestAnimationFrame(() => {
        if (focusTarget) {
          focusTarget.focus({ preventScroll: true });
        } else {
          treePaneRef.current?.focus({ preventScroll: true });
        }
      });
    });
  }, [clearTypeahead, favoritesPlacement, lastLeftPaneSubviewRef, treePaneRef, setFocusedPane]);

  function getTreePresentationState() {
    return buildTreePresentation({
      favorites,
      favoritesExpanded,
      homePath,
      rootPath: treeRootPathRef.current,
      nodes: treeNodesRef.current,
      includeFavorites: favoritesPlacement === "integrated",
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

  function getFavoriteItemIds(): TreeItemId[] {
    return favorites.map((favorite) => createFavoriteItemId(favorite.path));
  }

  function getFavoriteLabelById(itemId: TreeItemId): string {
    const favoritePath = getFavoriteItemPath(itemId);
    return favoritePath ? getFavoriteLabel(favoritePath, homePath) : "";
  }

  function getSelectedTreeReloadOptions(path: string) {
    const favoritePath = getFavoriteItemPath(selectedTreeItemIdRef.current);
    if (!favoritePath || favoritePath !== path) {
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
        focusTreePane();
        return;
      }
      if (targetPane === "content") {
        focusContentPane();
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
        const element = treePaneRef.current?.querySelector<HTMLElement>(".favorites-scroll");
        return element ? { axis: "vertical", element } : null;
      }
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
          compactTreeView ? 25 : 32,
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
      const { visibleItemIds } = getTreePresentationState();
      if (visibleItemIds.length === 0) {
        return didScroll;
      }
      const currentIndex = visibleItemIds.findIndex(
        (itemId) => itemId === selectedTreeItemIdRef.current,
      );
      const stepItems = getPageStepItemCount(
        target.element.clientHeight,
        compactTreeView ? 25 : 32,
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
    const selectedTreePath = getFileSystemItemPath(selectedTreeItemIdRef.current);
    const nextSelectionPath =
      selectedTreePath && isPathWithinRoot(selectedTreePath, homePath) ? selectedTreePath : null;

    if (nextSelectionPath) {
      reinitializeTree(homePath, nextSelectionPath);
      setTreeSelection(createFileSystemItemId(nextSelectionPath));
      setLeftPaneSubview("tree");
      void syncTreeToPath(nextSelectionPath, includeHidden, {
        forceReload: true,
      });
      return;
    }

    initializeTree(homePath);
    applyEmptyDirectorySnapshot();
    setTreeSelection(createFileSystemItemId(""));
    setLeftPaneSubview("tree");
    void loadTreeChildren(homePath, includeHidden, false, currentPathRef.current, true);
  }

  function goQuickAccess(location: "root" | "applications" | "trash") {
    const targetPath =
      location === "root"
        ? "/"
        : location === "applications"
          ? "/Applications"
          : homePath.length > 0
            ? getTrashPath(homePath)
            : "";
    if (targetPath.length === 0) {
      return;
    }
    void navigateTo(targetPath, "push");
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

  function applyEmptyDirectorySnapshot() {
    metadataCacheRef.current = new Map();
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
  ) {
    metadataCacheRef.current = new Map(Object.entries(cachedMetadata));
    metadataInflightRef.current.clear();
    setCurrentPath(path);
    setCurrentEntries(entries);
    setVisiblePaths([]);
    setMetadataByPath(cachedMetadata);
    if (searchResultsVisibleRef.current) {
      setSearchResultsVisible(false);
    }
    const pendingPasteSelection =
      pendingPasteSelectionRef.current?.directoryPath === path
        ? pendingPasteSelectionRef.current
        : null;
    if (pendingPasteSelection) {
      pendingPasteSelectionRef.current = null;
    }
    const selectedPastePaths = pendingPasteSelection
      ? entries
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
        : {
            paths: [],
            anchorPath: null,
            leadPath: null,
          },
      entries,
    );
    setGetInfoItem(null);
  }

  async function navigateTo(
    path: string,
    historyMode: "push" | "replace" | "skip",
    includeHiddenOverride = includeHidden,
    sortByOverride = sortBy,
    sortDirectionOverride = sortDirection,
    foldersFirstOverride = foldersFirst,
    options: {
      syncTree?: boolean;
      treeSelectionMode?: "filesystem" | "favorite" | "preserve";
      favoritePath?: string;
      persistOnError?: boolean;
      forceTreeReload?: boolean;
    } = {},
  ): Promise<boolean> {
    const requestId = ++directoryRequestRef.current;
    setInfoTargetPathOverride(null);
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
      applyDirectorySnapshot(response.path, response.entries, cachedMetadata);
      if (options.syncTree !== false) {
        await syncTreeToPath(response.path, includeHiddenOverride, {
          forceReload: options.forceTreeReload ?? false,
        });
      }
      if (options.treeSelectionMode === "favorite") {
        setTreeSelection(createFavoriteItemId(options.favoritePath ?? response.path));
        if (favoritesPlacement === "separate") {
          setLeftPaneSubview("favorites");
        }
      } else if (options.treeSelectionMode !== "preserve") {
        setTreeSelection(createFileSystemItemId(response.path));
        setLeftPaneSubview("tree");
      }
      applyHistoryUpdate(response.path, historyMode);
      return true;
    } catch (error) {
      if (directoryRequestRef.current !== requestId) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      setDirectoryError(message);
      setLocationError(message);
      if (options.persistOnError) {
        applyDirectorySnapshot(path, [], {});
        if (options.treeSelectionMode === "favorite") {
          setTreeSelection(createFavoriteItemId(options.favoritePath ?? path));
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
    if (currentNode?.loading) {
      return;
    }
    if (
      !forceReload &&
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
    options: { forceReload?: boolean } = {},
  ) {
    const forceReload = options.forceReload ?? false;
    const currentRootPath = treeRootPathRef.current;
    const nextRootPath =
      currentRootPath.length === 0 || !isPathWithinRoot(path, currentRootPath)
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

    if (path === nextRootPath) {
      return;
    }

    const ancestorChain = getAncestorChain(nextRootPath, path).slice(1, -1);
    for (const ancestorPath of ancestorChain) {
      ensureTreeNode(ancestorPath, true);
      await loadTreeChildren(ancestorPath, includeHiddenOverride, true, path, forceReload);
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
    if (isFavoritesRootItemId(itemId)) {
      setTreeSelection(itemId);
      setLeftPaneSubview(favoritesPlacement === "separate" ? "favorites" : "tree");
      applyEmptyDirectorySnapshot();
      return;
    }
    const favoritePath = getFavoriteItemPath(itemId);
    if (favoritePath) {
      setTreeSelection(itemId);
      if (favoritesPlacement === "separate") {
        setLeftPaneSubview("favorites");
      }
      await navigateTo(favoritePath, historyMode, undefined, undefined, undefined, undefined, {
        syncTree: false,
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
      const favoritePath = getFavoriteItemPath(currentItemId);
      if (currentItemId && favoritePath) {
        await selectTreeItem(currentItemId, "push");
      }
      return;
    }
    if (isFavoritesRootItemId(currentItemId)) {
      return;
    }
    const favoritePath = getFavoriteItemPath(currentItemId);
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
    if (isFavoriteItemId(currentItemId)) {
      await selectTreeItem(getFavoritesRootItemId(), "skip");
      return;
    }
    const path = getFileSystemItemPath(currentItemId);
    if (!path) {
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

    const { items, visibleItemIds } = getTreePresentationState();
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
      if (isFavoritesRootItemId(safeCurrentId)) {
        if (!favoritesExpanded && favorites.length > 0) {
          setFavoritesExpanded(true);
          return true;
        }
        const firstFavoriteId = favorites[0] ? createFavoriteItemId(favorites[0].path) : null;
        if (favoritesExpanded && firstFavoriteId) {
          await selectTreeItem(firstFavoriteId, "push");
          return true;
        }
        return false;
      }
      if (isFavoriteItemId(safeCurrentId)) {
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

    if (isFavoritesRootItemId(safeCurrentId)) {
      if (favoritesExpanded && favorites.length > 0) {
        setFavoritesExpanded(false);
        return true;
      }
      return false;
    }
    if (isFavoriteItemId(safeCurrentId)) {
      await selectTreeItem(getFavoritesRootItemId(), "skip");
      return true;
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
    if (path === treeRootPathRef.current) {
      return false;
    }
    const parentPath = parentDirectoryPath(path);
    if (!parentPath || parentPath === path) {
      return false;
    }
    await selectTreeItem(createFileSystemItemId(parentPath), "push");
    return true;
  }

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
    void navigateTo(
      currentPath,
      "replace",
      nextValue,
      undefined,
      undefined,
      undefined,
      reloadOptions,
    );
  }

  async function refreshVisibleTreePath(path: string, activePath = currentPathRef.current) {
    const treeRootPath = treeRootPathRef.current;
    if (path.length === 0 || !isPathWithinRoot(path, treeRootPath)) {
      return;
    }
    const node = treeNodesRef.current[path];
    if (!node) {
      return;
    }
    await loadTreeChildren(path, includeHidden, node.expanded, activePath, true);
  }

  async function refreshDirectory(
    options: {
      path?: string;
      treeSelectionPath?: string | null;
      extraTreeReloadPaths?: string[];
    } = {},
  ) {
    await client.invoke("app:clearCaches", {});
    const targetPath = options.path ?? currentPathRef.current;
    if (!targetPath) {
      return;
    }
    const reloadOptions = getSelectedTreeReloadOptions(targetPath);
    await navigateTo(targetPath, "replace", undefined, undefined, undefined, undefined, {
      ...reloadOptions,
      forceTreeReload: true,
    });
    if (options.treeSelectionPath) {
      await syncTreeToPath(options.treeSelectionPath, includeHidden, {
        forceReload: true,
      });
      setTreeSelection(createFileSystemItemId(options.treeSelectionPath));
      setLeftPaneSubview("tree");
    }
    for (const extraTreeReloadPath of [...new Set(options.extraTreeReloadPaths ?? [])]) {
      await refreshVisibleTreePath(extraTreeReloadPath, targetPath);
    }
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

  useEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes, treeNodesRef]);

  useEffect(() => {
    selectedTreeItemIdRef.current = selectedTreeItemId;
  }, [selectedTreeItemId, selectedTreeItemIdRef]);

  useLayoutEffect(() => {
    currentPathRef.current = currentPath;
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
    if (typeaheadEnabled) {
      return;
    }
    clearTypeahead();
  }, [clearTypeahead, typeaheadEnabled]);

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
    explorerFocusSuppressed,
    focusedPane,
    locationDialogOpen,
    mainView,
    preferencesReady,
    restoreExplorerPaneFocus,
    searchPointerIntentRef,
    searchShellRef,
  ]);

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
      .catch(() => undefined)
      .finally(() => {
        for (const path of missingPaths) {
          metadataInflightRef.current.delete(path);
        }
      });
  }, [
    client,
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
  ]);

  useEffect(() => {
    if ((!infoPanelOpen && !infoRowOpen) || currentPath.length === 0) {
      return;
    }
    const targetPath = infoTargetPathOverride ?? contentSelection.leadPath ?? currentPath;
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
  }, [
    client,
    contentSelection.leadPath,
    currentPath,
    getInfoRequestRef,
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
    handleTreeKeyboardAction,
    goBack,
    goForward,
    goHome,
    rerootTreeAtHome,
    goQuickAccess,
    navigateToParentFolder,
    navigateTreeSelectionToParent,
    selectTreeItem,
    clearTreeSelection,
    initializeTree,
    reinitializeTree,
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
  };
}
