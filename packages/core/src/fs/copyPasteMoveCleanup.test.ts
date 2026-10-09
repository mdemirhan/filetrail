import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { MockWriteServiceFileSystem } from "./testUtils";
import type {
  CopyPasteAnalysisReport,
  CopyPasteOperationResult,
  CopyPastePolicy,
  CopyPasteProgressEvent,
  CopyPasteRuntimeConflict,
  CopyPasteRuntimeResolutionAction,
} from "./writeServiceTypes";

const SKIP: CopyPastePolicy = { file: "skip", directory: "skip", mismatch: "skip" };
const COPY_NOT_WHOLE =
  "Its copy went away or changed before the original was removed, so the original was kept.";

// A folder on another disk (dev 2): moving it copies it, then removes the originals.
function folderOnAnotherDisk(): MockWriteServiceFileSystem {
  const fileSystem = new MockWriteServiceFileSystem({
    "/source": { kind: "directory", dev: 2 },
    "/source/dir": { kind: "directory", dev: 2 },
    "/source/dir/a.txt": { kind: "file", size: 5, dev: 2 },
    "/source/dir/b.txt": { kind: "file", size: 6, dev: 2 },
    "/source/dir/link": { kind: "symlink", target: "a.txt", dev: 2 },
    "/target": { kind: "directory" },
  });
  fileSystem.enableRename();
  return fileSystem;
}

async function analyze(
  fileSystem: MockWriteServiceFileSystem,
  sourcePaths: string[],
): Promise<CopyPasteAnalysisReport> {
  return buildCopyPasteAnalysisReport({
    analysisId: "analysis-1",
    request: { mode: "cut", sourcePaths, destinationDirectoryPath: "/target" },
    fileSystem,
    thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1000 },
  });
}

async function move(
  fileSystem: MockWriteServiceFileSystem,
  report: CopyPasteAnalysisReport,
  answer: (conflict: CopyPasteRuntimeConflict) => CopyPasteRuntimeResolutionAction | null = () =>
    null,
): Promise<CopyPasteOperationResult> {
  const events: CopyPasteProgressEvent[] = [];
  await executeCopyPasteFromAnalysis({
    operationId: "op-1",
    report,
    mode: "cut",
    policy: SKIP,
    fileSystem,
    now: () => new Date("2026-10-09T00:00:00.000Z"),
    signal: new AbortController().signal,
    resolvedNodes: await resolveAnalysisWithPolicy({ report, policy: SKIP, fileSystem }),
    emit: (event) => events.push(event),
    requestResolution: async (conflict) => answer(conflict),
  });
  const result = events.at(-1)?.result;
  if (!result) {
    throw new Error("The move didn't finish.");
  }
  return result;
}

// Runs `change` on the hidden copy just before it takes its name.
function beforeTheCopyTakesItsName(
  fileSystem: MockWriteServiceFileSystem,
  change: (hiddenPath: string) => void,
): void {
  fileSystem.renameImpl = async (from, to) => {
    if (to === "/target/dir") {
      change(from);
    }
    await fileSystem.renameDirectly(from, to);
  };
}

