// A link pasted keeps its own tags, as Finder's copy does: it is copied as the link itself.

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readlink, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nativeFileSystem, runPaste } from "./testNativePaste";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "filetrail-symlink-metadata-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

// Without rename, a move copies, as to another disk.
const { rename: _rename, renameExclusive: _renameExclusive, ...withoutRename } = nativeFileSystem;

function linkAttribute(path: string): string {
  return execFileSync("xattr", ["-s", "-p", "com.example.tag", path], { encoding: "utf8" }).trim();
}

describe("a link pasted", () => {
  it.each(["copy", "cut"] as const)(
    "keeps the link's own extended attributes (%s)",
    async (mode) => {
      const src = join(testDir, "src");
      const dst = join(testDir, "dst");
      await mkdir(join(src, "folder"), { recursive: true });
      await mkdir(dst);
      await symlink("nowhere.txt", join(src, "folder", "link"));
      execFileSync("xattr", ["-s", "-w", "com.example.tag", "red", join(src, "folder", "link")]);

      const { result } = await runPaste({
        mode,
        fileSystem: withoutRename,
        sourcePaths: [join(src, "folder")],
        destinationDirectoryPath: dst,
      });

      expect(result?.status).toBe("completed");
      expect(await readlink(join(dst, "folder", "link"))).toBe("nowhere.txt");
      expect(linkAttribute(join(dst, "folder", "link"))).toBe("red");
      if (mode === "cut") {
        expect(await readdir(testDir)).toEqual(["dst", "src"]);
        expect(await readdir(src)).toEqual([]);
      }
    },
  );
});
