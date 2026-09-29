import { basename, dirname, extname, join } from "node:path";

import type { WriteServiceFileSystem } from "./writeServiceTypes";

// APFS and HFS+ limit a single path component to 255 UTF-8 bytes.
const MAX_NAME_BYTES = 255;
// Guards against an endless search when every candidate looks taken (for example
// when the destination folder cannot be read).
const MAX_DUPLICATE_NAME_ATTEMPTS = 10_000;

export async function resolveKeepBothDestinationPath(
  sourcePath: string,
  destinationPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<string> {
  const sourceName = basename(sourcePath);
  const destinationDirectoryPath = dirname(destinationPath);
  return resolveDuplicateName(sourceName, destinationDirectoryPath, fileSystem);
}

// Finder-style "name copy.ext", "name copy 2.ext", … that is free on disk and not
// already claimed by another item of the same paste (`reservedPaths`, keyed by
// `destinationPathKey`).
export async function resolveDuplicateName(
  sourceName: string,
  destinationDirectoryPath: string,
  fileSystem: WriteServiceFileSystem,
  reservedPaths?: ReadonlySet<string>,
): Promise<string> {
  const extension = extname(sourceName);
  const baseName =
    extension.length > 0 ? sourceName.slice(0, sourceName.length - extension.length) : sourceName;

  for (let index = 1; index <= MAX_DUPLICATE_NAME_ATTEMPTS; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const candidatePath = join(destinationDirectoryPath, fitName(baseName, suffix, extension));
    if (reservedPaths?.has(destinationPathKey(candidatePath))) {
      continue;
    }
    if (await isPathAvailable(fileSystem, candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(`Couldn't find a free name for “${sourceName}”.`);
}

// APFS is case- and normalization-insensitive by default, so names that differ only
// that way land on the same entry.
export function destinationPathKey(path: string): string {
  return path.normalize("NFD").toLowerCase();
}

function fitName(baseName: string, suffix: string, extension: string): string {
  let base = baseName;
  let ext = extension;
  if (byteLength(`${suffix}${ext}`) >= MAX_NAME_BYTES) {
    // An absurdly long extension: treat the whole name as the base instead.
    base = `${baseName}${extension}`;
    ext = "";
  }
  const name = `${base}${suffix}${ext}`;
  if (byteLength(name) <= MAX_NAME_BYTES) {
    return name;
  }
  const characters = Array.from(base);
  while (
    characters.length > 0 &&
    byteLength(`${characters.join("")}${suffix}${ext}`) > MAX_NAME_BYTES
  ) {
    characters.pop();
  }
  return `${characters.join("").trimEnd()}${suffix}${ext}`;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

// A name is free only when lstat reports it missing. Any other failure (for example
// no permission) counts as taken so a name is never reused by mistake.
async function isPathAvailable(fileSystem: WriteServiceFileSystem, path: string): Promise<boolean> {
  try {
    await fileSystem.lstat(path);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === "ENOENT" || code === "ENOTDIR" || code === undefined;
  }
}
