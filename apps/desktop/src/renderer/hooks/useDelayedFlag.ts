import { useEffect, useState } from "react";

// True once `active` has stayed true for `delayMs`, false as soon as it is false again.
// For "Loading…" lines, spinners and progress that would only flash for work that is over
// in a moment: they show only when the wait is long enough to notice.
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}
