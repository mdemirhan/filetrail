/**
 * Provides filesystem implementations backed by Electron's `original-fs` module,
 * which bypasses Electron's ASAR archive patching.
 *
 * Why this is needed:
 * Electron patches `node:fs` at startup to transparently treat `.asar` archive
 * files as virtual directories. This is convenient for loading app resources but
 * breaks real filesystem operations: copying an app bundle that contains `.asar`
 * files would try to recursively enter the archive instead of copying the file,
 * and directory listings would show `.asar` files as folders instead of files.
 *
 * Every filesystem operation that needs to see the real filesystem (write service
 * copy/paste, write operations like rename/mkdir, and explorer directory listings)
 * must use `original-fs` instead of `node:fs`.
 */

import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";

import type { Volume } from "@filetrail/contracts";
import {
  createStoppableCopyFile,
  isAppleDoubleOnItsVolume,
  removeEmptyFolder,
} from "@filetrail/core";
import type { ExplorerFileSystem } from "@filetrail/core";
import type { WriteServiceFileSystem, WriteServiceStats } from "@filetrail/core";
import type { BatchRenameInspectDeps } from "./bootstrap/batchRenameInspect";
import type { ItemSize } from "./bootstrap/folderSizeAdjust";
import type { WriteOperationFs } from "./bootstrap/writeOperations";

// Electron patches `node:fs` at startup. The unpatched version is available as
// `original-fs` but only through `require()`, not ESM `import`.
const require = createRequire(import.meta.url);
const originalFs = require("original-fs") as typeof import("node:fs");

// Load the native copyfile(3) addon. This provides CoW clones on APFS and full
// metadata preservation (timestamps, xattrs, ACLs, flags). The addon is required
// on macOS — the build step compiles it, so a missing addon means a broken build.
const addon = require("@filetrail/native-fs") as {
  nativeCopyFile: (src: string, dst: string, stopFlag?: Int32Array) => Promise<void>;
  nativeGetFlags: (path: string) => Promise<number>;
  nativeSetFlags: (path: string, flags: number) => Promise<void>;
  nativeCopyMetadata: (src: string, dst: string) => Promise<void>;
  nativeGetFileIcon: (path: string, size: number) => Promise<Buffer | null>;
  nativeGetFileThumbnail: (path: string, size: number) => Promise<Buffer | null>;
  nativeFolderSize: (
    folderPath: string,
    onFinished?: (finishedJson: string) => void,
    options?: { background: boolean },
  ) => Promise<string>;
  nativeFolderSizeCancel: () => void;
  nativeItemSize: (path: string) => Promise<ItemSize>;
  nativeRenameExclusive: (from: string, to: string) => Promise<void>;
  nativeIsCaseSensitive: (path: string) => Promise<boolean | null>;
  nativeUsesAppleDouble: (path: string) => Promise<boolean | null>;
  nativeIsPackage: (path: string) => Promise<boolean | null>;
  nativeDatesTaken: (paths: string[]) => Promise<Array<string | null>>;
  nativeListVolumes: () => Volume[];
  nativeListMounts: () => Array<{ path: string; isLocal: boolean }>;
  nativeTrashItem: (path: string) => Promise<string | null>;
  nativeGetAcl: (path: string) => Promise<string | null>;
  nativeSetAcl: (path: string, acl: string | null) => Promise<void>;
};
const {
  nativeCopyFile,
  nativeCopyMetadata,
  nativeGetFileIcon,
  nativeGetFileThumbnail,
  nativeFolderSize,
  nativeFolderSizeCancel,
  nativeItemSize,
  nativeRenameExclusive,
  nativeIsCaseSensitive,
  nativeUsesAppleDouble,
  nativeIsPackage,
  nativeGetFlags,
  nativeSetFlags,
  nativeDatesTaken,
  nativeListVolumes,
  nativeListMounts,
  nativeTrashItem,
  nativeGetAcl,
  nativeSetAcl,
} = addon;

// Stop takes effect part way through a large file.
const copyFileStoppable = createStoppableCopyFile(nativeCopyFile);

const {
  constants: fsConstants,
  promises: {
    access,
    chmod,
    open,
    lstat,
    lutimes,
    mkdir,
    readdir,
    readlink,
    realpath,
    rename,
    rm,
    rmdir,
    stat,
    symlink,
    utimes,
  },
  createReadStream,
  createWriteStream,
} = originalFs;

