import {
  EMPTY_COPY_PASTE_CLIPBOARD,
  buildPasteRequest,
  clearClipboardAfterSuccessfulPaste,
  clearCopyPasteClipboard,
  describeClipboard,
  hasClipboardItems,
  setCopyPasteClipboard,
} from "./copyPasteClipboard";

describe("copyPasteClipboard", () => {
  it("says how many items were copied or cut, and which", () => {
    expect(describeClipboard(EMPTY_COPY_PASTE_CLIPBOARD)).toBeNull();
    expect(
      describeClipboard(setCopyPasteClipboard("copy", ["/tmp/a.txt"], "2026-03-09T00:00:00.000Z")),
    ).toEqual({ label: "1 item copied", tooltip: "a.txt\nPaste with ⌘V" });
    const many = describeClipboard(
      setCopyPasteClipboard(
        "cut",
        ["1", "2", "3", "4", "5", "6", "7"].map((name) => `/tmp/${name}`),
        "2026-03-09T00:00:00.000Z",
      ),
    );
    expect(many?.label).toBe("7 items cut");
    expect(many?.tooltip).toBe("1\n2\n3\n4\n5\nand 2 more\nPaste with ⌘V");
  });

  it("stores a copy clipboard payload with deduped paths", () => {
    expect(
      setCopyPasteClipboard("copy", ["/tmp/a", "/tmp/a", "/tmp/b"], "2026-03-09T00:00:00.000Z"),
    ).toEqual({
      type: "ready",
      mode: "copy",
      sourcePaths: ["/tmp/a", "/tmp/b"],
      capturedAt: "2026-03-09T00:00:00.000Z",
    });
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
