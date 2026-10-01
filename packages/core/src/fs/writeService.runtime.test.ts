import { MockWriteServiceFileSystem } from "./testUtils";
import {
  type CopyPasteOperationResult,
  type CopyPastePolicy,
  type CopyPasteProgressEvent,
  type CopyPasteRuntimeConflict,
  type CopyPasteRuntimeResolutionAction,
  createWriteService,
} from "./writeService";
import type { CopyPasteNodeOverride } from "./writeServiceTypes";

type Answer = {
  action: CopyPasteRuntimeResolutionAction;
  applyToRemaining?: boolean;
};

// Runs a paste through the write service. `afterAnalysis` changes the disk between the
// review and the paste; `answer` plays the person answering each question.
async function runPaste(args: {
  fileSystem: MockWriteServiceFileSystem;
  mode?: "copy" | "cut";
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy: CopyPastePolicy;
  overrides?: (report: { nodes: { id: string; sourcePath: string }[] }) => CopyPasteNodeOverride[];
  afterAnalysis?: () => void;
  answer?: (conflict: CopyPasteRuntimeConflict) => Answer | null;
  // Answers from inside the event listener, before it returns.
  answerSynchronously?: boolean;
}) {
  const service = createWriteService({ fileSystem: args.fileSystem });
  const events: CopyPasteProgressEvent[] = [];
  const asked: CopyPasteRuntimeConflict[] = [];
  service.subscribe((event) => {
    events.push(event);
    const conflict = event.runtimeConflict;
    if (event.status !== "awaiting_resolution" || !conflict) {
      return;
    }
    asked.push(conflict);
    const answer = args.answer?.(conflict) ?? null;
    const respond = () => {
      if (answer === null) {
        service.cancelOperation(event.operationId);
        return;
      }
      service.resolveRuntimeConflict(
        event.operationId,
        conflict.conflictId,
        answer.action,
        answer.applyToRemaining ?? false,
      );
    };
    if (args.answerSynchronously) {
      respond();
    } else {
      setTimeout(respond, 0);
    }
  });

  const { analysisId } = service.startCopyPasteAnalysis({
    mode: args.mode ?? "copy",
    sourcePaths: args.sourcePaths,
    destinationDirectoryPath: args.destinationDirectoryPath,
  });
  await vi.waitFor(() => {
    expect(service.getCopyPasteAnalysisUpdate(analysisId).done).toBe(true);
  });
  const report = service.getCopyPasteAnalysisUpdate(analysisId).report;
  args.afterAnalysis?.();
  const { operationId } = service.startCopyPaste({
    analysisId,
    policy: args.policy,
    ...(args.overrides && report ? { overrides: args.overrides(report) } : {}),
  });
  let result: CopyPasteOperationResult | null = null;
  await vi.waitFor(() => {
    result =
      events.find((event) => event.operationId === operationId && event.result)?.result ?? null;
    expect(result).not.toBeNull();
  });
  return { service, events, asked, result: result as CopyPasteOperationResult | null };
}

const KEEP_BOTH: CopyPastePolicy = { file: "keep_both", directory: "merge", mismatch: "skip" };

