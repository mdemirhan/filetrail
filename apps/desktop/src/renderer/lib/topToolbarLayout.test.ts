import { readFileSync } from "node:fs";

import {
  TOP_TOOLBAR_LAYOUT,
  resolveTopToolbarSlots,
  resolveVisibleOptionalCount,
  selectTopToolbarSlots,
} from "./topToolbarLayout";

const keysOf = (slots: ReturnType<typeof resolveTopToolbarSlots>) => slots.map((slot) => slot.key);

// Widths for a row whose buttons are all 32 wide.
function widthsOf(slots: ReturnType<typeof resolveTopToolbarSlots>, width = 32) {
  return new Map(slots.map((slot) => [slot.key, width]));
}

// The narrowest a row of `fixedCount` 32-wide items, the title and the search field can be.
function minRowWidth(fixedCount: number) {
  return (
    fixedCount * 32 +
    TOP_TOOLBAR_LAYOUT.titleMinWidth +
    TOP_TOOLBAR_LAYOUT.searchMinWidth +
    (fixedCount + 1) * TOP_TOOLBAR_LAYOUT.itemGap
  );
}

describe("TOP_TOOLBAR_LAYOUT", () => {
  it("has the sizes the stylesheet lays the toolbar out from", () => {
    const styles = readFileSync("apps/desktop/src/renderer/styles.css", "utf8");
    const sizeOf = (property: string) =>
      Number(new RegExp(`${property}: (\\d+)px;`, "u").exec(styles)?.[1]);
    expect({
      itemGap: sizeOf("--toolbar-item-gap"),
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
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: minRowWidth(6) })).toBe(4);
  });

  it("hides the removable items nearest the end first, and never a required one", () => {
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: minRowWidth(6) - 1 })).toBe(
      3,
    );
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: minRowWidth(3) })).toBe(1);
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: 40 })).toBe(0);
  });

  it("counts a wider clipboard button against the buttons", () => {
    const wideClipboard = new Map(widths).set("clipboard", 60);
    expect(
      resolveVisibleOptionalCount({
        slots,
        widths: wideClipboard,
        availableWidth: minRowWidth(6),
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
        availableWidth: minRowWidth(1),
      }),
    ).toBe(2);
    expect(keysOf(selectTopToolbarSlots(withSeparator, 2))).toEqual(["back", "title", "search"]);
  });

  it("keeps the whole toolbar until it has been laid out", () => {
    expect(resolveVisibleOptionalCount({ slots, widths: new Map(), availableWidth: 300 })).toBe(4);
    expect(resolveVisibleOptionalCount({ slots, widths, availableWidth: 0 })).toBe(4);
  });
});
