import { buildContentStatusSummary } from "./statusSummary";

describe("buildContentStatusSummary", () => {
  const sizes: Record<string, number | null> = {
    "/a.txt": 1000,
    "/b.txt": 2000,
    "/folder": null,
  };
  const getKnownSizeBytes = (path: string) => sizes[path] ?? null;

  it("shows the item count when nothing is selected", () => {
    expect(
      buildContentStatusSummary({
        itemCount: 4,
        selectedPaths: [],
        getKnownSizeBytes,
      }),
    ).toBe("4 items");
  });

  it("adds the selection size when every selected size is known", () => {
    expect(
      buildContentStatusSummary({
        itemCount: 4,
        selectedPaths: ["/a.txt", "/b.txt"],
        getKnownSizeBytes,
      }),
    ).toBe("2 of 4 selected · 3.0 KB");
  });

  it("omits the size when a selected folder has not been calculated", () => {
    expect(
      buildContentStatusSummary({
        itemCount: 1,
        selectedPaths: ["/folder"],
        getKnownSizeBytes,
      }),
    ).toBe("1 of 1 selected");
  });

  it("says how many items show when typing has narrowed the list", () => {
    expect(
      buildContentStatusSummary({
        itemCount: 240,
        shownCount: 3,
        selectedPaths: [],
        getKnownSizeBytes,
      }),
    ).toBe("3 of 240 items");
  });
});