describe("a move to another disk removes an original only once its copy is checked", () => {
  it("keeps the original of a copy deleted before the originals go", async () => {
    const fileSystem = folderOnAnotherDisk();
    const report = await analyze(fileSystem, ["/source/dir"]);
    beforeTheCopyTakesItsName(fileSystem, (hidden) => fileSystem.nodes.delete(`${hidden}/a.txt`));

    const result = await move(fileSystem, report);

    expect(fileSystem.exists("/source/dir/a.txt")).toBe(true);
    expect(fileSystem.exists("/source/dir/b.txt")).toBe(false);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        sourcePath: "/source/dir/a.txt",
        status: "failed",
        error: COPY_NOT_WHOLE,
      }),
    );
    expect(result.items).toContainEqual(
      expect.objectContaining({ sourcePath: "/source/dir/b.txt", status: "completed" }),
    );
  });

  it("keeps the original of a copy cut short or replaced, or of a link changed", async () => {
    const fileSystem = folderOnAnotherDisk();
    const report = await analyze(fileSystem, ["/source/dir"]);
    beforeTheCopyTakesItsName(fileSystem, (hidden) => {
      const copy = fileSystem.readNode(`${hidden}/a.txt`);
      if (copy) {
        copy.size = 2;
      }
      // Another file put in the place of b.txt's copy, as large.
      fileSystem.nodes.delete(`${hidden}/b.txt`);
      fileSystem.addFile(`${hidden}/b.txt`, { size: 6 });
      const link = fileSystem.readNode(`${hidden}/link`);
      if (link) {
        link.target = "elsewhere";
      }
    });

    const result = await move(fileSystem, report);

    for (const name of ["a.txt", "b.txt", "link"]) {
      expect(fileSystem.exists(`/source/dir/${name}`)).toBe(true);
      expect(result.items).toContainEqual(
        expect.objectContaining({
          sourcePath: `/source/dir/${name}`,
          status: "failed",
          error: COPY_NOT_WHOLE,
        }),
      );
    }
    expect(result.status).toBe("failed");
  });

  it("keeps the original of a single file whose copy came out short", async () => {
    const fileSystem = folderOnAnotherDisk();
    const report = await analyze(fileSystem, ["/source/dir/a.txt"]);
    fileSystem.copyFileStreamImpl = async (_source, destination) => {
      fileSystem.addFile(destination, { size: 1 });
    };

    const result = await move(fileSystem, report);

    expect(fileSystem.exists("/source/dir/a.txt")).toBe(true);
    expect(result.items).toEqual([
      expect.objectContaining({ status: "failed", error: COPY_NOT_WHOLE }),
    ]);
  });

  it("keeps the original of a single file whose copy was replaced by one as large", async () => {
    const fileSystem = folderOnAnotherDisk();
    const report = await analyze(fileSystem, ["/source/dir/a.txt"]);
    // Another app puts an item as large in the copy's place as soon as it has its name.
    fileSystem.renameImpl = async (from, to) => {
      await fileSystem.renameDirectly(from, to);
      if (to === "/target/a.txt") {
        fileSystem.nodes.delete("/target/a.txt");
        fileSystem.addFile("/target/a.txt", { size: 5 });
      }
    };

    const result = await move(fileSystem, report);

    expect(fileSystem.exists("/source/dir/a.txt")).toBe(true);
    expect(result.items).toEqual([
      expect.objectContaining({ status: "failed", error: COPY_NOT_WHOLE }),
    ]);
  });

  it("removes an original that changed after the review once the person goes on with it", async () => {
    const fileSystem = folderOnAnotherDisk();
    const report = await analyze(fileSystem, ["/source/dir"]);
    // Saved again after the review: larger and newer.
    const original = fileSystem.readNode("/source/dir/a.txt");
    if (original) {
      original.size = 50;
      original.mtimeMs += 1;
    }
    const asked: string[] = [];

    const result = await move(fileSystem, report, (conflict) => {
      asked.push(`${conflict.reason} ${conflict.sourcePath}`);
      return "overwrite";
    });

    expect(asked).toEqual(["source_changed /source/dir/a.txt"]);
    expect(result.status).toBe("completed");
    expect(fileSystem.readNode("/target/dir/a.txt")?.size).toBe(50);
    expect(fileSystem.exists("/source/dir")).toBe(false);
  });

  it("removes the originals a folder saved anew holds once the person goes on with it", async () => {
    const fileSystem = folderOnAnotherDisk();
    fileSystem.addDirectory("/source/dir/sub", { dev: 2 });
    fileSystem.addFile("/source/dir/sub/c.txt", { size: 1, dev: 2 });
    const report = await analyze(fileSystem, ["/source/dir"]);
    // Saved anew after the review: another folder, with c.txt changed and an item added.
    fileSystem.nodes.delete("/source/dir/sub/c.txt");
    fileSystem.nodes.delete("/source/dir/sub");
    fileSystem.addDirectory("/source/dir/sub", { dev: 2 });
    fileSystem.addFile("/source/dir/sub/c.txt", { size: 3, dev: 2 });
    fileSystem.addFile("/source/dir/sub/added.txt", { size: 4, dev: 2 });
    const asked: string[] = [];

    const result = await move(fileSystem, report, (conflict) => {
      asked.push(`${conflict.reason} ${conflict.sourcePath}`);
      return "overwrite";
    });

    expect(asked).toEqual(["source_changed /source/dir/sub"]);
    expect(result.status).toBe("completed");
    expect(fileSystem.readNode("/target/dir/sub/c.txt")?.size).toBe(3);
    expect(fileSystem.readNode("/target/dir/sub/added.txt")?.size).toBe(4);
    expect(fileSystem.exists("/source/dir")).toBe(false);
  });

  it("removes a folder saved anew as a file once the person goes on with it", async () => {
    const fileSystem = folderOnAnotherDisk();
    fileSystem.addDirectory("/source/dir/sub", { dev: 2 });
    fileSystem.addFile("/source/dir/sub/c.txt", { size: 1, dev: 2 });
    const report = await analyze(fileSystem, ["/source/dir"]);
    fileSystem.nodes.delete("/source/dir/sub/c.txt");
    fileSystem.nodes.delete("/source/dir/sub");
    fileSystem.addFile("/source/dir/sub", { size: 7, dev: 2 });

    const result = await move(fileSystem, report, () => "overwrite");

    expect(result.status).toBe("completed");
    expect(result.items).toContainEqual(
      expect.objectContaining({ sourcePath: "/source/dir/sub", sourceKind: "file" }),
    );
    expect(fileSystem.readNode("/target/dir/sub")?.size).toBe(7);
    expect(fileSystem.exists("/source/dir")).toBe(false);
  });

  it("removes a file saved anew as a folder once the person goes on with it", async () => {
    const fileSystem = folderOnAnotherDisk();
    const report = await analyze(fileSystem, ["/source/dir"]);
    fileSystem.nodes.delete("/source/dir/a.txt");
    fileSystem.addDirectory("/source/dir/a.txt", { dev: 2 });
    fileSystem.addFile("/source/dir/a.txt/inside.txt", { size: 2, dev: 2 });

    const result = await move(fileSystem, report, () => "overwrite");

    expect(result.status).toBe("completed");
    expect(result.items).toContainEqual(
      expect.objectContaining({ sourcePath: "/source/dir/a.txt/inside.txt", status: "completed" }),
    );
    expect(result.items).not.toContainEqual(
      expect.objectContaining({ sourcePath: "/source/dir/a.txt", sourceKind: "file" }),
    );
    expect(fileSystem.readNode("/target/dir/a.txt/inside.txt")?.size).toBe(2);
    expect(fileSystem.exists("/source/dir")).toBe(false);
  });

  it("says so when a file saved anew as a folder keeps its original folder", async () => {
    const fileSystem = folderOnAnotherDisk();
    const report = await analyze(fileSystem, ["/source/dir"]);
    fileSystem.nodes.delete("/source/dir/a.txt");
    fileSystem.addDirectory("/source/dir/a.txt", { dev: 2 });
    fileSystem.addFile("/source/dir/a.txt/inside.txt", { size: 2, dev: 2 });
    Object.assign(fileSystem, {
      copyMetadata: async (source: string) => {
        if (source === "/source/dir/a.txt") {
          throw Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" });
        }
      },
    });

    const result = await move(fileSystem, report, () => "overwrite");

    expect(fileSystem.exists("/target/dir/a.txt/inside.txt")).toBe(true);
    expect(fileSystem.exists("/source/dir/a.txt/inside.txt")).toBe(false);
    expect(fileSystem.exists("/source/dir/a.txt")).toBe(true);
    expect(result.status).not.toBe("completed");
    expect(result.items).toContainEqual(
      expect.objectContaining({
        sourcePath: "/source/dir/a.txt",
        sourceKind: "directory",
        status: "failed",
        error:
          "Its items were moved, but the folder's own information (such as its tags) couldn't all be copied, so the original “a.txt” was kept.",
      }),
    );
  });

  it("names a folder saved anew as a file by what it is when its copy fails", async () => {
    const fileSystem = folderOnAnotherDisk();
    fileSystem.addDirectory("/source/dir/sub", { dev: 2 });
    fileSystem.addFile("/source/dir/sub/c.txt", { size: 1, dev: 2 });
    const report = await analyze(fileSystem, ["/source/dir/sub"]);
    fileSystem.nodes.delete("/source/dir/sub/c.txt");
    fileSystem.nodes.delete("/source/dir/sub");
    fileSystem.addFile("/source/dir/sub", { size: 7, dev: 2 });
    fileSystem.copyFileStreamImpl = async () => {
      throw Object.assign(new Error("EIO: i/o error"), { code: "EIO" });
    };

    const result = await move(fileSystem, report, () => "overwrite");

    expect(result.items).toEqual([
      expect.objectContaining({
        sourcePath: "/source/dir/sub",
        sourceKind: "file",
        status: "failed",
      }),
    ]);
    expect(fileSystem.readNode("/source/dir/sub")?.size).toBe(7);
  });

  it("keeps an original folder whose own metadata its copy couldn't take", async () => {
    const fileSystem = folderOnAnotherDisk();
    fileSystem.addDirectory("/source/dir/sub", { dev: 2 });
    fileSystem.addFile("/source/dir/sub/c.txt", { size: 1, dev: 2 });
    const report = await analyze(fileSystem, ["/source/dir"]);
    // A disk that refuses some of it (an ACL, a flag): the copy gets the mode and dates.
    Object.assign(fileSystem, {
      copyMetadata: async (source: string) => {
        if (source === "/source/dir/sub") {
          throw Object.assign(new Error("ENOTSUP"), { code: "ENOTSUP" });
        }
      },
    });

    const result = await move(fileSystem, report);

    // Everything in it moved; the folder keeps what its copy couldn't take.
    expect(fileSystem.exists("/target/dir/sub/c.txt")).toBe(true);
    expect(fileSystem.exists("/source/dir/sub/c.txt")).toBe(false);
    expect(fileSystem.exists("/source/dir/sub")).toBe(true);
    expect(result.items).toContainEqual(
      expect.objectContaining({
        sourcePath: "/source/dir/sub",
        status: "failed",
        error:
          "Its items were moved, but the folder's own information (such as its tags) couldn't all be copied, so the original “sub” was kept.",
      }),
    );
  });
});
