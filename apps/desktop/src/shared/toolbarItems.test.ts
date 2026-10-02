import {
  DEFAULT_LEFT_TOOLBAR_ITEMS,
  DEFAULT_TOP_TOOLBAR_ITEMS,
  addTopToolbarItem,
  sanitizeLeftToolbarItems,
  sanitizeTopToolbarItems,
} from "./toolbarItems";

describe("toolbarItems", () => {
  it("keeps a top toolbar's order, the fixed items wherever they were put", () => {
    const customized = [
      "search",
      "back",
      "viewOptions",
      "topSeparator",
      "sort",
      "title",
      "topSeparator",
      "clipboard",
      "view",
    ];
    expect(sanitizeTopToolbarItems(customized)).toEqual(customized);
    expect(sanitizeTopToolbarItems(DEFAULT_TOP_TOOLBAR_ITEMS)).toEqual(DEFAULT_TOP_TOOLBAR_ITEMS);
  });

  it("drops items that are unknown, repeated or not for the top toolbar", () => {
    expect(
      sanitizeTopToolbarItems([
        "back",
        "title",
        "title",
        "back",
        "theme",
        "nonsense",
        "search",
        "openSelection",
        "clipboard",
        "viewOptions",
        "search",
      ]),
    ).toEqual(["back", "title", "search", "openSelection", "clipboard", "viewOptions"]);
  });

  it("gives a toolbar saved before the title could be moved the places they were drawn in", () => {
    // Back and Forward led, the title followed, and the clipboard button, View Options and
    // search closed the toolbar, wherever the list had search.
    expect(
      sanitizeTopToolbarItems(["back", "forward", "view", "sort", "infoPanel", "search"]),
    ).toEqual(DEFAULT_TOP_TOOLBAR_ITEMS);
    expect(sanitizeTopToolbarItems(["back", "search", "openSelection"])).toEqual([
      "back",
      "title",
      "openSelection",
      "clipboard",
      "viewOptions",
      "search",
    ]);
    // Without Back or Forward at the start the title came first.
    expect(sanitizeTopToolbarItems(["view", "back"])).toEqual([
      "title",
      "view",
      "back",
      "clipboard",
      "viewOptions",
      "search",
    ]);
    expect(sanitizeTopToolbarItems(null)).toEqual(["title", "clipboard", "viewOptions", "search"]);
  });

  it("puts back a fixed item that a list with the title is missing", () => {
    expect(sanitizeTopToolbarItems(["search", "title", "back"])).toEqual([
      "clipboard",
      "viewOptions",
      "search",
      "title",
      "back",
    ]);
    expect(sanitizeTopToolbarItems(["title", "back"])).toEqual([
      "title",
      "back",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("preserves repeatable separator items while still deduping normal items", () => {
    expect(sanitizeTopToolbarItems(["topSeparator", "back", "topSeparator", "back"])).toEqual([
      "title",
      "topSeparator",
      "back",
      "topSeparator",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("adds an item ahead of the fixed items that close the toolbar", () => {
    expect(addTopToolbarItem(DEFAULT_TOP_TOOLBAR_ITEMS, "copyPath")).toEqual([
      "back",
      "forward",
      "title",
      "view",
      "sort",
      "infoPanel",
      "copyPath",
      "clipboard",
      "viewOptions",
      "search",
    ]);
    // Straight after the title when only fixed items follow it.
    expect(
      addTopToolbarItem(["back", "title", "clipboard", "viewOptions", "search"], "sort"),
    ).toEqual(["back", "title", "sort", "clipboard", "viewOptions", "search"]);
    // At the very end when a button or the title closes the toolbar.
    expect(addTopToolbarItem(["search", "clipboard", "viewOptions", "title"], "sort")).toEqual([
      "search",
      "clipboard",
      "viewOptions",
      "title",
      "sort",
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
