import { type ToolbarItemId, isRequiredTopToolbarItem } from "../../shared/toolbarItems";

// The top toolbar is one row, in the order chosen in Settings. Two of its items have no
// width of their own: the title takes whatever room the others leave, and the search field
// has a resting width, a wider one while it is in use, and gives way when the row is tight.
// Every other item is as wide as its contents. An item with an edge of its own (the search
// field, the view switch) keeps `edgedItemInset` clear on each side, which spaces its edge
// from its neighbours as a button's icon is spaced by the button's padding; the search
// field's widths here are the field's, without that room. styles.css lays the row out, from the
// `--toolbar-*` properties of `.window-toolbar`; the code here works out which items there
// is room for, from the same numbers (a test holds the two in step).
export const TOP_TOOLBAR_LAYOUT = {
  itemGap: 2,
  edgedItemInset: 5,
  // Buttons side by side sit on one capsule, as in a macOS 26 toolbar; it reaches this far
  // past the first and last button, and keeps `edgedItemInset` clear beyond that.
  capsulePadding: 3,
  titleMinWidth: 96,
  // The » button that lists the items there is no room for, a button of its own capsule.
  overflowButtonWidth: 32,
  searchWidth: 200,
  searchMinWidth: 110,
} as const;

export type TopToolbarSlot = { id: ToolbarItemId; key: string };

// Items that draw an edge of their own (the title has none) are not buttons on a capsule.
const NOT_ON_A_CAPSULE: ReadonlySet<ToolbarItemId> = new Set([
  "title",
  "search",
  "view",
  "topSeparator",
]);

export type ToolbarCapsuleEdges = { start: boolean; end: boolean };

// Which items are buttons on a capsule, and whether each starts or ends its capsule: a
// capsule is a run of buttons with nothing else between them. `isShown` leaves out an item
// that is in the row but has nothing on screen (the clipboard button with nothing copied).
export function resolveToolbarCapsules(
  slots: readonly TopToolbarSlot[],
  isShown: (slot: TopToolbarSlot) => boolean = () => true,
): Map<string, ToolbarCapsuleEdges> {
  const onCapsule = slots.map((slot) => !NOT_ON_A_CAPSULE.has(slot.id) && isShown(slot));
  const shown = slots.map((slot) => isShown(slot));
  const edges = new Map<string, ToolbarCapsuleEdges>();
  const neighbour = (index: number, step: 1 | -1): number => {
    let next = index + step;
    while (next >= 0 && next < slots.length && !shown[next]) {
      next += step;
    }
    return next;
  };
  slots.forEach((slot, index) => {
    if (!onCapsule[index]) {
      return;
    }
    const previous = neighbour(index, -1);
    const next = neighbour(index, 1);
    edges.set(slot.key, {
      start: !(onCapsule[previous] ?? false),
      end: !(onCapsule[next] ?? false),
    });
  });
  return edges;
}

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
  // Each capsule reaches past its first and last button, and keeps clear of its neighbours.
  const capsuleOverhang = TOP_TOOLBAR_LAYOUT.capsulePadding + TOP_TOOLBAR_LAYOUT.edgedItemInset;
  for (const edges of resolveToolbarCapsules(
    slots,
    (slot) => slot.id !== "clipboard" || (widths.get(slot.key) ?? 0) > 0,
  ).values()) {
    total += (edges.start ? capsuleOverhang : 0) + (edges.end ? capsuleOverhang : 0);
  }
  for (const slot of slots) {
    total +=
      slot.id === "title"
        ? TOP_TOOLBAR_LAYOUT.titleMinWidth
        : slot.id === "search"
          ? TOP_TOOLBAR_LAYOUT.searchMinWidth + 2 * TOP_TOOLBAR_LAYOUT.edgedItemInset
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
  // Once any item is left out, the » button that lists them takes room of its own.
  const overflowWidth =
    TOP_TOOLBAR_LAYOUT.itemGap +
    TOP_TOOLBAR_LAYOUT.overflowButtonWidth +
    2 * (TOP_TOOLBAR_LAYOUT.capsulePadding + TOP_TOOLBAR_LAYOUT.edgedItemInset);
  for (let count = optionalCount; count > 0; count -= 1) {
    const reserved = count < optionalCount ? overflowWidth : 0;
    if (getRowMinWidth(selectTopToolbarSlots(slots, count), widths) + reserved <= availableWidth) {
      return count;
    }
  }
  return 0;
}

// Where an item dragged along the toolbar lands: its index among the other items, which is
// how many of them have their middle left of the pointer. Counting from the items as they
// stand (the gap for the dragged item open among them) gives one answer per pointer
// position: opening the gap moves the item past it further from the pointer, never across.
export function resolveToolbarDropIndex(centers: readonly number[], pointerX: number): number {
  return centers.filter((center) => center < pointerX).length;
}
