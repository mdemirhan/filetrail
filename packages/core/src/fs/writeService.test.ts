import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type CopyPasteProgressEvent,
  WRITE_OPERATION_BUSY_ERROR,
  type WriteServiceFileSystem,
  createWriteService,
} from "./writeService";

describe("writeService", () => {
  it("plans same-directory copy/paste as duplicate naming instead of a conflict", async () => {
    const service = createWriteService({
      fileSystem: createMockFileSystem({
        existingPaths: [
          "/workspace",
          "/workspace/file.txt",
          "/workspace/file copy.txt",
        ],
        directoryPaths: ["/workspace"],
        fileSizes: {
          "/workspace/file.txt": 42,
          "/workspace/file copy.txt": 42,
        },
      }),
    });

    const plan = await service.planCopyPaste({
      mode: "copy",
      sourcePaths: ["/workspace/file.txt"],
      destinationDirectoryPath: "/workspace",
    });

    expect(plan.items).toEqual([
      expect.objectContaining({
        sourcePath: "/workspace/file.txt",
        destinationPath: "/workspace/file copy 2.txt",
        status: "ready",
      }),
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.issues).toEqual([]);
    expect(plan.canExecute).toBe(true);
  });

  it("keeps same-directory cut/paste blocked as a self-target", async () => {
    const service = createWriteService({
      fileSystem: createMockFileSystem({
        existingPaths: ["/workspace", "/workspace/file.txt"],
        directoryPaths: ["/workspace"],
        fileSizes: {
          "/workspace/file.txt": 42,
        },
      }),
    });

    const plan = await service.planCopyPaste({
      mode: "cut",
      sourcePaths: ["/workspace/file.txt"],
      destinationDirectoryPath: "/workspace",
    });

    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "same_path",
      }),
    ]);
    expect(plan.canExecute).toBe(false);
  });

  it("plans copy operations and blocks destination conflicts by default", async () => {
    const service = createWriteService({
      fileSystem: createMockFileSystem({
        existingPaths: ["/target", "/source/file.txt", "/target/file.txt"],
        directoryPaths: ["/target"],
        fileSizes: {
          "/source/file.txt": 42,
          "/target/file.txt": 42,
        },
      }),
    });

    const plan = await service.planCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
    });

    expect(plan.conflicts).toEqual([
      {
        sourcePath: "/source/file.txt",
        destinationPath: "/target/file.txt",
        reason: "destination_exists",
      },
    ]);
    expect(plan.canExecute).toBe(false);
  });

  it("allows skipping conflicts during planning", async () => {
    const service = createWriteService({
      fileSystem: createMockFileSystem({
        existingPaths: ["/target", "/source/file.txt", "/target/file.txt"],
        directoryPaths: ["/target"],
        fileSizes: {
          "/source/file.txt": 42,
          "/target/file.txt": 42,
        },
      }),
    });

    const plan = await service.planCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/file.txt"],
      destinationDirectoryPath: "/target",
      conflictResolution: "skip",
    });

    expect(plan.summary.skippedConflictCount).toBe(1);
    expect(plan.canExecute).toBe(false);
    expect(plan.conflicts).toHaveLength(1);
  });

  it("rejects copying a directory into its own child", async () => {
    const service = createWriteService({
      fileSystem: createMockFileSystem({
        existingPaths: ["/workspace/folder", "/workspace/folder/child"],
        directoryPaths: ["/workspace/folder", "/workspace/folder/child"],
        realPathMap: {
          "/workspace/folder": "/workspace/folder",
          "/workspace/folder/child": "/workspace/folder/child",
        },
      }),
    });

    const plan = await service.planCopyPaste({
      mode: "copy",
      sourcePaths: ["/workspace/folder"],
      destinationDirectoryPath: "/workspace/folder/child",
    });

    expect(plan.issues).toEqual([
      expect.objectContaining({
        code: "parent_into_child",
      }),
    ]);
    expect(plan.canExecute).toBe(false);
  });

  it("copies symlinks as links during execution", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-write-symlink-"));
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "target"), { recursive: true });
    await writeFile(join(root, "source", "actual.txt"), "hello", "utf8");
    await import("node:fs/promises").then(({ symlink }) =>
      symlink("actual.txt", join(root, "source", "alias.txt")),
    );

    const service = createWriteService({
      createOperationId: () => "symlink-op",
    });
    const events: CopyPasteProgressEvent[] = [];
    const unsubscribe = service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: [join(root, "source", "alias.txt")],
      destinationDirectoryPath: join(root, "target"),
    });

    await waitForTerminalEvent(events, "symlink-op");
    unsubscribe();

    expect(await readlink(join(root, "target", "alias.txt"))).toBe(
      "actual.txt",
    );
  });

  it("executes cut by copying first and removing the source after success", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-write-cut-"));
    await mkdir(join(root, "source"), { recursive: true });
    await mkdir(join(root, "target"), { recursive: true });
    await writeFile(join(root, "source", "notes.txt"), "hello", "utf8");

    const service = createWriteService({
      createOperationId: () => "cut-op",
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "cut",
      sourcePaths: [join(root, "source", "notes.txt")],
      destinationDirectoryPath: join(root, "target"),
    });

    const terminal = await waitForTerminalEvent(events, "cut-op");
    expect(terminal.result?.status).toBe("completed");
    await expect(
      readFile(join(root, "target", "notes.txt"), "utf8"),
    ).resolves.toBe("hello");
    await expect(lstat(join(root, "source", "notes.txt"))).rejects.toThrow();
  });

  it("supports cooperative cancellation and reports partial completion", async () => {
    const service = createWriteService({
      createOperationId: () => "cancel-op",
      fileSystem: createMockFileSystem({
        existingPaths: ["/target", "/source/one.txt", "/source/two.txt"],
        directoryPaths: ["/target"],
        fileSizes: {
          "/source/one.txt": 5,
          "/source/two.txt": 7,
        },
        copyFileStream: async (sourcePath, _destinationPath, signal) => {
          if (sourcePath.endsWith("one.txt")) {
            await Promise.resolve();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          signal?.throwIfAborted();
        },
      }),
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/one.txt", "/source/two.txt"],
      destinationDirectoryPath: "/target",
    });

    await vi.waitFor(() => {
      expect(
        events.some(
          (event) =>
            event.operationId === "cancel-op" && event.completedItemCount === 1,
        ),
      ).toBe(true);
    });
    expect(service.cancelOperation("cancel-op")).toEqual({ ok: true });

    const terminal = await waitForTerminalEvent(events, "cancel-op");
    expect(terminal.status).toBe("partial");
    expect(terminal.result?.summary.completedItemCount).toBe(1);
  });

  it("rejects starting a second write operation while one is already active", async () => {
    const service = createWriteService({
      createOperationId: (() => {
        let index = 0;
        return () => {
          index += 1;
          return `op-${index}`;
        };
      })(),
      fileSystem: createMockFileSystem({
        existingPaths: ["/target", "/source/one.txt", "/source/two.txt"],
        directoryPaths: ["/target"],
        fileSizes: {
          "/source/one.txt": 5,
          "/source/two.txt": 7,
        },
        copyFileStream: async (sourcePath, _destinationPath, signal) => {
          if (sourcePath.endsWith("one.txt")) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            signal?.throwIfAborted();
          }
          await Promise.resolve();
        },
      }),
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source/one.txt"],
      destinationDirectoryPath: "/target",
    });

    expect(() =>
      service.startCopyPaste({
        mode: "copy",
        sourcePaths: ["/source/two.txt"],
        destinationDirectoryPath: "/target",
      }),
    ).toThrow(WRITE_OPERATION_BUSY_ERROR);
  });

  it("copies nested directory trees on the real filesystem", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-write-tree-"));
    await mkdir(join(root, "source", "nested"), { recursive: true });
    await mkdir(join(root, "target"), { recursive: true });
    await writeFile(
      join(root, "source", "nested", "alpha.txt"),
      "alpha",
      "utf8",
    );
    await writeFile(join(root, "source", "beta.txt"), "beta", "utf8");

    const service = createWriteService({
      createOperationId: () => "tree-op",
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: [join(root, "source")],
      destinationDirectoryPath: join(root, "target"),
    });

    const terminal = await waitForTerminalEvent(events, "tree-op");
    expect(terminal.result?.status).toBe("completed");
    await expect(
      readFile(join(root, "target", "source", "nested", "alpha.txt"), "utf8"),
    ).resolves.toBe("alpha");
    await expect(
      readFile(join(root, "target", "source", "beta.txt"), "utf8"),
    ).resolves.toBe("beta");
    await expect(readdir(join(root, "target", "source"))).resolves.toEqual(
      expect.arrayContaining(["nested", "beta.txt"]),
    );
  });

  it("preserves file permissions including execute bits when copying", async () => {
    const root = await mkdtemp(join(tmpdir(), "filetrail-write-perms-"));
    await mkdir(join(root, "source", "bin"), { recursive: true });
    await mkdir(join(root, "target"), { recursive: true });
    await writeFile(
      join(root, "source", "bin", "run"),
      "#!/bin/sh\necho hi",
      "utf8",
    );
    await chmod(join(root, "source", "bin", "run"), 0o755);
    await writeFile(join(root, "source", "data.txt"), "hello", "utf8");

    const service = createWriteService({
      createOperationId: () => "perms-op",
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: [join(root, "source")],
      destinationDirectoryPath: join(root, "target"),
    });

    const terminal = await waitForTerminalEvent(events, "perms-op");
    expect(terminal.result?.status).toBe("completed");

    const executableStats = await stat(
      join(root, "target", "source", "bin", "run"),
    );
    // eslint-disable-next-line no-bitwise
    expect(executableStats.mode & 0o777).toBe(0o755);

    const dataStats = await stat(join(root, "target", "source", "data.txt"));
    // eslint-disable-next-line no-bitwise
    expect(dataStats.mode & 0o777).toBe(0o644);
  });

  it("treats unsupported chmod as non-fatal during copy", async () => {
    const service = createWriteService({
      createOperationId: () => "chmod-unsupported-op",
      fileSystem: createMockFileSystem({
        existingPaths: ["/target", "/source", "/source/run.sh"],
        directoryPaths: ["/target", "/source"],
        fileSizes: {
          "/source/run.sh": 11,
        },
        chmod: vi.fn(async () => {
          throw Object.assign(new Error("Operation not supported"), {
            code: "ENOTSUP",
          });
        }),
      }),
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: ["/source"],
      destinationDirectoryPath: "/target",
    });

    const terminal = await waitForTerminalEvent(events, "chmod-unsupported-op");
    expect(terminal.result?.status).toBe("completed");
  });

  it("duplicates a file when copy/paste targets the same directory", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "filetrail-write-duplicate-file-"),
    );
    await mkdir(join(root, "workspace"), { recursive: true });
    await writeFile(join(root, "workspace", "notes.txt"), "hello", "utf8");

    const service = createWriteService({
      createOperationId: () => "duplicate-file-op",
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: [join(root, "workspace", "notes.txt")],
      destinationDirectoryPath: join(root, "workspace"),
    });

    const terminal = await waitForTerminalEvent(events, "duplicate-file-op");
    expect(terminal.result?.status).toBe("completed");
    await expect(
      readFile(join(root, "workspace", "notes copy.txt"), "utf8"),
    ).resolves.toBe("hello");
  });

  it("duplicates a directory tree when copy/paste targets the same directory", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "filetrail-write-duplicate-dir-"),
    );
    await mkdir(join(root, "workspace", "source", "nested"), {
      recursive: true,
    });
    await writeFile(
      join(root, "workspace", "source", "nested", "alpha.txt"),
      "alpha",
      "utf8",
    );

    const service = createWriteService({
      createOperationId: () => "duplicate-dir-op",
    });
    const events: CopyPasteProgressEvent[] = [];
    service.subscribe((event) => {
      events.push(event);
    });

    service.startCopyPaste({
      mode: "copy",
      sourcePaths: [join(root, "workspace", "source")],
      destinationDirectoryPath: join(root, "workspace"),
    });

    const terminal = await waitForTerminalEvent(events, "duplicate-dir-op");
    expect(terminal.result?.status).toBe("completed");
    await expect(
      readFile(
        join(root, "workspace", "source copy", "nested", "alpha.txt"),
        "utf8",
      ),
    ).resolves.toBe("alpha");
  });
});

