import {
  EMPTY_CONTENT_SELECTION,
  extendContentSelectionToPath,
  getSelectionRangePaths,
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
});
