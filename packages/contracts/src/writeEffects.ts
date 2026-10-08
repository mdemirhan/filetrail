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
