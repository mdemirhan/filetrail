import { basename, dirname, extname, join } from "node:path";

import type { WriteServiceFileSystem } from "./writeServiceTypes";

// APFS and HFS+ limit a single path component to 255 UTF-8 bytes.
const MAX_NAME_BYTES = 255;
// Guards against an endless search when every candidate looks taken (for example
// when the destination folder cannot be read).
const MAX_DUPLICATE_NAME_ATTEMPTS = 10_000;
// Extensions made of two parts: "backup.tar.gz" becomes "backup copy.tar.gz".
const MULTI_PART_EXTENSIONS = [".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"];
// Folders macOS shows as a single item. Like Finder, their copies keep the extension at
// the end ("Tool copy.app"); any other folder gets " copy" after its whole name.
const BUNDLE_EXTENSIONS = new Set([
  ".app",
  ".appex",
  ".bundle",
  ".framework",
  ".kext",
  ".mpkg",
  ".photoslibrary",
  ".pkg",
  ".playground",
  ".plugin",
  ".prefpane",
  ".rtfd",
  ".xcodeproj",
  ".xcworkspace",
]);
// "name copy" or "name copy N" (N from 2, as Finder numbers them).
const COPY_SUFFIX_PATTERN = /^(.+?) copy(?: ([2-9]|[1-9]\d+))?$/u;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export type DuplicateNameOptions = {
  // Folders don't have an extension to keep at the end (bundles aside).
  isDirectory?: boolean;
  // Whether the destination volume tells "a" and "A" apart (see `destinationPathKey`).
  caseSensitive?: boolean;
};

export async function resolveKeepBothDestinationPath(
  sourcePath: string,
  destinationPath: string,
  fileSystem: WriteServiceFileSystem,
  options: DuplicateNameOptions = {},
): Promise<string> {
  const sourceName = basename(sourcePath);
  const destinationDirectoryPath = dirname(destinationPath);
  return resolveDuplicateName(sourceName, destinationDirectoryPath, fileSystem, undefined, options);
}

// Finder-style "name copy.ext", "name copy 2.ext", … that is free on disk and not
// already claimed by another item of the same paste (`reservedPaths`, keyed by
// `destinationPathKey`).
export async function resolveDuplicateName(
  sourceName: string,
  destinationDirectoryPath: string,
  fileSystem: WriteServiceFileSystem,
  reservedPaths?: ReadonlySet<string>,
  options: DuplicateNameOptions = {},
): Promise<string> {
  const [fullBaseName, extension] = splitNameExtension(sourceName, options.isDirectory ?? false);
  // Like Finder, a copy of "report copy" is "report copy 2", not "report copy copy".
  const existingCopy = COPY_SUFFIX_PATTERN.exec(fullBaseName);
  const baseName = existingCopy?.[1] ?? fullBaseName;
  const firstIndex = existingCopy ? Number(existingCopy[2] ?? "1") + 1 : 1;

  for (let index = firstIndex; index < firstIndex + MAX_DUPLICATE_NAME_ATTEMPTS; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const candidatePath = join(destinationDirectoryPath, fitName(baseName, suffix, extension));
    if (reservedPaths?.has(destinationPathKey(candidatePath, options.caseSensitive))) {
      continue;
    }
    if (await isPathAvailable(fileSystem, candidatePath)) {
      return candidatePath;
    }
  }
  throw new Error(`Couldn't find a free name for “${sourceName}”.`);
}

// APFS and HFS+ ignore Unicode normalization, and by default letter case too, so names
// that differ only that way land on the same entry. Case-sensitive volumes keep case.
export function destinationPathKey(path: string, caseSensitive = false): string {
  const normalized = path.normalize("NFD");
  return caseSensitive ? normalized : normalized.toLowerCase();
}

// Splits "name.ext" into ["name", ".ext"], keeping multi-part extensions together and
// leaving folder names (other than bundles) whole.
export function splitNameExtension(name: string, isDirectory: boolean): [string, string] {
  if (!isDirectory) {
    const lowerName = name.toLowerCase();
    for (const extension of MULTI_PART_EXTENSIONS) {
      if (lowerName.endsWith(extension) && name.length > extension.length) {
        return [name.slice(0, -extension.length), name.slice(-extension.length)];
      }
    }
  }
  const extension = extname(name);
  if (extension.length <= 1) {
    return [name, ""];
  }
  if (isDirectory && !BUNDLE_EXTENSIONS.has(extension.toLowerCase())) {
    return [name, ""];
  }
  return [name.slice(0, -extension.length), extension];
}

// Adds `suffix` before the extension, shortening the name to fit the volume's limit.
// Shortening drops whole characters as people see them (an accented letter or an emoji
// is never cut in half).
export function fitName(baseName: string, suffix: string, extension: string): string {
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
  const budget = MAX_NAME_BYTES - byteLength(`${suffix}${ext}`);
  let kept = "";
  let keptBytes = 0;
  for (const { segment } of graphemeSegmenter.segment(base)) {
    const segmentBytes = byteLength(segment);
    if (keptBytes + segmentBytes > budget) {
      break;
    }
    kept += segment;
    keptBytes += segmentBytes;
  }
  return `${kept.trimEnd()}${suffix}${ext}`;
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
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
  }
}

// Whether the volume holding `directoryPath` tells names apart by letter case. Asks the
// volume when the file system can; otherwise looks up an existing name with its letter
// case swapped: finding the same item means case is ignored. Without anything to try,
// assumes the macOS default (case-insensitive).
export async function detectCaseSensitivity(
  fileSystem: WriteServiceFileSystem,
  directoryPath: string,
): Promise<boolean> {
  if (fileSystem.isCaseSensitive) {
    try {
      const answer = await fileSystem.isCaseSensitive(directoryPath);
      if (answer !== null) {
        return answer;
      }
    } catch {
      // Fall back to looking.
    }
  }
  let entries: string[] = [];
  try {
    entries = await fileSystem.readdir(directoryPath);
  } catch {
    // Try the folder's own name below.
  }
  const candidates = entries.map((entry) => join(directoryPath, entry));
  if (dirname(directoryPath) !== directoryPath) {
    candidates.push(directoryPath);
  }
  for (const candidate of candidates) {
    const name = basename(candidate);
    const swapped = swapLetterCase(name);
    if (swapped === name) {
      continue;
    }
    const answer = await probeCaseSensitivity(
      fileSystem,
      candidate,
      join(dirname(candidate), swapped),
    );
    if (answer !== null) {
      return answer;
    }
  }
  return false;
}

async function probeCaseSensitivity(
  fileSystem: WriteServiceFileSystem,
  path: string,
  swappedPath: string,
): Promise<boolean | null> {
  let original: Awaited<ReturnType<WriteServiceFileSystem["lstat"]>>;
  try {
    original = await fileSystem.lstat(path);
  } catch {
    return null;
  }
  try {
    const swapped = await fileSystem.lstat(swappedPath);
    if (original.ino === undefined || swapped.ino === undefined) {
      return null;
    }
    // Two different items whose names differ only by case can exist only when case counts.
    return !(swapped.ino === original.ino && swapped.dev === original.dev);
  } catch (error) {
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT" ? true : null;
  }
}

// Only ASCII letters: their case mapping is one-to-one on every volume ("ß" isn't).
function swapLetterCase(name: string): string {
  return name.replace(/[A-Za-z]/gu, (letter) =>
    letter === letter.toUpperCase() ? letter.toLowerCase() : letter.toUpperCase(),
  );
}
