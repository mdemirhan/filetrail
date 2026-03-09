import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";

export type CopyPasteMode = "copy" | "cut";
export type CopyPasteConflictResolution = "error" | "skip";
export type CopyPasteOperationStatus =
  | "queued"
  | "running"
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

export type WriteServiceStats = {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
  size: number;
  mode: number;
};

export type WriteServiceFileSystem = {
  lstat: (path: string) => Promise<WriteServiceStats>;
  stat: (path: string) => Promise<WriteServiceStats>;
  realpath: (path: string) => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
  readlink: (path: string) => Promise<string>;
  chmod?: (path: string, mode: number) => Promise<void>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rm: (
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ) => Promise<void>;
  symlink: (target: string, path: string) => Promise<void>;
  copyFileStream: (
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal,
  ) => Promise<void>;
};

export type CopyPasteRequest = {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  conflictResolution?: CopyPasteConflictResolution;
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

export type CopyPasteItemResult = {
  sourcePath: string;
  destinationPath: string;
  status: "completed" | "skipped" | "failed" | "cancelled";
  error: string | null;
};

export type CopyPasteOperationResult = {
  operationId: string;
  mode: CopyPasteMode;
  status: CopyPasteOperationStatus;
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
  mode: CopyPasteMode;
  status: CopyPasteOperationStatus;
  completedItemCount: number;
  totalItemCount: number;
  completedByteCount: number;
  totalBytes: number | null;
  currentSourcePath: string | null;
  currentDestinationPath: string | null;
  result: CopyPasteOperationResult | null;
};

export type CopyPasteOperationHandle = {
  operationId: string;
  status: "queued";
};

export const WRITE_OPERATION_BUSY_ERROR =
  "Another write operation is already running.";

export type WriteServiceDependencies = {
  fileSystem?: WriteServiceFileSystem;
  now?: () => Date;
  createOperationId?: () => string;
  largeBatchItemThreshold?: number;
  largeBatchByteThreshold?: number;
};

export type RequiredCopyPasteRequest = Required<CopyPasteRequest>;

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

export const DEFAULT_WRITE_SERVICE_FILE_SYSTEM: WriteServiceFileSystem = {
  lstat: async (path) => lstat(path) as Promise<WriteServiceStats>,
  stat: async (path) => stat(path) as Promise<WriteServiceStats>,
  realpath: async (path) => realpath(path),
  readdir: async (path) => readdir(path),
  readlink: async (path) => readlink(path),
  chmod: async (path, mode) => {
    await chmod(path, mode);
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
    await pipeline(
      createReadStream(sourcePath),
      createWriteStream(destinationPath),
      { signal },
    );
  },
};
