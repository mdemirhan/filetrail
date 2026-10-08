import { basename } from "node:path";

import { NO_TRASH_ERROR_CODE, isLocked, lockedMessage } from "@filetrail/core";

type TrashFs = {
  lstat: (path: string) => Promise<{ dev?: number }>;
  getFlags?: (path: string) => Promise<number>;
};

// Moves an item to the Trash and resolves with the path it has there (nativeTrashItem),
// with a failure that says why.
// The Trash gives its reason as a sentence, with the errno it stands for when that can be
// told (see native_trash.m). A locked item says so. A disk without a Trash (a network
// share, some USB drives) answers ENOTSUP, or gives no code at all: on a disk other than
// the startup disk that is marked with NO_TRASH_ERROR_CODE, so callers can offer to delete
// instead. Any other reason (no permission, a read-only disk, an item that is gone) is the
// Trash's own sentence, and nothing is offered for permanent deletion; nor is anything on
// the startup disk ever.
export function createTrashItem(args: {
  trash: (path: string) => Promise<string>;
  fs: TrashFs;
  homePath: string;
}): (path: string) => Promise<string> {
  return async (path) => {
    try {
      return await args.trash(path);
    } catch (error) {
      if (await isLocked(args.fs, path)) {
        throw new Error(lockedMessage(path));
      }
      const reason = error instanceof Error && error.message ? error.message : null;
      const [item, home] = await Promise.all([
        args.fs.lstat(path).catch(() => null),
        args.fs.lstat(args.homePath).catch(() => null),
      ]);
      const onStartupDisk =
        item?.dev !== undefined && home?.dev !== undefined && item.dev === home.dev;
      const code = (error as { code?: unknown } | null)?.code;
      const mayHaveNoTrash = code === undefined || code === "ENOTSUP" || code === "EOPNOTSUPP";
      if (onStartupDisk || item === null || !mayHaveNoTrash) {
        throw new Error(reason ?? `“${basename(path)}” couldn’t be moved to the Trash.`);
      }
      throw Object.assign(
        new Error(
          `“${basename(path)}” couldn’t be moved to the Trash. This disk may not have a Trash.`,
        ),
        { code: NO_TRASH_ERROR_CODE, cause: error },
      );
    }
  };
}
