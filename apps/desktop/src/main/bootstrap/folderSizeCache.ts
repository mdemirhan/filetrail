import type { FolderSizeStats } from "./folderSizeAdjust";

// The folder sizes known. All are kept: a measurement's sizes are what the folders inside
// it show, and one let go would show none until the folder holding it is measured again.
// Measuring the home folder stores hundreds of thousands, so what a write changed is found
// from the paths it changed, not by looking at every size: each folder is listed under the
// folder holding it.
export class FolderSizeCache {
  private readonly sizes = new Map<string, FolderSizeStats>();
  // The paths directly in each folder that have a size, or hold one (see parentOf). A
  // folder is listed while it has a size or holds one, so walking down from a folder
  // finds every size inside it.
  private readonly children = new Map<string, Set<string>>();
  // The paths stored while a write runs (see startRecording); null when none runs.
  private recorded: Set<string> | null = null;

  get size(): number {
    return this.sizes.size;
  }

  has(path: string): boolean {
    return this.sizes.has(path);
  }

  get(path: string): FolderSizeStats | undefined {
    return this.sizes.get(path);
  }

  entries(): IterableIterator<[string, FolderSizeStats]> {
    return this.sizes.entries();
  }

  // A size measured.
  store(path: string, stats: FolderSizeStats): void {
    if (!this.sizes.has(path)) {
      this.link(path);
    }
    this.sizes.set(path, stats);
    this.recorded?.add(path);
  }

  // A size changed where it is kept (something taken off it), not as one measured.
  set(path: string, stats: FolderSizeStats): void {
    if (this.sizes.has(path)) {
      this.sizes.set(path, stats);
    } else {
      this.store(path, stats);
    }
  }

  delete(path: string): boolean {
    if (!this.sizes.delete(path)) {
      return false;
    }
    this.recorded?.delete(path);
    if (!this.children.has(path)) {
      this.unlink(path);
    }
    return true;
  }

  clear(): void {
    this.sizes.clear();
    this.children.clear();
    this.recorded?.clear();
  }

  // The sizes a change at `changedPaths` may have made wrong: of the folders holding one,
  // and of what is at or inside one (as isAffectedByChange). Each folder holding a change
  // is looked at once, and only the sizes inside a change are walked.
  forgetAffected(changedPaths: readonly string[]): void {
    const looked = new Set<string>();
    const forget = (holder: string) => {
      this.delete(holder);
    };
    for (const changed of changedPaths) {
      forEachHolder(changed, looked, forget);
      this.forgetAtOrInsideOne(changed);
    }
  }

  // The sizes of `paths` and of everything inside them.
  forgetAtOrInside(paths: readonly string[]): void {
    for (const path of paths) {
      this.forgetAtOrInsideOne(path);
    }
  }

  // From now on, what is stored is noted, until stopRecording: what was stored while a
  // write ran may have been measured after it removed something.
  startRecording(): void {
    this.recorded = new Set();
  }

  stopRecording(): void {
    this.recorded = null;
  }

  // How many sizes are noted (see startRecording): never more than are kept.
  get recordedCount(): number {
    return this.recorded?.size ?? 0;
  }

  // Of the sizes stored since startRecording, those of the folders holding one of `paths`
  // (and of `paths` themselves, with `atToo`), forgotten.
  forgetRecordedHolding(paths: readonly string[], atToo: boolean): void {
    const recorded = this.recorded;
    if (recorded === null || recorded.size === 0) {
      return;
    }
    const looked = new Set<string>();
    const forgetRecorded = (candidate: string) => {
      if (recorded.has(candidate)) {
        this.delete(candidate);
      }
    };
    for (const path of paths) {
      forEachHolder(path, looked, forgetRecorded);
      if (atToo) {
        forgetRecorded(path);
      }
    }
  }

  private forgetAtOrInsideOne(path: string): void {
    this.delete(path);
    // What is inside "/a/" is what is inside "/a".
    const folder = path.endsWith("/") ? path.slice(0, -1) : path;
    if (!this.children.has(folder)) {
      return;
    }
    for (const inside of this.inside(folder)) {
      this.delete(inside);
    }
  }

  // Every path with a size inside `folder` (not `folder` itself).
  private inside(folder: string): string[] {
    const found: string[] = [];
    const pending = [folder];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      for (const child of this.children.get(next) ?? []) {
        if (this.sizes.has(child)) {
          found.push(child);
        }
        pending.push(child);
      }
    }
    return found;
  }

  // Lists `path` under the folders holding it, as far up as one is listed already.
  private link(path: string): void {
    for (let current = path, parent = parentOf(current); parent !== null; ) {
      const listed = this.children.get(parent);
      if (listed) {
        listed.add(current);
        return;
      }
      this.children.set(parent, new Set([current]));
      if (this.sizes.has(parent)) {
        return;
      }
      current = parent;
      parent = parentOf(current);
    }
  }

  // Takes `path`, which no longer has a size or holds one, off the folders holding it, as
  // far up as they still have a size or hold another.
  private unlink(path: string): void {
    for (let current = path, parent = parentOf(current); parent !== null; ) {
      const listed = this.children.get(parent);
      if (!listed) {
        return;
      }
      listed.delete(current);
      if (listed.size > 0) {
        return;
      }
      this.children.delete(parent);
      if (this.sizes.has(parent)) {
        return;
      }
      current = parent;
      parent = parentOf(current);
    }
  }
}

// The folder a path is listed under: the part before its last "/" ("" for "/a", "/a" for
// "/a/" and "/a/b"). Everything inside a folder by isSameOrInside ("/a/", "/a/b", "/a//b")
// is found under it this way.
function parentOf(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index === -1 ? null : path.slice(0, index);
}

// Calls `visit` with the folders holding `path` by isSameOrInside, nearest first (as
// createChangeMatcher's holdsChange: each part before a "/", with and without it), leaving
// out those in `looked` and what holds them, which were visited already. Adds those it
// visits to `looked`.
function forEachHolder(path: string, looked: Set<string>, visit: (folder: string) => void) {
  for (let index = path.lastIndexOf("/"); index !== -1; ) {
    // Not the path itself, when it ends in "/".
    if (index + 1 < path.length) {
      visit(path.slice(0, index + 1));
    }
    const folder = path.slice(0, index);
    if (looked.has(folder)) {
      return;
    }
    looked.add(folder);
    visit(folder);
    index = index === 0 ? -1 : path.lastIndexOf("/", index - 1);
  }
}
