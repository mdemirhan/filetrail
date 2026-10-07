// @vitest-environment jsdom

import { render } from "@testing-library/react";

import { WindowDragRelease } from "./WindowDragRelease";

describe("WindowDragRelease", () => {
  const flagged = () => document.documentElement.hasAttribute("data-menu-open");

  it("marks the page while any menu is open, and unmarks it once none is", () => {
    expect(flagged()).toBe(false);
    const first = render(<WindowDragRelease />);
    const second = render(<WindowDragRelease />);
    expect(flagged()).toBe(true);

    first.unmount();
    expect(flagged()).toBe(true);
    second.unmount();
    expect(flagged()).toBe(false);
  });
});
