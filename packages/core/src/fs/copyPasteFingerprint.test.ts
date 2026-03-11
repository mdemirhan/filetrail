import {
  captureFingerprint,
  detectKind,
  fingerprintsEqual,
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
