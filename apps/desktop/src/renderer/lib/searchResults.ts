import type { IpcResponse } from "@filetrail/contracts";

import type {
  SearchResultsFilterScopePreference,
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
export function filterSearchResults(
  items: SearchResultItem[],
  query: string,
  scope: SearchResultsFilterScopePreference,
): SearchResultItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return items;
  }

  return items.filter((item) => {
    const haystack = scope === "path" ? item.path : item.name;
    return haystack.toLocaleLowerCase().includes(normalizedQuery);
  });
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
