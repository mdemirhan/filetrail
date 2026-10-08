import { useMemo } from "react";

// Where the item a view keeps in view (the selection's lead, or the item being renamed)
// stands in its list; -1 when it isn't there (yet). A view brings it into view when this
// changes rather than each time the list does: a folder read again after another app added
// or removed an item would otherwise scroll back to it from wherever the list was scrolled.
export function useRevealIndex(
  entries: readonly { path: string }[],
  revealPath: string | null,
): number {
  return useMemo(
    () => (revealPath === null ? -1 : entries.findIndex((entry) => entry.path === revealPath)),
    [entries, revealPath],
  );
}
