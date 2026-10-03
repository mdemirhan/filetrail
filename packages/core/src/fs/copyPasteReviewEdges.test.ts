// What the review finds out before a paste, where the disk doesn't answer plainly: whether
// it tells letter case apart, what a Replace would delete when part of it can't be read,
// and how a very long name gets " copy".

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { detectCaseSensitivity, fitName } from "./copyPasteNames";
import { MockWriteServiceFileSystem } from "./testUtils";

function analyze(fileSystem: MockWriteServiceFileSystem, sourcePaths: string[]) {
  return buildCopyPasteAnalysisReport({
    analysisId: "analysis-review",
    request: { mode: "copy", sourcePaths, destinationDirectoryPath: "/target" },
    fileSystem,
    thresholds: { largeBatchItemThreshold: 1000, largeBatchByteThreshold: 100 },
  });
}

function withoutNativeAnswer(fileSystem: MockWriteServiceFileSystem) {
  Object.defineProperty(fileSystem, "isCaseSensitive", { value: undefined });
  return fileSystem;
}

describe("telling whether the destination minds letter case", () => {
  it("looks for itself when asking the volume fails", async () => {
    const fileSystem = new MockWriteServiceFileSystem({ "/target/Readme": { kind: "file" } });
    Object.defineProperty(fileSystem, "isCaseSensitive", {
      value: async () => {
        throw new Error("pathconf failed");
      },
    });

    await expect(detectCaseSensitivity(fileSystem, "/target")).resolves.toBe(false);
  });

  it("uses the folder's own name when the folder is empty or can't be listed", async () => {
    const sensitive = withoutNativeAnswer(
      new MockWriteServiceFileSystem({ "/Target": { kind: "directory" } }),
    );
    sensitive.caseSensitive = true;
    sensitive.readdirImpl = async () => {
      throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    };
    await expect(detectCaseSensitivity(sensitive, "/Target")).resolves.toBe(true);

    const insensitive = withoutNativeAnswer(
      new MockWriteServiceFileSystem({ "/Target": { kind: "directory" } }),
    );
    await expect(detectCaseSensitivity(insensitive, "/Target")).resolves.toBe(false);
  });

  it("skips names with no letters, and assumes the macOS default when nothing answers", async () => {
    const fileSystem = withoutNativeAnswer(
      new MockWriteServiceFileSystem({ "/2024/123.456": { kind: "file" } }),
    );
    await expect(detectCaseSensitivity(fileSystem, "/2024")).resolves.toBe(false);
  });

  it("can't tell from a lookup that gives no file ids, nor from one that fails", async () => {
    const noIds = withoutNativeAnswer(
      new MockWriteServiceFileSystem({ "/target/Readme": { kind: "file" } }),
    );
    const lstat = noIds.lstat.bind(noIds);
    noIds.lstatImpl = async (path) => {
      noIds.lstatImpl = null;
      try {
        const stats = await lstat(path);
        return { ...stats, ino: undefined } as unknown as Awaited<ReturnType<typeof lstat>>;
      } finally {
        noIds.lstatImpl = lookup;
      }
    };
    const lookup = noIds.lstatImpl;
    await expect(detectCaseSensitivity(noIds, "/target")).resolves.toBe(false);

    const failing = withoutNativeAnswer(
      new MockWriteServiceFileSystem({ "/target/Readme": { kind: "file" } }),
    );
    failing.lstatImpl = async (path) => {
      if (path.endsWith("rEADME")) {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      }
      failing.lstatImpl = null;
      try {
        return await failing.lstat(path);
      } finally {
        failing.lstatImpl = hook;
      }
    };
    const hook = failing.lstatImpl;
    await expect(detectCaseSensitivity(failing, "/target")).resolves.toBe(false);
  });
});

describe("what the review says a Replace would delete", () => {
  it("can't say when a folder inside the existing one can't be read", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/target/Docs/a.txt": { kind: "file", size: 1 },
      "/target/Docs/Private/secret.txt": { kind: "file", size: 1 },
    });
    const list = fileSystem.readdir.bind(fileSystem);
    fileSystem.readdirImpl = async (path) => {
      if (path === "/target/Docs/Private") {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      fileSystem.readdirImpl = null;
      try {
        return await list(path);
      } finally {
        fileSystem.readdirImpl = hook;
      }
    };
    const hook = fileSystem.readdirImpl;

    const report = await analyze(fileSystem, ["/source/Docs"]);

    expect(report.nodes[0]).toMatchObject({
      destinationOnly: null,
      destinationTotalNodeCount: null,
    });
  });

  // Finder writes .DS_Store into a folder just by showing it; it isn't anyone's item.
  it("doesn't count Finder's .DS_Store as an item a Replace would delete", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/Docs/a.txt": { kind: "file", size: 1 },
      "/target/Docs/.DS_Store": { kind: "file", size: 1 },
      "/target/Docs/a.txt": { kind: "file", size: 1 },
      "/target/Docs/Old/.DS_Store": { kind: "file", size: 1 },
    });

    const report = await analyze(fileSystem, ["/source/Docs"]);

    expect(report.nodes[0]).toMatchObject({
      destinationTotalNodeCount: 2,
      destinationOnly: { count: 1, samplePaths: ["Old"] },
    });
  });

  it("warns about a paste that is large by size, not only by count", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/source/big.bin": { kind: "file", size: 500 },
      "/target": { kind: "directory" },
    });

    const report = await analyze(fileSystem, ["/source/big.bin"]);

    expect(report.warnings.map((warning) => warning.code)).toContain("large_batch");
  });
});

describe("fitting a name", () => {
  it("keeps an absurdly long extension as part of the name", () => {
    const extension = `.${"x".repeat(260)}`;
    const name = fitName("report", " copy", extension);

    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255);
    expect(name.endsWith(" copy")).toBe(true);
  });
});
