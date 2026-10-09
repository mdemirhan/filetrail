import { constants, createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  lstat,
  lutimes,
  mkdir,
  type open,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  symlink,
  utimes,
} from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";

import type { ItemId, UndoLog } from "./undoLog";

export type CopyPasteMode = "copy" | "cut";
export type CopyPasteOperationStatus =
  | "queued"
  | "running"
  | "awaiting_resolution"
  | "completed"
  | "failed"
  | "cancelled"
  | "partial";
export type CopyPastePlanIssueCode =
  | "destination_missing"
  | "destination_not_directory"
  | "source_missing"
  | "same_path"
  | "parent_into_child"
  | "duplicate_destination_name"
  // A folder whose contents can't be read: it is reported as failed, the rest still pastes.
  | "source_unreadable";
export type CopyPastePlanWarningCode = "large_batch" | "cut_requires_delete";
export type CopyPasteAnalysisJobStatus =
  | "queued"
  | "analyzing"
  | "complete"
  | "cancelled"
  | "error";
export type CopyPastePolicyFileAction = "overwrite" | "skip" | "keep_both";
export type CopyPastePolicyDirectoryAction = "overwrite" | "merge" | "skip" | "keep_both";
export type CopyPastePolicyMismatchAction = "overwrite" | "skip" | "keep_both";
export type CopyPasteRuntimeResolutionAction = "overwrite" | "skip" | "keep_both" | "merge";
export type CopyPasteNodeKind = "missing" | "file" | "directory" | "symlink";
export type CopyPasteConflictClass = "file_conflict" | "directory_conflict" | "type_mismatch";
export type CopyPasteAnalysisNodeDisposition = "new" | "conflict" | "blocked";

export type WriteServiceStats = {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  size: number;
  mode: number;
  mtimeMs?: number;
  // When the item was made, which its disk keeps for it.
  birthtimeMs?: number;
  ino?: number;
  dev?: number;
};

