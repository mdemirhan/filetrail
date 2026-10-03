import { readFileSync } from "node:fs";

import {
  TOP_TOOLBAR_LAYOUT,
  resolveToolbarCapsules,
  resolveTopToolbarSlots,
  resolveVisibleOptionalCount,
  selectTopToolbarSlots,
} from "./topToolbarLayout";

const keysOf = (slots: ReturnType<typeof resolveTopToolbarSlots>) => slots.map((slot) => slot.key);

// Widths for a row whose buttons are all 32 wide.
function widthsOf(slots: ReturnType<typeof resolveTopToolbarSlots>, width = 32) {
  return new Map(slots.map((slot) => [slot.key, width]));
}

// The narrowest a row of 32-wide items, the title and the search field can be: each capsule
// of buttons also reaches past its first and last button.
function minRowWidth(row: ReturnType<typeof resolveTopToolbarSlots>) {
  const fixedCount = row.filter((slot) => slot.id !== "title" && slot.id !== "search").length;
  const capsuleEnds = Array.from(resolveToolbarCapsules(row).values()).reduce(
    (count, edges) => count + (edges.start ? 1 : 0) + (edges.end ? 1 : 0),
    0,
  );
  return (
    fixedCount * 32 +
    TOP_TOOLBAR_LAYOUT.titleMinWidth +
    TOP_TOOLBAR_LAYOUT.searchMinWidth +
    2 * TOP_TOOLBAR_LAYOUT.edgedItemInset +
    capsuleEnds * (TOP_TOOLBAR_LAYOUT.capsulePadding + TOP_TOOLBAR_LAYOUT.edgedItemInset) +
    (row.length - 1) * TOP_TOOLBAR_LAYOUT.itemGap
  );
}

describe("TOP_TOOLBAR_LAYOUT", () => {
  it("has the sizes the stylesheet lays the toolbar out from", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    const sizeOf = (property: string) =>
      Number(new RegExp(`${property}: (\\d+)px;`, "u").exec(styles)?.[1]);
    expect({
      itemGap: sizeOf("--toolbar-item-gap"),
      edgedItemInset: sizeOf("--toolbar-edged-item-inset"),
      capsulePadding: sizeOf("--toolbar-capsule-padding"),
      titleMinWidth: sizeOf("--toolbar-title-min-width"),
      searchWidth: sizeOf("--toolbar-search-width"),
      searchFocusedWidth: sizeOf("--toolbar-search-focused-width"),
      searchMinWidth: sizeOf("--toolbar-search-min-width"),
    }).toEqual(TOP_TOOLBAR_LAYOUT);
  });
});

describe("resolveTopToolbarSlots", () => {
  it("keys each item by its id, and repeated separators by their count", () => {
    expect(
      keysOf(resolveTopToolbarSlots(["back", "topSeparator", "title", "topSeparator", "search"])),
    ).toEqual(["back", "topSeparator", "title", "topSeparator:1", "search"]);
  });
});

describe("selectTopToolbarSlots", () => {
  const slots = resolveTopToolbarSlots([
    "back",
    "forward",
    "title",
    "view",
    "sort",
    "viewOptions",
    "search",
    "copyPath",
  ]);

  it("keeps the removable items from the start and every required item", () => {
    expect(keysOf(selectTopToolbarSlots(slots, 5))).toEqual(keysOf(slots));
    expect(keysOf(selectTopToolbarSlots(slots, 3))).toEqual([
      "back",
      "forward",
      "title",
      "view",
      "viewOptions",
      "search",
    ]);
    expect(keysOf(selectTopToolbarSlots(slots, 0))).toEqual(["title", "viewOptions", "search"]);
  });

  it("drops separators left with nothing to divide", () => {
    const withSeparators = resolveTopToolbarSlots([
      "topSeparator",
      "back",
      "topSeparator",
      "topSeparator",
      "title",
      "view",
      "topSeparator",
      "sort",
      "search",
      "topSeparator",
    ]);
    expect(keysOf(selectTopToolbarSlots(withSeparators, 7))).toEqual([
      "back",
      "topSeparator:1",
      "title",
      "view",
      "topSeparator:3",
      "sort",
      "search",
    ]);
    // With only the first separator and Back there is nothing left for it to divide.
    expect(keysOf(selectTopToolbarSlots(withSeparators, 2))).toEqual(["back", "title", "search"]);
  });
});

