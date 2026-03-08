import { useMemo, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { useElementSize } from "../hooks/useElementSize";
import { FileIcon } from "../lib/fileIcons";
import { splitDisplayName } from "../lib/formatting";
import { getVirtualRange } from "../lib/virtualization";
import { ToolbarIcon } from "./ToolbarIcon";

type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";

const SEARCH_RESULT_ROW_HEIGHT = 52;

export function SearchResultsPane({
  paneRef,
  isFocused,
  rootPath,
  query,
  status,
  results,
  selectedPath,
  error,
  truncated,
  onStopSearch,
  onClearResults,
  onCloseResults,
  onSelectPath,
  onActivateResult,
  onFocusChange,
  typeaheadQuery,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  rootPath: string;
  query: string;
  status: SearchStatus;
  results: SearchResultItem[];
  selectedPath: string;
  error: string | null;
  truncated: boolean;
  onStopSearch: () => void;
  onClearResults: () => void;
  onCloseResults: () => void;
  onSelectPath: (path: string) => void;
  onActivateResult: (item: SearchResultItem) => void;
  onFocusChange: (focused: boolean) => void;
  typeaheadQuery?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { height } = useElementSize(scrollRef);
  const [scrollTop, setScrollTop] = useState(0);

  const range = useMemo(
    () =>
      getVirtualRange({
        itemCount: results.length,
        itemSize: SEARCH_RESULT_ROW_HEIGHT,
        viewportSize: height,
        scrollOffset: scrollTop,
        overscan: 8,
      }),
    [height, results.length, scrollTop],
  );
  const visibleResults = results.slice(range.startIndex, range.endIndex);

  return (
    <section
      ref={paneRef}
      className="content-pane pane pane-focus-target search-results-pane"
      tabIndex={-1}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onFocusChange(false);
        }
      }}
    >
      <div className={`pane-header content-header${isFocused ? " pane-header-focused" : ""}`}>
        <div className="search-results-titlebar">
          <span className="search-results-title">Search Results</span>
          <span className="search-results-query" title={query}>
            {query}
          </span>
          <span className="search-results-root" title={rootPath}>
            {rootPath}
          </span>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="content-scroll search-results-scroll"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div className="search-results-actions">
          <div className="search-results-actions-buttons">
            {status === "running" ? (
              <button type="button" className="search-results-action-button" onClick={onStopSearch}>
                <ToolbarIcon name="stop" />
                Stop
              </button>
            ) : null}
            <button type="button" className="search-results-action-button" onClick={onCloseResults}>
              <ToolbarIcon name="close" />
              Close
            </button>
            <button type="button" className="search-results-action-button" onClick={onClearResults}>
              <ToolbarIcon name="clear" />
              Clear
            </button>
          </div>
        </div>
        {typeaheadQuery ? (
          <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
            <span className="pane-typeahead-label">Select</span>
            <span className="pane-typeahead-value">{typeaheadQuery}</span>
          </div>
        ) : null}
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
        {status !== "running" && results.length === 0 && !error ? (
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
                className={`search-result-row${result.path === selectedPath ? " active" : ""}${
                  result.path === selectedPath && !isFocused ? " inactive" : ""
                }`}
                onClick={() => onSelectPath(result.path)}
                onDoubleClick={() => onActivateResult(result)}
                title={result.path}
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
    </section>
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
