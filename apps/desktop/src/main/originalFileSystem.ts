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

import type { ExplorerFileSystem } from "@filetrail/core";
import type { WriteServiceFileSystem, WriteServiceStats } from "@filetrail/core";

// Electron patches `node:fs` at startup. The unpatched version is available as
// `original-fs` but only through `require()`, not ESM `import`.
const require = createRequire(import.meta.url);
const originalFs = require("original-fs") as typeof import("node:fs");

// Load the native copyfile(3) addon. This provides CoW clones on APFS and full
// metadata preservation (timestamps, xattrs, ACLs, flags). The addon is required
// on macOS — the build step compiles it, so a missing addon means a broken build.
const addon = require("@filetrail/native-fs") as {
  nativeCopyFile: (src: string, dst: string) => Promise<void>;
  nativeGetFileIcon: (path: string, size: number) => Promise<Buffer | null>;
};
const { nativeCopyFile, nativeGetFileIcon } = addon;

const {
  promises: { chmod, lstat, lutimes, mkdir, readdir, readlink, realpath, rename, rm, stat, symlink, utimes },
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
  rm: async (path, options) => {
    await rm(path, options);
  },
  symlink: async (target, path) => {
    await symlink(target, path);
  },
  copyFile: async (sourcePath, destinationPath) => {
    await mkdir(dirname(destinationPath), { recursive: true });
    await nativeCopyFile(sourcePath, destinationPath);
  },
  copyFileStream: async (sourcePath, destinationPath, signal) => {
    await mkdir(dirname(destinationPath), { recursive: true });
    await pipeline(createReadStream(sourcePath), createWriteStream(destinationPath), { signal });
  },
  utimes: async (path, atimeMs, mtimeMs) => {
    await utimes(path, atimeMs / 1000, mtimeMs / 1000);
  },
  lutimes: async (path, atimeMs, mtimeMs) => {
    await lutimes(path, atimeMs / 1000, mtimeMs / 1000);
  },
};

/** ExplorerFileSystem backed by original-fs for directory listings. */
export const originalExplorerFileSystem: ExplorerFileSystem = {
  readdir: ((path: string, options: { withFileTypes: true }) =>
    readdir(path, options)) as ExplorerFileSystem["readdir"],
  stat: ((path: string) => stat(path)) as ExplorerFileSystem["stat"],
  lstat: ((path: string) => lstat(path)) as ExplorerFileSystem["lstat"],
  realpath: (path: string) => realpath(path),
};

/** Rename backed by original-fs for write operations (rename, etc.). */
export const originalRename = (oldPath: string, newPath: string): Promise<void> =>
  rename(oldPath, newPath);

/** Get macOS file icon as PNG buffer using NSWorkspace. */
export const getFileIcon = nativeGetFileIcon;
