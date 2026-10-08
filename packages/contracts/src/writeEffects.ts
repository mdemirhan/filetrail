// What a finished file operation changed, for whatever was worked out from the folders it
// touched (folder sizes): the items it moved, made, renamed or removed, and the folder it
// wrote into. Anything at, inside or around these paths may be different now.
export function pathsChangedByWrite(result: {
  targetPath?: string | null;
  destinationDirectoryPath?: string | null;
  items: ReadonlyArray<{ sourcePath: string | null; destinationPath: string | null }>;
}): string[] {
  const paths = new Set<string>();
  for (const path of [result.targetPath, result.destinationDirectoryPath]) {
    if (path) {
      paths.add(path);
    }
  }
  for (const item of result.items) {
    if (item.sourcePath) {
      paths.add(item.sourcePath);
    }
    if (item.destinationPath) {
      paths.add(item.destinationPath);
    }
  }
  return [...paths];
}

type ResultItem = { sourcePath: string | null; destinationPath: string | null; status: string };

// Where a rename or move took an item, for a window to follow it there: only what really
// moved, and for a rename of several also an item put back under another name ("b 2").
export function isFollowedMove(item: ResultItem, action: string): boolean {
  return Boolean(
    item.sourcePath &&
      item.destinationPath &&
      item.destinationPath !== item.sourcePath &&
      (item.status === "completed" || action === "batch_rename"),
  );
}

// The items of a finished operation that windows other than its own need, out of what can
// be 100,000 (sending them all to every window took 30–60 ms a window, and each then went
// through them all). Those windows forget or measure again the folder sizes the operation
// changed (pathsChangedByWrite, createChangeMatcher) and follow a moved folder in their
// tabs (isFollowedMove; the first move holding a path wins). An item is left out when
// neither tells it apart from the items kept before it: each of its paths is at or inside
// one of theirs, in a folder that holds one of theirs, and it either didn't move or a move
// kept before it holds it. What is left out is mostly what was inside a folder the
// operation copied or moved, all but one item in each folder.
export function itemsForOtherWindows<T extends ResultItem>(result: {
  action: string;
  targetPath?: string | null;
  items: readonly T[];
}): T[] {
  // As createChangeMatcher tells what is at or inside a change ("/a/" holds "/a/b" too).
  const changed = createPathSet({ withTrailingSlash: true });
  // Every folder holding a kept path (written without a trailing "/").
  const holders = new Set<string>();
  // As a tab follows a move: the path moved, or what starts with it and a "/".
  const movedFrom = createPathSet({ withTrailingSlash: false });
  // The last folder whose every item was found covered, for sources and for destinations:
  // the next item is mostly in the same one, and comparing is quicker than looking it up.
  const coveredFolders: [string | null, string | null] = [null, null];
  const isCovered = (path: string | null, side: 0 | 1) => {
    if (!path) {
      return true;
    }
    const end = path.lastIndexOf("/");
    const known = coveredFolders[side];
    if (known !== null && end === known.length && path.startsWith(known)) {
      return true;
    }
    if (end < 0) {
      return changed.isAtOrInside(path);
    }
    const folder = path.slice(0, end);
    // Both only ever become true as more items are kept.
    if (holders.has(folder) && changed.isFolderAtOrInside(folder)) {
      coveredFolders[side] = folder;
      return true;
    }
    return changed.isAtOrInside(path) && holders.has(folder);
  };
  const addChanged = (path: string | null | undefined) => {
    if (!path) {
      return;
    }
    changed.add(path);
    // Up from its folder, until a folder already there: the ones above it are too.
    for (let end = path.lastIndexOf("/"); end >= 0; end = path.lastIndexOf("/", end - 1)) {
      const folder = path.slice(0, end);
      if (holders.has(folder)) {
        break;
      }
      holders.add(folder);
      if (end === 0) {
        break;
      }
    }
  };
  addChanged(result.targetPath);
  const kept: T[] = [];
  for (const item of result.items) {
    const movedFromPath = isFollowedMove(item, result.action) ? item.sourcePath : null;
    if (
      isCovered(item.sourcePath, 0) &&
      isCovered(item.destinationPath, 1) &&
      (movedFromPath === null || movedFrom.isAtOrInside(movedFromPath))
    ) {
      continue;
    }
    kept.push(item);
    addChanged(item.sourcePath);
    addChanged(item.destinationPath);
    if (movedFromPath !== null) {
      movedFrom.add(movedFromPath);
    }
  }
  return kept;
}

