import {
  DEFAULT_TOP_TOOLBAR_ITEMS,
  TOOLBAR_ITEM_IDS,
  addTopToolbarItem,
  getToolbarItemDefinition,
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

  it("drops items that are unknown or repeated", () => {
    expect(
      sanitizeTopToolbarItems([
        "back",
        "title",
        "title",
        "back",
        "leftSeparator",
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
    ).toEqual([
      "back",
      "forward",
      "title",
      "view",
      "sort",
      "infoPanel",
      "clipboard",
      "viewOptions",
      "search",
    ]);
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

  it("adds an item with the buttons ahead of the search field", () => {
    expect(addTopToolbarItem(DEFAULT_TOP_TOOLBAR_ITEMS, "copyPath")).toEqual([
      "back",
      "forward",
      "title",
      "clipboard",
      "view",
      "sort",
      "copyPath",
      "search",
      "viewOptions",
      "infoPanel",
    ]);
    // Ahead of a clipboard button and View Options that sit right before the field, and
    // straight after the title when nothing else is between them.
    expect(
      addTopToolbarItem(["back", "title", "view", "clipboard", "viewOptions", "search"], "sort"),
    ).toEqual(["back", "title", "view", "sort", "clipboard", "viewOptions", "search"]);
    expect(
      addTopToolbarItem(["back", "title", "clipboard", "viewOptions", "search"], "sort"),
    ).toEqual(["back", "title", "sort", "clipboard", "viewOptions", "search"]);
    // Last when the search field opens the toolbar.
    expect(addTopToolbarItem(["search", "clipboard", "viewOptions", "title"], "sort")).toEqual([
      "search",
      "clipboard",
      "viewOptions",
      "title",
      "sort",
    ]);
  });

  it("drops the items that went with the rails and the old Open Selected Item button", () => {
    expect(
      sanitizeTopToolbarItems([
        "back",
        "down",
        "home",
        "root",
        "applications",
        "trash",
        "rerootHome",
        "leftSeparator",
        "title",
        "clipboard",
        "viewOptions",
        "search",
      ]),
    ).toEqual(["back", "title", "clipboard", "viewOptions", "search"]);
  });

  it("offers the app's own buttons and the new file actions", () => {
    expect(
      sanitizeTopToolbarItems([
        "title",
        "newTab",
        "quickLook",
        "showInFinder",
        "theme",
        "settings",
        "help",
        "clipboard",
        "viewOptions",
        "search",
      ]),
    ).toEqual([
      "title",
      "newTab",
      "quickLook",
      "showInFinder",
      "theme",
      "settings",
      "help",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("gives every button a command to run, apart from the ones the toolbar draws itself", () => {
    const drawnByTheToolbar = new Set([
      "back",
      "forward",
      "up",
      "view",
      "sort",
      "title",
      "clipboard",
      "viewOptions",
      "search",
      "foldersFirst",
      "hidden",
      "infoPanel",
      "infoRow",
      "theme",
      "topSeparator",
    ]);
    const withoutCommand = TOOLBAR_ITEM_IDS.filter(
      (itemId) => getToolbarItemDefinition(itemId).commandType === undefined,
    );
    expect(withoutCommand.filter((itemId) => !drawnByTheToolbar.has(itemId))).toEqual([]);
  });
});
