import type { SelectionSize } from "./selectionSize";
import { buildContentStatusSummary, folderStatusSize, selectionStatusSize } from "./statusSummary";

describe("buildContentStatusSummary", () => {
  it("shows the item count when nothing is selected", () => {
    expect(buildContentStatusSummary({ itemCount: 4, selectedCount: 0, size: null })).toBe(
      "4 items",
    );
  });

  it("adds the folder's size when nothing is selected and it is known", () => {
    expect(
      buildContentStatusSummary({
        itemCount: 4,
        selectedCount: 0,
        size: { status: "ready", sizeBytes: 3000 },
      }),
    ).toBe("4 items · 3.0 KB");
  });

  it("adds the selection's size when it is known", () => {
    expect(
      buildContentStatusSummary({
        itemCount: 4,
        selectedCount: 2,
        size: { status: "ready", sizeBytes: 3000 },
      }),
    ).toBe("2 of 4 selected · 3.0 KB");
  });

  it("says when the size is being calculated", () => {
    expect(
      buildContentStatusSummary({
        itemCount: 1,
        selectedCount: 1,
        size: { status: "calculating" },
      }),
    ).toBe("1 of 1 selected · Calculating…");
  });

  it("says how many items show when typing has narrowed the list", () => {
    expect(
      buildContentStatusSummary({ itemCount: 240, shownCount: 3, selectedCount: 0, size: null }),
    ).toBe("3 of 240 items");
  });
});

describe("selectionStatusSize", () => {
  const selection = (overrides: Partial<SelectionSize>): SelectionSize => ({
    totalBytes: null,
    folderPaths: ["/folder"],
    folderSizeEntry: { status: "idle" },
    ...overrides,
  });

  it("is the total once every size is known", () => {
    expect(selectionStatusSize(selection({ totalBytes: 10 }))).toEqual({
      status: "ready",
      sizeBytes: 10,
    });
  });

  it("is calculating while a folder in the selection is", () => {
    expect(
      selectionStatusSize(selection({ folderSizeEntry: { status: "calculating", jobId: "" } })),
    ).toEqual({ status: "calculating" });
  });

  it("is unknown while a folder in the selection has not been calculated", () => {
    expect(selectionStatusSize(selection({}))).toBeNull();
  });
});

describe("folderStatusSize", () => {
  it("is the folder's size, or calculating, or unknown", () => {
    expect(
      folderStatusSize({
        status: "ready",
        sizeBytes: 5,
        diskBytes: 8,
        fileCount: 1,
        folderCount: 0,
      }),
    ).toEqual({ status: "ready", sizeBytes: 5 });
    expect(folderStatusSize({ status: "calculating", jobId: "1" })).toEqual({
      status: "calculating",
    });
    expect(folderStatusSize({ status: "error", message: "denied" })).toBeNull();
  });
});
