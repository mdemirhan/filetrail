import { buildCopyPastePlan, normalizeCopyPasteRequest, toPublicPlan } from "./copyPastePlanner";
import { executeCopyPasteOperation } from "./copyPasteExecutor";
import {
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  WRITE_OPERATION_BUSY_ERROR,
  type CopyPasteOperationHandle,
  type CopyPastePlan,
  type CopyPasteProgressEvent,
  type CopyPasteRequest,
  type QueuedOperation,
  type WriteServiceDependencies,
  type WriteServiceFileSystem,
} from "./writeServiceTypes";

export {
  WRITE_OPERATION_BUSY_ERROR,
  type CopyPasteConflictResolution,
  type CopyPasteItemResult,
  type CopyPasteMode,
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
  type CopyPasteProgressEvent,
  type CopyPasteRequest,
  type WriteServiceDependencies,
  type WriteServiceFileSystem,
  type WriteServiceStats,
} from "./writeServiceTypes";

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
  }

  subscribe(listener: (event: CopyPasteProgressEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async planCopyPaste(request: CopyPasteRequest): Promise<CopyPastePlan> {
    const normalizedRequest = normalizeCopyPasteRequest(request);
    const plan = await buildCopyPastePlan(normalizedRequest, this.fileSystem, {
      largeBatchItemThreshold: this.largeBatchItemThreshold,
      largeBatchByteThreshold: this.largeBatchByteThreshold,
    });
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
    const operation: QueuedOperation = {
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
      const plan = await buildCopyPastePlan(operation.request, this.fileSystem, {
        largeBatchItemThreshold: this.largeBatchItemThreshold,
        largeBatchByteThreshold: this.largeBatchByteThreshold,
      });
      const publicPlan = toPublicPlan(plan, operation.request);
      await executeCopyPasteOperation({
        operationId: operation.operationId,
        request: operation.request,
        plan,
        publicPlan,
        fileSystem: this.fileSystem,
        now: this.now,
        signal: operation.controller.signal,
        emit: (event) => this.emit(event),
      });
    } finally {
      this.controllers.delete(operation.operationId);
      this.activeOperationId = null;
    }
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
