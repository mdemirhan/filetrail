// For tests only: an in-memory disk for runBatchRename, copied from batchRenameExecution.test.ts
// and grown for tests that check where every item ended up.

import type { BatchRenameFs } from "./batchRenameExecution";

export type MemoryDiskCall = { op: "rename" | "renameExclusive"; from: string; to: string };

// An in-memory folder tree that compares names as a disk does (ignoring case unless told
// otherwise, and accent encoding always), refuses to replace with an exclusive rename, and
// fails on demand. Every item has an ino of its own, which moves with it; a folder's items
// move along with it.
export class MemoryDisk implements BatchRenameFs {
  private readonly folders = new Map<string, Map<string, { name: string; ino: number }>>();
  private nextIno = 10;
  readonly calls: string[] = [];
  // "rename:/from->/to" or "renameExclusive:/from->/to", or a path for lstat: the error to fail with.
  readonly failures = new Map<string, NodeJS.ErrnoException>();
  readonly lockedPaths = new Set<string>();
  /** Asked before every rename: an error to fail it with, or null to let it go ahead. */
  failWith: (call: MemoryDiskCall) => NodeJS.ErrnoException | null = () => null;
  /** Told after every rename that went ahead. */
  afterMove: (call: MemoryDiskCall) => void = () => undefined;

  constructor(
    files: string[],
    readonly caseSensitive = false,
  ) {
    for (const path of files) {
      this.add(path);
    }
  }

  add(path: string): number {
    const { folder, name } = split(path);
    const entries = this.folders.get(folder) ?? new Map();
    const ino = this.nextIno++;
    entries.set(this.key(name), { name, ino });
    this.folders.set(folder, entries);
    return ino;
  }

  names(folder = "/trip"): string[] {
    return [...(this.folders.get(folder)?.values() ?? [])].map((entry) => entry.name).sort();
  }

  /** Every item on the disk, by path. */
  entries(): Array<{ path: string; ino: number }> {
    const all: Array<{ path: string; ino: number }> = [];
    for (const [folder, contents] of this.folders) {
      for (const entry of contents.values()) {
        all.push({
          path: folder === "/" ? `/${entry.name}` : `${folder}/${entry.name}`,
          ino: entry.ino,
        });
      }
    }
    return all.sort((left, right) => left.path.localeCompare(right.path));
  }

  /** Where the item is now, or null when it is nowhere. */
  pathOf(ino: number): string | null {
    return this.entries().find((entry) => entry.ino === ino)?.path ?? null;
  }

  inoOf(path: string): number | null {
    return this.find(path)?.ino ?? null;
  }

  private key(name: string): string {
    const normalized = name.normalize("NFD");
    return this.caseSensitive ? normalized : normalized.toLowerCase();
  }

  private find(path: string) {
    const { folder, name } = split(path);
    return this.folders.get(folder)?.get(this.key(name)) ?? null;
  }

  lstat = async (path: string) => {
    this.calls.push(`lstat:${path}`);
    const failure = this.failures.get(`lstat:${path}`);
    if (failure) {
      throw failure;
    }
    const entry = this.find(path);
    if (!entry) {
      throw errno("ENOENT");
    }
    return { isDirectory: () => false, dev: 1, ino: entry.ino };
  };

  readdir = async (folder: string) => this.names(folder);

  getFlags = async (path: string) => (this.lockedPaths.has(path) ? 0x2 : 0);

  renameExclusive = async (from: string, to: string) => {
    this.calls.push(`renameExclusive:${from}->${to}`);
    const failure =
      this.failures.get(`renameExclusive:${from}->${to}`) ??
      this.failWith({ op: "renameExclusive", from, to });
    if (failure) {
      throw failure;
    }
    if (!this.find(from)) {
      throw errno("ENOENT");
    }
    if (this.find(to)) {
      throw errno("EEXIST");
    }
    this.move(from, to);
    this.afterMove({ op: "renameExclusive", from, to });
  };

  rename = async (from: string, to: string) => {
    this.calls.push(`rename:${from}->${to}`);
    const failure =
      this.failures.get(`rename:${from}->${to}`) ?? this.failWith({ op: "rename", from, to });
    if (failure) {
      throw failure;
    }
    if (!this.find(from)) {
      throw errno("ENOENT");
    }
    this.move(from, to);
    this.afterMove({ op: "rename", from, to });
  };

  private move(from: string, to: string): void {
    const source = split(from);
    const destination = split(to);
    const entry = this.find(from);
    this.folders.get(source.folder)?.delete(this.key(source.name));
    const entries = this.folders.get(destination.folder) ?? new Map();
    // A plain rename replaces what is there, as rename(2) does: its ino is lost.
    entries.set(this.key(destination.name), { name: destination.name, ino: entry?.ino ?? 0 });
    this.folders.set(destination.folder, entries);
    // A folder takes what is inside it along.
    for (const [path, contents] of [...this.folders]) {
      if (path === from || path.startsWith(`${from}/`)) {
        this.folders.delete(path);
        this.folders.set(`${to}${path.slice(from.length)}`, contents);
      }
    }
  }
}

export function split(path: string): { folder: string; name: string } {
  const slash = path.lastIndexOf("/");
  return { folder: slash <= 0 ? "/" : path.slice(0, slash), name: path.slice(slash + 1) };
}

export function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: test`), { code });
}

export type Random = {
  next: () => number;
  chance: (probability: number) => boolean;
  integer: (least: number, most: number) => number;
  pick: <T>(choices: readonly T[]) => T;
  shuffle: <T>(items: readonly T[]) => T[];
};

// mulberry32: small, fast, and the same numbers for the same seed everywhere.
export function random(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  const integer = (least: number, most: number) => least + Math.floor(next() * (most - least + 1));
  const pick = <T>(choices: readonly T[]): T => choices[integer(0, choices.length - 1)] as T;
  return {
    next,
    chance: (probability) => next() < probability,
    integer,
    pick,
    shuffle: (items) => {
      const shuffled = [...items];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const other = integer(0, index);
        [shuffled[index], shuffled[other]] = [shuffled[other] as never, shuffled[index] as never];
      }
      return shuffled;
    },
  };
}
