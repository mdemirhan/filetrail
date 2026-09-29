import { type RefObject, useEffect } from "react";

import { getFocusableElements } from "../lib/focusUtils";

// Keyboard focus for the copy/paste sheets and alerts, which are modal but not opened with
// showModal(): the first focus goes to `initialFocusRef` (or the dialog), Tab and Shift+Tab
// wrap around inside the dialog instead of reaching the window behind it, and closing the
// dialog puts focus back where it was, so the keyboard user keeps their place.
export function useDialogFocus(
  dialogRef: RefObject<HTMLElement | null>,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus is taken once, on open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initialFocusRef?.current ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.defaultPrevented) {
        return;
      }
      const focusable = getFocusableElements(dialog);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !dialog.contains(active) || active === dialog;
      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    // On the document, so Tab also comes back into the dialog when focus fell out of it (for
    // example to the page after a button inside became disabled).
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, []);
}
