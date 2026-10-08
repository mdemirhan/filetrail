import { describe, expect, it } from "vitest";

import { isAffectedByChange } from "@filetrail/contracts";

import type { FolderSizeStats } from "./folderSizeAdjust";
import { FolderSizeCache } from "./folderSizeCache";

function stats(sizeBytes: number): FolderSizeStats {
  return { sizeBytes, diskBytes: sizeBytes, fileCount: 1, folderCount: 0, dev: 16, measurement: 1 };
}

// A small random generator, so a failure can be run again from its seed.
function randomGenerator(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % limit;
  };
}

function randomPaths(next: (limit: number) => number, count: number): string[] {
  const names = ["a", "b", "ab", "a b", ".Trash"];
  return Array.from({ length: count }, () => {
    const depth = next(5);
    let path = "";
    for (let level = 0; level < depth; level++) {
      path += `/${names[next(names.length)]}`;
    }
    // Now and then the odd forms a path can be written in.
    const form = next(12);
    return path === "" ? "/" : form === 0 ? `${path}/` : form === 1 ? `/${path}` : path;
  });
}

function isAtOrInside(path: string, folder: string): boolean {
  const prefix = folder.endsWith("/") ? folder : `${folder}/`;
  return path === folder || path.startsWith(prefix);
}

// The sizes kept, after random stores, changes and deletes of `paths`.
function randomCache(seed: number) {
  const next = randomGenerator(seed);
  const cache = new FolderSizeCache();
  const paths = randomPaths(next, 60);
  for (let step = 0; step < 80; step++) {
    const path = paths[next(paths.length)] as string;
    const action = next(10);
    if (action < 7) {
      cache.store(path, stats(step));
    } else if (action < 8) {
      cache.set(path, stats(step));
    } else {
      cache.delete(path);
    }
  }
  return { cache, next, kept: () => [...cache.entries()].map(([path]) => path).sort() };
}

describe("FolderSizeCache", () => {
  it("forgets what a change touched as looking at every size does", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { cache, next, kept } = randomCache(seed);
      const changed = randomPaths(next, 1 + (seed % 6));
      const expected = kept().filter((path) => !isAffectedByChange(path, changed));

      cache.forgetAffected(changed);

      expect(kept(), `seed ${seed}, ${JSON.stringify(changed)}`).toEqual(expected);
    }
  });

  it("forgets what is at or inside paths as looking at every size does", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { cache, next, kept } = randomCache(seed);
      const removed = randomPaths(next, 1 + (seed % 4));
      const expected = kept().filter((path) => !removed.some((gone) => isAtOrInside(path, gone)));

      cache.forgetAtOrInside(removed);

      expect(kept(), `seed ${seed}, ${JSON.stringify(removed)}`).toEqual(expected);
    }
  });

  it("finds what is inside a folder again after sizes come and go", () => {
    const cache = new FolderSizeCache();
    cache.store("/Users/demo/a/b/c", stats(1));
    cache.store("/Users/demo/a", stats(2));
    cache.delete("/Users/demo/a");
    cache.store("/Users/demo/a/b", stats(3));
    cache.delete("/Users/demo/a/b/c");
    cache.store("/Users/demo/a/b/c/d", stats(4));
    cache.set("/Users/demo/x", stats(5));

    cache.forgetAffected(["/Users/demo/a"]);

    expect([...cache.entries()].map(([path]) => path)).toEqual(["/Users/demo/x"]);
    cache.forgetAffected(["/"]);
    expect(cache.size).toBe(0);
  });

  // A home folder's walk stores 176,000 sizes. With a limit of 100,000, the folders it
  // finished first (small ones directly in the home folder among them) were let go, and
  // showed no size until the home folder was measured again.
  it("keeps every size stored, quickly", () => {
    const cache = new FolderSizeCache();
    const started = performance.now();
    for (let index = 0; index < 400_000; index++) {
      cache.store(`/Users/demo/Library/c${index % 400}/d${index}`, stats(index));
    }
    // Well under a second on a laptop.
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(cache.size).toBe(400_000);
    expect(cache.has("/Users/demo/Library/c0/d0")).toBe(true);
  });

  describe("while a write runs", () => {
    it("forgets, of the sizes stored meanwhile, those of the folders holding what it removed", () => {
      const cache = new FolderSizeCache();
      cache.store("/Users/demo/Work", stats(1));
      cache.startRecording();
      for (const path of [
        "/Users/demo/Projects",
        "/Users/demo/Projects/app",
        "/Users/demo/Music",
      ]) {
        cache.store(path, stats(2));
      }

      cache.forgetRecordedHolding(["/Users/demo/Projects/app/a.txt", "/Users/demo/Work/b"], false);

      expect([...cache.entries()].map(([path]) => path).sort()).toEqual([
        "/Users/demo/Music",
        "/Users/demo/Work",
      ]);
      cache.forgetRecordedHolding(["/Users/demo/Music"], true);
      expect(cache.has("/Users/demo/Music")).toBe(false);
    });

    // Every size stored after the first write was noted until the next one started: 70 MB
    // for a million.
    it("notes only what is stored until it ends, and lets go of what goes", () => {
      const cache = new FolderSizeCache();
      cache.store("/before", stats(1));
      cache.startRecording();
      for (let index = 0; index < 30; index++) {
        cache.store(`/f${index}`, stats(index));
      }
      expect(cache.recordedCount).toBe(30);
      cache.delete("/f29");
      expect(cache.recordedCount).toBe(29);

      cache.stopRecording();
      cache.store("/after", stats(1));
      expect(cache.recordedCount).toBe(0);
      cache.forgetRecordedHolding(["/after/x"], false);
      expect(cache.has("/after")).toBe(true);
    });
  });
});
