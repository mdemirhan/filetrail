import { describe, expect, it } from "vitest";

import {
  type FolderSizeStats,
  type HomeTrash,
  type ItemSize,
  type RemovedItem,
  adjustForRemovals,
} from "./folderSizeAdjust";
import { FolderSizeCache } from "./folderSizeCache";

const DISK = 16;
const OTHER_DISK = 17;
const TRASH = "/Users/demo/.Trash";

// Stored by one measurement unless said otherwise.
function stats(
  sizeBytes: number,
  fileCount = 1,
  folderCount = 0,
  dev = DISK,
  measurement = 1,
): FolderSizeStats {
  return { sizeBytes, diskBytes: sizeBytes * 2, fileCount, folderCount, dev, measurement };
}

// Stored by a measurement of its own, made later.
function measuredAgain(sizeBytes: number, fileCount = 1, folderCount = 0): FolderSizeStats {
  return stats(sizeBytes, fileCount, folderCount, DISK, 2);
}

const file = (sizeBytes: number, dev = DISK): ItemSize => ({
  kind: "file",
  sizeBytes,
  diskBytes: sizeBytes * 2,
  dev,
});
const folder = (dev = DISK): ItemSize => ({ kind: "folder", sizeBytes: 0, diskBytes: 0, dev });

function deleted(path: string, item: ItemSize | null): RemovedItem {
  return { path, item, intoHomeTrash: false };
}

function trashed(path: string, item: ItemSize | null, intoHomeTrash: boolean | null = true) {
  return { path, item, intoHomeTrash };
}

function adjust(
  entries: Record<string, FolderSizeStats>,
  removals: RemovedItem[],
  counted: HomeTrash["counted"] = null,
): Record<string, FolderSizeStats> {
  const cache = new FolderSizeCache(Number.POSITIVE_INFINITY);
  for (const [path, entry] of Object.entries(entries)) {
    cache.store(path, entry);
  }
  adjustForRemovals(cache, removals, { path: TRASH, counted });
  return Object.fromEntries(cache.entries());
}

