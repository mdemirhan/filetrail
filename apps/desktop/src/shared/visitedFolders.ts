// The folders that have been opened, each with its latest visits. The Go To box (⌘K) ranks
// them so the folders in use now come first. Only folders are remembered, never files.

/**
 * How a folder was come to, which says how much the visit counts:
 * - `goTo`: picked in the Go To box, the plainest sign it was wanted.
 * - `stay`: opened some other way and stayed in, or something was done there.
 * - `passThrough`: opened and left again at once, on the way somewhere else. It is not
 *   kept as a visit; it only makes the folder known, so its name can be found.
 */
export type FolderVisitKind = "goTo" | "stay" | "passThrough";

export type FolderVisit = {
  /** Milliseconds since the epoch. */
  at: number;
  kind: Exclude<FolderVisitKind, "passThrough">;
};

export type VisitedFolder = {
  path: string;
  /** Newest first, at most `MAX_VISITS_PER_FOLDER`; empty for a folder only passed through. */
  visits: FolderVisit[];
};

// Enough for years of ordinary use; past it the least used folders are forgotten.
export const MAX_VISITED_FOLDERS = 500;
// As Firefox does for its history: the latest visits say how much a folder is used now,
// and older ones fall away instead of adding up forever.
export const MAX_VISITS_PER_FOLDER = 10;

const KIND_WEIGHTS: Record<FolderVisit["kind"], number> = { goTo: 3, stay: 1 };

const DAY_MS = 24 * 60 * 60 * 1000;

// How much a visit still counts by its age, in Firefox's steps: in full for four days, a
// tenth after three months.
function recencyWeight(age: number): number {
  if (age <= 4 * DAY_MS) {
    return 1;
  }
  if (age <= 14 * DAY_MS) {
    return 0.7;
  }
  if (age <= 31 * DAY_MS) {
    return 0.5;
  }
  return age <= 90 * DAY_MS ? 0.3 : 0.1;
}

// How much a folder is in use right now: each of its latest visits, by how it was made and
// how long ago. A folder opened daily this week outranks one opened often last spring.
export function visitScore(folder: VisitedFolder, now: number): number {
  let score = 0;
  for (const visit of folder.visits) {
    score += KIND_WEIGHTS[visit.kind] * recencyWeight(Math.max(0, now - visit.at));
  }
  return score;
}

// Adds a visit to `path`, which moves to the front. A pass through only adds a folder not
// known yet, and returns `folders` itself when there is nothing to add. Over the limit, the
// folders with the lowest score are dropped (never the one just visited).
export function recordFolderVisit(
  folders: VisitedFolder[],
  path: string,
  kind: FolderVisitKind,
  now: number,
): VisitedFolder[] {
  if (path.length === 0) {
    return folders;
  }
  const existing = folders.find((folder) => folder.path === path);
  if (kind === "passThrough" && existing) {
    return folders;
  }
  const previousVisits = existing?.visits ?? [];
  const visited: VisitedFolder = {
    path,
    visits:
      kind === "passThrough"
        ? []
        : [{ at: now, kind }, ...previousVisits].slice(0, MAX_VISITS_PER_FOLDER),
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

// On disk each visit is a pair, [time, kind], and each folder takes one line: a full list
// is a few hundred kilobytes at most, and still easy to read.
export function serializeVisitedFolders(folders: readonly VisitedFolder[]): string {
  const lines = folders.map((folder) =>
    JSON.stringify({
      path: folder.path,
      visits: folder.visits.map((visit) => [visit.at, visit.kind]),
    }),
  );
  return lines.length === 0 ? '{"folders":[]}\n' : `{"folders":[\n${lines.join(",\n")}\n]}\n`;
}

// Saved visits are read leniently: anything that is not a visit record is skipped. The
// list kept before visits were stored one by one (a count and the latest time) is read
// too, as that many visits at that time.
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
    const { path } = record;
    if (typeof path !== "string" || !path.startsWith("/") || seen.has(path)) {
      continue;
    }
    const visits = Array.isArray(record.visits)
      ? sanitizeVisits(record.visits)
      : sanitizeLegacyVisits(record.visitCount, record.lastVisitedAt);
    if (!visits) {
      continue;
    }
    seen.add(path);
    folders.push({ path, visits });
    if (folders.length === MAX_VISITED_FOLDERS) {
      break;
    }
  }
  return folders;
}

function sanitizeVisits(value: unknown[]): FolderVisit[] {
  const visits: FolderVisit[] = [];
  for (const item of value) {
    if (!Array.isArray(item)) {
      continue;
    }
    const [at, kind] = item;
    if (isValidTime(at) && (kind === "goTo" || kind === "stay")) {
      visits.push({ at, kind });
    }
  }
  return visits.sort((left, right) => right.at - left.at).slice(0, MAX_VISITS_PER_FOLDER);
}

function sanitizeLegacyVisits(visitCount: unknown, lastVisitedAt: unknown): FolderVisit[] | null {
  if (
    typeof visitCount !== "number" ||
    !Number.isFinite(visitCount) ||
    visitCount < 1 ||
    !isValidTime(lastVisitedAt)
  ) {
    return null;
  }
  const count = Math.min(Math.floor(visitCount), MAX_VISITS_PER_FOLDER);
  return Array.from({ length: count }, () => ({ at: lastVisitedAt, kind: "stay" as const }));
}

function isValidTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
