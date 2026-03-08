// @vitest-environment jsdom

import { pageScrollElement, scrollElementByAmount } from "./pagedScroll";

describe("pagedScroll", () => {
  it("pages vertically by the current viewport height", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      clientHeight: { value: 320, configurable: true },
      scrollHeight: { value: 1400, configurable: true },
      clientWidth: { value: 0, configurable: true },
      scrollWidth: { value: 0, configurable: true },
    });
    element.scrollTop = 120;

    const didScroll = pageScrollElement(element, "vertical", "forward");

    expect(didScroll).toBe(true);
    expect(element.scrollTop).toBe(440);
  });

  it("pages horizontally by the current viewport width", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      clientHeight: { value: 0, configurable: true },
      scrollHeight: { value: 0, configurable: true },
      clientWidth: { value: 480, configurable: true },
      scrollWidth: { value: 1800, configurable: true },
    });
    element.scrollLeft = 240;

    const didScroll = pageScrollElement(element, "horizontal", "forward");

    expect(didScroll).toBe(true);
    expect(element.scrollLeft).toBe(720);
  });

  it("clamps paging at the available scroll bounds", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      clientHeight: { value: 300, configurable: true },
      scrollHeight: { value: 850, configurable: true },
      clientWidth: { value: 0, configurable: true },
      scrollWidth: { value: 0, configurable: true },
    });
    element.scrollTop = 500;

    const didScroll = pageScrollElement(element, "vertical", "forward");

    expect(didScroll).toBe(true);
    expect(element.scrollTop).toBe(550);
  });

  it("returns false when the element cannot scroll on that axis", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      clientHeight: { value: 320, configurable: true },
      scrollHeight: { value: 320, configurable: true },
      clientWidth: { value: 480, configurable: true },
      scrollWidth: { value: 480, configurable: true },
    });

    expect(pageScrollElement(element, "vertical", "forward")).toBe(false);
    expect(pageScrollElement(element, "horizontal", "backward")).toBe(false);
  });

  it("scrolls by an explicit amount instead of a full page", () => {
    const element = document.createElement("div");
    Object.defineProperties(element, {
      clientHeight: { value: 0, configurable: true },
      scrollHeight: { value: 0, configurable: true },
      clientWidth: { value: 480, configurable: true },
      scrollWidth: { value: 1800, configurable: true },
    });
    element.scrollLeft = 240;

    const didScroll = scrollElementByAmount(element, "horizontal", 310);

    expect(didScroll).toBe(true);
    expect(element.scrollLeft).toBe(550);
  });
});
