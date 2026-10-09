import { basename, dirname } from "node:path";

import { buildCopyPasteAnalysisReport } from "./copyPasteAnalysis";
import { executeCopyPasteFromAnalysis } from "./copyPasteExecution";
import { resolveAnalysisWithPolicy } from "./copyPastePolicy";
import type {
  CopyPasteProgressEvent,
  WriteServiceFileSystem,
  WriteServiceStats,
} from "./writeServiceTypes";

// More items than V8 takes as the arguments of one call (`push(...items)` throws "Maximum
// call stack size exceeded" from about 124,000). Tests run on Electron's node, so a spread
// of this many items anywhere on the paste's path fails here.
const FILE_COUNT = 150_000;

// Padded, so the files come in the order they were made.
function fileName(index: number): string {
  return `file-${String(index).padStart(6, "0")}.txt`;
}

type FakeNode = { kind: "file" | "directory"; ino: number; size: number };

// A disk in memory that looks items up by their exact path: the mock in testUtils scans
// every item for a name it doesn't have, which is far too slow for this many.
function largeFolderFileSystem(): WriteServiceFileSystem {
  const nodes = new Map<string, FakeNode>();
  const children = new Map<string, string[]>();
  let nextIno = 10;
  const add = (path: string, kind: FakeNode["kind"], size = 0) => {
    nodes.set(path, { kind, ino: nextIno++, size });
    if (kind === "directory") {
      children.set(path, []);
    }
    if (path !== "/") {
      children.get(dirname(path))?.push(basename(path));
    }
  };
  const lookUp = (path: string): FakeNode => {
    const node = nodes.get(path);
    if (!node) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT", path });
    }
    return node;
  };
  const stats = (path: string): WriteServiceStats => {
    const node = lookUp(path);
    return {
      isDirectory: () => node.kind === "directory",
      isFile: () => node.kind === "file",
      isSymbolicLink: () => false,
      size: node.size,
      mode: node.kind === "directory" ? 0o755 : 0o644,
      mtimeMs: 1_000,
      ino: node.ino,
      dev: 1,
    };
  };
  const create = (path: string, kind: FakeNode["kind"], size = 0) => {
    if (nodes.has(path)) {
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: "EEXIST", path });
    }
    lookUp(dirname(path));
    add(path, kind, size);
  };

  add("/", "directory");
  add("/source", "directory");
  add("/source/project", "directory");
  add("/source/project/files", "directory");
  for (let index = 0; index < FILE_COUNT; index += 1) {
    add(`/source/project/files/${fileName(index)}`, "file", 1);
  }
  add("/target", "directory");

  return {
    lstat: async (path) => stats(path),
    stat: async (path) => stats(path),
    realpath: async (path) => {
      lookUp(path);
      return path;
    },
    readdir: async (path) => [...(children.get(path) ?? [])],
    readlink: async (path) => {
      throw Object.assign(new Error(`EINVAL: ${path}`), { code: "EINVAL", path });
    },
    isCaseSensitive: async () => true,
    mkdir: async (path) => create(path, "directory"),
    rm: async () => undefined,
    rmdir: async () => undefined,
    // A folder copied is built under a hidden name, then given its own.
    renameExclusive: async (from, to) => {
      if (nodes.has(to)) {
        throw Object.assign(new Error(`EEXIST: ${to}`), { code: "EEXIST", path: to });
      }
      for (const map of [nodes, children] as Map<string, unknown>[]) {
        for (const [path, value] of [...map]) {
          if (path === from || path.startsWith(`${from}/`)) {
            map.delete(path);
            map.set(`${to}${path.slice(from.length)}`, value);
          }
        }
      }
      const siblings = children.get(dirname(from)) ?? [];
      siblings.splice(siblings.indexOf(basename(from)), 1);
      children.get(dirname(to))?.push(basename(to));
    },
    getFlags: async () => 0,
    setFlags: async () => undefined,
    copyFile: async (sourcePath, destinationPath) =>
      create(destinationPath, "file", lookUp(sourcePath).size),
  };
}

describe("copying a folder with more items than one call takes as arguments", () => {
  it("analyzes and copies every item", async () => {
    const fileSystem = largeFolderFileSystem();
    const request = {
      mode: "copy" as const,
      sourcePaths: ["/source/project"],
      destinationDirectoryPath: "/target",
    };
    const report = await buildCopyPasteAnalysisReport({
      analysisId: "analysis-large",
      request,
      fileSystem,
      thresholds: { largeBatchItemThreshold: 100, largeBatchByteThreshold: 1000 },
    });
    expect(report.summary.totalNodeCount).toBe(FILE_COUNT + 2);

    const policy = { file: "skip", directory: "merge", mismatch: "skip" } as const;
    const resolvedNodes = await resolveAnalysisWithPolicy({ report, policy, fileSystem });
    let finished: CopyPasteProgressEvent | null = null;
    await executeCopyPasteFromAnalysis({
      operationId: "copy-large",
      report,
      mode: "copy",
      policy,
      fileSystem,
      now: () => new Date("2026-10-08T00:00:00.000Z"),
      signal: new AbortController().signal,
      resolvedNodes,
      emit: (event) => {
        if (event.result !== null) {
          finished = event;
        }
      },
      requestResolution: async () => null,
    });

    const result = (finished as CopyPasteProgressEvent | null)?.result;
    expect(result?.status).toBe("completed");
    // The folder, then each file in it.
    expect(result?.items).toHaveLength(FILE_COUNT + 1);
    expect(result?.items[0]?.destinationPath).toBe("/target/project");
    expect(result?.items.at(-1)?.destinationPath).toBe(
      `/target/project/files/${fileName(FILE_COUNT - 1)}`,
    );
    expect(await fileSystem.readdir("/target/project/files")).toHaveLength(FILE_COUNT);
  }, 60_000);
});
