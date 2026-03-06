import { getAncestorChain, getNextSelectionIndex, parentDirectoryPath } from "./explorerNavigation";

describe("explorerNavigation", () => {
  it("builds ancestor chains inside the active root", () => {
    expect(getAncestorChain("/Users/demo", "/Users/demo/Documents/Notes")).toEqual([
      "/Users/demo",
      "/Users/demo/Documents",
      "/Users/demo/Documents/Notes",
    ]);
  });

  it("returns the root only when the path is outside the active root", () => {
    expect(getAncestorChain("/Users/demo", "/tmp")).toEqual(["/Users/demo"]);
  });

  it("computes parent directories", () => {
    expect(parentDirectoryPath("/Users/demo/Documents")).toBe("/Users/demo");
    expect(parentDirectoryPath("/Users")).toBe("/");
    expect(parentDirectoryPath("/")).toBeNull();
  });

  it("moves selection by visual columns in list view and single rows in details view", () => {
    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: 6,
        key: "ArrowDown",
        columns: 4,
        viewMode: "list",
      }),
    ).toBe(7);

    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: 6,
        key: "ArrowRight",
        columns: 4,
        viewMode: "list",
      }),
    ).toBe(10);

    expect(
      getNextSelectionIndex({
        itemCount: 30,
        currentIndex: 6,
        key: "ArrowDown",
        columns: 4,
        viewMode: "details",
      }),
    ).toBe(7);
  });
});
