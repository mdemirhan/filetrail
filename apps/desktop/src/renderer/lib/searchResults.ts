import type { IpcResponse } from "@filetrail/contracts";

import type {
  SearchResultsFilterScopePreference,
  SearchResultsSortByPreference,
  SearchResultsSortDirectionPreference,
} from "../../shared/appPreferences";

type SearchResultItem = IpcResponse<"search:getUpdate">["items"][number];

export function appendSearchResults(
  current: SearchResultItem[],
  next: SearchResultItem[],
): SearchResultItem[] {
  return next.length === 0 ? current : [...current, ...next];
}

export function sortSearchResults(
  items: SearchResultItem[],
  sortBy: SearchResultsSortByPreference,
  sortDirection: SearchResultsSortDirectionPreference,
): SearchResultItem[] {
  const direction = sortDirection === "asc" ? 1 : -1;
  return [...items].sort((left, right) => compareSearchResults(left, right, sortBy) * direction);
}

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
