// Scrollbars that show only while they are in use, as on macOS.
//
// The tree and the file panes draw their own thin scrollbars (`.tree-scroll` and
// `.content-scroll` in styles.css), as do the other places that scroll (Help, Settings, the
// Info panel, Favorites: `.overlay-scroll`), and a drawn scrollbar is otherwise always
// there. A pane's scrollbars show while it carries `data-scrollbars`, which it does while it
// scrolls and for a moment after. (A scrollbar under the pointer stays shown by a style
// rule: the pointer's movement over a scrollbar is not reported to the page.)

const LINGER_MS = 1000;
const PANE_SELECTOR = ".tree-scroll, .content-scroll, .overlay-scroll";

export function installScrollbarVisibility(doc: Document = document): () => void {
  const defaultView = doc.defaultView;
  if (!defaultView) {
    return () => undefined;
  }
  const view: Window = defaultView;

  const hideTimers = new Map<HTMLElement, number>();

  function handleScroll(event: Event) {
    const pane = event.target;
    if (!(pane instanceof HTMLElement) || !pane.matches(PANE_SELECTOR)) {
      return;
    }
    pane.setAttribute("data-scrollbars", "");
    const pending = hideTimers.get(pane);
    if (pending !== undefined) {
      view.clearTimeout(pending);
    }
    hideTimers.set(
      pane,
      view.setTimeout(() => {
        hideTimers.delete(pane);
        pane.removeAttribute("data-scrollbars");
      }, LINGER_MS),
    );
  }

  // Scroll events do not bubble; capturing sees the ones of every pane.
  doc.addEventListener("scroll", handleScroll, { capture: true, passive: true });

  return () => {
    doc.removeEventListener("scroll", handleScroll, { capture: true });
    for (const [pane, timer] of hideTimers) {
      view.clearTimeout(timer);
      pane.removeAttribute("data-scrollbars");
    }
    hideTimers.clear();
  };
}
