import type {
  DetailColumnKey,
  DetailColumnVisibility,
  DetailColumnWidths,
} from "../../shared/appPreferences";

// Shared details-view sizing contract. The renderer uses these values for sticky header
// alignment, virtualization, keyboard paging, and compact-mode switching.
export const DETAILS_LAYOUT = {
  regularRowHeight: 28,
  compactRowHeight: 24,
  columnGap: 12,
  // Left plus right padding of a row and of the header (`padding: 0 12px` in styles.css).
  rowPadding: 24,
  // How far the Name column may shrink to keep the other columns on screen.
  nameFloorWidth: 160,
  // Name is never narrower than this, even when it is the only column left.
  nameMinWidth: 96,
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

// Width of the table: its columns, the gaps between them and the row padding. Rows are
// also at least as wide as the pane, so a narrow table still fills it.
export function getDetailsTableWidth(
  widths: DetailColumnWidths,
  visibleColumns: ReadonlyArray<DetailColumnKey>,
): number {
  const contentWidth = visibleColumns.reduce((total, key) => total + widths[key], 0);
  return (
    contentWidth +
    Math.max(0, visibleColumns.length - 1) * DETAILS_LAYOUT.columnGap +
    DETAILS_LAYOUT.rowPadding
  );
}

// Fits the columns into the pane instead of letting the table scroll sideways. When the
// pane is too narrow, the Name column first gives up width (down to `nameFloorWidth`),
// then columns drop away one at a time from the right. The saved widths and the saved
// column choices are not changed: everything comes back when the pane is wider again.
// An `availableWidth` of 0 means the pane has not been measured yet, so nothing is fitted.
export function fitDetailColumns(args: {
  columns: ReadonlyArray<DetailColumnKey>;
  widths: DetailColumnWidths;
  availableWidth: number;
}): { columns: ReadonlyArray<DetailColumnKey>; widths: DetailColumnWidths } {
  const { widths, availableWidth } = args;
  if (availableWidth <= 0 || getDetailsTableWidth(widths, args.columns) <= availableWidth) {
    return { columns: args.columns, widths };
  }
  const nameFloor = Math.min(widths.name, DETAILS_LAYOUT.nameFloorWidth);
  const columns = [...args.columns];
  while (
    columns.length > 1 &&
    getDetailsTableWidth({ ...widths, name: nameFloor }, columns) > availableWidth
  ) {
    columns.pop();
  }
  // Name takes whatever the remaining columns leave over.
  const widthWithoutName = getDetailsTableWidth({ ...widths, name: 0 }, columns);
  const name = Math.max(
    Math.min(DETAILS_LAYOUT.nameMinWidth, widths.name),
    Math.min(widths.name, availableWidth - widthWithoutName),
  );
  return { columns, widths: { ...widths, name } };
}
