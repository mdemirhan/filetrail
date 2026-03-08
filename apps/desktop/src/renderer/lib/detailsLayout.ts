import type {
  DetailColumnKey,
  DetailColumnVisibility,
  DetailColumnWidths,
} from "../../shared/appPreferences";

// Shared details-view sizing contract. The renderer uses these values for sticky header
// alignment, virtualization, keyboard paging, and compact-mode switching.
export const DETAILS_LAYOUT = {
  headerHeight: 31,
  regularRowHeight: 36,
  compactRowHeight: 28,
  minTableWidth: 420,
  columnGap: 12,
} as const;

export function getDetailsRowHeight(compact: boolean): number {
  return compact ? DETAILS_LAYOUT.compactRowHeight : DETAILS_LAYOUT.regularRowHeight;
}

// `name` is always present; the remaining columns are optional and preserve a stable order.
export function getVisibleDetailColumns(
  visibility: DetailColumnVisibility,
): ReadonlyArray<DetailColumnKey> {
  return [
    "name",
    ...(visibility.size ? (["size"] as const) : []),
    ...(visibility.modified ? (["modified"] as const) : []),
    ...(visibility.permissions ? (["permissions"] as const) : []),
  ];
}

// The details table has a minimum width even when very few columns are visible so the
// sticky header and body still read as a table instead of collapsing too aggressively.
export function getDetailsTableWidth(
  widths: DetailColumnWidths,
  visibleColumns: ReadonlyArray<DetailColumnKey>,
): number {
  const contentWidth = visibleColumns.reduce((total, key) => total + widths[key], 0);
  return Math.max(
    DETAILS_LAYOUT.minTableWidth,
    contentWidth + Math.max(0, visibleColumns.length - 1) * DETAILS_LAYOUT.columnGap,
  );
}
