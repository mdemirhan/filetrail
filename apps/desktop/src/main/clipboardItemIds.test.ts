import { createClipboardItemIds } from "./clipboardItemIds";

const copied = (paths: string[], capturedAt = "2026-10-08T10:00:00.000Z") => ({
  type: "ready" as const,
  mode: "copy" as const,
  sourcePaths: paths,
  sourceEntries: {},
  capturedAt,
});

describe("which item each clipboard path was when copied", () => {
  it("reads each item when it arrives, and keeps what paths that stay had", async () => {
    let ino = 0;
    const readItemId = vi.fn(async (_path: string) => {
      ino += 1;
      return { dev: 1, ino };
    });
    const ids = createClipboardItemIds(readItemId);

    ids.update(copied(["/a.txt", "/b.txt"]), { copied: true });
    // The app moved b.txt; the clipboard followed it.
    ids.update(copied(["/a.txt", "/Folder/b.txt"]), {
      copied: false,
      followedTo: ["/Folder/b.txt"],
    });

    expect(readItemId.mock.calls.map(([path]) => path)).toEqual([
      "/a.txt",
      "/b.txt",
      "/Folder/b.txt",
    ]);
    expect(await ids.expectedIds(["/a.txt", "/Folder/b.txt", "/elsewhere.txt"])).toEqual({
      "/a.txt": { dev: 1, ino: 1 },
      "/Folder/b.txt": { dev: 1, ino: 3 },
    });
  });

  // Copying the same item again reads it again: it may be another item than before.
  it("reads every item of a new Copy again, and a path an item was moved onto", async () => {
    let ino = 0;
    const ids = createClipboardItemIds(async () => {
      ino += 1;
      return { dev: 1, ino };
    });

    ids.update(copied(["/src/a", "/dst/a"]), { copied: true });
    // Move To took /src/a onto /dst/a (replacing it): the clipboard followed it there.
    ids.update(copied(["/dst/a"]), { copied: false, followedTo: ["/dst/a"] });
    expect(await ids.expectedIds(["/dst/a"])).toEqual({ "/dst/a": { dev: 1, ino: 3 } });

    ids.update(copied(["/dst/a"], "2026-10-08T10:05:00.000Z"), { copied: true });
    expect(await ids.expectedIds(["/dst/a"])).toEqual({ "/dst/a": { dev: 1, ino: 4 } });
  });

  // A change made while the ids are being read doesn't take any away.
  it("answers for the clipboard as it was when asked", async () => {
    let finishRead: (id: { dev: number; ino: number }) => void = () => undefined;
    const ids = createClipboardItemIds(
      (path) =>
        new Promise((resolve) => {
          if (path === "/a.txt") {
            finishRead = resolve;
          } else {
            resolve({ dev: 1, ino: 2 });
          }
        }),
    );
    ids.update(copied(["/a.txt", "/b.txt"]), { copied: true });

    const answer = ids.expectedIds(["/a.txt", "/b.txt"]);
    ids.update({ type: "empty" }, { copied: true });
    finishRead({ dev: 1, ino: 1 });

    expect(await answer).toEqual({ "/a.txt": { dev: 1, ino: 1 }, "/b.txt": { dev: 1, ino: 2 } });
  });

  it("knows nothing of an item that couldn't be read, or once the clipboard is empty", async () => {
    const ids = createClipboardItemIds(async (path) => {
      if (path === "/locked") {
        throw new Error("EACCES");
      }
      return path === "/no-id" ? null : { dev: 1, ino: 9 };
    });

    ids.update(copied(["/locked", "/no-id", "/a.txt"]), { copied: true });
    expect(await ids.expectedIds(["/locked", "/no-id", "/a.txt"])).toEqual({
      "/a.txt": { dev: 1, ino: 9 },
    });

    ids.update({ type: "empty" }, { copied: true });
    expect(await ids.expectedIds(["/a.txt"])).toEqual({});
  });
});
