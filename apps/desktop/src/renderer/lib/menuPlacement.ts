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
