import type { UndoStep, UndoUnit } from "@filetrail/core";

import {
  type PlanFs,
  type PlannedStep,
  checkBatch,
  checkMove,
  checkTrash,
  findQuestions,
  reverseStep,
} from "./undoPlan";

// A disk of paths: each with a kind and an id (ino on dev 1; null for none, as on FAT).
function disk(
  items: Record<string, { kind: "file" | "dir"; ino: number | null; size?: number }>,
): PlanFs {
  return {
    lstat: async (path) => {
      const item = items[path];
      if (!item) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
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

  it("goes by the kind alone on a disk without usable ids", async () => {
    const fat = disk({ ...docs, "/Docs/b.txt": { kind: "file", ino: null } });
    expect(await checkMove(fat, moveBack())).toMatchObject({ ok: true });
    expect(await checkMove(fat, moveBack({ itemKind: "directory" }))).toMatchObject({ ok: false });
    expect(await checkMove(fat, moveBack({ itemKind: null, putBack: true }))).toMatchObject({
      ok: true,
    });
  });

  it("says so when the item's disk isn't connected", async () => {
    expect(await checkMove(disk({}), moveBack({ from: "/Volumes/Backup/b.txt" }))).toEqual({
      ok: false,
      reason: "“b.txt” is on “Backup”, which isn't connected.",
      missing: true,
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

  it("finds the name free when a step before it empties it", async () => {
    const fs = disk({
      ...docs,
      "/Docs/b.txt": { kind: "file", ino: 10 },
      "/Docs/a.txt": { kind: "file", ino: 11 },
    });
    expect(await checkMove(fs, moveBack())).toMatchObject({ ok: true, nameTaken: true });
    expect(await checkMove(fs, moveBack(), new Set(["/Docs/a.txt"]))).toMatchObject({
      ok: true,
      nameTaken: false,
    });
  });
});

describe("checkTrash", () => {
  it("doesn't take an item whose kind changed on a disk without ids", async () => {
    const fs = disk({ "/Docs": { kind: "dir", ino: null }, "/Docs/a": { kind: "dir", ino: null } });
    const stamp = { kind: "file" as const, size: 0, mtimeMs: 1000, entryCount: null };
    expect(
      await checkTrash(fs, { kind: "trash", path: "/Docs/a", id: id(10), stamp, putBack: false }),
    ).toMatchObject({ ok: false });
  });

  it("finds an item changed when it can't be looked at again", async () => {
    let calls = 0;
    const flaky: PlanFs = {
      lstat: async () => {
        calls += 1;
        if (calls > 1) {
          throw new Error("EIO");
        }
        return { dev: 1, ino: 10, isDirectory: () => false, isFile: () => true };
      },
    };
    const stamp = { kind: "file" as const, size: 0, mtimeMs: 1000, entryCount: null };
    expect(
      await checkTrash(flaky, { kind: "trash", path: "/a", id: id(10), stamp, putBack: false }),
    ).toEqual({
      ok: true,
      changed: true,
    });
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
      nameTaken: ["x"],
      changed: [{ name: "abc", putBack: false, replaced: false }],
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
        { name: "back", putBack: true, replaced: false },
        { name: "new", putBack: false, replaced: true },
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
    ).toEqual({ nameTaken: ["a"], changed: [] });
  });
});
