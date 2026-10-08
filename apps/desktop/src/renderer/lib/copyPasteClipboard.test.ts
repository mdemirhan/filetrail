import {
  EMPTY_COPY_PASTE_CLIPBOARD,
  buildPasteRequest,
  clearClipboardAfterSuccessfulPaste,
  clearCopyPasteClipboard,
  describeClipboard,
  dropClipboardPaths,
  followClipboardThroughWrite,
  groupClipboardItemsByFolder,
  hasClipboardItems,
  listClipboardItems,
  remapClipboardPaths,
  removeClipboardItem,
  setCopyPasteClipboard,
} from "./copyPasteClipboard";
import type { WriteOperationResult } from "./explorerTypes";

function writeResult(
  action: WriteOperationResult["action"],
  items: Array<{
    sourcePath: string | null;
    destinationPath: string | null;
    status?: WriteOperationResult["items"][number]["status"];
  }>,
): WriteOperationResult {
  return {
    operationId: "op-1",
    action,
    status: "completed",
    targetPath: null,
    startedAt: NOW,
    finishedAt: NOW,
    summary: {
      topLevelItemCount: items.length,
      totalItemCount: items.length,
      completedItemCount: items.length,
      failedItemCount: 0,
      skippedItemCount: 0,
      cancelledItemCount: 0,
      completedByteCount: 0,
      totalBytes: null,
    },
    items: items.map((item) => ({
      sourcePath: item.sourcePath,
      destinationPath: item.destinationPath,
      status: item.status ?? "completed",
      error: null,
    })),
    error: null,
  };
}

const NOW = "2026-03-09T00:00:00.000Z";

