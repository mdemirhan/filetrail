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
 * @param stopFlag - Optional. Setting `stopFlag[0]` to a non-zero value stops the copy part
 *   way through the file; it then fails with `code: "ECANCELED"` and leaves no partial file.
 * @returns A promise that resolves when the copy completes.
 * @throws An error with a `code` property (the errno name, e.g. `"ENOENT"`, `"ENOTSUP"`)
 *   plus `errno`, `syscall`, `path` and `dest` on failure.
 */
export function nativeCopyFile(
  sourcePath: string,
  destinationPath: string,
  stopFlag?: Int32Array,
): Promise<void>;

/**
 * The item's BSD flags (`st_flags` from `lstat(2)`; a symlink is not followed).
 * `UF_IMMUTABLE` (0x2) is Finder's "Locked".
 *
 * @throws An error with a `code` property (the errno name) on failure.
 */
export function nativeGetFlags(path: string): Promise<number>;

/**
 * Sets the item's BSD flags with `lchflags(2)` (a symlink is not followed). Only the owner
 * can change the user flags; the system flags need root.
 *
 * @throws An error with a `code` property (the errno name) on failure.
 */
export function nativeSetFlags(path: string, flags: number): Promise<void>;

/**
 * Copies a folder's own metadata onto a folder that already exists, using `copyfile(3)`
 * with `COPYFILE_METADATA`: mode, flags, dates, extended attributes (Finder tags, the
 * custom-icon flag, quarantine) and ACLs. Nothing inside the folder is copied.
 *
 * @throws An error with a `code` property (the errno name) on failure.
 */
export function nativeCopyMetadata(sourcePath: string, destinationPath: string): Promise<void>;

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
 * What Finder shows in its Kind column for the file ("Markdown Document", "PNG image",
 * "Plain Text Document"): the localized description of its type
 * (`NSURLLocalizedTypeDescriptionKey`), which the apps that open it can name.
 *
 * Synchronous and fast; callers cache it per extension. `null` when there is none.
 *
 * @param path - Absolute path to the file.
 */
export function nativeKindForPath(path: string): string | null;

/**
 * Whether macOS shows the folder as a single item, a package (`NSURLIsPackageKey`): apps,
 * Keynote and Pages documents, photo libraries, any type an installed app declares as a
 * package, and folders with the package bit set.
 *
 * Runs on a libuv thread pool thread. `null` when it can't be told (the item is gone).
 *
 * @param path - Absolute path to the folder.
 */
export function nativeIsPackage(path: string): Promise<boolean | null>;

/**
 * When each photo was taken, read from its own metadata (the date the camera recorded, in
 * EXIF): one answer per path, in order, as "2026-05-14T18:02:11" on the clock of this Mac,
 * or null when there is none, or the item isn't a photo.
 *
 * @param paths - Absolute paths to the items.
 */
export function nativeDatesTaken(paths: string[]): Promise<Array<string | null>>;

/**
 * Recursively calculates the total size of a folder using `getattrlistbulk(2)`.
 *
 * Returns a JSON string:
 * `{"total":N,"diskTotal":N,"fileCount":N,"folderCount":N,"dev":N,"dirs":{"path":[sizeBytes,diskBytes,fileCount,folderCount],...}}`
 * where `total` is the root folder logical size in bytes, `diskTotal` is the
 * allocated disk space, `fileCount` is the total number of regular files and
 * symlinks, `folderCount` the total number of folders below the root (package
 * contents included), `dev` the device id of the disk walked (the walk never
 * leaves it), and `dirs` maps each sub-directory path it walked to an array of
 * `[sizeBytes, diskBytes, fileCount, folderCount]`.
 *
 * Each sub-directory is finished as soon as everything inside it has been walked. With
 * `onFinished`, the ones finished so far are handed to it while the walk runs, about
 * five times a second, as `{"dev":N,"dirs":{...}}`; `dirs` in the result then holds only
 * those finished since the last hand-over. Every sub-directory is in exactly one of them.
 * When the walk is cancelled, the ones it finished before stopping are whole and are
 * handed to `onFinished` before the promise rejects; a cancelled walk never finishes a
 * directory it was still listing.
 *
 * Runs on a libuv thread pool thread — non-blocking. At most one calculation
 * runs at a time; concurrent calls are queued and start after the active one
 * settles. To start a new calculation immediately, cancel the active one
 * first via `nativeFolderSizeCancel()`.
 *
 * @param folderPath - Absolute path to the folder to size.
 * @param onFinished - Called with the sub-directories finished since the last call.
 * @returns A promise that resolves with a JSON string.
 * @throws An error with `code: "ECANCELLED"` if cancelled via `nativeFolderSizeCancel()`.
 */
