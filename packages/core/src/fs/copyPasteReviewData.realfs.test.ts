import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { nativeFileSystem } from "./testNativePaste";
import { createWriteService } from "./writeService";
import type { CopyPasteAnalysisNode, CopyPasteProgressEvent } from "./writeServiceTypes";

let testDir: string;
let source: string;
let target: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-review-data-"));
  source = join(testDir, "source");
  target = join(testDir, "target");
  await mkdir(source);
  await mkdir(target);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function analyze(sourceNames: string[]) {
  return buildCopyPasteAnalysisReport({
    analysisId: "analysis-review",
    request: {
      mode: "copy",
      sourcePaths: sourceNames.map((name) => join(source, name)),
      destinationDirectoryPath: target,
    },
    fileSystem: nativeFileSystem,
    thresholds: { largeBatchItemThreshold: 1000, largeBatchByteThreshold: 1e9 },
  });
}

function findNode(nodes: CopyPasteAnalysisNode[], name: string): CopyPasteAnalysisNode {
  for (const node of nodes) {
    if (node.sourcePath.endsWith(`/${name}`)) {
      return node;
    }
    const nested = node.children.length > 0 ? findNodeOrNull(node.children, name) : null;
    if (nested) {
      return nested;
    }
  }
  throw new Error(`No node for ${name}`);
}

function findNodeOrNull(nodes: CopyPasteAnalysisNode[], name: string) {
  try {
    return findNode(nodes, name);
  } catch {
    return null;
  }
}

