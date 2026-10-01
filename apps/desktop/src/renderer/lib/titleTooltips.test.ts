// @vitest-environment jsdom

import { installTitleTooltips, resolveTooltipPlacement } from "./titleTooltips";

describe("titleTooltips", () => {
  let uninstall: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <button id="trash" title="Trash"><svg><path id="trash-icon"></path></svg></button>
      <button id="help" title="Help"><svg></svg></button>
      <div id="plain">no title</div>
      <button id="labelled" title="/Users/demo/Documents">Documents</button>
      <div id="row" title="/Users/demo/notes.txt">notes.txt</div>
      <div class="tree-row"><button id="expand" title="Expand"><svg></svg></button></div>
    `;
    uninstall = installTitleTooltips();
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

  function hover(id: string) {
    element(id).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  }

  function tooltipText(): string | null {
    return document.querySelector(".app-tooltip")?.textContent ?? null;
  }

  it("shows a control's title after the pointer rests on it", () => {
    hover("trash");
    expect(tooltipText()).toBeNull();

    vi.advanceTimersByTime(600);

    expect(tooltipText()).toBe("Trash");
    expect(document.querySelector(".app-tooltip")).toHaveAttribute("role", "tooltip");
  });

  it("finds the title from an icon inside the control", () => {
    hover("trash-icon");
    vi.advanceTimersByTime(600);

    expect(tooltipText()).toBe("Trash");
  });

  it("takes the title off while hovering and puts it back afterwards", () => {
    hover("trash");
    expect(element("trash")).not.toHaveAttribute("title");

    hover("plain");

    expect(element("trash")).toHaveAttribute("title", "Trash");
    expect(tooltipText()).toBeNull();
  });

  it("shows the next control's tooltip at once when moving straight across", () => {
    hover("trash");
    vi.advanceTimersByTime(600);
    hover("help");
    vi.advanceTimersByTime(0);

    expect(tooltipText()).toBe("Help");
    expect(document.querySelectorAll(".app-tooltip")).toHaveLength(1);
    expect(element("trash")).toHaveAttribute("title", "Trash");
  });

  it("waits again once the pointer has been away for a while", () => {
    hover("trash");
    vi.advanceTimersByTime(600);
    hover("plain");
    vi.advanceTimersByTime(1000);
    hover("help");
    vi.advanceTimersByTime(100);

    expect(tooltipText()).toBeNull();

    vi.advanceTimersByTime(500);
    expect(tooltipText()).toBe("Help");
  });

  it("hides on click and stays quiet until the pointer leaves the control", () => {
    hover("trash");
    vi.advanceTimersByTime(600);
    element("trash").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(tooltipText()).toBeNull();
    expect(element("trash")).toHaveAttribute("title", "Trash");

    hover("trash-icon");
    vi.advanceTimersByTime(1000);
    expect(tooltipText()).toBeNull();

    hover("plain");
    vi.advanceTimersByTime(1000);
    hover("trash");
    vi.advanceTimersByTime(600);
    expect(tooltipText()).toBe("Trash");
  });

  it("hides when a key is pressed, the view scrolls, or the pointer leaves the window", () => {
    for (const dismiss of [
      () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true })),
      () => document.dispatchEvent(new Event("scroll")),
      () => element("trash").dispatchEvent(new MouseEvent("mouseout", { bubbles: true })),
    ]) {
      hover("plain");
      vi.advanceTimersByTime(1000);
      hover("trash");
      vi.advanceTimersByTime(600);
      expect(tooltipText()).toBe("Trash");

      dismiss();

      expect(tooltipText()).toBeNull();
      expect(element("trash")).toHaveAttribute("title", "Trash");
    }
  });

  it("follows a title that changes while the tooltip is showing", () => {
    hover("trash");
    vi.advanceTimersByTime(600);
    element("trash").setAttribute("title", "Empty Trash");
    element("trash").dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    expect(tooltipText()).toBe("Empty Trash");

    hover("plain");
    expect(element("trash")).toHaveAttribute("title", "Empty Trash");
  });

  it("leaves file and folder rows, labelled buttons and row controls to themselves", () => {
    for (const id of ["labelled", "row", "expand"]) {
      const title = element(id).getAttribute("title");
      hover(id);
      vi.advanceTimersByTime(1000);

      expect(tooltipText()).toBeNull();
      expect(element(id)).toHaveAttribute("title", title);
      hover("plain");
    }
  });

  it("shows nothing for empty titles and stops when uninstalled", () => {
    element("help").setAttribute("title", "  ");
    hover("help");
    vi.advanceTimersByTime(600);
    expect(tooltipText()).toBeNull();
    expect(element("help")).toHaveAttribute("title", "  ");

    uninstall();
    hover("trash");
    vi.advanceTimersByTime(600);
    expect(tooltipText()).toBeNull();
    expect(element("trash")).toHaveAttribute("title", "Trash");
  });

  it("places the tooltip under a control, flips above near the bottom, and stays on screen", () => {
    const viewport = { width: 1000, height: 800 };
    const bubble = { width: 80, height: 20 };

    expect(
      resolveTooltipPlacement({
        anchor: { left: 300, top: 10, right: 330, bottom: 38, width: 30 },
        bubble,
        viewport,
        side: "below",
      }),
    ).toEqual({ left: 275, top: 44 });
    expect(
      resolveTooltipPlacement({
        anchor: { left: 40, top: 760, right: 70, bottom: 788, width: 30 },
        bubble,
        viewport,
        side: "below",
      }),
    ).toEqual({ left: 15, top: 734 });
    expect(
      resolveTooltipPlacement({
        anchor: { left: 980, top: 10, right: 998, bottom: 38, width: 18 },
        bubble,
        viewport,
        side: "below",
      }).left,
    ).toBe(914);
  });

  it("places the tooltip beside a left rail control", () => {
    expect(
      resolveTooltipPlacement({
        anchor: { left: 6, top: 144, right: 36, bottom: 172, width: 30 },
        bubble: { width: 80, height: 20 },
        viewport: { width: 1000, height: 800 },
        side: "right",
      }),
    ).toEqual({ left: 42, top: 148 });
  });
});
