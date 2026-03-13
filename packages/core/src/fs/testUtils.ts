import { dirname } from "node:path";

import type { WriteServiceFileSystem, WriteServiceStats } from "./writeServiceTypes";

type SeedNode =
  | {
      kind: "file";
      size?: number;
      mode?: number;
      mtimeMs?: number;
      ino?: number;
      dev?: number;
    }
  | {
      kind: "directory";
      mode?: number;
      mtimeMs?: number;
      ino?: number;
      dev?: number;
    }
  | {
      kind: "symlink";
      target: string;
      mode?: number;
      mtimeMs?: number;
      ino?: number;
      dev?: number;
    };

type MockNode = {
  kind: "file" | "directory" | "symlink";
  size: number;
  mode: number;
  mtimeMs: number;
  ino: number;
  dev: number;
  target: string | null;
};

export type MockFileSystemSnapshotEntry =
  | {
      kind: "file";
      size: number;
      mode: number;
    }
  | {
      kind: "directory";
      mode: number;
    }
  | {
      kind: "symlink";
      mode: number;
      target: string;
    };

export class MockWriteServiceFileSystem implements WriteServiceFileSystem {
  readonly nodes = new Map<string, MockNode>();
  readonly realpathOverrides = new Map<string, string>();
  copyFileStreamImpl: WriteServiceFileSystem["copyFileStream"] | null = null;
  copyFileImpl: NonNullable<WriteServiceFileSystem["copyFile"]> | null = null;
  utimesImpl: NonNullable<WriteServiceFileSystem["utimes"]> | null = null;
  lutimesImpl: NonNullable<WriteServiceFileSystem["lutimes"]> | null = null;
  chmodImpl: WriteServiceFileSystem["chmod"] | null = null;
  renameImpl: NonNullable<WriteServiceFileSystem["rename"]> | null = null;
  mkdirImpl: WriteServiceFileSystem["mkdir"] | null = null;
  rmImpl: WriteServiceFileSystem["rm"] | null = null;
  symlinkImpl: WriteServiceFileSystem["symlink"] | null = null;
  readlinkImpl: WriteServiceFileSystem["readlink"] | null = null;
  lstatImpl: WriteServiceFileSystem["lstat"] | null = null;
  statImpl: WriteServiceFileSystem["stat"] | null = null;
  readdirImpl: WriteServiceFileSystem["readdir"] | null = null;
  realpathImpl: WriteServiceFileSystem["realpath"] | null = null;

  private nextIno = 10;
  private nextMtimeMs = 1_000;

  constructor(seed: Record<string, SeedNode> = {}) {
    this.addDirectory("/");
    for (const [path, node] of Object.entries(seed)) {
      if (node.kind === "directory") {
        this.addDirectory(path, node);
        continue;
      }
      if (node.kind === "file") {
        this.addFile(path, node);
        continue;
      }
      this.addSymlink(path, node.target, node);
    }
  }

  async lstat(path: string): Promise<WriteServiceStats> {
    if (this.lstatImpl) {
      return this.lstatImpl(path);
    }
    return toStats(this.getNodeOrThrow(path));
  }

  async stat(path: string): Promise<WriteServiceStats> {
    if (this.statImpl) {
      return this.statImpl(path);
    }
    const node = this.getNodeOrThrow(path);
    if (node.kind === "symlink") {
      const target = node.target;
      if (!target) {
        throw createFsError("ENOENT", path);
      }
      return toStats(this.getNodeOrThrow(target));
    }
    return toStats(node);
  }

  async realpath(path: string): Promise<string> {
    if (this.realpathImpl) {
      return this.realpathImpl(path);
    }
    if (this.realpathOverrides.has(path)) {
      return this.realpathOverrides.get(path) ?? path;
    }
    this.getNodeOrThrow(path);
    return path;
  }

  async readdir(path: string): Promise<string[]> {
    if (this.readdirImpl) {
      return this.readdirImpl(path);
    }
    const node = this.getNodeOrThrow(path);
    if (node.kind !== "directory") {
      throw createFsError("ENOTDIR", path);
    }
    return this.listChildren(path);
  }

  async readlink(path: string): Promise<string> {
    if (this.readlinkImpl) {
      return this.readlinkImpl(path);
    }
    const node = this.getNodeOrThrow(path);
    if (node.kind !== "symlink" || node.target === null) {
      throw createFsError("EINVAL", path);
    }
    return node.target;
  }

