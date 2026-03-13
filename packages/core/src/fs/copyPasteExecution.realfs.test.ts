import { lstat, mkdtemp, rm, symlink, writeFile, mkdir, readFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import {
  DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
  type WriteServiceFileSystem,
} from "./writeServiceTypes";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-realfs-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function createResolvedOperationRealFs(args: {
  fileSystem: WriteServiceFileSystem;
  mode: "copy" | "cut";
  sourcePaths: string[];
  destinationDirectoryPath: string;
  policy?: {
    file: "overwrite" | "skip" | "keep_both";
    directory: "overwrite" | "merge" | "skip" | "keep_both";
    mismatch: "overwrite" | "skip" | "keep_both";
  };
}) {
  const report = await buildCopyPasteAnalysisReport({
    analysisId: "analysis-realfs",
    request: {
      mode: args.mode,
      sourcePaths: args.sourcePaths,
      destinationDirectoryPath: args.destinationDirectoryPath,
    },
    fileSystem: args.fileSystem,
    thresholds: {
      largeBatchItemThreshold: 100,
      largeBatchByteThreshold: 10000,
    },
  });
  const resolvedNodes = await resolveAnalysisWithPolicy({
    report,
    policy: args.policy ?? {
      file: "skip",
      directory: "merge",
      mismatch: "skip",
    },
    fileSystem: args.fileSystem,
  });
  return { report, resolvedNodes };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("copyPasteExecution real filesystem", () => {
  describe("per-file cut flow", () => {
    it("cut moves file — source gone, destination present with correct content", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcDir, "hello.txt"), "hello world");

      const fileSystem = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "cut",
        sourcePaths: [join(srcDir, "hello.txt")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-cut-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(await fileExists(join(srcDir, "hello.txt"))).toBe(false);
      expect(await fileExists(join(dstDir, "hello.txt"))).toBe(true);
      const content = await readFile(join(dstDir, "hello.txt"), "utf-8");
      expect(content).toBe("hello world");
    });

    it("mid-cancel cut leaves clean partition on real filesystem", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      const fileNames = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
      for (const name of fileNames) {
        await writeFile(join(srcDir, name), `content of ${name}`);
      }

      const controller = new AbortController();
      let copyCount = 0;
      // Disable rename so the copy+delete path is exercised
      const { rename: _, ...baseFs } = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const fileSystem: WriteServiceFileSystem = {
        ...baseFs,
        copyFileStream: async (sourcePath, destinationPath, signal) => {
          signal?.throwIfAborted();
          copyCount++;
          await DEFAULT_WRITE_SERVICE_FILE_SYSTEM.copyFileStream(
            sourcePath,
            destinationPath,
            signal,
          );
          if (copyCount === 3) {
            controller.abort();
          }
        },
      };

      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "cut",
        sourcePaths: fileNames.map((n) => join(srcDir, n)),
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-cut-cancel-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: controller.signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // First 3 files: at destination only
      for (const name of fileNames.slice(0, 3)) {
        expect(await fileExists(join(srcDir, name))).toBe(false);
        expect(await fileExists(join(dstDir, name))).toBe(true);
      }
      // Remaining files: at source only
      for (const name of fileNames.slice(3)) {
        expect(await fileExists(join(srcDir, name))).toBe(true);
        expect(await fileExists(join(dstDir, name))).toBe(false);
      }
    });

    it("cut preserves source when externally modified during copy", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcDir, "data.txt"), "original");

      // Disable rename so the copy+delete path is exercised
      const { rename: _r, ...baseFsCut } = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const fileSystem: WriteServiceFileSystem = {
        ...baseFsCut,
        copyFileStream: async (sourcePath, destinationPath, signal) => {
          await DEFAULT_WRITE_SERVICE_FILE_SYSTEM.copyFileStream(
            sourcePath,
            destinationPath,
            signal,
          );
          // Mutate source after copy completes
          await writeFile(sourcePath, "modified after copy");
        },
      };

      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "cut",
        sourcePaths: [join(srcDir, "data.txt")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-cut-preserve-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // Source preserved because it was modified
      expect(await fileExists(join(srcDir, "data.txt"))).toBe(true);
      const sourceContent = await readFile(join(srcDir, "data.txt"), "utf-8");
      expect(sourceContent).toBe("modified after copy");
      // Destination has the original content
      expect(await fileExists(join(dstDir, "data.txt"))).toBe(true);
      const destContent = await readFile(join(dstDir, "data.txt"), "utf-8");
      expect(destContent).toBe("original");
    });
  });

  describe("same-filesystem rename optimization", () => {
    it("rename within same tmpdir preserves inode", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcDir, "data.txt"), "rename test content");

      const srcStat = await stat(join(srcDir, "data.txt"));
      const originalIno = srcStat.ino;

      const fileSystem = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "cut",
        sourcePaths: [join(srcDir, "data.txt")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-rename-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(await fileExists(join(srcDir, "data.txt"))).toBe(false);
      expect(await fileExists(join(dstDir, "data.txt"))).toBe(true);
      const content = await readFile(join(dstDir, "data.txt"), "utf-8");
      expect(content).toBe("rename test content");
      // Same inode = atomic rename, not copy
      const dstStat = await stat(join(dstDir, "data.txt"));
      expect(dstStat.ino).toBe(originalIno);
    });

    it("rename preserves mtime on real filesystem (file)", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcDir, "timed.txt"), "mtime test");
      // Set a specific mtime in the past
      const targetMtime = new Date("2020-06-15T10:30:00.000Z");
      await utimes(join(srcDir, "timed.txt"), targetMtime, targetMtime);

      const fileSystem = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "cut",
        sourcePaths: [join(srcDir, "timed.txt")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-rename-mtime-1",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(await fileExists(join(srcDir, "timed.txt"))).toBe(false);
      const dstStat = await stat(join(dstDir, "timed.txt"));
      // Rename preserves mtime exactly
      expect(Math.abs(dstStat.mtimeMs - targetMtime.getTime())).toBeLessThan(1000);
    });
  });

  describe("utimes timestamp preservation", () => {
    it("copy preserves mtime for directories via utimes", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      const srcSubDir = join(srcDir, "subdir");
      await mkdir(srcSubDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcSubDir, "child.txt"), "hello");

      // Set a specific mtime on the source directory
      const targetMtime = new Date("2019-03-20T08:00:00.000Z");
      await utimes(srcSubDir, targetMtime, targetMtime);

      const fileSystem = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "copy",
        sourcePaths: [srcSubDir],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-utimes-dir-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      const dstSubDir = join(dstDir, "subdir");
      expect(await fileExists(dstSubDir)).toBe(true);
      const dstStat = await stat(dstSubDir);
      expect(Math.abs(dstStat.mtimeMs - targetMtime.getTime())).toBeLessThan(1000);
    });

    it("copy preserves mtime for symlinks via utimes", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });

      // Create a symlink (target doesn't need to exist for the symlink itself)
      const targetPath = join(srcDir, "target.txt");
      await writeFile(targetPath, "target content");
      await symlink(targetPath, join(srcDir, "link"));

      const fileSystem = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "copy",
        sourcePaths: [join(srcDir, "link")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-utimes-symlink-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      const dstLink = join(dstDir, "link");
      expect(await fileExists(dstLink)).toBe(true);
      const dstStat = await lstat(dstLink);
      expect(dstStat.isSymbolicLink()).toBe(true);
    });

    it("copy preserves file content and mtime via copyFileStream + utimes", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcDir, "doc.txt"), "file mtime test content");

      // Set a specific mtime
      const targetMtime = new Date("2018-01-15T12:00:00.000Z");
      await utimes(join(srcDir, "doc.txt"), targetMtime, targetMtime);

      // Use FS without rename or copyFile — exercises copyFileStream + utimes path
      const { rename: _, copyFile: _c, ...baseFs } = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const fileSystem: WriteServiceFileSystem = { ...baseFs };

      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "copy",
        sourcePaths: [join(srcDir, "doc.txt")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-utimes-file-1",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      const dstFile = join(dstDir, "doc.txt");
      expect(await fileExists(dstFile)).toBe(true);
      const content = await readFile(dstFile, "utf-8");
      expect(content).toBe("file mtime test content");
    });
  });

  describe("cross-phase integration", () => {
    it("rename + inline cut: no copy, source moved atomically", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcDir, "atom.txt"), "atomic move");

      const srcStat = await stat(join(srcDir, "atom.txt"));
      const originalIno = srcStat.ino;

      let copyStreamCalled = false;
      const fileSystem: WriteServiceFileSystem = {
        ...DEFAULT_WRITE_SERVICE_FILE_SYSTEM,
        copyFileStream: async () => {
          copyStreamCalled = true;
        },
      };

      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "cut",
        sourcePaths: [join(srcDir, "atom.txt")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-integration-rename-cut",
        report,
        mode: "cut",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      expect(copyStreamCalled).toBe(false);
      expect(await fileExists(join(srcDir, "atom.txt"))).toBe(false);
      expect(await fileExists(join(dstDir, "atom.txt"))).toBe(true);
      const dstStat = await stat(join(dstDir, "atom.txt"));
      expect(dstStat.ino).toBe(originalIno);
    });

    it("copy mode with utimes: source preserved, destination has content", async () => {
      const srcDir = join(testDir, "src");
      const dstDir = join(testDir, "dst");
      await mkdir(srcDir, { recursive: true });
      await mkdir(dstDir, { recursive: true });
      await writeFile(join(srcDir, "keep.txt"), "keep me");

      const fileSystem = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
      const { report, resolvedNodes } = await createResolvedOperationRealFs({
        fileSystem,
        mode: "copy",
        sourcePaths: [join(srcDir, "keep.txt")],
        destinationDirectoryPath: dstDir,
      });

      await executeCopyPasteFromAnalysis({
        operationId: "realfs-integration-copy-utimes",
        report,
        mode: "copy",
        policy: { file: "skip", directory: "merge", mismatch: "skip" },
        fileSystem,
        now: () => new Date(),
        signal: new AbortController().signal,
        resolvedNodes,
        emit: () => undefined,
        requestResolution: async () => null,
      });

      // Source preserved in copy mode
      expect(await fileExists(join(srcDir, "keep.txt"))).toBe(true);
      expect(await fileExists(join(dstDir, "keep.txt"))).toBe(true);
      const content = await readFile(join(dstDir, "keep.txt"), "utf-8");
      expect(content).toBe("keep me");
    });
  });
});
