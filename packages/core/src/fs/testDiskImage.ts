// A small disk image mounted for a test, for what one volume can't show: moving to
// another disk, a case-sensitive disk, a copy that isn't a clone (so it takes a while).
// macOS only; `hdiutil` needs no special rights for images in a temporary folder.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type TestDiskImage = {
  // Where the volume is mounted (its real path, so it compares equal to what realpath says).
  mountPath: string;
  detach: () => void;
};

export const canMountDiskImages =
  process.platform === "darwin" && existsSync("/usr/bin/hdiutil") && process.env.CI !== "skip";

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
  const root = mkdtempSync(join(tmpdir(), "filetrail-volume-"));
  const imagePath = join(root, "volume.dmg");
  const mountPath = join(root, "mnt");
  runHdiutil([
    "create",
    "-quiet",
    // A retry after a failed attempt replaces whatever that attempt left.
    "-ov",
    "-size",
    `${options.sizeMb ?? 64}m`,
    "-fs",
    options.format ?? (options.caseSensitive ? "Case-sensitive APFS" : "APFS"),
    "-volname",
    // FAT volume names are at most 11 upper-case characters.
    options.format === "MS-DOS FAT32"
      ? (options.name ?? "FTTEST").toUpperCase().slice(0, 11)
      : (options.name ?? "FileTrailTest"),
    imagePath,
  ]);
  runHdiutil(["attach", "-quiet", "-nobrowse", "-noverify", "-mountpoint", mountPath, imagePath]);
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
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
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
