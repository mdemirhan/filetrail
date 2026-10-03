import { useEffect, useMemo, useRef, useState } from "react";

import type { IpcResponse } from "@filetrail/contracts";
import type {
  SearchMatchScopePreference,
  SearchPatternModePreference,
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";

import { useElementSize } from "../hooks/useElementSize";
import { useRelativeDate } from "../hooks/useRelativeDate";
import {
  ClipboardMarkIcon,
  clipboardMarkClassName,
  useClipboardMarks,
} from "../lib/clipboardMarks";
import { isSelectionNarrowingClick } from "../lib/contentSelection";
import type { DirectoryEntryMetadata } from "../lib/explorerTypes";
import { FileIcon } from "../lib/fileIcons";
import { isKeyboardOwnedFormControl } from "../lib/focusedEditTarget";
import { formatSize, splitDisplayName } from "../lib/formatting";
import { resolveSearchResultsColumnLayout } from "../lib/responsiveLayout";
import { isTypeaheadCharacterKey } from "../lib/typeahead";
import { getVirtualRange } from "../lib/virtualization";
import { SearchOptionsMenu } from "./SearchOptionsMenu";
import { SortIndicator } from "./SortIndicator";
type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];
type SearchStatus = IpcResponse<"search:getUpdate">["status"] | "idle";
type SelectionGestureModifiers = {
  metaKey: boolean;
  shiftKey: boolean;
};

// This constant is shared with App-level paged navigation. Any row-density change must
// update this value so virtualization, reveal-into-view, and Ctrl+U / Ctrl+D selection
// movement continue to agree on the same physical row extent.
export const SEARCH_RESULT_ROW_HEIGHT = 28;

export type SearchScopeOption = { path: string; label: string };

