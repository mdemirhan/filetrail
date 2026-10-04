import {
  DEFAULT_DETAIL_COLUMN_ORDER,
  DEFAULT_DETAIL_COLUMN_WIDTHS,
  DETAIL_COLUMN_WIDTH_LIMITS,
} from "../../shared/appPreferences";
import {
  DETAILS_LAYOUT,
  fitDetailColumns,
  getDetailColumnFitWidth,
  getDetailsRowHeight,
  getDetailsTableWidth,
  getVisibleDetailColumns,
} from "./detailsLayout";

describe("detailsLayout", () => {
  it("returns the expected row height for compact and regular modes", () => {
    expect(getDetailsRowHeight(false)).toBe(DETAILS_LAYOUT.regularRowHeight);
    expect(getDetailsRowHeight(true)).toBe(DETAILS_LAYOUT.compactRowHeight);
  });

  it("keeps the name column first and the optional columns in their chosen order", () => {
    expect(
      getVisibleDetailColumns(
        {
          modified: false,
          size: true,
          kind: true,
          created: false,
          permissions: true,
        },
        DEFAULT_DETAIL_COLUMN_ORDER,
      ),
    ).toEqual(["name", "size", "kind", "permissions"]);
    expect(
      getVisibleDetailColumns(
        {
          modified: true,
          size: true,
          kind: true,
          created: true,
          permissions: true,
        },
        ["kind", "permissions", "modified", "created", "size"],
      ),
    ).toEqual(["name", "kind", "permissions", "modified", "created", "size"]);
  });

  it("adds gaps between visible columns and the row padding", () => {
    expect(getDetailsTableWidth({ ...DEFAULT_DETAIL_COLUMN_WIDTHS, name: 220 }, ["name"])).toBe(
      220 + DETAILS_LAYOUT.rowPadding,
    );

    expect(getDetailsTableWidth(DEFAULT_DETAIL_COLUMN_WIDTHS, ["name", "modified", "size"])).toBe(
      320 + 152 + 108 + DETAILS_LAYOUT.columnGap * 2 + DETAILS_LAYOUT.rowPadding,
    );
  });

  describe("fitDetailColumns", () => {
    // Name 320, Date Modified 152, Size 108, Kind 148.
    const widths = DEFAULT_DETAIL_COLUMN_WIDTHS;
    const columns = ["name", "modified", "size", "kind"] as const;
    // The four columns, three gaps and the row padding.
    const fullWidth = 728 + 36 + 24;

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
      // One pixel under the floor layout: Kind goes and Name takes the space back.
      const withoutKind = fitDetailColumns({
        columns,
        widths,
        availableWidth: fullWidth - 161,
      });
      expect(withoutKind.columns).toEqual(["name", "modified", "size"]);
      expect(withoutKind.widths.name).toBe(319);

      // Name at its floor, Date Modified, Size, two gaps and the padding come to 468.
      expect(fitDetailColumns({ columns, widths, availableWidth: 468 }).columns).toEqual([
        "name",
        "modified",
        "size",
      ]);
      expect(fitDetailColumns({ columns, widths, availableWidth: 467 }).columns).toEqual([
        "name",
        "modified",
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
      expect(fitted.widths).toMatchObject({ modified: 152, size: 108, kind: 148 });
    });
  });

  describe("getDetailColumnFitWidth", () => {
    it("fits the wider of the title and the widest value, with a little room", () => {
      expect(
        getDetailColumnFitWidth("kind", {
          headerWidth: 28,
          valueWidths: [60.2, 84.5],
          valueExtraWidth: 0,
        }),
      ).toBe(87);
      expect(
        getDetailColumnFitWidth("permissions", {
          headerWidth: 69.4,
          valueWidths: [24],
          valueExtraWidth: 0,
        }),
      ).toBe(72);
      // Name's cells hold the icon and its gap besides the text.
      expect(
        getDetailColumnFitWidth("name", {
          headerWidth: 40,
          valueWidths: [300],
          valueExtraWidth: 24,
        }),
      ).toBe(326);
    });

    it("stays within the column's limits", () => {
      expect(
        getDetailColumnFitWidth("size", { headerWidth: 26, valueWidths: [], valueExtraWidth: 0 }),
      ).toBe(DETAIL_COLUMN_WIDTH_LIMITS.size.min);
      expect(
        getDetailColumnFitWidth("name", {
          headerWidth: 40,
          valueWidths: [5000],
          valueExtraWidth: 24,
        }),
      ).toBe(DETAIL_COLUMN_WIDTH_LIMITS.name.max);
    });
  });
});
