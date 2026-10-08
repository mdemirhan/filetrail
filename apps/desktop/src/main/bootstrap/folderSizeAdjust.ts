import { dirname } from "node:path";

import { createChangeMatcher } from "@filetrail/contracts";

// A folder's measured size, the disk it was measured on, and the measurement that stored
// it. A measurement never leaves the disk it starts on, so only the folders below on the
// same disk are in its total. The sizes one measurement stores add up: a folder's total is
// what it measured of the folders inside. Sizes from different measurements may not (the
// folder inside measured again after it grew), so one is never taken off the other.
export type FolderSizeStats = {
  sizeBytes: number;
  diskBytes: number;
  fileCount: number;
  folderCount: number;
  dev: number | null;
  measurement: number;
};

// One item as a measurement counts it inside its folder (nativeItemSize): a file or symlink
// by its sizes, a folder only as one (its contents are its own measurement's), anything
// else not at all.
export type ItemSize = {
  kind: "file" | "folder" | "other";
  sizeBytes: number;
  diskBytes: number;
  dev: number;
};

// An item a delete removed, as it was just before: null when it couldn't be read (it was
// gone already, say). An item moved to the Trash from the home folder's disk lands in the
// home folder's Trash, which measurements of the folders holding it may or may not count;
// null when that isn't known (it went to the Trash, but couldn't be read first).
export type RemovedItem = {
  path: string;
  item: ItemSize | null;
  intoHomeTrash: boolean | null;
};

// The home folder's Trash, and whether a measurement that reached it could read it (only an
// app with Full Disk Access can): null until one has tried.
export type HomeTrash = { path: string; counted: boolean | null };

type Counted = "yes" | "no" | "unknown";
type Contribution = Omit<FolderSizeStats, "dev" | "measurement">;

// After a delete, each measured folder that held a removed item has the item taken off
// its size instead of being forgotten, when its measurement is known to have counted the
// item, and with what. Anything uncertain is forgotten and measured again when next asked
// for, as before. Sizes of the removed items and everything inside them are forgotten.
export function adjustForRemovals(
  cache: Map<string, FolderSizeStats>,
  removals: readonly RemovedItem[],
  homeTrash: HomeTrash,
): void {
  const removedFolders: string[] = [];
  for (const removal of removals) {
    adjustForRemoval(cache, removal, homeTrash);
    removedFolders.push(removal.path);
  }
  forgetAtOrInside(cache, removedFolders);
}

function adjustForRemoval(
  cache: Map<string, FolderSizeStats>,
  removal: RemovedItem,
  homeTrash: HomeTrash,
): void {
  const { path, item } = removal;
  // Every measured folder whose total can change: those that held the item, and, for an
  // item moved to the home folder's Trash, the Trash and those that hold it.
  const holders = new Set<string>();
  for (const folder of ancestorsOf(path)) {
    if (cache.has(folder)) {
      holders.add(folder);
    }
  }
  const trashPath = removal.intoHomeTrash === false ? null : homeTrash.path;
  if (trashPath !== null) {
    for (const folder of [trashPath, ...ancestorsOf(trashPath)]) {
      if (cache.has(folder)) {
        holders.add(folder);
      }
    }
  }

  // Decided against the sizes as they were, then applied.
  const changes: Array<{ folder: string; change: Contribution | null }> = [];
  for (const folder of holders) {
    const left =
      isInside(path, folder) && item !== null
        ? countedIn(cache, dirname(path), folder)
        : isInside(path, folder)
          ? "unknown"
          : "no";
    const arrived = trashPath !== null && isSameOrInside(trashPath, folder);
    const landed: Counted = !arrived
      ? "no"
      : removal.intoHomeTrash === null
        ? "unknown"
        : folder === trashPath
          ? "yes"
          : homeTrash.counted === null
            ? "unknown"
            : homeTrash.counted
              ? countedIn(cache, dirname(trashPath), folder)
              : "no";
    if (left === "unknown" || landed === "unknown") {
      changes.push({ folder, change: null });
      continue;
    }
    const sign = (left === "yes" ? -1 : 0) + (landed === "yes" ? 1 : 0);
    if (sign === 0) {
      continue;
    }
    // Taken off, it is what this folder's measurement counted of it; added (it landed in
    // the Trash), it brings its own size as last measured.
    const contribution = item ? contributionTo(cache, path, item, folder, sign < 0) : null;
    changes.push({
      folder,
      change: contribution ? scale(contribution, sign) : null,
    });
  }

  for (const { folder, change } of changes) {
    const stats = cache.get(folder);
    if (!stats) {
      continue;
    }
    const next = change && add(stats, change);
    if (next) {
      cache.set(folder, next);
    } else {
      cache.delete(folder);
    }
  }
}

