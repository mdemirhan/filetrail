import type { DirectoryEntry } from "./explorerTypes";

// A folder's listing can hold tens of thousands of items, and ⌘A selects all of them, so
// finding the selected items must not walk the listing once per selected path. Each
// listing is indexed by path once, the first time it is asked about; listings are never
// changed in place (a change makes a new array), so the index stays right for its array.
const indexes = new WeakMap<readonly DirectoryEntry[], ReadonlyMap<string, DirectoryEntry>>();

function indexByPath(entries: readonly DirectoryEntry[]): ReadonlyMap<string, DirectoryEntry> {
  let index = indexes.get(entries);
  if (!index) {
    const built = new Map<string, DirectoryEntry>();
    for (const entry of entries) {
      // The first of two items with one path wins, as a search from the start would.
      if (!built.has(entry.path)) {
        built.set(entry.path, entry);
      }
    }
    index = built;
    indexes.set(entries, index);
  }
  return index;
}

/** The item at `path` in `entries`, or null. */
export function findEntryAtPath(
  entries: readonly DirectoryEntry[],
  path: string | null | undefined,
): DirectoryEntry | null {
  if (path === null || path === undefined) {
    return null;
  }
  return indexByPath(entries).get(path) ?? null;
}

/** The items at `paths` in `entries`, in the order of `paths`, leaving out paths not there. */
export function resolveEntriesAtPaths(
  paths: readonly string[],
  entries: readonly DirectoryEntry[],
): DirectoryEntry[] {
  if (paths.length === 0) {
    return [];
  }
  const index = indexByPath(entries);
  const resolved: DirectoryEntry[] = [];
  for (const path of paths) {
    const entry = index.get(path);
    if (entry) {
      resolved.push(entry);
    }
  }
  return resolved;
}
