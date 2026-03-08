import type {
  DetailColumnKey,
  DetailColumnVisibility,
  DetailColumnWidths,
} from "../../shared/appPreferences";

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
