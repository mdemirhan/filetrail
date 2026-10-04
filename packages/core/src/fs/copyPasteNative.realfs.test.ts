import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import { createStoppableCopyFile } from "./stoppableCopy";
import {
  type CopyPasteOperationResult,
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  type WriteServiceFileSystem,
} from "./writeServiceTypes";

// The paste engine on the app's native copy (copyfile(3)), as the app runs it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const native = require("../../../native-fs/index.js") as typeof import("../../../native-fs");

const nativeCopy = createStoppableCopyFile(native.nativeCopyFile);
const nativeFileSystem: WriteServiceFileSystem = {
  ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  renameExclusive: native.nativeRenameExclusive,
  isCaseSensitive: native.nativeIsCaseSensitive,
  getFlags: native.nativeGetFlags,
  setFlags: native.nativeSetFlags,
  copyFile: async (sourcePath, destinationPath, signal) => {
    await mkdir(dirname(destinationPath), { recursive: true });
    await nativeCopy(sourcePath, destinationPath, signal);
  },
  copyMetadata: native.nativeCopyMetadata,
};

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-native-paste-"));
  await mkdir(join(testDir, "src"));
  await mkdir(join(testDir, "dst"));
});

afterEach(async () => {
  execFileSync("chflags", ["-R", "nouchg", testDir]);
  execFileSync("chmod", ["-R", "u+rwx", testDir]);
  await rm(testDir, { recursive: true, force: true });
});

async function copy(sourcePaths: string[]): Promise<CopyPasteOperationResult> {
  const policy = { file: "skip", directory: "merge", mismatch: "skip" } as const;
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-native",
    request: { mode: "copy", sourcePaths, destinationDirectoryPath: join(testDir, "dst") },
    fileSystem: nativeFileSystem,
    thresholds: { largeBatchItemThreshold: 1000, largeBatchByteThreshold: 1e9 },
  });
  const resolvedNodes = await resolveAnalysisWithPolicy({
    report,
    policy,
    fileSystem: nativeFileSystem,
  });
  let result: CopyPasteOperationResult | null = null;
  await executeCopyPasteFromAnalysis({
    operationId: "op-native",
    report,
    mode: "copy",
    policy,
    fileSystem: nativeFileSystem,
    now: () => new Date(),
    signal: new AbortController().signal,
    resolvedNodes,
    emit: (event) => {
      result = event.result ?? result;
    },
    requestResolution: async () => null,
  });
  if (!result) {
    throw new Error("The paste reported no result.");
  }
  return result;
}

function tagsOf(path: string): string {
  return execFileSync("xattr", [path]).toString();
}

describe("paste on the native copy", () => {
  it("copies a locked file, and the copy stays locked", async () => {
    const source = join(testDir, "src", "locked.txt");
    await writeFile(source, "keep me");
    execFileSync("chflags", ["uchg", source]);

    const result = await copy([source]);

    expect(result.status).toBe("completed");
    const flags = execFileSync("ls", ["-lO", join(testDir, "dst", "locked.txt")]).toString();
    expect(flags).toContain("uchg");
  });

  it("keeps a folder's Finder tags, mode and date", async () => {
    const source = join(testDir, "src", "Tagged");
    await mkdir(source);
    await writeFile(join(source, "inside.txt"), "x");
    execFileSync("xattr", ["-w", "com.apple.metadata:_kMDItemUserTags", '("Red\\n6")', source]);
    await utimes(source, new Date("2020-01-02T03:04:05Z"), new Date("2020-01-02T03:04:05Z"));
    await chmod(source, 0o555);

    const result = await copy([source]);

    expect(result.status).toBe("completed");
    const copied = join(testDir, "dst", "Tagged");
    expect(tagsOf(copied)).toContain("com.apple.metadata:_kMDItemUserTags");
    expect((await stat(copied)).mode & 0o777).toBe(0o555);
    expect((await stat(copied)).mtime.toISOString()).toBe("2020-01-02T03:04:05.000Z");
    expect((await lstat(join(copied, "inside.txt"))).isFile()).toBe(true);
  });

  it("copies a locked folder with its items inside", async () => {
    const source = join(testDir, "src", "Vault");
    await mkdir(source);
    await writeFile(join(source, "a.txt"), "a");
    execFileSync("chflags", ["uchg", source]);

    const result = await copy([source]);

    expect(result.status).toBe("completed");
    expect((await lstat(join(testDir, "dst", "Vault", "a.txt"))).isFile()).toBe(true);
  });
});
