// Locked items (Finder's "Locked", the uchg flag), stopping a copy part way through a
// file, and putting right a Replace a crash cut short, on the real disk with the native copy.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recoverInterruptedReplaces } from "./copyPasteRecovery";
import {
  type TestDiskImage,
  canMountDiskImages,
  canRunLargeFileTests,
  mountTestDiskImage,
} from "./testDiskImage";
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

// The other disk the moves across disks go to: one for the whole file, made when a test
// first needs it (making a disk takes about a second) and emptied after each test.
let otherDisk: TestDiskImage | undefined;

function otherDiskPath(): string {
  otherDisk ??= mountTestDiskImage({ name: "FileTrailLocked" });
  return otherDisk.mountPath;
}

afterEach(async () => {
  if (!otherDisk) {
    return;
  }
  // What a test made there; the disk's own hidden folders (.fseventsd, .Trashes) stay.
  for (const name of await readdir(otherDisk.mountPath)) {
    if (!name.startsWith(".") || name === ".test-trash") {
      const path = join(otherDisk.mountPath, name);
      execFileSync("chflags", ["-R", "nouchg", path]);
      await rm(path, { recursive: true, force: true });
    }
  }
});

afterAll(() => {
  otherDisk?.detach();
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
      const disk = otherDiskPath();
      await mkdir(join(src, "Vault"));
      await writeFile(join(src, "Vault", "a.txt"), "a");
      lock(join(src, "Vault"));

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "Vault")],
        destinationDirectoryPath: disk,
      });

      expect(result?.items[0]).toMatchObject({
        status: "failed",
        error: "“Vault” is locked. Unlock it in Finder's Get Info and try again.",
      });
      expect(await readdir(join(src, "Vault"))).toEqual(["a.txt"]);
      expect((await readdir(disk)).filter((name) => !name.startsWith("."))).toEqual([]);
    },
    30_000,
  );
});

describe("moving to another disk with Replace", () => {
  // The Replace stages a plain copy and removes the originals only after the swap: a
  // locked original used to be found out then, after the old item had gone to the Trash.
  it.runIf(canMountDiskImages)(
    "refuses a locked file before anything is replaced",
    async () => {
      const disk = otherDiskPath();
      const otherTrash = join(disk, ".test-trash");
      await mkdir(otherTrash);
      await writeFile(join(src, "f.txt"), "new");
      lock(join(src, "f.txt"));
      await writeFile(join(disk, "f.txt"), "old");

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "f.txt")],
        destinationDirectoryPath: disk,
        policy: REPLACE_ALL,
        fileSystem: nativeFileSystemWithTrash(otherTrash),
      });

      expect(result?.items[0]).toMatchObject({
        status: "failed",
        error: "“f.txt” is locked. Unlock it in Finder's Get Info and try again.",
      });
      expect(await readFile(join(disk, "f.txt"), "utf8")).toBe("old");
      expect(await readdir(otherTrash)).toEqual([]);
      expect(await readdir(src)).toEqual(["f.txt"]);
    },
    30_000,
  );

  it.runIf(canMountDiskImages)(
    "refuses a folder holding a locked item before anything is replaced",
    async () => {
      const disk = otherDiskPath();
      const otherTrash = join(disk, ".test-trash");
      await mkdir(otherTrash);
      await mkdir(join(src, "Docs"));
      await writeFile(join(src, "Docs", "keep.txt"), "keep");
      lock(join(src, "Docs", "keep.txt"));
      await mkdir(join(disk, "Docs"));
      await writeFile(join(disk, "Docs", "old.txt"), "old");

      const { result } = await runPaste({
        mode: "cut",
        sourcePaths: [join(src, "Docs")],
        destinationDirectoryPath: disk,
        policy: REPLACE_ALL,
        fileSystem: nativeFileSystemWithTrash(otherTrash),
      });

      expect(result?.items[0]).toMatchObject({
        status: "failed",
        error: "“keep.txt” is locked. Unlock it in Finder's Get Info and try again.",
      });
      expect(await readdir(join(disk, "Docs"))).toEqual(["old.txt"]);
      expect(await readdir(otherTrash)).toEqual([]);
    },
    30_000,
  );
});