describe("copyPasteClipboard", () => {
  it("names one item, and counts several", () => {
    expect(describeClipboard(EMPTY_COPY_PASTE_CLIPBOARD)).toBeNull();
    const one = describeClipboard(
      setCopyPasteClipboard("copy", ["/tmp/a.txt"], NOW, {
        "/tmp/a.txt": { kind: "file", isSymlink: false },
      }),
    );
    expect(one).toMatchObject({
      mode: "copy",
      count: 1,
      countLabel: "1 item copied",
      label: "a.txt copied",
      breakdown: null,
    });
    expect(one?.icon).toEqual({
      type: "item",
      entry: {
        path: "/tmp/a.txt",
        name: "a.txt",
        extension: "txt",
        kind: "file",
        isHidden: false,
        isSymlink: false,
      },
    });

    const many = describeClipboard(
      setCopyPasteClipboard("cut", ["/tmp/docs", "/tmp/a.txt", "/tmp/b.txt"], NOW, {
        "/tmp/docs": { kind: "directory", isSymlink: false },
        "/tmp/a.txt": { kind: "file", isSymlink: false },
        "/tmp/b.txt": { kind: "file", isSymlink: false },
      }),
    );
    expect(many).toMatchObject({
      mode: "cut",
      count: 3,
      countLabel: "3 items cut",
      label: "3 items cut",
      breakdown: "1 folder and 2 files",
      icon: { type: "items", contains: "mixed" },
    });
  });

  it("draws several folders, or several files, as a pair of their own icon", () => {
    const describe = (kind: "directory" | "file") =>
      describeClipboard(
        setCopyPasteClipboard("copy", ["/tmp/a", "/tmp/b"], NOW, {
          "/tmp/a": { kind, isSymlink: false },
          "/tmp/b": { kind, isSymlink: false },
        }),
      );
    expect(describe("directory")).toMatchObject({
      breakdown: "2 folders",
      icon: { type: "items", contains: "folders" },
    });
    expect(describe("file")).toMatchObject({
      breakdown: "2 files",
      icon: { type: "items", contains: "files" },
    });
  });

  it("does not guess what an item is when it was copied by path alone", () => {
    const summary = describeClipboard(setCopyPasteClipboard("copy", ["/tmp/a", "/tmp/b.md"], NOW));
    expect(summary?.breakdown).toBeNull();
    expect(summary?.icon).toEqual({ type: "items", contains: "mixed" });
    // macOS is asked for the icon of an item of unknown kind by its path.
    expect(summary?.items.map((item) => [item.entry.kind, item.isFolder])).toEqual([
      ["other", null],
      ["other", null],
    ]);
  });

  it("stores a copy clipboard payload with deduped paths", () => {
    expect(
      setCopyPasteClipboard("copy", ["/tmp/a", "/tmp/a", "/tmp/b"], NOW, {
        "/tmp/a": { kind: "directory", isSymlink: false },
        "/tmp/elsewhere": { kind: "file", isSymlink: false },
      }),
    ).toEqual({
      type: "ready",
      mode: "copy",
      sourcePaths: ["/tmp/a", "/tmp/b"],
      sourceEntries: { "/tmp/a": { kind: "directory", isSymlink: false } },
      capturedAt: NOW,
    });
  });

  it("takes one item off the clipboard, and empties it with the last", () => {
    const clipboard = setCopyPasteClipboard("cut", ["/tmp/a", "/tmp/b"], NOW, {
      "/tmp/a": { kind: "directory", isSymlink: false },
    });
    const withoutA = removeClipboardItem(clipboard, "/tmp/a");
    expect(withoutA).toEqual({
      type: "ready",
      mode: "cut",
      sourcePaths: ["/tmp/b"],
      sourceEntries: {},
      capturedAt: NOW,
    });
    expect(removeClipboardItem(withoutA, "/tmp/missing")).toBe(withoutA);
    expect(removeClipboardItem(withoutA, "/tmp/b")).toEqual(EMPTY_COPY_PASTE_CLIPBOARD);
  });

  it("groups the items under the folders they came from", () => {
    const items = listClipboardItems(
      setCopyPasteClipboard("copy", ["/Users/demo/a.txt", "/top", "/Users/demo/b.txt"], NOW),
    );
    expect(
      groupClipboardItemsByFolder(items).map((group) => [
        group.parentPath,
        group.label,
        group.items.map((item) => item.name),
      ]),
    ).toEqual([
      ["/Users/demo", "demo", ["a.txt", "b.txt"]],
      ["/", "/", ["top"]],
    ]);
  });

  it("clears to an empty clipboard state", () => {
    expect(clearCopyPasteClipboard()).toEqual(EMPTY_COPY_PASTE_CLIPBOARD);
  });

  it("builds a paste request only when clipboard state is ready", () => {
    expect(buildPasteRequest(EMPTY_COPY_PASTE_CLIPBOARD, "/tmp/target")).toBeNull();
    expect(
      buildPasteRequest(
        setCopyPasteClipboard("copy", ["/tmp/a"], "2026-03-09T00:00:00.000Z"),
        "/tmp/target",
      ),
    ).toEqual({
      action: "paste",
      mode: "copy",
      sourcePaths: ["/tmp/a"],
      destinationDirectoryPath: "/tmp/target",
    });
  });

  it("clears clipboard state after a successful paste", () => {
    const copyClipboard = setCopyPasteClipboard("copy", ["/tmp/a"], "2026-03-09T00:00:00.000Z");
    const cutClipboard = setCopyPasteClipboard("cut", ["/tmp/a"], "2026-03-09T00:00:00.000Z");

    expect(clearClipboardAfterSuccessfulPaste(copyClipboard)).toEqual(EMPTY_COPY_PASTE_CLIPBOARD);
    expect(clearClipboardAfterSuccessfulPaste(cutClipboard)).toEqual(EMPTY_COPY_PASTE_CLIPBOARD);
  });

  it("reports whether clipboard items are available", () => {
    expect(hasClipboardItems(EMPTY_COPY_PASTE_CLIPBOARD)).toBe(false);
    expect(
      hasClipboardItems(setCopyPasteClipboard("copy", ["/tmp/a"], "2026-03-09T00:00:00.000Z")),
    ).toBe(true);
  });
  describe("following items the app renames, moves and deletes", () => {
    const clipboard = setCopyPasteClipboard(
      "copy",
      ["/Users/demo/report.pdf", "/Users/demo/Folder/inner.txt", "/Users/demo/other.txt"],
      NOW,
      {
        "/Users/demo/report.pdf": { kind: "file", isSymlink: false },
        "/Users/demo/Folder/inner.txt": { kind: "file", isSymlink: false },
      },
    );

    it("renames an item, and the items inside a renamed folder", () => {
      const next = remapClipboardPaths(clipboard, [
        { from: "/Users/demo/report.pdf", to: "/Users/demo/final.pdf" },
        { from: "/Users/demo/Folder", to: "/Users/demo/Archive" },
      ]);
      expect(next).toEqual({
        type: "ready",
        mode: "copy",
        sourcePaths: [
          "/Users/demo/final.pdf",
          "/Users/demo/Archive/inner.txt",
          "/Users/demo/other.txt",
        ],
        sourceEntries: {
          "/Users/demo/final.pdf": { kind: "file", isSymlink: false },
          "/Users/demo/Archive/inner.txt": { kind: "file", isSymlink: false },
        },
        capturedAt: NOW,
      });
      // A path that only starts with the same letters is another item.
      expect(
        remapClipboardPaths(clipboard, [{ from: "/Users/demo/Fold", to: "/Users/demo/X" }]),
      ).toBe(clipboard);
    });

    it("drops trashed items and anything inside them", () => {
      expect(
        dropClipboardPaths(clipboard, ["/Users/demo/Folder", "/Users/demo/report.pdf"]),
      ).toEqual({
        type: "ready",
        mode: "copy",
        sourcePaths: ["/Users/demo/other.txt"],
        sourceEntries: {},
        capturedAt: NOW,
      });
      expect(dropClipboardPaths(clipboard, ["/Users/demo"])).toEqual(EMPTY_COPY_PASTE_CLIPBOARD);
      expect(dropClipboardPaths(clipboard, ["/Users/demo/Fold"])).toBe(clipboard);
    });

    it("follows a finished write, counting only the items it completed", () => {
      expect(
        followClipboardThroughWrite(
          clipboard,
          writeResult("rename", [
            { sourcePath: "/Users/demo/report.pdf", destinationPath: "/Users/demo/final.pdf" },
          ]),
        ),
      ).toMatchObject({
        sourcePaths: [
          "/Users/demo/final.pdf",
          "/Users/demo/Folder/inner.txt",
          "/Users/demo/other.txt",
        ],
      });
      expect(
        followClipboardThroughWrite(
          clipboard,
          writeResult("move_to", [
            { sourcePath: "/Users/demo/other.txt", destinationPath: "/Volumes/Backup/other.txt" },
            {
              sourcePath: "/Users/demo/report.pdf",
              destinationPath: "/Volumes/Backup/report.pdf",
              status: "failed",
            },
          ]),
        ),
      ).toMatchObject({
        sourcePaths: [
          "/Users/demo/report.pdf",
          "/Users/demo/Folder/inner.txt",
          "/Volumes/Backup/other.txt",
        ],
      });
      expect(
        followClipboardThroughWrite(
          clipboard,
          writeResult("trash", [{ sourcePath: "/Users/demo/Folder", destinationPath: null }]),
        ),
      ).toMatchObject({ sourcePaths: ["/Users/demo/report.pdf", "/Users/demo/other.txt"] });
      expect(
        followClipboardThroughWrite(
          clipboard,
          writeResult("delete_immediately", [
            { sourcePath: "/Users/demo/other.txt", destinationPath: null },
          ]),
        ),
      ).toMatchObject({ sourcePaths: ["/Users/demo/report.pdf", "/Users/demo/Folder/inner.txt"] });
      // Copies leave the originals where they were.
      expect(
        followClipboardThroughWrite(
          clipboard,
          writeResult("paste", [
            { sourcePath: "/Users/demo/report.pdf", destinationPath: "/tmp/report.pdf" },
          ]),
        ),
      ).toBe(clipboard);
      expect(
        followClipboardThroughWrite(clipboard, {
          ...writeResult("paste", [
            { sourcePath: "/Users/demo/report.pdf", destinationPath: "/tmp/report.pdf" },
          ]),
          mode: "copy",
        }),
      ).toBe(clipboard);
    });

    // Something copied from inside a folder while a paste of the folder's Cut moves it.
    it("follows items a paste after Cut moved", () => {
      expect(
        followClipboardThroughWrite(clipboard, {
          ...writeResult("paste", [
            { sourcePath: "/Users/demo/Folder", destinationPath: "/Volumes/Backup/Folder" },
          ]),
          mode: "cut",
        }),
      ).toMatchObject({
        sourcePaths: [
          "/Users/demo/report.pdf",
          "/Volumes/Backup/Folder/inner.txt",
          "/Users/demo/other.txt",
        ],
      });
    });

    it("cancels a whole cut once any item in it is renamed, moved or deleted", () => {
      const cut = setCopyPasteClipboard(
        "cut",
        ["/Users/demo/report.pdf", "/Users/demo/Folder/inner.txt", "/Users/demo/other.txt"],
        NOW,
      );
      for (const result of [
        writeResult("rename", [
          { sourcePath: "/Users/demo/report.pdf", destinationPath: "/Users/demo/final.pdf" },
        ]),
        // A folder something was cut from counts too.
        writeResult("move_to", [
          { sourcePath: "/Users/demo/Folder", destinationPath: "/Volumes/Backup/Folder" },
        ]),
        // A rename of several: an item put back under another name has moved too.
        writeResult("batch_rename", [
          {
            sourcePath: "/Users/demo/other.txt",
            destinationPath: "/Users/demo/other 2.txt",
            status: "failed",
          },
        ]),
        writeResult("trash", [{ sourcePath: "/Users/demo/other.txt", destinationPath: null }]),
        writeResult("delete_immediately", [
          { sourcePath: "/Users/demo/report.pdf", destinationPath: null },
        ]),
      ]) {
        expect(followClipboardThroughWrite(cut, result)).toEqual(EMPTY_COPY_PASTE_CLIPBOARD);
      }
      // Items that failed, items not in the cut, and copies leave it as it was.
      for (const result of [
        writeResult("move_to", [
          {
            sourcePath: "/Users/demo/report.pdf",
            destinationPath: "/Volumes/Backup/report.pdf",
            status: "failed",
          },
          { sourcePath: "/Users/demo/Fold", destinationPath: "/Volumes/Backup/Fold" },
        ]),
        writeResult("trash", [
          { sourcePath: "/Users/demo/other.txt", destinationPath: null, status: "failed" },
        ]),
        writeResult("paste", [
          { sourcePath: "/Users/demo/report.pdf", destinationPath: "/tmp/report.pdf" },
        ]),
      ]) {
        expect(followClipboardThroughWrite(cut, result)).toBe(cut);
      }
    });
  });
});
