import { toPreferencePatch } from "./bootstrap";

describe("toPreferencePatch", () => {
  it("preserves search result sorting fields", () => {
    expect(
      toPreferencePatch({
        searchResultsSortBy: "name",
        searchResultsSortDirection: "desc",
      }),
    ).toEqual({
      searchResultsSortBy: "name",
      searchResultsSortDirection: "desc",
    });
  });

  it("preserves pane tab switching preferences", () => {
    expect(
      toPreferencePatch({
        tabSwitchesExplorerPanes: false,
      }),
    ).toEqual({
      tabSwitchesExplorerPanes: false,
    });
  });
});
