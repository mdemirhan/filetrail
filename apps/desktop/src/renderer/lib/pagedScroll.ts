export type PagedScrollAxis = "horizontal" | "vertical";
export type PagedScrollDirection = "backward" | "forward";

type ScrollableElement = Pick<
  HTMLElement,
  "scrollTop" | "scrollLeft" | "clientHeight" | "clientWidth" | "scrollHeight" | "scrollWidth"
> &
  EventTarget;

export function pageScrollElement(
  element: ScrollableElement,
  axis: PagedScrollAxis,
  direction: PagedScrollDirection,
): boolean {
  const isVertical = axis === "vertical";
  const viewportSize = isVertical ? element.clientHeight : element.clientWidth;
  const scrollSize = isVertical ? element.scrollHeight : element.scrollWidth;
  const currentOffset = isVertical ? element.scrollTop : element.scrollLeft;
  const maxOffset = Math.max(0, scrollSize - viewportSize);

  if (viewportSize <= 0 || maxOffset <= 0) {
    return false;
  }

  const delta = direction === "forward" ? viewportSize : -viewportSize;
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
