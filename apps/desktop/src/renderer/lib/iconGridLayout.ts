// Icon view sizing contract. These tokens must stay aligned with the `.icon-grid` rules in
// styles.css: virtualization, keyboard movement and reveal-into-view all read from this
// module rather than measuring the DOM.
export type IconGridLayout = {
  // Side of the square the icon or preview is drawn in.
  iconSize: number;
  // Every column is this wide. Space left over stays at the right edge, as in Finder, so
  // items don't move sideways when the pane gets wider or narrower (opening the Info
  // panel, resizing the window); they only reflow when a column is added or removed.
  cellWidth: number;
  // Row pitch: icon, name on up to two lines, and the spacing around them.
  rowHeight: number;
  paddingTop: number;
  paddingBottom: number;
  // Space kept free on each side; on the right it includes the scrollbar.
  paddingInline: number;
};

export const ICON_GRID_LAYOUT: IconGridLayout = {
  iconSize: 64,
  cellWidth: 104,
  rowHeight: 116,
  paddingTop: 10,
  paddingBottom: 10,
  paddingInline: 16,
};

export const COMPACT_ICON_GRID_LAYOUT: IconGridLayout = {
  iconSize: 48,
  cellWidth: 88,
  rowHeight: 94,
  paddingTop: 8,
  paddingBottom: 8,
  paddingInline: 16,
};

export function getIconGridLayout(compact: boolean): IconGridLayout {
  return compact ? COMPACT_ICON_GRID_LAYOUT : ICON_GRID_LAYOUT;
}

// How many columns fit across the pane. A width of 0 means the pane has not been measured
// yet; one column keeps the math valid until it is.
export function computeIconGridColumns(containerWidth: number, layout: IconGridLayout): number {
  const availableWidth = containerWidth - layout.paddingInline * 2;
  return Math.max(1, Math.floor(availableWidth / layout.cellWidth));
}

// Vertical scroll offset that brings the row holding `itemIndex` fully into view, moving
// as little as possible. The first and last rows also bring the padding next to them in.
export function getIconGridRevealScrollTop(args: {
  currentScrollTop: number;
  viewportHeight: number;
  itemIndex: number;
  itemCount: number;
  columns: number;
  layout: IconGridLayout;
}): number {
  const { currentScrollTop, viewportHeight, itemIndex, itemCount, columns, layout } = args;
  const safeColumns = Math.max(1, columns);
  const rowIndex = Math.floor(Math.max(0, itemIndex) / safeColumns);
  const lastRowIndex = Math.max(0, Math.ceil(itemCount / safeColumns) - 1);
  const rowTop = rowIndex === 0 ? 0 : layout.paddingTop + rowIndex * layout.rowHeight;
  const rowBottom =
    layout.paddingTop +
    (rowIndex + 1) * layout.rowHeight +
    (rowIndex >= lastRowIndex ? layout.paddingBottom : 0);

  if (rowTop < currentScrollTop) {
    return rowTop;
  }
  if (rowBottom > currentScrollTop + viewportHeight) {
    return Math.max(0, Math.min(rowTop, rowBottom - viewportHeight));
  }
  return currentScrollTop;
}
