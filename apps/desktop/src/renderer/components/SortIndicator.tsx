// The sort direction beside a column title, drawn as Finder draws it: a chevron that points
// up for ascending and down for descending. The Details view and search results share it.
export function SortIndicator({ direction }: { direction: "asc" | "desc" }) {
  return (
    <svg
      className="sort-indicator"
      data-direction={direction}
      viewBox="0 0 10 6"
      aria-hidden="true"
    >
      <path d={direction === "asc" ? "M1 5l4-4 4 4" : "M1 1l4 4 4-4"} />
    </svg>
  );
}
