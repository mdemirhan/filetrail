import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import {
  type DetailColumnKey,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  DEFAULT_DETAIL_COLUMN_VISIBILITY,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  clampDetailColumnWidth,
} from "../../shared/appPreferences";
import { usePathSuggestions } from "../hooks/usePathSuggestions";
import { useElementSize } from "../hooks/useElementSize";
import { FileIcon, FolderIcon } from "../lib/fileIcons";
import { isKeyboardOwnedFormControl } from "../lib/focusedEditTarget";
import {
  DETAILS_LAYOUT,
  getDetailsRowHeight,
  getDetailsTableWidth,
  getVisibleDetailColumns,
} from "../lib/detailsLayout";
import {
  COMPACT_FLOW_LIST_LAYOUT,
  FLOW_LIST_LAYOUT,
  getFlowListRevealScrollLeft,
} from "../lib/flowListLayout";
import {
  formatDateTime,
  formatPermissionMode,
  formatSize,
  splitDisplayName,
} from "../lib/formatting";
import { isTypeaheadCharacterKey } from "../lib/typeahead";
import { buildColumnMajorRows, computeRowsPerColumn, getVirtualRange } from "../lib/virtualization";
import { PathSuggestionDropdown } from "./PathSuggestionDropdown";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type DirectoryEntryMetadata = IpcResponse<"directory:getMetadataBatch">["items"][number];
type PathbarSegment = { label: string; path: string };
type PathbarDisplayItem =
  | {
      kind: "segment";
      segment: PathbarSegment;
      isActive: boolean;
    }
  | {
      kind: "collapsed";
      key: string;
      hiddenCount: number;
    };

const PATHBAR_WIDTH_SAFETY_MARGIN = 12;
const PATHBAR_SEPARATOR_WIDTH = 16;
const PATHBAR_COLLAPSED_WIDTH = 34;
const PATHBAR_SEGMENT_HORIZONTAL_PADDING = 18;
const PATHBAR_MAX_SEGMENT_WIDTH = 220;
const PATHBAR_MAX_ACTIVE_SEGMENT_WIDTH = 320;
const PATHBAR_SEGMENT_CLICK_DELAY_MS = 320;
type SelectionGestureModifiers = {
  metaKey: boolean;
  shiftKey: boolean;
};

