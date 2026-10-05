import {
  EMPTY_CONTENT_SELECTION,
  extendContentSelectionToPath,
  getSelectionRangePaths,
  isSelectionNarrowingClick,
  mergeSelectionPathsInEntryOrder,
  sanitizeContentSelection,
  selectAllContentEntries,
  setSingleContentSelection,
  toggleContentSelection,
} from "./contentSelection";

const ENTRIES = [
  { path: "/demo/alpha" },
  { path: "/demo/beta" },
  { path: "/demo/gamma" },
  { path: "/demo/delta" },
];

describe("contentSelection", () => {
  it("sanitizes stale paths and repairs anchor and lead", () => {
    expect(
      sanitizeContentSelection(
        {
          paths: ["/demo/alpha", "/demo/missing", "/demo/gamma"],
          anchorPath: "/demo/missing",
          leadPath: "/demo/missing",
        },
        ENTRIES,
      ),
    ).toEqual({
      paths: ["/demo/alpha", "/demo/gamma"],
      anchorPath: "/demo/gamma",
      leadPath: "/demo/gamma",
    });
  });

  it("keeps the place of a selection whose items all left the list", () => {
    const remaining = ENTRIES.filter((entry) => entry.path !== "/demo/gamma");
    const gone = sanitizeContentSelection(
      setSingleContentSelection("/demo/gamma"),
      remaining,
      ENTRIES,
    );
    expect(gone).toEqual({ ...EMPTY_CONTENT_SELECTION, gapIndex: 2 });
    // The folder read again keeps the place, within the list.
    expect(sanitizeContentSelection(gone, remaining.slice(0, 1), remaining)).toEqual({
      ...EMPTY_CONTENT_SELECTION,
      gapIndex: 1,
    });
    // Several items: the place is the lead's.
    expect(
      sanitizeContentSelection(
        {
          paths: ["/demo/alpha", "/demo/gamma"],
          anchorPath: "/demo/alpha",
          leadPath: "/demo/gamma",
        },
        [{ path: "/demo/beta" }, { path: "/demo/delta" }],
        ENTRIES,
      ),
    ).toEqual({ ...EMPTY_CONTENT_SELECTION, gapIndex: 1 });
    // Without the list it was made in there is no place to keep.
    expect(sanitizeContentSelection(setSingleContentSelection("/demo/gamma"), remaining)).toEqual(
      EMPTY_CONTENT_SELECTION,
    );
  });

  it("computes range paths in entry order", () => {
    expect(getSelectionRangePaths(ENTRIES, "/demo/delta", "/demo/beta")).toEqual([
      "/demo/beta",
      "/demo/gamma",
      "/demo/delta",
    ]);
  });

  it("merges selected paths using visible entry order", () => {
    expect(
      mergeSelectionPathsInEntryOrder(ENTRIES, ["/demo/gamma"], ["/demo/alpha", "/demo/delta"]),
    ).toEqual(["/demo/alpha", "/demo/gamma", "/demo/delta"]);
  });

  it("toggles items in and out of a multi-selection", () => {
    expect(toggleContentSelection(EMPTY_CONTENT_SELECTION, ENTRIES, "/demo/beta")).toEqual({
      paths: ["/demo/beta"],
      anchorPath: "/demo/beta",
      leadPath: "/demo/beta",
    });

    expect(
      toggleContentSelection(
        {
          paths: ["/demo/alpha", "/demo/beta"],
          anchorPath: "/demo/alpha",
          leadPath: "/demo/beta",
        },
        ENTRIES,
        "/demo/beta",
      ),
    ).toEqual({
      paths: ["/demo/alpha"],
      anchorPath: "/demo/alpha",
      leadPath: "/demo/alpha",
    });
  });

  it("extends selections with shift and cmd-shift semantics", () => {
    const base = setSingleContentSelection("/demo/beta");

    expect(extendContentSelectionToPath(base, ENTRIES, "/demo/delta")).toEqual({
      paths: ["/demo/beta", "/demo/gamma", "/demo/delta"],
      anchorPath: "/demo/beta",
      leadPath: "/demo/delta",
    });

    expect(
      extendContentSelectionToPath(
        {
          paths: ["/demo/alpha"],
          anchorPath: "/demo/alpha",
          leadPath: "/demo/alpha",
        },
        ENTRIES,
        "/demo/gamma",
        true,
      ),
    ).toEqual({
      paths: ["/demo/alpha", "/demo/beta", "/demo/gamma"],
      anchorPath: "/demo/alpha",
      leadPath: "/demo/gamma",
    });
  });

  it("selects all entries and returns empty when none exist", () => {
    expect(selectAllContentEntries(ENTRIES)).toEqual({
      paths: ["/demo/alpha", "/demo/beta", "/demo/gamma", "/demo/delta"],
      anchorPath: "/demo/alpha",
      leadPath: "/demo/delta",
    });
    expect(selectAllContentEntries([])).toEqual(EMPTY_CONTENT_SELECTION);
  });

  it("narrows a multi-selection only on a plain mouse click of a selected item", () => {
    const plainClick = { button: 0, detail: 1, metaKey: false, shiftKey: false, ctrlKey: false };

    expect(isSelectionNarrowingClick(plainClick, 3, true)).toBe(true);
    expect(isSelectionNarrowingClick(plainClick, 1, true)).toBe(false);
    expect(isSelectionNarrowingClick(plainClick, 3, false)).toBe(false);
    expect(isSelectionNarrowingClick({ ...plainClick, metaKey: true }, 3, true)).toBe(false);
    expect(isSelectionNarrowingClick({ ...plainClick, shiftKey: true }, 3, true)).toBe(false);
    expect(isSelectionNarrowingClick({ ...plainClick, ctrlKey: true }, 3, true)).toBe(false);
    // Keyboard-generated clicks (Space or Return on a focused row) report detail 0.
    expect(isSelectionNarrowingClick({ ...plainClick, detail: 0 }, 3, true)).toBe(false);
  });
});
