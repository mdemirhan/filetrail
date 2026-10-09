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
    // By path, ignoring case, on a disk that gives no identities.
    expect(await isAnyOf(fileSystem, "/Users/me/B.txt", ["/Users/me/b.txt"])).toBe(true);
  });
});
