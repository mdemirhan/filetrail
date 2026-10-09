import {
  captureFingerprint,
  detectKind,
  fileIdOf,
  fingerprintsEqual,
  holdsAnyOf,
  isAnyOf,
  pathExists,
} from "./copyPasteFingerprint";
import { MockWriteServiceFileSystem } from "./testUtils";

describe("copyPasteFingerprint", () => {
  it("captures file fingerprints with metadata", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace/file.txt": {
        kind: "file",
        size: 42,
        mode: 0o755,
        mtimeMs: 1234,
        ino: 7,
        dev: 2,
      },
    });

    await expect(captureFingerprint(fileSystem, "/workspace/file.txt")).resolves.toEqual({
      exists: true,
      kind: "file",
      size: 42,
      mtimeMs: 1234,
      mode: 0o755,
      ino: 7,
      dev: 2,
      symlinkTarget: null,
    });
  });

  it("captures symlink fingerprints and reads the link target", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace/alias": {
        kind: "symlink",
        target: "actual.txt",
        mode: 0o777,
        mtimeMs: 5000,
      },
    });

    const fingerprint = await captureFingerprint(fileSystem, "/workspace/alias");

    expect(fingerprint.kind).toBe("symlink");
    expect(fingerprint.symlinkTarget).toBe("actual.txt");
    expect(detectKind(await fileSystem.lstat("/workspace/alias"))).toBe("symlink");
  });

  it("treats unreadable symlink targets as null", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace/alias": {
        kind: "symlink",
        target: "actual.txt",
      },
    });
    fileSystem.readlinkImpl = async () => {
      throw new Error("readlink failed");
    };

    const fingerprint = await captureFingerprint(fileSystem, "/workspace/alias");

    expect(fingerprint.symlinkTarget).toBeNull();
  });

  it("returns a missing fingerprint for absent paths", async () => {
    const fileSystem = new MockWriteServiceFileSystem();

    await expect(captureFingerprint(fileSystem, "/missing")).resolves.toEqual({
      exists: false,
      kind: "missing",
      size: null,
      mtimeMs: null,
      mode: null,
      ino: null,
      dev: null,
      symlinkTarget: null,
    });
    await expect(pathExists(fileSystem, "/missing")).resolves.toBe(false);
  });

  it("treats null inode/device values as fallback-compatible", () => {
    expect(
      fingerprintsEqual(
        {
          exists: true,
          kind: "file",
          size: 1,
          mtimeMs: 10,
          mode: 0o644,
          ino: null,
          dev: null,
          symlinkTarget: null,
        },
        {
          exists: true,
          kind: "file",
          size: 1,
          mtimeMs: 10,
          mode: 0o644,
          ino: 99,
          dev: 1,
          symlinkTarget: null,
        },
      ),
    ).toBe(true);
  });

  it("detects meaningful metadata changes", () => {
    const base = {
      exists: true,
      kind: "file" as const,
      size: 5,
      mtimeMs: 100,
      mode: 0o644,
      ino: 1,
      dev: 1,
      symlinkTarget: null,
    };

    expect(
      fingerprintsEqual(base, {
        ...base,
        size: 6,
      }),
    ).toBe(false);
    expect(
      fingerprintsEqual(base, {
        ...base,
        mtimeMs: 101,
      }),
    ).toBe(false);
    expect(
      fingerprintsEqual(
        { ...base, kind: "symlink", symlinkTarget: "a" },
        { ...base, kind: "symlink", symlinkTarget: "b" },
      ),
    ).toBe(false);
    expect(
      fingerprintsEqual(base, {
        ...base,
        ino: 2,
      }),
    ).toBe(false);
    expect(
      fingerprintsEqual(base, {
        ...base,
        dev: 2,
      }),
    ).toBe(false);
  });

  it("reports existing paths through pathExists", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/workspace": { kind: "directory" },
    });

    await expect(pathExists(fileSystem, "/workspace")).resolves.toBe(true);
  });
});

