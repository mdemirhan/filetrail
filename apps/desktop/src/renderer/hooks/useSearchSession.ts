import { useEffect, useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import {
  DEFAULT_APP_PREFERENCES,
  type SearchResultsFilterScopePreference,
  type SearchResultsSortByPreference,
  type SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";
import { type ContentSelectionState, EMPTY_CONTENT_SELECTION } from "../lib/contentSelection";

type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
type SearchPatternMode = IpcRequest<"search:start">["patternMode"];
type SearchMatchScope = IpcRequest<"search:start">["matchScope"];
type SearchJobStatus = IpcResponse<"search:getUpdate">["status"];
type SearchResultsFilterScope = SearchResultsFilterScopePreference;
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
  const [searchIncludeHidden, setSearchIncludeHidden] = useState(
    DEFAULT_APP_PREFERENCES.searchIncludeHidden,
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
  const [searchResultsFilterScope, setSearchResultsFilterScope] =
    useState<SearchResultsFilterScope>(DEFAULT_APP_PREFERENCES.searchResultsFilterScope);
  const [searchStatus, setSearchStatus] = useState<SearchJobStatus | "idle">("idle");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const searchPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSessionRef = useRef(0);
  const searchJobIdRef = useRef<string | null>(null);
  const searchPointerIntentRef = useRef(false);
  const searchCommittedQueryRef = useRef("");
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
    searchIncludeHidden,
    setSearchIncludeHidden,
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
    searchResultsFilterScope,
    setSearchResultsFilterScope,
    searchStatus,
    setSearchStatus,
    searchError,
    setSearchError,
    searchTruncated,
    setSearchTruncated,
    searchPollTimeoutRef,
    searchSessionRef,
    searchJobIdRef,
    searchPointerIntentRef,
    searchCommittedQueryRef,
    searchResultsRef,
    searchResultsVisibleRef,
    searchResultsSortByRef,
    searchResultsSortDirectionRef,
    browseSelectionRef,
    cachedSearchSelectionRef,
  };
}
