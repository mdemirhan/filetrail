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
