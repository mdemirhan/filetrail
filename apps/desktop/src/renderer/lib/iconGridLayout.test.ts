import {
  COMPACT_ICON_GRID_LAYOUT,
  ICON_GRID_LAYOUT,
  computeIconGridColumns,
  getIconGridLayout,
  getIconGridRevealScrollTop,
} from "./iconGridLayout";

describe("iconGridLayout", () => {
  it("uses smaller icons and tighter rows in compact mode", () => {
    expect(getIconGridLayout(false)).toBe(ICON_GRID_LAYOUT);
    expect(getIconGridLayout(true)).toBe(COMPACT_ICON_GRID_LAYOUT);
    expect(COMPACT_ICON_GRID_LAYOUT.iconSize).toBeLessThan(ICON_GRID_LAYOUT.iconSize);
    expect(COMPACT_ICON_GRID_LAYOUT.rowHeight).toBeLessThan(ICON_GRID_LAYOUT.rowHeight);
    expect(COMPACT_ICON_GRID_LAYOUT.cellMinWidth).toBeLessThan(ICON_GRID_LAYOUT.cellMinWidth);
  });

  it("fits as many columns as the pane holds, and more of them when compact", () => {
    expect(computeIconGridColumns(1000, ICON_GRID_LAYOUT)).toBe(9);
    expect(computeIconGridColumns(1000, COMPACT_ICON_GRID_LAYOUT)).toBe(11);
    expect(computeIconGridColumns(32 + 104 * 3, ICON_GRID_LAYOUT)).toBe(3);
    expect(computeIconGridColumns(32 + 104 * 3 - 1, ICON_GRID_LAYOUT)).toBe(2);
  });

  it("keeps one column for a pane that is too narrow or not measured yet", () => {
    expect(computeIconGridColumns(0, ICON_GRID_LAYOUT)).toBe(1);
    expect(computeIconGridColumns(60, ICON_GRID_LAYOUT)).toBe(1);
  });

  describe("getIconGridRevealScrollTop", () => {
    const layout = ICON_GRID_LAYOUT;
    const base = { viewportHeight: 400, itemCount: 100, columns: 5, layout };

    it("keeps the scroll position when the row is fully visible", () => {
      expect(getIconGridRevealScrollTop({ ...base, currentScrollTop: 100, itemIndex: 7 })).toBe(
        100,
      );
    });

    it("scrolls up to a row above the viewport", () => {
      // Item 7 is in the second row, which starts below the top padding and one row.
      expect(getIconGridRevealScrollTop({ ...base, currentScrollTop: 500, itemIndex: 7 })).toBe(
        layout.paddingTop + layout.rowHeight,
      );
    });

    it("scrolls to the very top for the first row", () => {
      expect(getIconGridRevealScrollTop({ ...base, currentScrollTop: 500, itemIndex: 3 })).toBe(0);
    });

    it("scrolls down just far enough for a row below the viewport", () => {
      // Item 30 is in the seventh row.
      const rowBottom = layout.paddingTop + 7 * layout.rowHeight;
      expect(getIconGridRevealScrollTop({ ...base, currentScrollTop: 0, itemIndex: 30 })).toBe(
        rowBottom - base.viewportHeight,
      );
    });

    it("brings the bottom padding in with the last row", () => {
      const rowBottom = layout.paddingTop + 20 * layout.rowHeight + layout.paddingBottom;
      expect(getIconGridRevealScrollTop({ ...base, currentScrollTop: 0, itemIndex: 99 })).toBe(
        rowBottom - base.viewportHeight,
      );
    });

    it("shows the top of a row that is taller than the viewport", () => {
      expect(
        getIconGridRevealScrollTop({
          ...base,
          viewportHeight: 80,
          currentScrollTop: 0,
          itemIndex: 12,
        }),
      ).toBe(layout.paddingTop + 2 * layout.rowHeight);
    });
  });
});