export function nativeFolderSize(
  folderPath: string,
  onFinished?: (finishedJson: string) => void,
): Promise<string>;

/**
 * The sub-directories the active `nativeFolderSize` walk has finished since this was last
 * called, as `{"dev":N,"dirs":{...}}`, or null when there are none or no walk is active.
 * The JS wrapper calls this itself while a walk with `onFinished` runs.
 */
export function nativeFolderSizeTakeFinished(): string | null;

/**
 * Cancels the currently active folder size calculation, if any.
 *
 * The running `nativeFolderSize` promise will reject with `code: "ECANCELLED"`.
 * Queued (not yet started) calculations are unaffected. Safe to call when no
 * calculation is active (no-op).
 */
export function nativeFolderSizeCancel(): void;

/**
 * One item as `nativeFolderSize` counts it inside its folder: a file or symlink (not
 * followed) by its data length and allocated size, a folder only as one (its contents are
 * the walk's, and `sizeBytes`/`diskBytes` are 0), anything else (sockets, pipes, devices)
 * not at all. `dev` is the device id of the disk it is on.
 *
 * @param path - Absolute path to the item.
 */
export function nativeItemSize(path: string): Promise<{
  kind: "file" | "folder" | "other";
  sizeBytes: number;
  diskBytes: number;
  dev: number;
}>;

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

/**
 * Moves the item at `path` to the Trash of its disk (`-[NSFileManager
 * trashItemAtURL:resultingItemURL:error:]`) and resolves with the path it has there. The
 * Trash renames an item whose name is taken there ("notes 2.txt"), so only this path finds
 * it again.
 *
 * @throws An error whose message is the Trash's own sentence, with `code: "ENOTSUP"` when
 *   the disk has no Trash, `"ENOENT"`, `"EACCES"`, or another errno name when it can be
 *   told (no `code` otherwise).
 */
export function nativeTrashItem(path: string): Promise<string>;

/** A disk mounted under /Volumes (see `nativeListVolumes`). */
export type NativeVolume = {
  /** Where it is mounted: `/Volumes/<name>`. */
  path: string;
  name: string;
  /** False for a network share. */
  isLocal: boolean;
  isReadOnly: boolean;
  /** The file system's name, such as `apfs`, `smbfs` or `exfat`. */
  fileSystem: string;
};

/**
 * The disks mounted besides the startup disk, as Finder's sidebar lists them: those under
 * /Volumes, without Time Machine's snapshots or the system's own volumes. Read from the
 * mount table with `getmntinfo(3)` without asking the disks themselves, so it returns at
 * once even when a network share has stopped answering.
 */
export function nativeListVolumes(): NativeVolume[];

/** What a file drag's drop did; "delete" is the Trash in the Dock, "none" a cancel. */
export type FileDragOperation = "copy" | "move" | "link" | "delete" | "none";

/** A dragged item as it shows in the window, in points from the window's top left. */
export type FileDragImage = {
  /** Which of the dragged paths it is. */
  index: number;
  iconRect: { x: number; y: number; width: number; height: number };
  nameRect: { x: number; y: number; width: number; height: number };
  nameFontSize: number;
  /** Centered in `nameRect` (Icon view), or starting at its left (the lists). */
  nameCentered: boolean;
  /** PNG or JPEG data shown in place of the icon (its Quick Look picture), or null. */
  thumbnail: Buffer | null;
};

/**
 * Starts a system file drag of `paths` from the window whose native handle is
 * `viewHandle` (`BrowserWindow.getNativeWindowHandle()`), at the pointer. The drag
 * carries file URLs, as Finder's do, and looks like Finder's: each item in `images` is
 * drawn where it is on screen, its icon and its name, and they keep their places as they
 * move. Items not in `images` go along unseen; with none at all, the first is drawn at the
 * pointer. Call on the main thread while the mouse button is down; returns false (and
 * never calls `onEnded`) when the drag couldn't start.
 *
 * Over this app's own windows the ⌥ and ⌘ keys don't change the drag's operations (the
 * page reads them itself); elsewhere they work as in a Finder drag.
 *
 * @param onEnded - Called once, when the drag ends, with what the drop reported. Apps
 *   other than Finder may report "move" for a drop that moved nothing.
 */
export function nativeStartFileDrag(
  viewHandle: Buffer,
  paths: string[],
  images: FileDragImage[],
  onEnded: (operation: FileDragOperation) => void,
): boolean;
