// The time relative dates ("24 min ago", "Today, 9:12 AM") are measured from: the minute
// that is now, so every date on screen agrees. Nothing runs to keep it current unless a
// date on screen needs it: once a minute while one is under an hour old and the window can
// be seen, and at midnight for the rest (Today becomes Yesterday).

const MINUTE_MS = 60_000;
// Timers are asked for a little after the boundary so they never land just before it.
const BOUNDARY_SLACK_MS = 50;

type Listener = () => void;

const listeners = new Set<Listener>();
let minuteHolds = 0;
let minuteTimer: ReturnType<typeof setTimeout> | null = null;
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let watchingWindow = false;

export function getRelativeNow(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

export function subscribeRelativeClock(listener: Listener): () => void {
  listeners.add(listener);
  syncTimers();
  return () => {
    listeners.delete(listener);
    syncTimers();
  };
}

// Held by each date on screen that reads in minutes; the minute timer runs while any is held.
export function holdMinuteTicks(): () => void {
  minuteHolds += 1;
  syncTimers();
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    minuteHolds -= 1;
    syncTimers();
  };
}

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

// Coming back to the window: time has passed with no timer running, so the dates are read
// again, and the minute timer starts again if it is wanted.
function handleWindowReturn(): void {
  notify();
  syncTimers();
}

function syncTimers(): void {
  const watched = listeners.size > 0;
  if (watched !== watchingWindow) {
    watchingWindow = watched;
    if (watched) {
      document.addEventListener("visibilitychange", handleWindowReturn);
      window.addEventListener("focus", handleWindowReturn);
    } else {
      document.removeEventListener("visibilitychange", handleWindowReturn);
      window.removeEventListener("focus", handleWindowReturn);
    }
  }

  const wantsMinutes = watched && minuteHolds > 0 && document.visibilityState !== "hidden";
  if (wantsMinutes && minuteTimer === null) {
    minuteTimer = setTimeout(
      () => {
        minuteTimer = null;
        notify();
        syncTimers();
      },
      MINUTE_MS - (Date.now() % MINUTE_MS) + BOUNDARY_SLACK_MS,
    );
  } else if (!wantsMinutes && minuteTimer !== null) {
    clearTimeout(minuteTimer);
    minuteTimer = null;
  }

  if (watched && midnightTimer === null) {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    midnightTimer = setTimeout(
      () => {
        midnightTimer = null;
        notify();
        syncTimers();
      },
      nextMidnight - now.getTime() + BOUNDARY_SLACK_MS,
    );
  } else if (!watched && midnightTimer !== null) {
    clearTimeout(midnightTimer);
    midnightTimer = null;
  }
}
