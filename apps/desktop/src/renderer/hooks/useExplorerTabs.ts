import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { OPEN_TABS_LIMIT, type OpenTabPreference } from "../../shared/appPreferences";
import { EMPTY_CONTENT_SELECTION } from "../lib/contentSelection";
import { collectFollowedMoves, createTreeNode, isRenameOrMove } from "../lib/explorerAppUtils";
import {
  CLOSED_TABS_LIMIT,
  type ExplorerTab,
  type ExplorerTabsState,
  type TabDescription,
  type TabSearchSession,
  type TabSnapshot,
  applyBackgroundSearchUpdate,
  describeTab,
  describeTabSnapshot,
  disambiguateTabLabels,
  followMovedItems,
  leaveUnmountedDisks,
  moveTabInList,
  resolveAdjacentTab,
  resolveTabAfterClose,
  settleTreeNodes,
  toReopenableSnapshot,
} from "../lib/explorerTabs";
import {
  createFavoriteItemId,
  createFileSystemItemId,
  getFavoriteItemPath,
} from "../lib/favorites";
import { CONTENT_SCROLL_SELECTOR, TREE_SCROLL_SELECTOR } from "../lib/folderViewMemory";
import type { StartupTab } from "../lib/startupNavigation";
import type {
  ExplorerServices,
  NavigationStore,
  PreferencesStore,
  SearchStore,
  SelectionActions,
  WriteOperationsStore,
} from "../state/explorerStores";

// How often a search running in a background tab is asked how it is doing. Nothing is asked
// while no background tab has a search running.
const BACKGROUND_SEARCH_POLL_MS = 1000;
const SIDEBAR_SECTIONS_SCROLL_SELECTOR = ".sidebar-sections";

// What is still owed to a tab after its state has been put on screen. It is done once the
// window has rendered that state, so it works with the tab's own values.
type PendingActivation = {
  // Which showing of a tab this is: a later one takes over what is still owed.
  id: number;
  // "reload": the folder is on screen from when the tab was left and is read again in case
  // it changed. "load": nothing is on screen yet. "open": a folder is opened for the first
  // time, which counts as a visit. "none": the tab shows what was already on screen.
  mode: "reload" | "load" | "open" | "none";
  path: string;
  favoritePath: string | null;
  contentScroll: { top: number; left: number };
  treeScrollTop: number | null;
  sidebarSectionsScrollTop: number | null;
  focusedPane: "tree" | "content";
  treeRootPath: string;
  refreshExpandedTree: boolean;
  rerunSearch: boolean;
};

export type ExplorerTabItem = TabDescription & {
  id: string;
  active: boolean;
  /** The folder the tab is on: where files dropped on the tab go. */
  path: string;
};

let nextTabNumber = 1;

function createTabId(): string {
  const id = `tab-${nextTabNumber}`;
  nextTabNumber += 1;
  return id;
}

