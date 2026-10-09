import { basename } from "node:path";

import type { UndoStep, UndoUnit } from "@filetrail/core";

import {
  type PlanFs,
  type PlannedStep,
  checkBatch,
  checkMove,
  checkTrash,
  findQuestions,
  noUnitChanges,
  reverseStep,
} from "./undoPlan";

// A disk of paths: each with a kind and an id (ino on dev 1; null for none, as on FAT). A
// link leads to the path it names.
function disk(
  items: Record<
    string,
    { kind: "file" | "dir"; ino: number | null; size?: number } | { kind: "link"; to: string }
  >,
): PlanFs {
  const lstat = async (path: string) => {
    const item = items[path];
    if (!item) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    if (item.kind === "link") {
      return { dev: 1, ino: 999, isDirectory: () => false, isSymbolicLink: () => true };
    }
    return {
      dev: 1,
      ...(item.ino === null ? {} : { ino: item.ino }),
      size: item.size ?? 0,
      mtimeMs: 1000,
      isFile: () => item.kind === "file",
      isDirectory: () => item.kind === "dir",
      isSymbolicLink: () => false,
    };
  };
  return {
    lstat,
    stat: async (path) => {
      const item = items[path];
      return lstat(item?.kind === "link" ? item.to : path);
    },
    readdir: async (path) =>
      Object.keys(items).filter(
        (other) => other.startsWith(`${path}/`) && !other.slice(path.length + 1).includes("/"),
      ),
  };
}

const id = (ino: number) => ({ dev: 1, ino });

function moveBack(overrides: Partial<Extract<PlannedStep, { kind: "move" }>> = {}) {
  return {
    kind: "move" as const,
    from: "/Docs/b.txt",
    to: "/Docs/a.txt",
    id: id(10),
    itemKind: "file" as const,
    parentId: id(1),
    putBack: false,
    ...overrides,
  };
}

describe("reverseStep", () => {
  it("reverses each kind of step", () => {
    const moved: UndoStep = {
      kind: "moved",
      from: "/a",
      to: "/b",
      id: id(5),
      itemKind: "file",
      parentId: id(1),
    };
    expect(reverseStep(moved)).toEqual({
      kind: "move",
      from: "/b",
      to: "/a",
      id: id(5),
      itemKind: "file",
      parentId: id(1),
      putBack: false,
    });
    expect(reverseStep({ ...moved, fromTrash: true })).toEqual({
      kind: "trash",
      path: "/b",
      id: id(5),
      stamp: null,
      putBack: true,
      unlock: false,
    });
    expect(reverseStep({ ...moved, fromTrash: true, locked: true })).toMatchObject({
      kind: "trash",
      unlock: true,
    });
    expect(
      reverseStep({ kind: "trashed", from: "/a", trashPath: "/T/a", id: id(5), parentId: id(1) }),
    ).toEqual({
      kind: "move",
      from: "/T/a",
      to: "/a",
      id: id(5),
      itemKind: null,
      parentId: id(1),
      putBack: true,
    });
    expect(
      reverseStep({
        kind: "batchRenamed",
        items: [{ from: "/a", to: "/b", id: id(5), itemKind: "file" }],
      }),
    ).toEqual({
      kind: "batch",
      items: [{ from: "/b", to: "/a", id: id(5), itemKind: "file" }],
    });
  });
});

