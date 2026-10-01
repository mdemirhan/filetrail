import {
  DETAILS_LAYOUT,
  fitDetailColumns,
  getDetailsRowHeight,
  getDetailsTableWidth,
  getVisibleDetailColumns,
} from "./detailsLayout";

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

  it("adds gaps between visible columns and the row padding", () => {
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
    ).toBe(220 + DETAILS_LAYOUT.rowPadding);

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
    ).toBe(320 + 108 + 168 + DETAILS_LAYOUT.columnGap * 2 + DETAILS_LAYOUT.rowPadding);
  });

  describe("fitDetailColumns", () => {
    const widths = { name: 320, size: 108, modified: 168, permissions: 148 };
    const columns = ["name", "size", "modified", "permissions"] as const;
    // 320 + 108 + 168 + 148, three gaps and the row padding.
    const fullWidth = 744 + 36 + 24;

    it("changes nothing when the table fits or the pane is not measured yet", () => {
      expect(fitDetailColumns({ columns, widths, availableWidth: fullWidth })).toEqual({
        columns,
        widths,
      });
      expect(fitDetailColumns({ columns, widths, availableWidth: 0 })).toEqual({
        columns,
        widths,
      });
    });

    it("narrows the Name column before it drops any column", () => {
      expect(fitDetailColumns({ columns, widths, availableWidth: fullWidth - 100 })).toEqual({
        columns,
        widths: { ...widths, name: 220 },
      });
      // Exactly at the floor: all four columns still fit.
      expect(fitDetailColumns({ columns, widths, availableWidth: fullWidth - 160 })).toEqual({
        columns,
        widths: { ...widths, name: 160 },
      });
    });

    it("drops columns from the right, one at a time, as the pane narrows", () => {
      // One pixel under the floor layout: Permissions goes and Name takes the space back.
      const withoutPermissions = fitDetailColumns({
        columns,
        widths,
        availableWidth: fullWidth - 161,
      });
      expect(withoutPermissions.columns).toEqual(["name", "size", "modified"]);
      expect(withoutPermissions.widths.name).toBe(319);

      // Name at its floor, Size, Modified, two gaps and the padding come to 484.
      expect(fitDetailColumns({ columns, widths, availableWidth: 484 }).columns).toEqual([
        "name",
        "size",
        "modified",
      ]);
      expect(fitDetailColumns({ columns, widths, availableWidth: 483 }).columns).toEqual([
        "name",
        "size",
      ]);
      expect(fitDetailColumns({ columns, widths, availableWidth: 264 })).toEqual({
        columns: ["name"],
        widths: { ...widths, name: 240 },
      });
    });

    it("never fits more than the pane holds, and keeps Name readable in a tiny pane", () => {
      for (let availableWidth = 120; availableWidth <= fullWidth; availableWidth += 7) {
        const fitted = fitDetailColumns({ columns, widths, availableWidth });
        expect(fitted.columns[0]).toBe("name");
        expect(fitted.widths.name).toBeGreaterThanOrEqual(DETAILS_LAYOUT.nameMinWidth);
        if (fitted.widths.name > DETAILS_LAYOUT.nameMinWidth) {
          expect(getDetailsTableWidth(fitted.widths, fitted.columns)).toBeLessThanOrEqual(
            availableWidth,
          );
        }
      }
    });

    it("leaves the saved widths of the other columns alone", () => {
      const fitted = fitDetailColumns({ columns, widths, availableWidth: 400 });
      expect(fitted.widths).toMatchObject({ size: 108, modified: 168, permissions: 148 });
    });
  });
});
