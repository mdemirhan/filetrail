import { useCallback, useMemo, useRef } from "react";

// How a view scrolls, for keepInView: whether the item at an index is in view as the view is
// scrolled now, and scrolling it into view.
export type RevealScroller = {
  isInView: (index: number) => boolean;
  reveal: (index: number) => void;
};

type Seen = {
  entries: readonly { path: string }[];
  // What asked for the item to be shown: the item, the order chosen, and a refused name.
  ask: string;
  // Where the item stood when last found in the list; -1 while it never was.
  index: number;
  scrollTop: number;
  scrollLeft: number;
};

// Where the item a view keeps in view (the selection's lead, or the item being renamed)
// stands in its list (-1 when it isn't there, yet), and keepInView, which a view calls from a
// layout effect that runs when this or its layout changes.
//
// The item is brought into view when it becomes the one to show (a click, the arrow keys, a
// rename starting, a folder opened), when it shows up in the list, when another order is
// chosen (`sortKey`; when the list comes back sorted, it is kept in view), and when asked
// again (`askedAgain`: a refused name). When only the list changed around it (another app
// added an item, sizes coming in re-sort the list, a date changed), it is kept in view if it
// was in view, and otherwise the list stays where it was scrolled. When the layout changed,
// it is kept in view unless the list was scrolled since: Back and a tab coming back put back
// where the list was scrolled.
export function useRevealIndex(
  entries: readonly { path: string }[],
  revealPath: string | null,
  options: { sortKey?: string; askedAgain?: number } = {},
): { index: number; keepInView: (container: HTMLElement, scroller: RevealScroller) => void } {
  const ask = JSON.stringify([revealPath, options.sortKey ?? "", options.askedAgain ?? 0]);
  const index = useMemo(
    () => (revealPath === null ? -1 : entries.findIndex((entry) => entry.path === revealPath)),
    [entries, revealPath],
  );
  const seenRef = useRef<Seen | null>(null);
  const keepInView = useCallback(
    (container: HTMLElement, scroller: RevealScroller) => {
      const seen = seenRef.current;
      const sameAsk = seen !== null && seen.ask === ask;
      let reveal: boolean;
      if (index < 0) {
        // Not there (yet): brought into view when it shows up.
        reveal = false;
      } else if (seen === null || !sameAsk || seen.index < 0) {
        reveal = true;
      } else if (seen.entries !== entries) {
        reveal = seen.index !== index && scroller.isInView(seen.index);
      } else {
        reveal =
          Math.abs(container.scrollTop - seen.scrollTop) <= 1 &&
          Math.abs(container.scrollLeft - seen.scrollLeft) <= 1;
      }
      if (reveal) {
        scroller.reveal(index);
      }
      seenRef.current = {
        entries,
        ask,
        index: index >= 0 ? index : sameAsk ? seen.index : -1,
        scrollTop: container.scrollTop,
        scrollLeft: container.scrollLeft,
      };
    },
    [ask, entries, index],
  );
  return { index, keepInView };
}
