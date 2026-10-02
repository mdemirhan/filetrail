import { useEffect, useSyncExternalStore } from "react";

import { formatExactDateTime, formatRelativeDateTime, isWithinLastHour } from "../lib/formatting";
import { getRelativeNow, holdMinuteTicks, subscribeRelativeClock } from "../lib/relativeClock";

export type RelativeDateLabel = {
  /** "24 min ago", "Today, 9:12 AM", "Jun 12, 8:30 AM". */
  text: string;
  /** The whole date, for the tooltip. */
  exact: string;
};

// A date as a list shows it, kept current while it is on screen. Null when there is no
// date (not loaded yet, or not known): callers show their own placeholder.
export function useRelativeDate(value: string | null | undefined): RelativeDateLabel | null {
  const now = useSyncExternalStore(subscribeRelativeClock, getRelativeNow);
  const ms = value ? Date.parse(value) : Number.NaN;
  const known = !Number.isNaN(ms);
  const readsInMinutes = known && isWithinLastHour(ms, now);
  useEffect(() => (readsInMinutes ? holdMinuteTicks() : undefined), [readsInMinutes]);
  if (!known) {
    return null;
  }
  return { text: formatRelativeDateTime(ms, now), exact: formatExactDateTime(ms) };
}
