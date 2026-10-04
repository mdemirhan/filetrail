// A small disk image mounted for a test, for what one volume can't show: moving to
// another disk, a case-sensitive disk, a copy that isn't a clone (so it takes a while).
// macOS only; `hdiutil` needs no special rights for images in a temporary folder.

import { execFileSync, spawn } from "node:child_process";
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export type TestDiskImage = {
  // Where the volume is mounted (its real path, so it compares equal to what realpath says).
  mountPath: string;
  detach: () => void;
};

export const canMountDiskImages =
  process.platform === "darwin" && existsSync("/usr/bin/hdiutil") && process.env.CI !== "skip";

// The tests that write files of 80 to 150 MB (stopping a long copy, filling a disk) guard
// copy code that rarely changes: they run in `bun run test:release` and `bun run ci`, not on
// every `bun run test`, to spare the Mac's disk.
export const canRunLargeFileTests =
  canMountDiskImages && process.env.FILETRAIL_LARGE_FILE_TESTS === "1";

// The file systems a test disk can have: USB sticks and SD cards are FAT32 or exFAT.
export type TestDiskFormat = "APFS" | "Case-sensitive APFS" | "MS-DOS FAT32" | "ExFAT";

export function mountTestDiskImage(
  options: {
    sizeMb?: number;
    caseSensitive?: boolean;
    name?: string;
    format?: TestDiskFormat;
  } = {},
): TestDiskImage {
  // In the system's temporary folder, not the test file's (see tmpdirPerTestFile): a disk
  // that is still busy is detached in the background, after that folder is gone.
  const root = mkdtempSync(
    join(process.env.FILETRAIL_SYSTEM_TMPDIR ?? tmpdir(), "filetrail-volume-"),
  );
  const imagePath = join(root, "volume.sparseimage");
  const mountPath = join(root, "mnt");
  const format = options.format ?? (options.caseSensitive ? "Case-sensitive APFS" : "APFS");
  // FAT volume names are at most 11 upper-case characters.
  const volumeName =
    format === "MS-DOS FAT32"
      ? (options.name ?? "FTTEST").toUpperCase().slice(0, 11)
      : (options.name ?? "FileTrailTest");
  const template = blankDiskImage(format, options.sizeMb ?? 64, volumeName);
  // A clone of the blank disk: a fresh, empty disk in a few milliseconds.
  copyFileSync(template, imagePath, constants.COPYFILE_FICLONE);
  try {
    runHdiutil(["attach", "-quiet", "-nobrowse", "-noverify", "-mountpoint", mountPath, imagePath]);
  } catch (error) {
    // A blank disk that can't be mounted is made again by the next test that needs it.
    rmSync(template, { force: true });
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  let detached = false;
  return {
    mountPath: realpathSync(mountPath),
    detach: () => {
      if (detached) {
        return;
      }
      detached = true;
      try {
        runHdiutil(["detach", "-quiet", "-force", mountPath]);
      } catch {
        // Still busy (Spotlight or another test's hdiutil): it is tried again in the
        // background, so a test that passed doesn't fail over its cleanup. The folder is
        // removed only once the disk is gone, never through the mounted volume.
        spawn(
          "/bin/sh",
          [
            "-c",
            'sleep 5; /usr/bin/hdiutil detach -quiet -force "$1" && rm -rf "$2"',
            "detach",
            mountPath,
            root,
          ],
          { detached: true, stdio: "ignore" },
        ).unref();
        return;
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// Making a disk image takes about a second; cloning one takes milliseconds. So each kind of
// blank disk (format, size and name) is made once and kept between runs, beside the
// background copy of Electron the tests run on, and every test disk is a clone of it. The
// clones share the blank disk's volume UUID, which nothing here goes by: the app tells disks
// apart by device number, which each mounted disk has its own of.
const BLANK_DISK_CACHE = fileURLToPath(
  new URL("../../../../node_modules/.cache/filetrail-test-disks/", import.meta.url),
);

function blankDiskImage(format: TestDiskFormat, sizeMb: number, volumeName: string): string {
  const path = join(
    BLANK_DISK_CACHE,
    `${format.replaceAll(" ", "-")}-${sizeMb}m-${volumeName}.sparseimage`,
  );
  if (existsSync(path)) {
    return path;
  }
  mkdirSync(BLANK_DISK_CACHE, { recursive: true });
  // Made beside its final place and renamed into it, so two test files making the same one
  // at once, or a run that stops halfway, never leave a broken one.
  const partialPath = join(BLANK_DISK_CACHE, `partial-${process.pid}-${Date.now()}.sparseimage`);
  try {
    runHdiutil([
      "create",
      "-quiet",
      // A retry after a failed attempt replaces whatever that attempt left.
      "-ov",
      // Grows as it is written to: a plain image is written out in full when it is made.
      "-type",
      "SPARSE",
      "-size",
      `${sizeMb}m`,
      "-fs",
      format,
      "-volname",
      volumeName,
      partialPath,
    ]);
    renameSync(partialPath, path);
  } finally {
    rmSync(partialPath, { force: true });
  }
  return path;
}

// Test files run side by side, and hdiutil sometimes refuses to create or attach an image
// while another one is busy ("Resource busy"): it is tried again a few times.
function runHdiutil(args: string[]): void {
  const attempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      execFileSync("/usr/bin/hdiutil", args, { stdio: "pipe" });
      return;
    } catch (error) {
      if (attempt >= attempts) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();
        throw new Error(`hdiutil ${args[0]} failed: ${stderr || String(error)}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}
