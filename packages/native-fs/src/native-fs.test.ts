import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