// Whether the measurement of `folder` counted what is directly in `from` (inside it): it
// walked down to `from` when every folder on the way has a size it stored, from the same
// disk. A folder on the way without one may not have been readable (or had a volume mounted on
// it, or was a link to a folder), or was forgotten since; one stored by another measurement may hold
// more or less than this one counted of it.
function countedIn(cache: Map<string, FolderSizeStats>, from: string, folder: string): Counted {
  const folderStats = cache.get(folder);
  if (!folderStats || folderStats.dev === null) {
    return "unknown";
  }
  let current = from;
  for (;;) {
    const stats = cache.get(current);
    if (!stats || stats.dev === null) {
      return "unknown";
    }
    if (stats.dev !== folderStats.dev) {
      return "no";
    }
    if (stats.measurement !== folderStats.measurement) {
      return "unknown";
    }
    if (current === folder) {
      return "yes";
    }
    const parent = dirname(current);
    if (parent === current) {
      return "unknown";
    }
    current = parent;
  }
}

// What the item added to the measurement of `folder`, which counted its parent folder. A
// folder's contents count as its own size, which with `sameMeasurement` must be the one
// `folder`'s measurement stored.
function contributionTo(
  cache: Map<string, FolderSizeStats>,
  path: string,
  item: ItemSize,
  folder: string,
  sameMeasurement: boolean,
): Contribution | null {
  if (item.kind === "file") {
    return {
      sizeBytes: item.sizeBytes,
      diskBytes: item.diskBytes,
      fileCount: 1,
      folderCount: 0,
    };
  }
  if (item.kind === "other") {
    return { sizeBytes: 0, diskBytes: 0, fileCount: 0, folderCount: 0 };
  }
  const holder = cache.get(folder);
  // A folder on another disk is counted as a folder, and nothing inside it.
  if (item.dev !== holder?.dev) {
    return { sizeBytes: 0, diskBytes: 0, fileCount: 0, folderCount: 1 };
  }
  const own = cache.get(path);
  if (!own || own.dev !== item.dev || (sameMeasurement && own.measurement !== holder.measurement)) {
    return null;
  }
  return {
    sizeBytes: own.sizeBytes,
    diskBytes: own.diskBytes,
    fileCount: own.fileCount,
    folderCount: own.folderCount + 1,
  };
}

function scale(contribution: Contribution, sign: number): Contribution {
  return {
    sizeBytes: contribution.sizeBytes * sign,
    diskBytes: contribution.diskBytes * sign,
    fileCount: contribution.fileCount * sign,
    folderCount: contribution.folderCount * sign,
  };
}

// The sizes with the change made, or null when they would go below zero: the measurement
// didn't count what it was thought to, so it is measured again.
function add(stats: FolderSizeStats, change: Contribution): FolderSizeStats | null {
  const next = {
    sizeBytes: stats.sizeBytes + change.sizeBytes,
    diskBytes: stats.diskBytes + change.diskBytes,
    fileCount: stats.fileCount + change.fileCount,
    folderCount: stats.folderCount + change.folderCount,
    dev: stats.dev,
    measurement: stats.measurement,
  };
  return next.sizeBytes < 0 || next.diskBytes < 0 || next.fileCount < 0 || next.folderCount < 0
    ? null
    : next;
}

// One pass over the cache, each path looked up with each of its folders.
function forgetAtOrInside(cache: Map<string, FolderSizeStats>, paths: readonly string[]): void {
  if (paths.length === 0) {
    return;
  }
  const removed = createChangeMatcher(paths);
  for (const cachedPath of cache.keys()) {
    if (removed.isAtOrInsideChange(cachedPath)) {
      cache.delete(cachedPath);
    }
  }
}

function ancestorsOf(path: string): string[] {
  const ancestors: string[] = [];
  let current = path;
  for (;;) {
    const parent = dirname(current);
    if (parent === current) {
      return ancestors;
    }
    ancestors.push(parent);
    current = parent;
  }
}

function isInside(path: string, folder: string): boolean {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return path.startsWith(prefix);
}

function isSameOrInside(path: string, folder: string): boolean {
  return path === folder || isInside(path, folder);
}
