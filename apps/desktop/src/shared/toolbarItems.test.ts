import {
  DEFAULT_LEFT_TOOLBAR_ITEMS,
  sanitizeLeftToolbarItems,
  sanitizeTopToolbarItems,
} from "./toolbarItems";

describe("toolbarItems", () => {
  it("sanitizes top toolbar items, removes duplicates, and restores locked search", () => {
    expect(sanitizeTopToolbarItems(["back", "search", "back", "theme", "openSelection"])).toEqual([
      "back",
      "search",
      "openSelection",
    ]);

    expect(sanitizeTopToolbarItems(["back", "forward"])).toEqual(["back", "forward", "search"]);
  });

  it("preserves repeatable separator items while still deduping normal items", () => {
    expect(sanitizeTopToolbarItems(["topSeparator", "back", "topSeparator", "back"])).toEqual([
      "topSeparator",
      "back",
      "topSeparator",
      "search",
    ]);
  });

  it("sanitizes each rail's items on its own, so both rails can hold the same item", () => {
    expect(
      sanitizeLeftToolbarItems({
        main: ["home", "search", "copyPath", "copyPath", "leftSeparator", "leftSeparator"],
        utility: ["settings", "copyPath", "copyPath", "theme", "sort", "leftSeparator"],
      }),
    ).toEqual({
      main: ["home", "copyPath", "leftSeparator", "leftSeparator"],
      utility: ["settings", "copyPath", "theme", "leftSeparator"],
    });
  });

  it("falls back to the default left rail layout when persisted data is malformed", () => {
    expect(sanitizeLeftToolbarItems(null)).toEqual({
      main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
      utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
    });
  });
});
