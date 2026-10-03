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

function isSameOrInside(path: string, folder: string): boolean {
  if (path === folder) {
    return true;
  }
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return path.startsWith(prefix);
}
