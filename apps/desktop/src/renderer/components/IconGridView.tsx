import {
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { IpcResponse } from "@filetrail/contracts";

import { useDragSelection } from "../hooks/useDragSelection";
import { useElementSize } from "../hooks/useElementSize";
import {
  ClipboardMarkIcon,
  clipboardMarkClassName,
  useClipboardMarks,
} from "../lib/clipboardMarks";
import { isSelectionNarrowingClick } from "../lib/contentSelection";
import { getIconGridItemsInBox } from "../lib/dragSelection";
import { FileThumbnail } from "../lib/fileThumbnails";
import {
  computeIconGridColumns,
  getIconGridLayout,
  getIconGridRevealScrollTop,
} from "../lib/iconGridLayout";
import { fitIconLabel } from "../lib/iconLabel";
import {
  NameHighlightContext,
  findNameMatch,
  mapMatchToLabel,
  renderMarkedText,
} from "../lib/nameHighlight";
import { PANE_LAYOUT_CHANGE_MS, usePaneLayoutChange } from "../lib/paneLayoutChange";
import { getVirtualRange } from "../lib/virtualization";
import {
  InlineRenameField,
  type InlineRenameState,
  OffscreenRenameField,
  findOffscreenRenameEntry,
  isFolderKind,
  renameDraftKey,
} from "./InlineRenameField";

type DirectoryEntry = IpcResponse<"directory:getSnapshot">["entries"][number];
type SelectionGestureModifiers = {
  metaKey: boolean;
  shiftKey: boolean;
};

// Icon view: a grid of large icons that reads left to right and scrolls down. Files show
// the Quick Look preview of their content where there is one. Rows have a fixed height
// (see `iconGridLayout`), so only the rows on screen are mounted.
export function IconGridView({
  entries,
  isFocused,
  selectedPaths,
  selectionLeadPath,
  viewportWidth,
  viewportHeight,
  onSelectionGesture,
  onSelectPaths,
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
  compactIconView = false,
  inlineRename,
  onInlineRenameSubmit,
  onInlineRenameCancel,
  children,
}: {
  entries: DirectoryEntry[];
  isFocused: boolean;
  selectedPaths: string[];
  selectionLeadPath: string | null;
  viewportWidth: number;
  viewportHeight: number;
  onSelectionGesture: (path: string, modifiers: SelectionGestureModifiers) => void;
  onSelectPaths?: ((paths: string[], leadPath: string | null) => void) | undefined;
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
  compactIconView?: boolean;
  inlineRename: InlineRenameState | null;
  onInlineRenameSubmit: (nextName: string) => void;
  onInlineRenameCancel: () => void;
  /** The loading, error or empty-folder message, drawn in place of the grid. */
  children?: ReactNode;
}) {
  const clipboardMarks = useClipboardMarks("content");
  const highlight = useContext(NameHighlightContext);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { width: containerWidth, height: containerHeight } = useElementSize(containerRef);
  // Scroll position lives in a ref so scrolling never re-renders by itself; a rAF
  // coalesces scroll events into at most one state update per frame, and that state
  // is the top visible row index, which only changes when the window shifts rows.
  const scrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const [scrollRowIndex, setScrollRowIndex] = useState(0);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  // Stands for this reading of the folder: previews are checked against their files once
  // for each new list of items (see `FileThumbnail`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new token for every new list is the point.
  const listing = useMemo(() => ({}), [entries]);

  useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }
    },
    [],
  );

  const layout = getIconGridLayout(compactIconView);
  // When the Info panel opens or closes, the grid's width is measured right away rather than
  // on the next frame, so the items land in their new columns before anything is painted;
  // the measured size takes over again once it has caught up.
  const layoutChange = usePaneLayoutChange();
  const handledLayoutChangeRef = useRef(layoutChange);
  const [immediateWidth, setImmediateWidth] = useState<{
    width: number;
    measuredBefore: number;
  } | null>(null);
  // The immediate width asked for and not rendered yet: the items move once it is.
  const pendingImmediateWidthRef = useRef<typeof immediateWidth>(null);
  const gridWidth =
    immediateWidth && containerWidth === immediateWidth.measuredBefore
      ? immediateWidth.width
      : containerWidth;
  // Until the grid itself is measured, the pane's width gives the same answer.
  const columns = computeIconGridColumns(gridWidth > 0 ? gridWidth : viewportWidth, layout);
  const rowCount = Math.ceil(entries.length / columns);
  const range = getVirtualRange({
    itemCount: rowCount,
    itemSize: layout.rowHeight,
    viewportSize: containerHeight > 0 ? containerHeight : viewportHeight,
    scrollOffset: scrollRowIndex * layout.rowHeight,
    overscan: 3,
  });
  const visibleEntries = entries.slice(range.startIndex * columns, range.endIndex * columns);
  // Report by value: the slice is a new array every render, and depending on it would
  // re-render the parent in an endless loop.
  const visiblePathsKey = visibleEntries.map((entry) => entry.path).join("\0");
  const offscreenRenameEntry = findOffscreenRenameEntry(entries, visibleEntries, inlineRename);

  useEffect(() => {
    onVisiblePathsChange(visiblePathsKey.length > 0 ? visiblePathsKey.split("\0") : []);
  }, [onVisiblePathsChange, visiblePathsKey]);

  useLayoutEffect(() => {
    if (handledLayoutChangeRef.current === layoutChange) {
      return;
    }
    handledLayoutChangeRef.current = layoutChange;
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const next = {
      width: Math.round(container.getBoundingClientRect().width),
      measuredBefore: containerWidth,
    };
    pendingImmediateWidthRef.current = next;
    setImmediateWidth(next);
  }, [layoutChange, containerWidth]);

  // Where each item on screen was laid out, to move it from there when the Info panel opens
  // or closes. Kept after every render except the one in which the grid's width has just
  // changed and its columns have not been worked out again yet.
  const listRef = useRef<HTMLDivElement | null>(null);
  const { boxRef, startDragSelection } = useDragSelection({
    containerRef,
    itemsRef: listRef,
    getItemsInBox: (box, sizes) =>
      getIconGridItemsInBox({
        box,
        entries,
        columns,
        gridWidth: listRef.current?.clientWidth ?? 0,
        layout,
        sizes,
      }),
    measuredPartSelector: ".icon-item-label",
    selectedPaths,
    selectionLeadPath,
    onSelectPaths,
  });
  const itemPlacesRef = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const list = listRef.current;
    const pending = pendingImmediateWidthRef.current;
    if (!list || (pending !== null && pending !== immediateWidth)) {
      return;
    }
    const animate = pending !== null;
    pendingImmediateWidthRef.current = null;
    const previous = itemPlacesRef.current;
    const next = new Map<string, { left: number; top: number }>();
    for (const item of Array.from(
      list.querySelectorAll<HTMLElement>("[data-selectable-entry-path]"),
    )) {
      const path = item.dataset.selectableEntryPath ?? "";
      const place = { left: item.offsetLeft, top: item.offsetTop };
      next.set(path, place);
      const before = previous.get(path);
      if (!animate || !before || typeof item.animate !== "function") {
        continue;
      }
      const dx = before.left - place.left;
      const dy = before.top - place.top;
      if (dx === 0 && dy === 0) {
        continue;
      }
      for (const running of item.getAnimations()) {
        running.cancel();
      }
      item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
        duration: prefersReducedMotion() ? 0 : PANE_LAYOUT_CHANGE_MS,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
    }
    itemPlacesRef.current = next;
  });

  // Arrow keys and paging move by rows of this many items.
  useEffect(() => {
    onLayoutColumnsChange(columns);
  }, [columns, onLayoutColumnsChange]);

  // Keep the lead selection visible using the same row height contract virtualization uses.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a refused name (refusalCount) brings the row back into view, where the reason is shown.
  useLayoutEffect(() => {
    const container = containerRef.current;
    // The measured size re-runs this when the pane is resized.
    const effectiveViewportHeight = container?.clientHeight ?? containerHeight;
    // An item whose name is being edited is the one to keep in view (a rename can start
    // with it scrolled away, and a refused name is shown under it).
    const revealPath = inlineRename?.path ?? selectionLeadPath;
    if (!container || !revealPath || effectiveViewportHeight <= 0) {
      return;
    }
    const selectedIndex = entries.findIndex((entry) => entry.path === revealPath);
    if (selectedIndex < 0) {
      return;
    }
    const nextScrollTop = getIconGridRevealScrollTop({
      currentScrollTop: container.scrollTop,
      viewportHeight: effectiveViewportHeight,
      itemIndex: selectedIndex,
      itemCount: entries.length,
      columns,
      layout,
    });
    if (Math.abs(nextScrollTop - container.scrollTop) > 1) {
      container.scrollTop = nextScrollTop;
    }
  }, [
    columns,
    containerHeight,
    entries,
    inlineRename?.path,
    inlineRename?.refusalCount,
    layout,
    selectionLeadPath,
  ]);

  return (
    <div
      ref={containerRef}
      className={`content-scroll icon-grid${compactIconView ? " compact" : ""}`}
      tabIndex={-1}
      onMouseDown={(event) => {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-selectable-entry-path]")) {
          return;
        }
        // ⇧ or ⌘ keeps the selection, for a drag that adds to it.
        if (!event.metaKey && !event.shiftKey) {
          onClearSelection();
        }
        containerRef.current?.focus();
        startDragSelection(event);
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
          const nextRowIndex = Math.floor(
            Math.max(0, scrollTopRef.current - layout.paddingTop) / layout.rowHeight,
          );
          setScrollRowIndex((prev) => (prev === nextRowIndex ? prev : nextRowIndex));
        });
      }}
    >
      {children}
      {/* biome-ignore lint/a11y/useFocusableInteractive: focus is owned by the scroll container; options are buttons and stay keyboard reachable. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a native select cannot host this virtualized grid of icons. */}
      <div
        role="listbox"
        ref={listRef}
        aria-multiselectable="true"
        className="icon-grid-items"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          // Virtualization pads the unmounted rows above and below the visible slice.
          paddingTop: `${range.startIndex * layout.rowHeight}px`,
          paddingBottom: `${Math.max(0, rowCount - range.endIndex) * layout.rowHeight}px`,
        }}
      >
        {visibleEntries.map((entry) => {
          const canAcceptDrop = entry.kind === "directory" || entry.kind === "symlink_directory";
          if (inlineRename?.path === entry.path) {
            // While its name is edited the item is not a button: it would take the
            // field's clicks and key presses as its own.
            return (
              // biome-ignore lint/a11y/useFocusableInteractive: the name field inside holds the focus.
              // biome-ignore lint/a11y/useSemanticElements: a native option cannot hold a text field.
              <div
                role="option"
                key={entry.path}
                className="icon-item active inactive renaming"
                data-selectable-entry-path={entry.path}
                aria-selected="true"
              >
                <span className="icon-item-image">
                  <FileThumbnail entry={entry} listing={listing} />
                </span>
                <InlineRenameField
                  name={entry.name}
                  extension={entry.extension}
                  isFolder={isFolderKind(entry.kind)}
                  error={inlineRename.error}
                  refusalCount={inlineRename.refusalCount ?? 0}
                  draftKey={renameDraftKey(inlineRename)}
                  onSubmit={onInlineRenameSubmit}
                  onCancel={onInlineRenameCancel}
                />
              </div>
            );
          }
          const selected = selectedPathSet.has(entry.path);
          return (
            // biome-ignore lint/a11y/useSemanticElements: entries stay buttons for activation; role="option" overrides the implicit role on purpose.
            <button
              role="option"
              key={entry.path}
              type="button"
              className={`icon-item${selected ? " active" : ""}${
                selected && !isFocused ? " inactive" : ""
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
                if (event.metaKey || event.shiftKey || !selected) {
                  onSelectionGesture(entry.path, {
                    metaKey: event.metaKey,
                    shiftKey: event.shiftKey,
                  });
                }
                containerRef.current?.focus();
              }}
              onClick={(event) => {
                if (isSelectionNarrowingClick(event, selectedPaths.length, selected)) {
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
              title={entry.name}
              aria-label={entry.name}
              aria-selected={selected}
            >
              <span className="icon-item-image">
                <FileThumbnail entry={entry} listing={listing} />
                <ClipboardMarkIcon marks={clipboardMarks} path={entry.path} variant="badge" />
              </span>
              <IconLabel
                name={entry.name}
                extension={entry.extension}
                compact={compactIconView}
                highlight={highlight}
              />
            </button>
          );
        })}
      </div>
      <div ref={boxRef} className="drag-select-box" hidden />
      {offscreenRenameEntry && inlineRename ? (
        <OffscreenRenameField
          entry={offscreenRenameEntry}
          inlineRename={inlineRename}
          onSubmit={onInlineRenameSubmit}
          onCancel={onInlineRenameCancel}
        />
      ) : null}
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// The name under an icon, on up to two lines and shortened in the middle when longer; what a
// search matched is marked in what is left of it.
function IconLabel({
  name,
  extension,
  compact,
  highlight,
}: {
  name: string;
  extension: string;
  compact: boolean;
  highlight: RegExp | null;
}) {
  const label = fitIconLabel(name, extension, compact);
  const match = findNameMatch(highlight, name);
  return (
    <span className="icon-item-label">
      {match ? renderMarkedText(label, mapMatchToLabel(name, label, match)) : label}
    </span>
  );
}
