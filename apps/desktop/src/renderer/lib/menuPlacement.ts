// Menus are measured after they render and then nudged back inside the window, so their
// position never depends on a guessed size.

export const MENU_VIEWPORT_MARGIN = 8;

// How far a box spanning `start`..`end` must move along one axis to sit inside
// `margin`..`viewportSize - margin`. A box larger than that space is pinned to its start.
export function getViewportShift(
  start: number,
  end: number,
  viewportSize: number,
  margin = MENU_VIEWPORT_MARGIN,
): number {
  const min = margin;
  const max = viewportSize - margin;
  if (end - start >= max - min) {
    return min - start;
  }
  if (start < min) {
    return min - start;
  }
  if (end > max) {
    return max - end;
  }
  return 0;
}

type Rect = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };

// A submenu opens beside its parent item: to the right when it fits there, otherwise to
// the left, and never past the top or bottom edge of the window.
export function placeSubmenu(args: {
  item: Rect;
  submenu: Size;
  viewport: Size;
  gap?: number;
  margin?: number;
}): { left: number; top: number } {
  const { item, submenu, viewport, gap = 6, margin = MENU_VIEWPORT_MARGIN } = args;
  const fitsRight = item.right + gap + submenu.width <= viewport.width - margin;
  const preferredLeft = fitsRight ? item.right + gap : item.left - gap - submenu.width;
  const left =
    preferredLeft +
    getViewportShift(preferredLeft, preferredLeft + submenu.width, viewport.width, margin);
  // Line the submenu's first item up with the parent item (the menu has 4px of padding).
  const preferredTop = item.top - 4;
  const top =
    preferredTop +
    getViewportShift(preferredTop, preferredTop + submenu.height, viewport.height, margin);
  return { left, top };
}

// A menu that drops from a toolbar item, as a `position: fixed` style. The item can be
// anywhere in the toolbar, so the menu lines up with the edge of it that leaves the menu
// the most room: the left edge for an item in the left half of the window, the right edge
// for one in the right half. `useKeepInViewport` then holds it inside the window.
export function placeDropdownMenu(args: {
  anchor: Rect;
  viewportWidth: number;
  gap?: number;
  margin?: number;
}):
  | { position: "fixed"; top: string; left: string }
  | { position: "fixed"; top: string; right: string } {
  const { anchor, viewportWidth, gap = 6, margin = MENU_VIEWPORT_MARGIN } = args;
  const top = `${anchor.bottom + gap}px`;
  return (anchor.left + anchor.right) / 2 < viewportWidth / 2
    ? { position: "fixed", top, left: `${Math.max(margin, anchor.left)}px` }
    : { position: "fixed", top, right: `${Math.max(margin, viewportWidth - anchor.right)}px` };
}
