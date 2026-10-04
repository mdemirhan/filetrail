import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { toLocalDateTime } from "../../shared/batchRename";
import { createOriginalBatchRenameInspectDeps } from "../originalFileSystem";
import { type BatchRenameInspectDeps, inspectBatchRename } from "./batchRenameInspect";

const HOME = "/Users/demo";

function stats(
  birthtime = new Date(2026, 8, 30, 10, 12, 40),
  mtime = new Date(2026, 9, 1, 8, 30, 15),
) {
  return { isDirectory: () => false, birthtime, mtime };
}

function deps(overrides: Partial<BatchRenameInspectDeps> = {}): BatchRenameInspectDeps {
  return {
    lstat: vi.fn(async () => stats()),
    stat: vi.fn(async () => stats()),
    readdir: vi.fn(async () => ["a.jpg", "b.jpg", ".hidden"]),
    isCaseSensitive: vi.fn(async () => false),
    getFlags: vi.fn(async () => 0),
    canWriteFolder: vi.fn(async () => true),
    readDatesTaken: vi.fn(async (paths: string[]) => paths.map(() => "2026-05-14T18:02:11")),
    assertRenamable: vi.fn(async () => undefined),
    homePath: HOME,
    ...overrides,
  };
}

describe("what the Rename sheet checks", () => {
  it("gives each item's dates, and every name in its folder, hidden ones too", async () => {
    const answer = await inspectBatchRename(
      { paths: ["/trip/a.jpg", "/trip/b.jpg"], includeDateTaken: false },
      deps(),
    );
    expect(answer).toEqual({
      items: [
        {
          path: "/trip/a.jpg",
          createdAt: "2026-09-30T10:12:40",
          modifiedAt: "2026-10-01T08:30:15",
          takenAt: null,
          cannotRename: null,
        },
        {
          path: "/trip/b.jpg",
          createdAt: "2026-09-30T10:12:40",
          modifiedAt: "2026-10-01T08:30:15",
          takenAt: null,
          cannotRename: null,
        },
      ],
      folders: [{ path: "/trip", names: ["a.jpg", "b.jpg", ".hidden"], caseSensitive: false }],
    });
  });

  it("reads the dates taken only when asked, and keeps only well-formed ones", async () => {
    const readDatesTaken = vi.fn(async () => ["2026-05-14T18:02:11", "yesterday"]);
    const without = deps({ readDatesTaken });
    await inspectBatchRename({ paths: ["/trip/a.jpg"], includeDateTaken: false }, without);
    expect(readDatesTaken).not.toHaveBeenCalled();
    const answer = await inspectBatchRename(
      { paths: ["/trip/a.jpg", "/trip/b.jpg"], includeDateTaken: true },
      without,
    );
    expect(answer.items.map((item) => item.takenAt)).toEqual(["2026-05-14T18:02:11", null]);
    const failing = deps({ readDatesTaken: vi.fn(async () => Promise.reject(new Error("no"))) });
    const none = await inspectBatchRename(
      { paths: ["/trip/a.jpg"], includeDateTaken: true },
      failing,
    );
    expect(none.items[0]?.takenAt).toBeNull();
  });

  it("groups items by folder and reports each folder once", async () => {
    const isCaseSensitive = vi.fn(async (path: string) => (path === "/b" ? true : null));
    const answer = await inspectBatchRename(
      { paths: ["/a/1.txt", "/b/2.txt", "/a/3.txt"], includeDateTaken: false },
      deps({ isCaseSensitive }),
    );
    expect(answer.folders.map((folder) => [folder.path, folder.caseSensitive])).toEqual([
      ["/a", false],
      ["/b", true],
    ]);
    expect(isCaseSensitive).toHaveBeenCalledTimes(2);
  });

  it("says why an item can't be renamed", async () => {
    const missing = await inspectBatchRename(
      { paths: ["/trip/gone.txt"], includeDateTaken: false },
      deps({
        lstat: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOENT" }))),
      }),
    );
    expect(missing.items[0]).toMatchObject({
      cannotRename: "“gone.txt” no longer exists.",
      createdAt: null,
      modifiedAt: null,
    });

    const trash = await inspectBatchRename(
      { paths: [`${HOME}/.Trash`], includeDateTaken: false },
      deps(),
    );
    expect(trash.items[0]?.cannotRename).toBe("The Trash can’t be renamed.");

    const lockedFolder = await inspectBatchRename(
      { paths: ["/trip/a.jpg"], includeDateTaken: false },
      deps({ getFlags: vi.fn(async (path: string) => (path === "/trip" ? 0x2 : 0)) }),
    );
    expect(lockedFolder.items[0]?.cannotRename).toBe(
      "“trip” is locked. Unlock it in Finder's Get Info and try again.",
    );

    const readOnly = await inspectBatchRename(
      { paths: ["/trip/a.jpg"], includeDateTaken: false },
      deps({ canWriteFolder: vi.fn(async () => false) }),
    );
    expect(readOnly.items[0]?.cannotRename).toBe(
      "You don’t have permission to rename items in “trip”.",
    );

    const lockedItem = await inspectBatchRename(
      { paths: ["/trip/a.jpg"], includeDateTaken: false },
      deps({ getFlags: vi.fn(async (path: string) => (path === "/trip/a.jpg" ? 0x2 : 0)) }),
    );
    expect(lockedItem.items[0]?.cannotRename).toBe(
      "“a.jpg” is locked. Unlock it in Finder's Get Info and try again.",
    );

    const protectedFolder = await inspectBatchRename(
      { paths: [`${HOME}/Documents`], includeDateTaken: false },
      deps({
        assertRenamable: vi.fn(async () =>
          Promise.reject(new Error("“Documents” can't be renamed.")),
        ),
      }),
    );
    expect(protectedFolder.items[0]?.cannotRename).toBe("“Documents” can't be renamed.");
  });

  it("leaves out dates the disk doesn't really have, and names it can't read", async () => {
    const answer = await inspectBatchRename(
      { paths: ["/trip/a.jpg"], includeDateTaken: false },
      deps({
        lstat: vi.fn(async () => stats(new Date(0), new Date(Number.NaN))),
        readdir: vi.fn(async () => Promise.reject(new Error("unreadable"))),
        isCaseSensitive: vi.fn(async () => Promise.reject(new Error("unknown"))),
      }),
    );
    expect(answer.items[0]).toMatchObject({ createdAt: null, modifiedAt: null });
    expect(answer.folders[0]).toEqual({ path: "/trip", names: [], caseSensitive: false });
  });
});

