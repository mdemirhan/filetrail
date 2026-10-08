// Packages (apps, Keynote documents, photo libraries) are folders macOS shows as one item.
// Two of them clash like two files: one replaces the other or both are kept, never merged,
// since an app or document made of two versions is broken.

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isPackageFolder } from "./copyPasteNames";
import {
  KEEP_EXISTING,
  REPLACE_ALL,
  nativeFileSystem,
  nativeFileSystemWithTrash,
  runPaste,
} from "./testNativePaste";
import type { CopyPastePolicy, WriteServiceFileSystem } from "./writeServiceTypes";

const KEEP_ALL: CopyPastePolicy = { file: "keep_both", directory: "merge", mismatch: "keep_both" };

let testDir: string;
let src: string;
let dst: string;
let trash: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-packages-"));
  src = join(testDir, "src");
  dst = join(testDir, "dst");
  trash = join(testDir, "trash");
  await mkdir(src);
  await mkdir(dst);
  await mkdir(trash);
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function makeApp(folder: string, version: string, extraFile: string) {
  await mkdir(join(folder, "Foo.app", "Contents"), { recursive: true });
  await writeFile(join(folder, "Foo.app", "Contents", "Info.plist"), version);
  await writeFile(join(folder, "Foo.app", "Contents", extraFile), extraFile);
}

describe("a package that clashes with one already there", () => {
  it("is reviewed as one item, with nothing inside it asked about", async () => {
    await makeApp(src, "v2", "new.png");
    await makeApp(dst, "v1", "old.png");

    const { report } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Foo.app")],
      destinationDirectoryPath: dst,
      policy: { file: "skip", directory: "skip", mismatch: "skip" },
    });

    expect(report.nodes[0]?.conflictClass).toBe("file_conflict");
    expect(report.nodes[0]?.destinationOnly).toBeNull();
    expect(report.summary).toMatchObject({ fileConflictCount: 1, directoryConflictCount: 0 });
  });

  it("is left whole by Add Missing", async () => {
    await makeApp(src, "v2", "new.png");
    await makeApp(dst, "v1", "old.png");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Foo.app")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(result?.items[0]?.status).toBe("skipped");
    expect((await readdir(join(dst, "Foo.app", "Contents"))).sort()).toEqual([
      "Info.plist",
      "old.png",
    ]);
  });

  it("is kept beside the existing one by Keep All, under a copy name", async () => {
    await makeApp(src, "v2", "new.png");
    await makeApp(dst, "v1", "old.png");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Foo.app")],
      destinationDirectoryPath: dst,
      policy: KEEP_ALL,
    });

    expect(result?.status).toBe("completed");
    expect((await readdir(dst)).sort()).toEqual(["Foo copy.app", "Foo.app"]);
    expect(await readFile(join(dst, "Foo copy.app", "Contents", "Info.plist"), "utf8")).toBe("v2");
    expect((await readdir(join(dst, "Foo.app", "Contents"))).sort()).toEqual([
      "Info.plist",
      "old.png",
    ]);
  });

  it("replaces the existing one whole, keeping nothing of it", async () => {
    await makeApp(src, "v2", "new.png");
    await makeApp(dst, "v1", "old.png");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Foo.app")],
      destinationDirectoryPath: dst,
      policy: REPLACE_ALL,
      fileSystem: nativeFileSystemWithTrash(trash),
    });

    expect(result?.status).toBe("completed");
    expect((await readdir(join(dst, "Foo.app", "Contents"))).sort()).toEqual([
      "Info.plist",
      "new.png",
    ]);
    expect(await readdir(trash)).toEqual(["1-Foo.app"]);
  });

  it("isn't merged when a Merge answer is given for it by its own choice", async () => {
    await makeApp(src, "v2", "new.png");
    await makeApp(dst, "v1", "old.png");

    const { result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Foo.app")],
      destinationDirectoryPath: dst,
      // "merge" for folders reaches a package only as an override the review never offers.
      policy: { file: "skip", directory: "merge", mismatch: "skip" },
    });

    expect(result?.items[0]?.status).toBe("skipped");
    expect(await readFile(join(dst, "Foo.app", "Contents", "Info.plist"), "utf8")).toBe("v1");
  });

  it("appearing at the destination during the paste is asked about without Merge", async () => {
    await makeApp(src, "v2", "new.png");

    const { conflicts } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Foo.app")],
      destinationDirectoryPath: dst,
      beforeExecute: () => makeApp(dst, "v1", "old.png"),
      resolve: () => "skip",
    });

    expect(conflicts.map((conflict) => [conflict.reason, conflict.conflictClass])).toEqual([
      ["destination_created", "file_conflict"],
    ]);
  });

  it("still merges two plain folders", async () => {
    await mkdir(join(src, "Photos"));
    await writeFile(join(src, "Photos", "new.jpg"), "new");
    await mkdir(join(dst, "Photos"));
    await writeFile(join(dst, "Photos", "old.jpg"), "old");

    const { report, result } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Photos")],
      destinationDirectoryPath: dst,
      policy: KEEP_EXISTING,
    });

    expect(report.nodes[0]?.conflictClass).toBe("directory_conflict");
    expect(result?.status).toBe("completed");
    expect((await readdir(join(dst, "Photos"))).sort()).toEqual(["new.jpg", "old.jpg"]);
  });
});