// Paths, and whether a path is one of them or inside one: in time for the path's length,
// and at once for another path in a folder already known to be inside one.
function createPathSet(options: { withTrailingSlash: boolean }) {
  const paths = new Set<string>();
  // Folders found to be at or inside one of the paths; with more paths, they still are.
  const foldersInside = new Set<string>();
  const isFolderAtOrInside = (folder: string): boolean => {
    if (
      foldersInside.has(folder) ||
      paths.has(folder) ||
      (options.withTrailingSlash && paths.has(`${folder}/`))
    ) {
      foldersInside.add(folder);
      return true;
    }
    const end = folder.lastIndexOf("/");
    if (end < 0 || !isFolderAtOrInside(folder.slice(0, end))) {
      return false;
    }
    foldersInside.add(folder);
    return true;
  };
  return {
    add: (path: string) => {
      paths.add(path);
    },
    isFolderAtOrInside,
    isAtOrInside: (path: string): boolean => {
      const end = path.lastIndexOf("/");
      return paths.has(path) || (end >= 0 && isFolderAtOrInside(path.slice(0, end)));
    },
  };
}

// Whether `path` is one of `changedPaths`, holds one (so what it holds changed), or is
// inside one (so it was moved, removed or replaced).
export function isAffectedByChange(path: string, changedPaths: readonly string[]): boolean {
  return changedPaths.some(
    (changed) => isSameOrInside(path, changed) || isSameOrInside(changed, path),
  );
}

// What a set of changes touched, for asking about many paths at once (every cached folder
// size after a write): each answer takes time in the length of the path asked about, not in
// the number of changes, which can be tens of thousands.
export type ChangeMatcher = {
  // Whether `path` holds one of the changes, somewhere inside it.
  holdsChange(path: string): boolean;
  // Whether `path` is one of the changes, or inside one.
  isAtOrInsideChange(path: string): boolean;
  // Either: as isAffectedByChange.
  isAffected(path: string): boolean;
};

export function createChangeMatcher(changedPaths: readonly string[]): ChangeMatcher {
  const changed = new Set(changedPaths);
  // Every folder holding a change, as the paths are written (see foldersHolding).
  const holders = new Set<string>();
  for (const path of changed) {
    foldersHolding(path, (folder) => {
      holders.add(folder);
      return false;
    });
  }
  const isAtOrInsideChange = (path: string) =>
    changed.has(path) || foldersHolding(path, (folder) => changed.has(folder));
  const holdsChange = (path: string) => holders.has(path);
  return {
    holdsChange,
    isAtOrInsideChange,
    isAffected: (path) => holdsChange(path) || isAtOrInsideChange(path),
  };
}

// Calls `visit` with every folder that holds `path` by isSameOrInside, until it answers
// true: each part of the path before a "/", with and without that "/" ("/a" and "/a/" hold
// "/a/b"), and "" before a leading "/".
function foldersHolding(path: string, visit: (folder: string) => boolean): boolean {
  for (let index = path.indexOf("/"); index !== -1; index = path.indexOf("/", index + 1)) {
    if (visit(path.slice(0, index)) || visit(path.slice(0, index + 1))) {
      return true;
    }
  }
  return false;
}

function isSameOrInside(path: string, folder: string): boolean {
  if (path === folder) {
    return true;
  }
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return path.startsWith(prefix);
}
