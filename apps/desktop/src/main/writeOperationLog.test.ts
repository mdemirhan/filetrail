import { createWriteOperationLogger } from "./writeOperationLog";

describe("writeOperationLog", () => {
  it("emits structured write operation logs", () => {
    const sink = {
      info: vi.fn(),
    };
    const logger = createWriteOperationLogger(sink);

    logger.log({
      phase: "finished",
      kind: "copyPaste",
      action: "copy",
      operationId: "copy-op-1",
      sourcePaths: ["/source/a.txt"],
      targetPaths: ["/target"],
      result: {
        status: "partial",
        completedItemCount: 1,
        skippedItemCount: 1,
        failedItemCount: 0,
        cancelledItemCount: 0,
        error: null,
      },
      metadata: {
        conflictResolution: "skip",
      },
    });

    expect(sink.info).toHaveBeenCalledWith("[filetrail] write-operation", {
      phase: "finished",
      kind: "copyPaste",
      action: "copy",
      operationId: "copy-op-1",
      sourcePaths: ["/source/a.txt"],
      targetPaths: ["/target"],
      result: {
        status: "partial",
        completedItemCount: 1,
        skippedItemCount: 1,
        failedItemCount: 0,
        cancelledItemCount: 0,
        error: null,
      },
      metadata: {
        conflictResolution: "skip",
      },
    });
  });
});
