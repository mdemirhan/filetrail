// The paths picked, without any that sit inside another one picked (or repeat one): a
// folder and an item inside it picked together (Select All in search results) are acted on
// as the folder, which takes the item with it.
export function withoutNestedPaths(paths: readonly string[]): string[] {
  const picked = new Set(paths);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (seen.has(path) || hasPickedAncestor(path, picked)) {
      continue;
    }
    seen.add(path);
    kept.push(path);
  }
  return kept;
}

function hasPickedAncestor(path: string, picked: ReadonlySet<string>): boolean {
  let end = path.lastIndexOf("/");
  while (end > 0) {
    if (picked.has(path.slice(0, end))) {
      return true;
    }
    end = path.lastIndexOf("/", end - 1);
  }
  return path !== "/" && path.startsWith("/") && picked.has("/");
}
