import { isAbortError } from "@filetrail/contracts";

import {
  buildCopyPasteAnalysisReport,
  normalizeCopyPasteAnalysisRequest,
} from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import {
  ANALYSIS_BUSY_ERROR,
  DEFAULT_COPY_PASTE_POLICY,
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  WRITE_OPERATION_BUSY_ERROR,
  type CopyPasteAnalysisReport,
  type CopyPasteAnalysisRequest,
  type CopyPasteAnalysisStartHandle,
  type CopyPasteAnalysisUpdate,
  type CopyPasteConflictResolution,
  type CopyPasteExecutionRequest,
  type CopyPasteOperationHandle,
  type CopyPastePlan,
  type CopyPasteProgressEvent,
  type CopyPasteRequest,
  type CopyPasteRuntimeResolutionAction,
  type RequiredCopyPasteAnalysisRequest,
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
  type CopyPasteConflictResolution,
  type CopyPasteExecutionRequest,
  type CopyPasteItemResult,
  type CopyPasteMode,
  type CopyPasteNodeKind,
  type CopyPasteOperationHandle,
  type CopyPasteOperationResult,
  type CopyPasteOperationStatus,
  type CopyPastePlan,
  type CopyPastePlanConflict,
  type CopyPastePlanIssue,
  type CopyPastePlanIssueCode,
  type CopyPastePlanItem,
  type CopyPastePlanItemStatus,
  type CopyPastePlanWarning,
  type CopyPastePlanWarningCode,
  type CopyPastePolicy,
  type CopyPasteProgressEvent,
  type CopyPasteRequest,
  type CopyPasteRuntimeConflict,
  type CopyPasteRuntimeResolutionAction,
  type NodeFingerprint,
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
  legacyConflictResolution: CopyPasteConflictResolution | null;
};

type PendingResolution = {
  conflictId: string;
  resolve: (action: CopyPasteRuntimeResolutionAction | null) => void;
};

export class WriteService {
  private readonly fileSystem: WriteServiceFileSystem;
  private readonly now: () => Date;
  private readonly createOperationId: () => string;
  private readonly createAnalysisId: () => string;
  private readonly largeBatchItemThreshold: number;
  private readonly largeBatchByteThreshold: number;
  private readonly listeners = new Set<(event: CopyPasteProgressEvent) => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly analysisJobs = new Map<string, AnalysisJob>();
  private readonly pendingResolutions = new Map<string, PendingResolution>();
  private activeOperationId: string | null = null;
  private sequence = 0;
  private analysisSequence = 0;

