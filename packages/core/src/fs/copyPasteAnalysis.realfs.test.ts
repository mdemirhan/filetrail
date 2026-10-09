// What the analysis of a paste finds on the real disk that a mock can't show: macOS paths
// that name one folder by two spellings.

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { nativeFileSystem } from "./testNativePaste";

// The data volume, where the firmlinked folders (/Users, /private) really are.
const DATA_VOLUME = "/System/Volumes/Data";

let testDir: string;

beforeEach(async () => {
  testDir = await realpath(await mkdtemp(join(tmpdir(), "filetrail-analysis-")));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// The temporary folder is under /private (or /Users), a firmlink: its real path keeps
// whichever spelling it is given.
it.runIf(existsSync(DATA_VOLUME))(
  "refuses to paste a folder into its own inside spelled through the data volume",
  async (context) => {
    if (!existsSync(join(DATA_VOLUME, testDir))) {
      context.skip();
    }
    await mkdir(join(testDir, "A", "sub"), { recursive: true });
    const destination = join(DATA_VOLUME, testDir, "A", "sub");
    // The case this is about: the two real paths don't show one holds the other.
    expect(await realpath(destination)).toBe(destination);

    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-1",
      request: {
        mode: "copy",
        sourcePaths: [join(testDir, "A")],
        destinationDirectoryPath: destination,
      },
      fileSystem: nativeFileSystem,
      thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1000 },
    });

    expect(report.issues).toEqual([expect.objectContaining({ code: "parent_into_child" })]);
    expect(report.nodes).toEqual([]);
  },
);