export type WriteServiceFileSystem = {
  lstat: (path: string) => Promise<WriteServiceStats>;
  stat: (path: string) => Promise<WriteServiceStats>;
  realpath: (path: string) => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
  readlink: (path: string) => Promise<string>;
  chmod?: (path: string, mode: number) => Promise<void>;
  rename?: (oldPath: string, newPath: string) => Promise<void>;
  /** Like `rename` but fails with EEXIST instead of replacing an item at `newPath`
   *  (macOS `renamex_np(RENAME_EXCL)`). Without it, the destination is checked first. */
  renameExclusive?: (oldPath: string, newPath: string) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  /** Removes an empty folder; fails (ENOTEMPTY or EEXIST) when anything is inside,
   *  "._name" files included (see `removeEmptyFolder`). */
  rmdir: (path: string) => Promise<void>;
  /** Whether the volume holding `path` tells names apart by letter case (macOS
   *  `pathconf(_PC_CASE_SENSITIVE)`), or null when it doesn't say. Without it, an
   *  existing name is looked up with its case swapped. */
  isCaseSensitive?: (path: string) => Promise<boolean | null>;
  symlink: (target: string, path: string) => Promise<void>;
  /** Copies a file preserving metadata (mode, flags, timestamps, xattrs). When provided,
   *  used instead of `copyFileStream`, and the copy's metadata is left as it made it.
   *  `signal` stops it part way through the file (rejecting with an AbortError), leaving
   *  no partial file. */
  copyFile?: (sourcePath: string, destinationPath: string, signal?: AbortSignal) => Promise<void>;
  /** The item's BSD flags (`st_flags`, a symlink not followed); `UF_IMMUTABLE` is
   *  Finder's "Locked". Without it no item is seen as locked. */
  getFlags?: (path: string) => Promise<number>;
  /** Sets the item's BSD flags (a symlink not followed). */
  setFlags?: (path: string, flags: number) => Promise<void>;
  /** Gives the item the access control list `acl` (acl_to_text(3) text), or none at all
   *  for null (a symlink not followed). A hidden copy that can't be removed has its rules
   *  against deleting it taken off with it. */
  setAcl?: (path: string, acl: string | null) => Promise<void>;
  /** Copies a folder's own metadata (mode, flags, dates, xattrs such as Finder tags, ACLs)
   *  onto an existing folder, without its contents. Applied once the folder's items are
   *  in, since a read-only or locked folder can't be written into afterwards. Without it,
   *  only the mode and dates are carried over. */
  copyMetadata?: (sourcePath: string, destinationPath: string) => Promise<void>;
  /** Whether macOS shows the folder as one item, a package (`NSURLIsPackageKey`); null
   *  when it can't tell. Without it, the folder's extension decides. */
  isPackage?: (path: string) => Promise<boolean | null>;
  copyFileStream: (
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  /** Sets access and modification times on a path (follows symlinks). Used to
   *  preserve timestamps on directories and regular files after creation. */
  utimes?: (path: string, atimeMs: number, mtimeMs: number) => Promise<void>;
  /** Like `utimes` but operates on the symlink itself, not its target. Used to
   *  preserve timestamps on symlinks after creation. */
  lutimes?: (path: string, atimeMs: number, mtimeMs: number) => Promise<void>;
  /** Moves a path to the Trash and resolves with the path it has there (null when the
   *  Trash didn't say where it went). Items replaced by a paste are trashed so a replace
   *  can be undone. Without it (or when it fails), the person is asked before anything is
   *  deleted permanently (a "trash_unavailable" runtime conflict). */
  trash?: (path: string) => Promise<string | null>;
  /** Whether items can be added to or removed from a folder (access(2) with W_OK; rejects
   *  when not). A move to another disk asks before copying anything, so it never copies
   *  what it then can't remove. Without it, that is found out when removing. */
  canModifyFolder?: (path: string) => Promise<void>;
  /** Whether a "._name" file is AppleDouble metadata that macOS reads as "name"'s own
   *  attributes: it starts with the AppleDouble magic number, and its disk keeps extended
   *  attributes in such files (FAT, exFAT, some SMB) rather than natively. Such files
   *  aren't copied as items of their own. On APFS a "._name" file is an ordinary item,
   *  whatever it holds. Without it, every "._name" file is an ordinary item. */
  isAppleDouble?: (path: string) => Promise<boolean>;
};

export type CopyPastePolicy = {
  file: CopyPastePolicyFileAction;
  directory: CopyPastePolicyDirectoryAction;
  mismatch: CopyPastePolicyMismatchAction;
};

export type CopyPasteAnalysisRequest = {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  // For items pasted from the clipboard: each item's id when it was copied. Another item at
  // its path now (the one copied was replaced) is reported missing, never pasted instead.
  expectedSourceIds?: Readonly<Record<string, ItemId>>;
};

export type RequiredCopyPasteAnalysisRequest = {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  expectedSourceIds?: Readonly<Record<string, ItemId>>;
};

// A choice made for one item in the review, overriding the policy for its kind.
export type CopyPasteNodeOverride = {
  nodeId: string;
  action: CopyPasteRuntimeResolutionAction;
};

export type CopyPasteExecutionRequest = {
  analysisId: string;
  policy: CopyPastePolicy;
  overrides?: CopyPasteNodeOverride[];
};

export type NodeFingerprint = {
  exists: boolean;
  kind: CopyPasteNodeKind;
  size: number | null;
  mtimeMs: number | null;
  mode: number | null;
  ino: number | null;
  dev: number | null;
  symlinkTarget: string | null;
};

export type CopyPasteAnalysisIssue = {
  code: CopyPastePlanIssueCode;
  message: string;
  sourcePath: string | null;
  destinationPath: string | null;
};

export type CopyPasteAnalysisWarning = {
  code: CopyPastePlanWarningCode;
  message: string;
};

export type CopyPasteAnalysisNode = {
  id: string;
  sourcePath: string;
  destinationPath: string;
  sourceKind: Exclude<CopyPasteNodeKind, "missing">;
  destinationKind: CopyPasteNodeKind;
  disposition: CopyPasteAnalysisNodeDisposition;
  conflictClass: CopyPasteConflictClass | null;
  sourceFingerprint: NodeFingerprint;
  destinationFingerprint: NodeFingerprint;
  children: CopyPasteAnalysisNode[];
  issueCode: CopyPastePlanIssueCode | null;
  issueMessage: string | null;
  totalNodeCount: number;
  conflictNodeCount: number;
  destinationTotalNodeCount: number | null;
  /** The name "Keep Both" would give this item (conflicts only). */
  keepBothDestinationPath: string | null;
  /** What exists only in the existing folder: kept by Merge, removed by Replace. */
  destinationOnly: CopyPasteDestinationOnlySummary | null;
  /** Why this item can't be replaced, when Replace would destroy the item being pasted. */
  replaceBlockedReason: string | null;
};

export type CopyPasteDestinationOnlySummary = {
  /** Items (files and folders, nested ones included) found only at the destination. */
  count: number;
  /** A few of them, relative to the existing item, top-most entries first. */
  samplePaths: string[];
};

export type CopyPasteAnalysisSummary = {
  topLevelItemCount: number;
  totalNodeCount: number;
  totalBytes: number | null;
  fileConflictCount: number;
  directoryConflictCount: number;
  mismatchConflictCount: number;
  blockedCount: number;
};

export type CopyPasteAnalysisReport = {
  analysisId: string;
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  nodes: CopyPasteAnalysisNode[];
  issues: CopyPasteAnalysisIssue[];
  warnings: CopyPasteAnalysisWarning[];
  summary: CopyPasteAnalysisSummary;
  /** Whether the destination volume tells names apart by letter case (default: no). */
  destinationCaseSensitive?: boolean;
};

export type CopyPasteAnalysisStartHandle = {
  analysisId: string;
  status: Extract<CopyPasteAnalysisJobStatus, "queued" | "analyzing">;
};

export type CopyPasteAnalysisUpdate = {
  analysisId: string;
  status: CopyPasteAnalysisJobStatus;
  done: boolean;
  report: CopyPasteAnalysisReport | null;
  error: string | null;
};

export type CopyPastePlanIssue = {
  code: CopyPastePlanIssueCode;
  message: string;
  sourcePath: string | null;
  destinationPath: string | null;
};

export type CopyPastePlanWarning = {
  code: CopyPastePlanWarningCode;
  message: string;
};

export type CopyPasteRuntimeConflict = {
  conflictId: string;
  analysisId: string;
  sourcePath: string;
  destinationPath: string;
  sourceKind: Exclude<CopyPasteNodeKind, "missing">;
  destinationKind: CopyPasteNodeKind;
  conflictClass: CopyPasteConflictClass;
  reason:
    | "destination_changed"
    | "destination_created"
    | "destination_deleted"
    | "source_changed"
    | "source_deleted"
    // Replace couldn't move the existing item to the Trash; "overwrite" deletes it
    // permanently instead.
    | "trash_unavailable";
  sourceFingerprint: NodeFingerprint;
  destinationFingerprint: NodeFingerprint;
  currentSourceFingerprint: NodeFingerprint;
  currentDestinationFingerprint: NodeFingerprint;
};

export type CopyPasteItemResult = {
  sourcePath: string;
  destinationPath: string;
  sourceKind: "file" | "directory" | "symlink";
  status: "completed" | "skipped" | "failed" | "cancelled";
  error: string | null;
  skipReason?: "planned_conflict_policy" | "runtime_conflict_resolution" | null;
  /** For a folder: how many items inside it failed. A folder whose only problem is
   *  failures inside it has status "failed" and a null error. */
  childFailureCount?: number;
};

export type CopyPasteOperationResult = {
  operationId: string;
  mode: CopyPasteMode;
  status: Exclude<CopyPasteOperationStatus, "queued" | "running" | "awaiting_resolution">;
  destinationDirectoryPath: string;
  startedAt: string;
  finishedAt: string;
  summary: {
    topLevelItemCount: number;
    totalItemCount: number;
    completedItemCount: number;
    failedItemCount: number;
    skippedItemCount: number;
    cancelledItemCount: number;
    completedByteCount: number;
    totalBytes: number | null;
  };
  items: CopyPasteItemResult[];
  // Where the items a Replace moved out of the way went in the Trash, which they changed.
  trashedPaths?: string[];
  // Where the items a Replace removed (to the Trash or for good) were: another item is at
  // each path now, so whatever pointed at the old one there no longer does.
  replacedPaths?: string[];
  error: string | null;
  // What the paste did, for Undo (main process only: the window's copy leaves it out).
  undoLog?: UndoLog;
};

export type CopyPasteProgressEvent = {
  operationId: string;
  analysisId?: string | null;
  mode: CopyPasteMode;
  status: CopyPasteOperationStatus;
  completedItemCount: number;
  totalItemCount: number;
  completedByteCount: number;
  totalBytes: number | null;
  currentSourcePath: string | null;
  currentDestinationPath: string | null;
  runtimeConflict?: CopyPasteRuntimeConflict | null;
  result: CopyPasteOperationResult | null;
};

export type CopyPasteOperationHandle = {
  operationId: string;
  status: "queued";
};

export const WRITE_OPERATION_BUSY_ERROR = "Another write operation is already running.";
export const ANALYSIS_BUSY_ERROR = "Another copy/paste analysis is already running.";

export type WriteServiceDependencies = {
  fileSystem?: WriteServiceFileSystem;
  // Remembers Replaces and large file copies in progress, so an interrupted one can be
  // finished or undone at the next start (see `recoverInterruptedWrites`).
  writeJournal?: WriteJournal;
  now?: () => Date;
  createOperationId?: () => string;
  createAnalysisId?: () => string;
  largeBatchItemThreshold?: number;
  largeBatchByteThreshold?: number;
};

export const DEFAULT_COPY_PASTE_POLICY: CopyPastePolicy = {
  file: "skip",
  directory: "skip",
  mismatch: "skip",
};

// Default implementation using node:fs. In Electron, callers should provide an
// original-fs backed implementation instead (see originalFileSystem.ts in the
// desktop app) because Electron patches node:fs to treat .asar files as virtual
// directories, which breaks copy operations on app bundles.
export const DEFAULT_WRITE_SERVICE_FILE_SYSTEM: WriteServiceFileSystem = {
  lstat: async (path) => lstat(path) as Promise<WriteServiceStats>,
  stat: async (path) => stat(path) as Promise<WriteServiceStats>,
  realpath: async (path) => realpath(path),
  readdir: async (path) => readdir(path),
  readlink: async (path) => readlink(path),
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
  rmdir: (path) => removeEmptyFolder(readdir, rmdir, path),
  symlink: async (target, path) => {
    await symlink(target, path);
  },
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
    await access(path, constants.W_OK);
  },
};

