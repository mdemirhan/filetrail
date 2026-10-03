import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canMountDiskImages, mountTestDiskImage } from "@filetrail/core/fs/testDiskImage";

import { getDiskIds } from "./diskIds";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "filetrail-disk-ids-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("getDiskIds", () => {
  it("gives folders on one disk the same id, and null for a path that isn't there", async () => {
    await mkdir(join(root, "a"));
    await mkdir(join(root, "b"));

    const { ids } = await getDiskIds({
      paths: [join(root, "a"), join(root, "b"), join(root, "missing")],
    });

    expect(ids[0]).toEqual(expect.any(Number));
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBeNull();
  });

  // Disks can be mounted anywhere, not only in /Volumes, and a link can lead to one.
  it.runIf(canMountDiskImages)(
    "tells another disk apart wherever it is mounted, also through a link",
    async () => {
      const volume = mountTestDiskImage();
      try {
        await symlink(volume.mountPath, join(root, "link to disk"));

        const { ids } = await getDiskIds({
          paths: [root, volume.mountPath, join(root, "link to disk")],
        });

        expect(ids[1]).not.toBe(ids[0]);
        expect(ids[2]).toBe(ids[1]);
      } finally {
        volume.detach();
      }
    },
    30_000,
  );
});
