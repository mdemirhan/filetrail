import { useEffect } from "react";

// How many menus are open in this window.
let openMenuCount = 0;

// Rendered inside every menu while it is open. A click on a part of the window that drags it
// (the toolbar, the title) never reaches the page: macOS takes it, so the menu wouldn't
// close. While a menu is open those parts drag nothing (see `data-menu-open` in
// styles.css), and the click closes the menu as a click anywhere else does.
//
// A flag on the page rather than a `:has()` rule that looks for open menus: such a rule is
// checked again on every change to the page, which made opening a folder many times slower.
export function WindowDragRelease(): null {
  useEffect(() => {
    openMenuCount += 1;
    document.documentElement.dataset.menuOpen = "";
    return () => {
      openMenuCount -= 1;
      if (openMenuCount === 0) {
        delete document.documentElement.dataset.menuOpen;
      }
    };
  }, []);
  return null;
}
