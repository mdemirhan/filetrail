import type { IpcResponse } from "@filetrail/contracts";

import type {
  SearchMatchScopePreference,
  SearchPatternModePreference,
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
  if (sortBy === "kind") {
    // Kind is told from the extension, which every result has at once (the kind's name
    // loads only for the rows on screen): folders first, then files by extension, those
    // without one last, each group by name.
    return (
      compareKindKeys(searchResultKindKey(left), searchResultKindKey(right)) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.path.localeCompare(right.path, undefined, { sensitivity: "base" })
    );
  }

  return left.path.localeCompare(right.path, undefined, { sensitivity: "base" });
}

// Folders (and links to them) are 0, files with an extension 1, files without one 2.
function searchResultKindKey(item: SearchResultItem): [number, string] {
  if (item.kind === "directory" || item.kind === "symlink_directory") {
    return [0, ""];
  }
  return item.extension ? [1, item.extension.toLowerCase()] : [2, ""];
}

function compareKindKeys(left: [number, string], right: [number, string]): number {
  return left[0] - right[0] || left[1].localeCompare(right[1]);
}

// One line of search status: the result count and the selection. (How long the search
// took is for the log, not the window.)
export function formatSearchStatus({
  isSearching,
  shown,
  totalCount,
  selectedCount,
}: {
  isSearching: boolean;
  shown: number;
  totalCount: number;
  selectedCount: number;
}): string {
  const noun = totalCount === 1 ? "result" : "results";
  const count =
    shown === totalCount ? `${totalCount} ${noun}` : `${shown} of ${totalCount} ${noun}`;
  const parts = [isSearching ? `Searching… ${count}` : count];
  if (selectedCount > 0) {
    parts.push(`${selectedCount} selected`);
  }
  return parts.join(" · ");
}

// What a name search matched, to mark it in the names. fd uses smart case (case-sensitive
// only when the query has an uppercase letter); glob patterns match the whole name, so they
// are not marked, and neither are patterns JavaScript cannot parse.
export function buildSearchHighlightPattern(
  query: string,
  patternMode: SearchPatternModePreference,
  matchScope: SearchMatchScopePreference,
): RegExp | null {
  const trimmed = query.trim();
  if (trimmed.length === 0 || patternMode === "glob" || matchScope !== "name") {
    return null;
  }
  const source = patternMode === "text" ? trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : trimmed;
  try {
    return new RegExp(source, /\p{Lu}/u.test(trimmed) ? "" : "i");
  } catch {
    return null;
  }
}

// The folder a result is in, from where the search started, with › between folders
// ("src › renderer"); a result right in that folder shows the folder's name.
export function formatSearchResultFolder(path: string, rootPath: string): string {
  const parentPath = path.slice(0, Math.max(1, path.lastIndexOf("/")));
  const root = rootPath.length > 1 ? rootPath.replace(/\/+$/u, "") : rootPath;
  if (parentPath === root) {
    return root === "/" ? "Macintosh HD" : (root.split("/").filter(Boolean).at(-1) ?? root);
  }
  const relative = root === "/" ? parentPath.slice(1) : parentPath.slice(root.length + 1);
  return relative.split("/").filter(Boolean).join(" › ");
}