// Like Finder, a copy of a package keeps its extension at the end, whichever packages macOS
// knows: "Backup copy.sparsebundle", never "Backup.sparsebundle copy".
describe("the name of a package's copy", () => {
  const PACKAGES = ["Backup.sparsebundle", "Flow.workflow", "Foo.app"];

  it("has “copy” before the extension when duplicated", async () => {
    for (const name of PACKAGES) {
      await mkdir(join(src, name));
    }
    await mkdir(join(src, "Notes.v2"));

    await runPaste({
      mode: "copy",
      sourcePaths: [...PACKAGES, "Notes.v2"].map((name) => join(src, name)),
      destinationDirectoryPath: src,
    });

    expect((await readdir(src)).sort()).toEqual([
      "Backup copy.sparsebundle",
      "Backup.sparsebundle",
      "Flow copy.workflow",
      "Flow.workflow",
      "Foo copy.app",
      "Foo.app",
      "Notes.v2",
      "Notes.v2 copy",
    ]);
  });

  it("has “copy” before the extension when Keep Both keeps it beside the old one", async () => {
    await mkdir(join(src, "Model.custompkg"));
    await mkdir(join(dst, "Model.custompkg"));
    // A package by its package bit or an app's document type, not by a known extension.
    const fileSystem: WriteServiceFileSystem = {
      ...nativeFileSystem,
      isPackage: async (path) => path.endsWith(".custompkg"),
    };

    const { report } = await runPaste({
      mode: "copy",
      sourcePaths: [join(src, "Model.custompkg")],
      destinationDirectoryPath: dst,
      policy: KEEP_ALL,
      fileSystem,
    });

    expect(report.nodes[0]?.keepBothDestinationPath).toBe(join(dst, "Model copy.custompkg"));
    expect((await readdir(dst)).sort()).toEqual(["Model copy.custompkg", "Model.custompkg"]);
  });
});

describe("isPackageFolder", () => {
  it("asks macOS, and knows a folder without a package extension isn't one", async () => {
    await mkdir(join(src, "Foo.app"));
    await mkdir(join(src, "plain.d"));
    expect(await isPackageFolder(nativeFileSystem, join(src, "Foo.app"))).toBe(true);
    expect(await isPackageFolder(nativeFileSystem, join(src, "plain.d"))).toBe(false);
  });

  it("goes by the extension when macOS can't be asked or doesn't know", async () => {
    const { isPackage: _isPackage, ...withoutNative } = nativeFileSystem;
    const unknown: WriteServiceFileSystem = { ...nativeFileSystem, isPackage: async () => null };
    const failing: WriteServiceFileSystem = {
      ...nativeFileSystem,
      isPackage: async () => {
        throw new Error("Launch Services didn't answer");
      },
    };
    for (const fileSystem of [withoutNative, unknown, failing]) {
      expect(await isPackageFolder(fileSystem, join(src, "Talk.key"))).toBe(true);
      expect(await isPackageFolder(fileSystem, join(src, "Notes"))).toBe(false);
    }
  });
});
