import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { itemIdOf, readItemId, readItemStamp, sameItemId, stampWithoutId } from "./undoLog";
import { DEFAULT_WRITE_SERVICE_FILE_SYSTEM } from "./writeServiceTypes";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "filetrail-undo-ids-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("item ids", () => {
  it("is known only when the disk gives a usable id", () => {
    expect(itemIdOf({ dev: 1, ino: 2 })).toEqual({ dev: 1, ino: 2 });
    expect(itemIdOf({ ino: 2 })).toBeNull();
    // FAT and exFAT give empty files ids a number can't hold.
    expect(itemIdOf({ dev: 1, ino: 2 ** 64 - 1 })).toBeNull();
  });

  it("is null for an item that can't be read", async () => {
    await expect(
      readItemId(DEFAULT_WRITE_SERVICE_FILE_SYSTEM.lstat, join(root, "gone")),
    ).resolves.toBeNull();
  });

  it("tells the same item only by two known ids", () => {
    expect(sameItemId({ dev: 1, ino: 2 }, { dev: 1, ino: 2 })).toBe(true);
    expect(sameItemId({ dev: 1, ino: 2 }, { dev: 3, ino: 2 })).toBe(false);
    expect(sameItemId({ dev: 1, ino: 2 }, { dev: 1, ino: 3 })).toBe(false);
    expect(sameItemId(null, null)).toBe(false);
    expect(sameItemId({ dev: 1, ino: 2 }, null)).toBe(false);
  });
});

describe("readItemStamp", () => {
  it("tells files, folders and links apart, and counts what a folder holds", async () => {
    await writeFile(join(root, "a.txt"), "abc");
    await mkdir(join(root, "Folder"));
    await writeFile(join(root, "Folder", "inside.txt"), "");
    await symlink("a.txt", join(root, "link"));

    await expect(
      readItemStamp(DEFAULT_WRITE_SERVICE_FILE_SYSTEM, join(root, "a.txt")),
    ).resolves.toEqual({ kind: "file", size: 3, mtimeMs: expect.any(Number), entryCount: null });
    await expect(
      readItemStamp(DEFAULT_WRITE_SERVICE_FILE_SYSTEM, join(root, "Folder")),
    ).resolves.toEqual({
      kind: "directory",
      size: null,
      mtimeMs: expect.any(Number),
      entryCount: 1,
    });
    await expect(
      readItemStamp(DEFAULT_WRITE_SERVICE_FILE_SYSTEM, join(root, "link")),
    ).resolves.toEqual({
      kind: "symlink",
      size: null,
      mtimeMs: expect.any(Number),
      entryCount: null,
    });
  });

  it("is null for an item that can't be read", async () => {
    await expect(
      readItemStamp(DEFAULT_WRITE_SERVICE_FILE_SYSTEM, join(root, "gone")),
    ).resolves.toBeNull();
  });

  it("leaves what it can't tell unknown", async () => {
    const stats = { isDirectory: () => true };
    await expect(readItemStamp({ lstat: async () => stats }, "/Folder")).resolves.toEqual({
      kind: "directory",
      size: null,
      mtimeMs: null,
      entryCount: null,
    });
    await expect(
      readItemStamp(
        {
          lstat: async () => stats,
          readdir: async () => {
            throw new Error("EACCES");
          },
        },
        "/Folder",
      ),
    ).resolves.toMatchObject({ entryCount: null });
    await expect(
      readItemStamp(
        { lstat: async () => ({ isDirectory: () => false, isFile: () => false }) },
        "/dev/thing",
      ),
    ).resolves.toMatchObject({ kind: "other" });
  });
});

describe("stampWithoutId", () => {
  it("keeps how an item looks only when it has no id to go by", async () => {
    await writeFile(join(root, "a.txt"), "abc");
    const fs = DEFAULT_WRITE_SERVICE_FILE_SYSTEM;
    expect(await stampWithoutId(fs, join(root, "a.txt"), { dev: 1, ino: 2 })).toEqual({});
    expect(await stampWithoutId(fs, join(root, "a.txt"), null)).toEqual({
      stamp: expect.objectContaining({ kind: "file", size: 3 }),
    });
    expect(await stampWithoutId(fs, join(root, "gone"), null)).toEqual({});
  });
});