// rmdir(2) on macOS also removes a folder that holds nothing but "._name" files, deleting
// them, whatever they hold and on any disk (the kernel takes them for orphaned AppleDouble
// files). Such a file may be someone's item, so a folder is removed only when it lists
// nothing at all. One put there between the look and the removal can still go: no call
// removes a folder only if it is empty of those too.
export async function removeEmptyFolder(
  readFolder: (path: string) => Promise<string[]>,
  removeFolder: (path: string) => Promise<void>,
  path: string,
): Promise<void> {
  if ((await readFolder(path)).length > 0) {
    throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`), {
      code: "ENOTEMPTY",
      path,
    });
  }
  await removeFolder(path);
}

// A "._name" file that macOS reads as "name"'s attributes: AppleDouble data on a disk that
// keeps attributes that way. Not when the disk keeps them natively or doesn't say.
export async function isAppleDoubleOnItsVolume(
  usesAppleDouble: (path: string) => Promise<boolean | null>,
  openFile: typeof open,
  path: string,
): Promise<boolean> {
  const answer = await usesAppleDouble(dirname(path)).catch(() => null);
  return answer === true && (await startsWithAppleDoubleMagic(openFile, path));
}

// AppleDouble files begin with 0x00051607.
const APPLE_DOUBLE_MAGIC = [0x00, 0x05, 0x16, 0x07];

export async function startsWithAppleDoubleMagic(
  openFile: typeof open,
  path: string,
): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await openFile(path, "r");
    const header = Buffer.alloc(APPLE_DOUBLE_MAGIC.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return (
      bytesRead === header.length &&
      APPLE_DOUBLE_MAGIC.every((byte, index) => header[index] === byte)
    );
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * A Replace in progress: the new item is built under `stagingPath`, a hidden name next to
 * `finalPath`, then swapped in. `moved` means the source itself was moved there (a move on
 * the same volume), so the staged item is the only copy of it. `staged` means the item at
 * `stagingPath` is complete. What is at `stagingPath`, a random hidden name made for it, is
 * the Replace's own. (Entries written by v0.4.3 carry ids as well, no longer read.)
 */
export type ReplaceJournalEntry = {
  // Entries written before the journal held anything else have no kind.
  kind?: "replace";
  id: string;
  stagingPath: string;
  finalPath: string;
  sourcePath: string;
  moved: boolean;
  staged: boolean;
  // A move to another disk (a folder copied, then its original removed): put in place by
  // recovery, its original is still there too, and the person is told.
  movingCopy?: true;
};

/**
 * A large file being copied under `partialPath`, a hidden name of its own next to
 * `finalPath`, until it is complete. Cut short, it is only part of a copy (the original is
 * where it was): the next start removes it, so it doesn't take up space unseen.
 */
export type PartialFileJournalEntry = {
  kind: "partial_file";
  id: string;
  partialPath: string;
  finalPath: string;
};

/**
 * Items a rename of several moved aside under hidden names (`temporaryPath`) so others
 * could take their names: written down before the first moves, for one folder depth at a
 * time. A crash leaves each where the next start finds it: under its old name, its new one,
 * or its old one with a number.
 */
export type BatchRenameJournalEntry = {
  kind: "batch_rename";
  id: string;
  items: Array<{ temporaryPath: string; originalPath: string; newPath: string }>;
};

export type WriteJournalEntry =
  | ReplaceJournalEntry
  | PartialFileJournalEntry
  | BatchRenameJournalEntry;

/** Where writes that leave items under hidden names while they run are written down, so a
 *  crash can't strand one there: the next start finishes or undoes each. `add` replaces an
 *  entry with the same id. Each write must be in the file, whole, before it resolves, so it
 *  outlasts a crash or force quit (a power cut may still lose the latest ones). */
export type WriteJournal = {
  add: (entry: WriteJournalEntry) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

export function isReplaceJournalEntry(entry: WriteJournalEntry): entry is ReplaceJournalEntry {
  return entry.kind === undefined || entry.kind === "replace";
}
