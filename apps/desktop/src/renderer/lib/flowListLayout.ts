import type { FlowListLayout } from "./virtualization";

export const FLOW_LIST_LAYOUT = {
  rowHeight: 44,
  rowGap: 4,
  itemWidth: 292,
  columnGap: 18,
  paddingTop: 10,
  paddingBottom: 4,
  paddingInline: 20,
} as const satisfies FlowListLayout & { paddingInline: number };

export const COMPACT_FLOW_LIST_LAYOUT = {
  rowHeight: 36,
  rowGap: 2,
  itemWidth: 292,
  columnGap: 18,
  paddingTop: 8,
  paddingBottom: 4,
  paddingInline: 20,
} as const satisfies FlowListLayout & { paddingInline: number };

export function getFlowListLayout(compact: boolean) {
  return compact ? COMPACT_FLOW_LIST_LAYOUT : FLOW_LIST_LAYOUT;
}

export function getFlowListColumnStep(compact: boolean): number {
  const layout = getFlowListLayout(compact);
  return layout.itemWidth + layout.columnGap;
}

export function getFlowListRevealScrollLeft(args: {
  currentScrollLeft: number;
  viewportWidth: number;
  itemIndex: number;
  rowsPerColumn: number;
  compact: boolean;
  maxScrollLeft?: number;
}): number {
  const { currentScrollLeft, viewportWidth, itemIndex, rowsPerColumn, compact, maxScrollLeft } = args;
  const layout = getFlowListLayout(compact);
  const safeRowsPerColumn = Math.max(1, rowsPerColumn);
  const columnIndex = Math.max(0, Math.floor(Math.max(0, itemIndex) / safeRowsPerColumn));
  const itemLeft = columnIndex * getFlowListColumnStep(compact);
  const itemRight = itemLeft + layout.itemWidth;
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
