/**
 * Copies a file using macOS `copyfile(3)` with `COPYFILE_ALL | COPYFILE_CLONE | COPYFILE_EXCL`.
 *
 * - Attempts a CoW (copy-on-write) clone on APFS same-volume copies (instant).
 * - Falls back to a full data copy when CoW is not available.
 * - Preserves all metadata: stat info (timestamps, mode, flags), xattrs, and ACLs.
 * - Never replaces an existing destination: fails with `EEXIST` instead.
 * - Runs on a libuv thread pool thread — non-blocking.
 *
 * @param sourcePath - Absolute path to the source file.
 * @param destinationPath - Absolute path to the destination file. Parent directory must exist.
 * @returns A promise that resolves when the copy completes.
 * @throws An error with a `code` property (the errno name, e.g. `"ENOENT"`, `"ENOTSUP"`)
 *   plus `errno`, `syscall`, `path` and `dest` on failure.
 */
export function nativeCopyFile(sourcePath: string, destinationPath: string): Promise<void>;

/**
 * Copies a folder's own metadata onto a folder that already exists, using `copyfile(3)`
 * with `COPYFILE_METADATA`: mode, flags, dates, extended attributes (Finder tags, the
 * custom-icon flag, quarantine) and ACLs. Nothing inside the folder is copied.
 *
 * `undefined` when the loaded binary predates it.
 *
 * @throws An error with a `code` property (the errno name) on failure.
 */
export const nativeCopyMetadata:
  | ((sourcePath: string, destinationPath: string) => Promise<void>)
  | undefined;

/**
 * Returns the macOS file icon for the given path as a PNG buffer.
 *
 * Uses `NSWorkspace.iconForFile:` to retrieve the system icon (including custom
 * app icons for `.app` bundles). The icon is rendered at the requested pixel
 * dimensions and returned as PNG data.
 *
 * Runs on a libuv thread pool thread — non-blocking.
 *
 * @param path - Absolute path to the file or bundle.
 * @param size - Desired icon size in pixels (width and height, 16–512).
 * @returns A promise that resolves with PNG data, or `null` if the icon cannot be retrieved.
 */
export function nativeGetFileIcon(path: string, size: number): Promise<Buffer | null>;

/**
 * Returns a picture of the file's content (an image, a PDF page, a video frame, a
 * document page) from Quick Look's `QLThumbnailGenerator`, fitted into a square of
 * `size` pixels with its proportions kept.
 *
 * Pictures and videos come back as they are; other files are drawn as Finder draws
 * their icons, a page with its own outline and shadow on a clear background.
 *
 * The data is JPEG when the picture has no transparency and PNG otherwise. Quick Look
 * generates it out of process; nothing blocks while it does.
 *
 * @param path - Absolute path to the file.
 * @param size - Longest side in pixels (16–1024).
 * @returns A promise that resolves with the image data, or `null` when Quick Look has
 *   no preview for the file (its icon is not returned instead).
 */
export function nativeGetFileThumbnail(path: string, size: number): Promise<Buffer | null>;

/**
 * Recursively calculates the total size of a folder using `getattrlistbulk(2)`.
 *
 * Returns a JSON string:
 * `{"total":N,"diskTotal":N,"fileCount":N,"dirs":{"path":[sizeBytes,diskBytes,fileCount],...}}`
 * where `total` is the root folder logical size in bytes, `diskTotal` is the
 * allocated disk space, `fileCount` is the total number of regular files and
 * symlinks, and `dirs` maps each sub-directory path to an array of
 * `[sizeBytes, diskBytes, fileCount]`.
 *
 * Runs on a libuv thread pool thread — non-blocking. At most one calculation
 * runs at a time; concurrent calls are queued and start after the active one
 * settles. To start a new calculation immediately, cancel the active one
 * first via `nativeFolderSizeCancel()`.
 *
 * @param folderPath - Absolute path to the folder to size.
 * @returns A promise that resolves with a JSON string.
 * @throws An error with `code: "ECANCELLED"` if cancelled via `nativeFolderSizeCancel()`.
 */
export function nativeFolderSize(folderPath: string): Promise<string>;

/**
 * Cancels the currently active folder size calculation, if any.
 *
 * The running `nativeFolderSize` promise will reject with `code: "ECANCELLED"`.
 * Queued (not yet started) calculations are unaffected. Safe to call when no
 * calculation is active (no-op).
 */
export function nativeFolderSizeCancel(): void;

/**
 * Moves `from` to `to` without ever replacing an item at `to`, using `renamex_np(2)`
 * with `RENAME_EXCL`. Volumes that don't support that flag fall back to checking for
 * `to` first, then `rename(2)`. Both paths must be on the same volume.
 *
 * @throws An error with `code: "EEXIST"` when something is already at `to`, `"EXDEV"`
 *   across volumes, or another errno name.
 */
export function nativeRenameExclusive(from: string, to: string): Promise<void>;

/**
 * Whether the volume holding `path` tells names apart by letter case, from
 * `pathconf(2)` `_PC_CASE_SENSITIVE`. Resolves `null` when the volume doesn't say.
 *
 * @throws An error with a `code` property when `path` can't be reached (e.g. `"ENOENT"`).
 */
export function nativeIsCaseSensitive(path: string): Promise<boolean | null>;
