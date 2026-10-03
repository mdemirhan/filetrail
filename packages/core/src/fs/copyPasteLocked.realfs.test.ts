// Locked items (Finder's "Locked", the uchg flag), stopping a copy part way through a
// file, and putting right a Replace a crash cut short, on the real disk with the native copy.

import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recoverInterruptedReplaces } from "./copyPasteRecovery";
import { canMountDiskImages, mountTestDiskImage } from "./testDiskImage";
import {
  REPLACE_ALL,
  native,
  nativeFileSystem,
  nativeFileSystemWithTrash,
  runPaste,
} from "./testNativePaste";

const UF_IMMUTABLE = 0x2;

let testDir: string;
let src: string;
let dst: string;
let trash: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-locked-"));
  src = join(testDir, "src");
  dst = join(testDir, "dst");
  trash = join(testDir, "trash");
  await mkdir(src);
  await mkdir(dst);
  await mkdir(trash);
});

afterEach(async () => {
  execFileSync("chflags", ["-R", "nouchg", testDir]);
  execFileSync("chmod", ["-R", "u+rwx", testDir]);
  await rm(testDir, { recursive: true, force: true });
});

function lock(path: string): void {
  execFileSync("chflags", ["uchg", path]);
}

async function isLockedOnDisk(path: string): Promise<boolean> {
  return ((await native.nativeGetFlags(path)) & UF_IMMUTABLE) !== 0;
}

// Nothing a Replace builds under a hidden name may stay behind.
async function visibleAndHidden(folder: string): Promise<string[]> {
  return (await readdir(folder)).sort();
}

describe("Replace with locked items", () => {
  it("replaces an item with a locked file, and the new file stays locked", async () => {
    await writeFile(join(src, "f.txt"), "new");
    lock(join(src, "f.txt"));
    await writeFile(join(dst, "f.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "f.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(dst, "f.txt"), "utf8")).toBe("new");
    expect(await isLockedOnDisk(join(dst, "f.txt"))).toBe(true);
    expect(await visibleAndHidden(dst)).toEqual(["f.txt"]);
    expect(await readdir(trash)).toEqual(["1-f.txt"]);
  });

  it("replaces a folder with a locked folder and everything in it", async () => {
    await mkdir(join(src, "Vault"));
    await writeFile(join(src, "Vault", "a.txt"), "a");
    lock(join(src, "Vault"));
    await mkdir(join(dst, "Vault"));
    await writeFile(join(dst, "Vault", "old.txt"), "old");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Vault")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
    });

    expect(result?.status).toBe("completed");
    expect(await readdir(join(dst, "Vault"))).toEqual(["a.txt"]);
    expect(await isLockedOnDisk(join(dst, "Vault"))).toBe(true);
    expect(await visibleAndHidden(dst)).toEqual(["Vault"]);
  });

  it("refuses to replace a locked item, before anything changes", async () => {
    await writeFile(join(src, "f.txt"), "new");
    await writeFile(join(dst, "f.txt"), "old");
    lock(join(dst, "f.txt"));

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "f.txt")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
    });

    expect(result?.items[0]).toMatchObject({
      status: "failed",
      error: "“f.txt” is locked. Unlock it in Finder's Get Info and try again.",
    });
    expect(await readFile(join(dst, "f.txt"), "utf8")).toBe("old");
    expect(await visibleAndHidden(dst)).toEqual(["f.txt"]);
    expect(await readdir(trash)).toEqual([]);
  });
});

describe("moving locked items", () => {
  it("says a locked file is locked when it can't be moved", async () => {
    await writeFile(join(src, "f.txt"), "content");
    lock(join(src, "f.txt"));

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "f.txt")],
      destinationDirectoryPath: dst,
    });

    expect(result?.items[0]).toMatchObject({
      status: "failed",
      error: "“f.txt” is locked. Unlock it in Finder's Get Info and try again.",
    });
    expect(await readdir(src)).toEqual(["f.txt"]);
    expect(await readdir(dst)).toEqual([]);
  });

  // Across disks a move copies, then removes the original. A locked original can't be
  // removed, so nothing is copied: it would end up in both places.
  it.runIf(canMountDiskImages)(
    "doesn't copy a locked folder to another disk it can't then remove",
    async () => {
      const volume = mountTestDiskImage();
      try {
        await mkdir(join(src, "Vault"));
        await writeFile(join(src, "Vault", "a.txt"), "a");
        lock(join(src, "Vault"));

        const { result } = await runPaste({
          mode: "cut",
          sourcePaths: [join(src, "Vault")],
          destinationDirectoryPath: volume.mountPath,
        });

        expect(result?.items[0]).toMatchObject({
          status: "failed",
          error: "“Vault” is locked. Unlock it in Finder's Get Info and try again.",
        });
        expect(await readdir(join(src, "Vault"))).toEqual(["a.txt"]);
        expect((await readdir(volume.mountPath)).filter((name) => !name.startsWith("."))).toEqual(
          [],
        );
      } finally {
        volume.detach();
      }
    },
    30_000,
  );
});

