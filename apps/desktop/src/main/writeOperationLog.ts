export type WriteOperationLogPhase = "started" | "finished" | "cancel_requested";

export type WriteOperationResultSummary = {
  status: string;
  completedItemCount?: number;
  failedItemCount?: number;
  skippedItemCount?: number;
  cancelledItemCount?: number;
  error?: string | null;
};

export type WriteOperationLogEntry = {
  phase: WriteOperationLogPhase;
  kind: string;
  action: string;
  operationId: string;
  sourcePaths: string[];
  targetPaths: string[];
  result?: WriteOperationResultSummary;
  metadata?: Record<string, string | number | boolean | null>;
};

type LogSink = Pick<Console, "info">;

export function createWriteOperationLogger(sink: LogSink = console) {
  return {
    log(entry: WriteOperationLogEntry) {
      sink.info("[filetrail] write-operation", entry);
    },
  };
}
