// The paste engine as the app runs it, for real-disk tests: the native copy (copyfile(3)),
// exclusive rename, lock flags, and a Trash that keeps what goes into it.

import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import {
  buildCopyPasteAnalysisReport,
  normalizeCopyPasteAnalysisRequest,
} from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { createStoppableCopyFile } from "./stoppableCopy";
import {
  type CopyPasteAnalysisReport,
  type CopyPasteMode,
  type CopyPasteOperationResult,
  type CopyPastePolicy,
  type CopyPasteProgressEvent,
  type CopyPasteRuntimeConflict,
  type CopyPasteRuntimeResolutionAction,
  type WriteJournal,
  type WriteServiceFileSystem,
  type WriteServiceStats,
  isAppleDoubleOnItsVolume,
  removeEmptyFolder,
} from "./writeServiceTypes";

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const native = require("../../../native-fs/index.js") as typeof import("../../../native-fs");

const nativeCopy = createStoppableCopyFile(native.nativeCopyFile);

// As originalFileSystem in the desktop app builds it, on node:fs.
export const nativeFileSystem: WriteServiceFileSystem = {
  lstat: (path) => lstat(path) as Promise<WriteServiceStats>,
  stat: (path) => stat(path) as Promise<WriteServiceStats>,
  realpath: (path) => realpath(path),
  readdir: (path) => readdir(path),
  readlink: (path) => readlink(path),
  chmod: (path, mode) => chmod(path, mode),
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  rm: (path, options) => rm(path, options),
  rmdir: (path) => removeEmptyFolder(readdir, rmdir, path),
  utimes: (path, atimeMs, mtimeMs) => utimes(path, atimeMs / 1000, mtimeMs / 1000),
  canModifyFolder: (path) => access(path, constants.W_OK),
  renameExclusive: native.nativeRenameExclusive,
  isCaseSensitive: native.nativeIsCaseSensitive,
  isPackage: native.nativeIsPackage,
  isAppleDouble: (path) => isAppleDoubleOnItsVolume(native.nativeUsesAppleDouble, open, path),
  getFlags: native.nativeGetFlags,
  setFlags: native.nativeSetFlags,
  setAcl: native.nativeSetAcl,
  copyFile: async (sourcePath, destinationPath, signal, onProgress) => {
    await nativeCopy(sourcePath, destinationPath, signal, onProgress);
  },
  copyMetadata: native.nativeCopyMetadata,
};

// As on a move to another disk: an item being pasted can't be renamed into place (EXDEV),
// so it is copied and the original removed; what is built under a hidden name still takes
// its name.
export function asOnAnotherDisk(
  fileSystem: WriteServiceFileSystem = nativeFileSystem,
): WriteServiceFileSystem {
  return {
    ...fileSystem,
    renameExclusive: async (from, to) => {
      if (!basename(from).includes(".filetrail-")) {
        throw Object.assign(new Error(`EXDEV: ${from}`), { code: "EXDEV", path: from });
      }
      await fileSystem.renameExclusive(from, to);
    },
  };
}

// The native file system with a Trash: a folder items are moved into (with a number when
// the name is taken), so a test can see what a Replace removed.
export function nativeFileSystemWithTrash(trashDir: string): WriteServiceFileSystem {
  let count = 0;
  return {
    ...nativeFileSystem,
    trash: async (path) => {
      count += 1;
      const inTrash = join(trashDir, `${count}-${basename(path)}`);
      await rename(path, inTrash);
      return inTrash;
    },
  };
}

export const REPLACE_ALL: CopyPastePolicy = {
  file: "overwrite",
  directory: "overwrite",
  mismatch: "overwrite",
};

export const KEEP_EXISTING: CopyPastePolicy = {
  file: "skip",
  directory: "merge",
  mismatch: "skip",
};

export type PasteRun = {
  report: CopyPasteAnalysisReport;
  result: CopyPasteOperationResult | null;
  conflicts: CopyPasteRuntimeConflict[];
  events: CopyPasteProgressEvent[];
};

export async function runPaste(args: {
  mode: CopyPasteMode;
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy?: CopyPastePolicy;
  fileSystem?: WriteServiceFileSystem;
  signal?: AbortSignal;
  writeJournal?: WriteJournal;
  // Runs after the review and before the paste: what changes on disk in between.
  beforeExecute?: () => Promise<void>;
  resolve?: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
  onEvent?: (event: CopyPasteProgressEvent) => void;
}): Promise<PasteRun> {
  const fileSystem = args.fileSystem ?? nativeFileSystem;
  const policy = args.policy ?? KEEP_EXISTING;
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-test",
    // As the write service asks for it.
    request: normalizeCopyPasteAnalysisRequest({
      mode: args.mode,
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath,
    }),
    fileSystem,
    thresholds: { largeBatchItemThreshold: 100_000, largeBatchByteThreshold: 1e12 },
  });
  const conflicts: CopyPasteRuntimeConflict[] = [];
  const events: CopyPasteProgressEvent[] = [];
  if (report.issues.length > 0) {
    return { report, result: null, conflicts, events };
  }
  const resolvedNodes = await resolveAnalysisWithPolicy({ report, policy, fileSystem });
  await args.beforeExecute?.();
  let result: CopyPasteOperationResult | null = null;
  await executeCopyPasteFromAnalysis({
    operationId: "op-test",
    report,
    mode: args.mode,
    policy,
    fileSystem,
    now: () => new Date(),
    signal: args.signal ?? new AbortController().signal,
    resolvedNodes,
    ...(args.writeJournal ? { writeJournal: args.writeJournal } : {}),
    emit: (event) => {
      events.push(event);
      result = event.result ?? result;
      args.onEvent?.(event);
    },
    requestResolution: async (conflict) => {
      conflicts.push(conflict);
      return args.resolve?.(conflict) ?? "skip";
    },
  });
  return { report, result, conflicts, events };
}
