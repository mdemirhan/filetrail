import {
  getRuntimeConflictChoices,
  getRuntimeConflictScope,
  isAbortError,
} from "@filetrail/contracts";

import {
  buildCopyPasteAnalysisReport,
  normalizeCopyPasteAnalysisRequest,
} from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import {
  ANALYSIS_BUSY_ERROR,
  type CopyPasteAnalysisReport,
  type CopyPasteAnalysisRequest,
  type CopyPasteAnalysisStartHandle,
  type CopyPasteAnalysisUpdate,
  type CopyPasteExecutionRequest,
  type CopyPasteOperationHandle,
  type CopyPasteProgressEvent,
  type CopyPasteRuntimeConflict,
  type CopyPasteRuntimeResolutionAction,
  DEFAULT_COPY_PASTE_POLICY,
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  type RequiredCopyPasteAnalysisRequest,
  WRITE_OPERATION_BUSY_ERROR,
  type WriteJournal,
  type WriteServiceDependencies,
  type WriteServiceFileSystem,
} from "./writeServiceTypes";

export {
  ANALYSIS_BUSY_ERROR,
  DEFAULT_COPY_PASTE_POLICY,
  WRITE_OPERATION_BUSY_ERROR,
  type CopyPasteAnalysisJobStatus,
  type CopyPasteAnalysisNode,
  type CopyPasteAnalysisReport,
  type CopyPasteAnalysisRequest,
  type CopyPasteAnalysisStartHandle,
  type CopyPasteAnalysisSummary,
  type CopyPasteAnalysisUpdate,
  type CopyPasteConflictClass,
  type CopyPasteExecutionRequest,
  type CopyPasteItemResult,
  type CopyPasteMode,
  type CopyPasteNodeKind,
  type CopyPasteOperationHandle,
  type CopyPasteOperationResult,
  type CopyPasteOperationStatus,
  type CopyPastePlanIssue,
  type CopyPastePlanIssueCode,
  type CopyPastePlanWarning,
  type CopyPastePlanWarningCode,
  type CopyPastePolicy,
  type CopyPasteProgressEvent,
  type CopyPasteRuntimeConflict,
  type CopyPasteRuntimeResolutionAction,
  type NodeFingerprint,
  type PartialFileJournalEntry,
  type ReplaceJournalEntry,
  type WriteJournal,
  type WriteJournalEntry,
  type WriteServiceDependencies,
  type WriteServiceFileSystem,
  type WriteServiceStats,
} from "./writeServiceTypes";

type AnalysisJob = {
  analysisId: string;
  request: RequiredCopyPasteAnalysisRequest;
  controller: AbortController;
  status: CopyPasteAnalysisUpdate["status"];
  report: CopyPasteAnalysisReport | null;
  error: string | null;
};

type PendingResolution = {
  conflict: CopyPasteRuntimeConflict;
  resolve: (action: CopyPasteRuntimeResolutionAction | null) => void;
};

// The answers that make sense for a conflict as it is on disk now.
export function getAllowedRuntimeResolutions(
  conflict: CopyPasteRuntimeConflict,
): CopyPasteRuntimeResolutionAction[] {
  return getRuntimeConflictChoices({
    reason: conflict.reason,
    conflictClass: conflict.conflictClass,
    destinationExists: conflict.currentDestinationFingerprint.exists,
  });
}

function runtimeConflictScope(conflict: CopyPasteRuntimeConflict): string {
  return getRuntimeConflictScope({
    reason: conflict.reason,
    conflictClass: conflict.conflictClass,
    destinationExists: conflict.currentDestinationFingerprint.exists,
  });
}

export class WriteService {
  private readonly fileSystem: WriteServiceFileSystem;
  private readonly writeJournal: WriteJournal | null;
  private readonly now: () => Date;
  private readonly createOperationId: () => string;
  private readonly createAnalysisId: () => string;
  private readonly largeBatchItemThreshold: number;
  private readonly largeBatchByteThreshold: number;
  private readonly listeners = new Set<(event: CopyPasteProgressEvent) => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly analysisJobs = new Map<string, AnalysisJob>();
  private readonly pendingResolutions = new Map<string, PendingResolution>();
  // Answers given "for the rest of this operation", by operation, then by the kind of
  // conflict they answered (`getRuntimeConflictScope`).
  private readonly standingResolutions = new Map<
    string,
    Map<string, CopyPasteRuntimeResolutionAction>
  >();
  private activeOperationId: string | null = null;
  private sequence = 0;
  private analysisSequence = 0;

  constructor(dependencies: WriteServiceDependencies = {}) {
    this.fileSystem = dependencies.fileSystem ?? DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
    this.writeJournal = dependencies.writeJournal ?? null;
    this.now = dependencies.now ?? (() => new Date());
    this.largeBatchItemThreshold = dependencies.largeBatchItemThreshold ?? 100;
    this.largeBatchByteThreshold = dependencies.largeBatchByteThreshold ?? 1024 * 1024 * 1024;
    this.createOperationId =
      dependencies.createOperationId ??
      (() => {
        this.sequence += 1;
        return `copy-op-${this.sequence}`;
      });
    this.createAnalysisId =
      dependencies.createAnalysisId ??
      (() => {
        this.analysisSequence += 1;
        return `analysis-${this.analysisSequence}`;
      });
  }