// The tabs of the window. Only the tab on screen is live: the navigation and search stores
// hold its state. Every other tab is a snapshot of the state it was left in, put back into
// the stores when the tab is shown again.
export function useExplorerTabs(args: {
  services: ExplorerServices;
  navigation: NavigationStore;
  preferences: PreferencesStore;
  search: SearchStore;
  writeOperations: WriteOperationsStore;
  selection: SelectionActions;
  searchSession: {
    detach: () => TabSearchSession;
    // `includeHidden` is the setting of the tab the session belongs to, which it is shown with.
    attach: (session: TabSearchSession, includeHidden: boolean) => boolean;
    createEmpty: () => TabSearchSession;
    rerun: () => void;
  };
  navActions: {
    navigateToNearestExistingFolder: (
      path: string,
      historyMode: "push" | "replace" | "skip",
      options?: {
        syncTree?: boolean;
        treeSelectionMode?: "filesystem" | "favorite" | "preserve";
        favoritePath?: string;
      },
    ) => Promise<boolean>;
    reloadFolderInPlace: (options?: { refreshExpandedTree?: boolean }) => Promise<void>;
    focusTreePane: () => void;
    loadTreeChildren: (path: string) => Promise<void>;
    restoreListFilter: (
      query: string,
      list: { currentPath: string; isSearchMode: boolean; searchCommittedQuery: string },
    ) => void;
  };
  derived: {
    isSearchMode: boolean;
    // A dialog owns the window: the tab on screen stays where it is.
    blocked: boolean;
  };
}) {
  const {
    services,
    navigation,
    preferences,
    search,
    writeOperations,
    selection,
    searchSession,
    navActions,
    derived,
  } = args;
  const { client, treePaneRef, contentPaneRef } = services;

  const [state, setState] = useState<ExplorerTabsState>(() => {
    const id = createTabId();
    return { tabs: [{ id, snapshot: null, stale: false }], activeTabId: id };
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  // Read where a file operation starts and ends, which can be between two renders.
  navigation.activeTabIdRef.current = state.activeTabId;

  const pendingActivationRef = useRef<PendingActivation | null>(null);
  const [activationCount, setActivationCount] = useState(0);
  const lastActivationIdRef = useRef(0);
  // A tab that comes back puts its sidebar back where it was scrolled. Until its folder and
  // tree have been read again, the sidebar does not scroll to the selected folder on its own.
  const [sidebarScrollHeld, setSidebarScrollHeld] = useState(false);
  // The tabs that were closed, most recent last, for Reopen Closed Tab. They are not kept
  // between launches.
  const closedTabsRef = useRef<TabSnapshot[]>([]);

  function rememberClosedTab(snapshot: TabSnapshot | null) {
    if (!snapshot || snapshot.currentPath.length === 0) {
      return;
    }
    closedTabsRef.current = [
      ...closedTabsRef.current.slice(-(CLOSED_TABS_LIMIT - 1)),
      toReopenableSnapshot(snapshot),
    ];
  }

  function commitState(next: ExplorerTabsState) {
    stateRef.current = next;
    navigation.activeTabIdRef.current = next.activeTabId;
    setState(next);
  }

  // The background tabs whose search is being asked for an update right now.
  const backgroundPollsRef = useRef(new Set<string>());

  // The state a tab is shown from. If its search was just asked for an update, that answer
  // will be thrown away, which the search has to know about (see `pollInFlight`).
  function getSnapshotToShow(tab: ExplorerTab): TabSnapshot | null {
    const snapshot = tab.snapshot;
    if (!snapshot?.search || !backgroundPollsRef.current.has(tab.id)) {
      return snapshot;
    }
    return { ...snapshot, search: { ...snapshot.search, pollInFlight: true } };
  }

  // Asks the worker about each search that is running in a background tab, so the tab can
  // show when it has finished and has its results at hand when it is shown.
  function pollBackgroundSearches() {
    for (const tab of stateRef.current.tabs) {
      const session = tab.snapshot?.search;
      if (!session || session.jobId === null || backgroundPollsRef.current.has(tab.id)) {
        continue;
      }
      const { jobId, cursor } = session;
      const tabId = tab.id;
      backgroundPollsRef.current.add(tabId);
      const applyUpdate = (update: (current: TabSearchSession) => TabSearchSession) => {
        backgroundPollsRef.current.delete(tabId);
        const current = stateRef.current;
        const target = current.tabs.find((candidate) => candidate.id === tabId);
        const targetSession = target?.snapshot?.search;
        // The tab was shown or closed meanwhile; if shown, its own polling took over.
        if (
          !target?.snapshot ||
          !targetSession ||
          targetSession.jobId !== jobId ||
          targetSession.cursor !== cursor
        ) {
          return;
        }
        const snapshot = { ...target.snapshot, search: update(targetSession) };
        commitState({
          ...current,
          tabs: current.tabs.map((candidate) =>
            candidate.id === tabId ? { ...candidate, snapshot } : candidate,
          ),
        });
      };
      void client
        .invoke("search:getUpdate", { jobId, cursor })
        .then((response) => {
          applyUpdate((current) => applyBackgroundSearchUpdate(current, response));
        })
        .catch((error) => {
          applyUpdate((current) => ({
            ...current,
            jobId: null,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    }
  }

  // Takes the tab on screen out of the window and hands back the state it is left in.
  function captureLiveTab(): TabSnapshot {
    const contentScroller =
      contentPaneRef.current?.querySelector<HTMLElement>(CONTENT_SCROLL_SELECTOR) ?? null;
    const treeScroller =
      treePaneRef.current?.querySelector<HTMLElement>(TREE_SCROLL_SELECTOR) ?? null;
    const sidebarSectionsScroller =
      treePaneRef.current?.querySelector<HTMLElement>(SIDEBAR_SECTIONS_SCROLL_SELECTOR) ?? null;
    return {
      currentPath: navigation.currentPath,
      historyPaths: navigation.historyPaths,
      historyIndex: navigation.historyIndex,
      viewMode: preferences.viewMode,
      searchViewMode: preferences.searchViewMode,
      sortBy: navigation.sortBy,
      sortDirection: navigation.sortDirection,
      treeRootPath: navigation.treeRootPathRef.current,
      selectedTreeItemId: navigation.selectedTreeItemIdRef.current,
      leftPaneSubview: navigation.leftPaneSubview,
      focusedPane:
        navigation.focusedPane ?? navigation.lastExplorerFocusPaneRef.current ?? "content",
      includeHidden: preferences.includeHidden,
      foldersFirst: preferences.foldersFirst,
      favoritesExpanded: preferences.favoritesExpanded,
      locationsExpanded: preferences.locationsExpanded,
      view: {
        treeNodes: navigation.treeNodesRef.current,
        currentEntries: navigation.currentEntries,
        metadataByPath: navigation.metadataByPath,
        directoryError: navigation.directoryError,
        contentSelection: navigation.contentSelection,
        listFilterQuery: navigation.listFilterQuery,
        contentScroll: {
          top: contentScroller?.scrollTop ?? 0,
          left: contentScroller?.scrollLeft ?? 0,
        },
        treeScrollTop: treeScroller?.scrollTop ?? 0,
        sidebarSectionsScrollTop: sidebarSectionsScroller?.scrollTop ?? 0,
        folderViewMemories: navigation.folderViewMemoriesRef.current,
      },
      search: searchSession.detach(),
    };
  }

  // Answers still on their way were asked for by the tab that is leaving the screen.
  function forgetRequestsUnderWay() {
    navigation.viewEpochRef.current += 1;
    navigation.directoryRequestRef.current += 1;
    navigation.getInfoRequestRef.current += 1;
    navigation.treeRequestRef.current = {};
    navigation.metadataInflightRef.current.clear();
  }

  // Puts a tab's state on screen. What cannot be done until the window has rendered it
  // (scrolling, reading the folder again) is left in `pendingActivationRef`.
  function showSnapshot(
    snapshot: TabSnapshot,
    mode: PendingActivation["mode"],
    options: { refreshExpandedTree?: boolean } = {},
  ) {
    forgetRequestsUnderWay();
    selection.clearTypeahead();
    writeOperations.setContextMenuState(null);
    writeOperations.setRenameDialogState((current) => (current?.inline ? null : current));

    const view = snapshot.view;
    const treeNodes = view
      ? settleTreeNodes(view.treeNodes)
      : snapshot.treeRootPath.length > 0
        ? { [snapshot.treeRootPath]: createTreeNode(snapshot.treeRootPath, true) }
        : {};
    const metadataByPath = view?.metadataByPath ?? {};

    preferences.setViewMode(snapshot.viewMode);
    preferences.setSearchViewMode(snapshot.searchViewMode);
    preferences.setIncludeHidden(snapshot.includeHidden);
    preferences.setFoldersFirst(snapshot.foldersFirst);
    preferences.setFavoritesExpanded(snapshot.favoritesExpanded);
    preferences.setLocationsExpanded(snapshot.locationsExpanded);
    navigation.setSortBy(snapshot.sortBy);
    navigation.setSortDirection(snapshot.sortDirection);
    navigation.setHistoryPaths(snapshot.historyPaths);
    navigation.setHistoryIndex(snapshot.historyIndex);
    navigation.folderViewMemoriesRef.current = view?.folderViewMemories ?? {};
    navigation.leftPaneSubviewRef.current = snapshot.leftPaneSubview;
    navigation.setLeftPaneSubview(snapshot.leftPaneSubview);
    navigation.treeRootPathRef.current = snapshot.treeRootPath;
    navigation.setTreeRootPath(snapshot.treeRootPath);
    navigation.treeNodesRef.current = treeNodes;
    navigation.setTreeNodes(treeNodes);
    navigation.selectedTreeItemIdRef.current = snapshot.selectedTreeItemId;
    navigation.setSelectedTreeItemId(snapshot.selectedTreeItemId);
    navigation.currentPathRef.current = snapshot.currentPath;
    navigation.setCurrentPath(snapshot.currentPath);
    navigation.setCurrentEntries(view?.currentEntries ?? []);
    navigation.metadataCacheRef.current = new Map(Object.entries(metadataByPath));
    navigation.setMetadataByPath(metadataByPath);
    navigation.setVisiblePaths([]);
    navigation.setDirectoryError(view?.directoryError ?? null);
    navigation.setDirectoryLoading(
      (mode === "load" || mode === "open") && snapshot.currentPath.length > 0,
    );
    navigation.setInfoTargetPathOverride(null);
    navigation.setGetInfoItem(null);
    navigation.setGetInfoLoading(false);

    const tabSearch = snapshot.search ?? searchSession.createEmpty();
    const rerunSearch = searchSession.attach(tabSearch, snapshot.includeHidden);
    const isSearchMode = tabSearch.resultsVisible && tabSearch.committedQuery.trim().length > 0;
    // In search mode the selection is among the results, which the list sorts out itself
    // once it has them; in a folder the entries are at hand.
    selection.applyContentSelection(
      view?.contentSelection ?? EMPTY_CONTENT_SELECTION,
      isSearchMode ? [] : (view?.currentEntries ?? []),
    );
    navActions.restoreListFilter(view?.listFilterQuery ?? "", {
      currentPath: snapshot.currentPath,
      isSearchMode,
      searchCommittedQuery: tabSearch.committedQuery,
    });

    lastActivationIdRef.current += 1;
    pendingActivationRef.current = {
      id: lastActivationIdRef.current,
      mode,
      path: snapshot.currentPath,
      favoritePath: getFavoriteItemPath(snapshot.selectedTreeItemId),
      contentScroll: view?.contentScroll ?? { top: 0, left: 0 },
      treeScrollTop: view?.treeScrollTop ?? null,
      sidebarSectionsScrollTop: view?.sidebarSectionsScrollTop ?? null,
      focusedPane: snapshot.focusedPane,
      treeRootPath: snapshot.treeRootPath,
      refreshExpandedTree: options.refreshExpandedTree ?? false,
      rerunSearch,
    };
    // A tab with nothing on screen yet has no place to go back to: its sidebar scrolls to
    // its folder as it is read.
    setSidebarScrollHeld(view !== null);
    setActivationCount((count) => count + 1);
  }

  // Not while a dialog owns the window, and not before the window has read its first
  // folder: until then the startup is still filling in the tab on screen.
  function canChangeTabs(): boolean {
    return preferences.preferencesReady && !derived.blocked && navigation.mainView === "explorer";
  }

  function activateTab(tabId: string) {
    const current = stateRef.current;
    const target = current.tabs.find((tab) => tab.id === tabId);
    if (!target?.snapshot || tabId === current.activeTabId || !canChangeTabs()) {
      return;
    }
    const leftSnapshot = captureLiveTab();
    commitState({
      activeTabId: tabId,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeTabId
          ? { ...tab, snapshot: leftSnapshot }
          : tab.id === tabId
            ? { ...tab, snapshot: null, stale: false }
            : tab,
      ),
    });
    const snapshot = getSnapshotToShow(target) ?? target.snapshot;
    showSnapshot(snapshot, snapshot.view ? "reload" : "load", {
      refreshExpandedTree: target.stale,
    });
  }

  function activateAdjacentTab(direction: "next" | "previous") {
    const current = stateRef.current;
    const tabId = resolveAdjacentTab(current.tabs, current.activeTabId, direction);
    if (tabId) {
      activateTab(tabId);
    }
  }

  // Leaves the tab on screen and shows `snapshot` in a new tab, placed right after the tab
  // on screen (or after `afterTabId`).
  function openTabWithSnapshot(
    leftSnapshot: TabSnapshot,
    snapshot: TabSnapshot,
    mode: PendingActivation["mode"],
    afterTabId: string = stateRef.current.activeTabId,
  ) {
    const current = stateRef.current;
    const id = createTabId();
    const tabs: ExplorerTab[] = [];
    for (const tab of current.tabs) {
      tabs.push(tab.id === current.activeTabId ? { ...tab, snapshot: leftSnapshot } : tab);
      if (tab.id === afterTabId) {
        tabs.push({ id, snapshot: null, stale: false });
      }
    }
    commitState({ activeTabId: id, tabs });
    showSnapshot(snapshot, mode);
  }

  // ⌘T: a new tab on the folder that is on screen, with a history of its own.
  function openNewTab() {
    if (!canChangeTabs()) {
      return;
    }
    const leftSnapshot = captureLiveTab();
    const path = leftSnapshot.currentPath;
    openTabWithSnapshot(
      leftSnapshot,
      {
        ...leftSnapshot,
        historyPaths: path.length > 0 ? [path] : [],
        historyIndex: path.length > 0 ? 0 : -1,
        view: leftSnapshot.view
          ? {
              ...leftSnapshot.view,
              contentSelection: EMPTY_CONTENT_SELECTION,
              listFilterQuery: "",
              contentScroll: { top: 0, left: 0 },
              folderViewMemories: {},
            }
          : null,
        search: null,
      },
      "none",
    );
  }

  // Opens `path` in a new tab and shows it.
  function openPathInNewTab(path: string) {
    if (!canChangeTabs() || path.length === 0) {
      return;
    }
    const leftSnapshot = captureLiveTab();
    openTabWithSnapshot(
      leftSnapshot,
      {
        ...leftSnapshot,
        currentPath: path,
        historyPaths: [],
        historyIndex: -1,
        selectedTreeItemId: createFileSystemItemId(path),
        leftPaneSubview: "tree",
        view: null,
        search: null,
      },
      "open",
    );
  }

  function cancelSearchJob(jobId: string | null) {
    if (jobId !== null) {
      void client.invoke("search:cancel", { jobId }).catch(() => undefined);
    }
  }

  // ⌘W: closes a tab. The last view left closes the window with it. A tab moved to another
  // window isn't offered by Reopen Closed Tab (`remember: false`).
  function closeTab(
    tabId: string = stateRef.current.activeTabId,
    options: { remember?: boolean } = {},
  ) {
    const remember = options.remember !== false;
    if (derived.blocked) {
      return;
    }
    const current = stateRef.current;
    const closing = current.tabs.find((tab) => tab.id === tabId);
    if (!closing) {
      return;
    }
    if (current.tabs.length === 1) {
      window.close();
      return;
    }
    if (!preferences.preferencesReady) {
      return;
    }
    if (tabId !== current.activeTabId) {
      cancelSearchJob(closing.snapshot?.search?.jobId ?? null);
      if (remember) {
        rememberClosedTab(closing.snapshot);
      }
      commitState({ ...current, tabs: current.tabs.filter((tab) => tab.id !== tabId) });
      return;
    }
    const nextTabId = resolveTabAfterClose(current.tabs, tabId);
    const nextTab = current.tabs.find((tab) => tab.id === nextTabId);
    if (!nextTab?.snapshot) {
      return;
    }
    const closedSnapshot = captureLiveTab();
    cancelSearchJob(closedSnapshot.search?.jobId ?? null);
    if (remember) {
      rememberClosedTab(closedSnapshot);
    }
    commitState({
      activeTabId: nextTab.id,
      tabs: current.tabs
        .filter((tab) => tab.id !== tabId)
        .map((tab) => (tab.id === nextTab.id ? { ...tab, snapshot: null, stale: false } : tab)),
    });
    const nextSnapshot = getSnapshotToShow(nextTab) ?? nextTab.snapshot;
    showSnapshot(nextSnapshot, nextSnapshot.view ? "reload" : "load", {
      refreshExpandedTree: nextTab.stale,
    });
  }

  // Closes every tab but `tabId`, which is shown if it was not on screen.
  function closeOtherTabs(tabId: string) {
    const current = stateRef.current;
    const kept = current.tabs.find((tab) => tab.id === tabId);
    if (!kept || current.tabs.length < 2 || !canChangeTabs()) {
      return;
    }
    for (const tab of current.tabs) {
      if (tab.id === tabId || tab.id === current.activeTabId) {
        continue;
      }
      cancelSearchJob(tab.snapshot?.search?.jobId ?? null);
      rememberClosedTab(tab.snapshot);
    }
    if (tabId === current.activeTabId) {
      commitState({ activeTabId: tabId, tabs: [kept] });
      return;
    }
    if (!kept.snapshot) {
      return;
    }
    const closedSnapshot = captureLiveTab();
    cancelSearchJob(closedSnapshot.search?.jobId ?? null);
    rememberClosedTab(closedSnapshot);
    commitState({ activeTabId: tabId, tabs: [{ ...kept, snapshot: null, stale: false }] });
    const keptSnapshot = getSnapshotToShow(kept) ?? kept.snapshot;
    showSnapshot(keptSnapshot, keptSnapshot.view ? "reload" : "load", {
      refreshExpandedTree: kept.stale,
    });
  }

  // A second tab like `tabId`, next to it and in front: the same folder, tree, history and
  // view. Its search is not copied; the new tab shows the folder.
  function duplicateTab(tabId: string) {
    const current = stateRef.current;
    const source = current.tabs.find((tab) => tab.id === tabId);
    if (!source || !canChangeTabs()) {
      return;
    }
    const leftSnapshot = captureLiveTab();
    if (tabId === current.activeTabId || !source.snapshot) {
      openTabWithSnapshot(leftSnapshot, { ...leftSnapshot, search: null }, "none");
      return;
    }
    openTabWithSnapshot(
      leftSnapshot,
      { ...source.snapshot, search: null },
      source.snapshot.view ? "reload" : "load",
      tabId,
    );
  }

  // ⇧⌘T: brings back the tab that was closed last, at its folder.
  function reopenClosedTab() {
    const snapshot = closedTabsRef.current.at(-1);
    if (!snapshot || !canChangeTabs()) {
      return;
    }
    closedTabsRef.current = closedTabsRef.current.slice(0, -1);
    openTabWithSnapshot(captureLiveTab(), snapshot, "load");
  }

  // ⌘N: a new window on the folder on screen, shown the way this tab shows it.
  function openNewWindow() {
    if (!preferences.preferencesReady || navigation.currentPath.length === 0) {
      return;
    }
    openWindowWithTab(liveTabPreference);
  }

  // Open in New Window: `path` in a window of its own, with this tab's view and tree root.
  function openPathInNewWindow(path: string) {
    if (!preferences.preferencesReady || path.length === 0) {
      return;
    }
    openWindowWithTab({ ...liveTabPreference, path, favoritePath: null });
  }

  // Move Tab to New Window: a tab (the one on screen, from the Window menu) leaves for a
  // window of its own. Its folder, tree and view go along; its history and search don't.
  function moveTabToNewWindow(tabId: string = stateRef.current.activeTabId) {
    const current = stateRef.current;
    const moving = current.tabs.find((tab) => tab.id === tabId);
    if (!moving || !canChangeTabs() || current.tabs.length < 2) {
      return;
    }
    const tab =
      tabId === current.activeTabId || !moving.snapshot
        ? liveTabPreference
        : toOpenTabPreference(moving.snapshot);
    openWindowWithTab(tab, () => closeTab(tabId, { remember: false }));
  }

  function openWindowWithTab(tab: OpenTabPreference, onOpened?: () => void) {
    void client
      .invoke("app:openWindow", { tabs: [tab], activeTabIndex: 0 })
      .then((response) => {
        if (response.ok) {
          onOpened?.();
        }
      })
      .catch(() => undefined);
  }

  // Merge All Windows: the other windows' tabs join this window's, after them, waiting
  // unread until they are shown. No more are kept than a window may hold.
  function addTabs(
    startupTabs: readonly StartupTab[],
    favoritesPlacement: "integrated" | "separate",
  ) {
    const current = stateRef.current;
    const room = Math.max(0, OPEN_TABS_LIMIT - current.tabs.length);
    const added = startupTabs
      .slice(0, room)
      .map((startupTab) => createWaitingTab(startupTab, favoritesPlacement));
    if (added.length === 0) {
      return;
    }
    commitState({ ...current, tabs: [...current.tabs, ...added] });
    dropWaitingTabsWhoseFolderIsGone(added);
  }

  // Dragging a tab along the row.
  function moveTab(tabId: string, toIndex: number) {
    const current = stateRef.current;
    if (current.tabs.findIndex((tab) => tab.id === tabId) === toIndex) {
      return;
    }
    commitState({ ...current, tabs: moveTabInList(current.tabs, tabId, toIndex) });
  }

  // Sets up the tabs the window opens with. The tab on screen is loaded by the caller, the
  // way a single view always was; the others wait, unread, until they are shown. A waiting
  // tab whose folder turns out to be gone is dropped.
  function restoreTabs(
    startupTabs: readonly StartupTab[],
    activeIndex: number,
    favoritesPlacement: "integrated" | "separate",
  ) {
    const tabs = startupTabs.map((startupTab, index): ExplorerTab => {
      if (index === activeIndex) {
        return { id: createTabId(), snapshot: null, stale: false };
      }
      return createWaitingTab(startupTab, favoritesPlacement);
    });
    const activeTab = tabs[activeIndex];
    if (!activeTab) {
      return;
    }
    commitState({ tabs, activeTabId: activeTab.id });
    dropWaitingTabsWhoseFolderIsGone(tabs);
  }

  // A tab that waits, unread, until it is shown.
  function createWaitingTab(
    startupTab: StartupTab,
    favoritesPlacement: "integrated" | "separate",
  ): ExplorerTab {
    return {
      id: createTabId(),
      stale: false,
      snapshot: {
        currentPath: startupTab.path,
        historyPaths: [startupTab.path],
        historyIndex: 0,
        viewMode: startupTab.viewMode,
        searchViewMode: startupTab.searchViewMode,
        sortBy: startupTab.sortBy,
        sortDirection: startupTab.sortDirection,
        treeRootPath: startupTab.rootPath,
        selectedTreeItemId: startupTab.favoritePath
          ? createFavoriteItemId(startupTab.favoritePath)
          : createFileSystemItemId(startupTab.path),
        leftPaneSubview:
          startupTab.favoritePath && favoritesPlacement === "separate" ? "favorites" : "tree",
        focusedPane: "content",
        includeHidden: startupTab.includeHidden,
        foldersFirst: startupTab.foldersFirst,
        favoritesExpanded: startupTab.favoritesExpanded,
        locationsExpanded: startupTab.locationsExpanded,
        view: null,
        search: null,
      },
    };
  }

  // A waiting tab whose folder turns out to be gone is dropped.
  function dropWaitingTabsWhoseFolderIsGone(tabs: readonly ExplorerTab[]) {
    for (const tab of tabs) {
      const path = tab.snapshot?.currentPath;
      if (!path) {
        continue;
      }
      void client
        .invoke("item:getProperties", { path })
        .then((response) => {
          if (response.item !== null) {
            return;
          }
          const current = stateRef.current;
          // Not if it has been put on screen meanwhile: it then finds the nearest folder
          // that still exists by itself.
          if (
            current.activeTabId === tab.id ||
            !current.tabs.some((other) => other.id === tab.id)
          ) {
            return;
          }
          commitState({ ...current, tabs: current.tabs.filter((other) => other.id !== tab.id) });
        })
        .catch(() => undefined);
    }
  }

  // The list and the tree are scrolled back before the window paints the tab.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per tab shown.
  useLayoutEffect(() => {
    const pending = pendingActivationRef.current;
    if (!pending) {
      return;
    }
    const contentScroller =
      contentPaneRef.current?.querySelector<HTMLElement>(CONTENT_SCROLL_SELECTOR) ?? null;
    if (contentScroller) {
      contentScroller.scrollTop = pending.contentScroll.top;
      contentScroller.scrollLeft = pending.contentScroll.left;
    }
    const treeScroller =
      treePaneRef.current?.querySelector<HTMLElement>(TREE_SCROLL_SELECTOR) ?? null;
    if (treeScroller && pending.treeScrollTop !== null) {
      treeScroller.scrollTop = pending.treeScrollTop;
    }
    const sidebarSectionsScroller =
      treePaneRef.current?.querySelector<HTMLElement>(SIDEBAR_SECTIONS_SCROLL_SELECTOR) ?? null;
    if (sidebarSectionsScroller && pending.sidebarSectionsScrollTop !== null) {
      sidebarSectionsScroller.scrollTop = pending.sidebarSectionsScrollTop;
    }
  }, [activationCount]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per tab shown, with the actions of the render that shows it.
  useEffect(() => {
    const pending = pendingActivationRef.current;
    if (!pending) {
      return;
    }
    pendingActivationRef.current = null;
    // Let go of the sidebar once this showing is done, unless another tab has been shown
    // since. Not before the window has drawn the tab: the tree's rows are still settling.
    const releaseSidebarScroll = () => {
      if (lastActivationIdRef.current === pending.id) {
        setSidebarScrollHeld(false);
      }
    };
    if (navigation.mainView === "explorer") {
      // The keyboard goes back to the pane the tab had it in, the tree or the list.
      if (pending.focusedPane === "tree") {
        navActions.focusTreePane();
      } else {
        selection.focusContentPane();
      }
    }
    if (pending.rerunSearch) {
      searchSession.rerun();
    }
    if (pending.path.length === 0 || pending.mode === "none") {
      window.requestAnimationFrame(releaseSidebarScroll);
      return;
    }
    if (pending.mode === "reload") {
      void navActions
        .reloadFolderInPlace({ refreshExpandedTree: pending.refreshExpandedTree })
        .finally(releaseSidebarScroll);
      return;
    }
    const favoritePath = pending.favoritePath === pending.path ? pending.favoritePath : null;
    if (favoritePath) {
      // A favorite is not looked up in the tree, so the tree is filled in separately.
      void navActions.loadTreeChildren(navigation.treeRootPathRef.current);
    }
    void navActions.navigateToNearestExistingFolder(
      pending.path,
      pending.mode === "open" ? "push" : "skip",
      favoritePath ? { syncTree: false, treeSelectionMode: "favorite", favoritePath } : {},
    );
  }, [activationCount]);

  // A search left running in a background tab is asked how it is doing once in a while.
  const hasBackgroundSearch = state.tabs.some(
    (tab) => (tab.snapshot?.search?.jobId ?? null) !== null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the timer runs while any background tab has a search running; what it asks about is read when it fires.
  useEffect(() => {
    if (!hasBackgroundSearch) {
      return;
    }
    const timer = window.setInterval(() => pollBackgroundSearches(), BACKGROUND_SEARCH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [hasBackgroundSearch]);

  // A folder renamed or moved by this window takes the background tabs showing it (or a
  // folder inside it) along to its new place.
  useEffect(
    () =>
      client.onWriteOperationProgress((event) => {
        if (
          event.status === "queued" ||
          event.status === "running" ||
          event.status === "awaiting_resolution" ||
          !isRenameOrMove(event.action) ||
          !event.result
        ) {
          return;
        }
        const moves = collectFollowedMoves(event.result);
        if (moves.length === 0) {
          return;
        }
        const current = stateRef.current;
        let changed = false;
        const tabs = current.tabs.map((tab) => {
          if (tab.id === current.activeTabId || !tab.snapshot) {
            return tab;
          }
          const snapshot = followMovedItems(tab.snapshot, moves);
          if (snapshot === tab.snapshot) {
            return tab;
          }
          changed = true;
          return { ...tab, snapshot };
        });
        if (changed) {
          const next = { ...current, tabs };
          stateRef.current = next;
          setState(next);
        }
      }),
    [client],
  );

  // Background tabs on disks just unmounted go Home (see leaveUnmountedDisks).
  function leaveUnmountedDisksInBackgroundTabs(unmountedDiskPaths: ReadonlySet<string>) {
    const current = stateRef.current;
    let changed = false;
    const tabs = current.tabs.map((tab) => {
      if (tab.id === current.activeTabId || !tab.snapshot) {
        return tab;
      }
      const snapshot = leaveUnmountedDisks(tab.snapshot, unmountedDiskPaths, navigation.homePath);
      if (snapshot === tab.snapshot) {
        return tab;
      }
      changed = true;
      return { ...tab, snapshot };
    });
    if (changed) {
      const next = { ...current, tabs };
      stateRef.current = next;
      setState(next);
    }
  }

  // A file operation that ends may have changed folders that background tabs show. Their
  // folder is read again when they are shown anyway; this makes that read cover the tree.
  const operationRunning = writeOperations.writeOperationCardState !== null;
  const operationWasRunningRef = useRef(operationRunning);
  useEffect(() => {
    if (operationWasRunningRef.current && !operationRunning) {
      const current = stateRef.current;
      if (current.tabs.length > 1) {
        const next = {
          ...current,
          tabs: current.tabs.map((tab) =>
            tab.id === current.activeTabId ? tab : { ...tab, stale: true },
          ),
        };
        stateRef.current = next;
        setState(next);
      }
    }
    operationWasRunningRef.current = operationRunning;
  }, [operationRunning]);

  const liveDescription = useMemo(
    () =>
      describeTab({
        currentPath: navigation.currentPath,
        searchVisible: derived.isSearchMode,
        searchQuery: search.searchCommittedQuery,
        searchRootPath: search.searchRootPath,
        searchRunning: search.searchStatus === "running",
      }),
    [
      derived.isSearchMode,
      navigation.currentPath,
      search.searchCommittedQuery,
      search.searchRootPath,
      search.searchStatus,
    ],
  );
  const tabItems = useMemo<ExplorerTabItem[]>(
    () =>
      disambiguateTabLabels(
        state.tabs.map((tab) => ({
          id: tab.id,
          active: tab.id === state.activeTabId,
          path:
            tab.id === state.activeTabId || !tab.snapshot
              ? navigation.currentPath
              : tab.snapshot.currentPath,
          ...(tab.id === state.activeTabId || !tab.snapshot
            ? liveDescription
            : describeTabSnapshot(tab.snapshot)),
        })),
      ),
    [liveDescription, navigation.currentPath, state],
  );

  // What is remembered of the tabs between launches. The list keeps its identity while
  // nothing in it changes, so it is only sent to be saved when it has.
  const liveTabPreference: OpenTabPreference = {
    path: navigation.currentPath || null,
    treeRootPath: navigation.treeRootPath || null,
    favoritePath:
      navigation.currentPath.length > 0 &&
      getFavoriteItemPath(navigation.selectedTreeItemId) === navigation.currentPath
        ? navigation.currentPath
        : null,
    viewMode: preferences.viewMode,
    searchViewMode: preferences.searchViewMode,
    sortBy: navigation.sortBy,
    sortDirection: navigation.sortDirection,
    includeHidden: preferences.includeHidden,
    foldersFirst: preferences.foldersFirst,
    favoritesExpanded: preferences.favoritesExpanded,
    locationsExpanded: preferences.locationsExpanded,
  };
  // No more tabs are remembered than a saved list may hold; a longer list would be refused
  // as a whole, along with everything saved in the same write.
  const nextOpenTabs = state.tabs
    .slice(0, OPEN_TABS_LIMIT)
    .map((tab) =>
      tab.id === state.activeTabId || !tab.snapshot
        ? liveTabPreference
        : toOpenTabPreference(tab.snapshot),
    );
  const openTabsRef = useRef(nextOpenTabs);
  if (JSON.stringify(openTabsRef.current) !== JSON.stringify(nextOpenTabs)) {
    openTabsRef.current = nextOpenTabs;
  }

  return {
    openTabs: openTabsRef.current,
    activeTabIndex: Math.min(
      OPEN_TABS_LIMIT - 1,
      Math.max(
        0,
        state.tabs.findIndex((tab) => tab.id === state.activeTabId),
      ),
    ),
    restoreTabs,
    addTabs,
    openNewWindow,
    openPathInNewWindow,
    moveTabToNewWindow,
    sidebarScrollHeld,
    tabItems,
    activeTabId: state.activeTabId,
    tabCount: state.tabs.length,
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
  };
}

function toOpenTabPreference(snapshot: TabSnapshot): OpenTabPreference {
  const favoritePath = getFavoriteItemPath(snapshot.selectedTreeItemId);
  return {
    path: snapshot.currentPath || null,
    treeRootPath: snapshot.treeRootPath || null,
    favoritePath:
      snapshot.currentPath.length > 0 && favoritePath === snapshot.currentPath
        ? favoritePath
        : null,
    viewMode: snapshot.viewMode,
    searchViewMode: snapshot.searchViewMode,
    sortBy: snapshot.sortBy,
    sortDirection: snapshot.sortDirection,
    includeHidden: snapshot.includeHidden,
    foldersFirst: snapshot.foldersFirst,
    favoritesExpanded: snapshot.favoritesExpanded,
    locationsExpanded: snapshot.locationsExpanded,
  };
}
