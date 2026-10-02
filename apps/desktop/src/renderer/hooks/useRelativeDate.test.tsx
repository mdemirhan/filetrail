// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";

import { useRelativeDate } from "./useRelativeDate";

function Modified({ value }: { value: string | null }) {
  const date = useRelativeDate(value);
  return (
    <span data-testid="date" title={date?.exact}>
      {date?.text ?? "none"}
    </span>
  );
}

describe("useRelativeDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1, 14, 44, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("has nothing to show without a date", () => {
    render(<Modified value={null} />);
    expect(screen.getByTestId("date")).toHaveTextContent("none");

    render(<Modified value="not a date" />);
    expect(screen.getAllByTestId("date")[1]).toHaveTextContent("none");
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
  });

  it("moves a recent date along as the minutes pass, then settles on the time", () => {
    render(<Modified value={new Date(2026, 9, 1, 14, 44, 10).toISOString()} />);
    const date = screen.getByTestId("date");

    expect(date).toHaveTextContent("Just now");
    expect(date).toHaveAttribute("title", "Thursday, October 1, 2026 at 2:44:10 PM");

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(date).toHaveTextContent("1 min ago");

    act(() => {
      vi.advanceTimersByTime(58 * 60_000);
    });
    expect(date).toHaveTextContent("59 min ago");

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(date).toHaveTextContent("Today, 2:44 PM");
    // Only the midnight timer is left: the date no longer changes by the minute.
    expect(vi.getTimerCount()).toBe(1);
  });

  it("turns Today into Yesterday at midnight without a minute timer", () => {
    render(<Modified value={new Date(2026, 9, 1, 9, 12).toISOString()} />);
    const date = screen.getByTestId("date");

    expect(date).toHaveTextContent("Today, 9:12 AM");
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(10 * 3_600_000);
    });
    expect(date).toHaveTextContent("Yesterday, 9:12 AM");
  });
});
