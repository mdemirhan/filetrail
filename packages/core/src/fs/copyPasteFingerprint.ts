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
      ino: fileIdOf(stats.ino),
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
      ino: fileIdOf(stats.ino),
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
// real paths): replacing it would destroy them along with it. Told by identity: a real path
// can still name a folder another way (the firmlinked "/System/Volumes/Data/Users/…" for
// "/Users/…"), so the folder is looked for among each item's own folders. On a disk that
// gives no identities, paths are compared ignoring case: such disks (FAT, exFAT) don't tell
// case apart, while ignoring it elsewhere would take "/d/Sub" for "/d/sub" on a disk that does.
export async function holdsAnyOf(
  fileSystem: WriteServiceFileSystem,
  destinationPath: string,
  realPaths: readonly string[],
): Promise<boolean> {
  const realDestination = await fileSystem.realpath(destinationPath).catch(() => destinationPath);
  const id = idKey(await captureFingerprint(fileSystem, destinationPath));
  const { holders } = await pastedItemsOf(fileSystem, realPaths);
  const held =
    id === null
      ? (holders.get(foldedPathKey(realDestination)) ?? [])
      : [...(holders.get(id) ?? []), ...(holders.get(pathKey(realDestination)) ?? [])];
  for (const path of held) {
    // One already moved out (earlier in the same move) is no longer at risk.
    if ((await captureFingerprint(fileSystem, path)).exists) {
      return true;
    }
  }
  return false;
}

// Whether the item at `path` is one of the items (given by their real paths), as the review
// tells "another item being pasted": replacing it would destroy that item. Told by identity
// too, as for holdsAnyOf, so a hard link to an item counts. One already moved away (earlier
// in the same move) no longer is: what is at `path` now is what is looked up.
export async function isAnyOf(
  fileSystem: WriteServiceFileSystem,
  path: string,
  realPaths: readonly string[],
): Promise<boolean> {
  const id = idKey(await captureFingerprint(fileSystem, path));
  const { items } = await pastedItemsOf(fileSystem, realPaths);
  if (id !== null && items.has(id)) {
    return true;
  }
  const spellings = [
    await realItemPath(fileSystem, path),
    await fileSystem.realpath(path).catch(() => path),
  ];
  if (id !== null) {
    return spellings.some((spelling) => items.has(pathKey(spelling)));
  }
  for (const spelling of spellings) {
    const item = items.get(foldedPathKey(spelling));
    if (item !== undefined && (await captureFingerprint(fileSystem, item)).exists) {
      return true;
    }
  }
  return false;
}

// Keys for the items of a paste and the folders holding them: an identity ("dev:ino"), a
// path, or a path ignoring case, each spelled so that no two kinds can meet.
function pathKey(path: string): string {
  return `=${path.normalize("NFD")}`;
}

function foldedPathKey(path: string): string {
  return `~${path.normalize("NFD").toLowerCase()}`;
}

function idKey(fingerprint: NodeFingerprint): string | null {
  return fingerprint.exists && fingerprint.dev !== null && fingerprint.ino !== null
    ? `${fingerprint.dev}:${fingerprint.ino}`
    : null;
}

type PastedItems = {
  // Each item's real path, by the item's identity and by its real path.
  items: Map<string, string>;
  // The items' real paths, by the identity and the path of each item and of every folder
  // holding it.
  holders: Map<string, string[]>;
};

// Read once for each list of items, which a review or a paste keeps for its whole run, so
// asking about one more item costs a look at that item alone, not at every item pasted.
const pastedItemsCache = new WeakMap<readonly string[], Promise<PastedItems>>();

function pastedItemsOf(
  fileSystem: WriteServiceFileSystem,
  realPaths: readonly string[],
): Promise<PastedItems> {
  let cached = pastedItemsCache.get(realPaths);
  if (cached === undefined) {
    cached = readPastedItems(fileSystem, realPaths);
    pastedItemsCache.set(realPaths, cached);
  }
  return cached;
}

// An item's real path has no symlinks left in it, so its folders are the ones that really
// hold it.
async function readPastedItems(
  fileSystem: WriteServiceFileSystem,
  realPaths: readonly string[],
): Promise<PastedItems> {
  // Items side by side share their folders: each folder is read once.
  const folderIds = new Map<string, string | null>();
  const idOf = async (path: string) => {
    if (!folderIds.has(path)) {
      folderIds.set(path, idKey(await captureFingerprint(fileSystem, path)));
    }
    return folderIds.get(path) ?? null;
  };
  const items = new Map<string, string>();
  const holders = new Map<string, string[]>();
  for (const realPath of realPaths) {
    for (const key of [await idOf(realPath), pathKey(realPath), foldedPathKey(realPath)]) {
      if (key !== null) {
        items.set(key, realPath);
      }
    }
    for (let path = realPath; ; path = dirname(path)) {
      for (const key of [await idOf(path), pathKey(path), foldedPathKey(path)]) {
        if (key === null) {
          continue;
        }
        const held = holders.get(key);
        if (held === undefined) {
          holders.set(key, [realPath]);
        } else {
          held.push(realPath);
        }
      }
      if (dirname(path) === path) {
        break;
      }
    }
  }
  return { items, holders };
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

// A file id usable to tell items apart, or null. FAT and exFAT give empty files ids near
// 2^64, which a JS number can't hold exactly: they all round to the same value, so every
// empty file would look like the same item. Such an id is treated as unknown.
export function fileIdOf(ino: unknown): number | null {
  return typeof ino === "number" && Number.isSafeInteger(ino) ? ino : null;
}
