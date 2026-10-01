import { getViewportShift, placeSubmenu } from "./menuPlacement";

describe("menuPlacement", () => {
  it("leaves a box alone when it is already inside the viewport", () => {
    expect(getViewportShift(100, 300, 800)).toBe(0);
  });

  it("moves a box back from the far and near edges", () => {
    expect(getViewportShift(700, 900, 800)).toBe(-108);
    expect(getViewportShift(-20, 180, 800)).toBe(28);
    expect(getViewportShift(700, 900, 800, 0)).toBe(-100);
  });

  it("pins a box that is larger than the viewport to the near edge", () => {
    expect(getViewportShift(300, 1300, 800)).toBe(-292);
  });

  it("opens a submenu to the right of its item when there is room", () => {
    expect(
      placeSubmenu({
        item: { left: 100, top: 200, right: 340, bottom: 228 },
        submenu: { width: 180, height: 120 },
        viewport: { width: 1200, height: 800 },
      }),
    ).toEqual({ left: 346, top: 196 });
  });

  it("flips a submenu to the left when the right side has no room", () => {
    expect(
      placeSubmenu({
        item: { left: 900, top: 200, right: 1140, bottom: 228 },
        submenu: { width: 180, height: 120 },
        viewport: { width: 1200, height: 800 },
      }),
    ).toEqual({ left: 714, top: 196 });
  });

  it("keeps a submenu above the bottom edge and inside a window too narrow for either side", () => {
    expect(
      placeSubmenu({
        item: { left: 40, top: 740, right: 280, bottom: 768 },
        submenu: { width: 180, height: 120 },
        viewport: { width: 400, height: 800 },
      }),
    ).toEqual({ left: 8, top: 672 });
  });
});
