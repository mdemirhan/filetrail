import {
  EMPTY_COPY_PASTE_CLIPBOARD,
  buildPasteRequest,
  clearClipboardAfterSuccessfulPaste,
  clearCopyPasteClipboard,
  describeClipboard,
  groupClipboardItemsByFolder,
  hasClipboardItems,
  listClipboardItems,
  removeClipboardItem,
  setCopyPasteClipboard,
} from "./copyPasteClipboard";

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
        "skip",
      ),
    ).toEqual({
      action: "paste",
      mode: "copy",
      sourcePaths: ["/tmp/a"],
      destinationDirectoryPath: "/tmp/target",
      conflictResolution: "skip",
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
});