describe("checkMove", () => {
  const docs = { "/Docs": { kind: "dir" as const, ino: 1 } };

  it("takes the very item, or a file saved under a new id, but not a folder in its place", async () => {
    expect(
      await checkMove(disk({ ...docs, "/Docs/b.txt": { kind: "file", ino: 10 } }), moveBack()),
    ).toMatchObject({ ok: true, nameTaken: false });
    expect(
      await checkMove(disk({ ...docs, "/Docs/b.txt": { kind: "file", ino: 99 } }), moveBack()),
    ).toMatchObject({ ok: true });
    expect(
      await checkMove(disk({ ...docs, "/Docs/b.txt": { kind: "dir", ino: 99 } }), moveBack()),
    ).toEqual({
      ok: false,
      reason: "The “b.txt” in “Docs” is another item now.",
      missing: false,
    });
  });

  it("puts back from the Trash only the very item", async () => {
    const step = moveBack({ from: "/T/b.txt", putBack: true, itemKind: null });
    const trash = { "/T": { kind: "dir" as const, ino: 2 } };
    expect(
      await checkMove(disk({ ...docs, ...trash, "/T/b.txt": { kind: "file", ino: 99 } }), step),
    ).toMatchObject({ ok: false, missing: false });
    expect(
      await checkMove(disk({ ...docs, ...trash, "/T/b.txt": { kind: "file", ino: 10 } }), step),
    ).toMatchObject({ ok: true });
  });

  it("says the disk was disconnected when the same ids come back on another device", async () => {
    // Recorded on device 2; the disk was ejected and is device 1 now.
    const ejected = (ino: number) => ({ dev: 2, ino });
    const files = { ...docs, "/Docs/b.txt": { kind: "file" as const, ino: 10 } };
    expect(
      await checkMove(disk(files), moveBack({ id: ejected(10), parentId: ejected(1) })),
    ).toEqual({
      ok: false,
      reason: "Its folder “Docs” is on a disk that was disconnected since, so it is left as it is.",
      missing: false,
    });
    const trash = { ...docs, "/T": { kind: "dir" as const, ino: 2 } };
    expect(
      await checkMove(
        disk({ ...trash, "/T/b.txt": { kind: "file", ino: 10 } }),
        moveBack({ from: "/T/b.txt", putBack: true, id: ejected(10), parentId: ejected(1) }),
      ),
    ).toEqual({
      ok: false,
      reason: "“a.txt” is on a disk that was disconnected since, so it is left as it is.",
      missing: false,
    });
    // Another item on another disk is just another item.
    expect(
      await checkMove(
        disk({ ...trash, "/T/b.txt": { kind: "file", ino: 11 } }),
        moveBack({ from: "/T/b.txt", putBack: true, id: ejected(10) }),
      ),
    ).toMatchObject({ reason: "The “a.txt” in the Trash is another item now." });
  });

  it("goes by the kind alone on a disk without usable ids", async () => {
    const fat = disk({ ...docs, "/Docs/b.txt": { kind: "file", ino: null } });
    expect(await checkMove(fat, moveBack())).toMatchObject({ ok: true });
    expect(await checkMove(fat, moveBack({ itemKind: "directory" }))).toMatchObject({ ok: false });
    expect(await checkMove(fat, moveBack({ itemKind: null, putBack: true }))).toMatchObject({
      ok: true,
    });
  });

  it("puts back from the Trash an item without an id only when it looks as it did", async () => {
    const trashed: UndoStep = {
      kind: "trashed",
      from: "/Docs/a.txt",
      trashPath: "/T/a.txt",
      id: null,
      parentId: null,
      stamp: { kind: "file", size: 5, mtimeMs: 1000, entryCount: null },
    };
    const step = reverseStep(trashed);
    if (step.kind !== "move") {
      throw new Error("A trashed step is undone by a move.");
    }
    const trash = { "/T": { kind: "dir" as const, ino: null } };

    expect(
      await checkMove(disk({ ...docs, ...trash, "/T/a.txt": { kind: "file", ino: null } }), step),
    ).toMatchObject({ ok: false, reason: "The “a.txt” in the Trash is another item now." });
    expect(
      await checkMove(
        disk({ ...docs, ...trash, "/T/a.txt": { kind: "file", ino: null, size: 5 } }),
        step,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await checkMove(disk({ ...docs, ...trash, "/T/a.txt": { kind: "dir", ino: null } }), step),
    ).toMatchObject({ ok: false });
  });

  it("says so when the item's disk isn't connected", async () => {
    expect(await checkMove(disk({}), moveBack({ from: "/Volumes/Backup/b.txt" }))).toEqual({
      ok: false,
      reason: "“b.txt” is on “Backup”, which isn't connected.",
      missing: true,
    });
  });

  it("names an item gone from the Trash as it was before, and tells a disconnected disk apart", async () => {
    // Put back from a disk's own Trash folder (".Trashes/501"), under the name it had there.
    const step = moveBack({
      from: "/Volumes/Stick/.Trashes/501/1-a.txt",
      to: "/Volumes/Stick/a.txt",
      putBack: true,
    });
    const stick = {
      "/Volumes/Stick": { kind: "dir" as const, ino: 1 },
      "/Volumes/Stick/.Trashes/501": { kind: "dir" as const, ino: 2 },
    };

    expect(await checkMove(disk(stick), step)).toEqual({
      ok: false,
      reason: "“a.txt” isn't in the Trash any more.",
      missing: true,
    });
    expect(await checkMove(disk({}), step)).toEqual({
      ok: false,
      reason: "“a.txt” is on “Stick”, which isn't connected.",
      missing: true,
    });
    expect(
      await checkMove(
        disk({ ...stick, "/Volumes/Stick/.Trashes/501/1-a.txt": { kind: "file", ino: 99 } }),
        step,
      ),
    ).toEqual({
      ok: false,
      reason: "The “a.txt” in the Trash is another item now.",
      missing: false,
    });
  });

  it("refuses a folder that is now a file, and goes by the folder's name without its id", async () => {
    const item = { "/Docs/b.txt": { kind: "file" as const, ino: 10 } };
    expect(
      await checkMove(disk({ "/Docs": { kind: "file", ino: 1 }, ...item }), moveBack()),
    ).toMatchObject({
      ok: false,
      reason: "Its folder “Docs” no longer exists.",
    });
    expect(
      await checkMove(disk({ "/Docs": { kind: "dir", ino: null }, ...item }), moveBack()),
    ).toMatchObject({ ok: true });
  });

  it("follows a link to the folder the item goes back to", async () => {
    const fs = disk({
      "/Data/Docs": { kind: "dir", ino: 1 },
      "/Docs": { kind: "link", to: "/Data/Docs" },
      "/Docs/b.txt": { kind: "file", ino: 10 },
    });
    expect(await checkMove(fs, moveBack())).toMatchObject({ ok: true });
    expect(await checkMove(fs, moveBack({ parentId: id(5) }))).toMatchObject({
      ok: false,
      reason: "Its folder “Docs” was replaced by another folder.",
    });
  });

  it("finds the name free when a step before it empties it", async () => {
    const fs = disk({
      ...docs,
      "/Docs/b.txt": { kind: "file", ino: 10 },
      "/Docs/a.txt": { kind: "file", ino: 11 },
    });
    expect(await checkMove(fs, moveBack())).toMatchObject({ ok: true, nameTaken: true });
    const changes = noUnitChanges();
    changes.movedAwayIds.add("1:11");
    expect(await checkMove(fs, moveBack(), changes)).toMatchObject({
      ok: true,
      nameTaken: false,
    });
  });

  it("finds a name taken when a step before it fills it", async () => {
    const fs = disk({ ...docs, "/Docs/b.txt": { kind: "file", ino: 10 } });
    const changes = noUnitChanges();
    changes.filledPlaces.add("/docs/a.txt");
    expect(await checkMove(fs, moveBack(), changes)).toMatchObject({ ok: true, nameTaken: true });
  });

  it("finds an item without an id gone by its place, whatever its case", async () => {
    const fs = disk({
      ...docs,
      "/Docs/b.txt": { kind: "file", ino: 10 },
      "/Docs/a.txt": { kind: "file", ino: null },
    });
    const changes = noUnitChanges();
    changes.movedAwayPaths.add("/docs/a.txt");
    expect(await checkMove(fs, moveBack(), changes)).toMatchObject({ ok: true, nameTaken: false });
  });
});

describe("checkTrash", () => {
  it("doesn't take an item whose kind changed on a disk without ids", async () => {
    const fs = disk({ "/Docs": { kind: "dir", ino: null }, "/Docs/a": { kind: "dir", ino: null } });
    const stamp = { kind: "file" as const, size: 0, mtimeMs: 1000, entryCount: null };
    expect(
      await checkTrash(fs, {
        kind: "trash",
        path: "/Docs/a",
        id: id(10),
        stamp,
        putBack: false,
        unlock: true,
      }),
    ).toMatchObject({ ok: false });
  });

  it("finds an item changed when it can't be looked at again", async () => {
    let calls = 0;
    const lstat = async () => {
      calls += 1;
      if (calls > 1) {
        throw new Error("EIO");
      }
      return { dev: 1, ino: 10, isDirectory: () => false, isFile: () => true };
    };
    const flaky: PlanFs = { lstat, stat: lstat };
    const stamp = { kind: "file" as const, size: 0, mtimeMs: 1000, entryCount: null };
    expect(
      await checkTrash(flaky, {
        kind: "trash",
        path: "/a",
        id: id(10),
        stamp,
        putBack: false,
        unlock: true,
      }),
    ).toEqual({ ok: true, changed: true, id: id(10) });
  });
});

describe("checkBatch", () => {
  it("lets items of the batch swap names, and refuses one that isn't the item renamed", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/a": { kind: "file", ino: 10 },
      "/D/b": { kind: "file", ino: 11 },
      "/D/c": { kind: "dir", ino: 99 },
      "/D/taken": { kind: "file", ino: 12 },
    });
    const checks = await checkBatch(fs, {
      kind: "batch",
      items: [
        { from: "/D/a", to: "/D/b", id: id(10), itemKind: "file" },
        { from: "/D/b", to: "/D/a", id: id(11), itemKind: "file" },
        { from: "/D/c", to: "/D/x", id: id(13), itemKind: "file" },
        { from: "/D/gone", to: "/D/y", id: id(14), itemKind: "file" },
      ],
    });

    expect(checks.map((check) => [check.refusal?.reason ?? null, check.nameTaken])).toEqual([
      [null, false],
      [null, false],
      ["The “c” in “D” is another item now.", false],
      ["“gone” is no longer in “D”.", false],
    ]);
  });
});

