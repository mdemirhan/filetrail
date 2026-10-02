import { type ToolbarItemId, isRequiredTopToolbarItem } from "../../shared/toolbarItems";

// The top toolbar is one row, in the order chosen in Settings. Two of its items have no
// width of their own: the title takes whatever room the others leave, and the search field
// has a resting width, a wider one while it is in use, and gives way when the row is tight.
// Every other item is as wide as its contents. styles.css lays the row out, from the
// `--toolbar-*` properties of `.window-toolbar`; the code here works out which items there
// is room for, from the same numbers (a test holds the two in step).
export const TOP_TOOLBAR_LAYOUT = {
  itemGap: 4,
  titleMinWidth: 96,
  searchWidth: 200,
  searchFocusedWidth: 280,
  searchMinWidth: 110,
} as const;

export type TopToolbarSlot = { id: ToolbarItemId; key: string };

// Gives each item a key that stays the same wherever the item is moved: its id, with a
// count for separators, the one item that can be there more than once.
export function resolveTopToolbarSlots(items: readonly ToolbarItemId[]): TopToolbarSlot[] {
  const seen = new Map<ToolbarItemId, number>();
  return items.map((id) => {
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return { id, key: count === 0 ? id : `${id}:${count}` };
  });
}

// A separator with nothing on one side of it, or right after another, divides nothing.
function withoutIdleSeparators(slots: readonly TopToolbarSlot[]): TopToolbarSlot[] {
  const result: TopToolbarSlot[] = [];
  for (const slot of slots) {
    if (
      slot.id === "topSeparator" &&
      (result.length === 0 || result.at(-1)?.id === "topSeparator")
    ) {
      continue;
    }
    result.push(slot);
  }
  if (result.at(-1)?.id === "topSeparator") {
    result.pop();
  }
  return result;
}

// The row to draw when there is room for `optionalCount` of the items that can be taken off
// the toolbar. Those are kept in order from the start, so the ones nearest the end are the
// first to go; the required items always stay.
export function selectTopToolbarSlots(
  slots: readonly TopToolbarSlot[],
  optionalCount: number,
): TopToolbarSlot[] {
  let remaining = optionalCount;
  return withoutIdleSeparators(
    slots.filter((slot) => {
      if (isRequiredTopToolbarItem(slot.id)) {
        return true;
      }
      remaining -= 1;
      return remaining >= 0;
    }),
  );
}

function getRowMinWidth(
  slots: readonly TopToolbarSlot[],
  widths: ReadonlyMap<string, number>,
): number {
  let total = Math.max(0, slots.length - 1) * TOP_TOOLBAR_LAYOUT.itemGap;
  for (const slot of slots) {
    total +=
      slot.id === "title"
        ? TOP_TOOLBAR_LAYOUT.titleMinWidth
        : slot.id === "search"
          ? TOP_TOOLBAR_LAYOUT.searchMinWidth
          : (widths.get(slot.key) ?? 0);
  }
  return total;
}

// How many of the removable items fit beside the required ones. The title and the search
// field are counted at their narrowest, and never at the search field's width while it is
// in use, so buttons are hidden only once those two have given up all they can, and
// clicking into the search field never makes a button disappear.
export function resolveVisibleOptionalCount({
  slots,
  widths,
  availableWidth,
}: {
  // The items on screen now, in order.
  slots: readonly TopToolbarSlot[];
  // The measured width of every item but the title and the search field, by key.
  widths: ReadonlyMap<string, number>;
  availableWidth: number;
}): number {
  const optionalCount = slots.filter((slot) => !isRequiredTopToolbarItem(slot.id)).length;
  // Nothing has been laid out yet (or there is no layout at all): keep the whole toolbar.
  const laidOut =
    availableWidth > 0 &&
    slots.every(
      (slot) => slot.id === "title" || slot.id === "search" || (widths.get(slot.key) ?? 0) > 0,
    );
  if (!laidOut) {
    return optionalCount;
  }
  for (let count = optionalCount; count > 0; count -= 1) {
    if (getRowMinWidth(selectTopToolbarSlots(slots, count), widths) <= availableWidth) {
      return count;
    }
  }
  return 0;
}
