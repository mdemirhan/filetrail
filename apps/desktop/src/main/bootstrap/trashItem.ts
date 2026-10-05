import { basename } from "node:path";

import { NO_TRASH_ERROR_CODE, isLocked, lockedMessage } from "@filetrail/core";

type TrashFs = {
  lstat: (path: string) => Promise<{ dev?: number }>;
  getFlags?: (path: string) => Promise<number>;
};

// Moves an item to the Trash and resolves with the path it has there (nativeTrashItem),
// with a failure that says why.
// The Trash gives its reason as a sentence with no error code, so the reason is told
// apart here: a locked item says so; on the startup disk the Trash's own sentence is the
// reason; on another disk the likely reason is that it has no Trash (a network share,
// some USB drives), which is marked with NO_TRASH_ERROR_CODE so callers can offer to
// delete instead. Nothing on the startup disk is ever offered for permanent deletion.
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
      if (onStartupDisk || item === null) {
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
