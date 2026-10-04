import type { IpcResponse } from "@filetrail/contracts";

import { useDelayedFlag } from "../hooks/useDelayedFlag";
import { ClearButton } from "./ClearButton";
import { PushButton } from "./PushButton";

export type SearchScopeOption = { path: string; label: string };
export type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";

const SEARCH_STOP_DELAY_MS = 400;

// The bar above search results, as in Finder: where the search runs, a field that narrows
// what it found, Stop while it runs on, and Done. The results themselves are drawn by the
// folder's views (Icons, List, Compact List).
export function SearchBar({
  isFocused,
  rootPath,
  scopeOptions,
  onScopeChange,
  status,
  truncated,
  filterQuery,
  onFilterQueryChange,
  onFocusResults,
  onStopSearch,
  onCloseResults,
}: {
  isFocused: boolean;
  rootPath: string;
  scopeOptions: SearchScopeOption[];
  onScopeChange: (rootPath: string) => void;
  status: SearchStatus;
  truncated: boolean;
  /** The text of the filter field; typing in the results goes into it too. */
  filterQuery: string;
  onFilterQueryChange: (value: string) => void;
  /** Gives the keyboard back to the results (Return, ↓, or Esc in an empty field). */
  onFocusResults: () => void;
  onStopSearch: () => void;
  onCloseResults: () => void;
}) {
  // Most searches finish at once; Stop and its spinner come only for one that runs on.
  const showStop = useDelayedFlag(status === "running", SEARCH_STOP_DELAY_MS);
  return (
    <div
      className={`pane-header content-header search-results-header${
        isFocused ? " pane-header-focused" : ""
      }`}
    >
      <div className="search-scope-bar" role="toolbar" aria-label="Search scope">
        <span className="search-scope-label">Search:</span>
        {/* The places to search in, as a segmented control: one of them is always on. */}
        <div className="segmented search-scope-segmented">
          {scopeOptions.map((option) => (
            <button
              key={option.path}
              type="button"
              className={`segmented-item search-scope-button${
                option.path === rootPath ? " is-selected" : ""
              }`}
              aria-pressed={option.path === rootPath}
              title={option.path}
              onClick={() => {
                if (option.path !== rootPath) {
                  onScopeChange(option.path);
                }
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="search-scope-spacer" />
        {/* Narrows what the search found, without searching again. */}
        <div className="search-field search-results-filter">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="search-field-icon">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          <input
            type="text"
            className="search-field-input"
            value={filterQuery}
            onChange={(event) => onFilterQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                // Esc clears the filter first; with nothing to clear it returns to the list.
                event.preventDefault();
                event.stopPropagation();
                if (filterQuery.length > 0) {
                  onFilterQueryChange("");
                } else {
                  onFocusResults();
                }
                return;
              }
              if (event.key === "Enter" || event.key === "ArrowDown") {
                event.preventDefault();
                onFocusResults();
              }
            }}
            placeholder="Filter by name or folder"
            spellCheck={false}
            autoComplete="off"
            aria-label="Filter results"
          />
          {filterQuery.length > 0 ? (
            <ClearButton
              aria-label="Clear filter"
              title="Clear Filter (Esc)"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onFilterQueryChange("")}
            />
          ) : null}
        </div>
        {showStop ? (
          <PushButton
            className="is-small"
            onClick={onStopSearch}
            aria-label="Stop search"
            title="Stop Search"
          >
            <span className="spinner" aria-hidden="true" />
            Stop
          </PushButton>
        ) : null}
        <PushButton
          className="is-small"
          onClick={onCloseResults}
          aria-label="Close search results"
          title="Close Search Results (Esc)"
        >
          Done
        </PushButton>
      </div>
      {truncated ? (
        <div className="search-results-banner">Showing the first 20,000 matches.</div>
      ) : null}
    </div>
  );
}

// What the results' views show while they have no rows: how the search is going, or why
// it found nothing. Null once there are results to show.
export function SearchResultsState({
  status,
  shownCount,
  totalCount,
  error,
  errorIsQuiet,
  filterQuery,
}: {
  status: SearchStatus;
  shownCount: number;
  totalCount: number;
  error: string | null;
  /** A pattern that does not parse while it is being typed is not a failure yet. */
  errorIsQuiet: boolean;
  filterQuery: string;
}) {
  if (error && errorIsQuiet) {
    return (
      <div className="content-state content-empty">
        <strong className="empty-state-title">Incomplete pattern</strong>
        <span className="empty-state-message">
          Keep typing, or press Return to see what is wrong with it.
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="content-state content-error">
        <strong>Search failed</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (shownCount > 0) {
    return null;
  }
  if (status === "running") {
    return (
      <div className="content-state content-loading">
        <strong>Searching…</strong>
      </div>
    );
  }
  if (totalCount > 0) {
    return (
      <div className="content-state content-empty">
        <strong className="empty-state-title">No results match “{filterQuery}”</strong>
        <span className="empty-state-message">
          Nothing found has that in its name or folder. Press Esc to see all the results.
        </span>
      </div>
    );
  }
  return (
    <div className="content-state content-empty">
      <strong className="empty-state-title">No matches</strong>
      <span className="empty-state-message">Try other text, or another location above.</span>
    </div>
  );
}
