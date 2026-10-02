import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

import {
  DEFAULT_DETAIL_COLUMN_VISIBILITY,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  DETAIL_COLUMN_LABELS,
  type DetailColumnKey,
  type DetailColumnVisibility,
  type DetailColumnWidths,
  type ExplorerViewMode,
  clampDetailColumnWidth,
} from "../../shared/appPreferences";
import { useElementSize } from "../hooks/useElementSize";
import { usePathSuggestions } from "../hooks/usePathSuggestions";
import { useRelativeDate } from "../hooks/useRelativeDate";
import {
  ClipboardMarkIcon,
  clipboardMarkClassName,
  useClipboardMarks,
} from "../lib/clipboardMarks";
import { isSelectionNarrowingClick } from "../lib/contentSelection";
import {
  fitDetailColumns,
  getDetailsRowHeight,
  getDetailsTableWidth,
  getVisibleDetailColumns,
} from "../lib/detailsLayout";
import { FileIcon, FolderIcon } from "../lib/fileIcons";
import {
  COMPACT_FLOW_LIST_LAYOUT,
  FLOW_LIST_LAYOUT,
  getFlowListRevealScrollLeft,
} from "../lib/flowListLayout";
import { isKeyboardOwnedFormControl } from "../lib/focusedEditTarget";
import { formatSize, splitDisplayName, splitPermissionMode } from "../lib/formatting";
import { isTypeaheadCharacterKey } from "../lib/typeahead";
import { buildColumnMajorRows, computeRowsPerColumn, getVirtualRange } from "../lib/virtualization";
import { IconGridView } from "./IconGridView";
import { InlineRenameField } from "./InlineRenameField";
import { ListFilterPill } from "./ListFilterPill";
import { PathSuggestionDropdown } from "./PathSuggestionDropdown";
import { type PathbarFolder, PathbarFolderMenu } from "./PathbarFolderMenu";

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

// Bars behind the sizes of the Details view, which turn the Size column into a picture of
// what takes the space. Each bar is the item's size as a share of the largest in the folder.
export type SizeBars = {
  maxBytes: number;
  /** The size of a file, or of a folder once it has been calculated; null when unknown. */
  getSizeBytes: (entry: DirectoryEntry) => number | null;
};
// Width of the list's vertical scrollbar (`.content-scroll::-webkit-scrollbar`), kept free
// when the details columns are fitted to the pane.
const DETAILS_SCROLLBAR_WIDTH = 8;
type SelectionGestureModifiers = {
  metaKey: boolean;
  shiftKey: boolean;
};
type InlineRenameState = { path: string; error: string | null };

