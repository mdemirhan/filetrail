import {
  type FlowListLayout,
  buildColumnMajorRows,
  chunkItemsIntoRows,
  computeRowsPerColumn,
  getVirtualRange,
} from "./virtualization";

const NORMAL_LAYOUT: FlowListLayout = {
  rowHeight: 44,
  rowGap: 4,
  itemWidth: 292,
  columnGap: 18,
  paddingTop: 10,
  paddingBottom: 4,
};

const COMPACT_LAYOUT: FlowListLayout = {
  rowHeight: 36,
  rowGap: 2,
  itemWidth: 292,
  columnGap: 18,
  paddingTop: 8,
  paddingBottom: 4,
};

describe("computeRowsPerColumn", () => {
  it("computes rows for a standard viewport", () => {
    // Container 500px tall (clientHeight).
    // Content height: 500 - 10 - 4 + 4 = 490. Rows: floor(490/44) = 11.
    expect(computeRowsPerColumn(500, NORMAL_LAYOUT)).toBe(11);
  });

  it("computes rows when scrollbar has already reduced clientHeight", () => {
    // When horizontal scrollbar is present, clientHeight is already reduced.
    // If CSS height=500 and scrollbar=8, clientHeight=492.
    // Content height: 492 - 10 - 4 + 4 = 482. Rows: floor(482/44) = 10.
    expect(computeRowsPerColumn(492, NORMAL_LAYOUT)).toBe(10);
  });

  it("returns 1 for zero or negative container height", () => {
    expect(computeRowsPerColumn(0, NORMAL_LAYOUT)).toBe(1);
    expect(computeRowsPerColumn(-10, NORMAL_LAYOUT)).toBe(1);
  });

  it("handles exact fit with no remainder", () => {
    // N rows need N*44 - 4 content pixels.
    // Available content = H - paddingTop - paddingBottom = H - 14.
    // N*44 - 4 <= H - 14 → N <= (H - 10) / 44
    // For N=11: H >= 494. Content: 494 - 14 = 480. 11 rows: 11*44-4 = 480. Exact fit!
    expect(computeRowsPerColumn(494, NORMAL_LAYOUT)).toBe(11);
  });

  it("drops a row when 1px short of exact fit", () => {
    // At H=493: (493 - 10) / 44 = 10.977 → floor = 10
    expect(computeRowsPerColumn(493, NORMAL_LAYOUT)).toBe(10);
  });

  it("handles the scrollbar boundary correctly", () => {
    // CSS height = 494 → clientHeight = 494 (no scrollbar) → 11 rows.
    // If scrollbar appears: clientHeight = 486 → (486-10)/44 = 10.818 → 10 rows.
    expect(computeRowsPerColumn(494, NORMAL_LAYOUT)).toBe(11);
    expect(computeRowsPerColumn(486, NORMAL_LAYOUT)).toBe(10);
  });

  it("works with compact layout", () => {
    // H=500, compact: (500 - 8 - 4 + 2)/36 = 490/36 = 13.611 → 13 rows.
    expect(computeRowsPerColumn(500, COMPACT_LAYOUT)).toBe(13);
  });

  it("works with compact layout reduced by scrollbar", () => {
    // H=492 (scrollbar present): (492 - 8 - 4 + 2)/36 = 482/36 = 13.388 → 13 rows.
    expect(computeRowsPerColumn(492, COMPACT_LAYOUT)).toBe(13);

    // H=472: (472 - 8 - 4 + 2)/36 = 462/36 = 12.833 → 12.
    expect(computeRowsPerColumn(472, COMPACT_LAYOUT)).toBe(12);
  });

  it("handles very small container gracefully", () => {
    // H=50: (50 - 10 - 4 + 4)/44 = 40/44 = 0.909 → max(1, 0) = 1
    expect(computeRowsPerColumn(50, NORMAL_LAYOUT)).toBe(1);
  });

  it("handles container smaller than a single row", () => {
    // H=20: content = 20-14 = 6. max(6, 44)/44 = 44/44 = 1.
    expect(computeRowsPerColumn(20, NORMAL_LAYOUT)).toBe(1);
  });

  it("handles a range of heights matching expected row counts", () => {
    // N rows fit when H >= N*44 - 4 + 14 = N*44 + 10
    // N=1:  H >= 54 (actually min is rowHeight due to max guard, so 1 row for H >= ~44+10)
    // N=5:  H >= 230
    // N=10: H >= 450
    // N=15: H >= 670
    expect(computeRowsPerColumn(230, NORMAL_LAYOUT)).toBe(5);
    expect(computeRowsPerColumn(229, NORMAL_LAYOUT)).toBe(4);
    expect(computeRowsPerColumn(450, NORMAL_LAYOUT)).toBe(10);
    expect(computeRowsPerColumn(449, NORMAL_LAYOUT)).toBe(9);
    expect(computeRowsPerColumn(670, NORMAL_LAYOUT)).toBe(15);
    expect(computeRowsPerColumn(669, NORMAL_LAYOUT)).toBe(14);
  });
});

describe("virtualization helpers", () => {
  it("computes a stable virtual range with overscan", () => {
    expect(
      getVirtualRange({
        itemCount: 100,
        itemSize: 40,
        viewportSize: 200,
        scrollOffset: 160,
        overscan: 2,
      }),
    ).toEqual({
      startIndex: 2,
      endIndex: 11,
    });
  });

  it("returns an empty range when there are no items", () => {
    expect(
      getVirtualRange({
        itemCount: 0,
        itemSize: 40,
        viewportSize: 200,
        scrollOffset: 0,
        overscan: 2,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 0,
    });
  });

  it("clamps stale scroll offsets so a new shorter list still renders immediately", () => {
    expect(
      getVirtualRange({
        itemCount: 3,
        itemSize: 40,
        viewportSize: 200,
        scrollOffset: 4000,
        overscan: 2,
      }),
    ).toEqual({
      startIndex: 0,
      endIndex: 3,
    });
  });

  it("chunks items into even row groups", () => {
    expect(chunkItemsIntoRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("builds column-major rows for vertical-first layouts", () => {
    expect(buildColumnMajorRows([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 4, 7],
      [2, 5],
      [3, 6],
    ]);
  });
});
