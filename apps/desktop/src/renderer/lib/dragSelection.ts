import type { IconGridLayout } from "./iconGridLayout";
import type { FlowListLayout } from "./virtualization";

// Drag-to-select: a drag that starts on empty space in the content pane draws a box and
// selects the items it touches, as in Finder. The views are virtualized, so the items under
// the box are worked out from the same layout tokens their scrolling uses, not from the DOM.

// A rectangle in pixels. Each view's hit test takes it relative to the top-left corner of
// the element that holds its items.
export type DragSelectionBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type DragSelectionHit = {
  path: string;
  rect: DragSelectionBox;
};

type PathEntry = {
  path: string;
};

// The size of the part of an item that takes clicks and depends on its name (the name
// under an icon; a list item, as wide as its icon and name), measured on screen. An item that has not
// been shown is taken at the largest size.
export type DragSelectionSize = { width: number; height: number };
export type DragSelectionSizes = ReadonlyMap<string, DragSelectionSize>;

const NO_SIZES: DragSelectionSizes = new Map();

// ⇧ adds what the box touches to the selection the drag started with, ⌘ flips it, as in
// Finder; a plain drag selects only what the box touches.
export type DragSelectionMode = "replace" | "add" | "toggle";

export function getDragSelectionMode(modifiers: {
  metaKey: boolean;
  shiftKey: boolean;
}): DragSelectionMode {
  if (modifiers.metaKey) {
    return "toggle";
  }
  return modifiers.shiftKey ? "add" : "replace";
}

export function makeDragSelectionBox(
  start: { x: number; y: number },
  end: { x: number; y: number },
): DragSelectionBox {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    right: Math.max(start.x, end.x),
    bottom: Math.max(start.y, end.y),
  };
}