  async chmod(path: string, mode: number): Promise<void> {
    if (this.chmodImpl) {
      return this.chmodImpl(path, mode);
    }
    const node = this.getNodeOrThrow(path);
    node.mode = mode;
    node.mtimeMs = this.bumpMtime();
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (this.mkdirImpl) {
      return this.mkdirImpl(path, options);
    }
    this.ensureDirectory(path, Boolean(options?.recursive));
  }

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    if (this.rmImpl) {
      return this.rmImpl(path, options);
    }
    if (!this.nodes.has(path)) {
      if (options?.force) {
        return;
      }
      throw createFsError("ENOENT", path);
    }
    const node = this.getNodeOrThrow(path);
    if (node.kind === "directory") {
      const children = this.listChildren(path);
      if (children.length > 0 && !options?.recursive) {
        throw createFsError("ENOTEMPTY", path);
      }
      for (const candidate of Array.from(this.nodes.keys())) {
        if (candidate === path || candidate.startsWith(`${path}/`)) {
          this.nodes.delete(candidate);
        }
      }
      return;
    }
    this.nodes.delete(path);
  }

  async symlink(target: string, path: string): Promise<void> {
    if (this.symlinkImpl) {
      return this.symlinkImpl(target, path);
    }
    this.ensureDirectory(dirname(path), true);
    this.nodes.set(normalizePath(path), this.createNode({ kind: "symlink", target }));
  }

  /** Enables the `rename` method, opting this mock into same-filesystem rename support. */
  enableRename(): void {
    // Use Object.defineProperty to add the optional `rename` property without
    // conflicting with exactOptionalPropertyTypes (which forbids `T | undefined`
    // on optional interface members).
    const renameFn = async (oldPath: string, newPath: string): Promise<void> => {
      if (this.renameImpl) {
        return this.renameImpl(oldPath, newPath);
      }
      const normalizedOld = normalizePath(oldPath);
      const normalizedNew = normalizePath(newPath);
      const sourceNode = this.getNodeOrThrow(normalizedOld);

      // Check if cross-device (source dev vs destination parent dev)
      const destParent = dirname(normalizedNew);
      const parentNode = this.getNodeOrThrow(destParent);
      if (sourceNode.dev !== parentNode.dev) {
        throw createFsError("EXDEV", normalizedOld);
      }

      // Collect all paths under the source (for directories)
      const pathsToMove: [string, MockNode][] = [];
      for (const [path, node] of this.nodes.entries()) {
        if (path === normalizedOld || path.startsWith(`${normalizedOld}/`)) {
          pathsToMove.push([path, node]);
        }
      }

      // Delete old paths
      for (const [path] of pathsToMove) {
        this.nodes.delete(path);
      }

      // Insert new paths
      for (const [path, node] of pathsToMove) {
        const newNodePath =
          path === normalizedOld
            ? normalizedNew
            : `${normalizedNew}${path.slice(normalizedOld.length)}`;
        this.nodes.set(newNodePath, node);
      }
    };
    Object.defineProperty(this, "rename", {
      value: renameFn,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  /** Enables the `copyFile` method, opting this mock into native file copy support. */
  enableCopyFile(): void {
    const copyFileFn = async (sourcePath: string, destinationPath: string): Promise<void> => {
      if (this.copyFileImpl) {
        return this.copyFileImpl(sourcePath, destinationPath);
      }
      const source = this.getNodeOrThrow(sourcePath);
      if (source.kind !== "file") {
        throw createFsError("EISDIR", sourcePath);
      }
      this.ensureDirectory(dirname(destinationPath), true);
      this.nodes.set(
        normalizePath(destinationPath),
        this.createNode({
          kind: "file",
          size: source.size,
          mode: source.mode,
          mtimeMs: source.mtimeMs,
        }),
      );
    };
    Object.defineProperty(this, "copyFile", {
      value: copyFileFn,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  /** Enables the `utimes` method, opting this mock into timestamp preservation support. */
  enableUtimes(): void {
    const utimesFn = async (path: string, _atimeMs: number, mtimeMs: number): Promise<void> => {
      if (this.utimesImpl) {
        return this.utimesImpl(path, _atimeMs, mtimeMs);
      }
      const normalized = normalizePath(path);
      const node = this.getNodeOrThrow(normalized);
      node.mtimeMs = mtimeMs;
    };
    Object.defineProperty(this, "utimes", {
      value: utimesFn,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  /** Enables the `lutimes` method, opting this mock into symlink timestamp preservation support. */
  enableLutimes(): void {
    const lutimesFn = async (path: string, _atimeMs: number, mtimeMs: number): Promise<void> => {
      if (this.lutimesImpl) {
        return this.lutimesImpl(path, _atimeMs, mtimeMs);
      }
      const normalized = normalizePath(path);
      const node = this.getNodeOrThrow(normalized);
      node.mtimeMs = mtimeMs;
    };
    Object.defineProperty(this, "lutimes", {
      value: lutimesFn,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  async copyFileStream(
    sourcePath: string,
    destinationPath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.copyFileStreamImpl) {
      return this.copyFileStreamImpl(sourcePath, destinationPath, signal);
    }
    signal?.throwIfAborted();
    const source = this.getNodeOrThrow(sourcePath);
    if (source.kind !== "file") {
      throw new Error(`Cannot stream-copy non-file source: ${sourcePath}`);
    }
    this.ensureDirectory(dirname(destinationPath), true);
    this.nodes.set(
      normalizePath(destinationPath),
      this.createNode({
        kind: "file",
        size: source.size,
        mode: source.mode,
      }),
    );
  }

  addDirectory(
    path: string,
    options: Omit<Extract<SeedNode, { kind: "directory" }>, "kind"> = {},
  ): void {
    this.ensureDirectory(path, true, options);
  }

  addFile(path: string, options: Omit<Extract<SeedNode, { kind: "file" }>, "kind"> = {}): void {
    this.ensureDirectory(dirname(path), true);
    this.nodes.set(normalizePath(path), this.createNode({ kind: "file", ...options }));
  }

  addSymlink(
    path: string,
    target: string,
    options: Omit<Extract<SeedNode, { kind: "symlink" }>, "kind" | "target"> = {},
  ): void {
    this.ensureDirectory(dirname(path), true);
    this.nodes.set(normalizePath(path), this.createNode({ kind: "symlink", target, ...options }));
  }

  mutateNode(path: string, updater: (node: MockNode) => MockNode | undefined): void {
    const normalized = normalizePath(path);
    const node = this.getNodeOrThrow(normalized);
    const next = updater({ ...node }) ?? node;
    next.mtimeMs = this.bumpMtime();
    this.nodes.set(normalized, next);
  }

  setRealpath(path: string, realPath: string): void {
    this.realpathOverrides.set(normalizePath(path), normalizePath(realPath));
  }

  exists(path: string): boolean {
    return this.nodes.has(normalizePath(path));
  }

  readNode(path: string): MockNode | null {
    return this.nodes.get(normalizePath(path)) ?? null;
  }

  private ensureDirectory(
    path: string,
    recursive: boolean,
    options: Omit<Extract<SeedNode, { kind: "directory" }>, "kind"> = {},
  ): void {
    const normalized = normalizePath(path);
    if (normalized === "/") {
      if (!this.nodes.has("/")) {
        this.nodes.set("/", this.createNode({ kind: "directory", ...options }));
      }
      return;
    }
    const parent = dirname(normalized);
    if (!this.nodes.has(parent)) {
      if (!recursive) {
        throw createFsError("ENOENT", parent);
      }
      this.ensureDirectory(parent, true);
    }
    const existing = this.nodes.get(normalized);
    if (existing) {
      if (existing.kind !== "directory") {
        throw createFsError("ENOTDIR", normalized);
      }
      return;
    }
    this.nodes.set(normalized, this.createNode({ kind: "directory", ...options }));
  }

  private listChildren(path: string): string[] {
    const normalized = normalizePath(path);
    const prefix = normalized === "/" ? "/" : `${normalized}/`;
    const children = new Set<string>();
    for (const candidate of this.nodes.keys()) {
      if (candidate === normalized || !candidate.startsWith(prefix)) {
        continue;
      }
      const remainder = candidate.slice(prefix.length);
      const childName = remainder.split("/")[0];
      if (childName) {
        children.add(childName);
      }
    }
    return Array.from(children).sort();
  }

  private createNode(input: {
    kind: MockNode["kind"];
    size?: number;
    mode?: number;
    mtimeMs?: number;
    ino?: number;
    dev?: number;
    target?: string;
  }): MockNode {
    return {
      kind: input.kind,
      size: input.kind === "file" ? (input.size ?? 0) : 0,
      mode:
        input.mode ?? (input.kind === "directory" ? 0o755 : input.kind === "file" ? 0o644 : 0o777),
      mtimeMs: input.mtimeMs ?? this.bumpMtime(),
      ino: input.ino ?? this.nextIno++,
      dev: input.dev ?? 1,
      target: input.target ?? null,
    };
  }

  private getNodeOrThrow(path: string): MockNode {
    const normalized = normalizePath(path);
    const node = this.nodes.get(normalized);
    if (!node) {
      throw createFsError("ENOENT", normalized);
    }
    return node;
  }

  private bumpMtime(): number {
    this.nextMtimeMs += 1;
    return this.nextMtimeMs;
  }
}

function normalizePath(path: string): string {
  if (path === "/") {
    return path;
  }
  return path.replace(/\/+$/u, "") || "/";
}

function toStats(node: MockNode): WriteServiceStats {
  return {
    isDirectory: () => node.kind === "directory",
    isFile: () => node.kind === "file",
    isSymbolicLink: () => node.kind === "symlink",
    size: node.size,
    mode: node.mode,
    mtimeMs: node.mtimeMs,
    ino: node.ino,
    dev: node.dev,
  };
}

function createFsError(code: string, path: string): Error & { code: string; path: string } {
  return Object.assign(new Error(`${code}: ${path}`), { code, path });
}

export function snapshotMockFileSystem(
  fileSystem: MockWriteServiceFileSystem,
): Record<string, MockFileSystemSnapshotEntry> {
  return Object.fromEntries(
    [...fileSystem.nodes.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, node]) => [
        path,
        node.kind === "file"
          ? {
              kind: "file" as const,
              size: node.size,
              mode: node.mode,
            }
          : node.kind === "directory"
            ? {
                kind: "directory" as const,
                mode: node.mode,
              }
            : {
                kind: "symlink" as const,
                mode: node.mode,
                target: node.target ?? "",
              },
      ]),
  );
}
