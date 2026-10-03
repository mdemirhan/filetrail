// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { useDelayedFlag } from "./useDelayedFlag";

describe("useDelayedFlag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays off for work that is over before the delay, and turns on for work that isn't", () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active, 400), {
      initialProps: { active: true },
    });
    expect(result.current).toBe(false);

    // Over in a moment: never shown.
    act(() => vi.advanceTimersByTime(150));
    rerender({ active: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);

    // Still going after the delay: shown, and gone the moment it ends.
    rerender({ active: true });
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });
});