describe("stopping part way through a file", () => {
  // Across disks a copy can't be a clone, so a large file takes long enough to stop.
  it.runIf(canMountDiskImages)(
    "stops a large copy at once and leaves nothing half written",
    async () => {
      const volume = mountTestDiskImage({ sizeMb: 250 });
      try {
        execFileSync("/usr/sbin/mkfile", ["150m", join(src, "big.bin")]);
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 30);
        const started = Date.now();

        const { result } = await runPaste({
          mode: "copy",
          sourcePaths: [join(src, "big.bin")],
          destinationDirectoryPath: volume.mountPath,
          signal: controller.signal,
        });

        expect(Date.now() - started).toBeLessThan(2000);
        expect(result?.status).toBe("cancelled");
        expect((await readdir(volume.mountPath)).filter((name) => !name.startsWith("."))).toEqual(
          [],
        );
      } finally {
        volume.detach();
      }
    },
    30_000,
  );
});

describe("putting right a Replace a crash cut short", () => {
  it("finishes a Replace whose new item is locked", async () => {
    const staged = join(dst, ".f.txt.filetrail-1234");
    await writeFile(staged, "new");
    lock(staged);

    const [outcome] = await recoverInterruptedReplaces(
      [
        {
          id: "1",
          stagingPath: staged,
          finalPath: join(dst, "f.txt"),
          sourcePath: join(src, "f.txt"),
          moved: false,
          staged: true,
        },
      ],
      nativeFileSystem,
    );

    expect(outcome).toMatchObject({ outcome: "finished", path: join(dst, "f.txt") });
    expect(await readFile(join(dst, "f.txt"), "utf8")).toBe("new");
    expect(await isLockedOnDisk(join(dst, "f.txt"))).toBe(true);
  });

  it("removes an unfinished locked copy", async () => {
    const staged = join(dst, ".f.txt.filetrail-1234");
    await writeFile(staged, "half");
    lock(staged);
    await writeFile(join(dst, "f.txt"), "old");

    const [outcome] = await recoverInterruptedReplaces(
      [
        {
          id: "1",
          stagingPath: staged,
          finalPath: join(dst, "f.txt"),
          sourcePath: join(src, "f.txt"),
          moved: false,
          staged: false,
        },
      ],
      nativeFileSystem,
    );

    expect(outcome).toMatchObject({ outcome: "removed_copy" });
    expect(await readdir(dst)).toEqual(["f.txt"]);
  });

  it("keeps an entry whose hidden item can't be reached, and drops one that is gone", async () => {
    const unreadable = join(testDir, "unreadable");
    await mkdir(unreadable);
    await writeFile(join(unreadable, ".moved.filetrail-1"), "only copy");
    await chmod(unreadable, 0o000);
    const entry = (id: string, stagingPath: string) => ({
      id,
      stagingPath,
      finalPath: join(dst, "moved"),
      sourcePath: join(src, "moved"),
      moved: true,
      staged: true,
    });

    const outcomes = await recoverInterruptedReplaces(
      [
        // Its disk isn't connected.
        entry("unmounted", "/Volumes/FileTrailNotConnected/.moved.filetrail-1"),
        // Its folder can't be read.
        entry("unreadable", join(unreadable, ".moved.filetrail-1")),
        // Really gone: its folder is there, the item isn't.
        entry("gone", join(dst, ".moved.filetrail-1")),
      ],
      nativeFileSystem,
    );

    expect(outcomes.map((outcome) => [outcome.entry.id, outcome.outcome])).toEqual([
      ["unmounted", "unreachable"],
      ["unreadable", "unreachable"],
      ["gone", "nothing_left"],
    ]);
    await chmod(unreadable, 0o755);
    expect(await readFile(join(unreadable, ".moved.filetrail-1"), "utf8")).toBe("only copy");
  });
});