describe("resolveVisibleOptionalCount", () => {
  const slots = resolveTopToolbarSlots([
    "back",
    "forward",
    "title",
    "view",
    "sort",
    "clipboard",
    "viewOptions",
    "search",
  ]);
  const widths = widthsOf(slots);

  it("keeps every item while the title and search field can still give room", () => {
    // Six fixed items: four removable, plus the clipboard button and View Options.
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: 1200 })).toBe(4);
    expect(
      resolveVisibleOptionalCount({
        slots,
        widths,
        availableWidth: minRowWidth(selectTopToolbarSlots(slots, 4)),
      }),
    ).toBe(4);
  });

  it("hides the removable items nearest the end first, and never a required one", () => {
    expect(
      resolveVisibleOptionalCount({
        slots,
        widths,
        availableWidth: minRowWidth(selectTopToolbarSlots(slots, 4)) - 1,
      }),
    ).toBe(3);
    expect(
      resolveVisibleOptionalCount({
        slots,
        widths,
        availableWidth: minRowWidth(selectTopToolbarSlots(slots, 1)),
      }),
    ).toBe(1);
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: 40 })).toBe(0);
  });

  it("counts a wider clipboard button against the buttons", () => {
    const wideClipboard = new Map(widths).set("clipboard", 60);
    expect(
      resolveVisibleOptionalCount({
        slots,
        widths: wideClipboard,
        availableWidth: minRowWidth(selectTopToolbarSlots(slots, 4)),
      }),
    ).toBe(3);
  });

  it("does not count a separator that would be dropped", () => {
    const withSeparator = resolveTopToolbarSlots([
      "back",
      "title",
      "search",
      "topSeparator",
      "sort",
    ]);
    const separatorWidths = widthsOf(withSeparator).set("topSeparator", 11);
    // Sort does not fit, which leaves the separator closing the row: it is not drawn, so it
    // is not what the row is too narrow for.
    expect(
      resolveVisibleOptionalCount({
        slots: withSeparator,
        widths: separatorWidths,
        availableWidth: minRowWidth(selectTopToolbarSlots(withSeparator, 2)),
      }),
    ).toBe(2);
    expect(keysOf(selectTopToolbarSlots(withSeparator, 2))).toEqual(["back", "title", "search"]);
  });

  it("keeps the whole toolbar until it has been laid out", () => {
    expect(resolveVisibleOptionalCount({ slots, widths: new Map(), availableWidth: 300 })).toBe(4);
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: 0 })).toBe(4);
  });
});

describe("resolveToolbarCapsules", () => {
  it("puts buttons side by side on one capsule, and leaves the title, search and view switch off", () => {
    const row = resolveTopToolbarSlots([
      "back",
      "forward",
      "title",
      "clipboard",
      "view",
      "sort",
      "search",
      "viewOptions",
      "infoPanel",
    ]);
    const edges = resolveToolbarCapsules(row);
    expect(Object.fromEntries(edges)).toEqual({
      back: { start: true, end: false },
      forward: { start: false, end: true },
      clipboard: { start: true, end: true },
      sort: { start: true, end: true },
      viewOptions: { start: true, end: false },
      infoPanel: { start: false, end: true },
    });
  });

  it("joins the buttons on either side of an item that is not shown", () => {
    const row = resolveTopToolbarSlots(["sort", "clipboard", "viewOptions"]);
    const edges = resolveToolbarCapsules(row, (slot) => slot.id !== "clipboard");
    expect(Object.fromEntries(edges)).toEqual({
      sort: { start: true, end: false },
      viewOptions: { start: false, end: true },
    });
  });
});
