// The folders that have been opened, with how often and how recently. The Go To box (⌘K)
// ranks them so the folders used most come first. Only folders are remembered, never files.

export type VisitedFolder = {
  path: string;
  visitCount: number;
  /** Milliseconds since the epoch. */
  lastVisitedAt: number;
};

// Enough for years of ordinary use; past it the least used folders are forgotten.
export const MAX_VISITED_FOLDERS = 500;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// How much a folder is in use right now: the visit count, weighted by how long ago the last
// visit was. A folder opened a few times today outranks one opened often months ago.
export function visitScore(folder: VisitedFolder, now: number): number {
  const age = Math.max(0, now - folder.lastVisitedAt);
  const recency = age < HOUR_MS ? 4 : age < DAY_MS ? 2 : age < WEEK_MS ? 0.5 : 0.25;
  return folder.visitCount * recency;
}

// Adds a visit to `path`. Over the limit, the folders with the lowest score are dropped
// (never the one just visited).
export function recordFolderVisit(
  folders: readonly VisitedFolder[],
  path: string,
  now: number,
): VisitedFolder[] {
  if (path.length === 0) {
    return [...folders];
  }
  const existing = folders.find((folder) => folder.path === path);
  const visited: VisitedFolder = {
    path,
    visitCount: (existing?.visitCount ?? 0) + 1,
    lastVisitedAt: now,
  };
  const others = folders.filter((folder) => folder.path !== path);
  if (others.length + 1 <= MAX_VISITED_FOLDERS) {
    return [visited, ...others];
  }
  const kept = [...others]
    .sort((left, right) => visitScore(right, now) - visitScore(left, now))
    .slice(0, MAX_VISITED_FOLDERS - 1);
  return [visited, ...kept];
}

export function forgetVisitedFolder(
  folders: readonly VisitedFolder[],
  path: string,
): VisitedFolder[] {
  return folders.filter((folder) => folder.path !== path);
}

// Saved state is read leniently: anything that is not a visit record is skipped.
export function sanitizeVisitedFolders(value: unknown): VisitedFolder[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const folders: VisitedFolder[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const { path, visitCount, lastVisitedAt } = record;
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      seen.has(path) ||
      typeof visitCount !== "number" ||
      !Number.isFinite(visitCount) ||
      visitCount < 1 ||
      typeof lastVisitedAt !== "number" ||
      !Number.isFinite(lastVisitedAt) ||
      lastVisitedAt < 0
    ) {
      continue;
    }
    seen.add(path);
    folders.push({ path, visitCount: Math.floor(visitCount), lastVisitedAt });
    if (folders.length === MAX_VISITED_FOLDERS) {
      break;
    }
  }
  return folders;
}
