// @vitest-environment jsdom

import { getRelativeNow, holdMinuteTicks, subscribeRelativeClock } from "./relativeClock";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("relativeClock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 14, 44, 20));
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads the minute that is now", () => {
    expect(getRelativeNow()).toBe(new Date(2026, 9, 1, 14, 44, 0).getTime());
  });

  it("runs no minute timer for dates that do not read in minutes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRelativeClock(listener);

    vi.advanceTimersByTime(3 * 3_600_000);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ticks on the minute while a date on screen reads in minutes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRelativeClock(listener);
    const release = holdMinuteTicks();

    vi.advanceTimersByTime(39_000);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getRelativeNow()).toBe(new Date(2026, 9, 1, 14, 45, 0).getTime());
    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(2);

    release();
    vi.advanceTimersByTime(10 * 60_000);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops ticking while the window can not be seen, and catches up when it can", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRelativeClock(listener);
    const release = holdMinuteTicks();

    setVisibility("hidden");
    listener.mockClear();
    vi.advanceTimersByTime(10 * 60_000);
    expect(listener).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(2);

    release();
    unsubscribe();
  });

  it("ticks at midnight, when Today becomes Yesterday", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeRelativeClock(listener);

    vi.advanceTimersByTime(9 * 3_600_000 + 15 * 60_000);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(1);
    // And again the night after.
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  });
});