describe("findQuestions", () => {
  const created = (path: string, size: number): UndoStep => ({
    kind: "created",
    path,
    id: id(path.length),
    stamp: { kind: "file", size, mtimeMs: 1000, entryCount: null },
  });

  it("asks about every unit, and looks past an item that is gone", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/abc": { kind: "file", ino: 6, size: 5 },
      "/D/T": { kind: "dir", ino: 2 },
      "/D/T/x": { kind: "file", ino: 20 },
      "/D/x": { kind: "file", ino: 21 },
    });
    const units: UndoUnit[] = [
      // A Replace whose new item is gone already: the old one would go back, but its name
      // is taken by another item.
      {
        steps: [
          { kind: "trashed", from: "/D/x", trashPath: "/D/T/x", id: id(20), parentId: id(1) },
          created("/D/gone", 0),
        ],
      },
      // A copy that changed since it was made (5 bytes now, 0 then).
      { steps: [created("/D/abc", 0)] },
    ];

    expect(await findQuestions(fs, units)).toEqual({
      nameTaken: [{ name: "x", path: "/D/x" }],
      changed: [{ name: "abc", path: "/D/abc", putBack: false, replaced: false }],
    });
  });

  it("says which changed items replaced an old one, and which were put back", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/T": { kind: "dir", ino: 2 },
      "/D/T/old": { kind: "file", ino: 20 },
      "/D/new": { kind: "file", ino: 4, size: 9 },
      "/D/back": { kind: "file", ino: 30, size: 9 },
    });
    const stamp = { kind: "file" as const, size: 0, mtimeMs: 1000, entryCount: null };

    expect(
      await findQuestions(fs, [
        {
          steps: [
            { kind: "trashed", from: "/D/new", trashPath: "/D/T/old", id: id(20), parentId: id(1) },
            { kind: "created", path: "/D/new", id: id(4), stamp },
          ],
        },
        {
          steps: [
            {
              kind: "moved",
              from: "/D/T/back",
              to: "/D/back",
              id: id(30),
              itemKind: "file",
              parentId: id(2),
              fromTrash: true,
              stamp,
            },
          ],
        },
      ]),
    ).toEqual({
      nameTaken: [],
      changed: [
        { name: "back", path: "/D/back", putBack: true, replaced: false },
        { name: "new", path: "/D/new", putBack: false, replaced: true },
      ],
    });
  });

  it("stops at an item that is another item now", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/T": { kind: "dir", ino: 2 },
      "/D/T/x": { kind: "file", ino: 20 },
      "/D/x": { kind: "dir", ino: 30 },
    });
    expect(
      await findQuestions(fs, [
        {
          steps: [
            { kind: "trashed", from: "/D/x", trashPath: "/D/T/x", id: id(20), parentId: id(1) },
            created("/D/x", 0),
          ],
        },
      ]),
    ).toEqual({ nameTaken: [], changed: [] });
  });

  it("asks when a step before puts another item where an item goes back", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/T": { kind: "dir", ino: 2 },
      "/D/T/1": { kind: "file", ino: 20 },
      "/D/T/2": { kind: "file", ino: 21 },
    });
    // Two items that were both at "/D/x", one after the other: the second goes back there
    // first, so the first finds its name taken.
    expect(
      await findQuestions(fs, [
        {
          steps: [
            { kind: "trashed", from: "/D/x", trashPath: "/D/T/1", id: id(20), parentId: id(1) },
            { kind: "trashed", from: "/D/X", trashPath: "/D/T/2", id: id(21), parentId: id(1) },
          ],
        },
      ]),
    ).toEqual({ nameTaken: [{ name: "x", path: "/D/x" }], changed: [] });
  });

  it("finds the old item's name free once the new item spelled otherwise moves away", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/T": { kind: "dir", ino: 2 },
      "/D/T/x": { kind: "file", ino: 20 },
      // "X" over "x" on a disk that takes them for one name: the new item is found by both.
      "/D/X": { kind: "file", ino: 4 },
      "/D/x": { kind: "file", ino: 4 },
    });
    expect(
      await findQuestions(fs, [
        {
          steps: [
            { kind: "trashed", from: "/D/x", trashPath: "/D/T/x", id: id(20), parentId: id(1) },
            { kind: "created", path: "/D/X", id: id(4), stamp: null },
          ],
        },
      ]),
    ).toEqual({ nameTaken: [], changed: [] });
  });

  // The copy couldn't be read once made (EIO), so neither its id nor its looks were kept:
  // what is at its place now may be another item, and isn't taken to the Trash unasked.
  it("asks about a made item it kept nothing of", async () => {
    const fs = disk({ "/D": { kind: "dir", ino: 1 }, "/D/x": { kind: "file", ino: 40 } });

    expect(
      await findQuestions(fs, [
        { steps: [{ kind: "created", path: "/D/x", id: null, stamp: null }] },
      ]),
    ).toEqual({
      nameTaken: [],
      changed: [{ name: "x", path: "/D/x", putBack: false, replaced: false }],
    });
  });

  it("asks about a taken name in a batch", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/b": { kind: "file", ino: 10 },
      "/D/a": { kind: "file", ino: 11 },
    });
    expect(
      await findQuestions(fs, [
        {
          steps: [
            {
              kind: "batchRenamed",
              items: [{ from: "/D/a", to: "/D/b", id: id(10), itemKind: "file" }],
            },
          ],
        },
      ]),
    ).toEqual({ nameTaken: [{ name: "a", path: "/D/a" }], changed: [] });
  });

  // "a.txt" and "b.txt" swapped names, then the item now at "a.txt" was replaced by a
  // folder: that one stays, holding "a.txt", so the other can't go back there unasked.
  it("asks about a name a refused item of a batch still holds", async () => {
    const fs = disk({
      "/D": { kind: "dir", ino: 1 },
      "/D/b.txt": { kind: "file", ino: 10 },
      "/D/a.txt": { kind: "dir", ino: 99 },
    });
    expect(
      await findQuestions(fs, [
        {
          steps: [
            {
              kind: "batchRenamed",
              items: [
                { from: "/D/a.txt", to: "/D/b.txt", id: id(10), itemKind: "file" },
                { from: "/D/b.txt", to: "/D/a.txt", id: id(11), itemKind: "file" },
              ],
            },
          ],
        },
      ]),
    ).toEqual({ nameTaken: [{ name: "a.txt", path: "/D/a.txt" }], changed: [] });
  });

  it("looks at several units at once, and answers in their order", async () => {
    const items: Parameters<typeof disk>[0] = { "/D": { kind: "dir", ino: 1 } };
    const units: UndoUnit[] = [];
    for (let index = 0; index < 40; index += 1) {
      // Every item came back from the Trash and changed since; every third one's old
      // name is taken too.
      items[`/D/T/${index}`] = { kind: "file", ino: 100 + index };
      if (index % 3 === 0) {
        items[`/D/${index}`] = { kind: "file", ino: 500 + index };
      }
      units.push({
        steps: [
          {
            kind: "trashed",
            from: `/D/${index}`,
            trashPath: `/D/T/${index}`,
            id: id(100 + index),
            parentId: id(1),
          },
        ],
      });
    }
    const memory = disk(items);
    let reading = 0;
    let mostAtOnce = 0;
    const slow: PlanFs = {
      ...memory,
      lstat: async (path) => {
        reading += 1;
        mostAtOnce = Math.max(mostAtOnce, reading);
        // Later units answer sooner, so an order kept by luck would show.
        for (let tick = Number(basename(path)); tick < 40; tick += 1) {
          await Promise.resolve();
        }
        reading -= 1;
        return memory.lstat(path);
      },
    };

    const questions = await findQuestions(slow, units);

    expect(questions.nameTaken.map((taken) => taken.name)).toEqual(
      units
        .map((_unit, index) => index)
        .filter((index) => index % 3 === 0)
        .reverse()
        .map(String),
    );
    expect(mostAtOnce).toBeGreaterThan(1);
    expect(mostAtOnce).toBeLessThanOrEqual(16);
  });
});

