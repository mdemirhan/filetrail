import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  readlink,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
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
};

export type WriteServiceFileSystem = {
  lstat: (path: string) => Promise<WriteServiceStats>;
  stat: (path: string) => Promise<WriteServiceStats>;
  realpath: (path: string) => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
  readlink: (path: string) => Promise<string>;
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  symlink: (target: string, path: string) => Promise<void>;
  copyFileStream: (sourcePath: string, destinationPath: string, signal?: AbortSignal) => Promise<void>;
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

export const WRITE_OPERATION_BUSY_ERROR = "Another write operation is already running.";

type WriteServiceDependencies = {
  fileSystem?: WriteServiceFileSystem;
  now?: () => Date;
  createOperationId?: () => string;
  largeBatchItemThreshold?: number;
  largeBatchByteThreshold?: number;
};

type PlannedTopLevelItem = CopyPastePlanItem & {
  sourceRealPath: string | null;
  destinationExists: boolean;
  steps: ExecutionStep[];
  itemCount: number;
};

type ExecutionStep =
  | {
      type: "mkdir";
      sourcePath: string;
      destinationPath: string;
      sizeBytes: 0;
    }
  | {
      type: "copy_file";
      sourcePath: string;
      destinationPath: string;
      sizeBytes: number;
    }
  | {
      type: "copy_symlink";
      sourcePath: string;
      destinationPath: string;
      sizeBytes: 0;
      linkTarget: string;
    };

type QueuedOperation = {
  operationId: string;
  request: Required<CopyPasteRequest>;
  controller: AbortController;
};

const DEFAULT_FILE_SYSTEM: WriteServiceFileSystem = {
  lstat: async (path) => lstat(path) as Promise<WriteServiceStats>,
  stat: async (path) => stat(path) as Promise<WriteServiceStats>,
  realpath: async (path) => realpath(path),
  readdir: async (path) => readdir(path),
  readlink: async (path) => readlink(path),
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
};

export class WriteService {
  private readonly fileSystem: WriteServiceFileSystem;
  private readonly now: () => Date;
  private readonly createOperationId: () => string;
  private readonly largeBatchItemThreshold: number;
  private readonly largeBatchByteThreshold: number;
  private readonly listeners = new Set<(event: CopyPasteProgressEvent) => void>();
  private readonly controllers = new Map<string, AbortController>();
  private activeOperationId: string | null = null;
  private sequence = 0;

  constructor(dependencies: WriteServiceDependencies = {}) {
    this.fileSystem = dependencies.fileSystem ?? DEFAULT_FILE_SYSTEM;
    this.now = dependencies.now ?? (() => new Date());
    this.largeBatchItemThreshold = dependencies.largeBatchItemThreshold ?? 100;
    this.largeBatchByteThreshold = dependencies.largeBatchByteThreshold ?? 1024 * 1024 * 1024;
    this.createOperationId =
      dependencies.createOperationId ??
      (() => {
        this.sequence += 1;
        return `copy-op-${this.sequence}`;
      });
  }

  subscribe(listener: (event: CopyPasteProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async planCopyPaste(request: CopyPasteRequest): Promise<CopyPastePlan> {
    const normalizedRequest = normalizeCopyPasteRequest(request);
    const plan = await this.buildPlan(normalizedRequest);
    return toPublicPlan(plan, normalizedRequest);
  }

  startCopyPaste(request: CopyPasteRequest): CopyPasteOperationHandle {
    if (this.activeOperationId !== null) {
      throw new Error(WRITE_OPERATION_BUSY_ERROR);
    }
    const normalizedRequest = normalizeCopyPasteRequest(request);
    const operationId = this.createOperationId();
    const controller = new AbortController();
    this.controllers.set(operationId, controller);
    this.activeOperationId = operationId;
    const operation = {
      operationId,
      request: normalizedRequest,
      controller,
    };
    this.emit({
      operationId,
      mode: normalizedRequest.mode,
      status: "queued",
      completedItemCount: 0,
      totalItemCount: 0,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      result: null,
    });
    void this.executeActiveOperation(operation);
    return {
      operationId,
      status: "queued",
    };
  }

  cancelOperation(operationId: string): { ok: boolean } {
    const controller = this.controllers.get(operationId);
    if (!controller) {
      return { ok: false };
    }
    controller.abort();
    return { ok: true };
  }

  private async executeActiveOperation(operation: QueuedOperation): Promise<void> {
    try {
      await this.executeOperation(operation);
    } finally {
      this.controllers.delete(operation.operationId);
      this.activeOperationId = null;
    }
  }

  private async executeOperation(operation: QueuedOperation): Promise<void> {
    const startedAt = this.now().toISOString();
    const plan = await this.buildPlan(operation.request);
    const publicPlan = toPublicPlan(plan, operation.request);
    const skippedResults = plan.items
      .filter((item) => item.status === "conflict" && operation.request.conflictResolution === "skip")
      .map(
        (item): CopyPasteItemResult => ({
          sourcePath: item.sourcePath,
          destinationPath: item.destinationPath,
          status: "skipped",
          error: "Destination already exists.",
        }),
      );
    const executableItems = plan.items.filter((item) => item.status === "ready");
    const totalItemCount = executableItems.reduce((sum, item) => sum + item.itemCount, 0);
    const totalBytes = publicPlan.summary.totalBytes;

    if (!publicPlan.canExecute) {
      const result = createOperationResult({
        operationId: operation.operationId,
        mode: operation.request.mode,
        destinationDirectoryPath: operation.request.destinationDirectoryPath,
        startedAt,
        finishedAt: this.now().toISOString(),
        totalItemCount,
        totalBytes,
        completedItemCount: 0,
        completedByteCount: 0,
        items: skippedResults,
        status:
          skippedResults.length > 0 && publicPlan.issues.length === 0 && publicPlan.conflicts.length > 0
            ? "partial"
            : "failed",
        error: resolvePlanError(publicPlan),
      });
      this.emit({
        operationId: operation.operationId,
        mode: operation.request.mode,
        status: result.status,
        completedItemCount: result.summary.completedItemCount,
        totalItemCount,
        completedByteCount: result.summary.completedByteCount,
        totalBytes,
        currentSourcePath: null,
        currentDestinationPath: null,
        result,
      });
      return;
    }

    let completedItemCount = 0;
    let completedByteCount = 0;
    const itemResults = [...skippedResults];
    let encounteredError: Error | null = null;
    let cancelled = false;

    this.emit({
      operationId: operation.operationId,
      mode: operation.request.mode,
      status: "running",
      completedItemCount,
      totalItemCount,
      completedByteCount,
      totalBytes,
      currentSourcePath: null,
      currentDestinationPath: null,
      result: null,
    });

    for (const item of executableItems) {
      if (operation.controller.signal.aborted) {
        cancelled = true;
        itemResults.push({
          sourcePath: item.sourcePath,
          destinationPath: item.destinationPath,
          status: completedItemCount > 0 ? "cancelled" : "cancelled",
          error: "Operation cancelled.",
        });
        break;
      }
      try {
        const executionProgress = await this.executeTopLevelItem(
          item,
          operation.controller.signal,
          operation.operationId,
          operation.request.mode,
          totalItemCount,
          totalBytes,
          completedItemCount,
          completedByteCount,
        );
        completedItemCount = executionProgress.completedItemCount;
        completedByteCount = executionProgress.completedByteCount;
        itemResults.push({
          sourcePath: item.sourcePath,
          destinationPath: item.destinationPath,
          status: "completed",
          error: null,
        });
      } catch (error) {
        if (isAbortError(error) || operation.controller.signal.aborted) {
          cancelled = true;
          itemResults.push({
            sourcePath: item.sourcePath,
            destinationPath: item.destinationPath,
            status: "cancelled",
            error: "Operation cancelled.",
          });
          break;
        }
        const message = toErrorMessage(error);
        itemResults.push({
          sourcePath: item.sourcePath,
          destinationPath: item.destinationPath,
          status: "failed",
          error: message,
        });
        encounteredError = error instanceof Error ? error : new Error(message);
        break;
      }
    }

    if (!encounteredError && !cancelled && operation.request.mode === "cut") {
      for (const item of executableItems) {
        if (operation.controller.signal.aborted) {
          cancelled = true;
          break;
        }
        try {
          await this.fileSystem.rm(item.sourcePath, { recursive: true, force: false });
        } catch (error) {
          const message = toErrorMessage(error);
          itemResults.push({
            sourcePath: item.sourcePath,
            destinationPath: item.destinationPath,
            status: "failed",
            error: `Copied but unable to remove source: ${message}`,
          });
          encounteredError = error instanceof Error ? error : new Error(message);
          break;
        }
      }
    }

    const terminalStatus = resolveTerminalStatus({
      cancelled,
      encounteredError,
      completedItemCount,
      skippedItemCount: itemResults.filter((item) => item.status === "skipped").length,
      cancelledItemCount: itemResults.filter((item) => item.status === "cancelled").length,
    });
    const result = createOperationResult({
      operationId: operation.operationId,
      mode: operation.request.mode,
      destinationDirectoryPath: operation.request.destinationDirectoryPath,
      startedAt,
      finishedAt: this.now().toISOString(),
      totalItemCount,
      totalBytes,
      completedItemCount,
      completedByteCount,
      items: itemResults,
      status: terminalStatus,
      error: encounteredError ? toErrorMessage(encounteredError) : cancelled ? "Operation cancelled." : null,
    });
    this.emit({
      operationId: operation.operationId,
      mode: operation.request.mode,
      status: result.status,
      completedItemCount: result.summary.completedItemCount,
      totalItemCount,
      completedByteCount: result.summary.completedByteCount,
      totalBytes,
      currentSourcePath: null,
      currentDestinationPath: null,
      result,
    });
  }

  private async executeTopLevelItem(
    item: PlannedTopLevelItem,
    signal: AbortSignal,
    operationId: string,
    mode: CopyPasteMode,
    totalItemCount: number,
    totalBytes: number | null,
    startingCompletedItemCount: number,
    startingCompletedByteCount: number,
  ): Promise<{
    completedItemCount: number;
    completedByteCount: number;
  }> {
    let completedItemCount = startingCompletedItemCount;
    let completedByteCount = startingCompletedByteCount;

    for (const step of item.steps) {
      signal.throwIfAborted();
      if (step.type === "mkdir") {
        await this.fileSystem.mkdir(step.destinationPath, { recursive: true });
      } else if (step.type === "copy_file") {
        await this.fileSystem.mkdir(dirname(step.destinationPath), { recursive: true });
        await this.fileSystem.copyFileStream(step.sourcePath, step.destinationPath, signal);
        completedByteCount += step.sizeBytes;
      } else {
        await this.fileSystem.mkdir(dirname(step.destinationPath), { recursive: true });
        await this.fileSystem.symlink(step.linkTarget, step.destinationPath);
      }
      completedItemCount += 1;
      this.emit({
        operationId,
        mode,
        status: "running",
        completedItemCount,
        totalItemCount,
        completedByteCount,
        totalBytes,
        currentSourcePath: step.sourcePath,
        currentDestinationPath: step.destinationPath,
        result: null,
      });
    }

    return {
      completedItemCount,
      completedByteCount,
    };
  }

  private async buildPlan(
    request: Required<CopyPasteRequest>,
  ): Promise<{
    items: PlannedTopLevelItem[];
    conflicts: CopyPastePlanConflict[];
    issues: CopyPastePlanIssue[];
    warnings: CopyPastePlanWarning[];
    totalItemCount: number;
    totalBytes: number | null;
  }> {
    const issues: CopyPastePlanIssue[] = [];
    const conflicts: CopyPastePlanConflict[] = [];
    const warnings: CopyPastePlanWarning[] = [];
    const items: PlannedTopLevelItem[] = [];
    let totalItemCount = 0;
    let totalBytes = 0;

    const destinationPath = resolve(request.destinationDirectoryPath);
    let destinationRealPath: string | null = null;
    try {
      const destinationStats = await this.fileSystem.stat(destinationPath);
      if (!destinationStats.isDirectory()) {
        issues.push({
          code: "destination_not_directory",
          message: "Destination must be an existing directory.",
          sourcePath: null,
          destinationPath,
        });
      } else {
        destinationRealPath = await this.fileSystem.realpath(destinationPath);
      }
    } catch {
      issues.push({
        code: "destination_missing",
        message: "Destination does not exist.",
        sourcePath: null,
        destinationPath,
      });
    }

    for (const sourcePathInput of request.sourcePaths) {
      const sourcePath = resolve(sourcePathInput);
      const initialDestinationItemPath = join(destinationPath, basename(sourcePath));
      let sourceStats: WriteServiceStats;
      try {
        sourceStats = await this.fileSystem.lstat(sourcePath);
      } catch {
        issues.push({
          code: "source_missing",
          message: `Source does not exist: ${sourcePath}`,
          sourcePath,
          destinationPath: initialDestinationItemPath,
        });
        continue;
      }

      const kind = sourceStats.isSymbolicLink()
        ? "symlink"
        : sourceStats.isDirectory()
          ? "directory"
          : "file";
      const item: PlannedTopLevelItem = {
        sourcePath,
        destinationPath: initialDestinationItemPath,
        kind,
        status: "ready",
        sizeBytes: kind === "file" ? sourceStats.size : null,
        sourceRealPath: null,
        destinationExists: false,
        steps: [],
        itemCount: 0,
      };

      if (request.mode === "copy" && dirname(sourcePath) === destinationPath) {
        item.destinationPath = await resolveDuplicateDestinationPath(
          sourcePath,
          destinationPath,
          this.fileSystem,
        );
      }

      const destinationItemPath = item.destinationPath;

      if (sourcePath === destinationItemPath) {
        item.status = "blocked";
        items.push(item);
        issues.push({
          code: "same_path",
          message: `Cannot paste ${sourcePath} onto itself.`,
          sourcePath,
          destinationPath: destinationItemPath,
        });
        continue;
      }

      if (destinationRealPath && kind === "directory") {
        try {
          const sourceRealPath = await this.fileSystem.realpath(sourcePath);
          item.sourceRealPath = sourceRealPath;
          if (
            destinationRealPath === sourceRealPath ||
            destinationRealPath.startsWith(`${sourceRealPath}/`)
          ) {
            item.status = "blocked";
            items.push(item);
            issues.push({
              code: "parent_into_child",
              message: `Cannot paste ${sourcePath} into its own descendant.`,
              sourcePath,
              destinationPath: destinationItemPath,
            });
            continue;
          }
        } catch {
          // Realpath failures for directories should behave like any other missing source.
          item.status = "blocked";
          items.push(item);
          issues.push({
            code: "source_missing",
            message: `Source does not exist: ${sourcePath}`,
            sourcePath,
            destinationPath: destinationItemPath,
          });
          continue;
        }
      }

      item.destinationExists = await pathExists(destinationItemPath, this.fileSystem);
      if (item.destinationExists) {
        item.status = "conflict";
        conflicts.push({
          sourcePath,
          destinationPath: destinationItemPath,
          reason: "destination_exists",
        });
      } else {
        const executionPlan = await buildExecutionPlan(sourcePath, destinationItemPath, this.fileSystem);
        item.steps = executionPlan.steps;
        item.itemCount = executionPlan.itemCount;
        item.sizeBytes = executionPlan.sizeBytes;
        totalItemCount += executionPlan.itemCount;
        totalBytes += executionPlan.totalBytes;
      }

      items.push(item);
    }

    if (totalItemCount > this.largeBatchItemThreshold || totalBytes > this.largeBatchByteThreshold) {
      warnings.push({
        code: "large_batch",
        message: `This operation will write ${totalItemCount} items.`,
      });
    }
    if (request.mode === "cut") {
      warnings.push({
        code: "cut_requires_delete",
        message: "Cut/Paste removes the original items after the copy succeeds.",
      });
    }

    return {
      items,
      conflicts,
      issues,
      warnings,
      totalItemCount,
      totalBytes,
    };
  }

  private emit(event: CopyPasteProgressEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export function createWriteService(dependencies: WriteServiceDependencies = {}): WriteService {
  return new WriteService(dependencies);
}

function normalizeCopyPasteRequest(request: CopyPasteRequest): Required<CopyPasteRequest> {
  return {
    mode: request.mode,
    sourcePaths: Array.from(new Set(request.sourcePaths.map((path) => resolve(path)))).filter(
      (path) => path.length > 0,
    ),
    destinationDirectoryPath: resolve(request.destinationDirectoryPath),
    conflictResolution: request.conflictResolution ?? "error",
  };
}

async function buildExecutionPlan(
  sourcePath: string,
  destinationPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<{
  steps: ExecutionStep[];
  itemCount: number;
  sizeBytes: number | null;
  totalBytes: number;
}> {
  const sourceStats = await fileSystem.lstat(sourcePath);
  if (sourceStats.isSymbolicLink()) {
    const linkTarget = await fileSystem.readlink(sourcePath);
    return {
      steps: [
        {
          type: "copy_symlink",
          sourcePath,
          destinationPath,
          sizeBytes: 0,
          linkTarget,
        },
      ],
      itemCount: 1,
      sizeBytes: null,
      totalBytes: 0,
    };
  }
  if (sourceStats.isDirectory()) {
    const steps: ExecutionStep[] = [
      {
        type: "mkdir",
        sourcePath,
        destinationPath,
        sizeBytes: 0,
      },
    ];
    let itemCount = 1;
    let totalBytes = 0;
    const children = (await fileSystem.readdir(sourcePath)).sort();
    for (const childName of children) {
      const childSourcePath = join(sourcePath, childName);
      const childDestinationPath = join(destinationPath, childName);
      const childPlan = await buildExecutionPlan(childSourcePath, childDestinationPath, fileSystem);
      steps.push(...childPlan.steps);
      itemCount += childPlan.itemCount;
      totalBytes += childPlan.totalBytes;
    }
    return {
      steps,
      itemCount,
      sizeBytes: null,
      totalBytes,
    };
  }
  const fileStats = await fileSystem.stat(sourcePath);
  return {
    steps: [
      {
        type: "copy_file",
        sourcePath,
        destinationPath,
        sizeBytes: fileStats.size,
      },
    ],
    itemCount: 1,
    sizeBytes: fileStats.size,
    totalBytes: fileStats.size,
  };
}

async function pathExists(path: string, fileSystem: WriteServiceFileSystem): Promise<boolean> {
  try {
    await fileSystem.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveDuplicateDestinationPath(
  sourcePath: string,
  destinationDirectoryPath: string,
  fileSystem: WriteServiceFileSystem,
): Promise<string> {
  const sourceName = basename(sourcePath);
  const extension = extname(sourceName);
  const baseName =
    extension.length > 0 ? sourceName.slice(0, sourceName.length - extension.length) : sourceName;

  for (let index = 1; ; index += 1) {
    const duplicateName =
      index === 1 ? `${baseName} copy${extension}` : `${baseName} copy ${index}${extension}`;
    const candidatePath = join(destinationDirectoryPath, duplicateName);
    if (!(await pathExists(candidatePath, fileSystem))) {
      return candidatePath;
    }
  }
}

function toPublicPlan(
  plan: {
    items: PlannedTopLevelItem[];
    conflicts: CopyPastePlanConflict[];
    issues: CopyPastePlanIssue[];
    warnings: CopyPastePlanWarning[];
    totalItemCount: number;
    totalBytes: number | null;
  },
  request: Required<CopyPasteRequest>,
): CopyPastePlan {
  const requiresConfirmation = {
    largeBatch: plan.warnings.some((warning) => warning.code === "large_batch"),
    cutDelete: request.mode === "cut",
  };
  const skippedConflictCount =
    request.conflictResolution === "skip" ? plan.conflicts.length : 0;
  const hasBlockingIssues = plan.issues.length > 0;
  const hasUnresolvedConflicts =
    plan.conflicts.length > 0 && request.conflictResolution !== "skip";
  return {
    mode: request.mode,
    sourcePaths: request.sourcePaths,
    destinationDirectoryPath: request.destinationDirectoryPath,
    conflictResolution: request.conflictResolution,
    items: plan.items.map((item) => ({
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
      kind: item.kind,
      status: item.status,
      sizeBytes: item.sizeBytes,
    })),
    conflicts: plan.conflicts,
    issues: plan.issues,
    warnings: plan.warnings,
    requiresConfirmation,
    summary: {
      topLevelItemCount: plan.items.length,
      totalItemCount: plan.totalItemCount,
      totalBytes: plan.totalBytes,
      skippedConflictCount,
    },
    canExecute: !hasBlockingIssues && !hasUnresolvedConflicts && plan.items.some((item) => item.status === "ready"),
  };
}

function createOperationResult(args: {
  operationId: string;
  mode: CopyPasteMode;
  destinationDirectoryPath: string;
  startedAt: string;
  finishedAt: string;
  totalItemCount: number;
  totalBytes: number | null;
  completedItemCount: number;
  completedByteCount: number;
  items: CopyPasteItemResult[];
  status: CopyPasteOperationStatus;
  error: string | null;
}): CopyPasteOperationResult {
  return {
    operationId: args.operationId,
    mode: args.mode,
    status: args.status,
    destinationDirectoryPath: args.destinationDirectoryPath,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    summary: {
      topLevelItemCount: args.items.length,
      totalItemCount: args.totalItemCount,
      completedItemCount: args.completedItemCount,
      failedItemCount: args.items.filter((item) => item.status === "failed").length,
      skippedItemCount: args.items.filter((item) => item.status === "skipped").length,
      cancelledItemCount: args.items.filter((item) => item.status === "cancelled").length,
      completedByteCount: args.completedByteCount,
      totalBytes: args.totalBytes,
    },
    items: args.items,
    error: args.error,
  };
}

function resolvePlanError(plan: CopyPastePlan): string {
  if (plan.issues.length > 0) {
    return plan.issues[0]?.message ?? "Copy/Paste plan failed.";
  }
  if (plan.conflicts.length > 0) {
    return "Destination contains conflicting items.";
  }
  return "Copy/Paste plan failed.";
}

function resolveTerminalStatus(args: {
  cancelled: boolean;
  encounteredError: Error | null;
  completedItemCount: number;
  skippedItemCount: number;
  cancelledItemCount: number;
}): CopyPasteOperationStatus {
  if (args.cancelled) {
    return args.completedItemCount > 0 ? "partial" : "cancelled";
  }
  if (args.encounteredError) {
    return args.completedItemCount > 0 || args.skippedItemCount > 0 ? "partial" : "failed";
  }
  if (args.skippedItemCount > 0 || args.cancelledItemCount > 0) {
    return "partial";
  }
  return "completed";
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"))
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
