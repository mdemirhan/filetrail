import type { IpcResponse } from "@filetrail/contracts";

import type {
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";

type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];

// Search updates arrive incrementally from fd-backed polling, so appending is the common path.
export function appendSearchResults(
  current: SearchResultItem[],
  next: SearchResultItem[],
): SearchResultItem[] {
  return next.length === 0 ? current : [...current, ...next];
}

// Sorting is pure and stable-by-tiebreaker so the Apply Sort action can safely reorder
// already-fetched results without mutating the original array.
export function sortSearchResults(
  items: SearchResultItem[],
  sortBy: SearchResultsSortByPreference,
  sortDirection: SearchResultsSortDirectionPreference,
): SearchResultItem[] {
  const direction = sortDirection === "asc" ? 1 : -1;
  return [...items].sort((left, right) => compareSearchResults(left, right, sortBy) * direction);
}

// Filtering only affects the in-memory result set currently loaded into the renderer; it
// does not re-run the underlying filesystem search.
export function filterSearchResults(items: SearchResultItem[], query: string): SearchResultItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return items;
  }

  return items.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery));
}

// Path is the deterministic tie-breaker so sort output remains stable across repeated runs.
export function compareSearchResults(
  left: SearchResultItem,
  right: SearchResultItem,
  sortBy: SearchResultsSortByPreference,
): number {
  if (sortBy === "name") {
    return (
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
    );
  }

  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

// One line of search status: result count, elapsed time, and selection.
export function formatSearchStatus({
  isSearching,
  shown,
  totalCount,
  elapsedMs,
  selectedCount,
}: {
  isSearching: boolean;
  shown: number;
  totalCount: number;
  elapsedMs: number | null;
  selectedCount: number;
}): string {
  const noun = totalCount === 1 ? "result" : "results";
  const count =
    shown === totalCount ? `${totalCount} ${noun}` : `${shown} of ${totalCount} ${noun}`;
  const parts = [isSearching ? `Searching… ${count}` : count];
  if (!isSearching && elapsedMs !== null) {
    parts.push(formatElapsed(elapsedMs));
  }
  if (selectedCount > 0) {
    parts.push(`${selectedCount} selected`);
  }
  return parts.join(" · ");
}

function formatElapsed(elapsedMs: number): string {
  return elapsedMs < 1000 ? `${elapsedMs} ms` : `${(elapsedMs / 1000).toFixed(1)} s`;
}
