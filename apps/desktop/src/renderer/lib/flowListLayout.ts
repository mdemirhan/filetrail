import type { FlowListLayout } from "./virtualization";

// These layout tokens must stay aligned with the corresponding CSS row sizing. Navigation,
// reveal-into-view, and virtualization all read from this module rather than measuring DOM.
export const FLOW_LIST_LAYOUT = {
  rowHeight: 36,
  rowGap: 2,
  itemWidth: 292,
  columnGap: 18,
  paddingTop: 8,
  paddingBottom: 4,
  paddingInline: 20,
} as const satisfies FlowListLayout & { paddingInline: number };

export const COMPACT_FLOW_LIST_LAYOUT = {
  rowHeight: 28,
  rowGap: 1,
  itemWidth: 252,
  columnGap: 18,
  paddingTop: 6,
  paddingBottom: 4,
  paddingInline: 20,
} as const satisfies FlowListLayout & { paddingInline: number };

export function getFlowListLayout(compact: boolean) {
  return compact ? COMPACT_FLOW_LIST_LAYOUT : FLOW_LIST_LAYOUT;
}

// One horizontal "page step" in flow-list view is exactly one rendered column.
export function getFlowListColumnStep(compact: boolean): number {
  const layout = getFlowListLayout(compact);
  return layout.itemWidth + layout.columnGap;
}

// Computes the horizontal scroll offset needed to make a given item fully visible.
// Because flow-list view is column-major, item index -> column index depends on the
// current rows-per-column count, not just the viewport width.
export function getFlowListRevealScrollLeft(args: {
  currentScrollLeft: number;
  viewportWidth: number;
  itemIndex: number;
  rowsPerColumn: number;
  compact: boolean;
  maxScrollLeft?: number;
}): number {
  const { currentScrollLeft, viewportWidth, itemIndex, rowsPerColumn, compact, maxScrollLeft } =
    args;
  const layout = getFlowListLayout(compact);
  const safeRowsPerColumn = Math.max(1, rowsPerColumn);
  const columnIndex = Math.max(0, Math.floor(Math.max(0, itemIndex) / safeRowsPerColumn));
  const itemLeft = columnIndex * getFlowListColumnStep(compact);
  const itemRight = itemLeft + layout.itemWidth;
  // The visible content width excludes side padding baked into the layout tokens.
  const availableWidth = Math.max(1, viewportWidth - layout.paddingInline * 2);

  let nextScrollLeft = currentScrollLeft;
  if (itemLeft < currentScrollLeft) {
    nextScrollLeft = itemLeft;
  } else if (itemRight > currentScrollLeft + availableWidth) {
    nextScrollLeft = itemRight - availableWidth;
  }

  const maxOffset = Math.max(0, maxScrollLeft ?? Number.POSITIVE_INFINITY);
  return Math.max(0, Math.min(maxOffset, nextScrollLeft));
}
