// Readable reasons for what went wrong, without paths: the item is always shown next to them.

const ERROR_CODE_MESSAGES: Record<string, string> = {
  ENOSPC: "There isn't enough free space on the destination disk.",
  EDQUOT: "The destination's storage quota is full.",
  EACCES: "You don't have permission to access this item.",
  EPERM: "You don't have permission to access this item.",
  EROFS: "The destination is read-only.",
  ENAMETOOLONG: "The name is too long.",
  ENOENT: "The item no longer exists.",
  EEXIST: "An item with this name already exists.",
  ENOTEMPTY: "The folder isn't empty.",
  EBUSY: "The item is in use.",
  EIO: "A disk error occurred.",
  EXDEV: "The item can't be moved directly to a different disk.",
  EISDIR: "A folder is in the way where a file was expected.",
  // Node's own code for removing a folder as if it were a file.
  ERR_FS_EISDIR: "A folder is in the way where a file was expected.",
  ENOTDIR: "Part of the path isn't a folder any more.",
  ENOTSUP: "This volume doesn't support this operation.",
  EOPNOTSUPP: "This volume doesn't support this operation.",
  EINVAL: "This volume doesn't accept this name or operation.",
  ELOOP: "The item's location loops back on itself through symbolic links.",
  EFBIG: "The file is too large for this volume.",
  EMFILE: "Too many files are open. Close some apps and try again.",
  ENFILE: "Too many files are open. Close some apps and try again.",
  ETIMEDOUT: "The volume took too long to respond.",
  EINTR: "The operation was interrupted. Try again.",
  EAGAIN: "The item is temporarily unavailable. Try again.",
  ENXIO: "The disk isn't available.",
  ENODEV: "The disk isn't available.",
  ENOMEM: "There isn't enough memory to finish this.",
  ESTALE: "The network volume went away. Reconnect it and try again.",
};

/** A readable, path-free reason for a failed item (the item itself is shown next to it). */
export function describeCopyPasteError(error: unknown): string {
  const code = errorCode(error);
  if (code !== undefined && ERROR_CODE_MESSAGES[code]) {
    return ERROR_CODE_MESSAGES[code];
  }
  return toErrorMessage(error);
}

// The code on a Trash failure on a disk that may have no Trash (a network share, some USB
// drives): there, and only there, deleting the item for good may be offered instead.
export const NO_TRASH_ERROR_CODE = "ENOTRASH";

// BSD flags that stop an item from being renamed, moved, changed or deleted. UF_IMMUTABLE
// is Finder's "Locked"; the others are rarer but refuse the same things.
const UF_IMMUTABLE = 0x2;
const UF_APPEND = 0x4;
const SF_IMMUTABLE = 0x20000;
const SF_APPEND = 0x40000;
export const LOCK_FLAGS = UF_IMMUTABLE | UF_APPEND | SF_IMMUTABLE | SF_APPEND;
// The ones the item's owner may clear (the SF_ ones need root).
export const USER_LOCK_FLAGS = UF_IMMUTABLE | UF_APPEND;

/** Whether the item is locked (Finder's "Locked", or a flag that refuses the same
 *  things). False when it can't be told: the item is then treated as unlocked. */
export async function isLocked(
  fileSystem: { getFlags?: (path: string) => Promise<number> },
  path: string,
): Promise<boolean> {
  if (!fileSystem.getFlags) {
    return false;
  }
  try {
    return ((await fileSystem.getFlags(path)) & LOCK_FLAGS) !== 0;
  } catch {
    return false;
  }
}

/** A refusal (EPERM/EACCES) explained by one of `paths` being locked: an Error naming the
 *  locked item, or null when none of them is. */
export async function findLockedRefusal(
  fileSystem: { getFlags?: (path: string) => Promise<number> },
  error: unknown,
  paths: readonly string[],
): Promise<Error | null> {
  const code = errorCode(error);
  if (code !== "EPERM" && code !== "EACCES") {
    return null;
  }
  for (const path of paths) {
    if (await isLocked(fileSystem, path)) {
      return new Error(lockedMessage(path));
    }
  }
  return null;
}

export function lockedMessage(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1) || path;
  return `“${name}” is locked. Unlock it in Finder's Get Info and try again.`;
}

export function errorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