// `ContentPane` is the shared shell for icon, list and details view. It owns path navigation,
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
  onOpenPathInNewTab,
  onRequestPathSuggestions,
  onRequestFolderChildren,
  onFocusChange,
  onTypeaheadInput,
  onItemContextMenu = () => undefined,
  onItemDragStart,
  onItemDragEnd,
  onItemDragEnter,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
  getItemDropIndicator,
  compactListView = false,
  compactDetailsView = false,
  compactIconView = false,
  highlightHoveredItems = true,
  detailColumns = DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths = DEFAULT_DETAIL_COLUMN_WIDTHS,
  onDetailColumnWidthsChange = () => undefined,
  filterQuery = "",
  filterTotalCount = 0,
  onClearFilter = () => undefined,
  onSearchForFilter,
  getFolderSizeLabel,
  sizeBars = null,
  statusSummary,
  inlineRename = null,
  onInlineRenameSubmit = () => undefined,
  onInlineRenameCancel = () => undefined,
}: {
  paneRef?: React.RefObject<HTMLElement | null>;
  isFocused: boolean;
  currentPath: string;
  entries: DirectoryEntry[];
  viewMode: ExplorerViewMode;
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
  onActivateEntry: (entry: DirectoryEntry, inNewTab?: boolean) => void;
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onNavigatePath: (path: string) => void;
  /** ⌘-click on a folder of the path bar. */
  onOpenPathInNewTab?: (path: string) => void;
  onRequestPathSuggestions: (inputPath: string) => Promise<IpcResponse<"path:getSuggestions">>;
  /** The folders inside `path`, for the menus on the path bar's separators. */
  onRequestFolderChildren?: ((path: string) => Promise<PathbarFolder[]>) | undefined;
  onFocusChange: (focused: boolean) => void;
  onTypeaheadInput?: (key: string) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  onItemDragStart?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragEnd?: ((event: React.DragEvent<HTMLElement>) => void) | undefined;
  onItemDragEnter?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragOver?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragLeave?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDrop?: ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void) | undefined;
  getItemDropIndicator?: ((path: string) => "valid" | "invalid" | null) | undefined;
  compactListView?: boolean;
  compactDetailsView?: boolean;
  compactIconView?: boolean;
  highlightHoveredItems?: boolean;
  detailColumns?: DetailColumnVisibility;
  detailColumnWidths?: DetailColumnWidths;
  onDetailColumnWidthsChange?: (value: DetailColumnWidths) => void;
  /** What has been typed to narrow `entries`, which already are the matching ones. */
  filterQuery?: string;
  /** How many items the folder has before the filter. */
  filterTotalCount?: number;
  onClearFilter?: () => void;
  /** Looks for the filter text in the subfolders too (offered when nothing here matches). */
  onSearchForFilter?: (() => void) | undefined;
  // Cached folder size text for the details Size column, or null when none is known.
  getFolderSizeLabel?: ((path: string) => string | null) | undefined;
  sizeBars?: SizeBars | null;
  // Item/selection count and free space, shown at the right end of the path bar.
  statusSummary?: string | undefined;
  // The item whose name is being edited in its row, with the reason the last name was refused.
  inlineRename?: InlineRenameState | null;
  onInlineRenameSubmit?: (nextName: string) => void;
  onInlineRenameCancel?: () => void;
}) {
  const [pathEditorOpen, setPathEditorOpen] = useState(false);
  const [pathbarExpanded, setPathbarExpanded] = useState(false);
  const pathInputRef = useRef<HTMLInputElement | null>(null);
  const pathbarRef = useRef<HTMLElement | null>(null);
  const pathEditorShellRef = useRef<HTMLDivElement | null>(null);
  const segmentClickTimeoutRef = useRef<number | null>(null);
  const lastCurrentPathRef = useRef(currentPath);
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
    if (lastCurrentPathRef.current === currentPath) {
      return;
    }
    lastCurrentPathRef.current = currentPath;
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
      // A menu opened from a separator belongs to the path bar, though it is drawn outside it.
      if (target instanceof Element && target.closest(".pathbar-folder-menu")) {
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
      // Moving into a separator's menu is not leaving the path bar.
      if (target instanceof Element && target.closest(".pathbar-folder-menu")) {
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
      <div ref={viewportRef} className="content-viewport">
        <ListFilterPill
          query={filterQuery}
          shownCount={entries.length}
          totalCount={filterTotalCount}
          onClear={onClearFilter}
        />
        {filterQuery.length > 0 && entries.length === 0 && !loading && !error ? (
          <div className="content-state content-empty">
            <strong className="empty-state-title">No items match “{filterQuery}”</strong>
            <span className="empty-state-message">
              Nothing in this folder has that in its name.
            </span>
            {onSearchForFilter ? (
              <button
                type="button"
                className="empty-state-action"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onSearchForFilter}
              >
                Search subfolders
              </button>
            ) : null}
          </div>
        ) : viewMode === "icons" ? (
          <IconGridView
            key={currentPath}
            entries={entries}
            isFocused={isFocused}
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
            onItemDragStart={onItemDragStart}
            onItemDragEnd={onItemDragEnd}
            onItemDragEnter={onItemDragEnter}
            onItemDragOver={onItemDragOver}
            onItemDragLeave={onItemDragLeave}
            onItemDrop={onItemDrop}
            getItemDropIndicator={getItemDropIndicator}
            compactIconView={compactIconView}
            highlightHoveredItems={highlightHoveredItems}
            inlineRename={inlineRename}
            onInlineRenameSubmit={onInlineRenameSubmit}
            onInlineRenameCancel={onInlineRenameCancel}
          >
            <ContentState
              loading={loading}
              error={error}
              currentPath={currentPath}
              entriesLength={entries.length}
              includeHidden={includeHidden}
            />
          </IconGridView>
        ) : viewMode === "list" ? (
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
            onItemDragStart={onItemDragStart}
            onItemDragEnd={onItemDragEnd}
            onItemDragEnter={onItemDragEnter}
            onItemDragOver={onItemDragOver}
            onItemDragLeave={onItemDragLeave}
            onItemDrop={onItemDrop}
            getItemDropIndicator={getItemDropIndicator}
            compactListView={compactListView}
            highlightHoveredItems={highlightHoveredItems}
            inlineRename={inlineRename}
            onInlineRenameSubmit={onInlineRenameSubmit}
            onInlineRenameCancel={onInlineRenameCancel}
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
            onItemDragStart={onItemDragStart}
            onItemDragEnd={onItemDragEnd}
            onItemDragEnter={onItemDragEnter}
            onItemDragOver={onItemDragOver}
            onItemDragLeave={onItemDragLeave}
            onItemDrop={onItemDrop}
            getItemDropIndicator={getItemDropIndicator}
            compactDetailsView={compactDetailsView}
            highlightHoveredItems={highlightHoveredItems}
            detailColumns={detailColumns}
            detailColumnWidths={detailColumnWidths}
            onDetailColumnWidthsChange={onDetailColumnWidthsChange}
            getFolderSizeLabel={getFolderSizeLabel}
            sizeBars={sizeBars}
            inlineRename={inlineRename}
            onInlineRenameSubmit={onInlineRenameSubmit}
            onInlineRenameCancel={onInlineRenameCancel}
          />
        )}
      </div>
      <div
        className={`pane-header content-header content-pathbar-row${isFocused ? " pane-header-focused" : ""}`}
      >
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
                  if (event.key === "Tab" && suggestions.length > 0) {
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
                {index > 0 ? (
                  item.kind === "segment" && onRequestFolderChildren ? (
                    // The separator lists the folders next to the one that follows it.
                    <PathbarFolderMenu
                      parentPath={getParentPath(item.segment.path)}
                      parentLabel={getPathSegmentLabel(getParentPath(item.segment.path))}
                      activePath={item.segment.path}
                      onRequestFolders={onRequestFolderChildren}
                      onNavigatePath={(path) => {
                        setPathbarExpanded(false);
                        onNavigatePath(path);
                      }}
                    />
                  ) : (
                    <span className="pathbar-separator">›</span>
                  )
                ) : null}
                {item.kind === "segment" ? (
                  <button
                    type="button"
                    className={`pathbar-segment${item.isActive ? " active" : ""}`}
                    aria-disabled={item.segment.path.length === 0}
                    onClick={(event) => {
                      if (item.segment.path.length === 0) {
                        return;
                      }
                      if (event.metaKey && onOpenPathInNewTab) {
                        onOpenPathInNewTab(item.segment.path);
                        return;
                      }
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
                    title={item.segment.path || item.segment.label}
                  >
                    <span className="pathbar-segment-label">{item.segment.label}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pathbar-segment pathbar-segment-collapsed"
                    onClick={() => setPathbarExpanded(true)}
                    title={`Show ${item.hiddenCount} More ${
                      item.hiddenCount === 1 ? "Folder" : "Folders"
                    }`}
                  >
                    <span className="pathbar-segment-label">…</span>
                  </button>
                )}
              </div>
            ))}
          </nav>
        )}
        {statusSummary && !pathEditorOpen ? (
          <span className="content-pathbar-status" aria-live="polite">
            {statusSummary}
          </span>
        ) : null}
      </div>
    </section>
  );
}

