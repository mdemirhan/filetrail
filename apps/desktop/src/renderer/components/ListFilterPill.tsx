import { ClearButton } from "./ClearButton";

// What has been typed to narrow the list above it, how much of the list is left, and a way
// to bring the rest back. It floats over the foot of the list so the first match, which is
// selected at the top, is never covered.
export function ListFilterPill({
  query,
  shownCount,
  totalCount,
  onClear,
}: {
  query: string;
  shownCount: number;
  totalCount: number;
  onClear: () => void;
}) {
  if (query.length === 0) {
    return null;
  }
  return (
    <div className="list-filter-pill" aria-live="polite">
      <span className="list-filter-pill-label">Filter</span>
      <span className="list-filter-pill-value">{query}</span>
      <span className="list-filter-pill-count">
        {shownCount} of {totalCount}
      </span>
      <ClearButton
        aria-label="Clear filter"
        title="Clear Filter (Esc)"
        tabIndex={-1}
        // The list keeps the keyboard, so typing can continue after a click here.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClear}
      />
    </div>
  );
}
