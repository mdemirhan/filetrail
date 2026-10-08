import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  canMountDiskImages,
  canRunLargeFileTests,
  mountTestDiskImage,
} from "@filetrail/core/fs/testDiskImage";

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

  type Measured = {
    total: number;
    fileCount: number;
    folderCount: number;
    dirs: Record<string, [number, number, number, number]>;
  };

  it("counts a link to a folder inside as a file, and doesn't follow it", async () => {
    symlinkSync(join(root, "sub"), join(root, "to-sub"));
    const result = JSON.parse(await addon.nativeFolderSize(root)) as Measured;

    expect(result.fileCount).toBe(6); // the 5 above + to-sub
    expect(result.folderCount).toBe(3);
    expect(Object.keys(result.dirs).some((path) => path.startsWith(join(root, "to-sub")))).toBe(
      false,
    );
  });

  // As Finder's Get Info does: each link to a file is counted, as a copy would copy it.
  it("counts a file with several hard links once for each link", async () => {
    linkSync(join(root, "sub", "deep", "d.txt"), join(root, "sub", "d-again.txt"));
    const result = JSON.parse(await addon.nativeFolderSize(root)) as Measured;

    expect(result.fileCount).toBe(6);
    expect(expectDefined(result.dirs[join(root, "sub")])[0]).toBe(205);
  });

  it("counts a folder it can't open as one with nothing in it, and finishes the folder holding it", async () => {
    const locked = join(root, "sub", "locked");
    mkdirSync(locked);
    writeFileSync(join(locked, "secret.txt"), "x".repeat(1_000));
    chmodSync(locked, 0o000);
    try {
      const result = JSON.parse(await addon.nativeFolderSize(root)) as Measured;

      expect(result.folderCount).toBe(4); // sub, sub/deep, empty, sub/locked
      expect(result.fileCount).toBe(5);
      expect(Object.keys(result.dirs)).not.toContain(locked);
      expect(result.dirs[join(root, "sub")]).toEqual([105, expect.any(Number), 2, 2]);
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it("names the folders inside a folder given with a slash at its end with one slash", async () => {
    const result = JSON.parse(await addon.nativeFolderSize(`${root}/`)) as Measured;

    expect(Object.keys(result.dirs).sort()).toEqual(
      [join(root, "empty"), join(root, "sub"), join(root, "sub", "deep")].sort(),
    );
  });

  // /usr/share/snmp is a firmlink to /System/Volumes/Data/usr/share/snmp: measuring / walks
  // it there, so going through the firmlink as well would count it twice.
  it.skipIf(!existsSync("/usr/share/snmp/mibs"))(
    "doesn't go through a firmlink, but counts it as a folder",
    async () => {
      const result = JSON.parse(await addon.nativeFolderSize("/usr/share")) as Measured;
      const paths = Object.keys(result.dirs);

      expect(paths).toContain("/usr/share/man");
      expect(paths.some((path) => path.startsWith("/usr/share/snmp"))).toBe(false);
      // Measured itself, it is walked like any folder.
      const snmp = JSON.parse(await addon.nativeFolderSize("/usr/share/snmp")) as Measured;
      expect(Object.keys(snmp.dirs)).toContain("/usr/share/snmp/mibs");
    },
  );

  it("measures in the background as it does in front", async () => {
    const front = JSON.parse(await wrapper.nativeFolderSize(root)) as Measured;
    const background = JSON.parse(
      await wrapper.nativeFolderSize(root, undefined, { background: true }),
    ) as Measured;

    expect(background).toEqual(front);
  });

  // Each folder is opened from the one holding it, so no path is too long to open; the
  // paths are only put together for the result.
  it("measures folders whose paths are longer than PATH_MAX", async () => {
    const name = (level: number) => `${String(level).padStart(3, "0")}${"n".repeat(240)}`;
    const levels = 6;
    // Made from the bottom up, each folder moved into a new one, so that no path used is
    // longer than two names.
    let top = join(root, "chain-0");
    mkdirSync(top);
    writeFileSync(join(top, "leaf.txt"), "x".repeat(33));
    for (let level = 1; level < levels; level++) {
      const holder = join(root, `chain-${level}`);
      mkdirSync(holder);
      renameSync(top, join(holder, name(level)));
      top = holder;
    }
    try {
      const result = JSON.parse(await addon.nativeFolderSize(top)) as Measured;
      const names = Array.from({ length: levels - 1 }, (_, index) => name(levels - 1 - index));
      const deepest = [top, ...names].join("/");

      expect(deepest.length).toBeGreaterThan(1024);
      expect(result.folderCount).toBe(levels - 1);
      expect(result.total).toBe(33);
      expect(expectDefined(result.dirs[deepest])[0]).toBe(33);
    } finally {
      // Taken apart the way it was made: a path that long can't be removed by name.
      for (let level = levels - 1; level >= 1; level--) {
        const apart = join(root, `apart-${level}`);
        renameSync(join(top, name(level)), apart);
        rmSync(top, { recursive: true, force: true });
        top = apart;
      }
      rmSync(top, { recursive: true, force: true });
    }
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

describe("nativeFolderSize finished folders", () => {
  type Stats = [number, number, number, number];
  type Finished = { dev: number; dirs: Record<string, Stats> };
  type Result = Finished & {
    total: number;
    diskTotal: number;
    fileCount: number;
    folderCount: number;
  };

  let root: string;

  // A tree of 5 + 25 + 125 = 155 folders, each with a few small files: enough folders that
  // a walk is usually taken from more than once before it ends.
  function makeTree(dir: string, depth: number): void {
    for (let i = 0; i < 5; i++) {
      const child = join(dir, `d${i}`);
      mkdirSync(child);
      for (let f = 0; f <= i; f++) {
        writeFileSync(join(child, `f${f}.txt`), "x".repeat(10 * (f + 1) + depth));
      }
      if (depth > 1) {
        makeTree(child, depth - 1);
      }
    }
  }

  // What measuring each folder should give, read with lstat: [size, files, folders].
  function expectedSizes(dir: string, out: Map<string, [number, number, number]>) {
    let size = 0;
    let files = 0;
    let folders = 0;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const info = lstatSync(path);
      if (info.isDirectory()) {
        const [childSize, childFiles, childFolders] = expectedSizes(path, out);
        size += childSize;
        files += childFiles;
        folders += childFolders + 1;
      } else {
        size += info.size;
        files += 1;
      }
    }
    const sizes: [number, number, number] = [size, files, folders];
    out.set(dir, sizes);
    return sizes;
  }

  // Each reported folder once, with the sizes it should have.
  function expectReportedOnce(
    batches: Finished[],
    expected: Map<string, [number, number, number]>,
  ) {
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const [path, stats] of Object.entries(batch.dirs)) {
        expect(seen.has(path)).toBe(false);
        seen.add(path);
        expect([stats[0], stats[2], stats[3]]).toEqual(expected.get(path));
      }
    }
    return seen;
  }

  // Takes from the walk as often as the event loop allows until it ends.
  async function takeUntilSettled(promise: Promise<string>, onTaken?: () => void) {
    const batches: Finished[] = [];
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    while (!settled) {
      const json = addon.nativeFolderSizeTakeFinished();
      if (json !== null) {
        batches.push(JSON.parse(json) as Finished);
        onTaken?.();
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    return batches;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-finished-"));
    makeTree(root, 3);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports every folder once, after the folders inside it, and leaves the rest for the result", async () => {
    const expected = new Map<string, [number, number, number]>();
    expectedSizes(root, expected);
    const promise = addon.nativeFolderSize(root);
    const batches = await takeUntilSettled(promise);
    const result = JSON.parse(await promise) as Result;

    const seen = expectReportedOnce([...batches, result], expected);
    expect(seen.size).toBe(expected.size - 1);
    expect(seen.has(root)).toBe(false);
    expect([result.total, result.fileCount, result.folderCount]).toEqual(expected.get(root));
    for (const batch of batches) {
      expect(batch.dev).toBe(result.dev);
    }
    // A folder is finished only once everything inside it is: never in a batch before one
    // of its sub-folders.
    const batchOf = new Map<string, number>();
    [...batches, result].forEach((batch, index) => {
      for (const path of Object.keys(batch.dirs)) {
        batchOf.set(path, index);
      }
    });
    for (const [path, index] of batchOf) {
      const parent = join(path, "..");
      if (parent !== root) {
        expect(expectDefined(batchOf.get(parent))).toBeGreaterThanOrEqual(index);
      }
    }
  });

  it("is null with no walk under way", () => {
    expect(addon.nativeFolderSizeTakeFinished()).toBeNull();
  });

  it("keeps only whole folders when cancelled part way", async () => {
    const expected = new Map<string, [number, number, number]>();
    expectedSizes(root, expected);
    const promise = addon.nativeFolderSize(root);
    const batches = await takeUntilSettled(promise, () => addon.nativeFolderSizeCancel());
    const outcome = await promise.then(
      (json) => ({ result: JSON.parse(json) as Result }),
      (error: { code?: string; finished?: string }) => ({ error }),
    );
    if ("error" in outcome) {
      expect(outcome.error.code).toBe("ECANCELLED");
      if (outcome.error.finished !== undefined) {
        batches.push(JSON.parse(outcome.error.finished) as Finished);
      }
    } else {
      // The walk ended before the first take could cancel it.
      batches.push(outcome.result);
    }
    expectReportedOnce(batches, expected);
  });

  it("names a folder with a newline, quote, backslash or letters beyond ASCII in its name exactly", async () => {
    const names = ['line\nbreak "quoted" \\ tab\t', "Résumé 日本語 🎉", "two\\\\slashes"];
    for (const [index, name] of names.entries()) {
      mkdirSync(join(root, name));
      writeFileSync(join(root, name, "f.txt"), "x".repeat(7 + index));
    }
    const result = JSON.parse(await addon.nativeFolderSize(root)) as Result;
    for (const [index, name] of names.entries()) {
      expect(expectDefined(result.dirs[join(root, name)])[0]).toBe(7 + index);
    }
  });

  it("has nothing to take once a walk has ended or been cancelled", async () => {
    await addon.nativeFolderSize(root);
    expect(addon.nativeFolderSizeTakeFinished()).toBeNull();

    const cancelled = addon.nativeFolderSize(root);
    addon.nativeFolderSizeCancel();
    await expect(cancelled).rejects.toMatchObject({ code: "ECANCELLED" });
    expect(addon.nativeFolderSizeTakeFinished()).toBeNull();
  });

  it("hands finished folders to the wrapper's callback, and the rest with the result", async () => {
    const expected = new Map<string, [number, number, number]>();
    expectedSizes(root, expected);
    const batches: Finished[] = [];
    const json = await wrapper.nativeFolderSize(root, (finished) => {
      batches.push(JSON.parse(finished) as Finished);
    });
    const seen = expectReportedOnce([...batches, JSON.parse(json) as Result], expected);
    expect(seen.size).toBe(expected.size - 1);
  });

  it("hands what a cancelled walk finished to the wrapper's callback before rejecting", async () => {
    const expected = new Map<string, [number, number, number]>();
    expectedSizes(root, expected);
    const batches: Finished[] = [];
    const promise = wrapper.nativeFolderSize(root, (finished) => {
      batches.push(JSON.parse(finished) as Finished);
    });
    wrapper.nativeFolderSizeCancel();
    const error = await promise.then(
      () => null,
      (rejected: { code?: string; finished?: unknown }) => rejected,
    );
    expect(error?.code).toBe("ECANCELLED");
    expect(error?.finished).toBeUndefined();
    expectReportedOnce(batches, expected);
  });
});

describe("nativeItemSize", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "native-fs-item-"));
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "a.bin"), "x".repeat(12_345));
    writeFileSync(join(root, "sub", "b.txt"), "x".repeat(300));
    symlinkSync("sub", join(root, "link"));
    execFileSync("mkfifo", [join(root, "pipe")]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // What the folders that hold an item lose when it is removed must be what measuring
  // them counted for it.
  it("counts each item as measuring its folder does", async () => {
    const walk = JSON.parse(await addon.nativeFolderSize(root)) as {
      total: number;
      diskTotal: number;
      fileCount: number;
      folderCount: number;
      dev: number;
      dirs: Record<string, [number, number, number, number]>;
    };
    const items = await Promise.all(
      ["a.bin", "link", "pipe", "sub"].map((name) => addon.nativeItemSize(join(root, name))),
    );
    expect(items.map((item) => item.kind)).toEqual(["file", "file", "other", "folder"]);
    expect(new Set(items.map((item) => item.dev))).toEqual(new Set([walk.dev]));

    const sub = expectDefined(walk.dirs[join(root, "sub")]);
    const files = items.filter((item) => item.kind === "file");
    expect(files.reduce((sum, item) => sum + item.sizeBytes, sub[0])).toBe(walk.total);
    expect(files.reduce((sum, item) => sum + item.diskBytes, sub[1])).toBe(walk.diskTotal);
    expect(files.length + sub[2]).toBe(walk.fileCount);
    expect(1 + sub[3]).toBe(walk.folderCount);
  });

  it("fails for an item that is gone", async () => {
    await expect(addon.nativeItemSize(join(root, "missing"))).rejects.toMatchObject({
      code: "ENOENT",
    });
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
  it.runIf(canRunLargeFileTests)(
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
  it.runIf(canRunLargeFileTests)(
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

describe("nativeDatesTaken", () => {
  const fixtures = join(__dirname, "..", "test-fixtures");
  // The movie was made at this moment; it is shown on this Mac's clock.
  it.each([
    ["addon", addon],
    ["wrapper", wrapper],
  ])("reads the date a photo was taken, one answer per path (%s)", async (_name, api) => {
    const root = mkdtempSync(join(tmpdir(), "filetrail-dates-taken-"));
    writeFileSync(join(root, "notes.txt"), "not a photo");
    // A photo's extension with something else in it.
    writeFileSync(join(root, "broken.jpg"), "not really a photo");
    const paths = [
      join(fixtures, "taken.jpg"),
      join(fixtures, "digitized.jpg"),
      join(fixtures, "undated.jpg"),
      // Only photos: a video has no date taken here, though it has a creation date.
      join(fixtures, "clip.mov"),
      join(root, "notes.txt"),
      join(root, "broken.jpg"),
      join(root, "missing.jpg"),
      join(root, "no extension"),
    ];
    expect(await api.nativeDatesTaken(paths)).toEqual([
      "2021-07-04T09:15:30",
      "2019-12-31T23:59:58",
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(await api.nativeDatesTaken([])).toEqual([]);
  });

  it("refuses anything but a list of paths", () => {
    expect(() => addon.nativeDatesTaken("one path" as unknown as string[])).toThrow(TypeError);
    expect(() => addon.nativeDatesTaken([42] as unknown as string[])).toThrow(TypeError);
  });

  describe("unusual files", () => {
    let root: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "filetrail-dates-taken-"));
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    // taken.jpg with its DateTimeOriginal (its only date) replaced by `date`.
    function photoDated(name: string, date: string): string {
      const data = readFileSync(join(fixtures, "taken.jpg"));
      const at = data.indexOf("2021:07:04 09:15:30");
      expect(at).toBeGreaterThan(0);
      data.write(date, at, "latin1");
      const path = join(root, name);
      writeFileSync(path, data);
      return path;
    }

    it("reads a photo whose extension is in capitals", async () => {
      const path = join(root, "IMG_0001.JPG");
      writeFileSync(path, readFileSync(join(fixtures, "taken.jpg")));
      expect(await wrapper.nativeDatesTaken([path])).toEqual(["2021-07-04T09:15:30"]);
    });

    it("reads a photo whose folder and name have accents", async () => {
      mkdirSync(join(root, "Café"));
      const path = join(root, "Café", "été.jpg");
      writeFileSync(path, readFileSync(join(fixtures, "taken.jpg")));
      expect(await wrapper.nativeDatesTaken([path])).toEqual(["2021-07-04T09:15:30"]);
    });

    // Made from taken.jpg with `sips -s format heic`, which keeps its EXIF.
    it("reads the date a HEIC photo was taken", async () => {
      expect(await wrapper.nativeDatesTaken([join(fixtures, "taken.heic")])).toEqual([
        "2021-07-04T09:15:30",
      ]);
    });

    // A camera that doesn't know the date writes zeros or spaces; neither is a date.
    it("finds no date in a photo whose camera wrote zeros or spaces", async () => {
      const paths = [
        photoDated("zeros.jpg", "0000:00:00 00:00:00"),
        photoDated("spaces.jpg", "    :  :     :  :  "),
      ];
      expect(await wrapper.nativeDatesTaken(paths)).toEqual([null, null]);
    });
  });
});

// Tried on a disk image only: its Trash goes away with it, and the person's own Trash is
// never touched by a test.
describe("nativeTrashItem", () => {
  it.runIf(canMountDiskImages)(
    "moves items to their disk's Trash and says where each went, even under a new name",
    async () => {
      const volume = mountTestDiskImage({ sizeMb: 20 });
      try {
        const file = join(volume.mountPath, "a.txt");
        const folder = join(volume.mountPath, "Folder");
        writeFileSync(file, "first");
        mkdirSync(folder);
        writeFileSync(join(folder, "inside.txt"), "inside");
        const fileIno = statSync(file).ino;
        const folderIno = statSync(folder).ino;

        const fileInTrash = await wrapper.nativeTrashItem(file);
        const folderInTrash = await addon.nativeTrashItem(folder);

        expect(fileInTrash.startsWith(join(volume.mountPath, ".Trashes"))).toBe(true);
        expect(existsSync(file)).toBe(false);
        expect(statSync(fileInTrash).ino).toBe(fileIno);
        expect(statSync(folderInTrash).ino).toBe(folderIno);
        expect(readFileSync(join(folderInTrash, "inside.txt"), "utf8")).toBe("inside");

        // A second "a.txt" can't take the first one's name in the Trash.
        writeFileSync(file, "second");
        const secondInTrash = await wrapper.nativeTrashItem(file);
        expect(secondInTrash).not.toBe(fileInTrash);
        expect(readFileSync(secondInTrash, "utf8")).toBe("second");
        expect(readFileSync(fileInTrash, "utf8")).toBe("first");
      } finally {
        volume.detach();
      }
    },
    30_000,
  );

  it("fails with ENOENT and the Trash's own sentence for an item that isn't there", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-fs-trash-"));
    try {
      await expect(wrapper.nativeTrashItem(join(root, "missing.txt"))).rejects.toMatchObject({
        code: "ENOENT",
        syscall: "trash",
        path: join(root, "missing.txt"),
        message: expect.stringContaining("missing.txt"),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a call without a path", () => {
    expect(() => (addon.nativeTrashItem as unknown as () => Promise<string>)()).toThrow(
      "path is required",
    );
    expect(() =>
      (addon.nativeTrashItem as unknown as (path: number) => Promise<string>)(1),
    ).toThrow("path must be a string");
  });
});

describe("nativeStartFileDrag", () => {
  // A drag needs a window under a pressed mouse button, which a test can't give it; these
  // check what it does without one.
  const noView = Buffer.alloc(8);

  it("doesn't start, and never calls back, without a window", async () => {
    const onEnded = vi.fn();
    expect(addon.nativeStartFileDrag(noView, ["/tmp/a.txt"], [false], [], onEnded)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("refuses arguments of the wrong kind", () => {
    const onEnded = () => {};
    const start = addon.nativeStartFileDrag as unknown as (...args: unknown[]) => boolean;
    const rect = { x: 0, y: 0, width: 16, height: 16 };
    const image = {
      index: 0,
      iconRect: rect,
      nameRect: rect,
      nameFontSize: 13,
      nameCentered: false,
      thumbnail: null,
    };
    expect(start(noView, ["/tmp/a.txt"], [false], [image], onEnded)).toBe(false);
    expect(start(noView, ["/tmp/a.txt"], [], [image], onEnded)).toBe(false);
    expect(() => start(noView, ["/tmp/a.txt"], [false], [])).toThrow(TypeError);
    expect(() => start("view", ["/tmp/a.txt"], [false], [], onEnded)).toThrow(TypeError);
    expect(() => start(Buffer.alloc(2), ["/tmp/a.txt"], [false], [], onEnded)).toThrow(TypeError);
    expect(() => start(noView, "/tmp/a.txt", [false], [], onEnded)).toThrow(TypeError);
    expect(() => start(noView, [1], [false], [], onEnded)).toThrow(TypeError);
    expect(() => start(noView, ["/tmp/a.txt"], null, [], onEnded)).toThrow(TypeError);
    expect(() => start(noView, ["/tmp/a.txt"], ["yes"], [], onEnded)).toThrow(TypeError);
    expect(() => start(noView, ["/tmp/a.txt"], [false], null, onEnded)).toThrow(TypeError);
    expect(() =>
      start(noView, ["/tmp/a.txt"], [false], [{ ...image, iconRect: null }], onEnded),
    ).toThrow(TypeError);
    expect(() => start(noView, ["/tmp/a.txt"], [false], [], "callback")).toThrow(TypeError);
  });

  it("refuses an image for a place no path can have", () => {
    const start = addon.nativeStartFileDrag as unknown as (...args: unknown[]) => boolean;
    const rect = { x: 0, y: 0, width: 16, height: 16 };
    const image = { iconRect: rect, nameRect: rect, nameFontSize: 13, nameCentered: false };
    for (const index of [-1, 0.5, 2 ** 32, 2 ** 53, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        start(noView, ["/tmp/a.txt"], [false], [{ ...image, index, thumbnail: null }], () => {}),
      ).toThrow(TypeError);
    }
  });
});

describe("nativeReadDragPasteboard", () => {
  // Writes the system's drag pasteboard as another app's drag would: through AppKit, from
  // a process of its own.
  function writeDragPasteboard(script: string): number {
    const output = execFileSync("osascript", [
      "-l",
      "JavaScript",
      "-e",
      `ObjC.import("AppKit");
       const pasteboard = $.NSPasteboard.pasteboardWithName($.NSPasteboardNameDrag);
       pasteboard.clearContents;
       ${script};
       pasteboard.changeCount;`,
    ]);
    return Number(output.toString().trim());
  }

  it("reads the files another app's drag carries, file references as paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "filetrail-drag-pasteboard-"));
    try {
      const file = join(dir, "a b.txt");
      const folder = join(dir, "Folder");
      writeFileSync(file, "a");
      mkdirSync(folder);
      const changeCount = writeDragPasteboard(
        `pasteboard.writeObjects($([
           $.NSURL.fileURLWithPath(${JSON.stringify(file)}).fileReferenceURL,
           $.NSURL.fileURLWithPath(${JSON.stringify(folder)}),
           $.NSURL.fileURLWithPath(${JSON.stringify(folder)}),
           $.NSURL.URLWithString("https://example.com/"),
         ]))`,
      );

      const contents = addon.nativeReadDragPasteboard();

      // A reference names the file where it really is (/var is /private/var).
      expect(contents.paths).toEqual([execFileSync("realpath", [file]).toString().trim(), folder]);
      expect(contents.changeCount).toBe(changeCount);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds no files in a drag of text", () => {
    const changeCount = writeDragPasteboard(
      `pasteboard.setStringForType($("some text"), $.NSPasteboardTypeString)`,
    );

    expect(addon.nativeReadDragPasteboard()).toEqual({ changeCount, paths: [] });
  });
});
