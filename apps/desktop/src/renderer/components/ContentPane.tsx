import { useEffect, useMemo, useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import { useElementSize } from "../hooks/useElementSize";
import { FileIcon, FolderIcon } from "../lib/fileIcons";
import { formatDateTime, formatSize, splitDisplayName } from "../lib/formatting";
import { buildColumnMajorRows, getVirtualRange } from "../lib/virtualization";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];
type PathSuggestion = IpcResponse<"path:getSuggestions">["suggestions"][number];

const PATH_SUGGESTION_DEBOUNCE_MS = 350;
const FLOW_LIST_LAYOUT = {
  rowHeight: 44,
  rowGap: 4,
  itemWidth: 292,
  columnGap: 18,
  paddingTop: 10,
  paddingBottom: 10,
} as const;
const COMPACT_FLOW_LIST_LAYOUT = {
  rowHeight: 36,
  rowGap: 2,
  itemWidth: 292,
  columnGap: 18,
  paddingTop: 8,
  paddingBottom: 8,
} as const;
const DETAILS_LIST_LAYOUT = {
  rowHeight: 38,
} as const;

export function ContentPane({
  paneRef,
  isFocused,
  currentPath,
  entries,
  viewMode,
  loading,
  error,
  includeHidden,
  selectedPath,
  metadataByPath,
  sortBy,
  sortDirection,
  onSelectPath,
  onActivateEntry,
  onSortChange,
  onLayoutColumnsChange,
  onVisiblePathsChange,
  onNavigatePath,
  onRequestPathSuggestions,
  onFocusChange,
  onItemContextMenu = () => undefined,
  compactListView = false,
  tabSwitchesExplorerPanes = false,
  searchQuery = "",
  typeaheadQuery,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  currentPath: string;
  entries: DirectoryEntry[];
  viewMode: "list" | "details";
  loading: boolean;
  error: string | null;
  includeHidden: boolean;
  selectedPath: string;
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"];
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"];
  onSelectPath: (path: string) => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onNavigatePath: (path: string) => void;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
  onFocusChange: (focused: boolean) => void;
  onItemContextMenu?: (entry: DirectoryEntry, position: { x: number; y: number }) => void;
  compactListView?: boolean;
  tabSwitchesExplorerPanes?: boolean;
  searchQuery?: string;
  typeaheadQuery?: string;
}) {
  const [pathEditorOpen, setPathEditorOpen] = useState(false);
  const [draftPath, setDraftPath] = useState(currentPath);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const pathEditorShellRef = useRef<HTMLDivElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const segmentClickTimeoutRef = useRef<number | null>(null);
  const suggestionDebounceTimeoutRef = useRef<number | null>(null);
  const suggestionRequestRef = useRef(0);
  const pathEditorOpenRef = useRef(false);
  const pendingSuggestionInputRef = useRef("");
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const pathSegments = useMemo(() => buildPathSegments(currentPath), [currentPath]);
  const displayedPath = previewPath ?? draftPath;
  useEffect(() => {
    if (segmentClickTimeoutRef.current !== null) {
      window.clearTimeout(segmentClickTimeoutRef.current);
      segmentClickTimeoutRef.current = null;
    }
    if (suggestionDebounceTimeoutRef.current !== null) {
      window.clearTimeout(suggestionDebounceTimeoutRef.current);
      suggestionDebounceTimeoutRef.current = null;
    }
    setPathEditorOpen(false);
    setDraftPath(currentPath);
    setPreviewPath(null);
    setPathSuggestions([]);
    setHighlightedSuggestionIndex(-1);
    pendingSuggestionInputRef.current = "";
  }, [currentPath]);

  useEffect(() => {
    pathEditorOpenRef.current = pathEditorOpen;
    if (pathEditorOpen) {
      pathInputRef.current?.focus();
      const input = pathInputRef.current;
      if (input) {
        const caretPosition = currentPath.length;
        input.setSelectionRange(caretPosition, caretPosition);
      }
      scheduleSuggestionsRequest(currentPath);
      return;
    }
    if (suggestionDebounceTimeoutRef.current !== null) {
      window.clearTimeout(suggestionDebounceTimeoutRef.current);
      suggestionDebounceTimeoutRef.current = null;
    }
  }, [currentPath, pathEditorOpen]);

  useEffect(() => {
    if (!pathEditorOpen || previewPath === null) {
      return;
    }
    const input = pathInputRef.current;
    if (!input) {
      return;
    }
    const selectionStart = getSharedPrefixLength(draftPath, previewPath);
    const selectionEnd = previewPath.length;
    window.requestAnimationFrame(() => {
      if (document.activeElement !== input) {
        return;
      }
      input.setSelectionRange(selectionStart, selectionEnd);
    });
  }, [draftPath, pathEditorOpen, previewPath]);

  useEffect(
    () => () => {
      if (segmentClickTimeoutRef.current !== null) {
        window.clearTimeout(segmentClickTimeoutRef.current);
      }
      if (suggestionDebounceTimeoutRef.current !== null) {
        window.clearTimeout(suggestionDebounceTimeoutRef.current);
      }
    },
    [],
  );

  function scheduleSuggestionsRequest(inputPath: string): void {
    if (suggestionDebounceTimeoutRef.current !== null) {
      window.clearTimeout(suggestionDebounceTimeoutRef.current);
    }
    suggestionDebounceTimeoutRef.current = window.setTimeout(() => {
      suggestionDebounceTimeoutRef.current = null;
      void requestSuggestionsForInput(inputPath);
    }, PATH_SUGGESTION_DEBOUNCE_MS);
  }

  async function requestSuggestionsForInput(inputPath: string): Promise<void> {
    const requestedInput = inputPath;
    pendingSuggestionInputRef.current = requestedInput;
    const requestId = ++suggestionRequestRef.current;
    const response = await onRequestPathSuggestions(requestedInput).catch(() => null);
    if (!pathEditorOpenRef.current) {
      return;
    }
    if (suggestionRequestRef.current !== requestId) {
      return;
    }
    if (pendingSuggestionInputRef.current !== requestedInput) {
      return;
    }
    setPreviewPath(null);
    setHighlightedSuggestionIndex(-1);
    setPathSuggestions(response?.suggestions ?? []);
  }

  function acceptSuggestion(suggestion: PathSuggestion): void {
    const acceptedPath = suggestion.path.endsWith("/") ? suggestion.path : `${suggestion.path}/`;
    pendingSuggestionInputRef.current = acceptedPath;
    setDraftPath(acceptedPath);
    setPreviewPath(null);
    setPathSuggestions([]);
    setHighlightedSuggestionIndex(-1);
    scheduleSuggestionsRequest(acceptedPath);
  }

  function previewSuggestion(index: number): void {
    const suggestion = pathSuggestions[index];
    if (!suggestion) {
      return;
    }
    const previewPath = suggestion.path.endsWith("/") ? suggestion.path : `${suggestion.path}/`;
    setHighlightedSuggestionIndex(index);
    setPreviewPath(previewPath);
  }

  function clearPathSuggestions(): void {
    setPreviewPath(null);
    setPathSuggestions([]);
    setHighlightedSuggestionIndex(-1);
  }

  function focusPathSuggestion(index: number): void {
    const button =
      suggestionsRef.current?.querySelectorAll<HTMLButtonElement>(".pathbar-suggestion")[index];
    if (!button) {
      return;
    }
    previewSuggestion(index);
    button.focus();
  }

  return (
    <section
      ref={paneRef}
      className="content-pane pane pane-focus-target"
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
        {pathEditorOpen ? (
          <form
            className="pathbar-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              const nextPath =
                highlightedSuggestionIndex >= 0 && pathSuggestions[highlightedSuggestionIndex]
                  ? pathSuggestions[highlightedSuggestionIndex].path
                  : draftPath.trim();
              if (nextPath.length === 0) {
                return;
              }
              setPathEditorOpen(false);
              setPreviewPath(null);
              setPathSuggestions([]);
              setHighlightedSuggestionIndex(-1);
              pendingSuggestionInputRef.current = "";
              onNavigatePath(nextPath);
            }}
          >
            <div ref={pathEditorShellRef} className="pathbar-editor-shell">
              <input
                ref={pathInputRef}
                className="pathbar-input"
                aria-label="Current folder path"
                autoComplete="off"
                spellCheck={false}
                value={displayedPath}
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    nextTarget instanceof Node &&
                    suggestionsRef.current &&
                    suggestionsRef.current.contains(nextTarget)
                  ) {
                    return;
                  }
                  setDraftPath(currentPath);
                  clearPathSuggestions();
                  pendingSuggestionInputRef.current = "";
                  setPathEditorOpen(false);
                }}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  pendingSuggestionInputRef.current = nextValue;
                  clearPathSuggestions();
                  setDraftPath(nextValue);
                  scheduleSuggestionsRequest(nextValue);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (pathSuggestions.length > 0 || previewPath !== null) {
                      clearPathSuggestions();
                      return;
                    }
                    setDraftPath(currentPath);
                    clearPathSuggestions();
                    pendingSuggestionInputRef.current = "";
                    setPathEditorOpen(false);
                    return;
                  }
                  if (
                    (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                    pathSuggestions.length > 0
                  ) {
                    event.preventDefault();
                    const nextIndex =
                      highlightedSuggestionIndex < 0
                        ? event.key === "ArrowDown"
                          ? 0
                          : pathSuggestions.length - 1
                        : event.key === "ArrowDown"
                          ? (highlightedSuggestionIndex + 1) % pathSuggestions.length
                          : (highlightedSuggestionIndex - 1 + pathSuggestions.length) %
                            pathSuggestions.length;
                    previewSuggestion(nextIndex);
                    return;
                  }
                  if (
                    tabSwitchesExplorerPanes &&
                    event.key === "Tab" &&
                    pathSuggestions.length > 0
                  ) {
                    event.preventDefault();
                    focusPathSuggestion(event.shiftKey ? pathSuggestions.length - 1 : 0);
                  }
                }}
              />
              {pathSuggestions.length > 0 ? (
                <div
                  ref={suggestionsRef}
                  className="pathbar-suggestions"
                  aria-label="Path suggestions"
                >
                  {pathSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.path}
                      type="button"
                      className={`pathbar-suggestion${
                        pathSuggestions[highlightedSuggestionIndex]?.path === suggestion.path
                          ? " active"
                          : ""
                      }`}
                      onMouseEnter={() => {
                        const index = pathSuggestions.findIndex(
                          (item) => item.path === suggestion.path,
                        );
                        if (index >= 0) {
                          previewSuggestion(index);
                        }
                      }}
                      onFocus={() => {
                        const index = pathSuggestions.findIndex(
                          (item) => item.path === suggestion.path,
                        );
                        if (index >= 0) {
                          previewSuggestion(index);
                        }
                      }}
                      onKeyDown={(event) => {
                        const index = pathSuggestions.findIndex(
                          (item) => item.path === suggestion.path,
                        );
                        if (event.key === "Escape") {
                          event.preventDefault();
                          clearPathSuggestions();
                          pathInputRef.current?.focus();
                          return;
                        }
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                          event.preventDefault();
                          if (pathSuggestions.length === 0 || index < 0) {
                            return;
                          }
                          const nextIndex =
                            event.key === "ArrowDown"
                              ? (index + 1) % pathSuggestions.length
                              : (index - 1 + pathSuggestions.length) % pathSuggestions.length;
                          focusPathSuggestion(nextIndex);
                          return;
                        }
                        if (tabSwitchesExplorerPanes && event.key === "Tab") {
                          event.preventDefault();
                          pathInputRef.current?.focus();
                        }
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        acceptSuggestion(suggestion);
                      }}
                      title={suggestion.path}
                    >
                      <span className="pathbar-suggestion-name">{suggestion.name}</span>
                      <span className="pathbar-suggestion-path">{suggestion.path}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </form>
        ) : (
          <nav
            className="pathbar"
            aria-label="Folder path"
            onDoubleClick={() => setPathEditorOpen(true)}
          >
            {pathSegments.map((segment, index) => (
              <div key={segment.path} className="pathbar-item">
                {index > 0 ? <span className="pathbar-separator">›</span> : null}
                <button
                  type="button"
                  className={`pathbar-segment${index === pathSegments.length - 1 ? " active" : ""}`}
                  onClick={() => {
                    if (segmentClickTimeoutRef.current !== null) {
                      window.clearTimeout(segmentClickTimeoutRef.current);
                    }
                    segmentClickTimeoutRef.current = window.setTimeout(() => {
                      segmentClickTimeoutRef.current = null;
                      onNavigatePath(segment.path);
                    }, 180);
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (segmentClickTimeoutRef.current !== null) {
                      window.clearTimeout(segmentClickTimeoutRef.current);
                      segmentClickTimeoutRef.current = null;
                    }
                    setPathEditorOpen(true);
                  }}
                  title={segment.path}
                >
                  <span className="pathbar-segment-label">{segment.label}</span>
                </button>
              </div>
            ))}
          </nav>
        )}
      </div>
      {viewMode === "list" ? (
        <FlowListView
          key={currentPath}
          entries={entries}
          isFocused={isFocused}
          loading={loading}
          error={error}
          includeHidden={includeHidden}
          searchQuery={searchQuery}
          selectedPath={selectedPath}
          onActivateEntry={onActivateEntry}
          onLayoutColumnsChange={onLayoutColumnsChange}
          onSelectPath={onSelectPath}
          onVisiblePathsChange={onVisiblePathsChange}
          onItemContextMenu={onItemContextMenu}
          compactListView={compactListView}
          typeaheadQuery={typeaheadQuery ?? ""}
        />
      ) : (
        <DetailsView
          key={currentPath}
          entries={entries}
          isFocused={isFocused}
          loading={loading}
          error={error}
          includeHidden={includeHidden}
          searchQuery={searchQuery}
          metadataByPath={metadataByPath}
          selectedPath={selectedPath}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onActivateEntry={onActivateEntry}
          onSortChange={onSortChange}
          onLayoutColumnsChange={onLayoutColumnsChange}
          onSelectPath={onSelectPath}
          onVisiblePathsChange={onVisiblePathsChange}
          onItemContextMenu={onItemContextMenu}
          typeaheadQuery={typeaheadQuery ?? ""}
        />
      )}
    </section>
  );
}