describe("what the Rename sheet checks, on a real disk", () => {
  const realDeps = () =>
    createOriginalBatchRenameInspectDeps({
      homePath: HOME,
      assertRenamable: async () => undefined,
    });

  it("reads names, dates and the date a photo was taken", async () => {
    const root = mkdtempSync(join(tmpdir(), "filetrail-inspect-"));
    copyFileSync(
      join(__dirname, "../../../../../packages/native-fs/test-fixtures/taken.jpg"),
      join(root, "photo.jpg"),
    );
    writeFileSync(join(root, "notes.txt"), "n");
    writeFileSync(join(root, ".hidden"), "h");
    const answer = await inspectBatchRename(
      { paths: [join(root, "photo.jpg"), join(root, "notes.txt")], includeDateTaken: true },
      realDeps(),
    );
    const notes = statSync(join(root, "notes.txt"));
    expect(answer.items).toEqual([
      expect.objectContaining({ takenAt: "2021-07-04T09:15:30", cannotRename: null }),
      {
        path: join(root, "notes.txt"),
        createdAt: toLocalDateTime(notes.birthtime),
        modifiedAt: toLocalDateTime(notes.mtime),
        takenAt: null,
        cannotRename: null,
      },
    ]);
    expect(answer.folders[0]?.names.sort()).toEqual([".hidden", "notes.txt", "photo.jpg"]);
  });

  it("finds locked items and folders that can't be written to", async () => {
    const root = mkdtempSync(join(tmpdir(), "filetrail-inspect-"));
    writeFileSync(join(root, "locked.txt"), "l");
    const readOnly = join(root, "read-only");
    mkdirSync(readOnly);
    writeFileSync(join(readOnly, "a.txt"), "a");
    execFileSync("/usr/bin/chflags", ["uchg", join(root, "locked.txt")]);
    chmodSync(readOnly, 0o555);
    try {
      const answer = await inspectBatchRename(
        { paths: [join(root, "locked.txt"), join(readOnly, "a.txt")], includeDateTaken: false },
        realDeps(),
      );
      expect(answer.items.map((item) => item.cannotRename)).toEqual([
        "“locked.txt” is locked. Unlock it in Finder's Get Info and try again.",
        "You don’t have permission to rename items in “read-only”.",
      ]);
    } finally {
      execFileSync("/usr/bin/chflags", ["nouchg", join(root, "locked.txt")]);
      chmodSync(readOnly, 0o755);
    }
  });
});
