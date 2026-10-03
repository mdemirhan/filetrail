// Pastes between two real disks: a small disk image is mounted as the other disk, so a
// move there copies and then removes the originals, as it does to a USB drive.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type TestDiskImage, canMountDiskImages, mountTestDiskImage } from "./testDiskImage";
import { REPLACE_ALL, nativeFileSystemWithTrash, runPaste } from "./testNativePaste";

let testDir: string;
let src: string;
let volume: TestDiskImage;

// Names a test made; the disk's own hidden folders (.fseventsd, .Trashes) are left out.
async function visible(folder: string): Promise<string[]> {
  return (await readdir(folder)).filter((name) => !name.startsWith(".")).sort();
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => error.code === "EISDIR",
  );
}

describe.runIf(canMountDiskImages)("moving to another disk", () => {
  beforeAll(() => {
    volume = mountTestDiskImage({ name: "FileTrailOther" });
  });

  afterAll(() => {
    volume.detach();
  });

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "filetrail-volumes-"));
    src = join(testDir, "src");
    await mkdir(src);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    for (const name of [...(await visible(volume.mountPath)), ".test-trash"]) {
      await rm(join(volume.mountPath, name), { recursive: true, force: true });
    }
  });

  it("moves a file: copied there, then the original removed", async () => {
    await writeFile(join(src, "a.txt"), "a");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: volume.mountPath,
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(volume.mountPath, "a.txt"), "utf8")).toBe("a");
    expect(await visible(src)).toEqual([]);
  });

  it("moves a folder with everything in it", async () => {
    await mkdir(join(src, "Docs", "Nested"), { recursive: true });
    await writeFile(join(src, "Docs", "a.txt"), "a");
    await writeFile(join(src, "Docs", "Nested", "b.txt"), "b");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Docs")],
      destinationDirectoryPath: volume.mountPath,
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(volume.mountPath, "Docs", "Nested", "b.txt"), "utf8")).toBe("b");
    expect(await visible(src)).toEqual([]);
  });

  it("replaces a file there, removing the original only once the new one is in place", async () => {
    await writeFile(join(src, "a.txt"), "new");
    await writeFile(join(volume.mountPath, "a.txt"), "old");
    const volumeTrash = join(volume.mountPath, ".test-trash");
    await mkdir(volumeTrash);

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "a.txt")],
      destinationDirectoryPath: volume.mountPath,
      policy: REPLACE_ALL,
      // The Trash of the disk the replaced item is on.
      fileSystem: nativeFileSystemWithTrash(volumeTrash),
    });

    expect(result?.status).toBe("completed");
    expect(await readFile(join(volume.mountPath, "a.txt"), "utf8")).toBe("new");
    expect(await visible(volume.mountPath)).toEqual(["a.txt"]);
    expect(await visible(src)).toEqual([]);
    expect(await readFile(join(volumeTrash, "1-a.txt"), "utf8")).toBe("old");
  });

  it("says so when items were added to a folder while it was being moved", async () => {
    await mkdir(join(src, "Docs"));
    await writeFile(join(src, "Docs", "a.txt"), "a");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Docs")],
      destinationDirectoryPath: volume.mountPath,
      beforeExecute: async () => {
        await writeFile(join(src, "Docs", "late.txt"), "late");
      },
    });

    expect(result?.status).not.toBe("completed");
    expect(result?.items[0]).toMatchObject({
      sourcePath: join(src, "Docs"),
      status: "failed",
      error:
        "“late.txt” was added to “Docs” while it was being moved, so it was left in the original “Docs”.",
    });
    expect(await readFile(join(volume.mountPath, "Docs", "a.txt"), "utf8")).toBe("a");
    expect(await visible(join(src, "Docs"))).toEqual(["late.txt"]);
  });

  it("removes the moved folder when Finder only wrote its .DS_Store into it", async () => {
    await mkdir(join(src, "Docs"));
    await writeFile(join(src, "Docs", "a.txt"), "a");

    const { result } = await runPaste({
      mode: "cut",
      sourcePaths: [join(src, "Docs")],
      destinationDirectoryPath: volume.mountPath,
      beforeExecute: async () => {
        await writeFile(join(src, "Docs", ".DS_Store"), "view settings");
      },
    });

    expect(result?.status).toBe("completed");
    expect(await exists(join(src, "Docs"))).toBe(false);
  });
});

describe.runIf(canMountDiskImages)("from a disk that tells upper and lower case apart", () => {
  beforeAll(() => {
    volume = mountTestDiskImage({ caseSensitive: true, name: "FileTrailCase" });
  });

  afterAll(() => {
    volume.detach();
  });

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "filetrail-case-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    for (const name of await visible(volume.mountPath)) {
      await rm(join(volume.mountPath, name), { recursive: true, force: true });
    }
  });

  // On the startup disk "A.txt" and "a.txt" are one name: one would replace the other, and
  // after a move its original would be gone. The review stops the paste instead.
  it("stops before pasting a folder holding two items whose names differ only in case", async () => {
    const folder = join(volume.mountPath, "F");
    await mkdir(folder);
    await writeFile(join(folder, "A.txt"), "upper");
    await writeFile(join(folder, "a.txt"), "lower");

    const { report, result } = await runPaste({
      mode: "cut",
      sourcePaths: [folder],
      destinationDirectoryPath: testDir,
    });

    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "duplicate_destination_name",
        sourcePath: join(folder, "a.txt"),
        destinationPath: join(testDir, "F", "a.txt"),
      }),
    ]);
    expect(result).toBeNull();
    expect(await visible(folder)).toEqual(["A.txt", "a.txt"]);
    expect(await visible(testDir)).toEqual([]);
  });

  it("pastes a case-sensitive folder whose names stay apart", async () => {
    const folder = join(volume.mountPath, "F");
    await mkdir(folder);
    await writeFile(join(folder, "A.txt"), "upper");
    await writeFile(join(folder, "b.txt"), "b");

    const { report, result } = await runPaste({
      mode: "copy",
      sourcePaths: [folder],
      destinationDirectoryPath: testDir,
    });

    expect(report.issues).toEqual([]);
    expect(result?.status).toBe("completed");
    expect(await visible(join(testDir, "F"))).toEqual(["A.txt", "b.txt"]);
  });
});
