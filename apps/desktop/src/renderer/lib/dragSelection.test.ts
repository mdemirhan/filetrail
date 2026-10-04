import {
  combineDragSelection,
  getDetailsItemsInBox,
  getDragSelectionAutoScrollStep,
  getDragSelectionMode,
  getFlowListItemsInBox,
  getIconGridItemsInBox,
  makeDragSelectionBox,
} from "./dragSelection";
import { FLOW_LIST_LAYOUT } from "./flowListLayout";
import { ICON_GRID_LAYOUT } from "./iconGridLayout";

const entries = Array.from({ length: 10 }, (_, index) => ({ path: `/demo/item-${index}` }));

function paths(hits: Array<{ path: string }>): string[] {
  return hits.map((hit) => hit.path.replace("/demo/", ""));
}

describe("dragSelection", () => {
  it("makes a box whichever way the pointer moves from where it started", () => {
    expect(makeDragSelectionBox({ x: 50, y: 80 }, { x: 10, y: 20 })).toEqual({
      left: 10,
      top: 20,
      right: 50,
      bottom: 80,
    });
  });

  it("adds with ⇧, flips with ⌘ and otherwise replaces", () => {
    expect(getDragSelectionMode({ metaKey: false, shiftKey: false })).toBe("replace");
    expect(getDragSelectionMode({ metaKey: false, shiftKey: true })).toBe("add");
    expect(getDragSelectionMode({ metaKey: true, shiftKey: false })).toBe("toggle");
    expect(getDragSelectionMode({ metaKey: true, shiftKey: true })).toBe("toggle");
  });

  it("combines what the box touches with the selection the drag started with", () => {
    expect(combineDragSelection(["a", "b"], ["b", "c"], "replace")).toEqual(["b", "c"]);
    expect(combineDragSelection(["a", "b"], ["b", "c"], "add")).toEqual(["a", "b", "c"]);
    expect(combineDragSelection(["a", "b"], ["b", "c"], "toggle")).toEqual(["a", "c"]);
  });

  it("selects the List view's rows the box touches, however little", () => {
    const hit = (top: number, bottom: number) =>
      paths(
        getDetailsItemsInBox({
          box: { left: 40, top, right: 60, bottom },
          entries,
          rowHeight: 28,
        }),
      );
    expect(hit(30, 60)).toEqual(["item-1", "item-2"]);
    // Ends exactly where row 2 starts: row 2 is not touched.
    expect(hit(30, 56)).toEqual(["item-1"]);
    expect(hit(-20, 1)).toEqual(["item-0"]);
    // Below the last row.
    expect(hit(290, 400)).toEqual([]);
  });

  it("selects the flow list's items column by column", () => {
    const step = FLOW_LIST_LAYOUT.itemWidth + FLOW_LIST_LAYOUT.columnGap;
    const hit = (
      left: number,
      right: number,
      top: number,
      bottom: number,
      sizes = new Map<string, { width: number; height: number }>(),
    ) =>
      paths(
        getFlowListItemsInBox({
          box: { left, top, right, bottom },
          entries,
          rowsPerColumn: 4,
          layout: FLOW_LIST_LAYOUT,
          sizes,
        }),
      );
    // Rows 1 and 2 of the first two columns.
    expect(hit(100, step + 5, 30, 60)).toEqual(["item-1", "item-2", "item-5", "item-6"]);
    // In the gap between the columns: nothing.
    expect(hit(FLOW_LIST_LAYOUT.itemWidth, step, 0, 100)).toEqual([]);
    // After a short name, measured on screen: only the item that has not been measured.
    expect(hit(80, 200, 0, 40, new Map([["/demo/item-0", { width: 70, height: 28 }]]))).toEqual([
      "item-1",
    ]);
    // The third column holds only items 8 and 9.
    expect(hit(2 * step + 20, 2 * step + 30, 0, 200)).toEqual(["item-8", "item-9"]);
  });

  it("selects the Icon view's items on their icons and names only", () => {
    const gridWidth = 4 * 150;
    const hit = (
      left: number,
      right: number,
      top: number,
      bottom: number,
      sizes = new Map<string, { width: number; height: number }>(),
    ) =>
      paths(
        getIconGridItemsInBox({
          box: { left, top, right, bottom },
          entries,
          columns: 4,
          gridWidth,
          layout: ICON_GRID_LAYOUT,
          sizes,
        }),
      );
    // In the first 150px column the tile spans 39 to 111 (5 to 77 down) and a name at its
    // widest 24 to 126 (81 to 114 down).
    expect(hit(0, 20, 0, 300)).toEqual([]);
    expect(hit(0, 30, 0, 320)).toEqual(["item-0", "item-4", "item-8"]);
    expect(hit(0, 35, 0, 78)).toEqual([]);
    expect(hit(100, 200, 10, 20)).toEqual(["item-0", "item-1"]);
    // A short name, measured on screen, leaves the space beside and below it empty.
    const shortName = new Map([["/demo/item-0", { width: 40, height: 18 }]]);
    expect(hit(26, 38, 82, 98)).toEqual(["item-0"]);
    expect(hit(26, 38, 82, 98, shortName)).toEqual([]);
    expect(hit(60, 90, 100, 110, shortName)).toEqual([]);
    // Above row 1's tiles, in the padding at the top of its items: nothing from row 1.
    const row1 = ICON_GRID_LAYOUT.rowHeight;
    expect(hit(40, 100, row1 - 1, row1 + ICON_GRID_LAYOUT.itemPaddingTop)).toEqual([]);
    expect(hit(40, 100, row1 - 1, row1 + ICON_GRID_LAYOUT.itemPaddingTop + 1)).toEqual(["item-4"]);
    // Row 2 holds items 8 and 9 only.
    expect(hit(0, gridWidth, 2 * ICON_GRID_LAYOUT.rowHeight + 5, 400)).toEqual([
      "item-8",
      "item-9",
    ]);
  });

  it("scrolls faster the further past the edge the pointer is", () => {
    expect(getDragSelectionAutoScrollStep(0)).toBe(0);
    expect(getDragSelectionAutoScrollStep(3)).toBe(5);
    expect(getDragSelectionAutoScrollStep(-30)).toBe(-14);
    expect(getDragSelectionAutoScrollStep(500)).toBe(40);
  });
});
