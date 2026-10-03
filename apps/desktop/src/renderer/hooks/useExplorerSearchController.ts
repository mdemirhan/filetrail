import { useEffect, useMemo, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import type {
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";
import {
  type ContentSelectionState,
  EMPTY_CONTENT_SELECTION,
  sanitizeContentSelection,
} from "../lib/contentSelection";
import { toDirectoryEntryFromSearchResult } from "../lib/explorerAppUtils";
import type { TabSearchSession } from "../lib/explorerTabs";
import type {
  DirectoryEntry,
  SearchMatchScope,
  SearchPatternMode,
  SearchResultItem,
} from "../lib/explorerTypes";
import { filterSearchResultsByText } from "../lib/listFilter";
import { createRendererLogger } from "../lib/logging";
import {
  isNarrowerTextQuery,
  keepMatchingResults,
  matchesTextQuery,
} from "../lib/searchRefinement";
import { appendSearchResults, sortSearchResults } from "../lib/searchResults";
import type {
  ExplorerServices,
  NavigationStore,
  SearchStore,
  SelectionActions,
} from "../state/explorerStores";

type SearchResultsSortBy = SearchResultsSortByPreference;
type SearchResultsSortDirection = SearchResultsSortDirectionPreference;
type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";

const SEARCH_POLL_INTERVAL_MS = 120;
// Typing searches on its own once the text is this long and the keyboard has been still
// for this long; Return searches at once, whatever the length.
export const LIVE_SEARCH_MIN_LENGTH = 2;
// A search walks every folder under the one searched, so it waits a little longer for the
// typing to stop than a lookup would. Narrowing what was already found does not wait at all.
export const LIVE_SEARCH_DELAY_MS = 400;
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
  const { currentPath, currentEntries, contentSelection, listFilterQuery } = navigation;
  const { applyContentSelection, focusContentPane } = selection;
  const {
    setSearchCommittedQuery,
    setSearchDraftQuery,
    searchCommittedQuery,
    searchBaseQuery,
    setSearchBaseQuery,
    searchBaseQueryRef,
    searchCommittedQueryRef,
    searchStatus,
    searchTruncated,
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
    setSearchPopoverOpen,
    setSearchResultsVisible,
    searchResultsVisible,
    searchResults,
    setSearchResults,
    searchResultsScrollTop,
    setSearchResultsScrollTop,
    setSearchStatus,
    searchError,
    setSearchError,
    searchStartedLive,
    setSearchStartedLive,
    setSearchTruncated,
    searchElapsedMs,
    setSearchElapsedMs,
    searchDraftQuery,
    searchStartedAtRef,
    searchPollTimeoutRef,
    searchSessionRef,
    searchJobIdRef,
    searchDraftQueryRef,
    searchOriginPathRef,
    searchResultsRef,
    searchResultsVisibleRef,
    searchResultsSortByRef,
    searchResultsSortDirectionRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
  } = search;

  // Sorting is live: results stream in from fd in arbitrary order and are kept sorted by
  // the chosen column instead of waiting for an explicit "apply".
  // What the search on disk found is narrowed to the text now in the field when that text
  // has grown since the search started (see searchRefinement).
  const refinedSearchResults = useMemo(
    () =>
      searchBaseQuery === searchCommittedQuery
        ? searchResults
        : searchResults.filter((result) =>
            matchesTextQuery(result, searchCommittedQuery, searchMatchScope),
          ),
    [searchBaseQuery, searchCommittedQuery, searchMatchScope, searchResults],
  );
  const sortedSearchResults = useMemo(
    () => sortSearchResults(refinedSearchResults, searchResultsSortBy, searchResultsSortDirection),
    [refinedSearchResults, searchResultsSortBy, searchResultsSortDirection],
  );
  // The filter of the results bar (typing in the results goes there too) narrows them by
  // name or by the folder they are in.
  const filteredSearchResults = useMemo(
    () => filterSearchResultsByText(sortedSearchResults, listFilterQuery),
    [listFilterQuery, sortedSearchResults],
  );
  const searchResultEntries = useMemo(
    () => filteredSearchResults.map((result) => toDirectoryEntryFromSearchResult(result)),
    [filteredSearchResults],
  );
  const allSearchResultEntries = useMemo(
    () => sortedSearchResults.map((result) => toDirectoryEntryFromSearchResult(result)),
    [sortedSearchResults],
  );
  // The results a filter text would leave, for choosing what it selects.
  function filterSearchResultEntries(query: string) {
    return filterSearchResultsByText(sortedSearchResults, query).map((result) =>
      toDirectoryEntryFromSearchResult(result),
    );
  }
  const hasCachedSearch = searchCommittedQuery.trim().length > 0;
  const isSearchMode = searchResultsVisible && hasCachedSearch;

  const liveSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Results kept from the previous search because they also match the new one; the new
  // search finds them again, and they are not listed twice.
  const keptResultPathsRef = useRef<Set<string>>(new Set());
  // Set when a search was stopped because its results were put away; it runs again when
  // they are shown.
  const searchInterruptedRef = useRef(false);
  // How far into the running search's results this window has read. A tab left while its
  // search runs picks the results up from here when it is shown again.
  const searchCursorRef = useRef(0);
  // Whether an answer from the running search is on its way.
  const pollInFlightRef = useRef(false);
  // The tab was left while an answer was on its way. If the search is found finished with
  // nothing new, that answer was the last one and its results are gone: search again.
  const verifyFirstUpdateAfterAttachRef = useRef(false);
  const [rerunRequestCount, setRerunRequestCount] = useState(0);
  // The text the live-search timer is waiting to search for.
  const pendingLiveQueryRef = useRef<string | null>(null);
  // Set while the first answer after a tab comes back is awaited. A search that turns out
  // to have finished while its tab was in the background has no known duration: the time
  // until the tab was shown again is not how long the search took.
  const awaitingFirstUpdateAfterAttachRef = useRef(false);

  useEffect(
    () => () => {
      if (liveSearchTimerRef.current) {
        clearTimeout(liveSearchTimerRef.current);
      }
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

  // A search whose results are put away (Esc, Done, opening a folder) stops walking the
  // disk; nobody is looking at what it would find. It runs again when the results are shown.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the results being hidden; the job is read through its ref.
  useEffect(() => {
    if (searchResultsVisible || searchJobIdRef.current === null) {
      return;
    }
    searchInterruptedRef.current = true;
    void cancelActiveSearch();
    setSearchStatus("cancelled");
  }, [searchResultsVisible]);

  function showCachedSearchResults(options?: { focusPane?: boolean; fromField?: boolean }) {
    if (!hasCachedSearch) {
      return;
    }
    // Focusing the field only brings a search back in the folder it was made from; in
    // another folder the field starts empty, ready to search there (⇧⌘F still shows it).
    if (options?.fromField && searchOriginPathRef.current !== currentPath) {
      return;
    }
    // The field mirrors what is on screen: showing cached results restores their query.
    setSearchDraftQuery(searchCommittedQuery);
    if (searchedHiddenRef.current !== includeHidden || searchInterruptedRef.current) {
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
    cancelLiveSearch();
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
    cancelLiveSearch();
    const sessionId = searchSessionRef.current;
    await cancelActiveSearch();
    // Another tab's search may be on screen by now; this one was stopped where it was left.
    if (searchSessionRef.current !== sessionId) {
      return;
    }
    setSearchStatus("cancelled");
    setSearchError(null);
  }

  async function clearCommittedSearch() {
    cancelLiveSearch();
    searchInterruptedRef.current = false;
    const sessionId = searchSessionRef.current;
    await cancelActiveSearch();
    if (searchSessionRef.current !== sessionId) {
      return;
    }
    searchSessionRef.current += 1;
    setSearchCommittedQuery("");
    setSearchBaseQuery("");
    searchBaseQueryRef.current = "";
    searchCommittedQueryRef.current = "";
    setSearchRootPath("");
    searchResultsRef.current = [];
    setSearchResults([]);
    setSearchResultsScrollTop(0);
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
    pollInFlightRef.current = true;
    void client
      .invoke("search:getUpdate", { jobId, cursor })
      .then((response) => {
        if (searchSessionRef.current === sessionId) {
          pollInFlightRef.current = false;
        }
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
        const mayHaveLostResults =
          verifyFirstUpdateAfterAttachRef.current &&
          typedResponse.done &&
          typedResponse.items.length === 0;
        verifyFirstUpdateAfterAttachRef.current = false;
        if (mayHaveLostResults) {
          // Searched again once the window has rendered the tab that just came back: the
          // answer can arrive before that, and the search is started from what is on screen.
          setRerunRequestCount((count) => count + 1);
          return;
        }
        const keptPaths = keptResultPathsRef.current;
        const newItems =
          keptPaths.size === 0
            ? typedResponse.items
            : typedResponse.items.filter((item) => !keptPaths.has(item.path));
        if (newItems.length > 0) {
          // Kept in step with the cursor, so a tab left at this moment loses neither.
          const nextResults = appendSearchResults(searchResultsRef.current, newItems);
          searchResultsRef.current = nextResults;
          setSearchResults(nextResults);
        }
        searchCursorRef.current = typedResponse.nextCursor;
        // The search stopped at its limit while the text in the field is narrower than
        // what it looked for: it may have missed matches, so look for that text itself.
        if (
          typedResponse.truncated &&
          searchCommittedQueryRef.current !== searchBaseQueryRef.current
        ) {
          void startSearchRef.current(searchCommittedQueryRef.current, {
            rootPath: resolveSearchRootPathRef.current(),
            live: true,
            keepMatchingResults: true,
          });
          return;
        }
        setSearchStatus(typedResponse.status);
        setSearchError(typedResponse.error);
        setSearchTruncated(typedResponse.truncated);
        const finishedInBackground =
          awaitingFirstUpdateAfterAttachRef.current && typedResponse.done;
        awaitingFirstUpdateAfterAttachRef.current = false;
        if (typedResponse.done) {
          searchJobIdRef.current = null;
          clearSearchPolling();
          if (finishedInBackground) {
            setSearchElapsedMs(null);
          } else if (searchStartedAtRef.current !== null) {
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
        pollInFlightRef.current = false;
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

  function cancelLiveSearch() {
    if (liveSearchTimerRef.current) {
      clearTimeout(liveSearchTimerRef.current);
      liveSearchTimerRef.current = null;
    }
    pendingLiveQueryRef.current = null;
  }

  // Searches for `trimmedQuery` once the keyboard has rested, unless the field has changed
  // by then.
  function scheduleLiveSearch(trimmedQuery: string) {
    pendingLiveQueryRef.current = trimmedQuery;
    liveSearchTimerRef.current = setTimeout(() => {
      liveSearchTimerRef.current = null;
      pendingLiveQueryRef.current = null;
      // The field may have been emptied or the folder left in the meantime.
      if (searchDraftQueryRef.current.trim() !== trimmedQuery) {
        return;
      }
      void startSearchRef.current(trimmedQuery, {
        rootPath: resolveSearchRootPathRef.current(),
        live: true,
        keepMatchingResults: true,
      });
    }, LIVE_SEARCH_DELAY_MS);
  }

  // Where a search typed now looks: the scope of the search on screen while its folder is
  // still open (so a widened scope survives further typing), otherwise the open folder.
  function resolveSearchRootPath() {
    const continuesSearch =
      hasCachedSearch &&
      searchResultsVisible &&
      searchRootPath.length > 0 &&
      searchOriginPathRef.current === currentPath;
    return continuesSearch ? searchRootPath : currentPath;
  }

  async function startSearch(
    query: string,
    overrides: Partial<{
      patternMode: SearchPatternMode;
      matchScope: SearchMatchScope;
      recursive: boolean;
      skipGitFolders: boolean;
      skipGitIgnored: boolean;
      rootPath: string;
      /** Started by typing: a pattern that does not parse yet is not shown as a failure. */
      live: boolean;
      /**
       * The query changed and nothing else: results on screen that also match the new text
       * stay while the new search runs. Anything else on screen is cleared at once, so the
       * list never shows results for a query that is no longer in the field.
       */
      keepMatchingResults: boolean;
    }> = {},
  ) {
    const trimmedQuery = query.trim();
    const rootPath = overrides.rootPath ?? currentPath;
    cancelLiveSearch();
    if (trimmedQuery.length === 0) {
      await clearCommittedSearch();
      return;
    }
    if (rootPath.length === 0) {
      return;
    }
    // Starting from the folder list, remember its selection for when the search closes.
    if (!searchResultsVisible) {
      browseSelectionRef.current = contentSelection;
    }
    const sessionId = searchSessionRef.current + 1;
    searchSessionRef.current = sessionId;
    await cancelActiveSearch();
    if (searchSessionRef.current !== sessionId) {
      return;
    }
    const keptResults =
      overrides.keepMatchingResults &&
      searchResultsVisible &&
      searchPatternMode === "text" &&
      rootPath === searchRootPath
        ? keepMatchingResults(
            searchResults,
            searchBaseQueryRef.current,
            trimmedQuery,
            searchMatchScope,
          )
        : [];
    keptResultPathsRef.current = new Set(keptResults.map((result) => result.path));
    searchResultsRef.current = keptResults;
    setSearchResults(keptResults);
    setSearchCommittedQuery(trimmedQuery);
    setSearchBaseQuery(trimmedQuery);
    searchCommittedQueryRef.current = trimmedQuery;
    searchBaseQueryRef.current = trimmedQuery;
    searchInterruptedRef.current = false;
    setSearchRootPath(rootPath);
    setSearchResultsVisible(true);
    // Read right after the search has been started, which can be before the next render.
    searchResultsVisibleRef.current = true;
    searchOriginPathRef.current = currentPath;
    setSearchStartedLive(overrides.live === true);
    setSearchResultsScrollTop(0);
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
        skipGitFolders: overrides.skipGitFolders ?? searchSkipGitFolders,
        skipGitIgnored: overrides.skipGitIgnored ?? searchSkipGitIgnored,
        includeHidden,
      })) as { jobId: string; status: IpcResponse<"search:start">["status"] };
      if (searchSessionRef.current !== sessionId) {
        await client.invoke("search:cancel", { jobId: response.jobId }).catch(() => undefined);
        return;
      }
      if (!searchResultsVisibleRef.current) {
        // The results were put away while the search was being started.
        searchInterruptedRef.current = true;
        setSearchStatus("cancelled");
        await client.invoke("search:cancel", { jobId: response.jobId }).catch(() => undefined);
        return;
      }
      searchJobIdRef.current = response.jobId;
      searchCursorRef.current = 0;
      awaitingFirstUpdateAfterAttachRef.current = false;
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

  const startSearchRef = useRef(startSearch);
  startSearchRef.current = startSearch;
  const resolveSearchRootPathRef = useRef(resolveSearchRootPath);
  resolveSearchRootPathRef.current = resolveSearchRootPath;

  // Whether the search on disk already covers `query`: plain text that only got longer
  // since that search started, in the same place, and the search did not stop at its limit
  // (it would have missed matches). Its results are then narrowed instead of searching again.
  function canRefineSearch(query: string) {
    return (
      searchPatternMode === "text" &&
      searchResultsVisible &&
      (searchStatus === "running" || searchStatus === "complete") &&
      !searchTruncated &&
      resolveSearchRootPath() === searchRootPath &&
      isNarrowerTextQuery(searchBaseQuery, query)
    );
  }

  function refineSearch(query: string) {
    if (query === searchCommittedQuery) {
      return;
    }
    setSearchCommittedQuery(query);
    searchCommittedQueryRef.current = query;
    setSearchResultsScrollTop(0);
    cachedSearchSelectionRef.current = EMPTY_CONTENT_SELECTION;
    applyContentSelection(EMPTY_CONTENT_SELECTION, []);
  }

  // Typing in the search field. Text that only narrows what the search already covers is
  // applied at once. Anything else is searched for once the keyboard rests. Text too short
  // to search live shows the folder again (Return still searches for it).
  function updateSearchDraftQuery(nextValue: string) {
    setSearchDraftQuery(nextValue);
    searchDraftQueryRef.current = nextValue;
    cancelLiveSearch();
    const trimmedQuery = nextValue.trim();
    if (trimmedQuery.length < LIVE_SEARCH_MIN_LENGTH) {
      if (hasCachedSearch) {
        void clearCommittedSearch();
      }
      return;
    }
    if (canRefineSearch(trimmedQuery)) {
      refineSearch(trimmedQuery);
      return;
    }
    scheduleLiveSearch(trimmedQuery);
  }

  // Return in the search field. What typing already found is kept; anything else is
  // searched now. Resolves to whether the results for the query were already on screen.
  async function submitSearch(query: string): Promise<boolean> {
    cancelLiveSearch();
    const trimmedQuery = query.trim();
    const rootPath = resolveSearchRootPath();
    const alreadyOnScreen =
      trimmedQuery.length > 0 &&
      searchResultsVisible &&
      trimmedQuery === searchCommittedQuery &&
      rootPath === searchRootPath;
    // While the search is still running its order is not final, so the results do not
    // count as on screen yet: the caller waits for the end before selecting the first one.
    if (alreadyOnScreen) {
      setSearchStartedLive(false);
      return searchStatus !== "running";
    }
    if (canRefineSearch(trimmedQuery)) {
      refineSearch(trimmedQuery);
      setSearchStartedLive(false);
      return searchStatus !== "running";
    }
    await startSearch(trimmedQuery, { rootPath, keepMatchingResults: true });
    return false;
  }

  // Esc in the search field before anything was searched: forget what was typed, and the
  // search that was about to start for it.
  function abandonSearchDraft() {
    cancelLiveSearch();
    setSearchDraftQuery("");
    searchDraftQueryRef.current = "";
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

  function updateSearchSkipGitFolders(nextValue: boolean) {
    setSearchSkipGitFolders(nextValue);
    if (hasCachedSearch) {
      void startSearch(searchCommittedQuery, {
        skipGitFolders: nextValue,
        rootPath: searchRootPath || currentPath,
      });
    }
  }

  function updateSearchSkipGitIgnored(nextValue: boolean) {
    setSearchSkipGitIgnored(nextValue);
    if (hasCachedSearch) {
      void startSearch(searchCommittedQuery, {
        skipGitIgnored: nextValue,
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per request, with the search that is on screen then.
  useEffect(() => {
    if (rerunRequestCount > 0) {
      rerunSearch();
    }
  }, [rerunRequestCount]);

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

  function toggleSearchResultsSortDirection() {
    setSearchResultsSortDirection((current) => {
      const nextValue = current === "asc" ? "desc" : "asc";
      searchResultsSortDirectionRef.current = nextValue;
      return nextValue;
    });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────────────────
  // Each tab has a search of its own, but only the tab on screen is live: leaving a tab
  // takes its search out of the window (`detachSearchSession`) and showing a tab puts its
  // search back (`attachSearchSession`).

  // Stops listening to the search on screen and hands it back as it stands. A search that
  // is running keeps running in the worker; nothing asks it for results until it is
  // attached again.
  function detachSearchSession(): TabSearchSession {
    const pendingLiveQuery = pendingLiveQueryRef.current;
    cancelLiveSearch();
    clearSearchPolling();
    const session: TabSearchSession = {
      pollInFlight: pollInFlightRef.current && searchJobIdRef.current !== null,
      pendingLiveQuery,
      draftQuery: searchDraftQuery,
      committedQuery: searchCommittedQuery,
      baseQuery: searchBaseQuery,
      rootPath: searchRootPath,
      originPath: searchOriginPathRef.current,
      patternMode: searchPatternMode,
      matchScope: searchMatchScope,
      recursive: searchRecursive,
      skipGitFolders: searchSkipGitFolders,
      skipGitIgnored: searchSkipGitIgnored,
      resultsSortBy: searchResultsSortBy,
      resultsSortDirection: searchResultsSortDirection,
      resultsVisible: searchResultsVisible,
      results: searchResultsRef.current,
      resultsScrollTop: searchResultsScrollTop,
      status: searchStatus,
      error: searchError,
      startedLive: searchStartedLive,
      truncated: searchTruncated,
      elapsedMs: searchElapsedMs,
      startedAt: searchStartedAtRef.current,
      jobId: searchJobIdRef.current,
      cursor: searchCursorRef.current,
      keptResultPaths: keptResultPathsRef.current,
      interrupted: searchInterruptedRef.current,
      searchedHidden: searchedHiddenRef.current,
      browseSelection: browseSelectionRef.current,
      cachedSearchSelection: cachedSearchSelectionRef.current,
    };
    // Answers still on their way belong to the search that was just taken out.
    searchSessionRef.current += 1;
    searchJobIdRef.current = null;
    pollInFlightRef.current = false;
    return session;
  }

  // Puts a tab's search on screen. Resolves to whether the search has to run again: it was
  // cut off before it got going, or hidden files were switched since it ran.
  function attachSearchSession(
    session: TabSearchSession,
    tabIncludeHidden: boolean = includeHidden,
  ): boolean {
    cancelLiveSearch();
    clearSearchPolling();
    const sessionId = searchSessionRef.current + 1;
    searchSessionRef.current = sessionId;
    // A search left before the worker had answered `search:start` was cancelled when that
    // answer arrived, so there is nothing to pick up.
    const cutOff = session.status === "running" && session.jobId === null;
    setSearchDraftQuery(session.draftQuery);
    searchDraftQueryRef.current = session.draftQuery;
    setSearchCommittedQuery(session.committedQuery);
    searchCommittedQueryRef.current = session.committedQuery;
    setSearchBaseQuery(session.baseQuery);
    searchBaseQueryRef.current = session.baseQuery;
    setSearchRootPath(session.rootPath);
    searchOriginPathRef.current = session.originPath;
    setSearchPatternMode(session.patternMode);
    setSearchMatchScope(session.matchScope);
    setSearchRecursive(session.recursive);
    setSearchSkipGitFolders(session.skipGitFolders);
    setSearchSkipGitIgnored(session.skipGitIgnored);
    setSearchResultsSortBy(session.resultsSortBy);
    searchResultsSortByRef.current = session.resultsSortBy;
    setSearchResultsSortDirection(session.resultsSortDirection);
    searchResultsSortDirectionRef.current = session.resultsSortDirection;
    setSearchPopoverOpen(false);
    setSearchResultsVisible(session.resultsVisible);
    searchResultsVisibleRef.current = session.resultsVisible;
    setSearchResults(session.results);
    searchResultsRef.current = session.results;
    setSearchResultsScrollTop(session.resultsScrollTop);
    setSearchStatus(cutOff ? "cancelled" : session.status);
    setSearchError(session.error);
    setSearchStartedLive(session.startedLive);
    setSearchTruncated(session.truncated);
    setSearchElapsedMs(session.elapsedMs);
    searchStartedAtRef.current = session.startedAt;
    keptResultPathsRef.current = session.keptResultPaths;
    searchInterruptedRef.current = session.interrupted || cutOff;
    searchedHiddenRef.current = session.searchedHidden;
    browseSelectionRef.current = session.browseSelection;
    cachedSearchSelectionRef.current = session.cachedSearchSelection;
    searchJobIdRef.current = session.jobId;
    searchCursorRef.current = session.cursor;
    awaitingFirstUpdateAfterAttachRef.current = session.jobId !== null;
    verifyFirstUpdateAfterAttachRef.current = session.jobId !== null && session.pollInFlight;
    // What was being typed when the tab was left is searched for as if it had just been typed.
    if (session.pendingLiveQuery !== null) {
      scheduleLiveSearch(session.pendingLiveQuery);
    }
    if (session.jobId !== null) {
      pollSearch(session.jobId, session.cursor, sessionId);
    }
    const hasQuery = session.committedQuery.trim().length > 0;
    // A search that stopped at its limit in the background, with narrower text in the
    // field than it looked for, may have missed matches (see the same case in pollSearch).
    const stoppedShort =
      session.jobId === null && session.truncated && session.committedQuery !== session.baseQuery;
    return (
      hasQuery &&
      session.resultsVisible &&
      (cutOff || session.interrupted || stoppedShort || session.searchedHidden !== tabIncludeHidden)
    );
  }

  // A search with nothing in it and the options of the search on screen: what a new tab
  // starts with.
  function createEmptySearchSession(): TabSearchSession {
    return {
      draftQuery: "",
      committedQuery: "",
      baseQuery: "",
      rootPath: "",
      originPath: "",
      patternMode: searchPatternMode,
      matchScope: searchMatchScope,
      recursive: searchRecursive,
      skipGitFolders: searchSkipGitFolders,
      skipGitIgnored: searchSkipGitIgnored,
      resultsSortBy: searchResultsSortBy,
      resultsSortDirection: searchResultsSortDirection,
      resultsVisible: false,
      results: [],
      resultsScrollTop: 0,
      status: "idle",
      error: null,
      startedLive: false,
      truncated: false,
      elapsedMs: null,
      startedAt: null,
      jobId: null,
      cursor: 0,
      pollInFlight: false,
      pendingLiveQuery: null,
      keptResultPaths: new Set(),
      interrupted: false,
      searchedHidden: includeHidden,
      browseSelection: EMPTY_CONTENT_SELECTION,
      cachedSearchSelection: EMPTY_CONTENT_SELECTION,
    };
  }

  return {
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
  };
}