  subscribe(listener: (event: CopyPasteProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // Starting an analysis drops the finished ones, except those in `keep`: reviews still
  // open in other windows, which can still be pasted from.
  startCopyPasteAnalysis(
    request: CopyPasteAnalysisRequest,
    keep: ReadonlySet<string> = new Set(),
  ): CopyPasteAnalysisStartHandle {
    if (this.activeOperationId !== null) {
      throw new Error(WRITE_OPERATION_BUSY_ERROR);
    }
    if (this.hasActiveAnalysisJob()) {
      throw new Error(ANALYSIS_BUSY_ERROR);
    }
    // Only once it starts: a refused start leaves the caller's own review as it was.
    this.pruneTerminalAnalysisJobs(keep);
    const normalizedRequest = normalizeCopyPasteAnalysisRequest(request);
    const analysisId = this.createAnalysisId();
    const controller = new AbortController();
    const job: AnalysisJob = {
      analysisId,
      request: normalizedRequest,
      controller,
      status: "queued",
      report: null,
      error: null,
    };
    this.analysisJobs.set(analysisId, job);
    void this.executeAnalysisJob(job);
    return {
      analysisId,
      status: "queued",
    };
  }

  getCopyPasteAnalysisUpdate(analysisId: string): CopyPasteAnalysisUpdate {
    const job = this.analysisJobs.get(analysisId);
    if (!job) {
      throw new Error(`Unknown copy/paste analysis job: ${analysisId}`);
    }
    return {
      analysisId,
      status: job.status,
      done: job.status === "complete" || job.status === "cancelled" || job.status === "error",
      report: job.report,
      error: job.error,
    };
  }

  cancelCopyPasteAnalysis(analysisId: string): { ok: boolean } {
    const job = this.analysisJobs.get(analysisId);
    if (!job) {
      return { ok: false };
    }
    job.controller.abort();
    job.status = "cancelled";
    return { ok: true };
  }

  startCopyPaste(
    start: CopyPasteExecutionRequest,
    keep: ReadonlySet<string> = new Set(),
  ): CopyPasteOperationHandle {
    if (this.activeOperationId !== null) {
      throw new Error(WRITE_OPERATION_BUSY_ERROR);
    }
    this.pruneTerminalAnalysisJobs(keep, start.analysisId);

    // Validate before claiming the busy slot so a bad request can't leave it held.
    const mode = this.getAnalysisJobOrThrow(start.analysisId).request.mode;

    const operationId = this.createOperationId();
    const controller = new AbortController();
    this.controllers.set(operationId, controller);
    this.activeOperationId = operationId;

    this.emit({
      operationId,
      analysisId: start.analysisId,
      mode,
      status: "queued",
      completedItemCount: 0,
      totalItemCount: 0,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      runtimeConflict: null,
      result: null,
    });
    void this.executeActiveOperation(operationId, start, controller);
    return {
      operationId,
      status: "queued",
    };
  }

  resolveRuntimeConflict(
    operationId: string,
    conflictId: string,
    action: CopyPasteRuntimeResolutionAction,
    applyToRemaining = false,
  ): { ok: boolean } {
    const pending = this.pendingResolutions.get(operationId);
    if (!pending || pending.conflict.conflictId !== conflictId) {
      return { ok: false };
    }
    // An answer this conflict doesn't offer is refused; the question stays open.
    if (!getAllowedRuntimeResolutions(pending.conflict).includes(action)) {
      return { ok: false };
    }
    this.pendingResolutions.delete(operationId);
    if (applyToRemaining) {
      const standing = this.standingResolutions.get(operationId) ?? new Map();
      standing.set(runtimeConflictScope(pending.conflict), action);
      this.standingResolutions.set(operationId, standing);
    }
    pending.resolve(action);
    return { ok: true };
  }

  cancelOperation(operationId: string): { ok: boolean } {
    const pending = this.pendingResolutions.get(operationId);
    if (pending) {
      this.pendingResolutions.delete(operationId);
      pending.resolve(null);
    }
    const controller = this.controllers.get(operationId);
    if (!controller) {
      return { ok: false };
    }
    controller.abort();
    return { ok: true };
  }

  private async executeAnalysisJob(job: AnalysisJob): Promise<void> {
    job.status = "analyzing";
    try {
      job.report = await buildCopyPasteAnalysisReport({
        analysisId: job.analysisId,
        request: job.request,
        fileSystem: this.fileSystem,
        thresholds: {
          largeBatchItemThreshold: this.largeBatchItemThreshold,
          largeBatchByteThreshold: this.largeBatchByteThreshold,
        },
        signal: job.controller.signal,
      });
      if (job.controller.signal.aborted) {
        job.status = "cancelled";
        return;
      }
      job.status = "complete";
    } catch (error) {
      if (isAbortError(error) || job.controller.signal.aborted) {
        job.status = "cancelled";
        return;
      }
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async executeActiveOperation(
    operationId: string,
    request: CopyPasteExecutionRequest,
    controller: AbortController,
  ): Promise<void> {
    try {
      const analysisJob = this.getAnalysisJobOrThrow(request.analysisId);
      if (analysisJob.status !== "complete" || analysisJob.report === null) {
        throw new Error("Copy/paste analysis is not ready.");
      }
      const resolvedNodes = await resolveAnalysisWithPolicy({
        report: analysisJob.report,
        policy: request.policy,
        ...(request.overrides ? { overrides: request.overrides } : {}),
        fileSystem: this.fileSystem,
      });
      await executeCopyPasteFromAnalysis({
        operationId,
        report: analysisJob.report,
        mode: analysisJob.report.mode,
        policy: request.policy,
        ...(request.overrides ? { overrides: request.overrides } : {}),
        fileSystem: this.fileSystem,
        now: this.now,
        signal: controller.signal,
        resolvedNodes,
        ...(this.writeJournal ? { writeJournal: this.writeJournal } : {}),
        emit: (event) => this.emit(event),
        // Only an answer given for the same kind of conflict, and one that makes sense
        // for this conflict, is reused.
        autoResolve: (conflict) => {
          const standing = this.standingResolutions
            .get(operationId)
            ?.get(runtimeConflictScope(conflict));
          return standing !== undefined && getAllowedRuntimeResolutions(conflict).includes(standing)
            ? standing
            : null;
        },
        // Registers the question synchronously, before the progress event announcing it
        // goes out, so an answer given from that event is not lost.
        requestResolution: (conflict) =>
          new Promise<CopyPasteRuntimeResolutionAction | null>((resolve) => {
            this.pendingResolutions.set(operationId, { conflict, resolve });
          }),
      });
    } catch (error) {
      const analysisJob = this.analysisJobs.get(request.analysisId) ?? null;
      const report = analysisJob?.report ?? null;
      const cancelled = isAbortError(error) || controller.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      const mode = report?.mode ?? analysisJob?.request.mode ?? "copy";
      this.emit({
        operationId,
        analysisId: request.analysisId,
        mode,
        status: cancelled ? "cancelled" : "failed",
        completedItemCount: 0,
        totalItemCount: report?.summary.totalNodeCount ?? 0,
        completedByteCount: 0,
        totalBytes: report?.summary.totalBytes ?? null,
        currentSourcePath: null,
        currentDestinationPath: null,
        runtimeConflict: null,
        result: cancelled
          ? null
          : report
            ? {
                operationId,
                mode: report.mode,
                status: "failed",
                destinationDirectoryPath: report.destinationDirectoryPath,
                startedAt: this.now().toISOString(),
                finishedAt: this.now().toISOString(),
                summary: {
                  topLevelItemCount: report.summary.topLevelItemCount,
                  totalItemCount: report.summary.totalNodeCount,
                  completedItemCount: 0,
                  failedItemCount: report.nodes.length,
                  skippedItemCount: 0,
                  cancelledItemCount: 0,
                  completedByteCount: 0,
                  totalBytes: report.summary.totalBytes,
                },
                items: report.nodes.map((node) => ({
                  sourcePath: node.sourcePath,
                  destinationPath: node.destinationPath,
                  sourceKind: node.sourceKind,
                  status: "failed" as const,
                  error: message,
                })),
                error: message,
              }
            : null,
      });
    } finally {
      this.pendingResolutions.delete(operationId);
      this.standingResolutions.delete(operationId);
      this.controllers.delete(operationId);
      this.analysisJobs.delete(request.analysisId);
      if (this.activeOperationId === operationId) {
        this.activeOperationId = null;
      }
    }
  }

  private getAnalysisJobOrThrow(analysisId: string): AnalysisJob {
    const job = this.analysisJobs.get(analysisId);
    if (!job) {
      throw new Error(`Unknown copy/paste analysis job: ${analysisId}`);
    }
    return job;
  }

  private hasActiveAnalysisJob(): boolean {
    for (const job of this.analysisJobs.values()) {
      if (job.status === "queued" || job.status === "analyzing") {
        return true;
      }
    }
    return false;
  }

  // Drops the analyses that have ended, but not `retainAnalysisId`, nor a finished one in
  // `keep` (one that was cancelled or failed can't be pasted from, so it goes).
  private pruneTerminalAnalysisJobs(
    keep: ReadonlySet<string>,
    retainAnalysisId: string | null = null,
  ): void {
    for (const [analysisId, job] of this.analysisJobs.entries()) {
      if (analysisId === retainAnalysisId || (keep.has(analysisId) && job.status === "complete")) {
        continue;
      }
      if (job.status === "complete" || job.status === "cancelled" || job.status === "error") {
        this.analysisJobs.delete(analysisId);
      }
    }
  }

  private emit(event: CopyPasteProgressEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("[filetrail] write service listener failed", error);
      }
    }
  }
}

export function createWriteService(dependencies: WriteServiceDependencies = {}): WriteService {
  return new WriteService(dependencies);
}
