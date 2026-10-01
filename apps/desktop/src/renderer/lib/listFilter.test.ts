import {
  filterEntriesByName,
  filterSearchResultsByText,
  findListFilterSelection,
  formatItemCount,
} from "./listFilter";

const entries = [
  { name: "Android" },
  { name: "Documents" },
  { name: "my doc.txt" },
  { name: "report (1).pdf" },
  { name: "C++ notes" },
];

describe("list filter", () => {
  it("keeps the names that contain the text, in their order, ignoring case", () => {
    expect(filterEntriesByName(entries, "DO").map((entry) => entry.name)).toEqual([
      "Documents",
      "my doc.txt",
    ]);
    expect(filterEntriesByName(entries, "d").map((entry) => entry.name)).toEqual([
      "Android",
      "Documents",
      "my doc.txt",
      "report (1).pdf",
    ]);
    // The text is taken as typed: spaces count, and nothing is a pattern.
    expect(filterEntriesByName(entries, "y d").map((entry) => entry.name)).toEqual(["my doc.txt"]);
    expect(filterEntriesByName(entries, "(1)").map((entry) => entry.name)).toEqual([
      "report (1).pdf",
    ]);
    expect(filterEntriesByName(entries, "c++").map((entry) => entry.name)).toEqual(["C++ notes"]);
    expect(filterEntriesByName(entries, "zzz")).toEqual([]);
  });

  it("returns the same list when there is no filter", () => {
    expect(filterEntriesByName(entries, "")).toBe(entries);
  });

  it("selects the first name starting with the text, as type-to-select would", () => {
    // "Android" contains "d" and comes first, but "Documents" starts with it.
    const matches = filterEntriesByName(entries, "d");
    expect(findListFilterSelection(matches, "d")?.name).toBe("Documents");
    // No name starts with it: the first match.
    expect(findListFilterSelection(filterEntriesByName(entries, "oc"), "oc")?.name).toBe(
      "Documents",
    );
    expect(findListFilterSelection([], "zzz")).toBeNull();
    expect(findListFilterSelection(entries, "")).toBeNull();
  });

  it("filters search results by name or by the folder they are in", () => {
    const results = [
      { name: "App.tsx", relativeParentPath: "src/components" },
      { name: "App.test.tsx", relativeParentPath: "tests" },
      { name: "src-notes.md", relativeParentPath: "docs" },
    ];
    const names = (query: string) =>
      filterSearchResultsByText(results, query).map((result) => result.name);

    expect(names("app")).toEqual(["App.tsx", "App.test.tsx"]);
    // "src" is a folder of one result and part of the name of another.
    expect(names("SRC")).toEqual(["App.tsx", "src-notes.md"]);
    expect(names("tests")).toEqual(["App.test.tsx"]);
    expect(names("zzz")).toEqual([]);
    expect(filterSearchResultsByText(results, "")).toBe(results);
  });

  it("counts the items, mentioning the total only while some are hidden", () => {
    expect(formatItemCount(240, 240)).toBe("240 items");
    expect(formatItemCount(1, 1)).toBe("1 item");
    expect(formatItemCount(3, 240)).toBe("3 of 240 items");
    expect(formatItemCount(0, 1)).toBe("0 of 1 item");
  });
});
