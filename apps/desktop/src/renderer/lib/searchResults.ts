import type { IpcResponse } from "@filetrail/contracts";

import type {
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
