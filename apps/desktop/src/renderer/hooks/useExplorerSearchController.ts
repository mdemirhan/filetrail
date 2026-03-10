import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
  useEffect,
  useMemo,
} from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { appendSearchResults, filterSearchResults, sortSearchResults } from "../lib/searchResults";
import { useFiletrailClient } from "../lib/filetrailClient";
import { toDirectoryEntryFromSearchResult } from "../lib/explorerAppUtils";
import { createRendererLogger } from "../lib/logging";
import type {
  DirectoryEntry,
  SearchMatchScope,
  SearchPatternMode,
  SearchResultItem,
} from "../lib/explorerTypes";
import {
  EMPTY_CONTENT_SELECTION,
  sanitizeContentSelection,
  type ContentSelectionState,
} from "../lib/contentSelection";
import type {
  SearchResultsFilterScopePreference,
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";

type SearchResultsSortBy = SearchResultsSortByPreference;
type SearchResultsSortDirection = SearchResultsSortDirectionPreference;
type SearchResultsFilterScope = SearchResultsFilterScopePreference;
type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";

const SEARCH_POLL_INTERVAL_MS = 120;
const logger = createRendererLogger("filetrail.renderer");

export function useExplorerSearchController(args: {
  client: ReturnType<typeof useFiletrailClient>;
  currentPath: string;
  currentEntries: DirectoryEntry[];
  contentSelection: ContentSelectionState;
  applyContentSelection: (selection: ContentSelectionState, entries: DirectoryEntry[]) => void;
  focusContentPane: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchCommittedQuery: string;
  setSearchCommittedQuery: Dispatch<SetStateAction<string>>;
  searchRootPath: string;
  setSearchRootPath: Dispatch<SetStateAction<string>>;
  searchPatternMode: SearchPatternMode;
  setSearchPatternMode: Dispatch<SetStateAction<SearchPatternMode>>;
  searchMatchScope: SearchMatchScope;
  setSearchMatchScope: Dispatch<SetStateAction<SearchMatchScope>>;
  searchRecursive: boolean;
  setSearchRecursive: Dispatch<SetStateAction<boolean>>;
  searchIncludeHidden: boolean;
  setSearchIncludeHidden: Dispatch<SetStateAction<boolean>>;
  searchResultsSortBy: SearchResultsSortBy;
  setSearchResultsSortBy: Dispatch<SetStateAction<SearchResultsSortBy>>;
  searchResultsSortDirection: SearchResultsSortDirection;
  setSearchResultsSortDirection: Dispatch<SetStateAction<SearchResultsSortDirection>>;
  setSearchPopoverOpen: Dispatch<SetStateAction<boolean>>;
  searchResultsVisible: boolean;
  setSearchResultsVisible: Dispatch<SetStateAction<boolean>>;
  searchResults: SearchResultItem[];
  setSearchResults: Dispatch<SetStateAction<SearchResultItem[]>>;
  setSearchResultsScrollTop: Dispatch<SetStateAction<number>>;
  setSearchResultsFilterQuery: Dispatch<SetStateAction<string>>;
  debouncedSearchResultsFilterQuery: string;
  setDebouncedSearchResultsFilterQuery: Dispatch<SetStateAction<string>>;
  searchResultsFilterScope: SearchResultsFilterScope;
  setSearchResultsFilterScope: Dispatch<SetStateAction<SearchResultsFilterScope>>;
  setSearchStatus: Dispatch<SetStateAction<SearchStatus>>;
  setSearchError: Dispatch<SetStateAction<string | null>>;
  setSearchTruncated: Dispatch<SetStateAction<boolean>>;
  searchPollTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  searchSessionRef: MutableRefObject<number>;
  searchJobIdRef: MutableRefObject<string | null>;
  searchCommittedQueryRef: MutableRefObject<string>;
  searchResultsVisibleRef: MutableRefObject<boolean>;
  searchResultsSortByRef: MutableRefObject<SearchResultsSortBy>;
  searchResultsSortDirectionRef: MutableRefObject<SearchResultsSortDirection>;
  browseSelectionRef: MutableRefObject<ContentSelectionState>;
  cachedSearchSelectionRef: MutableRefObject<ContentSelectionState>;
}) {
  const {
    client,
    currentPath,
    currentEntries,
    contentSelection,
    applyContentSelection,
    focusContentPane,
    searchInputRef,
    setSearchCommittedQuery,
    searchCommittedQuery,
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
    searchPollTimeoutRef,
    searchSessionRef,
    searchJobIdRef,
    searchCommittedQueryRef,
    searchResultsVisibleRef,
    searchResultsSortByRef,
    searchResultsSortDirectionRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
  } = args;

  const filteredSearchResults = useMemo(
    () =>
      filterSearchResults(
        searchResults,
        debouncedSearchResultsFilterQuery,
        searchResultsFilterScope,
      ),
    [debouncedSearchResultsFilterQuery, searchResults, searchResultsFilterScope],
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

  function showCachedSearchResults(options?: { focusPane?: boolean }) {
    if (!hasCachedSearch) {
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
      includeHidden: boolean;
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
    cachedSearchSelectionRef.current = EMPTY_CONTENT_SELECTION;
    applyContentSelection(EMPTY_CONTENT_SELECTION, searchResultEntries);

    try {
      const response = (await client.invoke("search:start", {
        rootPath,
        query: trimmedQuery,
        patternMode: overrides.patternMode ?? searchPatternMode,
        matchScope: overrides.matchScope ?? searchMatchScope,
        recursive: overrides.recursive ?? searchRecursive,
        includeHidden: overrides.includeHidden ?? searchIncludeHidden,
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

  function applySearchResultsSort() {
    const sortBy = searchResultsSortByRef.current;
    const sortDirection = searchResultsSortDirectionRef.current;
    setSearchResults((current) => sortSearchResults(current, sortBy, sortDirection));
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

  function updateSearchIncludeHidden(nextValue: boolean) {
    setSearchIncludeHidden(nextValue);
    if (hasCachedSearch) {
      void startSearch(searchCommittedQuery, {
        includeHidden: nextValue,
        rootPath: searchRootPath || currentPath,
      });
    }
  }

  return {
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
  };
}
