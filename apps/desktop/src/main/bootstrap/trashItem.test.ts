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
    const trash = vi.fn(async () => undefined);
    const trashItem = createTrashItem({ trash, fs: createFs({}), homePath: HOME });

    await trashItem("/Users/demo/a.txt");

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
  it("marks a failure on another disk as one that may have no Trash", async () => {
    const trashItem = createTrashItem({
      trash: vi.fn(async () => {
        throw new Error("The operation couldn’t be completed.");
      }),
      fs: createFs({ [HOME]: STARTUP_DEV, "/Volumes/Share/a.txt": 50 }),
      homePath: HOME,
    });

    await expect(trashItem("/Volumes/Share/a.txt")).rejects.toMatchObject({
      code: NO_TRASH_ERROR_CODE,
      message: "“a.txt” couldn’t be moved to the Trash. This disk may not have a Trash.",
    });
  });

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