describe("adjustForRemovals", () => {
  it("takes a deleted file off every measured folder that held it", () => {
    expect(
      adjust(
        {
          "/Users/demo": stats(1_000, 10, 3),
          "/Users/demo/Downloads": stats(600, 6, 1),
          "/Users/demo/Downloads/zips": stats(500, 5),
          "/Users/demo/Music": stats(300, 3),
        },
        [deleted("/Users/demo/Downloads/zips/a.zip", file(200))],
      ),
    ).toEqual({
      "/Users/demo": stats(800, 9, 3),
      "/Users/demo/Downloads": stats(400, 5, 1),
      "/Users/demo/Downloads/zips": stats(300, 4),
      "/Users/demo/Music": stats(300, 3),
    });
  });

  it("takes a deleted folder off with everything in it, and forgets its own sizes", () => {
    expect(
      adjust(
        {
          "/Users/demo": stats(1_000, 10, 4),
          "/Users/demo/Old": stats(400, 4, 1),
          "/Users/demo/Old/inner": stats(100, 1),
        },
        [deleted("/Users/demo/Old", folder())],
      ),
    ).toEqual({
      // 4 files, and the folder with the 1 folder inside it.
      "/Users/demo": stats(600, 6, 2),
    });
  });

  it("takes off nothing for items a measurement doesn't count, like a pipe", () => {
    const entries = { "/Users/demo": stats(1_000, 10) };
    expect(
      adjust(entries, [
        deleted("/Users/demo/pipe", { kind: "other", sizeBytes: 0, diskBytes: 0, dev: DISK }),
      ]),
    ).toEqual(entries);
  });

  it("forgets the folders that held what couldn't be read first or measured", () => {
    const entries = {
      "/Users/demo": stats(1_000, 10, 2),
      "/Users/demo/Music": stats(300, 3),
    };
    // Gone before it was read.
    expect(adjust(entries, [deleted("/Users/demo/a.txt", null)])).toEqual({
      "/Users/demo/Music": stats(300, 3),
    });
    // A folder whose own size isn't known.
    expect(adjust(entries, [deleted("/Users/demo/Old", folder())])).toEqual({
      "/Users/demo/Music": stats(300, 3),
    });
  });

  it("forgets a folder whose measurement may not have reached the item", () => {
    // Nothing known for Private: it may not have been readable when Users/demo was measured.
    expect(
      adjust(
        {
          "/Users/demo": stats(1_000, 10, 2),
          "/Users/demo/Private/notes": stats(100, 1),
        },
        [deleted("/Users/demo/Private/notes/a.txt", file(40))],
      ),
    ).toEqual({ "/Users/demo/Private/notes": stats(60, 0) });
  });

  it("leaves a folder measured on another disk, whose measurement stopped at the disk", () => {
    expect(
      adjust(
        {
          "/": stats(5_000, 50, 10, OTHER_DISK),
          "/Users": stats(1_000, 10, 2),
          "/Users/demo": stats(1_000, 10, 1),
        },
        [deleted("/Users/demo/a.txt", file(100))],
      ),
    ).toEqual({
      "/": stats(5_000, 50, 10, OTHER_DISK),
      "/Users": stats(900, 9, 2),
      "/Users/demo": stats(900, 9, 1),
    });
  });

  it("counts a folder on another disk (a mount point) as one folder and nothing inside", () => {
    expect(
      adjust({ "/Users/demo": stats(1_000, 10, 3) }, [
        deleted("/Users/demo/mounted", folder(OTHER_DISK)),
      ]),
    ).toEqual({ "/Users/demo": stats(1_000, 10, 2) });
  });

  it("forgets a folder its change would take below zero", () => {
    expect(
      adjust({ "/Users/demo": stats(100, 1) }, [deleted("/Users/demo/a.txt", file(500))]),
    ).toEqual({});
  });

  // Folder 100 MB with Inner 50 MB in it; Inner grew to 80 MB and was measured again on
  // its own. Taking 80 MB off Folder's 100 left 20 MB where 50 MB remained.
  it("forgets a folder rather than take off a folder inside measured again since", () => {
    expect(
      adjust(
        {
          "/Users/demo/Folder": stats(100, 10, 1),
          "/Users/demo/Folder/Inner": measuredAgain(80, 8),
        },
        [deleted("/Users/demo/Folder/Inner", folder())],
      ),
    ).toEqual({});
  });

  it("forgets a folder rather than reach the item through a folder measured on its own", () => {
    // "/" was measured, and /Users measured again by itself later.
    expect(
      adjust(
        {
          "/": stats(9_000, 90, 20),
          "/Users": measuredAgain(1_000, 10, 2),
          "/Users/demo": measuredAgain(1_000, 10, 1),
        },
        [deleted("/Users/demo/a.txt", file(100))],
      ),
    ).toEqual({
      "/Users": measuredAgain(900, 9, 2),
      "/Users/demo": measuredAgain(900, 9, 1),
    });
  });

  it("takes a measured folder off the measured folder holding it, and forgets its own sizes", () => {
    expect(
      adjust(
        {
          "/Users/demo": stats(1_000, 10, 3),
          "/Users/demo/Work": stats(400, 4, 1),
          "/Users/demo/Work/inner": stats(100, 1),
        },
        [deleted("/Users/demo/Work", folder())],
      ),
    ).toEqual({ "/Users/demo": stats(600, 6, 1) });
    // Measured on its own after the folder holding it, it may not be what that one counted.
    expect(
      adjust(
        {
          "/Users/demo": stats(1_000, 10, 3),
          "/Users/demo/Work": measuredAgain(400, 4, 1),
        },
        [deleted("/Users/demo/Work", folder())],
      ),
    ).toEqual({});
  });

  // A link to a folder is counted as itself and never walked: what is reached through it
  // was never counted by the folders holding the link.
  it("forgets the folders holding a link that an item was removed through", () => {
    expect(
      adjust(
        {
          "/Users/demo": stats(1_000, 10, 3),
          "/Users/demo/link/notes": measuredAgain(300, 3),
        },
        [deleted("/Users/demo/link/notes/a.txt", file(100))],
      ),
    ).toEqual({ "/Users/demo/link/notes": measuredAgain(200, 2) });
  });

  it("takes several items off one after another", () => {
    expect(
      adjust({ "/Users/demo": stats(1_000, 10) }, [
        deleted("/Users/demo/a.txt", file(100)),
        deleted("/Users/demo/b.txt", file(200)),
      ]),
    ).toEqual({ "/Users/demo": stats(700, 8) });
  });

  describe("moved to the Trash", () => {
    const entries = {
      "/Users/demo": stats(1_000, 10, 3),
      "/Users/demo/Downloads": stats(600, 6),
      [TRASH]: stats(50, 1),
    };

    it("keeps the size of a folder that counted the Trash, and adds to the Trash", () => {
      expect(adjust(entries, [trashed("/Users/demo/Downloads/a.zip", file(200))], true)).toEqual({
        "/Users/demo": stats(1_000, 10, 3),
        "/Users/demo/Downloads": stats(400, 5),
        [TRASH]: stats(250, 2),
      });
    });

    it("takes it off a folder that couldn't read the Trash", () => {
      const { [TRASH]: _trash, ...unreadable } = entries;
      expect(
        adjust(unreadable, [trashed("/Users/demo/Downloads/a.zip", file(200))], false),
      ).toEqual({
        "/Users/demo": stats(800, 9, 3),
        "/Users/demo/Downloads": stats(400, 5),
      });
    });

    it("forgets the folders holding the Trash while it isn't known whether it was read", () => {
      expect(adjust(entries, [trashed("/Users/demo/Downloads/a.zip", file(200))], null)).toEqual({
        "/Users/demo/Downloads": stats(400, 5),
        // Its own size is known: the item lands at its top.
        [TRASH]: stats(250, 2),
      });
    });

    it("adds what comes from outside the home folder to the folders holding the Trash", () => {
      expect(
        adjust(
          {
            "/": stats(9_000, 90, 20),
            "/Users": stats(1_000, 10, 4),
            "/Users/demo": stats(1_000, 10, 3),
            "/opt": stats(500, 5, 1),
            "/opt/tools": stats(300, 3),
          },
          [trashed("/opt/tools/old", file(100))],
          true,
        ),
      ).toEqual({
        // Moved within what it counted.
        "/": stats(9_000, 90, 20),
        "/Users": stats(1_100, 11, 4),
        "/Users/demo": stats(1_100, 11, 3),
        "/opt": stats(400, 4, 1),
        "/opt/tools": stats(200, 2),
      });
    });

    it("forgets the folders holding the Trash when it isn't known where an item went", () => {
      expect(adjust(entries, [trashed("/Users/demo/Downloads/a.zip", null, null)], true)).toEqual(
        {},
      );
    });

    // Deleting from the Trash: whether the folders holding it counted the item depends on
    // whether their measurement walked into the Trash, which the sizes on the way show.
    describe("deleted from the Trash", () => {
      const inTrash = `${TRASH}/old.zip`;

      it("takes it off the Trash and the folders that counted the Trash", () => {
        for (const counted of [true, false, null]) {
          expect(adjust(entries, [deleted(inTrash, file(20))], counted)).toEqual({
            "/Users/demo": stats(980, 9, 3),
            "/Users/demo/Downloads": stats(600, 6),
            [TRASH]: stats(30, 0),
          });
        }
      });

      it("forgets the folders holding the Trash when it has no size of the same measurement", () => {
        const { [TRASH]: _trash, ...unread } = entries;
        for (const counted of [true, false, null]) {
          expect(adjust(unread, [deleted(inTrash, file(20))], counted)).toEqual({
            "/Users/demo/Downloads": stats(600, 6),
          });
          expect(
            adjust(
              { ...unread, [TRASH]: measuredAgain(50, 1) },
              [deleted(inTrash, file(20))],
              counted,
            ),
          ).toEqual({ "/Users/demo/Downloads": stats(600, 6), [TRASH]: measuredAgain(30, 0) });
        }
      });
    });

    it("takes off what went to another disk's Trash, which no measurement reads", () => {
      expect(
        adjust(entries, [trashed("/Users/demo/Downloads/a.zip", file(200), false)], true),
      ).toEqual({
        "/Users/demo": stats(800, 9, 3),
        "/Users/demo/Downloads": stats(400, 5),
        [TRASH]: stats(50, 1),
      });
    });
  });
});
