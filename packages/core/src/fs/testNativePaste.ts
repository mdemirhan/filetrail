// The paste engine as the app runs it, for real-disk tests: the native copy (copyfile(3)),
// exclusive rename, lock flags, and a Trash that keeps what goes into it.

import { mkdir, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
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
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  type ReplaceJournal,
  type WriteServiceFileSystem,
} from "./writeServiceTypes";

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const native = require("../../../native-fs/index.js") as typeof import("../../../native-fs");

const nativeCopy = createStoppableCopyFile(native.nativeCopyFile);

export const nativeFileSystem: WriteServiceFileSystem = {
  ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  renameExclusive: native.nativeRenameExclusive,
  isCaseSensitive: native.nativeIsCaseSensitive,
  getFlags: native.nativeGetFlags,
  setFlags: native.nativeSetFlags,
  copyFile: async (sourcePath, destinationPath, signal) => {
    await mkdir(dirname(destinationPath), { recursive: true });
    await nativeCopy(sourcePath, destinationPath, signal);
  },
  ...(native.nativeCopyMetadata ? { copyMetadata: native.nativeCopyMetadata } : {}),
};

// The native file system with a Trash: a folder items are moved into (with a number when
// the name is taken), so a test can see what a Replace removed.
export function nativeFileSystemWithTrash(trashDir: string): WriteServiceFileSystem {
  let count = 0;
  return {
    ...nativeFileSystem,
    trash: async (path) => {
      count += 1;
      await rename(path, join(trashDir, `${count}-${basename(path)}`));
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
  replaceJournal?: ReplaceJournal;
  // Runs after the review and before the paste: what changes on disk in between.
  beforeExecute?: () => Promise<void>;
  resolve?: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null;
  onEvent?: (event: CopyPasteProgressEvent) => void;
}): Promise<PasteRun> {
  const fileSystem = args.fileSystem ?? nativeFileSystem;
  const policy = args.policy ?? KEEP_EXISTING;
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-test",
    request: {
      mode: args.mode,
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath,
    },
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
    ...(args.replaceJournal ? { replaceJournal: args.replaceJournal } : {}),
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
