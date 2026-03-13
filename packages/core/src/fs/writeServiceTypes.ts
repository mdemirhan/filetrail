import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  lutimes,
  mkdir,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  utimes,
} from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";

export type CopyPasteMode = "copy" | "cut";
export type CopyPasteConflictResolution = "error" | "skip";
export type CopyPasteOperationStatus =
  | "queued"
  | "running"
  | "awaiting_resolution"
  | "completed"
  | "failed"
  | "cancelled"
  | "partial";
export type CopyPastePlanItemStatus = "ready" | "conflict" | "blocked";
export type CopyPastePlanIssueCode =
  | "destination_missing"
  | "destination_not_directory"
  | "source_missing"
  | "same_path"
  | "parent_into_child";
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
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  symlink: (target: string, path: string) => Promise<void>;
  /** Copies a file preserving metadata (mode, timestamps, xattrs). When provided,
   *  used instead of `copyFileStream` + `chmod` for file copies. */
  copyFile?: (sourcePath: string, destinationPath: string) => Promise<void>;
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
};

export type CopyPasteRequest = {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  conflictResolution?: CopyPasteConflictResolution;
};

export type CopyPastePolicy = {
  file: CopyPastePolicyFileAction;
  directory: CopyPastePolicyDirectoryAction;
  mismatch: CopyPastePolicyMismatchAction;
};

export type RequiredCopyPasteRequest = Required<CopyPasteRequest>;

export type CopyPasteAnalysisRequest = {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
};

export type RequiredCopyPasteAnalysisRequest = {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
};

export type CopyPasteExecutionRequest = {
  analysisId: string;
  policy: CopyPastePolicy;
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

export type CopyPastePlanItem = {
  sourcePath: string;
  destinationPath: string;
  kind: "file" | "directory" | "symlink";
  status: CopyPastePlanItemStatus;
  sizeBytes: number | null;
};

export type CopyPastePlanConflict = {
  sourcePath: string;
  destinationPath: string;
  reason: "destination_exists";
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

export type CopyPastePlan = {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  conflictResolution: CopyPasteConflictResolution;
  items: CopyPastePlanItem[];
  conflicts: CopyPastePlanConflict[];
  issues: CopyPastePlanIssue[];
  warnings: CopyPastePlanWarning[];
  requiresConfirmation: {
    largeBatch: boolean;
    cutDelete: boolean;
  };
  summary: {
    topLevelItemCount: number;
    totalItemCount: number;
    totalBytes: number | null;
    skippedConflictCount: number;
  };
  canExecute: boolean;
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
    | "source_deleted";
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
  error: string | null;
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
  now?: () => Date;
  createOperationId?: () => string;
  createAnalysisId?: () => string;
  largeBatchItemThreshold?: number;
  largeBatchByteThreshold?: number;
};

export type PlannedTopLevelItem = CopyPastePlanItem & {
  sourceRealPath: string | null;
  destinationExists: boolean;
  steps: ExecutionStep[];
  itemCount: number;
};

export type ExecutionStep =
  | {
      type: "mkdir";
      sourcePath: string;
      destinationPath: string;
      sizeBytes: 0;
      mode: number;
    }
  | {
      type: "copy_file";
      sourcePath: string;
      destinationPath: string;
      sizeBytes: number;
      mode: number;
    }
  | {
      type: "copy_symlink";
      sourcePath: string;
      destinationPath: string;
      sizeBytes: 0;
      linkTarget: string;
    };

export type QueuedOperation = {
  operationId: string;
  request: RequiredCopyPasteRequest;
  controller: AbortController;
};

export type InternalCopyPastePlan = {
  items: PlannedTopLevelItem[];
  conflicts: CopyPastePlanConflict[];
  issues: CopyPastePlanIssue[];
  warnings: CopyPastePlanWarning[];
  totalItemCount: number;
  totalBytes: number | null;
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
  symlink: async (target, path) => {
    await symlink(target, path);
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