function createMockFileSystem(args: {
  existingPaths: string[];
  directoryPaths?: string[];
  fileSizes?: Record<string, number>;
  realPathMap?: Record<string, string>;
  symlinkTargets?: Record<string, string>;
  chmod?: WriteServiceFileSystem["chmod"];
  copyFileStream?: WriteServiceFileSystem["copyFileStream"];
}): WriteServiceFileSystem {
  const existingPaths = new Set(args.existingPaths);
  const directoryPaths = new Set(args.directoryPaths ?? []);
  const fileSizes = args.fileSizes ?? {};
  const realPathMap = args.realPathMap ?? {};
  const symlinkTargets = args.symlinkTargets ?? {};
  const childrenByDirectory = new Map<string, string[]>();

  for (const path of existingPaths) {
    const segments = path.split("/").filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      const parent = `/${segments.slice(0, index).join("/")}`;
      const child = segments[index]!;
      const existingChildren = childrenByDirectory.get(parent) ?? [];
      if (!existingChildren.includes(child)) {
        existingChildren.push(child);
      }
      childrenByDirectory.set(parent, existingChildren);
    }
  }

  return {
    lstat: vi.fn(async (path) => {
      if (!existingPaths.has(path)) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      }
      return fakeStats({
        directory: directoryPaths.has(path),
        symbolicLink: path in symlinkTargets,
        size: fileSizes[path] ?? 0,
      });
    }),
    stat: vi.fn(async (path) => {
      if (!existingPaths.has(path)) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      }
      return fakeStats({
        directory: directoryPaths.has(path),
        size: fileSizes[path] ?? 0,
      });
    }),
    realpath: vi.fn(async (path) => realPathMap[path] ?? path),
    readdir: vi.fn(async (path) =>
      (childrenByDirectory.get(path) ?? []).slice().sort(),
    ),
    readlink: vi.fn(async (path) => {
      const target = symlinkTargets[path];
      if (!target) {
        throw Object.assign(new Error(`EINVAL: ${path}`), { code: "EINVAL" });
      }
      return target;
    }),
    chmod: args.chmod ?? vi.fn(async () => {}),
    mkdir: vi.fn(async (path) => {
      existingPaths.add(path);
      directoryPaths.add(path);
    }),
    rm: vi.fn(async (path) => {
      existingPaths.delete(path);
      directoryPaths.delete(path);
    }),
    symlink: vi.fn(async (target, path) => {
      existingPaths.add(path);
      symlinkTargets[path] = target;
    }),
    copyFileStream:
      args.copyFileStream ??
      vi.fn(async (_sourcePath, destinationPath) => {
        existingPaths.add(destinationPath);
      }),
  };
}

function fakeStats(args: {
  directory?: boolean;
  symbolicLink?: boolean;
  size?: number;
  mode?: number;
}) {
  return {
    isDirectory: () => args.directory ?? false,
    isFile: () => !args.directory && !args.symbolicLink,
    isSymbolicLink: () => args.symbolicLink ?? false,
    size: args.size ?? 0,
    mode: args.mode ?? (args.directory ? 0o755 : 0o644),
  };
}

async function waitForTerminalEvent(
  events: CopyPasteProgressEvent[],
  operationId: string,
): Promise<CopyPasteProgressEvent> {
  await vi.waitFor(() => {
    expect(
      events.some(
        (event) =>
          event.operationId === operationId &&
          (event.status === "completed" ||
            event.status === "failed" ||
            event.status === "cancelled" ||
            event.status === "partial"),
      ),
    ).toBe(true);
  });
  return (
    events.findLast(
      (event) =>
        event.operationId === operationId &&
        (event.status === "completed" ||
          event.status === "failed" ||
          event.status === "cancelled" ||
          event.status === "partial"),
    ) ??
    (() => {
      throw new Error(`Missing terminal event for ${operationId}`);
    })()
  );
}
