// Typing in the file list (or the search results) narrows it to the names that contain
// the text. The filter stays until it is cleared; there is no timer.

// How long after the last typed character Space still counts as part of the text. After
// that it is Quick Look again, so a filtered item can be previewed.
export const LIST_FILTER_SPACE_WINDOW_MS = 1000;

// Case-insensitive "name contains"; the order of the list is kept.
export function filterEntriesByName<T extends { name: string }>(entries: T[], query: string): T[] {
  const normalizedQuery = query.toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return entries;
  }
  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedQuery));
}

// Search results are spread over many folders, so their filter also looks at the folder a
// result is in: "src" keeps the results under a folder named src as well as names with it.
export function filterSearchResultsByText<T extends { name: string; relativeParentPath: string }>(
  results: T[],
  query: string,
): T[] {
  const normalizedQuery = query.toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return results;
  }
  return results.filter(
    (result) =>
      result.name.toLocaleLowerCase().includes(normalizedQuery) ||
      result.relativeParentPath.toLocaleLowerCase().includes(normalizedQuery),
  );
}

// The item a filter selects: the first name that starts with the text, as type-to-select
// would pick, otherwise the first match.
export function findListFilterSelection<T extends { name: string }>(
  matches: T[],
  query: string,
): T | null {
  const normalizedQuery = query.toLocaleLowerCase();
  if (normalizedQuery.length === 0) {
    return null;
  }
  return (
    matches.find((entry) => entry.name.toLocaleLowerCase().startsWith(normalizedQuery)) ??
    matches[0] ??
    null
  );
}

// "240 items", or "3 of 240 items" while a filter hides some of them.
export function formatItemCount(shown: number, total: number): string {
  const noun = total === 1 ? "item" : "items";
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
