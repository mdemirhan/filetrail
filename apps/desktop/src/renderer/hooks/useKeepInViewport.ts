import { type RefObject, useLayoutEffect } from "react";

import { MENU_VIEWPORT_MARGIN, getViewportShift } from "../lib/menuPlacement";

// Keeps a menu or popover inside the window. Once the element is on screen it is measured
// and shifted back in with the CSS `translate` property, which stacks with whatever
// positioning the element already has; an element taller than the window scrolls instead.
// The check runs after every render (so a menu whose contents change is placed again) and
// whenever the window is resized.
export function useKeepInViewport(ref: RefObject<HTMLElement | null>, active = true): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!active || !element) {
      return;
    }
    const place = () => {
      element.style.translate = "";
      element.style.maxHeight = "";
      element.style.overflowY = "";
      const availableHeight = window.innerHeight - MENU_VIEWPORT_MARGIN * 2;
      if (element.getBoundingClientRect().height > availableHeight) {
        element.style.maxHeight = `${availableHeight}px`;
        element.style.overflowY = "auto";
      }
      const rect = element.getBoundingClientRect();
      const shiftX = getViewportShift(rect.left, rect.right, window.innerWidth);
      const shiftY = getViewportShift(rect.top, rect.bottom, window.innerHeight);
      if (shiftX !== 0 || shiftY !== 0) {
        element.style.translate = `${shiftX}px ${shiftY}px`;
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  });
}
