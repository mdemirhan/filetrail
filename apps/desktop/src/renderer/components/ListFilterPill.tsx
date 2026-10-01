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
      <button
        type="button"
        className="list-filter-pill-clear"
        aria-label="Clear filter"
        title="Clear filter (Esc)"
        tabIndex={-1}
        // The list keeps the keyboard, so typing can continue after a click here.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClear}
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </div>
  );
}