/** WriteServiceFileSystem backed by original-fs for copy/paste operations. */
export const originalFileSystem: WriteServiceFileSystem = {
  lstat: (path) => lstat(path) as Promise<WriteServiceStats>,
  stat: (path) => stat(path) as Promise<WriteServiceStats>,
  realpath: (path) => realpath(path),
  readdir: (path) => readdir(path),
  readlink: (path) => readlink(path),
  chmod: async (path, mode) => {
    await chmod(path, mode);
  },
  rename: async (oldPath, newPath) => {
    await rename(oldPath, newPath);
  },
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  // Never replaces an existing item (renamex_np with RENAME_EXCL).
  renameExclusive: (oldPath, newPath) => nativeRenameExclusive(oldPath, newPath),
  rm: async (path, options) => {
    await rm(path, options);
  },
  rmdir: (path) => removeEmptyFolder(readdir, rmdir, path),
  isCaseSensitive: (path) => nativeIsCaseSensitive(path),
  isPackage: (path) => nativeIsPackage(path),
  symlink: async (target, path) => {
    await symlink(target, path);
  },
  copyFile: async (sourcePath, destinationPath, signal, onProgress) => {
    await copyFileStoppable(sourcePath, destinationPath, signal, onProgress);
  },
  getFlags: (path) => nativeGetFlags(path),
  setFlags: (path, flags) => nativeSetFlags(path, flags),
  setAcl: (path, acl) => nativeSetAcl(path, acl),
  copyMetadata: nativeCopyMetadata,
  copyFileStream: async (sourcePath, destinationPath, signal) => {
    // "wx": never truncate an item that appeared at the destination in the meantime.
    await pipeline(
      createReadStream(sourcePath),
      createWriteStream(destinationPath, { flags: "wx" }),
      { signal },
    );
  },
  utimes: async (path, atimeMs, mtimeMs) => {
    await utimes(path, atimeMs / 1000, mtimeMs / 1000);
  },
  lutimes: async (path, atimeMs, mtimeMs) => {
    await lutimes(path, atimeMs / 1000, mtimeMs / 1000);
  },
  canModifyFolder: async (path) => {
    await access(path, fsConstants.W_OK);
  },
  isAppleDouble: (path) => isAppleDoubleOnItsVolume(nativeUsesAppleDouble, open, path),
};

/** ExplorerFileSystem backed by original-fs for directory listings. */
export const originalExplorerFileSystem: ExplorerFileSystem = {
  readdir: ((path: string, options: { withFileTypes: true }) =>
    readdir(path, options)) as ExplorerFileSystem["readdir"],
  stat: ((path: string) => stat(path)) as ExplorerFileSystem["stat"],
  lstat: ((path: string) => lstat(path)) as ExplorerFileSystem["lstat"],
  realpath: (path: string) => realpath(path),
};

/** Rename backed by original-fs for write operations (rename, etc.). Replaces an item
 *  already at `newPath`, so it is used only where that item is the one being renamed. */
export const originalRename = (oldPath: string, newPath: string): Promise<void> =>
  rename(oldPath, newPath);

/** Moves an item to its disk's Trash and resolves with the path it has there (the Trash
 *  may give it another name). Wrapped by createTrashItem, which says why one failed. */
export const originalTrashItem = (path: string): Promise<string | null> => nativeTrashItem(path);

/** Rename that fails with EEXIST instead of replacing an item at `newPath`. */
export const originalRenameExclusive = (oldPath: string, newPath: string): Promise<void> =>
  nativeRenameExclusive(oldPath, newPath);

/** What rename, New Folder, Trash and Delete Immediately work with, backed by original-fs.
 *  `trash` moves an item to the Trash and says where it went (see createTrashItem). */
export function createOriginalWriteOperationFs(
  trash: (path: string) => Promise<string | null>,
): WriteOperationFs {
  return {
    lstat: originalFileSystem.lstat,
    stat: originalFileSystem.stat,
    mkdir: (path) => originalFileSystem.mkdir(path),
    readdir: originalFileSystem.readdir,
    realpath: originalFileSystem.realpath,
    rename: originalRename,
    renameExclusive: originalRenameExclusive,
    rm: (path, options) => originalFileSystem.rm(path, options),
    trash,
    getFlags: (path) => nativeGetFlags(path),
    setFlags: (path, flags) => nativeSetFlags(path, flags),
    chmod: (path, mode) => chmod(path, mode),
    getAcl: (path) => nativeGetAcl(path),
    setAcl: (path, acl) => nativeSetAcl(path, acl),
    itemSize: (path) => nativeItemSize(path),
    isPackage: (path) => nativeIsPackage(path),
  };
}

/** What the Rename sheet's checks read, backed by original-fs and the native module.
 *  `assertRenamable` refuses the folders that are never renamed. */
export function createOriginalBatchRenameInspectDeps(args: {
  homePath: string;
  assertRenamable: (path: string) => Promise<void>;
}): BatchRenameInspectDeps {
  return {
    lstat: (path) => lstat(path),
    stat: (path) => stat(path),
    readdir: (path) => readdir(path),
    isCaseSensitive: (path) => nativeIsCaseSensitive(path),
    getFlags: (path) => nativeGetFlags(path),
    canWriteFolder: (path) =>
      access(path, fsConstants.W_OK).then(
        () => true,
        () => false,
      ),
    readDatesTaken: (paths) => nativeDatesTaken(paths),
    assertRenamable: args.assertRenamable,
    homePath: args.homePath,
  };
}

/** Get macOS file icon as PNG buffer using NSWorkspace. */
export const getFileIcon = nativeGetFileIcon;

/** Get a picture of a file's content (JPEG or PNG data) from Quick Look. */
export const getFileThumbnail = nativeGetFileThumbnail;

/**
 * Recursive folder size calculation using getattrlistbulk(2). Returns JSON string; the
 * sub-folders finished while it runs are handed to `onFinished` as they finish.
 */
export const getFolderSize = nativeFolderSize;

/** Cancel the active folder size calculation. */
export const cancelFolderSize = nativeFolderSizeCancel;

/** The disks mounted under /Volumes, from the mount table (getmntinfo). */
export const listVolumes = nativeListVolumes;

/** Every mount, wherever it is, and whether it is a local disk (getmntinfo). */
export const listMounts = nativeListMounts;

/** Where a path really is, symlinks followed, read at once (for the disk a path is on). */
export const realpathNow = (path: string): string => originalFs.realpathSync.native(path);