// The folder a path bar segment is in ("/" for the folders at the top of the disk).
function getParentPath(path: string): string {
  return path.slice(0, Math.max(1, path.lastIndexOf("/")));
}

function getPathSegmentLabel(path: string): string {
  return path === "/" ? "Macintosh HD" : (path.split("/").filter(Boolean).at(-1) ?? path);
}

function buildPathSegments(path: string): Array<PathbarSegment> {
  if (path.trim().length === 0) {
    return [{ label: "No folder selected", path: "" }];
  }
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
  onItemDragStart,
  onItemDragEnd,
  onItemDragEnter,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
  getItemDropIndicator,
  compactListView = false,
  highlightHoveredItems = true,
  inlineRename,
  onInlineRenameSubmit,
  onInlineRenameCancel,
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
  onActivateEntry: (entry: DirectoryEntry, inNewTab?: boolean) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  onItemDragStart?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragEnd?: ((event: React.DragEvent<HTMLElement>) => void) | undefined;
  onItemDragEnter?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragOver?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragLeave?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDrop?: ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void) | undefined;
  getItemDropIndicator?: ((path: string) => "valid" | "invalid" | null) | undefined;
  compactListView?: boolean;
  highlightHoveredItems?: boolean;
  inlineRename: InlineRenameState | null;
  onInlineRenameSubmit: (nextName: string) => void;
  onInlineRenameCancel: () => void;
}) {
  const clipboardMarks = useClipboardMarks("content");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { height: containerHeight } = useElementSize(containerRef);
  // Scroll position lives in a ref so scrolling never re-renders by itself; a rAF
  // coalesces scroll events into at most one state update per frame, and that state
  // is the top visible row index, which only changes when the window shifts rows.
  const scrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollRowIndex, setScrollRowIndex] = useState(0);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

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
    scrollOffset: scrollRowIndex * listLayout.rowHeight,
    overscan: 6,
  });
  const visibleRows = rows.slice(range.startIndex, range.endIndex);
  // Report by value: the sliced rows are a new array every render, and depending on them
  // would re-render the parent in an endless loop.
  const visiblePathsKey = visibleRows
    .flat()
    .map((entry) => entry.path)
    .join("\0");

  useEffect(() => {
    onVisiblePathsChange(visiblePathsKey.length > 0 ? visiblePathsKey.split("\0") : []);
  }, [onVisiblePathsChange, visiblePathsKey]);

  useEffect(() => {
    onLayoutColumnsChange(rowsPerColumn);
  }, [onLayoutColumnsChange, rowsPerColumn]);

  // Selection reveal is horizontal in list view because vertical movement stays within
  // the current column while additional columns live off-screen to the right.
  useEffect(() => {
    const container = containerRef.current;
    const effectiveViewportWidth =
      viewportWidth > 0 ? viewportWidth : (container?.clientWidth ?? 0);
    if (!container || !selectionLeadPath || effectiveViewportWidth <= 0) {
      return;
    }

    const selectedIndex = entries.findIndex((entry) => entry.path === selectionLeadPath);
    if (selectedIndex < 0) {
      return;
    }

    const nextScrollLeft = getFlowListRevealScrollLeft({
      currentScrollLeft: container.scrollLeft,
      viewportWidth: effectiveViewportWidth,
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
      onScroll={(event) => {
        scrollTopRef.current = event.currentTarget.scrollTop;
        if (scrollFrameRef.current !== null) {
          return;
        }
        scrollFrameRef.current = window.requestAnimationFrame(() => {
          scrollFrameRef.current = null;
          const nextRowIndex = Math.floor(Math.max(0, scrollTopRef.current) / listLayout.rowHeight);
          setScrollRowIndex((prev) => (prev === nextRowIndex ? prev : nextRowIndex));
        });
      }}
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
      {/* biome-ignore lint/a11y/useFocusableInteractive: focus is owned by the scroll container; options are buttons and stay keyboard reachable. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a native select cannot host this virtualized column-major file grid. */}
      <div
        role="listbox"
        aria-multiselectable="true"
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
            // Layout rows are invisible to assistive tech so options stay direct
            // children of the listbox in the accessibility tree.
            role="presentation"
            style={{
              gridTemplateColumns: `repeat(${columnCount}, ${listLayout.itemWidth}px)`,
            }}
          >
            {row.map((entry) => {
              const canAcceptDrop =
                entry.kind === "directory" || entry.kind === "symlink_directory";
              if (inlineRename?.path === entry.path) {
                // While its name is edited the item is not a button: it would take the
                // field's clicks and key presses as its own.
                return (
                  // biome-ignore lint/a11y/useFocusableInteractive: the name field inside holds the focus.
                  // biome-ignore lint/a11y/useSemanticElements: a native option cannot hold a text field.
                  <div
                    role="option"
                    key={entry.path}
                    className="flow-item active inactive renaming"
                    data-selectable-entry-path={entry.path}
                    aria-selected="true"
                  >
                    <FileIcon entry={entry} />
                    <InlineRenameField
                      name={entry.name}
                      extension={entry.extension}
                      error={inlineRename.error}
                      onSubmit={onInlineRenameSubmit}
                      onCancel={onInlineRenameCancel}
                    />
                  </div>
                );
              }
              return (
                // biome-ignore lint/a11y/useSemanticElements: entries stay buttons for activation; role="option" overrides the implicit role on purpose.
                <button
                  role="option"
                  key={entry.path}
                  type="button"
                  className={`flow-item${selectedPathSet.has(entry.path) ? " active" : ""}${
                    selectedPathSet.has(entry.path) && !isFocused ? " inactive" : ""
                  }${clipboardMarkClassName(clipboardMarks, entry.path)}`}
                  data-drop-target-state={
                    canAcceptDrop ? (getItemDropIndicator?.(entry.path) ?? "none") : "none"
                  }
                  data-selectable-entry-path={entry.path}
                  draggable={Boolean(onItemDragStart)}
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    if (event.metaKey || event.shiftKey || !selectedPathSet.has(entry.path)) {
                      onSelectionGesture(entry.path, {
                        metaKey: event.metaKey,
                        shiftKey: event.shiftKey,
                      });
                    }
                    containerRef.current?.focus();
                  }}
                  onClick={(event) => {
                    if (
                      isSelectionNarrowingClick(
                        event,
                        selectedPaths.length,
                        selectedPathSet.has(entry.path),
                      )
                    ) {
                      onSelectionGesture(entry.path, { metaKey: false, shiftKey: false });
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    containerRef.current?.focus();
                    onItemContextMenu(entry.path, {
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onDragStart={(event) => onItemDragStart?.(entry, event)}
                  onDragEnd={(event) => onItemDragEnd?.(event)}
                  onDragEnter={
                    canAcceptDrop ? (event) => onItemDragEnter?.(entry, event) : undefined
                  }
                  onDragOver={canAcceptDrop ? (event) => onItemDragOver?.(entry, event) : undefined}
                  onDragLeave={
                    canAcceptDrop ? (event) => onItemDragLeave?.(entry, event) : undefined
                  }
                  onDrop={canAcceptDrop ? (event) => onItemDrop?.(entry, event) : undefined}
                  onDoubleClick={(event) => onActivateEntry(entry, event.metaKey)}
                  title={entry.name}
                  aria-selected={selectedPathSet.has(entry.path)}
                >
                  <FileIcon entry={entry} />
                  <FileNameLabel
                    className="flow-item-label"
                    name={entry.name}
                    extension={entry.extension}
                  />
                  <ClipboardMarkIcon marks={clipboardMarks} path={entry.path} />
                </button>
              );
            })}
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
  onItemDragStart,
  onItemDragEnd,
  onItemDragEnter,
  onItemDragOver,
  onItemDragLeave,
  onItemDrop,
  getItemDropIndicator,
  compactDetailsView = false,
  highlightHoveredItems = true,
  detailColumns = DEFAULT_DETAIL_COLUMN_VISIBILITY,
  detailColumnWidths = DEFAULT_DETAIL_COLUMN_WIDTHS,
  onDetailColumnWidthsChange = () => undefined,
  getFolderSizeLabel,
  sizeBars = null,
  inlineRename,
  onInlineRenameSubmit,
  onInlineRenameCancel,
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
  onActivateEntry: (entry: DirectoryEntry, inNewTab?: boolean) => void;
  onSortChange: (sortBy: IpcRequest<"directory:getSnapshot">["sortBy"]) => void;
  onLayoutColumnsChange: (columns: number) => void;
  onVisiblePathsChange: (paths: string[]) => void;
  onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
  onItemDragStart?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragEnd?: ((event: React.DragEvent<HTMLElement>) => void) | undefined;
  onItemDragEnter?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragOver?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDragLeave?:
    | ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void)
    | undefined;
  onItemDrop?: ((entry: DirectoryEntry, event: React.DragEvent<HTMLElement>) => void) | undefined;
  getItemDropIndicator?: ((path: string) => "valid" | "invalid" | null) | undefined;
  compactDetailsView?: boolean;
  highlightHoveredItems?: boolean;
  detailColumns?: DetailColumnVisibility;
  detailColumnWidths?: DetailColumnWidths;
  onDetailColumnWidthsChange?: (value: DetailColumnWidths) => void;
  getFolderSizeLabel?: ((path: string) => string | null) | undefined;
  sizeBars?: SizeBars | null;
  inlineRename: InlineRenameState | null;
  onInlineRenameSubmit: (nextName: string) => void;
  onInlineRenameCancel: () => void;
}) {
  const clipboardMarks = useClipboardMarks("content");
  const containerRef = useRef<HTMLDivElement | null>(null);
  // The rows scroll below the column header, so what fits on screen is the scroll area's
  // own height, not the whole pane's.
  const { height: rowsViewportHeight } = useElementSize(containerRef);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  // Scroll position lives in refs so scrolling never re-renders by itself; a rAF
  // coalesces scroll events into at most one state update per frame, and that state
  // is the top visible row index, which only changes when the window shifts rows.
  const scrollTopRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollRowIndex, setScrollRowIndex] = useState(0);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  // The chosen columns are fitted to the pane: in a narrow pane Name gives up width and
  // then columns drop away from the right, instead of the table scrolling sideways.
  const { columns: visibleColumns, widths: columnWidths } = useMemo(
    () =>
      fitDetailColumns({
        columns: getVisibleDetailColumns(detailColumns),
        widths: detailColumnWidths,
        availableWidth: Math.max(0, viewportWidth - DETAILS_SCROLLBAR_WIDTH),
      }),
    [detailColumnWidths, detailColumns, viewportWidth],
  );
  const rowHeight = getDetailsRowHeight(compactDetailsView);
  const gridTemplateColumns = useMemo(
    () => visibleColumns.map((key) => `${columnWidths[key]}px`).join(" "),
    [columnWidths, visibleColumns],
  );
  // Header and body widths must come from the same visible-column set so the sticky
  // header remains aligned with the scrollable body.
  const tableWidth = useMemo(
    () => getDetailsTableWidth(columnWidths, visibleColumns),
    [columnWidths, visibleColumns],
  );
  const range = getVirtualRange({
    itemCount: entries.length,
    itemSize: rowHeight,
    viewportSize: rowsViewportHeight > 0 ? rowsViewportHeight : viewportHeight,
    scrollOffset: scrollRowIndex * rowHeight,
    overscan: 10,
  });
  const visibleEntries = entries.slice(range.startIndex, range.endIndex);
  // Report by value (see the list view): the slice is a new array every render.
  const visiblePathsKey = visibleEntries.map((entry) => entry.path).join("\0");

  useEffect(() => {
    onVisiblePathsChange(visiblePathsKey.length > 0 ? visiblePathsKey.split("\0") : []);
  }, [onVisiblePathsChange, visiblePathsKey]);

  useEffect(() => {
    onLayoutColumnsChange(1);
  }, [onLayoutColumnsChange]);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
      resizeCleanupRef.current = null;
      document.body.classList.remove("column-resize-active");
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  // Keep the lead selection visible using the same row height contract virtualization uses.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const effectiveViewportWidth =
      viewportWidth > 0 ? viewportWidth : (container?.clientWidth ?? 0);
    // clientHeight: the visible rows only (no column header, no horizontal scrollbar).
    // The measured size re-runs this when the pane is resized.
    const effectiveViewportHeight = container?.clientHeight ?? rowsViewportHeight;
    if (
      !container ||
      !selectionLeadPath ||
      effectiveViewportWidth <= 0 ||
      effectiveViewportHeight <= 0
    ) {
      return;
    }
    const selectedIndex = entries.findIndex((entry) => entry.path === selectionLeadPath);
    if (selectedIndex < 0) {
      return;
    }
    const itemTop = selectedIndex * rowHeight;
    const itemBottom = itemTop + rowHeight;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + effectiveViewportHeight;

    if (itemTop < viewTop) {
      container.scrollTop = itemTop;
      return;
    }
    if (itemBottom > viewBottom) {
      container.scrollTop = itemBottom - effectiveViewportHeight;
    }
  }, [entries, rowHeight, rowsViewportHeight, selectionLeadPath, viewportWidth]);

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
    // Start from the width on screen: Name may be showing narrower than its saved width.
    const startWidth = columnWidths[key];
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
    const width = clampDetailColumnWidth(key, columnWidths[key] + direction * 12);
    if (width === detailColumnWidths[key]) {
      return;
    }
    onDetailColumnWidthsChange({
      ...detailColumnWidths,
      [key]: width,
    });
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: the virtualized details view is built from styled divs/buttons; a native table cannot express it.
    <div className="details-wrapper" role="grid" aria-multiselectable="true">
      {/* biome-ignore lint/a11y/useSemanticElements: see grid note above; header markup mirrors the styled-div table. */}
      <div className="details-header-shell" role="rowgroup">
        {/* biome-ignore lint/a11y/useFocusableInteractive: focus is owned by the scroll container; header cells expose focusable controls. */}
        {/* biome-ignore lint/a11y/useSemanticElements: see grid note above; header markup mirrors the styled-div table. */}
        <div
          role="row"
          ref={headerRef}
          className={`details-header${compactDetailsView ? " compact" : ""}`}
          style={{
            // The header is translated by body scroll rather than scrolled directly so it
            // stays sticky while still matching the body's horizontal position. The
            // transform is kept in sync imperatively from the scroll handler, so the
            // rendered value only needs to survive re-renders.
            width: `${tableWidth}px`,
            minWidth: "100%",
            gridTemplateColumns,
            transform: `translateX(-${scrollLeftRef.current}px)`,
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
          scrollTopRef.current = event.currentTarget.scrollTop;
          scrollLeftRef.current = event.currentTarget.scrollLeft;
          if (scrollFrameRef.current !== null) {
            return;
          }
          scrollFrameRef.current = window.requestAnimationFrame(() => {
            scrollFrameRef.current = null;
            // The sticky header tracks horizontal scroll imperatively so rows do not
            // re-render on every scrolled pixel.
            if (headerRef.current) {
              headerRef.current.style.transform = `translateX(-${scrollLeftRef.current}px)`;
            }
            const nextRowIndex = Math.floor(Math.max(0, scrollTopRef.current) / rowHeight);
            setScrollRowIndex((prev) => (prev === nextRowIndex ? prev : nextRowIndex));
          });
        }}
      >
        <ContentState
          loading={loading}
          error={error}
          currentPath={currentPath}
          entriesLength={entries.length}
          includeHidden={includeHidden}
        />
        {/* biome-ignore lint/a11y/useSemanticElements: see grid note above; body markup mirrors the styled-div table. */}
        <div
          role="rowgroup"
          className="details-table"
          style={{
            width: `${tableWidth}px`,
            minWidth: "100%",
            // Virtualization pads the unmounted rows above and below the visible slice.
            paddingTop: `${range.startIndex * rowHeight}px`,
            paddingBottom: `${Math.max(0, entries.length - range.endIndex) * rowHeight}px`,
          }}
        >
          {visibleEntries.map((entry, visibleIndex) => {
            const metadata = metadataByPath[entry.path];
            const canAcceptDrop = entry.kind === "directory" || entry.kind === "symlink_directory";
            // Parity comes from the absolute row index so stripes stay put while virtualized
            // rows mount and unmount during scrolling.
            const rowParity = (range.startIndex + visibleIndex) % 2 === 0 ? "even" : "odd";
            if (inlineRename?.path === entry.path) {
              // While its name is edited the row is not a button: it would take the
              // field's clicks and key presses as its own.
              return (
                // biome-ignore lint/a11y/useFocusableInteractive: the name field inside holds the focus.
                // biome-ignore lint/a11y/useSemanticElements: see grid note above; the row mirrors the styled-div table.
                <div
                  role="row"
                  key={entry.path}
                  className="details-row active inactive renaming"
                  data-selectable-entry-path={entry.path}
                  data-row-parity={rowParity}
                  aria-selected="true"
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
                      folderSizeLabel={
                        columnKey === "size" && isFolderLikeEntry(entry)
                          ? (getFolderSizeLabel?.(entry.path) ?? null)
                          : null
                      }
                      sizeBarFraction={
                        columnKey === "size" ? getSizeBarFraction(entry, sizeBars) : null
                      }
                      nameEditor={
                        <InlineRenameField
                          name={entry.name}
                          extension={entry.extension}
                          error={inlineRename.error}
                          onSubmit={onInlineRenameSubmit}
                          onCancel={onInlineRenameCancel}
                        />
                      }
                    />
                  ))}
                </div>
              );
            }
            return (
              // biome-ignore lint/a11y/useSemanticElements: rows stay buttons for activation; role="row" overrides the implicit role on purpose.
              <button
                role="row"
                key={entry.path}
                type="button"
                className={`details-row${selectedPathSet.has(entry.path) ? " active" : ""}${
                  selectedPathSet.has(entry.path) && !isFocused ? " inactive" : ""
                }${clipboardMarkClassName(clipboardMarks, entry.path)}`}
                data-drop-target-state={
                  canAcceptDrop ? (getItemDropIndicator?.(entry.path) ?? "none") : "none"
                }
                data-selectable-entry-path={entry.path}
                data-row-parity={rowParity}
                draggable={Boolean(onItemDragStart)}
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }
                  if (event.metaKey || event.shiftKey || !selectedPathSet.has(entry.path)) {
                    onSelectionGesture(entry.path, {
                      metaKey: event.metaKey,
                      shiftKey: event.shiftKey,
                    });
                  }
                  containerRef.current?.focus();
                }}
                onClick={(event) => {
                  if (
                    isSelectionNarrowingClick(
                      event,
                      selectedPaths.length,
                      selectedPathSet.has(entry.path),
                    )
                  ) {
                    onSelectionGesture(entry.path, { metaKey: false, shiftKey: false });
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  containerRef.current?.focus();
                  onItemContextMenu(entry.path, {
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onDragStart={(event) => onItemDragStart?.(entry, event)}
                onDragEnd={(event) => onItemDragEnd?.(event)}
                onDragEnter={canAcceptDrop ? (event) => onItemDragEnter?.(entry, event) : undefined}
                onDragOver={canAcceptDrop ? (event) => onItemDragOver?.(entry, event) : undefined}
                onDragLeave={canAcceptDrop ? (event) => onItemDragLeave?.(entry, event) : undefined}
                onDrop={canAcceptDrop ? (event) => onItemDrop?.(entry, event) : undefined}
                onDoubleClick={(event) => onActivateEntry(entry, event.metaKey)}
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
                    folderSizeLabel={
                      columnKey === "size" && isFolderLikeEntry(entry)
                        ? (getFolderSizeLabel?.(entry.path) ?? null)
                        : null
                    }
                    sizeBarFraction={
                      columnKey === "size" ? getSizeBarFraction(entry, sizeBars) : null
                    }
                    nameTag={
                      columnKey === "name" ? (
                        <ClipboardMarkIcon marks={clipboardMarks} path={entry.path} />
                      ) : null
                    }
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
  const label = DETAIL_COLUMN_LABELS[columnKey];
  // Only columns the directory snapshot can order are sortable; Date Created and
  // Permissions come from metadata that loads lazily for the visible rows.
  const sortKey = columnKey === "created" || columnKey === "permissions" ? null : columnKey;
  const sortable = sortKey !== null;
  const ariaSort = sortable
    ? active
      ? direction === "asc"
        ? "ascending"
        : "descending"
      : "none"
    : undefined;

  return (
    // biome-ignore lint/a11y/useSemanticElements: header cells are styled divs inside the div-based grid; a native th has no place here.
    <div className="details-header-cell" role="columnheader" aria-sort={ariaSort}>
      {sortable ? (
        <SortButton
          label={label}
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

// A size as a share of the largest size in the folder, for the bar behind it; null when
// bars are off or the size is not known.
function getSizeBarFraction(entry: DirectoryEntry, sizeBars: SizeBars | null): number | null {
  if (!sizeBars || sizeBars.maxBytes <= 0) {
    return null;
  }
  const sizeBytes = sizeBars.getSizeBytes(entry);
  if (sizeBytes === null) {
    return null;
  }
  return Math.max(0, Math.min(1, sizeBytes / sizeBars.maxBytes));
}

function DetailsCell({
  columnKey,
  entry,
  metadata,
  folderSizeLabel = null,
  sizeBarFraction = null,
  nameEditor = null,
  nameTag = null,
}: {
  columnKey: DetailColumnKey;
  entry: DirectoryEntry;
  metadata: DirectoryEntryMetadata | undefined;
  folderSizeLabel?: string | null;
  /** 0 to 1: how much of the size cell its bar fills. */
  sizeBarFraction?: number | null;
  // Shown in place of the name while it is being edited.
  nameEditor?: React.ReactNode;
  // Shown after the name: the icon of an item that is on the clipboard.
  nameTag?: React.ReactNode;
}) {
  // Cells are presentational spans inside the row button; gridcell focus management is
  // intentionally left to the row, so the focusable-interactive rule is suppressed below.
  if (columnKey === "name") {
    return (
      // biome-ignore lint/a11y/useFocusableInteractive: see note above.
      // biome-ignore lint/a11y/useSemanticElements: see note above.
      <span className="details-name" role="gridcell">
        <FileIcon entry={entry} />
        {nameEditor ?? (
          <FileNameLabel
            className="details-name-label"
            name={entry.name}
            extension={entry.extension}
          />
        )}
        {nameTag}
      </span>
    );
  }
  if (columnKey === "size") {
    return (
      // biome-ignore lint/a11y/useFocusableInteractive: see note above.
      // biome-ignore lint/a11y/useSemanticElements: see note above.
      <span role="gridcell" className="details-size">
        {sizeBarFraction !== null && sizeBarFraction > 0 ? (
          // A size too small to see at this scale still shows a sliver (a minimum width).
          <span
            className="details-size-bar"
            aria-hidden="true"
            style={{ width: `${sizeBarFraction * 100}%` }}
          />
        ) : null}
        <span className="details-size-text">
          {folderSizeLabel ?? formatDetailSize(entry, metadata)}
        </span>
      </span>
    );
  }
  if (columnKey === "modified") {
    return <DetailsDateCell value={metadata?.modifiedAt} />;
  }
  if (columnKey === "created") {
    return <DetailsDateCell value={metadata?.createdAt} />;
  }
  if (columnKey === "kind") {
    // biome-ignore lint/a11y/useFocusableInteractive: see note above.
    // biome-ignore lint/a11y/useSemanticElements: see note above.
    return <span role="gridcell">{metadata?.kindLabel ?? ""}</span>;
  }
  const permissions = splitPermissionMode(metadata?.permissionMode ?? null);
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: see note above.
    // biome-ignore lint/a11y/useSemanticElements: see note above.
    <span role="gridcell" className="details-permissions" title={permissions?.symbolic}>
      {permissions?.octal ?? ""}
    </span>
  );
}

// A date said relative to now ("24 min ago", "Today, 9:12 AM"); the whole date is the
// tooltip. Empty while the row's metadata is still loading.
function DetailsDateCell({ value }: { value: string | null | undefined }) {
  const date = useRelativeDate(value);
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: cells are presentational; the row has the focus.
    // biome-ignore lint/a11y/useSemanticElements: the grid is built from spans inside the row button.
    <span role="gridcell" title={date?.exact}>
      {date?.text ?? ""}
    </span>
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
      aria-label={label}
    >
      <span>{label}</span>
      {active ? (
        <span className="details-sort-indicator">{direction === "asc" ? "↑" : "↓"}</span>
      ) : null}
    </button>
  );
}

function isFolderLikeEntry(entry: DirectoryEntry): boolean {
  return (
    entry.kind === "directory" || entry.kind === "symlink_directory" || entry.kind === "bundle"
  );
}

function formatDetailSize(
  entry: DirectoryEntry,
  metadata: DirectoryEntryMetadata | undefined,
): string {
  // Directories and bundles show `-` by design. Empty string is reserved for metadata that is still loading.
  if (entry.kind === "directory" || entry.kind === "symlink_directory" || entry.kind === "bundle") {
    return "-";
  }
  if (!metadata || metadata.sizeStatus === "deferred") {
    return "";
  }
  return formatSize(metadata.sizeBytes, metadata.sizeStatus);
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
        <FolderIcon
          className="empty-state-folder-icon"
          open={hasDirectoryPath}
          variant={hasDirectoryPath ? "filled" : "outline"}
          showCue={!hasDirectoryPath}
        />
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