function boxesIntersect(a: DragSelectionBox, b: DragSelectionBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// List view: one row per item, at least as wide as the pane, so only the box's height
// matters.
export function getDetailsItemsInBox<T extends PathEntry>(args: {
  box: DragSelectionBox;
  entries: T[];
  rowHeight: number;
}): DragSelectionHit[] {
  const { box, entries, rowHeight } = args;
  const firstRow = Math.max(0, Math.floor(box.top / rowHeight));
  const lastRow = Math.min(entries.length - 1, Math.ceil(box.bottom / rowHeight) - 1);
  const hits: DragSelectionHit[] = [];
  for (let index = firstRow; index <= lastRow; index += 1) {
    const entry = entries[index];
    if (entry) {
      hits.push({
        path: entry.path,
        rect: {
          left: box.left,
          top: index * rowHeight,
          right: box.right,
          bottom: (index + 1) * rowHeight,
        },
      });
    }
  }
  return hits;
}

// Flow list: items fill a column top to bottom, then go on in the next column. An item is
// as wide as its icon and name, at most its column's width.
export function getFlowListItemsInBox<T extends PathEntry>(args: {
  box: DragSelectionBox;
  entries: T[];
  rowsPerColumn: number;
  layout: Pick<FlowListLayout, "rowHeight" | "itemWidth" | "columnGap">;
  sizes?: DragSelectionSizes;
}): DragSelectionHit[] {
  const { box, entries, layout, sizes = NO_SIZES } = args;
  const rowsPerColumn = Math.max(1, args.rowsPerColumn);
  const columnStep = layout.itemWidth + layout.columnGap;
  const columnCount = Math.ceil(entries.length / rowsPerColumn);
  const firstColumn = Math.max(0, Math.floor(box.left / columnStep));
  const lastColumn = Math.min(columnCount - 1, Math.floor(box.right / columnStep));
  const firstRow = Math.max(0, Math.floor(box.top / layout.rowHeight));
  const lastRow = Math.min(rowsPerColumn - 1, Math.ceil(box.bottom / layout.rowHeight) - 1);
  const hits: DragSelectionHit[] = [];
  for (let column = firstColumn; column <= lastColumn; column += 1) {
    for (let row = firstRow; row <= lastRow; row += 1) {
      const entry = entries[column * rowsPerColumn + row];
      if (!entry) {
        continue;
      }
      const left = column * columnStep;
      const width = Math.min(layout.itemWidth, sizes.get(entry.path)?.width ?? layout.itemWidth);
      const top = row * layout.rowHeight;
      const rect = { left, top, right: left + width, bottom: top + layout.rowHeight };
      if (boxesIntersect(box, rect)) {
        hits.push({ path: entry.path, rect });
      }
    }
  }
  return hits;
}

// Icon view: items read left to right in columns that share the grid's width, each item in
// the middle of its column (see `.icon-grid-items` in styles.css). An item is touched on its
// icon's tile or on its name, not on the space around them.
export function getIconGridItemsInBox<T extends PathEntry>(args: {
  box: DragSelectionBox;
  entries: T[];
  columns: number;
  gridWidth: number;
  layout: Pick<
    IconGridLayout,
    "rowHeight" | "itemPaddingTop" | "iconBoxSize" | "labelGap" | "labelWidth"
  >;
  sizes?: DragSelectionSizes;
}): DragSelectionHit[] {
  const { box, entries, gridWidth, layout, sizes = NO_SIZES } = args;
  const columns = Math.max(1, args.columns);
  const columnWidth = gridWidth / columns;
  const tileTop = layout.itemPaddingTop;
  const labelTop = tileTop + layout.iconBoxSize + layout.labelGap;
  // `.icon-item` is 2px shorter than its row.
  const tallestLabel = layout.rowHeight - 2 - labelTop;
  const rowCount = Math.ceil(entries.length / columns);
  const firstRow = Math.max(0, Math.floor(box.top / layout.rowHeight));
  const lastRow = Math.min(rowCount - 1, Math.floor(box.bottom / layout.rowHeight));
  const hits: DragSelectionHit[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const entry = entries[row * columns + column];
      if (!entry) {
        continue;
      }
      const center = (column + 0.5) * columnWidth;
      const top = row * layout.rowHeight;
      const tile = {
        left: center - layout.iconBoxSize / 2,
        top: top + tileTop,
        right: center + layout.iconBoxSize / 2,
        bottom: top + tileTop + layout.iconBoxSize,
      };
      const size = sizes.get(entry.path);
      const labelWidth = Math.min(layout.labelWidth, size?.width ?? layout.labelWidth);
      const label = {
        left: center - labelWidth / 2,
        top: top + labelTop,
        right: center + labelWidth / 2,
        bottom: top + labelTop + Math.min(tallestLabel, size?.height ?? tallestLabel),
      };
      if (boxesIntersect(box, tile) || boxesIntersect(box, label)) {
        hits.push({
          path: entry.path,
          rect: {
            left: Math.min(tile.left, label.left),
            top: tile.top,
            right: Math.max(tile.right, label.right),
            bottom: label.bottom,
          },
        });
      }
    }
  }
  return hits;
}

// The selection while the box is drawn: what it touches, combined with the selection the
// drag started with by the mode.
export function combineDragSelection(
  startPaths: string[],
  hitPaths: string[],
  mode: DragSelectionMode,
): string[] {
  if (mode === "replace") {
    return hitPaths;
  }
  const hit = new Set(hitPaths);
  if (mode === "add") {
    return [...startPaths.filter((path) => !hit.has(path)), ...hitPaths];
  }
  const start = new Set(startPaths);
  return [
    ...startPaths.filter((path) => !hit.has(path)),
    ...hitPaths.filter((path) => !start.has(path)),
  ];
}

// How far to scroll this frame while the pointer is `overshoot` pixels past an edge of the
// pane: faster the further out it is.
export function getDragSelectionAutoScrollStep(overshoot: number): number {
  if (overshoot === 0) {
    return 0;
  }
  return Math.sign(overshoot) * Math.min(40, 4 + Math.abs(overshoot) / 3);
}
