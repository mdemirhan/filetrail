// @vitest-environment jsdom

import { installScrollbarVisibility } from "./scrollbarVisibility";

describe("scrollbarVisibility", () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="tree" class="tree-scroll"></div>
      <div id="list" class="content-scroll"></div>
      <div id="help" class="help-content overlay-scroll"></div>
      <div id="other" style="overflow: auto"></div>
    `;
    uninstall = installScrollbarVisibility();
  });

  afterEach(() => {
    uninstall();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) {
      throw new Error(`Missing #${id}`);
    }
    return found as HTMLElement;
  }

  function scroll(id: string) {
    element(id).dispatchEvent(new Event("scroll"));
  }

  it("shows a pane's scrollbars while it scrolls, and for a moment after", () => {
    scroll("tree");
    expect(element("tree")).toHaveAttribute("data-scrollbars");

    vi.advanceTimersByTime(900);
    scroll("tree");
    vi.advanceTimersByTime(900);
    expect(element("tree")).toHaveAttribute("data-scrollbars");

    vi.advanceTimersByTime(100);
    expect(element("tree")).not.toHaveAttribute("data-scrollbars");
  });

  it("shows only the scrollbars of the pane that scrolls", () => {
    scroll("tree");
    vi.advanceTimersByTime(600);
    scroll("list");

    expect(element("tree")).toHaveAttribute("data-scrollbars");
    expect(element("list")).toHaveAttribute("data-scrollbars");

    vi.advanceTimersByTime(400);
    expect(element("tree")).not.toHaveAttribute("data-scrollbars");
    expect(element("list")).toHaveAttribute("data-scrollbars");
  });

  it("does the same for Help, Settings, the Info panel and Favorites", () => {
    scroll("help");
    expect(element("help")).toHaveAttribute("data-scrollbars");

    vi.advanceTimersByTime(1000);
    expect(element("help")).not.toHaveAttribute("data-scrollbars");
  });

  it("leaves other scrolling elements alone", () => {
    scroll("other");
    expect(element("other")).not.toHaveAttribute("data-scrollbars");
  });

  it("takes its marks off when it is uninstalled", () => {
    scroll("tree");
    uninstall();

    expect(element("tree")).not.toHaveAttribute("data-scrollbars");
    scroll("list");
    expect(element("list")).not.toHaveAttribute("data-scrollbars");
  });
});