describe("moving to another disk out of a folder that can't be changed", () => {
  // Every file used to be copied, then each reported "copied, but the original couldn't
  // be removed": everything in both places after copying all of it.
  it.runIf(canMountDiskImages)(
    "copies nothing out of a read-only folder, and says why",
    async () => {
      const disk = otherDiskPath();
      try {
        await mkdir(join(src, "Docs"));
        await writeFile(join(src, "Docs", "a.txt"), "a");
        await writeFile(join(src, "Docs", "b.txt"), "b");
        await chmod(join(src, "Docs"), 0o555);

        const { result } = await runPaste({
          mode: "cut",
          sourcePaths: [join(src, "Docs")],
          destinationDirectoryPath: disk,
        });

        expect(result?.items[0]).toMatchObject({
          status: "failed",
          error:
            "“Docs” wasn't moved, because you don't have permission to remove what is inside it.",
        });
        expect((await readdir(disk)).filter((name) => !name.startsWith("."))).toEqual([]);
        expect((await readdir(join(src, "Docs"))).sort()).toEqual(["a.txt", "b.txt"]);
      } finally {
        await chmod(join(src, "Docs"), 0o755);
      }
    },
    30_000,
  );

  it.runIf(canMountDiskImages)(
    "doesn't move a file out of a folder that can't be changed",
    async () => {
      const disk = otherDiskPath();
      try {
        await mkdir(join(src, "Docs"));
        await writeFile(join(src, "Docs", "a.txt"), "a");
        await chmod(join(src, "Docs"), 0o555);

        const { result } = await runPaste({
          mode: "cut",
          sourcePaths: [join(src, "Docs", "a.txt")],
          destinationDirectoryPath: disk,
        });

        expect(result?.items[0]?.error).toBe(
          "“a.txt” wasn't moved, because you don't have permission to remove it from “Docs”.",
        );
        expect((await readdir(disk)).filter((name) => !name.startsWith("."))).toEqual([]);
      } finally {
        await chmod(join(src, "Docs"), 0o755);
      }
    },
    30_000,
  );
});

describe("stopping part way through a file", () => {
  // Across disks a copy can't be a clone, so a large file takes long enough to stop.
  it.runIf(canRunLargeFileTests)(
    "stops a large copy at once and leaves nothing half written",
    async (context) => {
      const volume = mountTestDiskImage({ sizeMb: 250 });
      try {
        execFileSync("/usr/sbin/mkfile", ["150m", join(src, "big.bin")]);
        const destination = join(volume.mountPath, "big.bin");
        // On a busy machine the copy may finish before the stop is seen; that run proves
        // nothing, so it is tried again.
        let status: string | undefined = "completed";
        for (let attempt = 0; attempt < 3 && status === "completed"; attempt += 1) {
          await rm(destination, { force: true });
          const controller = new AbortController();
          const { result } = await runPaste({
            mode: "copy",
            sourcePaths: [join(src, "big.bin")],
            destinationDirectoryPath: volume.mountPath,
            signal: controller.signal,
            // Stop once the file has begun to be written, not after a fixed time that a
            // fast disk can beat.
            beforeExecute: async () => {
              // The file is written under a hidden name until it is whole.
              const stopOnceWriting = () => {
                if (readdirSync(volume.mountPath).some((name) => name.startsWith(".big.bin."))) {
                  controller.abort();
                } else {
                  setTimeout(stopOnceWriting, 1);
                }
              };
              stopOnceWriting();
            },
          });
          status = result?.status;
        }

        if (status === "completed") {
          // See the same test of the native copy: a run that proves nothing says so.
          context.skip("each copy finished before the stop could be seen");
        }
        expect(status).toBe("cancelled");
        // Neither the file nor the hidden one it was being written as is left.
        expect(
          (await readdir(volume.mountPath)).filter(
            (name) => !name.startsWith(".") || name.startsWith(".big.bin."),
          ),
        ).toEqual([]);
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
