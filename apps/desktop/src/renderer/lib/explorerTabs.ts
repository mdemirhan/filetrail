import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import type {
  ExplorerViewMode,
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";
import type { TreeNodeState } from "../components/TreePane";
import type { ContentSelectionState } from "./contentSelection";
import { getPathLeafName } from "./explorerAppUtils";
import { parentDirectoryPath } from "./explorerNavigation";
import type {
  DirectoryEntry,
  DirectoryEntryMetadata,
  SearchMatchScope,
  SearchPatternMode,
  SearchResultItem,
} from "./explorerTypes";
import type { TreeItemId } from "./favorites";

type SortBy = IpcRequest<"directory:getSnapshot">["sortBy"];
type SortDirection = IpcRequest<"directory:getSnapshot">["sortDirection"];
type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";

// A tab's search, as it was when the tab was left. The search itself keeps running in the
// worker; `jobId` and `cursor` are where to pick its results up again.
export type TabSearchSession = {
  draftQuery: string;
  committedQuery: string;
  baseQuery: string;
  rootPath: string;
  originPath: string;
  patternMode: SearchPatternMode;
  matchScope: SearchMatchScope;
  recursive: boolean;
  skipGitFolders: boolean;
  skipGitIgnored: boolean;
  resultsSortBy: SearchResultsSortByPreference;
  resultsSortDirection: SearchResultsSortDirectionPreference;
  resultsVisible: boolean;
  results: SearchResultItem[];
  resultsScrollTop: number;
  status: SearchStatus;
  error: string | null;
  startedLive: boolean;
  truncated: boolean;
  elapsedMs: number | null;
  startedAt: number | null;
  jobId: string | null;
  cursor: number;
  keptResultPaths: Set<string>;
  interrupted: boolean;
  searchedHidden: boolean;
  browseSelection: ContentSelectionState;
  cachedSearchSelection: ContentSelectionState;
};

// What a tab had on screen: enough to show it again at once, before its folder is re-read.
export type TabViewState = {
  treeNodes: Record<string, TreeNodeState>;
  currentEntries: DirectoryEntry[];
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  directoryError: string | null;
  contentSelection: ContentSelectionState;
  listFilterQuery: string;
  contentScroll: { top: number; left: number };
  treeScrollTop: number;
};

export type TabSnapshot = {
  currentPath: string;
  historyPaths: string[];
  historyIndex: number;
  viewMode: ExplorerViewMode;
  sortBy: SortBy;
  sortDirection: SortDirection;
  treeRootPath: string;
  selectedTreeItemId: TreeItemId | null;
  leftPaneSubview: "favorites" | "tree";
  // null for a tab that has not been shown yet (one restored at launch): its folder and
  // tree are read when it is first opened.
  view: TabViewState | null;
  search: TabSearchSession | null;
};

export type ExplorerTab = {
  id: string;
  // The state the tab was left in. The tab on screen has none: its state is the live one.
  snapshot: TabSnapshot | null;
  // A file operation finished while the tab was in the background, so its tree may have
  // changed as well as its folder.
  stale: boolean;
};

export type ExplorerTabsState = {
  tabs: ExplorerTab[];
  activeTabId: string;
};

export type TabDescription = {
  label: string;
  tooltip: string;
  kind: "folder" | "search";
  searching: boolean;
};

export function getFolderDisplayName(path: string): string {
  if (path === "/") {
    return "Macintosh HD";
  }
  return path.length > 0 ? getPathLeafName(path) : "";
}

// What a tab is called in the strip: its folder, or its search while results are showing.
export function describeTab(args: {
  currentPath: string;
  searchVisible: boolean;
  searchQuery: string;
  searchRootPath: string;
  searchRunning: boolean;
}): TabDescription {
  if (args.searchVisible && args.searchQuery.trim().length > 0) {
    const rootName = getFolderDisplayName(args.searchRootPath || args.currentPath);
    return {
      label: `“${args.searchQuery}” in ${rootName}`,
      tooltip: `Searching ${args.searchRootPath || args.currentPath}`,
      kind: "search",
      searching: args.searchRunning,
    };
  }
  return {
    label: args.currentPath.length > 0 ? getFolderDisplayName(args.currentPath) : "Favorites",
    tooltip: args.currentPath,
    kind: "folder",
    searching: false,
  };
}

export function describeTabSnapshot(snapshot: TabSnapshot): TabDescription {
  const search = snapshot.search;
  return describeTab({
    currentPath: snapshot.currentPath,
    searchVisible: search?.resultsVisible ?? false,
    searchQuery: search?.committedQuery ?? "",
    searchRootPath: search?.rootPath ?? "",
    searchRunning: search?.status === "running",
  });
}

// The tab that takes over when `closedTabId` closes: the one to its right, or the one to
// its left when it was last.
export function resolveTabAfterClose(
  tabs: readonly ExplorerTab[],
  closedTabId: string,
): string | null {
  const index = tabs.findIndex((tab) => tab.id === closedTabId);
  if (index < 0) {
    return null;
  }
  return (tabs[index + 1] ?? tabs[index - 1])?.id ?? null;
}

// The next or previous tab, wrapping around at the ends.
export function resolveAdjacentTab(
  tabs: readonly ExplorerTab[],
  activeTabId: string,
  direction: "next" | "previous",
): string | null {
  if (tabs.length < 2) {
    return null;
  }
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  if (index < 0) {
    return null;
  }
  const nextIndex = (index + (direction === "next" ? 1 : -1) + tabs.length) % tabs.length;
  return tabs[nextIndex]?.id ?? null;
}

// A tree saved in the middle of loading a folder would wait for that answer for ever: the
// answer went to the tab that was on screen then.
export function settleTreeNodes(
  nodes: Record<string, TreeNodeState>,
): Record<string, TreeNodeState> {
  let settled: Record<string, TreeNodeState> | null = null;
  for (const [path, node] of Object.entries(nodes)) {
    if (!node.loading) {
      continue;
    }
    settled ??= { ...nodes };
    settled[path] = { ...node, loading: false };
  }
  return settled ?? nodes;
}

// `path` and the folders above it, nearest first: where a tab goes when its folder is gone.
export function getPathAndAncestors(path: string): string[] {
  const paths: string[] = [];
  let current: string | null = path;
  while (current !== null && current.length > 0) {
    paths.push(current);
    current = parentDirectoryPath(current);
  }
  return paths;
}

// Moves a tab to `toIndex` in the row; the other tabs keep their order.
export function moveTabInList(
  tabs: readonly ExplorerTab[],
  tabId: string,
  toIndex: number,
): ExplorerTab[] {
  const fromIndex = tabs.findIndex((tab) => tab.id === tabId);
  const next = [...tabs];
  if (fromIndex < 0) {
    return next;
  }
  const [moved] = next.splice(fromIndex, 1);
  if (moved) {
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved);
  }
  return next;
}

// How many closed tabs "Reopen Closed Tab" can bring back, most recent first.
export const CLOSED_TABS_LIMIT = 10;

// What is kept of a closed tab: its folder, its tree root, and how it showed the folder.
// Its history, selection and search go with it.
export function toReopenableSnapshot(snapshot: TabSnapshot): TabSnapshot {
  return {
    ...snapshot,
    historyPaths: snapshot.currentPath.length > 0 ? [snapshot.currentPath] : [],
    historyIndex: snapshot.currentPath.length > 0 ? 0 : -1,
    view: null,
    search: null,
  };
}