// A disk that can't always be read (no permission, an error, a share not answering): each
// look is answered by `fails` first, which names the error it throws, if any. Counted per
// kind of look and path, from 1.
function troubled(
  fs: PlanFs,
  fails: (look: "lstat" | "stat" | "readdir", path: string, count: number) => string | null,
): PlanFs {
  const counts = new Map<string, number>();
  const check = (look: "lstat" | "stat" | "readdir", path: string) => {
    const key = `${look} ${path}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const code = fails(look, path, count);
    if (code !== null) {
      throw Object.assign(new Error(code), { code });
    }
  };
  return {
    lstat: async (path) => {
      check("lstat", path);
      return fs.lstat(path);
    },
    stat: async (path) => {
      check("stat", path);
      return fs.stat(path);
    },
    readdir: async (path) => {
      check("readdir", path);
      return (await fs.readdir?.(path)) ?? [];
    },
  };
}

describe("a disk that can't be read", () => {
  const docs = { "/Docs": { kind: "dir" as const, ino: 1 } };
  const trash = { "/T": { kind: "dir" as const, ino: null } };
  const putBackFile = {
    kind: "move" as const,
    from: "/T/a.txt",
    to: "/Docs/a.txt",
    id: null,
    itemKind: "file" as const,
    parentId: null,
    putBack: true,
    stamp: { kind: "file" as const, size: 5, mtimeMs: 1000, entryCount: null },
  };
  const inTrash = disk({ ...docs, ...trash, "/T/a.txt": { kind: "file", ino: null, size: 5 } });
  const cantCheck = (name: string) => ({
    ok: false,
    reason: `“${name}” couldn't be checked: A disk error occurred.`,
    missing: false,
    retry: true,
  });

  it("keeps a step whose item in the Trash can't be looked at again", async () => {
    // Found, then not read for how it looks: looked for again.
    const lookedAgain = (third: string | null) =>
      troubled(inTrash, (look, path, count) =>
        look === "lstat" && path === "/T/a.txt" && count >= 2
          ? count === 2
            ? "EIO"
            : third
          : null,
      );

    expect(await checkMove(lookedAgain("ENOENT"), putBackFile)).toMatchObject({
      ok: false,
      missing: true,
    });
    expect(await checkMove(lookedAgain("EIO"), putBackFile)).toEqual(cantCheck("a.txt"));
    expect(await checkMove(lookedAgain(null), putBackFile)).toEqual({
      ok: false,
      reason: "“a.txt” couldn't be checked.",
      missing: false,
      retry: true,
    });
  });

  it("keeps a step whose folder in the Trash can't be listed", async () => {
    const folder = disk({ ...docs, ...trash, "/T/F": { kind: "dir", ino: null } });
    const unlisted = troubled(folder, (look) => (look === "readdir" ? "EACCES" : null));

    expect(
      await checkMove(unlisted, {
        ...putBackFile,
        from: "/T/F",
        to: "/Docs/F",
        itemKind: "directory",
        stamp: { kind: "directory", size: null, mtimeMs: 1000, entryCount: 0 },
      }),
    ).toEqual({ ok: false, reason: "“F” couldn't be checked.", missing: false, retry: true });
  });

  it("keeps a step whose folder, or the place it goes back to, can't be looked at", async () => {
    const item = disk({ ...docs, "/Docs/b.txt": { kind: "file", ino: 10 } });

    expect(
      await checkMove(
        troubled(item, (look, path) => (look === "stat" && path === "/Docs" ? "EIO" : null)),
        moveBack(),
      ),
    ).toEqual(cantCheck("Docs"));
    expect(
      await checkMove(
        troubled(item, (look, path) => (look === "lstat" && path === "/Docs/a.txt" ? "EIO" : null)),
        moveBack(),
      ),
    ).toEqual(cantCheck("a.txt"));
  });

  it("finds a name taken by another item that differs from it only in case", async () => {
    const fs = disk({
      ...docs,
      "/Docs/b.txt": { kind: "file", ino: 10 },
      "/Docs/B.txt": { kind: "file", ino: 11 },
    });

    expect(await checkMove(fs, moveBack({ to: "/Docs/B.txt" }))).toMatchObject({
      ok: true,
      nameTaken: true,
      renamesItself: false,
    });
  });

  it("keeps a step to move to the Trash an item it can't look at", async () => {
    const fs = troubled(disk({ "/a": { kind: "file", ino: 10 } }), () => "EIO");

    expect(
      await checkTrash(fs, {
        kind: "trash",
        path: "/a",
        id: id(10),
        stamp: null,
        putBack: false,
        unlock: true,
      }),
    ).toEqual(cantCheck("a"));
  });

  it("finds an item changed when the very item is now another kind", async () => {
    expect(
      await checkTrash(disk({ "/a": { kind: "dir", ino: 10 } }), {
        kind: "trash",
        path: "/a",
        id: id(10),
        stamp: { kind: "file", size: 0, mtimeMs: 1000, entryCount: null },
        putBack: false,
        unlock: true,
      }),
    ).toEqual({ ok: true, changed: true, id: id(10) });
  });

  it("keeps the items of a batch it can't look at, or whose names it can't", async () => {
    const fs = troubled(
      disk({
        "/D": { kind: "dir", ino: 1 },
        "/D/a": { kind: "file", ino: 10 },
        "/D/b": { kind: "file", ino: 11 },
        "/D/c": { kind: "file", ino: 12 },
        "/D/fat": { kind: "file", ino: null },
      }),
      (look, path) => (look === "lstat" && (path === "/D/a" || path === "/D/y") ? "EIO" : null),
    );

    const checks = await checkBatch(fs, {
      kind: "batch",
      items: [
        { from: "/D/a", to: "/D/x", id: id(10), itemKind: "file" },
        { from: "/D/b", to: "/D/y", id: id(11), itemKind: "file" },
        { from: "/D/c", to: "/D/fat", id: id(12), itemKind: "file" },
      ],
    });

    expect(checks.map((check) => [check.refusal?.reason ?? null, check.nameTaken])).toEqual([
      ["“a” couldn't be checked: A disk error occurred.", false],
      ["“y” couldn't be checked: A disk error occurred.", false],
      // An item without an id in the way is never taken for one of the batch.
      [null, true],
    ]);
  });
});
