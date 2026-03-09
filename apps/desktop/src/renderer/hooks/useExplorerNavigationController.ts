import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
} from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import type { TreeNodeState } from "../components/TreePane";
import type { ContentSelectionState } from "../lib/contentSelection";
import { getDetailsRowHeight } from "../lib/detailsLayout";
import { createTreeNode, isPathWithinRoot, resolveRefreshRootPath } from "../lib/explorerAppUtils";
import type {
  DirectoryEntry,
  DirectoryEntryMetadata,
  SearchResultItem,
} from "../lib/explorerTypes";
import {
  flattenVisibleTreePaths,
  getAncestorChain,
  getForcedVisibleHiddenChildPath,
  getNextSelectionIndex,
  getPageStepItemCount,
  getPagedSelectionIndex,
  getTreeSeedChain,
  pathHasHiddenSegmentWithinRoot,
  parentDirectoryPath,
} from "../lib/explorerNavigation";
import { type ExplorerPane, resolveExplorerPaneRestoreTarget } from "../lib/explorerPaneFocus";
import { useFiletrailClient } from "../lib/filetrailClient";
import { getFlowListColumnStep } from "../lib/flowListLayout";
import { EXPLORER_LAYOUT } from "../lib/layoutTokens";
import { createRendererLogger } from "../lib/logging";
import { pageScrollElement, scrollElementByAmount } from "../lib/pagedScroll";
import { SEARCH_RESULT_ROW_HEIGHT } from "../components/SearchResultsPane";
import { getTreeKeyboardAction } from "../lib/treeView";
import { findContentTypeaheadMatch, findTreeTypeaheadMatch } from "../lib/typeahead";

const logger = createRendererLogger("filetrail.renderer");

export function useExplorerNavigationController(args: {
  client: ReturnType<typeof useFiletrailClient>;
  preferencesReady: boolean;
  mainView: "explorer" | "help" | "settings";
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
  typeaheadQuery: string;
  typeaheadPane: "tree" | "content" | null;
  setTypeaheadPane: Dispatch<SetStateAction<"tree" | "content" | null>>;
  setTypeaheadQuery: Dispatch<SetStateAction<string>>;
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
  treeRootPathRef: MutableRefObject<string>;
  metadataCacheRef: MutableRefObject<Map<string, DirectoryEntryMetadata>>;
  metadataInflightRef: MutableRefObject<Set<string>>;
  currentPathRef: MutableRefObject<string>;
  selectedPathsInViewOrderRef: MutableRefObject<string[]>;
  selectedEntryRef: MutableRefObject<DirectoryEntry | null>;
  lastExplorerFocusPaneRef: MutableRefObject<"tree" | "content" | null>;
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
    applyContentSelection,
    setSingleContentSelection,
    directoryRequestRef,
    getInfoRequestRef,
    treeRequestRef,
    treeNodesRef,
    treeRootPathRef,
    metadataCacheRef,
    metadataInflightRef,
    currentPathRef,
    selectedPathsInViewOrderRef,
    selectedEntryRef,
    lastExplorerFocusPaneRef,
    pendingPasteSelectionRef,
  } = args;

  const hasCachedSearch = searchCommittedQuery.trim().length > 0;
  const isSearchMode = searchResultsVisible && hasCachedSearch;

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
            ? {
                paths: [response.entries[0].path],
                anchorPath: response.entries[0].path,
                leadPath: response.entries[0].path,
              }
            : {
                paths: [],
                anchorPath: null,
                leadPath: null,
              },
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

  useEffect(() => {
    treeNodesRef.current = treeNodes;
  }, [treeNodes, treeNodesRef]);

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
    clearTypeahead,
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
  }, [
    client,
    contentSelection.leadPath,
    currentPath,
    getInfoRequestRef,
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
    goBack,
    goForward,
    goHome,
    rerootTreeAtHome,
    goQuickAccess,
    navigateToParentFolder,
    initializeTree,
    reinitializeTree,
    navigateTo,
    loadTreeChildren,
    toggleTreeNode,
    openTreeNode,
    toggleHiddenFiles,
    refreshDirectory,
    handleSortChange,
    toggleFoldersFirst,
    submitLocationPath,
    handlePaneResizeKey,
    getTreeKeyboardAction,
  };
}