// `ContentPane` is the shared shell for list and details view. It owns path navigation,
// path suggestions, pane focus, and typeahead forwarding, then delegates actual entry
// rendering to the active layout implementation.
export function ContentPane({
  paneRef,
  isFocused,
  currentPath,
  entries,
  viewMode,
  loading,
  error,
  includeHidden,
  selectedPaths = [],
  selectionLeadPath = null,
  metadataByPath,
  sortBy,
  sortDirection,
  onSelectPath,
  onSelectionGesture = (path) => onSelectPath?.(path),
  onClearSelection = () => undefined,
  onActivateEntry,
  onSortChange,
  onLayoutColumnsChange,
  onVisiblePathsChange,
  onNavigatePath,
  onRequestPathSuggestions,
  onFocusChange,
  onTypeaheadInput,
  onItemContextMenu = () => undefined,
  compactListView = false,
  compactDetailsView = false,
  highlightHoveredItems = true,
  detailColumns = DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths = DEFAULT_DETAIL_COLUMN_WIDTHS,
  onDetailColumnWidthsChange = () => undefined,
  tabSwitchesExplorerPanes = false,
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
  selectedPaths?: string[];
  selectionLeadPath?: string | null;
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"];
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"];
  onSelectPath?: (path: string) => void;
  onSelectionGesture?: (path: string, modifiers: SelectionGestureModifiers) => void;
  onClearSelection?: () => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onNavigatePath: (path: string) => void;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
  onFocusChange: (focused: boolean) => void;
  onTypeaheadInput?: (key: string) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  compactListView?: boolean;
  compactDetailsView?: boolean;
  highlightHoveredItems?: boolean;
  detailColumns?: DetailColumnVisibility;
  detailColumnWidths?: DetailColumnWidths;
  onDetailColumnWidthsChange?: (value: DetailColumnWidths) => void;
  tabSwitchesExplorerPanes?: boolean;
  typeaheadQuery?: string;
}) {
  const [pathEditorOpen, setPathEditorOpen] = useState(false);
  const [pathbarExpanded, setPathbarExpanded] = useState(false);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const pathbarRef = useRef<HTMLElement | null>(null);
  const pathEditorShellRef = useRef<HTMLDivElement | null>(null);
  const segmentClickTimeoutRef = useRef<number | null>(null);
  const {
    draftValue,
    displayedValue,
    suggestions,
    highlightedIndex,
    previewValue,
    suggestionsRef,
    setValue,
    clearSuggestions,
    acceptSuggestion,
    previewSuggestion,
    focusSuggestion,
  } = usePathSuggestions({
    open: pathEditorOpen,
    initialInput: currentPath,
    inputRef: pathInputRef,
    onRequestPathSuggestions,
  });
  const pathSegments = useMemo(() => buildPathSegments(currentPath), [currentPath]);
  const { width: pathbarWidth } = useElementSize(pathbarRef);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const { width: viewportWidth, height: viewportHeight } = useElementSize(viewportRef);
  const visiblePathItems = useMemo(
    () => resolveVisiblePathbarItems(pathSegments, pathbarWidth, pathbarExpanded),
    [pathSegments, pathbarWidth, pathbarExpanded],
  );

  // Navigating to a new folder resets all transient editor state so previews, expanded
  // breadcrumbs, and highlighted suggestions do not leak across locations.
  useEffect(() => {
    if (segmentClickTimeoutRef.current !== null) {
      window.clearTimeout(segmentClickTimeoutRef.current);
      segmentClickTimeoutRef.current = null;
    }
    setPathEditorOpen(false);
    setPathbarExpanded(false);
  }, [currentPath]);

  useEffect(() => {
    if (pathEditorOpen) {
      pathInputRef.current?.focus();
      const input = pathInputRef.current;
      if (input) {
        const caretPosition = currentPath.length;
        input.setSelectionRange(caretPosition, caretPosition);
      }
    }
  }, [currentPath, pathEditorOpen]);

  useEffect(
    () => () => {
      if (segmentClickTimeoutRef.current !== null) {
        window.clearTimeout(segmentClickTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!pathbarExpanded) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && pathbarRef.current?.contains(target)) {
        return;
      }
      setPathbarExpanded(false);
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [pathbarExpanded]);

  useEffect(() => {
    if (!pathbarExpanded) {
      return;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && pathbarRef.current?.contains(target)) {
        return;
      }
      setPathbarExpanded(false);
    };
    window.addEventListener("mousemove", handleMouseMove, true);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove, true);
    };
  }, [pathbarExpanded]);

  useLayoutEffect(() => {
    if (!pathbarExpanded) {
      const pathbar = pathbarRef.current;
      if (pathbar) {
        pathbar.scrollLeft = 0;
      }
      return;
    }
    const pathbar = pathbarRef.current;
    if (!pathbar) {
      return;
    }
    const syncScroll = () => {
      pathbar.scrollLeft = Math.max(0, pathbar.scrollWidth - pathbar.clientWidth);
    };
    syncScroll();
    const frameId = window.requestAnimationFrame(syncScroll);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathbarExpanded]);

  return (
    <section
      ref={paneRef}
      className="content-pane pane pane-focus-target"
      tabIndex={-1}
      onMouseDownCapture={(event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) {
          return;
        }
        if (
          isKeyboardOwnedFormControl(target) ||
          target.closest(".pathbar-editor-shell, .pathbar-suggestions, .details-column-resizer")
        ) {
          return;
        }
        if (!target.closest(".pane-header, .content-viewport")) {
          return;
        }
        (paneRef?.current ?? event.currentTarget).focus({ preventScroll: true });
      }}
      onFocusCapture={() => onFocusChange(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onFocusChange(false);
        }
      }}
      // This keeps content-pane typeahead working even when focus is inside nested controls,
      // while still excluding inputs and resize handles that have their own keyboard model.
      onKeyDownCapture={(event) => {
        if (!onTypeaheadInput) {
          return;
        }
        const target = event.target;
        if (isKeyboardOwnedFormControl(target)) {
          return;
        }
        if (
          target instanceof HTMLElement &&
          target.closest(".pathbar-editor-shell, .details-column-resizer")
        ) {
          return;
        }
        // `?` is reserved as the global Help shortcut and should not be consumed by content
        // typeahead when focus is otherwise in the pane.
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
      <div className={`pane-header content-header${isFocused ? " pane-header-focused" : ""}`}>
        {pathEditorOpen ? (
          <form
            className="pathbar-editor-form"
            onSubmit={(event) => {
              event.preventDefault();
              const nextPath =
                highlightedIndex >= 0 && suggestions[highlightedIndex]
                  ? suggestions[highlightedIndex].path
                  : draftValue.trim();
              if (nextPath.length === 0) {
                return;
              }
              setPathEditorOpen(false);
              clearSuggestions();
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
                value={displayedValue}
                onBlur={(event) => {
                  const nextTarget = event.relatedTarget;
                  if (
                    nextTarget instanceof Node &&
                    suggestionsRef.current &&
                    suggestionsRef.current.contains(nextTarget)
                  ) {
                    return;
                  }
                  setValue(currentPath, false);
                  setPathEditorOpen(false);
                }}
                onChange={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (suggestions.length > 0 || previewValue !== null) {
                      clearSuggestions();
                      return;
                    }
                    setValue(currentPath, false);
                    setPathEditorOpen(false);
                    return;
                  }
                  if (
                    (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                    suggestions.length > 0
                  ) {
                    event.preventDefault();
                    const nextIndex =
                      highlightedIndex < 0
                        ? event.key === "ArrowDown"
                          ? 0
                          : suggestions.length - 1
                        : event.key === "ArrowDown"
                          ? (highlightedIndex + 1) % suggestions.length
                          : (highlightedIndex - 1 + suggestions.length) % suggestions.length;
                    previewSuggestion(nextIndex);
                    return;
                  }
                  if (tabSwitchesExplorerPanes && event.key === "Tab" && suggestions.length > 0) {
                    event.preventDefault();
                    focusSuggestion(event.shiftKey ? suggestions.length - 1 : 0);
                  }
                }}
              />
              <PathSuggestionDropdown
                suggestions={suggestions}
                highlightedIndex={highlightedIndex}
                suggestionsRef={suggestionsRef}
                inputRef={pathInputRef}
                tabSwitchesExplorerPanes={tabSwitchesExplorerPanes}
                onPreviewSuggestion={previewSuggestion}
                onFocusSuggestion={focusSuggestion}
                onClearSuggestions={clearSuggestions}
                onAcceptSuggestion={acceptSuggestion}
              />
            </div>
          </form>
        ) : (
          <nav
            ref={pathbarRef}
            className={`pathbar${pathbarExpanded ? " pathbar-expanded" : ""}`}
            aria-label="Folder path"
            onDoubleClick={() => {
              setPathbarExpanded(false);
              setPathEditorOpen(true);
            }}
          >
            {/* The pathbar may collapse middle segments to fit current width, but the full
                path remains reachable either by expansion or by opening the editor. */}
            {visiblePathItems.map((item, index) => (
              <div
                key={item.kind === "segment" ? item.segment.path : item.key}
                className="pathbar-item"
              >
                {index > 0 ? <span className="pathbar-separator">›</span> : null}
                {item.kind === "segment" ? (
                  <button
                    type="button"
                    className={`pathbar-segment${item.isActive ? " active" : ""}`}
                    onClick={() => {
                      if (segmentClickTimeoutRef.current !== null) {
                        window.clearTimeout(segmentClickTimeoutRef.current);
                      }
                      segmentClickTimeoutRef.current = window.setTimeout(() => {
                        segmentClickTimeoutRef.current = null;
                        setPathbarExpanded(false);
                        onNavigatePath(item.segment.path);
                      }, PATHBAR_SEGMENT_CLICK_DELAY_MS);
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (segmentClickTimeoutRef.current !== null) {
                        window.clearTimeout(segmentClickTimeoutRef.current);
                        segmentClickTimeoutRef.current = null;
                      }
                      setPathbarExpanded(false);
                      setPathEditorOpen(true);
                    }}
                    title={item.segment.path}
                  >
                    <span className="pathbar-segment-label">{item.segment.label}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pathbar-segment pathbar-segment-collapsed"
                    onClick={() => setPathbarExpanded(true)}
                    title={`Show hidden path segments (${item.hiddenCount})`}
                  >
                    <span className="pathbar-segment-label">…</span>
                  </button>
                )}
              </div>
            ))}
          </nav>
        )}
      </div>
      <div ref={viewportRef} className="content-viewport">
        {viewMode === "list" && typeaheadQuery ? (
          <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
            <span className="pane-typeahead-label">Select</span>
            <span className="pane-typeahead-value">{typeaheadQuery}</span>
          </div>
        ) : null}
        {viewMode === "list" ? (
          <FlowListView
            key={currentPath}
            currentPath={currentPath}
            entries={entries}
            isFocused={isFocused}
            loading={loading}
            error={error}
            includeHidden={includeHidden}
            selectedPaths={selectedPaths}
            selectionLeadPath={selectionLeadPath}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
            onActivateEntry={onActivateEntry}
            onLayoutColumnsChange={onLayoutColumnsChange}
            onSelectionGesture={onSelectionGesture}
            onClearSelection={onClearSelection}
            onVisiblePathsChange={onVisiblePathsChange}
            onItemContextMenu={onItemContextMenu}
            compactListView={compactListView}
            highlightHoveredItems={highlightHoveredItems}
            typeaheadQuery={typeaheadQuery ?? ""}
          />
        ) : (
          <DetailsView
            key={currentPath}
            currentPath={currentPath}
            entries={entries}
            isFocused={isFocused}
            loading={loading}
            error={error}
            includeHidden={includeHidden}
            metadataByPath={metadataByPath}
            selectedPaths={selectedPaths}
            selectionLeadPath={selectionLeadPath}
            sortBy={sortBy}
            sortDirection={sortDirection}
            viewportWidth={viewportWidth}
            viewportHeight={viewportHeight}
            onActivateEntry={onActivateEntry}
            onSortChange={onSortChange}
            onLayoutColumnsChange={onLayoutColumnsChange}
            onSelectionGesture={onSelectionGesture}
            onClearSelection={onClearSelection}
            onVisiblePathsChange={onVisiblePathsChange}
            onItemContextMenu={onItemContextMenu}
            compactDetailsView={compactDetailsView}
            highlightHoveredItems={highlightHoveredItems}
            detailColumns={detailColumns}
            detailColumnWidths={detailColumnWidths}
            onDetailColumnWidthsChange={onDetailColumnWidthsChange}
            typeaheadQuery={typeaheadQuery ?? ""}
          />
        )}
      </div>
    </section>
  );
}

function buildPathSegments(path: string): Array<PathbarSegment> {
  // The UI presents `/` as "Macintosh HD" to match the rest of the macOS-facing chrome,
  // but navigation still uses real absolute paths underneath.
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

function resolveVisiblePathbarItems(
  segments: PathbarSegment[],
  availableWidth: number,
  expanded: boolean,
): PathbarDisplayItem[] {
  // Collapse logic prefers keeping the tail visible because those segments are usually the
  // most actionable part of the current location.
  const fullItems = segments.map<PathbarDisplayItem>((segment, index) => ({
    kind: "segment",
    segment,
    isActive: index === segments.length - 1,
  }));
  const effectiveWidth = Math.max(0, availableWidth - PATHBAR_WIDTH_SAFETY_MARGIN);
  if (expanded || segments.length <= 4) {
    return fullItems;
  }
  if (effectiveWidth <= 0) {
    return buildCollapsedPathbarItems(segments, { includeRoot: false, tailCount: 1 });
  }
  if (estimatePathbarWidth(fullItems) <= effectiveWidth) {
    return fullItems;
  }

  for (let tailCount = segments.length - 2; tailCount >= 1; tailCount -= 1) {
    const candidate = buildCollapsedPathbarItems(segments, {
      includeRoot: true,
      tailCount,
    });
    if (estimatePathbarWidth(candidate) <= effectiveWidth) {
      return candidate;
    }
  }

  for (let tailCount = segments.length - 1; tailCount >= 1; tailCount -= 1) {
    const candidate = buildCollapsedPathbarItems(segments, {
      includeRoot: false,
      tailCount,
    });
    if (estimatePathbarWidth(candidate) <= effectiveWidth) {
      return candidate;
    }
  }

  return buildCollapsedPathbarItems(segments, { includeRoot: false, tailCount: 1 });
}

function buildCollapsedPathbarItems(
  segments: PathbarSegment[],
  options: { includeRoot: boolean; tailCount: number },
): PathbarDisplayItem[] {
  // Hidden middle segments are represented by a single synthetic "collapsed" item.
  const items: PathbarDisplayItem[] = [];
  const hiddenStartIndex = options.includeRoot ? 1 : 0;
  const tailStartIndex = Math.max(hiddenStartIndex, segments.length - options.tailCount);
  const hiddenCount = Math.max(0, tailStartIndex - hiddenStartIndex);

  if (options.includeRoot) {
    const rootSegment = segments[0];
    if (!rootSegment) {
      return items;
    }
    items.push({
      kind: "segment",
      segment: rootSegment,
      isActive: false,
    });
  }

  if (hiddenCount > 0) {
    items.push({
      kind: "collapsed",
      key: `collapsed:${options.includeRoot ? "root" : "no-root"}:${options.tailCount}`,
      hiddenCount,
    });
  }

  for (let index = tailStartIndex; index < segments.length; index += 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }
    items.push({
      kind: "segment",
      segment,
      isActive: index === segments.length - 1,
    });
  }

  return items;
}

function estimatePathbarWidth(items: PathbarDisplayItem[]): number {
  return items.reduce((width, item, index) => {
    const separatorWidth = index > 0 ? PATHBAR_SEPARATOR_WIDTH : 0;
    if (item.kind === "collapsed") {
      return width + separatorWidth + PATHBAR_COLLAPSED_WIDTH;
    }
    return width + separatorWidth + estimatePathbarSegmentWidth(item.segment.label, item.isActive);
  }, 0);
}

let pathbarMeasureHost: HTMLDivElement | null = null;

function estimatePathbarSegmentWidth(label: string, isActive: boolean): number {
  // Measure with real DOM styles so collapse decisions stay accurate across font/theme changes.
  if (typeof document === "undefined") {
    return PATHBAR_SEGMENT_HORIZONTAL_PADDING + label.length * 8;
  }

  if (!pathbarMeasureHost) {
    pathbarMeasureHost = document.createElement("div");
    pathbarMeasureHost.setAttribute("aria-hidden", "true");
    pathbarMeasureHost.style.position = "fixed";
    pathbarMeasureHost.style.left = "-10000px";
    pathbarMeasureHost.style.top = "0";
    pathbarMeasureHost.style.visibility = "hidden";
    pathbarMeasureHost.style.pointerEvents = "none";
    pathbarMeasureHost.style.whiteSpace = "nowrap";
    document.body.appendChild(pathbarMeasureHost);
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = `pathbar-segment${isActive ? " active" : ""}`;
  button.textContent = label;
  pathbarMeasureHost.appendChild(button);
  const width = Math.ceil(button.getBoundingClientRect().width);
  pathbarMeasureHost.removeChild(button);
  return width;
}

function FlowListView({
  currentPath,
  entries,
  isFocused,
  loading,
  error,
  includeHidden,
  selectedPaths,
  selectionLeadPath,
  viewportWidth,
  viewportHeight,
  onSelectionGesture,
  onClearSelection,
  onActivateEntry,
  onLayoutColumnsChange,
  onVisiblePathsChange,
  onItemContextMenu = () => undefined,
  compactListView = false,
  highlightHoveredItems = true,
  typeaheadQuery,
}: {
  currentPath: string;
  entries: DirectoryEntry[];
  isFocused: boolean;
  loading: boolean;
  error: string | null;
  includeHidden: boolean;
  selectedPaths: string[];
  selectionLeadPath: string | null;
  viewportWidth: number;
  viewportHeight: number;
  onSelectionGesture: (path: string, modifiers: SelectionGestureModifiers) => void;
  onClearSelection: () => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  compactListView?: boolean;
  highlightHoveredItems?: boolean;
  typeaheadQuery?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }
    const measure = () => {
      const h = el.clientHeight;
      setContainerHeight((prev) => (prev === h ? prev : h));
    };
    measure();
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(measure);
    });
    observer.observe(el);
    if (el.parentElement) {
      observer.observe(el.parentElement);
    }
    const onResize = () => {
      requestAnimationFrame(measure);
    };
    window.addEventListener("resize", onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const listLayout = compactListView ? COMPACT_FLOW_LIST_LAYOUT : FLOW_LIST_LAYOUT;
  const rowsPerColumn = computeRowsPerColumn(containerHeight, listLayout);
  const rows = useMemo(
    () => buildColumnMajorRows(entries, rowsPerColumn),
    [entries, rowsPerColumn],
  );
  const columnCount = Math.max(1, Math.ceil(entries.length / rowsPerColumn));
  // Virtualization operates on rendered rows, not items, because each row can contain
  // one entry per visible column in this column-major layout.
  const range = getVirtualRange({
    itemCount: rows.length,
    itemSize: listLayout.rowHeight,
    viewportSize: containerHeight,
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

  // Selection reveal is horizontal in list view because vertical movement stays within
  // the current column while additional columns live off-screen to the right.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !selectionLeadPath) {
      return;
    }

    const selectedIndex = entries.findIndex((entry) => entry.path === selectionLeadPath);
    if (selectedIndex < 0) {
      return;
    }

    const nextScrollLeft = getFlowListRevealScrollLeft({
      currentScrollLeft: container.scrollLeft,
      viewportWidth: container.clientWidth,
      itemIndex: selectedIndex,
      rowsPerColumn,
      compact: compactListView,
      maxScrollLeft: Math.max(0, container.scrollWidth - container.clientWidth),
    });

    if (Math.abs(nextScrollLeft - container.scrollLeft) <= 1) {
      return;
    }

    container.scrollLeft = nextScrollLeft;
  }, [compactListView, entries, rowsPerColumn, selectionLeadPath, viewportWidth]);

  return (
    <div
      ref={containerRef}
      className={`content-scroll flow-list${compactListView ? " compact" : ""}`}
      data-hover-highlight-enabled={highlightHoveredItems ? "true" : "false"}
      tabIndex={-1}
      onMouseDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-selectable-entry-path]")) {
          return;
        }
        onClearSelection();
        containerRef.current?.focus();
      }}
      onContextMenu={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-selectable-entry-path]")) {
          return;
        }
        event.preventDefault();
        onClearSelection();
        containerRef.current?.focus();
        onItemContextMenu(null, {
          x: event.clientX,
          y: event.clientY,
        });
      }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      // Vertical wheel delta is mapped to horizontal travel because the visual list grows
      // sideways once the current column is full.
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
      <ContentState
        loading={loading}
        error={error}
        currentPath={currentPath}
        entriesLength={entries.length}
        includeHidden={includeHidden}
      />
      <div
        className="flow-grid-rows"
        style={{
          // The full horizontal scroll range depends on the total column count even though
          // only a slice of rows is mounted at any given time.
          paddingTop: `${range.startIndex * listLayout.rowHeight}px`,
          paddingBottom: `${Math.max(0, rows.length - range.endIndex) * listLayout.rowHeight}px`,
          minWidth: `${
            columnCount * listLayout.itemWidth + Math.max(0, columnCount - 1) * listLayout.columnGap
          }px`,
        }}
        data-viewport-width={viewportWidth}
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
                className={`flow-item${selectedPathSet.has(entry.path) ? " active" : ""}${
                  selectedPathSet.has(entry.path) && !isFocused ? " inactive" : ""
                }`}
                data-selectable-entry-path={entry.path}
                draggable={false}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  onSelectionGesture(entry.path, {
                    metaKey: event.metaKey,
                    shiftKey: event.shiftKey,
                  });
                  containerRef.current?.focus();
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  containerRef.current?.focus();
                  onItemContextMenu(entry.path, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onDoubleClick={() => onActivateEntry(entry)}
                title={entry.name}
                aria-selected={selectedPathSet.has(entry.path)}
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
  currentPath,
  entries,
  isFocused,
  loading,
  error,
  includeHidden,
  metadataByPath,
  selectedPaths,
  selectionLeadPath,
  sortBy,
  sortDirection,
  viewportWidth,
  viewportHeight,
  onSelectionGesture,
  onClearSelection,
  onActivateEntry,
  onSortChange,
  onLayoutColumnsChange,
  onVisiblePathsChange,
  onItemContextMenu = () => undefined,
  compactDetailsView = false,
  highlightHoveredItems = true,
  detailColumns = DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths = DEFAULT_DETAIL_COLUMN_WIDTHS,
  onDetailColumnWidthsChange = () => undefined,
  typeaheadQuery,
}: {
  currentPath: string;
  entries: DirectoryEntry[];
  isFocused: boolean;
  loading: boolean;
  error: string | null;
  includeHidden: boolean;
  metadataByPath: Record<string, DirectoryEntryMetadata>;
  selectedPaths: string[];
  selectionLeadPath: string | null;
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"];
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"];
  viewportWidth: number;
  viewportHeight: number;
  onSelectionGesture: (path: string, modifiers: SelectionGestureModifiers) => void;
  onClearSelection: () => void;
  onActivateEntry: (entry: DirectoryEntry) => void;
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  compactDetailsView?: boolean;
  highlightHoveredItems?: boolean;
  detailColumns?: DetailColumnVisibility;
  detailColumnWidths?: DetailColumnWidths;
  onDetailColumnWidthsChange?: (value: DetailColumnWidths) => void;
  typeaheadQuery?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const visibleColumns = useMemo(() => getVisibleDetailColumns(detailColumns), [detailColumns]);
  const rowHeight = getDetailsRowHeight(compactDetailsView);
  const gridTemplateColumns = useMemo(
    () => visibleColumns.map((key) => `${detailColumnWidths[key]}px`).join(" "),
    [detailColumnWidths, visibleColumns],
  );
  // Header and body widths must come from the same visible-column set so the sticky
  // header remains aligned with the scrollable body.
  const tableWidth = useMemo(
    () => getDetailsTableWidth(detailColumnWidths, visibleColumns),
    [detailColumnWidths, visibleColumns],
  );
  const range = getVirtualRange({
    itemCount: entries.length,
    itemSize: rowHeight,
    viewportSize: viewportHeight,
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

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
      document.body.classList.remove("column-resize-active");
    },
    [],
  );

  // Keep the lead selection visible using the same row height contract virtualization uses.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !selectionLeadPath) {
      return;
    }
    const selectedIndex = entries.findIndex((entry) => entry.path === selectionLeadPath);
    if (selectedIndex < 0) {
      return;
    }
    const itemTop = selectedIndex * rowHeight;
    const itemBottom = itemTop + rowHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;

    if (itemTop < viewTop) {
      container.scrollTop = itemTop;
      return;
    }
    if (itemBottom > viewBottom) {
      container.scrollTop = itemBottom - container.clientHeight;
    }
  }, [entries, rowHeight, selectionLeadPath, viewportHeight, viewportWidth]);

  // Resizing uses global pointer listeners so the drag continues even if the pointer
  // leaves the resize handle while the user is dragging quickly.
  function startColumnResize(event: React.PointerEvent<HTMLSpanElement>, key: DetailColumnKey) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = detailColumnWidths[key];
    const startWidths = detailColumnWidths;
    const finishResize = () => {
      resizeCleanupRef.current = null;
      document.body.classList.remove("column-resize-active");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const width = clampDetailColumnWidth(key, startWidth + (moveEvent.clientX - startX));
      if (width === startWidths[key]) {
        return;
      }
      onDetailColumnWidthsChange({
        ...startWidths,
        [key]: width,
      });
    };
    const handlePointerUp = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      finishResize();
    };
    resizeCleanupRef.current?.();
    document.body.classList.add("column-resize-active");
    resizeCleanupRef.current = finishResize;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function nudgeColumnWidth(key: DetailColumnKey, direction: -1 | 1) {
    const width = clampDetailColumnWidth(key, detailColumnWidths[key] + direction * 12);
    if (width === detailColumnWidths[key]) {
      return;
    }
    onDetailColumnWidthsChange({
      ...detailColumnWidths,
      [key]: width,
    });
  }

  return (
    <div className="details-wrapper">
      {typeaheadQuery ? (
        <div className="pane-typeahead pane-typeahead-center" aria-live="polite">
          <span className="pane-typeahead-label">Select</span>
          <span className="pane-typeahead-value">{typeaheadQuery}</span>
        </div>
      ) : null}
      <div className="details-header-shell">
        <div
          className={`details-header${compactDetailsView ? " compact" : ""}`}
          style={{
            // The header is translated by body scroll rather than scrolled directly so it
            // stays sticky while still matching the body's horizontal position.
            width: `${tableWidth}px`,
            minWidth: "100%",
            gridTemplateColumns,
            transform: `translateX(-${scrollLeft}px)`,
          }}
        >
          {visibleColumns.map((columnKey) => (
            <DetailsHeaderCell
              key={columnKey}
              columnKey={columnKey}
              active={sortBy === columnKey}
              direction={sortDirection}
              onSortChange={onSortChange}
              onResizeStart={startColumnResize}
              onResizeNudge={nudgeColumnWidth}
            />
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className={`content-scroll details-scroll${compactDetailsView ? " compact" : ""}`}
        data-hover-highlight-enabled={highlightHoveredItems ? "true" : "false"}
        tabIndex={-1}
        onMouseDown={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest("[data-selectable-entry-path]")) {
            return;
          }
          onClearSelection();
          containerRef.current?.focus();
        }}
        onContextMenu={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest("[data-selectable-entry-path]")) {
            return;
          }
          event.preventDefault();
          onClearSelection();
          containerRef.current?.focus();
          onItemContextMenu(null, {
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          setScrollLeft(event.currentTarget.scrollLeft);
        }}
      >
        <ContentState
          loading={loading}
          error={error}
          currentPath={currentPath}
          entriesLength={entries.length}
          includeHidden={includeHidden}
        />
        <div
          className="details-table"
          style={{
            width: `${tableWidth}px`,
            minWidth: "100%",
            // Virtualization pads the unmounted rows above and below the visible slice.
            paddingTop: `${range.startIndex * rowHeight}px`,
            paddingBottom: `${Math.max(0, entries.length - range.endIndex) * rowHeight}px`,
          }}
        >
          {visibleEntries.map((entry) => {
            const metadata = metadataByPath[entry.path];
            return (
              <button
                key={entry.path}
                type="button"
                className={`details-row${selectedPathSet.has(entry.path) ? " active" : ""}${
                  selectedPathSet.has(entry.path) && !isFocused ? " inactive" : ""
                }`}
                data-selectable-entry-path={entry.path}
                draggable={false}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  onSelectionGesture(entry.path, {
                    metaKey: event.metaKey,
                    shiftKey: event.shiftKey,
                  });
                  containerRef.current?.focus();
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  containerRef.current?.focus();
                  onItemContextMenu(entry.path, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onDoubleClick={() => onActivateEntry(entry)}
                title={entry.path}
                aria-selected={selectedPathSet.has(entry.path)}
                style={{
                  width: `${tableWidth}px`,
                  minWidth: "100%",
                  gridTemplateColumns,
                }}
              >
                {visibleColumns.map((columnKey) => (
                  <DetailsCell
                    key={columnKey}
                    columnKey={columnKey}
                    entry={entry}
                    metadata={metadata}
                  />
                ))}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DetailsHeaderCell({
  columnKey,
  active,
  direction,
  onSortChange,
  onResizeStart,
  onResizeNudge,
}: {
  columnKey: DetailColumnKey;
  active: boolean;
  direction: "asc" | "desc";
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onResizeStart: (event: React.PointerEvent<HTMLSpanElement>, key: DetailColumnKey) => void;
  onResizeNudge: (key: DetailColumnKey, direction: -1 | 1) => void;
}) {
  const label =
    columnKey === "name"
      ? "Name"
      : columnKey === "size"
        ? "Size"
        : columnKey === "modified"
          ? "Modified"
          : "Permissions";
  const accessibleLabel = columnKey === "modified" ? "Date Modified" : label;
  const sortKey =
    columnKey === "name" || columnKey === "size" || columnKey === "modified" ? columnKey : null;
  const sortable = sortKey !== null;

  return (
    <div className="details-header-cell">
      {sortable ? (
        <SortButton
          label={label}
          accessibleLabel={accessibleLabel}
          active={active}
          direction={direction}
          onClick={() => {
            if (sortKey) {
              onSortChange(sortKey);
            }
          }}
        />
      ) : (
        <span className="details-header-label">{label}</span>
      )}
      <span
        className="details-column-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label} column`}
        tabIndex={0}
        onPointerDown={(event) => onResizeStart(event, columnKey)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onResizeNudge(columnKey, -1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onResizeNudge(columnKey, 1);
          }
        }}
      />
    </div>
  );
}

function DetailsCell({
  columnKey,
  entry,
  metadata,
}: {
  columnKey: DetailColumnKey;
  entry: DirectoryEntry;
  metadata: DirectoryEntryMetadata | undefined;
}) {
  if (columnKey === "name") {
    return (
      <span className="details-name">
        <FileIcon entry={entry} />
        <FileNameLabel
          className="details-name-label"
          name={entry.name}
          extension={entry.extension}
        />
      </span>
    );
  }
  if (columnKey === "size") {
    return <span>{formatDetailSize(entry, metadata)}</span>;
  }
  if (columnKey === "modified") {
    return <span>{formatDetailModifiedAt(metadata)}</span>;
  }
  if (columnKey === "permissions") {
    return <span>{formatDetailPermissions(metadata)}</span>;
  }
  return <span>{formatDetailPermissions(metadata)}</span>;
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
  // Only snapshot-backed columns are sortable; permissions depend on lazy metadata loading.
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

function formatDetailSize(
  entry: DirectoryEntry,
  metadata: DirectoryEntryMetadata | undefined,
): string {
  // Directories show `-` by design. Empty string is reserved for metadata that is still loading.
  if (entry.kind === "directory" || entry.kind === "symlink_directory") {
    return "-";
  }
  if (!metadata || metadata.sizeStatus !== "ready" || metadata.sizeBytes === null) {
    return "";
  }
  return formatSize(metadata.sizeBytes, metadata.sizeStatus);
}

function formatDetailModifiedAt(metadata: DirectoryEntryMetadata | undefined): string {
  if (!metadata?.modifiedAt) {
    return "";
  }
  return formatDateTime(metadata.modifiedAt);
}

function formatDetailPermissions(metadata: DirectoryEntryMetadata | undefined): string {
  if (metadata?.permissionMode === null || metadata?.permissionMode === undefined) {
    return "";
  }
  return formatPermissionMode(metadata.permissionMode);
}

function ContentState({
  loading,
  error,
  currentPath,
  entriesLength,
  includeHidden,
}: {
  loading: boolean;
  error: string | null;
  currentPath: string;
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
    return <EmptyState currentPath={currentPath} includeHidden={includeHidden} />;
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
  currentPath,
  includeHidden,
}: {
  currentPath: string;
  includeHidden: boolean;
}) {
  const hasDirectoryPath = currentPath.trim().length > 0;
  return (
    <div className="content-state content-empty">
      <div className="empty-state-icon" aria-hidden="true">
        <FolderIcon className="empty-state-folder-icon" />
      </div>
      <strong className="empty-state-title">
        {hasDirectoryPath ? "This folder is empty" : "No folder selected"}
      </strong>
      <span className="empty-state-message">
        {hasDirectoryPath
          ? includeHidden
            ? "This directory is empty."
            : "This directory is empty, or hidden files are currently filtered out."
          : "Select a folder or favorite to view its contents."}
      </span>
    </div>
  );
}
