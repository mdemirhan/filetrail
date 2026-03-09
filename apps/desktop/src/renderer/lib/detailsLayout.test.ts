import { DETAILS_LAYOUT, getDetailsRowHeight, getDetailsTableWidth, getVisibleDetailColumns } from "./detailsLayout";

describe("detailsLayout", () => {
  it("returns the expected row height for compact and regular modes", () => {
    expect(getDetailsRowHeight(false)).toBe(DETAILS_LAYOUT.regularRowHeight);
    expect(getDetailsRowHeight(true)).toBe(DETAILS_LAYOUT.compactRowHeight);
  });

  it("keeps the name column first and preserves the stable optional-column order", () => {
    expect(
      getVisibleDetailColumns({
        size: true,
        modified: false,
        permissions: true,
      }),
    ).toEqual(["name", "size", "permissions"]);
  });

  it("enforces a minimum table width and adds gaps between visible columns", () => {
    expect(
      getDetailsTableWidth(
        {
          name: 220,
          size: 84,
          modified: 132,
          permissions: 132,
        },
        ["name"],
      ),
    ).toBe(DETAILS_LAYOUT.minTableWidth);

    expect(
      getDetailsTableWidth(
        {
          name: 320,
          size: 108,
          modified: 168,
          permissions: 148,
        },
        ["name", "size", "modified"],
      ),
    ).toBe(320 + 108 + 168 + DETAILS_LAYOUT.columnGap * 2);
  });
});
