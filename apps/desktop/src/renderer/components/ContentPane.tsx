import { useEffect, useMemo, useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import { useElementSize } from "../hooks/useElementSize";
import { FileIcon } from "../lib/fileIcons";
import { formatDateTime, formatSize, splitDisplayName } from "../lib/formatting";
import { buildColumnMajorRows, getVirtualRange } from "../lib/virtualization";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];
type PathSuggestion = IpcResponse<"path:getSuggestions">["suggestions"][number];

const FLOW_ROW_HEIGHT = 44;
const DETAILS_ROW_HEIGHT = 38;
const FLOW_ITEM_WIDTH = 292;

export function ContentPane({
  paneRef,
  currentPath,
  entries,
  viewMode,
  loading,
  error,
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
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  currentPath: string;
  entries: DirectoryEntry[];
  viewMode: "list" | "details";
  loading: boolean;
  error: string | null;
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
}) {
  const [pathEditorOpen, setPathEditorOpen] = useState(false);
  const [draftPath, setDraftPath] = useState(currentPath);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const segmentClickTimeoutRef = useRef<number | null>(null);
  const suggestionRequestRef = useRef(0);
  const [pathSuggestions, setPathSuggestions] = useState<PathSuggestion[]>([]);
  const pathSegments = useMemo(() => buildPathSegments(currentPath), [currentPath]);

  useEffect(() => {
    if (segmentClickTimeoutRef.current !== null) {
      window.clearTimeout(segmentClickTimeoutRef.current);
      segmentClickTimeoutRef.current = null;
    }
    setPathEditorOpen(false);
    setDraftPath(currentPath);
    setPathSuggestions([]);
  }, [currentPath]);

  useEffect(() => {
    if (pathEditorOpen) {
      pathInputRef.current?.focus();
      pathInputRef.current?.select();
    }
  }, [pathEditorOpen]);

  useEffect(() => {
    if (!pathEditorOpen) {
      return;
    }
    const requestId = ++suggestionRequestRef.current;
    void onRequestPathSuggestions(draftPath)
      .then((response) => {
        if (suggestionRequestRef.current !== requestId) {
          return;
        }
        setPathSuggestions(response.suggestions);
      })
      .catch(() => {
        if (suggestionRequestRef.current !== requestId) {
          return;
        }
        setPathSuggestions([]);
      });
  }, [draftPath, onRequestPathSuggestions, pathEditorOpen]);

  useEffect(
    () => () => {
      if (segmentClickTimeoutRef.current !== null) {
        window.clearTimeout(segmentClickTimeoutRef.current);
      }
    },
    [],
  );

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
      <div className="pane-header content-header">
        {pathEditorOpen ? (
          <form
            className="pathbar-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              const nextPath = draftPath.trim();
              if (nextPath.length === 0) {
                return;
              }
              setPathEditorOpen(false);
              setPathSuggestions([]);
              onNavigatePath(nextPath);
            }}
          >
            <div className="pathbar-editor-shell">
              <input
                ref={pathInputRef}
                className="pathbar-input"
                aria-label="Current folder path"
                spellCheck={false}
                value={draftPath}
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
                  setPathSuggestions([]);
                  setPathEditorOpen(false);
                }}
                onChange={(event) => setDraftPath(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setDraftPath(currentPath);
                    setPathSuggestions([]);
                    setPathEditorOpen(false);
                    return;
                  }
                  if (event.key === "ArrowDown" && pathSuggestions.length > 0) {
                    event.preventDefault();
                    const nextSuggestion = pathSuggestions[0];
                    if (nextSuggestion) {
                      setDraftPath(nextSuggestion.path);
                    }
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
                      className="pathbar-suggestion"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDraftPath(suggestion.path);
                        setPathSuggestions([]);
                        setPathEditorOpen(false);
                        onNavigatePath(suggestion.path);
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
                  {segment.label}
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
          loading={loading}
          error={error}
          selectedPath={selectedPath}
          onActivateEntry={onActivateEntry}
          onLayoutColumnsChange={onLayoutColumnsChange}
          onSelectPath={onSelectPath}
          onVisiblePathsChange={onVisiblePathsChange}
        />
      ) : (
        <DetailsView
          key={currentPath}
          entries={entries}
          loading={loading}
          error={error}
          metadataByPath={metadataByPath}
          selectedPath={selectedPath}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onActivateEntry={onActivateEntry}
          onSortChange={onSortChange}
          onLayoutColumnsChange={onLayoutColumnsChange}
          onSelectPath={onSelectPath}
          onVisiblePathsChange={onVisiblePathsChange}
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
  loading,
  error,
  selectedPath,
  onSelectPath,
  onActivateEntry,
  onLayoutColumnsChange,
  onVisiblePathsChange,
}: {
  entries: DirectoryEntry[];
  loading: boolean;
  error: string | null;
  selectedPath: string;
  onSelectPath: (path: string) => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { height } = useElementSize(containerRef);
  const [scrollTop, setScrollTop] = useState(0);
  const rowsPerColumn = Math.max(
    1,
    Math.floor(Math.max(height - 24, FLOW_ROW_HEIGHT) / FLOW_ROW_HEIGHT),
  );
  const rows = useMemo(
    () => buildColumnMajorRows(entries, rowsPerColumn),
    [entries, rowsPerColumn],
  );
  const columnCount = Math.max(1, Math.ceil(entries.length / rowsPerColumn));
  const range = getVirtualRange({
    itemCount: rows.length,
    itemSize: FLOW_ROW_HEIGHT,
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
      className="content-scroll flow-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <ContentState loading={loading} error={error} entriesLength={entries.length} />
      <div
        className="flow-grid-rows"
        style={{
          paddingTop: `${range.startIndex * FLOW_ROW_HEIGHT}px`,
          paddingBottom: `${Math.max(0, rows.length - range.endIndex) * FLOW_ROW_HEIGHT}px`,
          minWidth: `${columnCount * FLOW_ITEM_WIDTH + Math.max(0, columnCount - 1) * 18}px`,
        }}
      >
        {visibleRows.map((row, rowIndex) => (
          <div
            key={`${range.startIndex + rowIndex}-${row.at(0)?.path ?? "empty"}`}
            className="flow-grid"
            style={{ gridTemplateColumns: `repeat(${columnCount}, ${FLOW_ITEM_WIDTH}px)` }}
          >
            {row.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`flow-item${entry.path === selectedPath ? " active" : ""}`}
                onClick={() => {
                  onSelectPath(entry.path);
                  containerRef.current?.focus();
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
  loading,
  error,
  metadataByPath,
  selectedPath,
  sortBy,
  sortDirection,
  onSelectPath,
  onActivateEntry,
  onSortChange,
  onLayoutColumnsChange,
  onVisiblePathsChange,
}: {
  entries: DirectoryEntry[];
  loading: boolean;
  error: string | null;
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  selectedPath: string;
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"];
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"];
  onSelectPath: (path: string) => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { height } = useElementSize(containerRef);
  const [scrollTop, setScrollTop] = useState(0);
  const range = getVirtualRange({
    itemCount: entries.length,
    itemSize: DETAILS_ROW_HEIGHT,
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
          label="Date Modified"
          active={sortBy === "modified"}
          direction={sortDirection}
          onClick={() => onSortChange("modified")}
        />
        <SortButton
          label="Kind"
          active={sortBy === "kind"}
          direction={sortDirection}
          onClick={() => onSortChange("kind")}
        />
        <SortButton
          label="Size"
          active={sortBy === "size"}
          direction={sortDirection}
          onClick={() => onSortChange("size")}
        />
      </div>
      <div
        ref={containerRef}
        className="content-scroll details-scroll"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <ContentState loading={loading} error={error} entriesLength={entries.length} />
        <div
          style={{
            paddingTop: `${range.startIndex * DETAILS_ROW_HEIGHT}px`,
            paddingBottom: `${Math.max(0, entries.length - range.endIndex) * DETAILS_ROW_HEIGHT}px`,
          }}
        >
          {visibleEntries.map((entry) => {
            const metadata = metadataByPath[entry.path];
            return (
              <button
                key={entry.path}
                type="button"
                className={`details-row${entry.path === selectedPath ? " active" : ""}`}
                onClick={() => onSelectPath(entry.path)}
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
                <span>{formatDateTime(metadata?.modifiedAt ?? null)}</span>
                <span>{metadata?.kindLabel ?? kindFallbackLabel(entry.kind)}</span>
                <span>
                  {formatSize(metadata?.sizeBytes ?? null, metadata?.sizeStatus ?? "deferred")}
                </span>
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
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`details-header-button${active ? " active" : ""}`}
      onClick={onClick}
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
}: {
  loading: boolean;
  error: string | null;
  entriesLength: number;
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
    return <EmptyState />;
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

function EmptyState() {
  return (
    <div className="content-state content-empty">
      <strong>Nothing here yet</strong>
      <span>This directory is empty, or hidden files are currently filtered out.</span>
    </div>
  );
}

function kindFallbackLabel(kind: DirectoryEntry["kind"]): string {
  if (kind === "directory") {
    return "Folder";
  }
  if (kind === "symlink_directory") {
    return "Alias Folder";
  }
  if (kind === "symlink_file") {
    return "Alias File";
  }
  if (kind === "file") {
    return "File";
  }
  return "Item";
}
