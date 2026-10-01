// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { useRef } from "react";

import { useKeepInViewport } from "./useKeepInViewport";

function Menu({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useKeepInViewport(ref, active);
  return <div ref={ref} data-testid="menu" />;
}

// jsdom has no layout, so each test supplies the rectangle the menu would occupy. The
// mock honors the max-height the hook sets, as a real layout would.
function mockMenuRect(rect: { left: number; top: number; width: number; height: number }) {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const maxHeight = Number.parseFloat(this.style.maxHeight);
    const height = Number.isNaN(maxHeight) ? rect.height : Math.min(rect.height, maxHeight);
    return {
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + height,
      width: rect.width,
      height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    };
  });
}

describe("useKeepInViewport", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 600 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves a menu that already fits untouched", () => {
    mockMenuRect({ left: 100, top: 100, width: 240, height: 300 });
    const { getByTestId } = render(<Menu />);

    expect(getByTestId("menu").style.translate).toBe("");
    expect(getByTestId("menu").style.maxHeight).toBe("");
  });

  it("moves a menu that would run past the bottom and right edges back inside", () => {
    mockMenuRect({ left: 900, top: 450, width: 240, height: 300 });
    const { getByTestId } = render(<Menu />);

    // 8px margin: right edge 1140 -> 992, bottom edge 750 -> 592.
    expect(getByTestId("menu").style.translate).toBe("-148px -158px");
  });

  it("makes a menu taller than the window scroll instead of overflowing", () => {
    mockMenuRect({ left: 100, top: 200, width: 240, height: 900 });
    const { getByTestId } = render(<Menu />);
    const menu = getByTestId("menu");

    expect(menu.style.maxHeight).toBe("584px");
    expect(menu.style.overflowY).toBe("auto");
    expect(menu.style.translate).toBe("0px -192px");
  });

  it("does nothing while inactive", () => {
    mockMenuRect({ left: 900, top: 450, width: 240, height: 300 });
    const { getByTestId } = render(<Menu active={false} />);

    expect(getByTestId("menu").style.translate).toBe("");
  });
});