describe("writeService runtime conflicts", () => {
  it("applies a standing answer only to conflicts of the same kind", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 1 },
      "/source/b.txt": { kind: "file", size: 2 },
      "/source/c.txt": { kind: "file", size: 3 },
      "/target": { kind: "directory" },
    });
    const { asked, events, result } = await runPaste({
      fileSystem,
      sourcePaths: ["/source/a.txt", "/source/b.txt", "/source/c.txt"],
      destinationDirectoryPath: "/target",
      policy: KEEP_BOTH,
      afterAnalysis: () => {
        // "a" and "c" appear at the destination; "b" changes at the source.
        fileSystem.addFile("/target/a.txt", { size: 9 });
        fileSystem.addFile("/target/c.txt", { size: 9 });
        fileSystem.mutateNode("/source/b.txt", (node) => ({ ...node, size: 20 }));
      },
      answer: (conflict) =>
        conflict.reason === "destination_created"
          ? { action: "keep_both", applyToRemaining: true }
          : { action: "skip" },
    });

    // "Keep Both for the rest" answered "c", but said nothing about the changed "b".
    expect(asked.map((conflict) => [conflict.sourcePath, conflict.reason])).toEqual([
      ["/source/a.txt", "destination_created"],
      ["/source/b.txt", "source_changed"],
    ]);
    expect(result?.items.map((item) => [item.destinationPath, item.status])).toEqual([
      ["/target/a copy.txt", "completed"],
      ["/target/b.txt", "skipped"],
      ["/target/c copy.txt", "completed"],
    ]);
  });

  it("doesn't reuse a Keep Both answer where the destination no longer exists", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 1 },
      "/source/b.txt": { kind: "file", size: 2 },
      "/target": { kind: "directory" },
      "/target/a.txt": { kind: "file", size: 5 },
      "/target/b.txt": { kind: "file", size: 5 },
    });
    fileSystem.enableTrash();
    const { asked, result } = await runPaste({
      fileSystem,
      sourcePaths: ["/source/a.txt", "/source/b.txt"],
      destinationDirectoryPath: "/target",
      policy: { file: "overwrite", directory: "merge", mismatch: "skip" },
      afterAnalysis: () => {
        fileSystem.mutateNode("/source/a.txt", (node) => ({ ...node, size: 6 }));
        fileSystem.mutateNode("/source/b.txt", (node) => ({ ...node, size: 7 }));
        fileSystem.nodes.delete("/target/b.txt");
      },
      answer: (conflict) =>
        conflict.sourcePath === "/source/a.txt"
          ? { action: "keep_both", applyToRemaining: true }
          : { action: "overwrite" },
    });

    // With nothing left at "b.txt" there is nothing to keep both of: asked again.
    expect(asked.map((conflict) => [conflict.sourcePath, conflict.reason])).toEqual([
      ["/source/a.txt", "source_changed"],
      ["/source/b.txt", "source_changed"],
    ]);
    expect(result?.items.map((item) => item.destinationPath)).toEqual([
      "/target/a copy.txt",
      "/target/b.txt",
    ]);
  });
  it("accepts an answer given while the question is being announced", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
    });
    const { result } = await runPaste({
      fileSystem,
      sourcePaths: ["/source/a.txt"],
      destinationDirectoryPath: "/target",
      policy: KEEP_BOTH,
      afterAnalysis: () => fileSystem.addFile("/target/a.txt", { size: 9 }),
      answer: () => ({ action: "keep_both" }),
      answerSynchronously: true,
    });

    expect(result?.status).toBe("completed");
    expect(fileSystem.readNode("/target/a copy.txt")?.size).toBe(1);
  });

  it("refuses an answer the conflict doesn't offer and keeps waiting for a valid one", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/a.txt": { kind: "file", size: 1 },
      "/target": { kind: "directory" },
    });
    const refused: boolean[] = [];
    const service = createWriteService({ fileSystem });
    service.subscribe((event) => {
      const conflict = event.runtimeConflict;
      if (event.status === "awaiting_resolution" && conflict) {
        // A deleted source can only be skipped; "merge" isn't even a file answer.
        refused.push(
          service.resolveRuntimeConflict(event.operationId, conflict.conflictId, "overwrite").ok,
          service.resolveRuntimeConflict(event.operationId, conflict.conflictId, "merge").ok,
        );
        refused.push(
          service.resolveRuntimeConflict(event.operationId, conflict.conflictId, "skip").ok,
        );
      }
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => events.push(event));
    const { analysisId } = service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["/source/a.txt"],
      destinationDirectoryPath: "/target",
    });
    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate(analysisId).done).toBe(true);
    });
    await fileSystem.rm("/source/a.txt");
    service.startCopyPaste({ analysisId, policy: KEEP_BOTH });
    await vi.waitFor(() => {
      expect(events.some((event) => event.result)).toBe(true);
    });

    expect(refused).toEqual([false, false, true]);
    expect(events.at(-1)?.result?.items[0]).toMatchObject({
      status: "skipped",
      skipReason: "runtime_conflict_resolution",
    });
  });

  it("gives a runtime Keep Both copy a name no later item of the paste will use", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/X.txt": { kind: "file", size: 1 },
      "/source/X copy.txt": { kind: "file", size: 2 },
      "/target": { kind: "directory" },
    });
    fileSystem.enableRename();
    const { result } = await runPaste({
      fileSystem,
      mode: "cut",
      sourcePaths: ["/source/X.txt", "/source/X copy.txt"],
      destinationDirectoryPath: "/target",
      policy: KEEP_BOTH,
      afterAnalysis: () => fileSystem.addFile("/target/X.txt", { size: 9 }),
      answer: () => ({ action: "keep_both" }),
    });

    expect(result?.status).toBe("completed");
    // The result names where each item really went.
    expect(result?.items.map((item) => [item.sourcePath, item.destinationPath])).toEqual([
      ["/source/X.txt", "/target/X copy 2.txt"],
      ["/source/X copy.txt", "/target/X copy.txt"],
    ]);
    expect(fileSystem.readNode("/target/X copy 2.txt")?.size).toBe(1);
    expect(fileSystem.readNode("/target/X copy.txt")?.size).toBe(2);
    expect(fileSystem.readNode("/target/X.txt")?.size).toBe(9);
  });

  it("keeps the review's choices for items inside a folder merged at runtime", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/D": { kind: "directory" },
      "/source/D/c.txt": { kind: "file", size: 1 },
      "/source/D/d.txt": { kind: "file", size: 2 },
      "/target/D": { kind: "directory" },
      "/target/D/c.txt": { kind: "file", size: 8 },
      "/target/D/d.txt": { kind: "file", size: 9 },
    });
    fileSystem.enableTrash();
    const { result } = await runPaste({
      fileSystem,
      sourcePaths: ["/source/D"],
      destinationDirectoryPath: "/target",
      policy: { file: "overwrite", directory: "overwrite", mismatch: "skip" },
      // In the review the person kept the existing "c.txt".
      overrides: (report) => [
        {
          nodeId: `${report.nodes[0]?.id}/c.txt`,
          action: "skip",
        },
      ],
      // Someone replaces the folder "D" before the paste reaches it.
      afterAnalysis: () => {
        fileSystem.nodes.delete("/target/D");
        fileSystem.addDirectory("/target/D", { ino: 999 });
      },
      answer: (conflict) =>
        conflict.reason === "destination_changed" ? { action: "merge" } : { action: "skip" },
    });

    expect(result?.status).toBe("partial");
    expect(fileSystem.readNode("/target/D/c.txt")?.size).toBe(8);
    expect(fileSystem.readNode("/target/D/d.txt")?.size).toBe(2);
  });
});
