import {
  DEFAULT_TOP_TOOLBAR_ITEMS,
  TOOLBAR_ITEM_IDS,
  addTopToolbarItem,
  getToolbarItemDefinition,
  getTopToolbarPaletteItems,
  insertTopToolbarItem,
  moveTopToolbarItem,
  removeTopToolbarItem,
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

  it("puts a fixed item that a list is missing at the end", () => {
    expect(sanitizeTopToolbarItems(["search", "back", "title"])).toEqual([
      "search",
      "back",
      "title",
      "clipboard",
      "viewOptions",
    ]);
    expect(sanitizeTopToolbarItems(["back", "view"])).toEqual([
      "back",
      "view",
      "title",
      "clipboard",
      "search",
      "viewOptions",
    ]);
    expect(sanitizeTopToolbarItems(null)).toEqual(["title", "clipboard", "search", "viewOptions"]);
  });

  it("preserves repeatable separator items while still deduping normal items", () => {
    expect(
      sanitizeTopToolbarItems([
        "topSeparator",
        "back",
        "topSeparator",
        "back",
        "title",
        "clipboard",
        "search",
        "viewOptions",
      ]),
    ).toEqual([
      "topSeparator",
      "back",
      "topSeparator",
      "title",
      "clipboard",
      "search",
      "viewOptions",
    ]);
  });

  it("adds a clicked item at the far right", () => {
    expect(addTopToolbarItem(DEFAULT_TOP_TOOLBAR_ITEMS, "copyPath")).toEqual([
      ...DEFAULT_TOP_TOOLBAR_ITEMS,
      "copyPath",
    ]);
  });

  it("inserts, moves and removes items by their place in the order", () => {
    const items = DEFAULT_TOP_TOOLBAR_ITEMS;
    expect(insertTopToolbarItem(items, "refresh", 3)).toEqual([
      ...items.slice(0, 3),
      "refresh",
      ...items.slice(3),
    ]);
    // Out of range lands at the nearer end.
    expect(insertTopToolbarItem(items, "refresh", -3)[0]).toBe("refresh");
    expect(insertTopToolbarItem(items, "refresh", 99).at(-1)).toBe("refresh");
    // Back moved after Sort: the index counts the items without Back.
    expect(moveTopToolbarItem(items, 2, 7)).toEqual([
      "folderTree",
      "topSeparator",
      "forward",
      "title",
      "clipboard",
      "view",
      "sort",
      "back",
      "search",
      "viewOptions",
      "infoPanel",
    ]);
    expect(removeTopToolbarItem(items, items.indexOf("sort"))).not.toContain("sort");
    // The four that always stay are not taken off.
    expect(removeTopToolbarItem(items, items.indexOf("search"))).toEqual(items);
  });

  it("offers every item that can be taken off, so each can be put back", () => {
    const palette = getTopToolbarPaletteItems([]);
    const alwaysThere = new Set(["title", "clipboard", "search", "viewOptions"]);
    for (const itemId of TOOLBAR_ITEM_IDS) {
      if (!alwaysThere.has(itemId)) {
        expect(palette, itemId).toContain(itemId);
      }
    }
  });

  it("offers every item the toolbar does not hold, and the space always", () => {
    const palette = getTopToolbarPaletteItems(DEFAULT_TOP_TOOLBAR_ITEMS);
    expect(palette[0]).toBe("topSeparator");
    expect(palette).toContain("refresh");
    for (const itemId of DEFAULT_TOP_TOOLBAR_ITEMS) {
      if (itemId !== "topSeparator") {
        expect(palette).not.toContain(itemId);
      }
    }
    expect(getTopToolbarPaletteItems([...DEFAULT_TOP_TOOLBAR_ITEMS, "topSeparator"])).toContain(
      "topSeparator",
    );
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
