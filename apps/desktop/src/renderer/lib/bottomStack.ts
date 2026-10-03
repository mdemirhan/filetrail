import { useLayoutEffect, useState } from "react";

// What sits at the bottom right of the window rests just above whatever is already there:
// a running operation's card above the path bar (and the Info Row under it), and
// notifications above the card when there is one. Measured, because those come and go.
const GAP_ABOVE = 10;
const GAP_BETWEEN = 8;
// Where nothing is at the bottom of the window (search results, Help).
const EDGE_OFFSET = 12;

function visible(selector: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>(selector)).find(
      (element) => element.getClientRects().length > 0,
    ) ?? null
  );
}

/** The bottom offset of the card: just above the path bar and the Info Row. */
export function offsetAboveBars(): number {
  const tops = [visible(".content-pathbar-row"), visible(".info-row.open")]
    .filter((bar): bar is HTMLElement => bar !== null)
    .map((bar) => bar.getBoundingClientRect().top);
  if (tops.length === 0) {
    return EDGE_OFFSET;
  }
  return Math.max(EDGE_OFFSET, Math.round(window.innerHeight - Math.min(...tops) + GAP_ABOVE));
}

/** The bottom offset of notifications: above the bars, and above the card when it shows. */
export function offsetAboveBarsAndCard(): number {
  const card = visible(".copy-paste-progress-card");
  const bars = offsetAboveBars();
  return card ? bars + card.getBoundingClientRect().height + GAP_BETWEEN : bars;
}

/**
 * `measure()`, taken again when `key` changes (something arrived or went) and when the
 * window is resized. Nothing is measured while `key` is null.
 */
export function useBottomOffset(measure: () => number, key: string | null): number {
  const [offset, setOffset] = useState(EDGE_OFFSET);
  // Measured again when `key` changes: something new arrived at the bottom of the window.
  useLayoutEffect(() => {
    if (key === null) {
      return;
    }
    const update = () => setOffset(measure());
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [key, measure]);
  return offset;
}
