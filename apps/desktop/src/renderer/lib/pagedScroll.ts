export type PagedScrollAxis = "horizontal" | "vertical";

type ScrollableElement = Pick<
  HTMLElement,
  "scrollTop" | "scrollLeft" | "clientHeight" | "clientWidth" | "scrollHeight" | "scrollWidth"
> &
  EventTarget;

// Scrolls by `delta` (rows or columns a page moved), stopping at either end, and emits a
// synthetic `scroll` event so controlled React state that mirrors the DOM scroll offset
// stays in sync immediately. Whether it scrolled.
export function scrollElementByAmount(
  element: ScrollableElement,
  axis: PagedScrollAxis,
  delta: number,
): boolean {
  const isVertical = axis === "vertical";
  const viewportSize = isVertical ? element.clientHeight : element.clientWidth;
  const scrollSize = isVertical ? element.scrollHeight : element.scrollWidth;
  const currentOffset = isVertical ? element.scrollTop : element.scrollLeft;
  const maxOffset = Math.max(0, scrollSize - viewportSize);

  if (viewportSize <= 0 || maxOffset <= 0) {
    return false;
  }

  const nextOffset = Math.max(0, Math.min(maxOffset, currentOffset + delta));
  if (Math.abs(nextOffset - currentOffset) <= 1) {
    return false;
  }

  if (isVertical) {
    element.scrollTop = nextOffset;
  } else {
    element.scrollLeft = nextOffset;
  }

  element.dispatchEvent(new Event("scroll"));
  return true;
}
