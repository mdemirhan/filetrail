import { useEffect, useMemo, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";
import type {
  SearchResultsFilterScopePreference,
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";

import { useElementSize } from "../hooks/useElementSize";
import { FileIcon } from "../lib/fileIcons";
import { splitDisplayName } from "../lib/formatting";
import { isTypeaheadCharacterKey } from "../lib/typeahead";
import { getVirtualRange } from "../lib/virtualization";
import { ToolbarIcon } from "./ToolbarIcon";
type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";
type SelectionGestureModifiers = {
  metaKey: boolean;
  shiftKey: boolean;
};

export const SEARCH_RESULT_ROW_HEIGHT = 50;

export function SearchResultsPane({
  paneRef,
  isFocused,
  rootPath,
  query,
  status,
  results,
  selectedPath = "",
  selectedPaths = selectedPath ? [selectedPath] : [],
  selectionLeadPath = selectedPath || null,
  error,
  truncated,
  filterQuery,
  filterScope,
  totalCount,
  sortBy,
  sortDirection,
  onStopSearch,
  onClearResults,
  onCloseResults,
  onFilterQueryChange,
  onFilterScopeChange,
  onSortByChange,
  onSortDirectionToggle,
  onApplySort,
  onSelectPath,
  onSelectionGesture = (path) => onSelectPath?.(path),
  onClearSelection = () => undefined,
  onActivateResult,
  onItemContextMenu = () => undefined,
  onFocusChange,
  onTypeaheadInput,
  typeaheadQuery,
  scrollTop = 0,
  onScrollTopChange = () => undefined,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  rootPath: string;
  query: string;
  status: SearchStatus;
  results: SearchResultItem[];
  selectedPath?: string;
  selectedPaths?: string[];
  selectionLeadPath?: string | null;
  error: string | null;
  truncated: boolean;
  filterQuery: string;
  filterScope: SearchResultsFilterScopePreference;
  totalCount: number;
  sortBy: SearchResultsSortByPreference;
  sortDirection: SearchResultsSortDirectionPreference;
  onStopSearch: () => void;
  onClearResults: () => void;
  onCloseResults: () => void;
  onFilterQueryChange: (value: string) => void;
  onFilterScopeChange: (value: SearchResultsFilterScopePreference) => void;
  onSortByChange: (value: SearchResultsSortByPreference) => void;
  onSortDirectionToggle: () => void;
  onApplySort: () => void;
  onSelectPath?: (path: string) => void;
  onSelectionGesture?: (path: string, modifiers: SelectionGestureModifiers) => void;
  onClearSelection?: () => void;
  onActivateResult: (item: SearchResultItem) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  onFocusChange: (focused: boolean) => void;
  onTypeaheadInput?: (key: string) => void;
  typeaheadQuery?: string;
  scrollTop?: number;
  onScrollTopChange?: (value: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { height } = useElementSize(scrollRef);
  const [internalScrollTop, setInternalScrollTop] = useState(scrollTop);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  useEffect(() => {
    if (scrollRef.current) {
      if (Math.abs(scrollRef.current.scrollTop - scrollTop) > 1) {
        scrollRef.current.scrollTop = scrollTop;
      }
      setInternalScrollTop(scrollRef.current.scrollTop);
      return;
    }
    setInternalScrollTop(scrollTop);
  }, [scrollTop]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !selectionLeadPath) {
      return;
    }
    const selectedIndex = results.findIndex((result) => result.path === selectionLeadPath);
    if (selectedIndex < 0) {
      return;
    }
    const viewportSize = Math.max(SEARCH_RESULT_ROW_HEIGHT, container.clientHeight || height);
    const currentScrollTop = container.scrollTop;
    const itemTop = selectedIndex * SEARCH_RESULT_ROW_HEIGHT;
    const itemBottom = itemTop + SEARCH_RESULT_ROW_HEIGHT;
    let nextScrollTop = currentScrollTop;
    if (itemTop < currentScrollTop) {
      nextScrollTop = itemTop;
    } else if (itemBottom > currentScrollTop + viewportSize) {
      nextScrollTop = itemBottom - viewportSize;
    }
    if (Math.abs(nextScrollTop - currentScrollTop) <= 1) {
      return;
    }
    container.scrollTop = nextScrollTop;
    setInternalScrollTop(nextScrollTop);
    onScrollTopChange(nextScrollTop);
  }, [height, onScrollTopChange, results, selectionLeadPath]);

  const range = useMemo(
    () =>
      getVirtualRange({
        itemCount: results.length,
        itemSize: SEARCH_RESULT_ROW_HEIGHT,
        viewportSize: height,
        scrollOffset: internalScrollTop,
        overscan: 8,
      }),
    [height, internalScrollTop, results.length],
  );
  const visibleResults = results.slice(range.startIndex, range.endIndex);
  const isSearching = status === "running";

  return (
    <section
      ref={paneRef}
      className="content-pane pane pane-focus-target search-results-pane"
      data-searching={isSearching ? "true" : "false"}
      tabIndex={-1}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onFocusChange(false);
        }
      }}
      onKeyDownCapture={(event) => {
        if (!onTypeaheadInput) {
          return;
        }
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return;
        }
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.altKey ||
          !isTypeaheadCharacterKey(event.key)
        ) {
          return;
        }
        event.preventDefault();
        onTypeaheadInput(event.key);
      }}
    >
      <div
        className={`pane-header content-header search-results-header${
          isFocused ? " pane-header-focused" : ""
        }`}
        onMouseDownCapture={(event) => {
          const target = event.target;
          if (
            target instanceof HTMLElement &&
            target.closest("button, input, select, textarea, a, [role='button']")
          ) {
            return;
          }
          event.preventDefault();
          scrollRef.current?.focus({ preventScroll: true });
        }}
      >
        <div className="search-results-bar search-results-bar-primary">
          <button
            type="button"
            className="search-results-close-button"
            onClick={onCloseResults}
            aria-label="Close search results"
            title="Close search results"
          >
            <CloseGlyph />
            Close
          </button>
          <button
            type="button"
            className="search-results-clear-button"
            onClick={onClearResults}
            aria-label="Clear search results"
            title="Clear search results"
          >
            <ClearGlyph />
            Clear
          </button>
          {isSearching ? (
            <button
              type="button"
              className="search-results-stop-button"
              onClick={onStopSearch}
              aria-label="Stop search"
              title="Stop current search"
            >
              <StopGlyph />
              Stop
            </button>
          ) : null}
          <div className="search-results-status-block">
            {isSearching ? <span className="search-results-spinner" aria-hidden="true" /> : null}
            <span
              className={`search-results-status-label${
                isSearching ? " search-results-status-label-searching" : ""
              }`}
            >
              {isSearching ? "Searching" : "Results"}
            </span>
          </div>
          <span className="search-results-query-badge" title={query}>
            {query}
          </span>
          <span className="search-results-root" title={rootPath}>
            {rootPath}
          </span>
        </div>
        <div className="search-results-bar search-results-bar-secondary">
          <div className="search-results-sort-group">
            <button
              type="button"
              className="search-results-sort-toggle"
              onClick={onSortDirectionToggle}
              title={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
              aria-label={sortDirection === "asc" ? "Ascending sort" : "Descending sort"}
            >
              <ToolbarIcon name={sortDirection === "asc" ? "sortAsc" : "sortDesc"} />
            </button>
            <span className="search-results-group-separator" aria-hidden="true" />
            <select
              className="search-results-compact-select"
              value={sortBy}
              onChange={(event) =>
                onSortByChange(event.currentTarget.value as SearchResultsSortByPreference)
              }
              title="Sort search results by"
              aria-label="Sort search results by"
            >
              <option value="path">Path</option>
              <option value="name">Name</option>
            </select>
            <span className="search-results-group-separator" aria-hidden="true" />
            <button
              type="button"
              className="search-results-apply-button"
              onClick={onApplySort}
              title="Apply the selected sort to the current search results (Cmd+R)"
              aria-label="Apply the selected sort to the current search results"
            >
              <RefreshGlyph />
              Apply Sort
            </button>
          </div>
          <div className="search-results-filter-group">
            <div className="search-results-filter-input-region">
              <span className="search-results-filter-icon" aria-hidden="true">
                <SearchGlyph />
              </span>
              <input
                type="text"
                className="search-results-filter-input"
                value={filterQuery}
                onChange={(event) => onFilterQueryChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  scrollRef.current?.focus({ preventScroll: true });
                }}
                placeholder="Filter results…"
                spellCheck={false}
                aria-label="Filter search results"
              />
              {filterQuery.length > 0 ? (
                <button
                  type="button"
                  className="search-results-filter-clear"
                  aria-label="Clear result filter"
                  title="Clear result filter"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => onFilterQueryChange("")}
                >
                  <CloseGlyph />
                </button>
              ) : null}
            </div>
            <span className="search-results-group-separator" aria-hidden="true" />
            <select
              className="search-results-compact-select"
              value={filterScope}
              onChange={(event) =>
                onFilterScopeChange(event.currentTarget.value as SearchResultsFilterScopePreference)
              }
              title="Filter search results by"
              aria-label="Filter search results by"
            >
              <option value="name">Name</option>
              <option value="path">Path</option>
            </select>
          </div>
        </div>
      </div>
      <div className="search-results-body">
        {typeaheadQuery ? (
          <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
            <span className="pane-typeahead-label">Select</span>
            <span className="pane-typeahead-value">{typeaheadQuery}</span>
          </div>
        ) : null}
        <div
          ref={scrollRef}
          className="content-scroll search-results-scroll"
          tabIndex={-1}
          onMouseDown={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-selectable-entry-path]")) {
              return;
            }
            onClearSelection();
            scrollRef.current?.focus();
          }}
          onContextMenu={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-selectable-entry-path]")) {
              return;
            }
            event.preventDefault();
            onClearSelection();
            scrollRef.current?.focus();
            onItemContextMenu(null, {
              x: event.clientX,
              y: event.clientY,
            });
          }}
          onScroll={(event) => {
            const nextScrollTop = event.currentTarget.scrollTop;
            setInternalScrollTop(nextScrollTop);
            onScrollTopChange(nextScrollTop);
          }}
        >
          {truncated ? (
            <div className="search-results-banner">Showing the first 20,000 matches.</div>
          ) : null}
          {error ? (
            <div className="content-state content-error">
              <strong>Search failed</strong>
              <span>{error}</span>
            </div>
          ) : null}
          {status === "running" && results.length === 0 ? (
            <div className="content-state content-loading">
              <strong>Searching files</strong>
              <span>Running bundled fd in the current folder…</span>
            </div>
          ) : null}
          {status !== "running" && results.length === 0 && totalCount > 0 && !error ? (
            <div className="content-state content-empty">
              <strong className="empty-state-title">No matching filtered results</strong>
              <span className="empty-state-message">Try a different filter or clear it.</span>
            </div>
          ) : null}
          {status !== "running" && results.length === 0 && totalCount === 0 && !error ? (
            <div className="content-state content-empty">
              <strong className="empty-state-title">No matching files</strong>
              <span className="empty-state-message">
                Press Enter with a different pattern to search again.
              </span>
            </div>
          ) : null}
          {results.length > 0 ? (
            <div
              style={{
                paddingTop: `${range.startIndex * SEARCH_RESULT_ROW_HEIGHT}px`,
                paddingBottom: `${Math.max(0, results.length - range.endIndex) * SEARCH_RESULT_ROW_HEIGHT}px`,
              }}
            >
              {visibleResults.map((result) => (
                <button
                  key={result.path}
                  type="button"
                  className={`search-result-row${selectedPathSet.has(result.path) ? " active" : ""}${
                    selectedPathSet.has(result.path) && !isFocused ? " inactive" : ""
                  }`}
                  data-selectable-entry-path={result.path}
                  draggable={false}
                  onClick={(event) => {
                    onSelectionGesture(result.path, {
                      metaKey: event.metaKey,
                      shiftKey: event.shiftKey,
                    });
                    scrollRef.current?.focus();
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    scrollRef.current?.focus();
                    onItemContextMenu(result.path, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onDoubleClick={() => onActivateResult(result)}
                  title={result.path}
                  aria-selected={selectedPathSet.has(result.path)}
                >
                  <FileIcon
                    entry={{
                      path: result.path,
                      name: result.name,
                      extension: result.extension,
                      kind: result.kind,
                      isHidden: result.isHidden,
                      isSymlink: result.isSymlink,
                    }}
                  />
                  <span className="search-result-copy">
                    <FileNameLabel
                      className="search-result-name"
                      name={result.name}
                      extension={result.extension}
                    />
                    <span className="search-result-path">
                      {result.relativeParentPath === "." ? "." : result.relativeParentPath}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-results-control-icon">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-results-stop-icon">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-results-search-icon">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

function ClearGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-results-control-icon">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

function RefreshGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="search-results-refresh-icon">
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function FileNameLabel({
  className,
  name,
  extension,
}: {
  className: string;
  name: string;
  extension: string;
}) {
  const { stem, extensionSuffix } = splitDisplayName(name, extension);

  return (
    <span className={className}>
      <span className="truncated-name-stem">{stem}</span>
      {extensionSuffix ? <span className="truncated-name-extension">{extensionSuffix}</span> : null}
    </span>
  );
}