describe("fileIdOf", () => {
  it("keeps a file id a number can hold exactly", () => {
    expect(fileIdOf(447403)).toBe(447403);
    expect(fileIdOf(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  // FAT and exFAT empty files, and the system volume's folders, have ids near 2^64 that
  // round to the same number.
  it("treats an id too large to compare as unknown", () => {
    expect(fileIdOf(Number("18446744073709551602"))).toBeNull();
    expect(fileIdOf(Number("1152921500311879682"))).toBeNull();
    expect(fileIdOf(undefined)).toBeNull();
  });
});

describe("items of a paste, by identity", () => {
  // Home reached by its firmlinked spelling: the same folders, by identity, under two paths
  // that real paths keep apart.
  function firmlinkedHome() {
    const data = "/System/Volumes/Data";
    return new MockWriteServiceFileSystem({
      "/Users/me": { kind: "directory", ino: 99, dev: 1 },
      [`${data}/Users/me`]: { kind: "directory", ino: 99, dev: 1 },
      "/Users/me/d": { kind: "directory", ino: 100, dev: 1 },
      "/Users/me/d/keep.txt": { kind: "file", ino: 101, dev: 1 },
      "/Users/me/a.txt": { kind: "file", ino: 102, dev: 1 },
      "/Users/me/b.txt": { kind: "file", ino: 103, dev: 1 },
      [`${data}/Users/me/d`]: { kind: "directory", ino: 100, dev: 1 },
      [`${data}/Users/me/d/keep.txt`]: { kind: "file", ino: 101, dev: 1 },
      [`${data}/Users/me/a.txt`]: { kind: "file", ino: 102, dev: 1 },
    });
  }

  it("finds an item pasted inside a folder reached by another spelling", async () => {
    const fileSystem = firmlinkedHome();
    const pasted = ["/System/Volumes/Data/Users/me/d/keep.txt"];

    expect(await holdsAnyOf(fileSystem, "/Users/me/d", pasted)).toBe(true);
    expect(await holdsAnyOf(fileSystem, "/Users/me", pasted)).toBe(true);
    // Moved out already (earlier in the same move): no longer at risk.
    fileSystem.nodes.delete("/System/Volumes/Data/Users/me/d/keep.txt");
    expect(await holdsAnyOf(fileSystem, "/Users/me/d", [...pasted])).toBe(false);
  });

  it("finds an item that is itself pasted, by another spelling", async () => {
    const fileSystem = firmlinkedHome();
    const pasted = ["/System/Volumes/Data/Users/me/a.txt"];

    expect(await isAnyOf(fileSystem, "/Users/me/a.txt", pasted)).toBe(true);
    expect(await isAnyOf(fileSystem, "/Users/me/b.txt", pasted)).toBe(false);
  });

  // FAT and exFAT give no identities (for empty files), and don't tell case apart.
  it("compares paths ignoring case on a disk that gives no identities", async () => {
    const noId = Number("18446744073709551602");
    const fileSystem = new MockWriteServiceFileSystem({
      "/v": { kind: "directory", ino: noId },
      "/v/a.txt": { kind: "file", ino: noId },
      "/v/sub": { kind: "directory", ino: noId },
      "/v/sub/x.txt": { kind: "file", ino: noId },
    });

    expect(await isAnyOf(fileSystem, "/v/A.txt", ["/v/a.txt"])).toBe(true);
    expect(await holdsAnyOf(fileSystem, "/v/SUB", ["/v/sub/x.txt"])).toBe(true);
    // Moved away already (earlier in the same move): no longer at risk.
    fileSystem.nodes.delete("/v/a.txt");
    expect(await isAnyOf(fileSystem, "/v/A.txt", ["/v/a.txt"])).toBe(false);
  });

  it("finds a hard link to an item pasted", async () => {
    const fileSystem = new MockWriteServiceFileSystem({
      "/x/a.txt": { kind: "file", ino: 50, dev: 1 },
      "/d/link.txt": { kind: "file", ino: 50, dev: 1 },
      "/d/other.txt": { kind: "file", ino: 51, dev: 1 },
    });

    expect(await isAnyOf(fileSystem, "/d/link.txt", ["/x/a.txt"])).toBe(true);
    expect(await isAnyOf(fileSystem, "/d/other.txt", ["/x/a.txt"])).toBe(false);
  });

  // On a disk that tells case apart, "a.txt" and "A.txt" are two items.
  it("tells names apart by case on a case-sensitive disk", async () => {
    const fileSystem = new MockWriteServiceFileSystem();
    fileSystem.caseSensitive = true;
    fileSystem.addDirectory("/d");
    fileSystem.addFile("/d/a.txt");
    fileSystem.addFile("/d/A.txt");
    fileSystem.addDirectory("/d/sub");
    fileSystem.addDirectory("/d/Sub");
    fileSystem.addFile("/d/Sub/x.txt");

    expect(await isAnyOf(fileSystem, "/d/a.txt", ["/d/A.txt"])).toBe(false);
    expect(await isAnyOf(fileSystem, "/d/A.txt", ["/d/A.txt"])).toBe(true);
    expect(await holdsAnyOf(fileSystem, "/d/sub", ["/d/Sub/x.txt"])).toBe(false);
    expect(await holdsAnyOf(fileSystem, "/d/Sub", ["/d/Sub/x.txt"])).toBe(true);
  });

  // Asked once for each item in the way: each answer looks at that one item, not at every
  // item pasted again (2,000 items took 4 million looks).
  it("reads each item once, however many items are asked about", async () => {
    const count = 300;
    const fileSystem = new MockWriteServiceFileSystem({ "/src": { kind: "directory" } });
    fileSystem.addDirectory("/dst");
    const pasted: string[] = [];
    for (let index = 0; index < count; index += 1) {
      fileSystem.addFile(`/src/item-${index}.txt`);
      fileSystem.addDirectory(`/dst/item-${index}`);
      pasted.push(`/src/item-${index}.txt`);
    }
    const lstat = vi.spyOn(fileSystem, "lstat");

    for (let index = 0; index < count; index += 1) {
      expect(await isAnyOf(fileSystem, `/dst/item-${index}`, pasted)).toBe(false);
      expect(await holdsAnyOf(fileSystem, `/dst/item-${index}`, pasted)).toBe(false);
    }

    expect(lstat.mock.calls.length).toBeLessThan(5 * count);
  });
});
