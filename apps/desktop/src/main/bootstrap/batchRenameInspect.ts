import { basename, dirname, resolve } from "node:path";

import type { IpcRequest, IpcResponse } from "@filetrail/contracts";
import { isLocked, lockedMessage } from "@filetrail/core";

import { toLocalDateTime } from "../../shared/batchRename";

type InspectStats = {
  isDirectory(): boolean;
  birthtime: Date;
  mtime: Date;
  dev?: number;
  ino?: number;
};

// What the Rename sheet's checks need of the file system and the native module.
export type BatchRenameInspectDeps = {
  lstat: (path: string) => Promise<InspectStats>;
  stat: (path: string) => Promise<InspectStats>;
  readdir: (path: string) => Promise<string[]>;
  /** Whether names in the folder differ by case; null when the disk doesn't say. */
  isCaseSensitive: (path: string) => Promise<boolean | null>;
  getFlags?: (path: string) => Promise<number>;
  /** Whether items in the folder can be renamed: it can be written to. */
  canWriteFolder: (path: string) => Promise<boolean>;
  /** When each photo or video was taken, from its own metadata, on this Mac's clock. */
  readDatesTaken: (paths: string[]) => Promise<Array<string | null>>;
  /** Refuses the folders that are never renamed (the startup disk, the home folder…). */
  assertRenamable: (path: string) => Promise<void>;
  homePath: string;
};

/** The items' dates, whether each can be renamed, and every name in their folders. */
export async function inspectBatchRename(
  request: IpcRequest<"batchRename:inspect">,
  deps: BatchRenameInspectDeps,
): Promise<IpcResponse<"batchRename:inspect">> {
  const paths = request.paths.map((path) => resolve(path));
  const folderPaths = [...new Set(paths.map((path) => dirname(path)))];
  const trashPath = resolve(deps.homePath, ".Trash").toLowerCase();

  const folders = await Promise.all(
    folderPaths.map(async (path) => {
      const [names, caseSensitive, writable, locked] = await Promise.all([
        deps.readdir(path).catch(() => [] as string[]),
        deps.isCaseSensitive(path).catch(() => null),
        deps.canWriteFolder(path).catch(() => false),
        isLocked(deps, path),
      ]);
      return { path, names, caseSensitive: caseSensitive === true, writable, locked };
    }),
  );
  const folderByPath = new Map(folders.map((folder) => [folder.path, folder]));

  const datesTaken = request.includeDateTaken
    ? await deps.readDatesTaken(paths).catch(() => paths.map(() => null))
    : paths.map(() => null);

  const items = await Promise.all(
    paths.map(async (path, index) => {
      const stats = await deps.lstat(path).catch(() => null);
      const folder = folderByPath.get(dirname(path));
      let cannotRename: string | null = null;
      if (!stats) {
        cannotRename = `“${basename(path)}” no longer exists.`;
      } else if (path.toLowerCase() === trashPath) {
        cannotRename = "The Trash can’t be renamed.";
      } else if (folder?.locked) {
        cannotRename = lockedMessage(dirname(path));
      } else if (folder && !folder.writable) {
        cannotRename = `You don’t have permission to rename items in “${basename(dirname(path))}”.`;
      } else if (await isLocked(deps, path)) {
        cannotRename = lockedMessage(path);
      } else {
        cannotRename = await deps
          .assertRenamable(path)
          .then(() => null)
          .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
      }
      const taken = datesTaken[index] ?? null;
      return {
        path,
        createdAt: stats ? localDateTimeOrNull(stats.birthtime) : null,
        modifiedAt: stats ? localDateTimeOrNull(stats.mtime) : null,
        takenAt: taken !== null && LOCAL_DATE_TIME.test(taken) ? taken : null,
        cannotRename,
      };
    }),
  );

  return {
    items,
    folders: folders.map(({ path, names, caseSensitive }) => ({ path, names, caseSensitive })),
  };
}

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;

// A date the disk doesn't really have (no birth time on some disks) is left out.
function localDateTimeOrNull(date: Date): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || date.getTime() <= 0) {
    return null;
  }
  const local = toLocalDateTime(date);
  return LOCAL_DATE_TIME.test(local) ? local : null;
}
