import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";

export type FileSystemDirent = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

export type FileSystemStats = {
  isDirectory: () => boolean;
  isFile: () => boolean;
  birthtime: Date;
  mtime: Date;
  size: number;
  mode: number;
};

export type ExplorerFileSystem = {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<FileSystemDirent[]>;
  stat: (path: string) => Promise<FileSystemStats>;
  lstat: (path: string) => Promise<FileSystemStats & { isSymbolicLink?: () => boolean }>;
  realpath: (path: string) => Promise<string>;
};

// Default implementation using node:fs. In Electron, callers should pass an
// original-fs backed implementation so .asar files appear as regular files
// instead of virtual directories (see explorerWorker.ts).
const DEFAULT_FILE_SYSTEM: ExplorerFileSystem = {
  readdir: (path, options) => readdir(path, options) as Promise<FileSystemDirent[]>,
  stat: (path) => stat(path) as Promise<FileSystemStats>,
  lstat: (path) => lstat(path) as Promise<FileSystemStats & { isSymbolicLink?: () => boolean }>,
  realpath: (path) => realpath(path),
};

type EntryKind = IpcResponse<"directory:getSnapshot">["entries"][number]["kind"];

// Tree loading only returns navigable folders, not every entry in the directory.
export async function listTreeChildren(
  path: string,
  includeHidden: boolean,
  fileSystem: ExplorerFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<IpcResponse<"tree:getChildren">> {
  const directoryPath = await resolveDirectoryPath(path, fileSystem);
  const dirents = await fileSystem.readdir(directoryPath, { withFileTypes: true });
  const children = await Promise.all(
    dirents.map(async (dirent) => {
      if (!includeHidden && isHiddenName(dirent.name)) {
        return null;
      }
      const entryPath = resolve(directoryPath, dirent.name);
      const kind = await classifyEntry(dirent, entryPath, fileSystem);
      if (kind !== "directory" && kind !== "symlink_directory") {
        return null;
      }
      return {
        path: entryPath,
        name: dirent.name,
        kind,
        isHidden: isHiddenName(dirent.name),
        isSymlink: kind === "symlink_directory",
      };
    }),
  );

  return {
    path: directoryPath,
    children: children.filter((value) => value !== null).sort(compareEntriesByName),
  };
}

// Snapshot listing fetches extra stat data only for sort modes that require it so the
// common name-sorted path stays as cheap as possible.
export async function listDirectorySnapshot(
  path: string,
  includeHidden: boolean,
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"] = "name",
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"] = "asc",
  foldersFirst = true,
  fileSystem: ExplorerFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<IpcResponse<"directory:getSnapshot">> {
  const directoryPath = await resolveDirectoryPath(path, fileSystem);
  const dirents = await fileSystem.readdir(directoryPath, { withFileTypes: true });
  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      if (!includeHidden && isHiddenName(dirent.name)) {
        return null;
      }
      const entryPath = resolve(directoryPath, dirent.name);
      const kind = await classifyEntry(dirent, entryPath, fileSystem);
      const stats =
        sortBy === "modified" || sortBy === "size" ? await fileSystem.stat(entryPath) : null;
      return {
        path: entryPath,
        name: dirent.name,
        extension: extname(dirent.name).replace(/^\./, "").toLowerCase(),
        kind,
        isHidden: isHiddenName(dirent.name),
        isSymlink: kind === "symlink_directory" || kind === "symlink_file",
        sortModifiedAt: stats ? stats.mtime.getTime() : null,
        sortSizeBytes: stats ? (stats.isDirectory() ? null : stats.size) : null,
      };
    }),
  );

  return {
    path: directoryPath,
    parentPath: directoryPath === dirname(directoryPath) ? null : dirname(directoryPath),
    entries: entries
      .filter((value) => value !== null)
      .sort((left, right) => compareEntries(left, right, sortBy, sortDirection, foldersFirst))
      .map(({ sortModifiedAt: _sortModifiedAt, sortSizeBytes: _sortSizeBytes, ...entry }) => entry),
  };
}

