import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canMountDiskImages, mountTestDiskImage } from "@filetrail/core/fs/testDiskImage";

// Finder's "Locked".
const UF_IMMUTABLE = 0x2;

// Load the native addon directly from the build output.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require("../build/Release/native-fs.node") as typeof import("../index");

// Load the JS wrapper (adds single-flight serialization for nativeFolderSize).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wrapper = require("../index.js") as typeof import("../index");

function expectDefined<T>(value: T | null | undefined): NonNullable<T> {
  expect(value).toBeDefined();
  if (value == null) {
    throw new Error("Expected value to be defined.");
  }
  return value;
}

describe("nativeFolderSize", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-test-"));
    // Create a tree:
    //   root/
    //     a.txt  (10 bytes)
    //     b.txt  (20 bytes)
    //     sub/
    //       c.txt (5 bytes)
    //       deep/
    //         d.txt (100 bytes)
    //     empty/
    //     link -> a.txt  (symlink)
    mkdirSync(join(root, "sub", "deep"), { recursive: true });
    mkdirSync(join(root, "empty"));
    writeFileSync(join(root, "a.txt"), "x".repeat(10));
    writeFileSync(join(root, "b.txt"), "x".repeat(20));
    writeFileSync(join(root, "sub", "c.txt"), "x".repeat(5));
    writeFileSync(join(root, "sub", "deep", "d.txt"), "x".repeat(100));
    symlinkSync(join(root, "a.txt"), join(root, "link"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns total logical size, disk total, file and folder counts, and sub-dir stats", async () => {
    const json = await addon.nativeFolderSize(root);
    const result = JSON.parse(json) as {
      total: number;
      diskTotal: number;
      fileCount: number;
      folderCount: number;
      dirs: Record<string, [number, number, number, number]>;
    };

    // Logical sizes: a.txt(10) + b.txt(20) + c.txt(5) + d.txt(100) + link(symlink, size of target path string)
    // Symlink logical size varies, so we check file count and sub-dir structure instead.
    expect(result.fileCount).toBe(5); // a.txt, b.txt, c.txt, d.txt, link
    expect(result.folderCount).toBe(3); // sub, sub/deep, empty
    expect(result.total).toBeGreaterThanOrEqual(135); // at least 10+20+5+100
    expect(result.diskTotal).toBeGreaterThanOrEqual(result.total); // disk >= logical

    // Sub-directory entries exist for sub, sub/deep, and empty
    const dirPaths = Object.keys(result.dirs);
    expect(dirPaths).toContain(join(root, "sub"));
    expect(dirPaths).toContain(join(root, "sub", "deep"));
    expect(dirPaths).toContain(join(root, "empty"));
    expect(dirPaths).not.toContain(root); // root itself excluded

    // sub/deep has d.txt = [100, diskBytes, 1]
    const deep = expectDefined(result.dirs[join(root, "sub", "deep")]);
    expect(deep[0]).toBe(100); // logical
    expect(deep[2]).toBe(1); // file count
    expect(deep[3]).toBe(0); // folder count

    // sub has c.txt(5) + deep(100) = 105 total, 2 files
    const sub = expectDefined(result.dirs[join(root, "sub")]);
    expect(sub[0]).toBe(105); // recursive logical
    expect(sub[2]).toBe(2); // recursive file count (c.txt + d.txt)
    expect(sub[3]).toBe(1); // recursive folder count (deep)

    // empty has 0 bytes, 0 files
    const empty = expectDefined(result.dirs[join(root, "empty")]);
    expect(empty[0]).toBe(0);
    expect(empty[2]).toBe(0);
    expect(empty[3]).toBe(0);
  });

  it("counts a package's contents one by one, like any folder", async () => {
    mkdirSync(join(root, "Tool.app", "Contents", "MacOS"), { recursive: true });
    writeFileSync(join(root, "Tool.app", "Contents", "Info.plist"), "x");
    writeFileSync(join(root, "Tool.app", "Contents", "MacOS", "Tool"), "x");
    const result = JSON.parse(await addon.nativeFolderSize(root)) as {
      fileCount: number;
      folderCount: number;
    };

    expect(result.fileCount).toBe(7); // the 5 above + Info.plist, Tool
    expect(result.folderCount).toBe(6); // the 3 above + Tool.app, Contents, MacOS
  });

  it("can be cancelled", async () => {
    // Start a calculation and immediately cancel
    const promise = addon.nativeFolderSize(root);
    addon.nativeFolderSizeCancel();

    await expect(promise).rejects.toThrow(/cancelled/i);
  });

  it("handles non-existent paths", async () => {
    await expect(addon.nativeFolderSize("/nonexistent/path/xyz")).rejects.toThrow();
  });

  it("handles empty directories", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "native-fs-empty-"));
    try {
      const json = await addon.nativeFolderSize(emptyDir);
      const result = JSON.parse(json) as {
        total: number;
        diskTotal: number;
        fileCount: number;
        folderCount: number;
        dirs: Record<string, [number, number, number, number]>;
      };

      expect(result.total).toBe(0);
      expect(result.diskTotal).toBe(0);
      expect(result.fileCount).toBe(0);
      expect(result.folderCount).toBe(0);
      expect(Object.keys(result.dirs)).toHaveLength(0);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("nativeFolderSize wrapper (single-flight)", () => {
  interface FolderSizeResult {
    total: number;
    diskTotal: number;
    fileCount: number;
    folderCount: number;
    dirs: Record<string, [number, number, number, number]>;
  }

  function makeTree(prefix: string, fileCount: number, fileSize: number): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    for (let i = 0; i < fileCount; i++) {
      writeFileSync(join(dir, `f${i}.txt`), "x".repeat(fileSize));
    }
    return dir;
  }

  it("serializes concurrent calls and returns correct per-call results", async () => {
    const rootA = makeTree("native-fs-sf-a-", 3, 10);
    const rootB = makeTree("native-fs-sf-b-", 5, 20);
    try {
      const [jsonA, jsonB] = await Promise.all([
        wrapper.nativeFolderSize(rootA),
        wrapper.nativeFolderSize(rootB),
      ]);
      const resultA = JSON.parse(jsonA) as FolderSizeResult;
      const resultB = JSON.parse(jsonB) as FolderSizeResult;

      expect(resultA.fileCount).toBe(3);
      expect(resultA.total).toBe(30);
      expect(resultB.fileCount).toBe(5);
      expect(resultB.total).toBe(100);
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it("cancel then immediate restart cancels only the active call", async () => {
    const root = makeTree("native-fs-sf-c-", 4, 25);
    try {
      const first = wrapper.nativeFolderSize(root);
      wrapper.nativeFolderSizeCancel();
      const second = wrapper.nativeFolderSize(root);

      await expect(first).rejects.toMatchObject({ code: "ECANCELLED" });

      const result = JSON.parse(await second) as FolderSizeResult;
      expect(result.fileCount).toBe(4);
      expect(result.total).toBe(100);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("queues many concurrent calls without corrupting results", async () => {
    const root = makeTree("native-fs-sf-q-", 2, 7);
    try {
      const results = await Promise.all(
        Array.from({ length: 4 }, () => wrapper.nativeFolderSize(root)),
      );
      for (const json of results) {
        const result = JSON.parse(json) as FolderSizeResult;
        expect(result.fileCount).toBe(2);
        expect(result.total).toBe(14);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("nativeCopyFile errors", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-copy-"));
    writeFileSync(join(root, "a.txt"), "new");
    writeFileSync(join(root, "b.txt"), "existing");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("never writes over an existing destination", async () => {
    await expect(
      addon.nativeCopyFile(join(root, "a.txt"), join(root, "b.txt")),
    ).rejects.toMatchObject({ code: "EEXIST", syscall: "copyfile" });
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("existing");
  });

  it("names the errno and keeps long paths whole in the message", async () => {
    const longDestination = join(root, "missing-folder", "x".repeat(200), "y".repeat(200));
    const error = await addon.nativeCopyFile(join(root, "a.txt"), longDestination).then(
      () => null,
      (reason: unknown) => reason as NodeJS.ErrnoException & { dest: string },
    );

    expect(error).toMatchObject({ code: "ENOENT", dest: longDestination });
    expect(error?.message).toContain(longDestination);
  });

  it("reports errnos that used to be UNKNOWN by name", async () => {
    // A file used as a folder in the destination path.
    await expect(
      addon.nativeCopyFile(join(root, "a.txt"), join(root, "b.txt", "c.txt")),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});

describe("nativeCopyMetadata", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-metadata-"));
  });

  afterEach(() => {
    execFileSync("chmod", ["-R", "u+rwx", root]);
    rmSync(root, { recursive: true, force: true });
  });

  it("puts a folder's tags, mode and date on an existing folder without copying its items", async () => {
    const source = join(root, "source");
    const destination = join(root, "destination");
    mkdirSync(source);
    mkdirSync(destination);
    writeFileSync(join(source, "inside.txt"), "x");
    execFileSync("xattr", ["-w", "com.apple.metadata:_kMDItemUserTags", '("Red\n6")', source]);
    utimesSync(source, new Date("2020-01-02T03:04:05Z"), new Date("2020-01-02T03:04:05Z"));
    chmodSync(source, 0o555);

    await expectDefined(addon.nativeCopyMetadata)(source, destination);

    expect(execFileSync("xattr", [destination]).toString()).toContain(
      "com.apple.metadata:_kMDItemUserTags",
    );
    expect(statSync(destination).mode & 0o777).toBe(0o555);
    expect(statSync(destination).mtime.toISOString()).toBe("2020-01-02T03:04:05.000Z");
    expect(readdirSync(destination)).toEqual([]);
  });

  it("names the errno when the source is missing", async () => {
    mkdirSync(join(root, "destination"));
    await expect(
      expectDefined(addon.nativeCopyMetadata)(join(root, "missing"), join(root, "destination")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("nativeRenameExclusive", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-rename-"));
    writeFileSync(join(root, "a.txt"), "moved");
    writeFileSync(join(root, "b.txt"), "existing");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["addon", () => addon.nativeRenameExclusive],
    ["wrapper", () => wrapper.nativeRenameExclusive],
  ])("moves an item without replacing anything (%s)", async (_label, getRename) => {
    const renameExclusive = getRename();
    await expect(renameExclusive(join(root, "a.txt"), join(root, "b.txt"))).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("existing");

    await renameExclusive(join(root, "a.txt"), join(root, "c.txt"));
    expect(readFileSync(join(root, "c.txt"), "utf8")).toBe("moved");
    expect(existsSync(join(root, "a.txt"))).toBe(false);
  });
});

describe("nativeIsCaseSensitive", () => {
  it("answers for the volume holding a path", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-fs-case-"));
    try {
      writeFileSync(join(root, "Probe"), "");
      const answer = await wrapper.nativeIsCaseSensitive(root);
      // The answer must agree with what the volume does with a case-swapped name.
      const swappedExists = existsSync(join(root, "pROBE"));
      expect(answer).toBe(!swappedExists);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a path that doesn't exist", async () => {
    await expect(addon.nativeIsCaseSensitive("/nonexistent/path/xyz")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("nativeGetFileThumbnail", () => {
  // A one-pixel PNG.
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-thumbnail-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns a picture of an image file as JPEG or PNG data", async () => {
    const imagePath = join(root, "pixel.png");
    writeFileSync(imagePath, Buffer.from(PNG_BASE64, "base64"));

    const data = expectDefined(await wrapper.nativeGetFileThumbnail(imagePath, 128));
    const isJpeg = data[0] === 0xff && data[1] === 0xd8;
    const isPng = data[0] === 0x89 && data[1] === 0x50;
    expect(isJpeg || isPng).toBe(true);
  });

  it("resolves null for a folder and for a file that does not exist", async () => {
    expect(await wrapper.nativeGetFileThumbnail(root, 128)).toBeNull();
    expect(await wrapper.nativeGetFileThumbnail(join(root, "missing.png"), 128)).toBeNull();
  });
});

describe("nativeCopyFile stop flag", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-stop-"));
    writeFileSync(join(root, "a.txt"), "content");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("copies normally while the flag is clear", async () => {
    await addon.nativeCopyFile(join(root, "a.txt"), join(root, "b.txt"), new Int32Array(1));
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("content");
  });

  it("doesn't start a copy whose flag is already set", async () => {
    await expect(
      addon.nativeCopyFile(join(root, "a.txt"), join(root, "b.txt"), new Int32Array([1])),
    ).rejects.toMatchObject({ code: "ECANCELED" });
    expect(existsSync(join(root, "b.txt"))).toBe(false);
  });

  it("refuses a flag that isn't an Int32Array", () => {
    expect(() =>
      addon.nativeCopyFile(
        join(root, "a.txt"),
        join(root, "b.txt"),
        new Uint8Array(1) as unknown as Int32Array,
      ),
    ).toThrow(/Int32Array/);
  });

  // Across volumes the copy can't be a clone, so a large file takes long enough to stop.
  // The stop lands as the destination appears, while copyfile is still copying extended
  // attributes: a stop seen there once left an empty file behind.
  it.runIf(canMountDiskImages)(
    "stops part way through a large file and leaves no partial file",
    async () => {
      const volume = mountTestDiskImage({ sizeMb: 250 });
      try {
        const source = join(root, "big.bin");
        execFileSync("/usr/sbin/mkfile", ["150m", source]);
        const destination = join(volume.mountPath, "big.bin");
        const stop = new Int32Array(1);
        const copy = addon.nativeCopyFile(source, destination, stop);
        // Watched without yielding, so a busy machine can't delay the stop with a late
        // timer until the copy has finished: it is set within microseconds of the file
        // appearing, and the copy runs on its own thread for a second or more.
        waitForSync(() => existsSync(destination));
        stop[0] = 1;
        await expect(copy).rejects.toMatchObject({ code: "ECANCELED" });
        expect(existsSync(destination)).toBe(false);
      } finally {
        volume.detach();
      }
    },
    30_000,
  );

  // copyfile asks the progress callback what to do when a write fails; answering
  // "continue" there retried the write forever, so a full disk hung the copy.
  it.runIf(canMountDiskImages)(
    "fails with ENOSPC on a full disk instead of retrying the write forever",
    async () => {
      const volume = mountTestDiskImage({ sizeMb: 32 });
      try {
        const source = join(root, "big.bin");
        execFileSync("/usr/sbin/mkfile", ["80m", source]);
        const destination = join(volume.mountPath, "big.bin");
        const startedAt = Date.now();
        await expect(
          addon.nativeCopyFile(source, destination, new Int32Array(1)),
        ).rejects.toMatchObject({ code: "ENOSPC" });
        expect(Date.now() - startedAt).toBeLessThan(10_000);
        expect(existsSync(destination)).toBe(false);
      } finally {
        volume.detach();
      }
    },
    30_000,
  );

  it.runIf(canMountDiskImages)(
    "keeps a sparse file sparse, so it fits on a disk smaller than its length",
    async () => {
      const volume = mountTestDiskImage({ sizeMb: 32 });
      try {
        const source = join(root, "sparse.img");
        writeFileSync(source, "start");
        truncateSync(source, 1024 * 1024 * 1024);
        const destination = join(volume.mountPath, "sparse.img");
        await addon.nativeCopyFile(source, destination, new Int32Array(1));
        expect(statSync(destination).size).toBe(1024 * 1024 * 1024);
        expect(readFileSync(destination).subarray(0, 5).toString()).toBe("start");
      } finally {
        volume.detach();
      }
    },
    30_000,
  );
});

function waitForSync(condition: () => boolean, timeoutMs = 10_000): void {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the condition.");
    }
  }
}

describe("nativeGetFlags / nativeSetFlags", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-flags-"));
    writeFileSync(join(root, "a.txt"), "content");
  });

  afterEach(async () => {
    await wrapper.nativeSetFlags(join(root, "a.txt"), 0).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  });

  it("locks and unlocks an item the way Finder's Locked checkbox does", async () => {
    const path = join(root, "a.txt");
    expect(await wrapper.nativeGetFlags(path)).toBe(0);
    await wrapper.nativeSetFlags(path, UF_IMMUTABLE);
    expect(await wrapper.nativeGetFlags(path)).toBe(UF_IMMUTABLE);
    expect(() => execFileSync("/bin/mv", [path, join(root, "b.txt")], { stdio: "pipe" })).toThrow();
    await wrapper.nativeSetFlags(path, 0);
    expect(await wrapper.nativeGetFlags(path)).toBe(0);
  });

  it("reads a symlink's own flags, not its target's", async () => {
    const path = join(root, "a.txt");
    symlinkSync(path, join(root, "link"));
    await wrapper.nativeSetFlags(path, UF_IMMUTABLE);
    expect(await wrapper.nativeGetFlags(join(root, "link"))).toBe(0);
  });

  it("names the errno for a missing item", async () => {
    await expect(wrapper.nativeGetFlags(join(root, "missing"))).rejects.toMatchObject({
      code: "ENOENT",
      syscall: "lstat",
    });
    await expect(wrapper.nativeSetFlags(join(root, "missing"), 0)).rejects.toMatchObject({
      code: "ENOENT",
      syscall: "lchflags",
    });
  });
});

describe("nativeIsPackage", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-package-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("tells a package from a plain folder, and says null for a missing item", async () => {
    mkdirSync(join(root, "Tool.app"));
    mkdirSync(join(root, "plain"));
    expect(await wrapper.nativeIsPackage(join(root, "Tool.app"))).toBe(true);
    expect(await wrapper.nativeIsPackage(join(root, "plain"))).toBe(false);
    expect(await wrapper.nativeIsPackage(join(root, "missing.app"))).toBeNull();
  });
});
