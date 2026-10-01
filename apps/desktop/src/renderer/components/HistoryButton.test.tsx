// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { HISTORY_MENU_HOLD_MS, HistoryButton } from "./HistoryButton";

const ENTRIES = [
  { index: 2, path: "/Users/demo/src", label: "src", detail: "~" },
  { index: 1, path: "/Users/demo", label: "Home", detail: "/Users" },
];

function renderButton(overrides: Partial<Parameters<typeof HistoryButton>[0]> = {}) {
  const onStep = vi.fn();
  const onSelectEntry = vi.fn();
  render(
    <HistoryButton
      className="tb-btn"
      label="Back"
      title="Back (⌘[)"
      disabled={false}
      entries={ENTRIES}
      onStep={onStep}
      onSelectEntry={onSelectEntry}
      {...overrides}
    >
      ‹
    </HistoryButton>,
  );
  return { onStep, onSelectEntry, button: screen.getByRole("button", { name: "Back" }) };
}

describe("HistoryButton", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("steps once on a click", () => {
    const { button, onStep, onSelectEntry } = renderButton();

    fireEvent.pointerDown(button, { button: 0 });
    fireEvent.pointerUp(button);
    fireEvent.click(button);

    expect(onStep).toHaveBeenCalledTimes(1);
    expect(onSelectEntry).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lists the folders when held, and jumps to the one chosen without stepping", () => {
    vi.useFakeTimers();
    const { button, onStep, onSelectEntry } = renderButton();

    fireEvent.pointerDown(button, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(HISTORY_MENU_HOLD_MS);
    });
    const menu = screen.getByRole("menu", { name: "Back history" });
    expect(
      Array.from(menu.querySelectorAll('[role="menuitem"]'), (item) => item.textContent),
    ).toEqual(["src~", "Home/Users"]);
    // Letting go ends the hold with a click, which must not also go back once.
    fireEvent.pointerUp(button);
    fireEvent.click(button);
    expect(onStep).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /Home/u }));
    expect(onSelectEntry).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open when the press is released before the hold time", () => {
    vi.useFakeTimers();
    const { button } = renderButton();

    fireEvent.pointerDown(button, { button: 0 });
    act(() => {
      vi.advanceTimersByTime(HISTORY_MENU_HOLD_MS - 50);
    });
    fireEvent.pointerUp(button);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on a right-click, takes the arrow keys, and closes with Escape or a click elsewhere", () => {
    const { button, onStep, onSelectEntry } = renderButton();

    fireEvent.contextMenu(button);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // The arrow keys start on the first folder and move through the list. The keyboard
    // focus itself is not taken away from where it was.
    const current = () => screen.getByRole("menuitem", { current: true }).textContent;
    expect(current()).toBe("src~");
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(current()).toBe("Home/Users");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(current()).toBe("src~");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    // Return goes to the folder the arrow keys are on.
    fireEvent.contextMenu(button);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onSelectEntry).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onStep).not.toHaveBeenCalled();
  });

  it("has no menu without history", () => {
    const { button } = renderButton({ entries: [] });
    fireEvent.contextMenu(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does nothing in the copy of the toolbar that is only measured", () => {
    const { button, onStep } = renderButton({ interactive: false });
    fireEvent.contextMenu(button);
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onStep).not.toHaveBeenCalled();
  });
});
