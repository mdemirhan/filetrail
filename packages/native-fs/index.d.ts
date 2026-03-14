/**
 * Copies a file using macOS `copyfile(3)` with `COPYFILE_ALL | COPYFILE_CLONE`.
 *
 * - Attempts a CoW (copy-on-write) clone on APFS same-volume copies (instant).
 * - Falls back to a full data copy when CoW is not available.
 * - Preserves all metadata: stat info (timestamps, mode, flags), xattrs, and ACLs.
 * - Runs on a libuv thread pool thread — non-blocking.
 *
 * @param sourcePath - Absolute path to the source file.
 * @param destinationPath - Absolute path to the destination file. Parent directory must exist.
 * @returns A promise that resolves when the copy completes.
 * @throws An error with a `code` property (e.g. `"ENOENT"`, `"EACCES"`) on failure.
 */
export function nativeCopyFile(sourcePath: string, destinationPath: string): Promise<void>;

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
 * can be active at a time; starting a new one while another is running is
 * undefined behavior (the JS caller must serialize).
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
 * Safe to call when no calculation is active (no-op).
 */
export function nativeFolderSizeCancel(): void;
