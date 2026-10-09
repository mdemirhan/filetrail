import { describe, expect, it, vi } from "vitest";

import { NO_TRASH_ERROR_CODE } from "@filetrail/core";

import { createTrashItem } from "./trashItem";

const HOME = "/Users/demo";
const STARTUP_DEV = 16777231;

function createFs(devices: Record<string, number>, flags: Record<string, number> = {}) {
  return {
    lstat: vi.fn(async (path: string) => {
      const dev = devices[path];
      if (dev === undefined) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      }
      return { dev };
    }),
    getFlags: vi.fn(async (path: string) => flags[path] ?? 0),
  };
}

const refusal = new Error("“a.txt” couldn’t be moved to the trash because it’s in use.");

describe("createTrashItem", () => {
  it("moves the item to the Trash", async () => {
    const trash = vi.fn(async () => "/Users/demo/.Trash/a 2.txt");
    const trashItem = createTrashItem({ trash, fs: createFs({}), homePath: HOME });

    await expect(trashItem("/Users/demo/a.txt")).resolves.toBe("/Users/demo/.Trash/a 2.txt");

    expect(trash).toHaveBeenCalledWith("/Users/demo/a.txt");
  });

  it("gives the Trash's own reason on the startup disk, never suggesting to delete", async () => {
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw refusal;
      }),
      fs: createFs({ [HOME]: STARTUP_DEV, "/Users/demo/a.txt": STARTUP_DEV }),
      homePath: HOME,
    });

    const error = await trashItem("/Users/demo/a.txt").catch((reason: unknown) => reason);

    expect(error).toMatchObject({ message: refusal.message });
    expect((error as NodeJS.ErrnoException).code).toBeUndefined();
  });

  it("says a locked item is locked", async () => {
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw refusal;
      }),
      fs: createFs(
        { [HOME]: STARTUP_DEV, "/Users/demo/a.txt": STARTUP_DEV },
        { "/Users/demo/a.txt": 0x2 },
      ),
      homePath: HOME,
    });

    await expect(trashItem("/Users/demo/a.txt")).rejects.toThrow(
      "“a.txt” is locked. Unlock it in Finder's Get Info and try again.",
    );
  });

  // A network share or some USB drives have no Trash: only there may deleting be offered.
  // The Trash says so with NSFeatureUnsupportedError, which nativeTrashItem gives as ENOTSUP.
  it("marks a disk the Trash says has none (ENOTSUP) as one that may have no Trash", async () => {
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw Object.assign(
          new Error(
            "“a.txt” couldn’t be moved to the trash because the volume “Share” doesn’t have one.",
          ),
          { code: "ENOTSUP", cocoaCode: 3328 },
        );
      }),
      fs: createFs({ [HOME]: STARTUP_DEV, "/Volumes/Share/a.txt": 50 }),
      homePath: HOME,
    });

    await expect(trashItem("/Volumes/Share/a.txt")).rejects.toMatchObject({
      code: NO_TRASH_ERROR_CODE,
      message: "“a.txt” couldn’t be moved to the Trash. This disk may not have a Trash.",
    });
  });

  // A failure the Trash gives no errno for (NSFileWriteUnknownError, say) says nothing about
  // the disk having no Trash: taken for one, it offered to delete for good with that reason.
  it("gives the Trash's own reason on another disk for a failure it gives no code for", async () => {
    const reason = Object.assign(new Error("“a.txt” couldn’t be moved to the trash."), {
      cocoaCode: 512,
    });
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw reason;
      }),
      fs: createFs({ [HOME]: STARTUP_DEV, "/Volumes/Share/a.txt": 50 }),
      homePath: HOME,
    });

    const error = await trashItem("/Volumes/Share/a.txt").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: reason.message });
    expect((error as NodeJS.ErrnoException).code).not.toBe(NO_TRASH_ERROR_CODE);
  });

  // A network share without a Trash often answers with no errno once something was trashed:
  // the kind of disk tells then.
  it("marks a failure with no code on a disk taken to have no Trash", async () => {
    const reason = Object.assign(new Error("“a.txt” couldn’t be moved to the trash."), {
      cocoaCode: 512,
    });
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw reason;
      }),
      fs: createFs({ [HOME]: STARTUP_DEV, "/Volumes/Share/a.txt": 50 }),
      homePath: HOME,
      diskHasTrash: (path) => !path.startsWith("/Volumes/Share/"),
    });

    const error = await trashItem("/Volumes/Share/a.txt").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: NO_TRASH_ERROR_CODE, cause: reason });
  });

  it("keeps the Trash's reason for a failure with a code on a disk taken to have no Trash", async () => {
    const reason = Object.assign(new Error("The disk is full."), { code: "ENOSPC" });
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw reason;
      }),
      fs: createFs({ [HOME]: STARTUP_DEV, "/Volumes/Share/a.txt": 50 }),
      homePath: HOME,
      diskHasTrash: () => false,
    });

    const error = await trashItem("/Volumes/Share/a.txt").catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: reason.message });
    expect((error as NodeJS.ErrnoException).code).not.toBe(NO_TRASH_ERROR_CODE);
  });

  // Deleting for good must never be offered for these: the disk has a Trash, the item
  // just couldn't go to it.
  it.each(["EACCES", "EPERM", "EROFS", "ENOENT", "EIO", "ENOSPC", "ECANCELED", "EINVAL"])(
    "gives the Trash's own reason on another disk for %s",
    async (code) => {
      const reason = Object.assign(new Error("You don’t have permission to access “a.txt”."), {
        code,
      });
      const trashItem = createTrashItem({
        trash: vi.fn(async () => {
          throw reason;
        }),
        fs: createFs({ [HOME]: STARTUP_DEV, "/Volumes/USB/a.txt": 50 }),
        homePath: HOME,
      });

      const error = await trashItem("/Volumes/USB/a.txt").catch((caught: unknown) => caught);

      expect(error).toMatchObject({ message: reason.message });
      expect((error as NodeJS.ErrnoException).code).not.toBe(NO_TRASH_ERROR_CODE);
    },
  );

  it("gives the Trash's reason for an item that is gone", async () => {
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw refusal;
      }),
      fs: createFs({ [HOME]: STARTUP_DEV }),
      homePath: HOME,
    });

    await expect(trashItem("/Volumes/Share/a.txt")).rejects.toThrow(refusal.message);
  });
});