describe("copy/paste review data (real filesystem)", () => {
  it("names the Keep Both copy of every conflict, reserving names across the paste", async () => {
    await writeFile(join(source, "a.txt"), "a");
    await writeFile(join(source, "a copy.txt"), "a copy");
    await writeFile(join(target, "a.txt"), "existing");
    await mkdir(join(source, "photos"));
    await mkdir(join(target, "photos"));
    await writeFile(join(source, "photos", "x.jpg"), "x");
    await writeFile(join(target, "photos", "x.jpg"), "old x");

    const report = await analyze(["a.txt", "a copy.txt", "photos"]);

    expect(findNode(report.nodes, "a.txt").keepBothDestinationPath).toBe(
      join(target, "a copy 2.txt"),
    );
    expect(findNode(report.nodes, "a copy.txt").keepBothDestinationPath).toBeNull();
    expect(findNode(report.nodes, "photos").keepBothDestinationPath).toBe(
      join(target, "photos copy"),
    );
    // Inside a folder that will be merged, nested conflicts get their names too.
    expect(findNode(report.nodes, "x.jpg").keepBothDestinationPath).toBe(
      join(target, "photos", "x copy.jpg"),
    );
  });

  it("lists what exists only in the existing folder, nested items included", async () => {
    await mkdir(join(source, "photos", "2025"), { recursive: true });
    await writeFile(join(source, "photos", "a.jpg"), "a");
    await writeFile(join(source, "photos", "2025", "b.jpg"), "b");
    await mkdir(join(target, "photos", "2025"), { recursive: true });
    await mkdir(join(target, "photos", "raw"));
    await writeFile(join(target, "photos", "a.jpg"), "old a");
    await writeFile(join(target, "photos", "d.jpg"), "d");
    await writeFile(join(target, "photos", "2025", "old.jpg"), "old");
    await writeFile(join(target, "photos", "raw", "1.dng"), "1");
    await writeFile(join(target, "photos", "raw", "2.dng"), "2");

    const report = await analyze(["photos"]);

    expect(findNode(report.nodes, "photos").destinationOnly).toEqual({
      // d.jpg, 2025/old.jpg, raw, raw/1.dng, raw/2.dng
      count: 5,
      samplePaths: ["2025/old.jpg", "d.jpg", "raw"],
    });
  });

  it("counts a folder that a pasted file would replace as lost entirely", async () => {
    await writeFile(join(source, "config"), "file");
    await mkdir(join(target, "config"));
    await writeFile(join(target, "config", "settings.ini"), "x");

    const report = await analyze(["config"]);

    expect(findNode(report.nodes, "config")).toMatchObject({
      conflictClass: "type_mismatch",
      destinationOnly: { count: 1, samplePaths: ["settings.ini"] },
      replaceBlockedReason: null,
    });
  });

  it("marks an item that can't be replaced because it contains the pasted item", async () => {
    await mkdir(join(target, "foo", "foo"), { recursive: true });

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-review",
      request: {
        mode: "copy",
        sourcePaths: [join(target, "foo", "foo")],
        destinationDirectoryPath: target,
      },
      fileSystem: nativeFileSystem,
      thresholds: { largeBatchItemThreshold: 1000, largeBatchByteThreshold: 1e9 },
    });

    expect(report.nodes[0]?.replaceBlockedReason).toBe("It contains the item being pasted.");
  });

  it("applies per-item choices over the policy for their kind", async () => {
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await writeFile(join(source, name), `new ${name}`);
      await writeFile(join(target, name), `old ${name}`);
    }
    const report = await analyze(["a.txt", "b.txt", "c.txt"]);
    const policy = { file: "keep_both", directory: "merge", mismatch: "skip" } as const;
    const resolvedNodes = await resolveAnalysisWithPolicy({
      report,
      policy,
      overrides: [
        { nodeId: findNode(report.nodes, "a.txt").id, action: "overwrite" },
        { nodeId: findNode(report.nodes, "b.txt").id, action: "skip" },
        // "merge" makes no sense for a file and is ignored.
        { nodeId: findNode(report.nodes, "c.txt").id, action: "merge" },
      ],
      fileSystem: nativeFileSystem,
    });

    expect(resolvedNodes.map((node) => node.action)).toEqual(["overwrite", "skip", "keep_both"]);
    await executeCopyPasteFromAnalysis({
      operationId: "op-review",
      report,
      mode: "copy",
      policy,
      fileSystem: nativeFileSystem,
      now: () => new Date(),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: () => undefined,
      // No Trash in this file system: replacing "a.txt" asks before deleting it.
      requestResolution: async (conflict) =>
        conflict.reason === "trash_unavailable" ? "overwrite" : null,
    });
    expect(await readFile(join(target, "a.txt"), "utf8")).toBe("new a.txt");
    expect(await readFile(join(target, "b.txt"), "utf8")).toBe("old b.txt");
    expect(await readFile(join(target, "c copy.txt"), "utf8")).toBe("new c.txt");
  });

  it("answers later changes the same way when asked to, through the write service", async () => {
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await writeFile(join(source, name), `new ${name}`);
    }
    const service = createWriteService({ fileSystem: nativeFileSystem });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
      const conflict = event.runtimeConflict;
      if (event.status === "awaiting_resolution" && conflict) {
        // Answered later, like a person clicking in the dialog.
        setTimeout(() => {
          service.resolveRuntimeConflict(event.operationId, conflict.conflictId, "keep_both", true);
        }, 0);
      }
    });

    const { analysisId } = service.startCopyPasteAnalysis({
      mode: "copy",
      sourcePaths: ["a.txt", "b.txt", "c.txt"].map((name) => join(source, name)),
      destinationDirectoryPath: target,
    });
    await vi.waitFor(() => {
      expect(service.getCopyPasteAnalysisUpdate(analysisId).done).toBe(true);
    });
    // All three names get taken after review, before the paste starts.
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      await writeFile(join(target, name), `someone else's ${name}`);
    }
    service.startCopyPaste({
      analysisId,
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
    });
    await vi.waitFor(() => {
      expect(events.at(-1)?.result).not.toBeNull();
    });

    expect(events.filter((event) => event.status === "awaiting_resolution")).toHaveLength(1);
    expect(events.at(-1)?.status).toBe("completed");
    expect((await readdir(target)).sort()).toEqual([
      "a copy.txt",
      "a.txt",
      "b copy.txt",
      "b.txt",
      "c copy.txt",
      "c.txt",
    ]);
  });
});