export function SearchResultsPane({
  paneRef,
  isFocused,
  rootPath,
  query,
  status,
  results,
  selectedPaths = [],
  selectionLeadPath = null,
  highlightHoveredItems = true,
  error,
  truncated,
  errorIsQuiet = false,
  totalCount,
  sortBy,
  sortDirection,
  elapsedMs = null,
  scopeOptions = [],
  onScopeChange = () => undefined,
  patternMode = "text",
  onPatternModeChange = () => undefined,
  matchScope = "name",
  onMatchScopeChange = () => undefined,
  recursive = true,
  skipGitFolders = true,
  onSkipGitFoldersChange = () => undefined,
  skipGitIgnored = false,
  onSkipGitIgnoredChange = () => undefined,
  onRecursiveChange = () => undefined,
  onStopSearch,
  onClearResults,
  onCloseResults,
  onSortColumn,
  metadataByPath = {},
  onVisiblePathsChange,
  onSelectPath,
  onSelectionGesture = (path) => onSelectPath?.(path),
  onClearSelection = () => undefined,
  onActivateResult,
  onItemContextMenu = () => undefined,
  onItemDragStart,
  onItemDragEnd,
  onFocusChange,
  onTypeaheadInput,
  filterQuery = "",
  onFilterQueryChange = () => undefined,
  scrollTop = 0,
  onScrollTopChange = () => undefined,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  rootPath: string;
  query: string;
  status: SearchStatus;
  results: SearchResultItem[];
  selectedPaths?: string[];
  selectionLeadPath?: string | null;
  highlightHoveredItems?: boolean;
  error: string | null;
  truncated: boolean;
  /** The search was started by typing: a pattern that does not parse yet is not a failure. */
  errorIsQuiet?: boolean;
  totalCount: number;
  sortBy: SearchResultsSortByPreference;
  sortDirection: SearchResultsSortDirectionPreference;
  elapsedMs?: number | null;
  // Finder-style scope bar: where the search runs and how the pattern is matched.
  scopeOptions?: SearchScopeOption[];
  onScopeChange?: (rootPath: string) => void;
  patternMode?: SearchPatternModePreference;
  onPatternModeChange?: (value: SearchPatternModePreference) => void;
  matchScope?: SearchMatchScopePreference;
  onMatchScopeChange?: (value: SearchMatchScopePreference) => void;
  recursive?: boolean;
  skipGitFolders?: boolean;
  onSkipGitFoldersChange?: (value: boolean) => void;
  skipGitIgnored?: boolean;
  onSkipGitIgnoredChange?: (value: boolean) => void;
  onRecursiveChange?: (value: boolean) => void;
  onStopSearch: () => void;
  onClearResults: () => void;
  onCloseResults: () => void;
  // Clicking a column header sorts by it immediately (again to reverse).
  onSortColumn: (value: SearchResultsSortByPreference) => void;
  // Modified date and size for visible results, loaded lazily by the parent.
  metadataByPath?: Record<string, DirectoryEntryMetadata>;
  onVisiblePathsChange?: ((paths: string[]) => void) | undefined;
  onSelectPath?: (path: string) => void;
  onSelectionGesture?: (path: string, modifiers: SelectionGestureModifiers) => void;
  onClearSelection?: () => void;
  onActivateResult: (item: SearchResultItem, inNewTab?: boolean) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  onItemDragStart?:
    | ((item: SearchResultItem, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragEnd?: ((event: React.DragEvent<HTMLElement>) => void) | undefined;
  onFocusChange: (focused: boolean) => void;
  onTypeaheadInput?: (key: string) => void;
  /**
   * The text of the filter field; `results` already are the matching ones. Typing in the
   * results list goes into the same filter.
   */
  filterQuery?: string;
  onFilterQueryChange?: (value: string) => void;
  scrollTop?: number;
  onScrollTopChange?: (value: number) => void;
}) {
  const clipboardMarks = useClipboardMarks("content");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { width, height } = useElementSize(scrollRef);
  const columnLayout = resolveSearchResultsColumnLayout(width);
  const [internalScrollTop, setInternalScrollTop] = useState(scrollTop);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  // `scrollTop` is controlled by App so search results can preserve/restore position when
  // the pane is hidden and shown again. We still mirror the DOM value locally because
  // virtualization needs an immediate number on every scroll frame.
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

  // Keep the lead selection visible when keyboard navigation or typeahead changes it.
  // This uses the same fixed row extent as virtualization and paged navigation.
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
  const visiblePathsKey = visibleResults.map((result) => result.path).join("\0");
  const highlightPattern = useMemo(
    () => buildHighlightPattern(query, patternMode, matchScope),
    [matchScope, patternMode, query],
  );

  useEffect(() => {
    if (!onVisiblePathsChange || visiblePathsKey.length === 0) {
      return;
    }
    onVisiblePathsChange(visiblePathsKey.split("\0"));
  }, [onVisiblePathsChange, visiblePathsKey]);

  return (
    <section
      ref={paneRef}
      className="content-pane pane pane-focus-target search-results-pane"
      data-columns={columnLayout}
      data-searching={isSearching ? "true" : "false"}
      tabIndex={-1}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onFocusChange(false);
        }
      }}
      // Search mode reuses the same app-level typeahead state as list/details view.
      // Capture printable keys here so focusable controls inside the pane do not swallow
      // them before selection typeahead sees them.
      onKeyDownCapture={(event) => {
        if (!onTypeaheadInput) {
          return;
        }
        const target = event.target;
        if (isKeyboardOwnedFormControl(target)) {
          return;
        }
        // `?` is reserved as the global Help shortcut and should not be consumed by search
        // result typeahead when focus is in the pane body.
        if (event.key === "?") {
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
        <div className="search-scope-bar" role="toolbar" aria-label="Search scope">
          <span className="search-scope-label">Search:</span>
          {scopeOptions.map((option) => (
            <button
              key={option.path}
              type="button"
              className={`search-scope-button${option.path === rootPath ? " active" : ""}`}
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
          <span className="search-scope-spacer" />
          {/* Narrows what the search found, without searching again. */}
          <div className="search-results-filter">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="search-results-filter-icon">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            <input
              type="text"
              className="search-results-filter-input"
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
                    scrollRef.current?.focus({ preventScroll: true });
                  }
                  return;
                }
                if (event.key === "Enter" || event.key === "ArrowDown") {
                  event.preventDefault();
                  scrollRef.current?.focus({ preventScroll: true });
                }
              }}
              placeholder="Filter by name or folder"
              spellCheck={false}
              autoComplete="off"
              aria-label="Filter results"
            />
            {filterQuery.length > 0 ? (
              <button
                type="button"
                className="search-results-filter-clear"
                aria-label="Clear filter"
                title="Clear Filter (Esc)"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onFilterQueryChange("")}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            ) : null}
          </div>
          {/* The same menu as the magnifier in the toolbar search field. */}
          <SearchOptionsMenu
            trigger="label"
            interactive
            patternMode={patternMode}
            onPatternModeChange={onPatternModeChange}
            matchScope={matchScope}
            onMatchScopeChange={onMatchScopeChange}
            recursive={recursive}
            onRecursiveChange={onRecursiveChange}
            skipGitFolders={skipGitFolders}
            onSkipGitFoldersChange={onSkipGitFoldersChange}
            skipGitIgnored={skipGitIgnored}
            onSkipGitIgnoredChange={onSkipGitIgnoredChange}
          />
          {isSearching ? (
            <button
              type="button"
              className="search-scope-action"
              onClick={onStopSearch}
              aria-label="Stop search"
              title="Stop Search"
            >
              <span className="search-results-spinner" aria-hidden="true" />
              Stop
            </button>
          ) : null}
          <button
            type="button"
            className="search-scope-action"
            onClick={onCloseResults}
            aria-label="Close search results"
            title="Close Search Results (Esc)"
          >
            Done
          </button>
        </div>
        <div className="search-results-columns">
          {(["name", "path"] as const).map((column) => {
            const active = sortBy === column;
            return (
              <button
                key={column}
                type="button"
                className={`search-results-column${active ? " active" : ""}`}
                aria-label={`Sort by ${column === "name" ? "name" : "folder"}`}
                aria-pressed={active}
                onClick={() => onSortColumn(column)}
              >
                {column === "name" ? "Name" : "Folder"}
                {active ? <SortIndicator direction={sortDirection} /> : null}
              </button>
            );
          })}
          <span className="search-results-column search-results-column-static">Date Modified</span>
          <span className="search-results-column search-results-column-static search-results-column-size">
            Size
          </span>
        </div>
      </div>
      <div className="search-results-body">
        <div
          ref={scrollRef}
          className="content-scroll search-results-scroll"
          data-hover-highlight-enabled={highlightHoveredItems ? "true" : "false"}
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
          {error && errorIsQuiet ? (
            <div className="content-state content-empty">
              <strong className="empty-state-title">Incomplete pattern</strong>
              <span className="empty-state-message">
                Keep typing, or press Return to see what is wrong with it.
              </span>
            </div>
          ) : null}
          {error && !errorIsQuiet ? (
            <div className="content-state content-error">
              <strong>Search failed</strong>
              <span>{error}</span>
            </div>
          ) : null}
          {status === "running" && results.length === 0 ? (
            <div className="content-state content-loading">
              <strong>Searching…</strong>
            </div>
          ) : null}
          {status !== "running" && results.length === 0 && totalCount > 0 && !error ? (
            <div className="content-state content-empty">
              <strong className="empty-state-title">No results match “{filterQuery}”</strong>
              <span className="empty-state-message">
                Nothing found has that in its name or folder. Press Esc to see all the results.
              </span>
            </div>
          ) : null}
          {status !== "running" && results.length === 0 && totalCount === 0 && !error ? (
            <div className="content-state content-empty">
              <strong className="empty-state-title">No matches</strong>
              <span className="empty-state-message">
                Try other text, or another location above.
              </span>
            </div>
          ) : null}
          {results.length > 0 ? (
            <div
              style={{
                // Virtualization pads out the hidden rows above/below the visible slice.
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
                  }${clipboardMarkClassName(clipboardMarks, result.path)}`}
                  data-selectable-entry-path={result.path}
                  draggable={Boolean(onItemDragStart)}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    if (event.metaKey || event.shiftKey || !selectedPathSet.has(result.path)) {
                      onSelectionGesture(result.path, {
                        metaKey: event.metaKey,
                        shiftKey: event.shiftKey,
                      });
                    }
                    scrollRef.current?.focus();
                  }}
                  onClick={(event) => {
                    if (
                      isSelectionNarrowingClick(
                        event,
                        selectedPaths.length,
                        selectedPathSet.has(result.path),
                      )
                    ) {
                      onSelectionGesture(result.path, { metaKey: false, shiftKey: false });
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    scrollRef.current?.focus();
                    onItemContextMenu(result.path, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onDragStart={(event) => onItemDragStart?.(result, event)}
                  onDragEnd={(event) => onItemDragEnd?.(event)}
                  onDoubleClick={(event) => onActivateResult(result, event.metaKey)}
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
                  {clipboardMarks?.paths.has(result.path) ? (
                    <span className="clipboard-mark-name">
                      <FileNameLabel
                        className="search-result-name"
                        name={result.name}
                        extension={result.extension}
                        highlightPattern={highlightPattern}
                      />
                      <ClipboardMarkIcon marks={clipboardMarks} path={result.path} />
                    </span>
                  ) : (
                    <FileNameLabel
                      className="search-result-name"
                      name={result.name}
                      extension={result.extension}
                      highlightPattern={highlightPattern}
                    />
                  )}
                  <span className="search-result-path">
                    {formatResultFolder(result.relativeParentPath, rootPath)}
                  </span>
                  <ResultModified value={metadataByPath[result.path]?.modifiedAt} />
                  <span className="search-result-meta search-result-size">
                    {formatResultSize(result, metadataByPath[result.path])}
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

// Highlights what matched in the name for name searches. fd uses smart case (case-sensitive
// only when the query has uppercase); glob patterns match the whole name, so they are not
// highlighted. Patterns JavaScript cannot parse are simply not highlighted.
export function buildHighlightPattern(
  query: string,
  patternMode: SearchPatternModePreference,
  matchScope: SearchMatchScopePreference,
): RegExp | null {
  const trimmed = query.trim();
  if (trimmed.length === 0 || patternMode === "glob" || matchScope !== "name") {
    return null;
  }
  const source = patternMode === "text" ? trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : trimmed;
  try {
    return new RegExp(source, /\p{Lu}/u.test(trimmed) ? "" : "i");
  } catch {
    return null;
  }
}

function renderHighlighted(
  text: string,
  offset: number,
  range: { start: number; end: number } | null,
) {
  if (!range) {
    return text;
  }
  const start = Math.max(0, range.start - offset);
  const end = Math.min(text.length, range.end - offset);
  if (start >= end) {
    return text;
  }
  return (
    <>
      {text.slice(0, start)}
      <mark className="search-result-match">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

// Empty until the row's metadata has loaded.
function ResultModified({ value }: { value: string | null | undefined }) {
  const date = useRelativeDate(value);
  return (
    <span className="search-result-meta" title={date?.exact}>
      {date?.text ?? ""}
    </span>
  );
}

function formatResultSize(
  result: SearchResultItem,
  metadata: DirectoryEntryMetadata | undefined,
): string {
  if (result.kind === "directory" || result.kind === "symlink_directory") {
    return "—";
  }
  return metadata?.sizeStatus === "ready" ? formatSize(metadata.sizeBytes, "ready") : "";
}

// Results show the containing folder relative to the search root, with › separators.
function formatResultFolder(relativeParentPath: string, rootPath: string): string {
  if (relativeParentPath === "." || relativeParentPath.length === 0) {
    const rootName = rootPath.split("/").filter(Boolean).at(-1);
    return rootName ?? "Macintosh HD";
  }
  return relativeParentPath.split("/").filter(Boolean).join(" › ");
}

function FileNameLabel({
  className,
  name,
  extension,
  highlightPattern = null,
}: {
  className: string;
  name: string;
  extension: string;
  highlightPattern?: RegExp | null;
}) {
  const { stem, extensionSuffix } = splitDisplayName(name, extension);
  // The match is found in the full name, then drawn across the stem and extension parts.
  const match = highlightPattern ? highlightPattern.exec(`${stem}${extensionSuffix}`) : null;
  const range =
    match && match[0].length > 0
      ? { start: match.index, end: match.index + match[0].length }
      : null;

  return (
    <span className={className}>
      <span className="truncated-name-stem">{renderHighlighted(stem, 0, range)}</span>
      {extensionSuffix ? (
        <span className="truncated-name-extension">
          {renderHighlighted(extensionSuffix, stem.length, range)}
        </span>
      ) : null}
    </span>
  );
}
