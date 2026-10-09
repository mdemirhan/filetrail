import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { MockWriteServiceFileSystem } from "./testUtils";
import type {
  CopyPasteAnalysisReport,
  CopyPasteOperationResult,
  CopyPasteProgressEvent,
} from "./writeServiceTypes";

const REPLACE_ALL = { file: "overwrite", directory: "overwrite", mismatch: "overwrite" } as const;

// Search results from two folders, pasted into one of them: "/d/a.txt" is pasted too, and
// "/x/a.txt" would land on it.
function searchResults(): MockWriteServiceFileSystem {
  const fileSystem = new MockWriteServiceFileSystem({
    "/x": { kind: "directory" },
    "/x/a.txt": { kind: "file", size: 3 },
    "/d": { kind: "directory" },
    "/d/a.txt": { kind: "file", size: 7 },
  });
  fileSystem.enableTrash();
  fileSystem.enableRename();
  return fileSystem;
}

async function analyze(
  fileSystem: MockWriteServiceFileSystem,
  request: { mode: "copy" | "cut"; sourcePaths: string[]; destinationDirectoryPath: string } = {
    mode: "copy",
    sourcePaths: ["/x/a.txt", "/d/a.txt"],
    destinationDirectoryPath: "/d",
  },
): Promise<CopyPasteAnalysisReport> {
  return buildCopyPasteAnalysisReport({
    analysisId: "analysis-1",
    request,
    fileSystem,
    thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1000 },
  });
}

async function paste(
  fileSystem: MockWriteServiceFileSystem,
  report: CopyPasteAnalysisReport,
): Promise<CopyPasteOperationResult> {
  const events: CopyPasteProgressEvent[] = [];
  await executeCopyPasteFromAnalysis({
    operationId: "op-1",
    report,
    mode: report.mode,
    policy: REPLACE_ALL,
    fileSystem,
    now: () => new Date("2026-10-09T00:00:00.000Z"),
    signal: new AbortController().signal,
    resolvedNodes: await resolveAnalysisWithPolicy({ report, policy: REPLACE_ALL, fileSystem }),
    emit: (event) => events.push(event),
    requestResolution: async () => null,
  });
  const result = events.at(-1)?.result;
  if (!result) {
    throw new Error("The paste didn't finish.");
  }
  return result;
}

describe("Replace for all, over another item being pasted", () => {
  it("keeps both, as the review sheet says, instead of replacing it", async () => {
    const fileSystem = searchResults();
    const report = await analyze(fileSystem);
    const blocked = report.nodes.find((node) => node.sourcePath === "/x/a.txt");
    expect(blocked?.replaceBlockedReason).toBe("It is another item being pasted.");

    const result = await paste(fileSystem, report);

    expect(fileSystem.trashed).toEqual([]);
    expect(fileSystem.readNode("/d/a.txt")?.size).toBe(7);
    const kept = result.items.find((item) => item.sourcePath === "/x/a.txt");
    expect(kept).toMatchObject({ status: "completed" });
    expect(kept?.destinationPath).not.toBe("/d/a.txt");
    expect(fileSystem.readNode(kept?.destinationPath ?? "")?.size).toBe(3);
  });

  it("is refused by the paste itself when the plan says Replace", async () => {
    const fileSystem = searchResults();
    const report = await analyze(fileSystem);
    // A plan made without the review's note (or a runtime answer of Replace).
    for (const node of report.nodes) {
      node.replaceBlockedReason = null;
    }

    const result = await paste(fileSystem, report);

    expect(fileSystem.trashed).toEqual([]);
    expect(fileSystem.readNode("/d/a.txt")?.size).toBe(7);
    expect(result.items.find((item) => item.sourcePath === "/x/a.txt")).toMatchObject({
      status: "failed",
      error: "Can't replace “a.txt” because it is another item being pasted.",
    });
  });

  it("never replaces a folder holding another item being pasted, reached by another spelling", async () => {
    // "/data/d" is "/d" by another spelling (a firmlink): the same folder, by identity.
    const fileSystem = new MockWriteServiceFileSystem({
      "/x": { kind: "directory", dev: 2 },
      "/x/a": { kind: "directory", dev: 2 },
      "/x/a/new.txt": { kind: "file", size: 3, dev: 2 },
      "/d/a": { kind: "directory", ino: 500 },
      "/d/a/keep.txt": { kind: "file", size: 4, ino: 501 },
      "/data/d/a": { kind: "directory", ino: 500 },
      "/data/d/a/keep.txt": { kind: "file", size: 4, ino: 501 },
    });
    fileSystem.enableTrash();
    fileSystem.enableRename();
    const report = await analyze(fileSystem, {
      mode: "cut",
      sourcePaths: ["/x/a", "/data/d/a/keep.txt"],
      destinationDirectoryPath: "/d",
    });
    // As a Replace answered while the paste runs would plan it.
    for (const node of report.nodes) {
      node.replaceBlockedReason = null;
    }

    const result = await paste(fileSystem, report);

    expect(fileSystem.trashed).toEqual([]);
    expect(fileSystem.exists("/d/a/keep.txt")).toBe(true);
    expect(result.items.find((item) => item.sourcePath === "/x/a")).toMatchObject({
      status: "failed",
      error: "Can't replace “a” because it contains another item being pasted.",
    });
  });
});
