import {
  createChangeMatcher,
  isAffectedByChange,
  isFollowedMove,
  itemsForOtherWindows,
  pathsChangedByWrite,
} from "./writeEffects";

describe("pathsChangedByWrite", () => {
  it("lists the folder written into and every item moved, made or removed", () => {
    expect(
      pathsChangedByWrite({
        targetPath: "/Users/demo/Dest",
        items: [
          { sourcePath: "/Users/demo/a.txt", destinationPath: "/Users/demo/Dest/a.txt" },
          { sourcePath: "/Users/demo/Old", destinationPath: null },
        ],
      }).sort(),
    ).toEqual([
      "/Users/demo/Dest",
      "/Users/demo/Dest/a.txt",
      "/Users/demo/Old",
      "/Users/demo/a.txt",
    ]);
  });
});

describe("isAffectedByChange", () => {
  const changed = ["/Users/demo/Projects/app"];

  it("covers the item, what holds it, and what is inside it", () => {
    expect(isAffectedByChange("/Users/demo/Projects/app", changed)).toBe(true);
    expect(isAffectedByChange("/Users/demo/Projects", changed)).toBe(true);
    expect(isAffectedByChange("/", changed)).toBe(true);
    expect(isAffectedByChange("/Users/demo/Projects/app/src", changed)).toBe(true);
  });

  it("leaves folders beside it alone", () => {
    expect(isAffectedByChange("/Users/demo/Projects/application", changed)).toBe(false);
    expect(isAffectedByChange("/Users/demo/Music", changed)).toBe(false);
  });
});

describe("createChangeMatcher", () => {
  // The answers it must give, worked out one change at a time.
  function holdsAny(path: string, changed: readonly string[]): boolean {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    return changed.some((candidate) => candidate.startsWith(prefix));
  }
  function isAtOrInsideAny(path: string, changed: readonly string[]): boolean {
    return changed.some((folder) => {
      const prefix = folder.endsWith("/") ? folder : `${folder}/`;
      return path === folder || path.startsWith(prefix);
    });
  }

  // A small random generator, so a failure can be run again from its seed.
  function randomPaths(seed: number, count: number): string[] {
    let state = seed;
    const next = (limit: number) => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state % limit;
    };
    const names = ["a", "b", "ab", "a b", ".Trash", "é"];
    return Array.from({ length: count }, () => {
      const depth = next(5);
      let path = "";
      for (let level = 0; level < depth; level++) {
        path += `/${names[next(names.length)]}`;
      }
      // Now and then the odd forms a path can be written in.
      const form = next(10);
      return path === "" ? "/" : form === 0 ? `${path}/` : form === 1 ? `/${path}` : path;
    });
  }

  it("answers as asking about each change in turn does", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const changed = randomPaths(seed, 1 + (seed % 7));
      const matcher = createChangeMatcher(changed);
      for (const path of randomPaths(seed * 7_919, 40)) {
        expect(
          {
            holds: matcher.holdsChange(path),
            atOrInside: matcher.isAtOrInsideChange(path),
            affected: matcher.isAffected(path),
          },
          `seed ${seed}, ${JSON.stringify(path)} against ${JSON.stringify(changed)}`,
        ).toEqual({
          holds: holdsAny(path, changed),
          atOrInside: isAtOrInsideAny(path, changed),
          affected: isAffectedByChange(path, changed),
        });
      }
    }
  });

  it("covers the change, what holds it and what is inside it, and nothing beside it", () => {
    const matcher = createChangeMatcher(["/Users/demo/Projects/app"]);
    expect(matcher.holdsChange("/Users/demo/Projects")).toBe(true);
    expect(matcher.holdsChange("/")).toBe(true);
    expect(matcher.holdsChange("/Users/demo/Projects/app")).toBe(false);
    expect(matcher.isAtOrInsideChange("/Users/demo/Projects/app")).toBe(true);
    expect(matcher.isAtOrInsideChange("/Users/demo/Projects/app/src")).toBe(true);
    expect(matcher.isAffected("/Users/demo/Projects/application")).toBe(false);
    expect(matcher.isAffected("/Users/demo/Music")).toBe(false);
  });

  // 50,000 cached sizes against 5,000 changes took seconds asked one change at a time.
  it("answers for many paths against many changes quickly", () => {
    const changed = Array.from(
      { length: 5_000 },
      (_, index) => `/Users/demo/Projects/p${index % 50}/src/file${index}.ts`,
    );
    const cached = Array.from(
      { length: 50_000 },
      (_, index) => `/Users/demo/Library/Caches/c${index % 500}/d${index}/e`,
    );
    const started = performance.now();
    const matcher = createChangeMatcher(changed);
    const affected = cached.filter((path) => matcher.isAffected(path));
    // Well under 100 ms on a laptop; the bound only catches going back to every pair.
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(affected).toEqual([]);
  });
});

describe("itemsForOtherWindows", () => {
  const item = (
    sourcePath: string | null,
    destinationPath: string | null,
    status = "completed",
  ) => ({
    sourcePath,
    destinationPath,
    status,
  });

  it("leaves out an item in a folder already known to hold what changed", () => {
    const items = [
      item("/a/F", "/b/F"),
      item("/a/F/x", "/b/F/x"),
      item("/a/F/y", "/b/F/y"),
      item("/a/F/z", null),
    ];
    expect(itemsForOtherWindows({ action: "paste", targetPath: "/b", items })).toEqual(
      items.slice(0, 2),
    );
  });

  it("takes a change written with a trailing slash as holding what is inside it", () => {
    const items = [item("/b/x", null), item("/b/y", null)];
    expect(itemsForOtherWindows({ action: "trash", targetPath: "/b/", items })).toEqual([]);
  });

  it("keeps an item a tab would follow on its own", () => {
    const items = [item("/a/F", "/b/F", "failed"), item("/a/F/x", "/b/F/x")];
    expect(itemsForOtherWindows({ action: "move_to", items })).toEqual(items);
    expect(isFollowedMove(items[0] as (typeof items)[number], "batch_rename")).toBe(true);
    expect(isFollowedMove(item("/a", "/a"), "rename")).toBe(false);
  });

  it("goes by the names alone for paths that aren't absolute", () => {
    const items = [item("x", null), item("x", null), item("y", "")];
    expect(itemsForOtherWindows({ action: "trash", items })).toEqual([items[0], items[2]]);
  });
});
