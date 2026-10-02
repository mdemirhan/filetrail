import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  it("returns total logical size, disk total, file count, and sub-dir stats", async () => {
    const json = await addon.nativeFolderSize(root);
    const result = JSON.parse(json) as {
      total: number;
      diskTotal: number;
      fileCount: number;
      dirs: Record<string, [number, number, number]>;
    };

    // Logical sizes: a.txt(10) + b.txt(20) + c.txt(5) + d.txt(100) + link(symlink, size of target path string)
    // Symlink logical size varies, so we check file count and sub-dir structure instead.
    expect(result.fileCount).toBe(5); // a.txt, b.txt, c.txt, d.txt, link
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

    // sub has c.txt(5) + deep(100) = 105 total, 2 files
    const sub = expectDefined(result.dirs[join(root, "sub")]);
    expect(sub[0]).toBe(105); // recursive logical
    expect(sub[2]).toBe(2); // recursive file count (c.txt + d.txt)

    // empty has 0 bytes, 0 files
    const empty = expectDefined(result.dirs[join(root, "empty")]);
    expect(empty[0]).toBe(0);
    expect(empty[2]).toBe(0);
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
        dirs: Record<string, [number, number, number]>;
      };

      expect(result.total).toBe(0);
      expect(result.diskTotal).toBe(0);
      expect(result.fileCount).toBe(0);
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
    dirs: Record<string, [number, number, number]>;
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
