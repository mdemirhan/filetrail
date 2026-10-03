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

export function mountTestDiskImage(
  options: { sizeMb?: number; caseSensitive?: boolean; name?: string } = {},
): TestDiskImage {
  const root = mkdtempSync(join(tmpdir(), "filetrail-volume-"));
  const imagePath = join(root, "volume.dmg");
  const mountPath = join(root, "mnt");
  execFileSync(
    "/usr/bin/hdiutil",
    [
      "create",
      "-quiet",
      "-size",
      `${options.sizeMb ?? 64}m`,
      "-fs",
      options.caseSensitive ? "Case-sensitive APFS" : "APFS",
      "-volname",
      options.name ?? "FileTrailTest",
      imagePath,
    ],
    { stdio: "pipe" },
  );
  execFileSync(
    "/usr/bin/hdiutil",
    ["attach", "-quiet", "-nobrowse", "-noverify", "-mountpoint", mountPath, imagePath],
    { stdio: "pipe" },
  );
  let detached = false;
  return {
    mountPath: realpathSync(mountPath),
    detach: () => {
      if (detached) {
        return;
      }
      detached = true;
      try {
        execFileSync("/usr/bin/hdiutil", ["detach", "-quiet", "-force", mountPath], {
          stdio: "pipe",
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  };
}