// Metadata batches are constrained to a single parent directory so the renderer cannot use
// this as a generic arbitrary-path stat API.
export async function getDirectoryMetadataBatch(
  directoryPath: string,
  paths: string[],
  fileSystem: ExplorerFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<IpcResponse<"directory:getMetadataBatch">> {
  const resolvedDirectoryPath = await resolveDirectoryPath(directoryPath, fileSystem);
  const items = await Promise.all(
    paths.map(async (path) => {
      const resolvedPath = resolve(path);
      if (dirname(resolvedPath) !== resolvedDirectoryPath) {
        throw new Error(`Path ${resolvedPath} is outside ${resolvedDirectoryPath}`);
      }
      return readDirectoryEntryMetadata(resolvedPath, fileSystem);
    }),
  );
  return {
    directoryPath: resolvedDirectoryPath,
    items,
  };
}

// The info panel uses this richer single-item shape rather than stitching fields together
// from snapshot + metadata batch responses.
export async function getItemProperties(
  path: string,
  fileSystem: ExplorerFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<IpcResponse<"item:getProperties">> {
  const resolvedPath = resolve(path);
  const stats = await fileSystem.stat(resolvedPath);
  const symlinkStats = await safeLstat(resolvedPath, fileSystem);
  const isSymlink = symlinkStats?.isSymbolicLink?.() ?? false;
  const kind = deriveKindFromStats(stats, isSymlink);
  return {
    item: {
      path: resolvedPath,
      name: basename(resolvedPath),
      extension: extname(resolvedPath).replace(/^\./, "").toLowerCase(),
      kind,
      kindLabel: getKindLabel(kind, resolvedPath),
      isHidden: isHiddenName(basename(resolvedPath)),
      isSymlink,
      createdAt: toIsoStringOrNull(stats.birthtime),
      modifiedAt: toIsoStringOrNull(stats.mtime),
      sizeBytes: stats.isDirectory() ? null : stats.size,
      sizeStatus: stats.isDirectory() ? "deferred" : "ready",
      permissionMode: normalizePermissionMode(stats.mode),
    },
  };
}

// Suggestions resolve the deepest existing directory prefix, then match only directory-like
// children under that base path.
export async function getPathSuggestions(
  inputPath: string,
  includeHidden: boolean,
  limit = 12,
  fileSystem: ExplorerFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<IpcResponse<"path:getSuggestions">> {
  const query = await resolvePathSuggestionQuery(inputPath, fileSystem);
  if (!query) {
    return {
      inputPath,
      basePath: null,
      suggestions: [],
    };
  }

  const dirents = await fileSystem.readdir(query.basePath, { withFileTypes: true });
  const matches = await Promise.all(
    dirents.map((dirent) =>
      buildPathSuggestionEntry(dirent, query.basePath, query.typedName, includeHidden, fileSystem),
    ),
  );

  return {
    inputPath,
    basePath: query.basePath,
    suggestions: matches
      .filter((value) => value !== null)
      .sort(compareEntriesByName)
      .slice(0, limit),
  };
}

async function buildPathSuggestionEntry(
  dirent: FileSystemDirent,
  basePath: string,
  typedName: string,
  includeHidden: boolean,
  fileSystem: ExplorerFileSystem,
): Promise<IpcResponse<"path:getSuggestions">["suggestions"][number] | null> {
  if (!includeHidden && isHiddenName(dirent.name)) {
    return null;
  }
  if (typedName.length > 0 && !dirent.name.toLowerCase().startsWith(typedName.toLowerCase())) {
    return null;
  }

  const entryPath = resolve(basePath, dirent.name);
  try {
    const kind = await classifyEntry(dirent, entryPath, fileSystem);
    if (kind !== "directory" && kind !== "symlink_directory") {
      return null;
    }
    return {
      path: entryPath,
      name: dirent.name,
      isDirectory: true,
    };
  } catch {
    return null;
  }
}

export async function resolvePathTarget(
  path: string,
  fileSystem: ExplorerFileSystem = DEFAULT_FILE_SYSTEM,
): Promise<IpcResponse<"path:resolve">> {
  // Failure is represented as `resolvedPath: null` so callers can fall back gracefully.
  const resolvedInputPath = resolve(path);
  try {
    const resolvedPath = await fileSystem.realpath(resolvedInputPath);
    return {
      inputPath: resolvedInputPath,
      resolvedPath,
    };
  } catch {
    return {
      inputPath: resolvedInputPath,
      resolvedPath: null,
    };
  }
}

async function readDirectoryEntryMetadata(
  path: string,
  fileSystem: ExplorerFileSystem,
): Promise<IpcResponse<"directory:getMetadataBatch">["items"][number]> {
  // Directory sizes are intentionally deferred; everything else is cheap enough for bulk reads.
  const stats = await fileSystem.stat(path);
  const symlinkStats = await safeLstat(path, fileSystem);
  const isSymlink = symlinkStats?.isSymbolicLink?.() ?? false;
  const kind = deriveKindFromStats(stats, isSymlink);
  return {
    path,
    kindLabel: getKindLabel(kind, path),
    modifiedAt: toIsoStringOrNull(stats.mtime),
    sizeBytes: stats.isDirectory() ? null : stats.size,
    sizeStatus: stats.isDirectory() ? "deferred" : "ready",
    permissionMode: normalizePermissionMode(stats.mode),
  };
}

async function classifyEntry(
  dirent: FileSystemDirent,
  path: string,
  fileSystem: ExplorerFileSystem,
): Promise<EntryKind> {
  // Symlinks need a follow-up stat to determine whether the target behaves like a file or folder.
  if (dirent.isDirectory()) {
    return "directory";
  }
  if (dirent.isFile()) {
    return "file";
  }
  if (dirent.isSymbolicLink()) {
    try {
      const stats = await fileSystem.stat(path);
      return deriveKindFromStats(stats, true);
    } catch {
      return "other";
    }
  }
  return "other";
}

function deriveKindFromStats(stats: FileSystemStats, isSymlink: boolean): EntryKind {
  if (stats.isDirectory()) {
    return isSymlink ? "symlink_directory" : "directory";
  }
  if (stats.isFile()) {
    return isSymlink ? "symlink_file" : "file";
  }
  return "other";
}

async function resolveDirectoryPath(path: string, fileSystem: ExplorerFileSystem): Promise<string> {
  // Normalize through realpath when possible so aliased directories do not fork history/tree state.
  const resolvedPath = resolve(path);
  const stats = await fileSystem.stat(resolvedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedPath}`);
  }
  try {
    return await fileSystem.realpath(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

async function resolvePathSuggestionQuery(
  inputPath: string,
  fileSystem: ExplorerFileSystem,
): Promise<{ basePath: string; typedName: string } | null> {
  // Example:
  // `/Users/al/Doc` => basePath `/Users/al`, typedName `Doc`
  // `/Users/al/Documents/` => basePath `/Users/al/Documents`, typedName ``
  const trimmedInput = inputPath.trim();
  const normalizedPath = normalizeSuggestionInput(trimmedInput.length === 0 ? "/" : trimmedInput);
  const trailingSlash = hasTrailingSlash(trimmedInput);
  const parts = splitPathParts(normalizedPath);

  if (trailingSlash) {
    const exactDirectoryPath = await tryResolveDirectoryPath(normalizedPath, fileSystem);
    if (exactDirectoryPath) {
      return {
        basePath: exactDirectoryPath,
        typedName: "",
      };
    }
  }

  for (let index = parts.length; index >= 0; index -= 1) {
    const candidatePath = buildPathFromParts(parts.slice(0, index));
    const resolvedCandidatePath = await tryResolveDirectoryPath(candidatePath, fileSystem);
    if (!resolvedCandidatePath) {
      continue;
    }
    if (index === parts.length) {
      const typedName = parts.at(-1) ?? "";
      return {
        basePath: parentDirectoryPath(resolvedCandidatePath),
        typedName,
      };
    }
    return {
      basePath: resolvedCandidatePath,
      typedName: parts[index] ?? "",
    };
  }

  return null;
}

async function tryResolveDirectoryPath(
  path: string,
  fileSystem: ExplorerFileSystem,
): Promise<string | null> {
  try {
    return await resolveDirectoryPath(path, fileSystem);
  } catch {
    return null;
  }
}

async function safeLstat(
  path: string,
  fileSystem: ExplorerFileSystem,
): Promise<(FileSystemStats & { isSymbolicLink?: () => boolean }) | null> {
  try {
    return (await fileSystem.lstat(path)) as FileSystemStats & { isSymbolicLink?: () => boolean };
  } catch {
    return null;
  }
}

function compareEntries(
  left: IpcResponse<"directory:getSnapshot">["entries"][number] & {
    sortModifiedAt?: number | null;
    sortSizeBytes?: number | null;
  },
  right: IpcResponse<"directory:getSnapshot">["entries"][number] & {
    sortModifiedAt?: number | null;
    sortSizeBytes?: number | null;
  },
  sortBy: IpcRequest<"directory:getSnapshot">["sortBy"],
  sortDirection: IpcRequest<"directory:getSnapshot">["sortDirection"],
  foldersFirst: boolean,
): number {
  // `foldersFirst` is applied before the requested sort mode, matching Finder-style behavior.
  if (foldersFirst) {
    const leftRank = isDirectoryKind(left.kind) ? 0 : 1;
    const rightRank = isDirectoryKind(right.kind) ? 0 : 1;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
  }

  let compared = 0;
  if (sortBy === "modified") {
    compared = compareNullableNumbers(left.sortModifiedAt ?? null, right.sortModifiedAt ?? null);
  } else if (sortBy === "kind") {
    compared = getKindLabel(left.kind, left.path).localeCompare(
      getKindLabel(right.kind, right.path),
    );
  } else if (sortBy === "size") {
    compared = compareNullableNumbers(left.sortSizeBytes ?? null, right.sortSizeBytes ?? null);
  } else {
    compared = compareEntriesByName(left, right);
  }

  if (compared === 0) {
    compared = compareEntriesByName(left, right);
  }

  return sortDirection === "desc" ? -compared : compared;
}

function compareEntriesByName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  // Nulls sort last so missing metadata does not float directories/unknown values to the top.
  if (left === right) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function isDirectoryKind(kind: EntryKind): boolean {
  return kind === "directory" || kind === "symlink_directory";
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

function normalizeSuggestionInput(inputPath: string): string {
  return resolve(inputPath);
}

function hasTrailingSlash(inputPath: string): boolean {
  return inputPath.endsWith("/");
}

function splitPathParts(path: string): string[] {
  return path.split("/").filter((part) => part.length > 0);
}

function buildPathFromParts(parts: string[]): string {
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function parentDirectoryPath(path: string): string {
  return dirname(resolve(path));
}

function getKindLabel(kind: EntryKind, path: string): string {
  // Human-readable labels are used directly in details/info UI and intentionally stay simple.
  if (kind === "directory") {
    return "Folder";
  }
  if (kind === "symlink_directory") {
    return "Alias Folder";
  }
  if (kind === "symlink_file") {
    return "Alias File";
  }
  if (kind === "file") {
    const extension = extname(path).replace(/^\./, "").toLowerCase();
    return extension.length > 0 ? `${extension.toUpperCase()} File` : "File";
  }
  return "Item";
}

function toIsoStringOrNull(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString();
}

function normalizePermissionMode(mode: number | null | undefined): number | null {
  if (typeof mode !== "number" || !Number.isFinite(mode) || mode < 0) {
    return null;
  }
  return mode & 0o777;
}
