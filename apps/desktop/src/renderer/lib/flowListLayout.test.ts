import {
  COMPACT_FLOW_LIST_LAYOUT,
  FLOW_LIST_LAYOUT,
  getFlowListColumnStep,
  getFlowListRevealScrollLeft,
} from "./flowListLayout";

describe("flowListLayout", () => {
  it("returns the correct column step for regular and compact layouts", () => {
    expect(getFlowListColumnStep(false)).toBe(FLOW_LIST_LAYOUT.itemWidth + FLOW_LIST_LAYOUT.columnGap);
    expect(getFlowListColumnStep(true)).toBe(
      COMPACT_FLOW_LIST_LAYOUT.itemWidth + COMPACT_FLOW_LIST_LAYOUT.columnGap,
    );
  });

  it("keeps the current scroll when the selected item is already fully visible", () => {
    expect(
      getFlowListRevealScrollLeft({
        currentScrollLeft: 310,
        viewportWidth: 980,
        itemIndex: 24,
        rowsPerColumn: 12,
        compact: false,
        maxScrollLeft: 3000,
      }),
    ).toBe(310);
  });

  it("scrolls left to reveal a column that moved out of view to the left", () => {
    expect(
      getFlowListRevealScrollLeft({
        currentScrollLeft: 620,
        viewportWidth: 980,
        itemIndex: 10,
        rowsPerColumn: 12,
        compact: false,
        maxScrollLeft: 3000,
      }),
    ).toBe(0);
  });

  it("scrolls right just enough to reveal a column that moved out of view to the right", () => {
    expect(
      getFlowListRevealScrollLeft({
        currentScrollLeft: 0,
        viewportWidth: 980,
        itemIndex: 36,
        rowsPerColumn: 12,
        compact: false,
        maxScrollLeft: 3000,
      }),
    ).toBe(282);
  });

  it("clamps the reveal scroll offset to the available bounds", () => {
    expect(
      getFlowListRevealScrollLeft({
        currentScrollLeft: 0,
        viewportWidth: 980,
        itemIndex: 120,
        rowsPerColumn: 12,
        compact: false,
        maxScrollLeft: 1400,
      }),
    ).toBe(1400);
  });
});
