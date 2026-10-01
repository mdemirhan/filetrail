import { useEffect, useMemo, useRef } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import type {
  SearchResultsFilterScopePreference,
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";
import {
  type ContentSelectionState,
  EMPTY_CONTENT_SELECTION,
  sanitizeContentSelection,
} from "../lib/contentSelection";
import { toDirectoryEntryFromSearchResult } from "../lib/explorerAppUtils";
import type {
  DirectoryEntry,
  SearchMatchScope,
  SearchPatternMode,
  SearchResultItem,
} from "../lib/explorerTypes";
import { createRendererLogger } from "../lib/logging";
import { appendSearchResults, filterSearchResults, sortSearchResults } from "../lib/searchResults";
import type {
  ExplorerServices,
  NavigationStore,
  SearchStore,
  SelectionActions,
} from "../state/explorerStores";

type SearchResultsSortBy = SearchResultsSortByPreference;
type SearchResultsSortDirection = SearchResultsSortDirectionPreference;
type SearchResultsFilterScope = SearchResultsFilterScopePreference;
type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";

const SEARCH_POLL_INTERVAL_MS = 120;
const logger = createRendererLogger("filetrail.renderer");

export function useExplorerSearchController(args: {
  services: ExplorerServices;
  navigation: NavigationStore;
  search: SearchStore;
  selection: SelectionActions;
  /** Whether the file list shows hidden files (⇧⌘.); search includes them exactly then. */
  includeHidden: boolean;
}) {
  const { services, navigation, search, selection, includeHidden } = args;
  const { client, searchInputRef } = services;
  const { currentPath, currentEntries, contentSelection } = navigation;
  const { applyContentSelection, focusContentPane } = selection;
  const {
    setSearchCommittedQuery,
    setSearchDraftQuery,
    searchCommittedQuery,
    searchRootPath,
    setSearchRootPath,
    searchPatternMode,
    setSearchPatternMode,
    searchMatchScope,
    setSearchMatchScope,
    searchRecursive,
    setSearchRecursive,
    searchResultsSortBy,
    setSearchResultsSortBy,
    searchResultsSortDirection,
    setSearchResultsSortDirection,
    setSearchPopoverOpen,
    setSearchResultsVisible,
    searchResultsVisible,
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
    setSearchElapsedMs,
    searchStartedAtRef,
    searchPollTimeoutRef,
    searchSessionRef,
    searchJobIdRef,
    searchCommittedQueryRef,
    searchResultsVisibleRef,
    searchResultsSortByRef,
    searchResultsSortDirectionRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
  } = search;

  // Sorting is live: results stream in from fd in arbitrary order and are kept sorted by
  // the chosen column instead of waiting for an explicit "apply".
  const filteredSearchResults = useMemo(
    () =>
      sortSearchResults(
        filterSearchResults(
          searchResults,
          debouncedSearchResultsFilterQuery,
          searchResultsFilterScope,
        ),
        searchResultsSortBy,
        searchResultsSortDirection,
      ),
    [
      debouncedSearchResultsFilterQuery,
      searchResults,
      searchResultsFilterScope,
      searchResultsSortBy,
      searchResultsSortDirection,
    ],
  );
  const searchResultEntries = useMemo(
    () => filteredSearchResults.map((result) => toDirectoryEntryFromSearchResult(result)),
    [filteredSearchResults],
  );
  const hasCachedSearch = searchCommittedQuery.trim().length > 0;
  const isSearchMode = searchResultsVisible && hasCachedSearch;

  useEffect(
    () => () => {
      if (searchPollTimeoutRef.current) {
        clearTimeout(searchPollTimeoutRef.current);
      }
      if (searchJobIdRef.current) {
        void client
          .invoke("search:cancel", { jobId: searchJobIdRef.current })
          .catch(() => undefined);
      }
    },
    [client, searchJobIdRef, searchPollTimeoutRef],
  );

  // Search has no hidden-files option of its own: it follows the file list. `searchedHiddenRef`
  // is the setting the current results were found with; when the setting changes, results on
  // screen are searched again, and cached ones are searched again the next time they show.
  const searchedHiddenRef = useRef(includeHidden);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only when the hidden-files setting changes; the search it restarts reads the latest state.
  useEffect(() => {
    if (!hasCachedSearch || !searchResultsVisible || searchedHiddenRef.current === includeHidden) {
      return;
    }
    void startSearch(searchCommittedQuery, { rootPath: searchRootPath || currentPath });
  }, [includeHidden]);

  function showCachedSearchResults(options?: { focusPane?: boolean }) {
    if (!hasCachedSearch) {
      return;
    }
    // The field mirrors what is on screen: showing cached results restores their query.
    setSearchDraftQuery(searchCommittedQuery);
    if (searchedHiddenRef.current !== includeHidden) {
      void startSearch(searchCommittedQuery, { rootPath: searchRootPath || currentPath });
      if (options?.focusPane) {
        focusContentPane();
      }
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
    // Leaving search mode clears the field so it never shows a query for results that are
    // no longer visible; the cached results stay available (focus the field or ⇧⌘F).
    setSearchDraftQuery("");
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
      logger.debug("search cancel failed during cleanup", error, {
        jobId: activeJobId,
      });
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
    void client
      .invoke("search:getUpdate", { jobId, cursor })
      .then((response) => {
        const typedResponse = response as {
          items: SearchResultItem[];
          status: IpcResponse<"search:getUpdate">["status"];
          error: string | null;
          truncated: boolean;
          done: boolean;
          nextCursor: number;
        };
        if (searchSessionRef.current !== sessionId || searchJobIdRef.current !== jobId) {
          return;
        }
        setSearchResults((current) =>
          typedResponse.items.length > 0
            ? appendSearchResults(current, typedResponse.items)
            : current,
        );
        setSearchStatus(typedResponse.status);
        setSearchError(typedResponse.error);
        setSearchTruncated(typedResponse.truncated);
        if (typedResponse.done) {
          searchJobIdRef.current = null;
          clearSearchPolling();
          if (searchStartedAtRef.current !== null) {
            setSearchElapsedMs(
              Math.max(0, Math.round(performance.now() - searchStartedAtRef.current)),
            );
          }
          return;
        }
        searchPollTimeoutRef.current = setTimeout(() => {
          pollSearch(jobId, typedResponse.nextCursor, sessionId);
        }, SEARCH_POLL_INTERVAL_MS);
      })
      .catch((error) => {
        if (searchSessionRef.current !== sessionId || searchJobIdRef.current !== jobId) {
          return;
        }
        logger.error("search update failed", error, {
          jobId,
          cursor,
        });
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
      rootPath: string;
    }> = {},
  ) {
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
    setSearchElapsedMs(null);
    searchStartedAtRef.current = performance.now();
    searchedHiddenRef.current = includeHidden;
    cachedSearchSelectionRef.current = EMPTY_CONTENT_SELECTION;
    applyContentSelection(EMPTY_CONTENT_SELECTION, searchResultEntries);

    try {
      const response = (await client.invoke("search:start", {
        rootPath,
        query: trimmedQuery,
        patternMode: overrides.patternMode ?? searchPatternMode,
        matchScope: overrides.matchScope ?? searchMatchScope,
        recursive: overrides.recursive ?? searchRecursive,
        includeHidden,
      })) as { jobId: string; status: IpcResponse<"search:start">["status"] };
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
      logger.error("search start failed", error, {
        rootPath,
        query: trimmedQuery,
      });
      searchJobIdRef.current = null;
      clearSearchPolling();
      setSearchStatus("error");
      setSearchError(error instanceof Error ? error.message : String(error));
    }
  }

  function updateSearchPatternMode(nextValue: SearchPatternMode) {
    setSearchPatternMode(nextValue);
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

  // ⌘R in search mode runs the same search again (the folder may have changed).
  function rerunSearch() {
    if (!hasCachedSearch) {
      return;
    }
    void startSearch(searchCommittedQuery, { rootPath: searchRootPath || currentPath });
  }

  function changeSearchRoot(rootPath: string) {
    if (!hasCachedSearch || rootPath.length === 0) {
      return;
    }
    void startSearch(searchCommittedQuery, { rootPath });
  }

  // Clicking the active column flips direction; a new column starts ascending.
  function sortSearchResultsByColumn(nextValue: SearchResultsSortBy) {
    if (searchResultsSortByRef.current === nextValue) {
      toggleSearchResultsSortDirection();
      return;
    }
    searchResultsSortByRef.current = nextValue;
    searchResultsSortDirectionRef.current = "asc";
    setSearchResultsSortBy(nextValue);
    setSearchResultsSortDirection("asc");
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

  return {
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
    updateSearchResultsFilterQuery,
    updateSearchResultsFilterScope,
    updateSearchResultsSortBy,
  };
}
