// @vitest-environment jsdom

import { scrollElementByAmount } from "./pagedScroll";

function scroller(size: {
  clientHeight?: number;
  scrollHeight?: number;
  clientWidth?: number;
  scrollWidth?: number;
}) {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientHeight: { value: size.clientHeight ?? 0, configurable: true },
    scrollHeight: { value: size.scrollHeight ?? 0, configurable: true },
    clientWidth: { value: size.clientWidth ?? 0, configurable: true },
    scrollWidth: { value: size.scrollWidth ?? 0, configurable: true },
  });
  return element;
}

describe("scrollElementByAmount", () => {
  it("scrolls sideways by the amount", () => {
    const element = scroller({ clientWidth: 480, scrollWidth: 1800 });
    element.scrollLeft = 240;

    expect(scrollElementByAmount(element, "horizontal", 310)).toBe(true);
    expect(element.scrollLeft).toBe(550);
  });

  it("scrolls up and down, stopping at either end", () => {
    const element = scroller({ clientHeight: 300, scrollHeight: 850 });
    element.scrollTop = 500;

    expect(scrollElementByAmount(element, "vertical", 300)).toBe(true);
    expect(element.scrollTop).toBe(550);
    expect(scrollElementByAmount(element, "vertical", -900)).toBe(true);
    expect(element.scrollTop).toBe(0);
  });

  it("tells a scroll event, for the views that follow the scroll position", () => {
    const element = scroller({ clientHeight: 300, scrollHeight: 850 });
    const onScroll = vi.fn();
    element.addEventListener("scroll", onScroll);

    scrollElementByAmount(element, "vertical", 100);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it("returns false when the element can't scroll that way, or is already at the end", () => {
    const element = scroller({
      clientHeight: 320,
      scrollHeight: 320,
      clientWidth: 480,
      scrollWidth: 960,
    });

    expect(scrollElementByAmount(element, "vertical", 100)).toBe(false);
    expect(scrollElementByAmount(element, "horizontal", -100)).toBe(false);
    expect(scrollElementByAmount(element, "horizontal", 0)).toBe(false);
  });
});