function buildPathSegments(path: string): Array<{ label: string; path: string }> {
  if (path === "/") {
    return [{ label: "Macintosh HD", path: "/" }];
  }
  const parts = path.split("/").filter(Boolean);
  const segments = [{ label: "Macintosh HD", path: "/" }];
  let current = "";
  for (const part of parts) {
    current = `${current}/${part}`;
    segments.push({
      label: part,
      path: current,
    });
  }
  return segments;
}

function FlowListView({
  entries,
  isFocused,
  loading,
  error,
  includeHidden,
  searchQuery,
  selectedPath,
  onSelectPath,
  onActivateEntry,
  onLayoutColumnsChange,
  onVisiblePathsChange,
  onItemContextMenu = () => undefined,
  compactListView = false,
  typeaheadQuery,
}: {
  entries: DirectoryEntry[];
  isFocused: boolean;
  loading: boolean;
  error: string | null;
  includeHidden: boolean;
  searchQuery: string;
  selectedPath: string;
  onSelectPath: (path: string) => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onItemContextMenu?: (entry: DirectoryEntry, position: { x: number; y: number }) => void;
  compactListView?: boolean;
  typeaheadQuery?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { height } = useElementSize(containerRef);
  const [scrollTop, setScrollTop] = useState(0);
  const listLayout = compactListView ? COMPACT_FLOW_LIST_LAYOUT : FLOW_LIST_LAYOUT;
  const rowsPerColumn = Math.max(
    1,
    Math.floor(
      Math.max(
        height - (listLayout.paddingTop + listLayout.paddingBottom - listLayout.rowGap),
        listLayout.rowHeight,
      ) / listLayout.rowHeight,
    ),
  );
  const rows = useMemo(
    () => buildColumnMajorRows(entries, rowsPerColumn),
    [entries, rowsPerColumn],
  );
  const columnCount = Math.max(1, Math.ceil(entries.length / rowsPerColumn));
  const range = getVirtualRange({
    itemCount: rows.length,
    itemSize: listLayout.rowHeight,
    viewportSize: height,
    scrollOffset: scrollTop,
    overscan: 6,
  });
  const visibleRows = rows.slice(range.startIndex, range.endIndex);

  useEffect(() => {
    onVisiblePathsChange(visibleRows.flat().map((entry) => entry.path));
  }, [onVisiblePathsChange, visibleRows]);

  useEffect(() => {
    onLayoutColumnsChange(rowsPerColumn);
  }, [onLayoutColumnsChange, rowsPerColumn]);

  return (
    <div
      ref={containerRef}
      className={`content-scroll flow-list${compactListView ? " compact" : ""}`}
      tabIndex={-1}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onWheel={(event) => {
        if (event.ctrlKey || !containerRef.current) {
          return;
        }
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
          return;
        }
        event.preventDefault();
        containerRef.current.scrollLeft += event.deltaY;
      }}
    >
      {typeaheadQuery ? (
        <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
          <span className="pane-typeahead-label">Select</span>
          <span className="pane-typeahead-value">{typeaheadQuery}</span>
        </div>
      ) : null}
      <ContentState
        loading={loading}
        error={error}
        entriesLength={entries.length}
        includeHidden={includeHidden}
      />
      <div
        className="flow-grid-rows"
        style={{
          paddingTop: `${range.startIndex * listLayout.rowHeight}px`,
          paddingBottom: `${Math.max(0, rows.length - range.endIndex) * listLayout.rowHeight}px`,
          minWidth: `${
            columnCount * listLayout.itemWidth + Math.max(0, columnCount - 1) * listLayout.columnGap
          }px`,
        }}
      >
        {visibleRows.map((row, rowIndex) => (
          <div
            key={`${range.startIndex + rowIndex}-${row.at(0)?.path ?? "empty"}`}
            className="flow-grid"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, ${listLayout.itemWidth}px)`,
            }}
          >
            {row.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`flow-item${entry.path === selectedPath ? " active" : ""}${
                  entry.path === selectedPath && !isFocused ? " inactive" : ""
                }`}
                data-context-entry-path={entry.path}
                onClick={() => {
                  onSelectPath(entry.path);
                  containerRef.current?.focus();
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelectPath(entry.path);
                  containerRef.current?.focus();
                  onItemContextMenu(entry, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onDoubleClick={() => onActivateEntry(entry)}
                title={entry.name}
              >
                <FileIcon entry={entry} />
                <FileNameLabel
                  className="flow-item-label"
                  name={entry.name}
                  extension={entry.extension}
                />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailsView({
  entries,
  isFocused,
  loading,
  error,
  includeHidden,
  searchQuery,
  metadataByPath,
  selectedPath,
  sortBy,
  sortDirection,
  onSelectPath,
  onActivateEntry,
  onSortChange,
  onLayoutColumnsChange,
  onVisiblePathsChange,
  onItemContextMenu = () => undefined,
  typeaheadQuery,
}: {
  entries: DirectoryEntry[];
  isFocused: boolean;
  loading: boolean;
  error: string | null;
  includeHidden: boolean;
  searchQuery: string;
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  selectedPath: string;
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"];
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"];
  onSelectPath: (path: string) => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onItemContextMenu?: (entry: DirectoryEntry, position: { x: number; y: number }) => void;
  typeaheadQuery?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { height } = useElementSize(containerRef);
  const [scrollTop, setScrollTop] = useState(0);
  const range = getVirtualRange({
    itemCount: entries.length,
    itemSize: DETAILS_LIST_LAYOUT.rowHeight,
    viewportSize: height,
    scrollOffset: scrollTop,
    overscan: 10,
  });
  const visibleEntries = entries.slice(range.startIndex, range.endIndex);

  useEffect(() => {
    onVisiblePathsChange(visibleEntries.map((entry) => entry.path));
  }, [onVisiblePathsChange, visibleEntries]);

  useEffect(() => {
    onLayoutColumnsChange(1);
  }, [onLayoutColumnsChange]);

  return (
    <div className="details-wrapper">
      <div className="details-header">
        <SortButton
          label="Name"
          active={sortBy === "name"}
          direction={sortDirection}
          onClick={() => onSortChange("name")}
        />
        <SortButton
          label="Size"
          active={sortBy === "size"}
          direction={sortDirection}
          onClick={() => onSortChange("size")}
        />
        <SortButton
          label="Modified"
          accessibleLabel="Date Modified"
          active={sortBy === "modified"}
          direction={sortDirection}
          onClick={() => onSortChange("modified")}
        />
      </div>
      <div
        ref={containerRef}
        className="content-scroll details-scroll"
        tabIndex={-1}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {typeaheadQuery ? (
          <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
            <span className="pane-typeahead-label">Select</span>
            <span className="pane-typeahead-value">{typeaheadQuery}</span>
          </div>
        ) : null}
        <ContentState
          loading={loading}
          error={error}
          entriesLength={entries.length}
          includeHidden={includeHidden}
        />
        <div
          style={{
            paddingTop: `${range.startIndex * DETAILS_LIST_LAYOUT.rowHeight}px`,
            paddingBottom: `${
              Math.max(0, entries.length - range.endIndex) * DETAILS_LIST_LAYOUT.rowHeight
            }px`,
          }}
        >
          {visibleEntries.map((entry) => {
            const metadata = metadataByPath[entry.path];
            return (
              <button
                key={entry.path}
                type="button"
                className={`details-row${entry.path === selectedPath ? " active" : ""}${
                  entry.path === selectedPath && !isFocused ? " inactive" : ""
                }`}
                data-context-entry-path={entry.path}
                onClick={() => {
                  onSelectPath(entry.path);
                  containerRef.current?.focus();
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onSelectPath(entry.path);
                  containerRef.current?.focus();
                  onItemContextMenu(entry, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onDoubleClick={() => onActivateEntry(entry)}
                title={entry.path}
              >
                <span className="details-name">
                  <FileIcon entry={entry} />
                  <FileNameLabel
                    className="details-name-label"
                    name={entry.name}
                    extension={entry.extension}
                  />
                </span>
                <span>
                  {formatSize(metadata?.sizeBytes ?? null, metadata?.sizeStatus ?? "deferred")}
                </span>
                <span>{formatDateTime(metadata?.modifiedAt ?? null)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SortButton({
  label,
  accessibleLabel,
  active,
  direction,
  onClick,
}: {
  label: string;
  accessibleLabel?: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`details-header-button${active ? " active" : ""}`}
      onClick={onClick}
      aria-label={accessibleLabel ?? label}
    >
      <span>{label}</span>
      {active ? (
        <span className="details-sort-indicator">{direction === "asc" ? "↑" : "↓"}</span>
      ) : null}
    </button>
  );
}

function ContentState({
  loading,
  error,
  entriesLength,
  includeHidden,
}: {
  loading: boolean;
  error: string | null;
  entriesLength: number;
  includeHidden: boolean;
}) {
  if (loading && entriesLength === 0) {
    return (
      <div className="content-state content-loading">
        <strong>Loading folder</strong>
        <span>Fetching the visible directory snapshot…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="content-state content-error">
        <strong>Unable to open this folder</strong>
        <span>{error}</span>
      </div>
    );
  }
  if (entriesLength === 0) {
    return <EmptyState includeHidden={includeHidden} />;
  }
  return null;
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

function EmptyState({
  includeHidden,
}: {
  includeHidden: boolean;
}) {
  return (
    <div className="content-state content-empty">
      <div className="empty-state-icon" aria-hidden="true">
        <FolderIcon className="empty-state-folder-icon" />
      </div>
      <strong className="empty-state-title">This folder is empty</strong>
      <span className="empty-state-message">
        {includeHidden
          ? "This directory is empty."
          : "This directory is empty, or hidden files are currently filtered out."}
      </span>
    </div>
  );
}

function getSharedPrefixLength(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  let index = 0;
  while (index < maxLength && left[index] === right[index]) {
    index += 1;
  }
  return index;
}
