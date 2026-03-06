import { buildColumnMajorRows, chunkItemsIntoRows, getVirtualRange } from "./virtualization";

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
