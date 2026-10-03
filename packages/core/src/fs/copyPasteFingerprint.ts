import { basename, dirname, join } from "node:path";

import type {
  CopyPasteNodeKind,
  NodeFingerprint,
  WriteServiceFileSystem,
  WriteServiceStats,
} from "./writeServiceTypes";

export async function captureFingerprint(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<NodeFingerprint> {
  try {
    const stats = await fileSystem.lstat(path);
    const kind = detectKind(stats);
    return {
      exists: true,
      kind,
      size: kind === "file" ? stats.size : null,
      mtimeMs: typeof stats.mtimeMs === "number" ? stats.mtimeMs : null,
      mode: typeof stats.mode === "number" ? stats.mode : null,
      ino: typeof stats.ino === "number" ? stats.ino : null,
      dev: typeof stats.dev === "number" ? stats.dev : null,
      symlinkTarget: kind === "symlink" ? await readlinkSafe(fileSystem, path) : null,
    };
  } catch {
    return {
      exists: false,
      kind: "missing",
      size: null,
      mtimeMs: null,
      mode: null,
      ino: null,
      dev: null,
      symlinkTarget: null,
    };
  }
}

// A folder that may be given by a symlink to it (a link to Desktop, say): pasting into the
// link pastes into the folder, so it is that folder's fingerprint, followed through the
// link. Anything else is fingerprinted as it is.
export async function captureFolderFingerprint(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<NodeFingerprint> {
  const fingerprint = await captureFingerprint(fileSystem, path);
  if (fingerprint.kind !== "symlink") {
    return fingerprint;
  }
  try {
    const stats = await fileSystem.stat(path);
    if (!stats.isDirectory()) {
      return fingerprint;
    }
    return {
      exists: true,
      kind: "directory",
      size: null,
      mtimeMs: typeof stats.mtimeMs === "number" ? stats.mtimeMs : null,
      mode: typeof stats.mode === "number" ? stats.mode : null,
      ino: typeof stats.ino === "number" ? stats.ino : null,
      dev: typeof stats.dev === "number" ? stats.dev : null,
      symlinkTarget: null,
    };
  } catch {
    return fingerprint;
  }
}

export function detectKind(stats: WriteServiceStats): Exclude<CopyPasteNodeKind, "missing"> {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  return "file";
}

export function fingerprintsEqual(left: NodeFingerprint, right: NodeFingerprint): boolean {
  return (
    left.exists === right.exists &&
    left.kind === right.kind &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.mode === right.mode &&
    left.symlinkTarget === right.symlinkTarget &&
    (left.ino === null || right.ino === null || left.ino === right.ino) &&
    (left.dev === null || right.dev === null || left.dev === right.dev)
  );
}

export function isSameExistingItem(left: NodeFingerprint, right: NodeFingerprint): boolean {
  return (
    left.exists &&
    right.exists &&
    left.ino !== null &&
    left.dev !== null &&
    left.ino === right.ino &&
    left.dev === right.dev
  );
}

// Whether the item at `destinationPath` is ("same") or contains ("contains") the item at
// `sourcePath`, so replacing it would destroy the source. Compares where both really are
// on disk: the source may be reached through a symlinked folder or a different letter
// case ("L/X" where "L" links to "X" lives inside "X").
export async function findSourceRelation(
  fileSystem: WriteServiceFileSystem,
  sourcePath: string,
  destinationPath: string,
  destination: NodeFingerprint,
): Promise<"same" | "contains" | null> {
  const source = await captureFingerprint(fileSystem, sourcePath);
  if (sourcePath === destinationPath || isSameExistingItem(source, destination)) {
    return "same";
  }
  if (destination.kind !== "directory") {
    return null;
  }
  if (sourcePath.startsWith(`${destinationPath}/`)) {
    return "contains";
  }
  const realSourcePath = await realItemPath(fileSystem, sourcePath);
  const realDestinationPath = await fileSystem
    .realpath(destinationPath)
    .catch(() => destinationPath);
  if (realSourcePath === realDestinationPath) {
    return "same";
  }
  const destinationPrefix = realDestinationPath.endsWith("/")
    ? realDestinationPath
    : `${realDestinationPath}/`;
  if (realSourcePath.startsWith(destinationPrefix)) {
    return "contains";
  }
  // The real path has no symlinks left in it, so its ancestors are the folders that really
  // hold the source. Comparing identities also catches names that differ only by case.
  for (let ancestor = dirname(realSourcePath); ; ancestor = dirname(ancestor)) {
    if (isSameExistingItem(await captureFingerprint(fileSystem, ancestor), destination)) {
      return "contains";
    }
    if (dirname(ancestor) === ancestor) {
      return null;
    }
  }
}

// Where the items of a paste really are (see realItemPath), to tell whether replacing a
// folder would destroy one of them.
export async function realItemPaths(
  fileSystem: WriteServiceFileSystem,
  paths: readonly string[],
): Promise<string[]> {
  const real: string[] = [];
  for (const path of paths) {
    real.push(await realItemPath(fileSystem, path));
  }
  return real;
}

// Whether the folder at `destinationPath` is or holds any of the items (given by their
// real paths): replacing it would destroy them along with it.
export async function holdsAnyOf(
  fileSystem: WriteServiceFileSystem,
  destinationPath: string,
  realPaths: readonly string[],
): Promise<boolean> {
  const realDestination = await fileSystem.realpath(destinationPath).catch(() => destinationPath);
  const prefix = realDestination.endsWith("/") ? realDestination : `${realDestination}/`;
  const key = (path: string) => path.normalize("NFD").toLowerCase();
  for (const path of realPaths) {
    // One already moved out (earlier in the same move) is no longer at risk.
    if (
      (key(path) === key(realDestination) || key(path).startsWith(key(prefix))) &&
      (await captureFingerprint(fileSystem, path)).exists
    ) {
      return true;
    }
  }
  return false;
}

// Where an item really is: its folder resolved, but not the item itself (a pasted
// symlink is the link, not what it points to).
async function realItemPath(fileSystem: WriteServiceFileSystem, path: string): Promise<string> {
  try {
    return join(await fileSystem.realpath(dirname(path)), basename(path));
  } catch {
    return path;
  }
}

export async function pathExists(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<boolean> {
  const fingerprint = await captureFingerprint(fileSystem, path);
  return fingerprint.exists;
}

async function readlinkSafe(
  fileSystem: WriteServiceFileSystem,
  path: string,
): Promise<string | null> {
  try {
    return await fileSystem.readlink(path);
  } catch {
    return null;
  }
}