  constructor(dependencies: WriteServiceDependencies = {}) {
    this.fileSystem = dependencies.fileSystem ?? DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
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

  async planCopyPaste(request: CopyPasteRequest): Promise<CopyPastePlan> {
    const report = await buildCopyPasteAnalysisReport({
      analysisId: this.createAnalysisId(),
      request: normalizeCopyPasteAnalysisRequest(request),
      fileSystem: this.fileSystem,
      thresholds: {
        largeBatchItemThreshold: this.largeBatchItemThreshold,
        largeBatchByteThreshold: this.largeBatchByteThreshold,
      },
    });
    return toLegacyPlan(report, request.conflictResolution ?? "error");
  }

  startCopyPasteAnalysis(request: CopyPasteAnalysisRequest): CopyPasteAnalysisStartHandle {
    this.pruneTerminalAnalysisJobs();
    if (this.activeOperationId !== null) {
      throw new Error(WRITE_OPERATION_BUSY_ERROR);
    }
    if (this.hasActiveAnalysisJob()) {
      throw new Error(ANALYSIS_BUSY_ERROR);
    }
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
      legacyConflictResolution: null,
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

  startCopyPaste(request: CopyPasteRequest | CopyPasteExecutionRequest): CopyPasteOperationHandle {
    if (this.activeOperationId !== null) {
      throw new Error(WRITE_OPERATION_BUSY_ERROR);
    }
    this.pruneTerminalAnalysisJobs("analysisId" in request ? request.analysisId : null);

    const operationId = this.createOperationId();
    const controller = new AbortController();
    this.controllers.set(operationId, controller);
    this.activeOperationId = operationId;

    const start =
      "analysisId" in request ? request : this.createLegacyExecutionRequest(request);
    this.emit({
      operationId,
      analysisId: start.analysisId,
      mode: this.getAnalysisJobOrThrow(start.analysisId).request.mode,
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
  ): { ok: boolean } {
    const pending = this.pendingResolutions.get(operationId);
    if (!pending || pending.conflictId !== conflictId) {
      return { ok: false };
    }
    this.pendingResolutions.delete(operationId);
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
      if (analysisJob.report === null) {
        analysisJob.status = "analyzing";
        analysisJob.report = await buildCopyPasteAnalysisReport({
          analysisId: analysisJob.analysisId,
          request: analysisJob.request,
          fileSystem: this.fileSystem,
          thresholds: {
            largeBatchItemThreshold: this.largeBatchItemThreshold,
            largeBatchByteThreshold: this.largeBatchByteThreshold,
          },
          signal: controller.signal,
        });
        analysisJob.status = "complete";
      }
      if (analysisJob.status !== "complete" || analysisJob.report === null) {
        throw new Error("Copy/paste analysis is not ready.");
      }
      if (
        analysisJob.legacyConflictResolution === "error" &&
        analysisJob.report.nodes.some((node) => node.conflictClass !== null)
      ) {
        throw new Error("Copy/paste analysis contains unresolved conflicts.");
      }
      const resolvedNodes = await resolveAnalysisWithPolicy({
        report: analysisJob.report,
        policy: request.policy,
        fileSystem: this.fileSystem,
      });
      await executeCopyPasteFromAnalysis({
        operationId,
        report: analysisJob.report,
        mode: analysisJob.report.mode,
        policy: request.policy,
        fileSystem: this.fileSystem,
        now: this.now,
        signal: controller.signal,
        resolvedNodes,
        emit: (event) => this.emit(event),
        requestResolution: (conflict) =>
          analysisJob.legacyConflictResolution === "error"
            ? Promise.resolve(null)
            : new Promise<CopyPasteRuntimeResolutionAction | null>((resolve) => {
                this.pendingResolutions.set(operationId, {
                  conflictId: conflict.conflictId,
                  resolve,
                });
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
                  status: "failed",
                  error: message,
                })),
                error: message,
              }
            : null,
      });
    } finally {
      this.pendingResolutions.delete(operationId);
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

  private pruneTerminalAnalysisJobs(retainAnalysisId: string | null = null): void {
    for (const [analysisId, job] of this.analysisJobs.entries()) {
      if (retainAnalysisId !== null && analysisId === retainAnalysisId) {
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

  private createLegacyExecutionRequest(request: CopyPasteRequest): CopyPasteExecutionRequest {
    const analysisId = this.createAnalysisId();
    const normalizedRequest = normalizeCopyPasteAnalysisRequest(request);
    const job: AnalysisJob = {
      analysisId,
      request: normalizedRequest,
      controller: new AbortController(),
      status: "queued",
      report: null,
      error: null,
      legacyConflictResolution: request.conflictResolution ?? "error",
    };
    this.analysisJobs.set(analysisId, job);
    return {
      analysisId,
      policy: DEFAULT_COPY_PASTE_POLICY,
    };
  }
}

export function createWriteService(dependencies: WriteServiceDependencies = {}): WriteService {
  return new WriteService(dependencies);
}

function toLegacyPlan(
  report: CopyPasteAnalysisReport,
  conflictResolution: CopyPasteConflictResolution,
): CopyPastePlan {
  const conflicts = report.nodes
    .filter((node) => node.conflictClass !== null)
    .map((node) => ({
      sourcePath: node.sourcePath,
      destinationPath: node.destinationPath,
      reason: "destination_exists" as const,
    }));
  return {
    mode: report.mode,
    sourcePaths: report.sourcePaths,
    destinationDirectoryPath: report.destinationDirectoryPath,
    conflictResolution,
    items: report.nodes.map((node) => ({
      sourcePath: node.sourcePath,
      destinationPath: node.destinationPath,
      kind: node.sourceKind,
      status: node.conflictClass === null ? "ready" : "conflict",
      sizeBytes: node.sourceFingerprint.size,
    })),
    conflicts,
    issues: report.issues,
    warnings: report.warnings,
    requiresConfirmation: {
      largeBatch: report.warnings.some((warning) => warning.code === "large_batch"),
      cutDelete: report.mode === "cut",
    },
    summary: {
      topLevelItemCount: report.summary.topLevelItemCount,
      totalItemCount: report.summary.totalNodeCount,
      totalBytes: report.summary.totalBytes,
      skippedConflictCount: conflictResolution === "skip" ? conflicts.length : 0,
    },
    canExecute:
      report.issues.length === 0 &&
      (conflictResolution === "skip" || conflicts.length === 0) &&
      report.nodes.some((node) => conflictResolution === "skip" ? node.conflictClass === null : true),
  };
}
