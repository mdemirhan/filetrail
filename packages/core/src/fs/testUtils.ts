import { basename, dirname } from "node:path";

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
  rmdirImpl: WriteServiceFileSystem["rmdir"] | null = null;
  // The macOS default; tests of case-sensitive volumes set this to true.
  caseSensitive = false;
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
    // As macOS does, with the names as they are stored.
    return this.existingKey(path);
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
    const key = this.existingKey(path);
    if (!this.nodes.has(key)) {
      if (options?.force) {
        return;
      }
      throw createFsError("ENOENT", path);
    }
    const node = this.getNodeOrThrow(key);
    if (node.kind === "directory") {
      const children = this.listChildren(key);
      if (children.length > 0 && !options?.recursive) {
        throw createFsError("ENOTEMPTY", path);
      }
      for (const candidate of Array.from(this.nodes.keys())) {
        if (candidate === key || candidate.startsWith(`${key}/`)) {
          this.nodes.delete(candidate);
        }
      }
      return;
    }
    this.nodes.delete(key);
  }

  async rmdir(path: string): Promise<void> {
    if (this.rmdirImpl) {
      return this.rmdirImpl(path);
    }
    const node = this.getNodeOrThrow(path);
    if (node.kind !== "directory") {
      throw createFsError("ENOTDIR", path);
    }
    if (this.listChildren(path).length > 0) {
      throw createFsError("ENOTEMPTY", path);
    }
    this.nodes.delete(this.existingKey(path));
  }

  async isCaseSensitive(_path: string): Promise<boolean | null> {
    return this.caseSensitive;
  }

  /** Enables the `trash` method; trashed items are kept in `trashed`, and each is said to
   *  be at "/.Trash/<n>-<name>" (nothing is kept there). */
  readonly trashed: string[] = [];
  trashImpl: NonNullable<WriteServiceFileSystem["trash"]> | null = null;
  enableTrash(): void {
    const trashFn = async (path: string): Promise<string | null> => {
      if (this.trashImpl) {
        return this.trashImpl(path);
      }
      this.getNodeOrThrow(path);
      const key = this.existingKey(path);
      for (const candidate of Array.from(this.nodes.keys())) {
        if (candidate === key || candidate.startsWith(`${key}/`)) {
          this.nodes.delete(candidate);
        }
      }
      this.trashed.push(key);
      return `/.Trash/${this.trashed.length}-${basename(key)}`;
    };
    Object.defineProperty(this, "trash", {
      value: trashFn,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  async symlink(target: string, path: string): Promise<void> {
    if (this.symlinkImpl) {
      return this.symlinkImpl(target, path);
    }
    this.ensureDirectory(dirname(path), true);
    if (this.nodes.has(this.existingKey(path))) {
      throw createFsError("EEXIST", path);
    }
    this.nodes.set(this.newKey(path), this.createNode({ kind: "symlink", target, at: path }));
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
      return this.renameDirectly(oldPath, newPath);
    };
    Object.defineProperty(this, "rename", {
      value: renameFn,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  /** rename(2) as the mock does it, for a `renameImpl` that changes only some renames. */
  async renameDirectly(oldPath: string, newPath: string): Promise<void> {
    {
      const normalizedOld = this.existingKey(oldPath);
      const normalizedNew = this.newKey(newPath);
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
      // rename(2) replaces what was at the new name (stored, perhaps, in another case).
      const replacedKey = this.existingKey(newPath);
      for (const path of Array.from(this.nodes.keys())) {
        if (path === replacedKey || path.startsWith(`${replacedKey}/`)) {
          this.nodes.delete(path);
        }
      }

      // Insert new paths
      for (const [path, node] of pathsToMove) {
        const newNodePath =
          path === normalizedOld
            ? normalizedNew
            : `${normalizedNew}${path.slice(normalizedOld.length)}`;
        this.nodes.set(newNodePath, node);
      }
    }
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
      if (this.nodes.has(this.existingKey(destinationPath))) {
        throw createFsError("EEXIST", destinationPath);
      }
      this.nodes.set(
        this.newKey(destinationPath),
        this.createNode({
          at: destinationPath,
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
      const node = this.getNodeOrThrow(path);
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
      const node = this.getNodeOrThrow(path);
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
    if (this.nodes.has(this.existingKey(destinationPath))) {
      throw createFsError("EEXIST", destinationPath);
    }
    this.nodes.set(
      this.newKey(destinationPath),
      this.createNode({
        at: destinationPath,
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
    this.nodes.set(this.newKey(path), this.createNode({ kind: "file", at: path, ...options }));
  }

  addSymlink(
    path: string,
    target: string,
    options: Omit<Extract<SeedNode, { kind: "symlink" }>, "kind" | "target"> = {},
  ): void {
    this.ensureDirectory(dirname(path), true);
    this.nodes.set(
      this.newKey(path),
      this.createNode({ kind: "symlink", target, at: path, ...options }),
    );
  }

  mutateNode(path: string, updater: (node: MockNode) => MockNode | undefined): void {
    const normalized = this.existingKey(path);
    const node = this.getNodeOrThrow(normalized);
    const next = updater({ ...node }) ?? node;
    next.mtimeMs = this.bumpMtime();
    this.nodes.set(normalized, next);
  }

  setRealpath(path: string, realPath: string): void {
    this.realpathOverrides.set(normalizePath(path), normalizePath(realPath));
  }

  exists(path: string): boolean {
    return this.nodes.has(this.existingKey(path));
  }

  readNode(path: string): MockNode | null {
    return this.nodes.get(this.existingKey(path)) ?? null;
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
    const parent = this.existingKey(dirname(normalized));
    if (!this.nodes.has(parent)) {
      if (!recursive) {
        throw createFsError("ENOENT", parent);
      }
      this.ensureDirectory(parent, true);
    }
    const existing = this.nodes.get(this.existingKey(normalized));
    if (existing) {
      if (existing.kind !== "directory") {
        throw createFsError(recursive ? "ENOTDIR" : "EEXIST", normalized);
      }
      if (!recursive) {
        throw createFsError("EEXIST", normalized);
      }
      return;
    }
    this.nodes.set(
      this.newKey(normalized),
      this.createNode({ kind: "directory", at: normalized, ...options }),
    );
  }

  private listChildren(path: string): string[] {
    const normalized = this.existingKey(path);
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
    // Where the item goes: without a `dev` of its own it is on its folder's disk.
    at?: string;
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
      dev: input.dev ?? this.folderDev(input.at) ?? 1,
      target: input.target ?? null,
    };
  }

  // The key of the item at `path`, found the way the volume compares names: APFS ignores
  // how accented letters are encoded, and letter case unless the volume is case-sensitive.
  // A path to nothing gets the key a new item there would have.
  private existingKey(path: string): string {
    const normalized = normalizePath(path);
    if (this.nodes.has(normalized)) {
      return normalized;
    }
    const folded = this.foldName(normalized);
    for (const candidate of this.nodes.keys()) {
      if (this.foldName(candidate) === folded) {
        return candidate;
      }
    }
    return this.newKey(normalized);
  }

  // A new item's key: its folder as already stored, and its own name as given.
  private newKey(path: string): string {
    const normalized = normalizePath(path);
    if (normalized === "/") {
      return normalized;
    }
    const parent = dirname(normalized);
    const parentKey = parent === "/" ? "/" : this.existingKey(parent);
    return `${parentKey === "/" ? "" : parentKey}/${basename(normalized)}`;
  }

  private foldName(path: string): string {
    const decomposed = path.normalize("NFD");
    return this.caseSensitive ? decomposed : decomposed.toLowerCase();
  }

  private getNodeOrThrow(path: string): MockNode {
    const normalized = this.existingKey(path);
    const node = this.nodes.get(normalized);
    if (!node) {
      throw createFsError("ENOENT", normalized);
    }
    return node;
  }

  private folderDev(path: string | undefined): number | undefined {
    if (path === undefined || normalizePath(path) === "/") {
      return undefined;
    }
    return this.nodes.get(this.existingKey(dirname(normalizePath(path))))?.dev;
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
