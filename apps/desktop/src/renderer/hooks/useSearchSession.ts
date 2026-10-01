import { useEffect, useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import {
  DEFAULT_APP_PREFERENCES,
  type SearchResultsSortByPreference,
  type SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";
import { type ContentSelectionState, EMPTY_CONTENT_SELECTION } from "../lib/contentSelection";

type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
type SearchJobStatus = IpcResponse<"search:getUpdate">["status"];
type SearchResultsSortBy = SearchResultsSortByPreference;
type SearchResultsSortDirection = SearchResultsSortDirectionPreference;

export function useSearchSession() {
  const [searchDraftQuery, setSearchDraftQuery] = useState("");
  const [searchCommittedQuery, setSearchCommittedQuery] = useState("");
  const [searchRootPath, setSearchRootPath] = useState("");
  const [searchPatternMode, setSearchPatternMode] = useState<SearchPatternMode>(
    DEFAULT_APP_PREFERENCES.searchPatternMode,
  );
  const [searchMatchScope, setSearchMatchScope] = useState<SearchMatchScope>(
    DEFAULT_APP_PREFERENCES.searchMatchScope,
  );
  const [searchRecursive, setSearchRecursive] = useState(DEFAULT_APP_PREFERENCES.searchRecursive);
  const [searchSkipGitFolders, setSearchSkipGitFolders] = useState(
    DEFAULT_APP_PREFERENCES.searchSkipGitFolders,
  );
  const [searchSkipGitIgnored, setSearchSkipGitIgnored] = useState(
    DEFAULT_APP_PREFERENCES.searchSkipGitIgnored,
  );
  const [searchResultsSortBy, setSearchResultsSortBy] = useState<SearchResultsSortBy>(
    DEFAULT_APP_PREFERENCES.searchResultsSortBy,
  );
  const [searchResultsSortDirection, setSearchResultsSortDirection] =
    useState<SearchResultsSortDirection>(DEFAULT_APP_PREFERENCES.searchResultsSortDirection);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [searchResultsVisible, setSearchResultsVisible] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchResultsScrollTop, setSearchResultsScrollTop] = useState(0);
  const [searchResultsFilterQuery, setSearchResultsFilterQuery] = useState("");
  const [debouncedSearchResultsFilterQuery, setDebouncedSearchResultsFilterQuery] = useState("");
  const [searchStatus, setSearchStatus] = useState<SearchJobStatus | "idle">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  // Whether the search on screen was started by typing rather than by Return. A pattern
  // that is still being typed is not reported as a failure.
  const [searchStartedLive, setSearchStartedLive] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(false);
  // Wall-clock duration of the last completed search, shown next to the result count.
  const [searchElapsedMs, setSearchElapsedMs] = useState<number | null>(null);
  const searchStartedAtRef = useRef<number | null>(null);
  const searchPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSessionRef = useRef(0);
  const searchJobIdRef = useRef<string | null>(null);
  const searchPointerIntentRef = useRef(false);
  const searchCommittedQueryRef = useRef("");
  const searchDraftQueryRef = useRef("");
  // The folder that was on screen when the current search started. A search is only
  // continued (its scope kept, its results brought back) while that folder is still open.
  const searchOriginPathRef = useRef("");
  const searchResultsRef = useRef<SearchResultItem[]>([]);
  const searchResultsVisibleRef = useRef(false);
  const searchResultsSortByRef = useRef<SearchResultsSortBy>(
    DEFAULT_APP_PREFERENCES.searchResultsSortBy,
  );
  const searchResultsSortDirectionRef = useRef<SearchResultsSortDirection>(
    DEFAULT_APP_PREFERENCES.searchResultsSortDirection,
  );
  const browseSelectionRef = useRef<ContentSelectionState>(EMPTY_CONTENT_SELECTION);
  const cachedSearchSelectionRef = useRef<ContentSelectionState>(EMPTY_CONTENT_SELECTION);

  useEffect(() => {
    searchResultsVisibleRef.current = searchResultsVisible;
  }, [searchResultsVisible]);

  useEffect(() => {
    searchCommittedQueryRef.current = searchCommittedQuery;
  }, [searchCommittedQuery]);

  useEffect(() => {
    searchDraftQueryRef.current = searchDraftQuery;
  }, [searchDraftQuery]);

  useEffect(() => {
    searchResultsRef.current = searchResults;
  }, [searchResults]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchResultsFilterQuery(searchResultsFilterQuery);
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [searchResultsFilterQuery]);

  useEffect(() => {
    searchResultsSortByRef.current = searchResultsSortBy;
  }, [searchResultsSortBy]);

  useEffect(() => {
    searchResultsSortDirectionRef.current = searchResultsSortDirection;
  }, [searchResultsSortDirection]);

  return {
    searchElapsedMs,
    setSearchElapsedMs,
    searchStartedAtRef,
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
    searchResultsScrollTop,
    setSearchResultsScrollTop,
    searchResultsFilterQuery,
    setSearchResultsFilterQuery,
    debouncedSearchResultsFilterQuery,
    setDebouncedSearchResultsFilterQuery,
    searchStatus,
    setSearchStatus,
    searchError,
    setSearchError,
    searchStartedLive,
    setSearchStartedLive,
    searchTruncated,
    setSearchTruncated,
    searchPollTimeoutRef,
    searchSessionRef,
    searchJobIdRef,
    searchPointerIntentRef,
    searchCommittedQueryRef,
    searchDraftQueryRef,
    searchOriginPathRef,
    searchResultsRef,
    searchResultsVisibleRef,
    searchResultsSortByRef,
    searchResultsSortDirectionRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
  };
}
