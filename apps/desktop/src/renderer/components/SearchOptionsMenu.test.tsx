// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

import { SearchOptionsMenu } from "./SearchOptionsMenu";

function renderMenu(overrides: Partial<Parameters<typeof SearchOptionsMenu>[0]> = {}) {
  const handlers = {
    onPatternModeChange: vi.fn(),
    onMatchScopeChange: vi.fn(),
    onRecursiveChange: vi.fn(),
    onSkipGitFoldersChange: vi.fn(),
    onSkipGitIgnoredChange: vi.fn(),
  };
  const anchorRef = createRef<HTMLDivElement>();
  const inputRef = createRef<HTMLInputElement>();
  render(
    <div ref={anchorRef}>
      <SearchOptionsMenu
        anchorRef={anchorRef}
        inputRef={inputRef}
        interactive
        patternMode="glob"
        matchScope="name"
        recursive
        skipGitFolders
        skipGitIgnored={false}
        {...handlers}
        {...overrides}
      />
      <input ref={inputRef} aria-label="Search" />
    </div>,
  );
  return { handlers, input: () => screen.getByLabelText("Search") };
}

describe("SearchOptionsMenu", () => {
  it("opens a menu that shows the current options with checkmarks", () => {
    const { input } = renderMenu();
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });
    // Opened with the mouse: typing still goes to the search field.
    expect(input()).toHaveFocus();

    expect(screen.getByRole("menu", { name: "Search options" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Name" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "Full path" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("menuitemradio", { name: "Glob" })).toBeChecked();
    expect(screen.getByRole("menuitemcheckbox", { name: "Search subfolders" })).toBeChecked();
    expect(screen.getByRole("menuitemcheckbox", { name: "Skip .git folders" })).toBeChecked();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Skip files ignored by Git" }),
    ).not.toBeChecked();
    // Hidden files follow the file list (⇧⌘.), so the menu has no item for them.
    expect(screen.queryByRole("menuitemcheckbox", { name: "Include hidden files" })).toBeNull();
  });

  it("applies a choice, closes, and leaves the focus in the search field", () => {
    const { handlers, input } = renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Search subfolders" }));

    expect(handlers.onRecursiveChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(input()).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Regex" }));
    expect(handlers.onPatternModeChange).toHaveBeenCalledWith("regex");
    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Full path" }));
    expect(handlers.onMatchScopeChange).toHaveBeenCalledWith("path");
  });

  it("works from the keyboard: first item focused, arrows move, Return chooses, Escape closes", () => {
    const { handlers, input } = renderMenu();
    // Return or Space on the button is a click without pointer detail.
    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 0 });
    expect(screen.getByRole("menuitemradio", { name: "Name" })).toHaveFocus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowDown" });
    expect(screen.getByRole("menuitemradio", { name: "Full path" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowUp" });
    // Up from the first item wraps around to the last one.
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Skip files ignored by Git" }),
    ).toHaveFocus();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });
    expect(handlers.onSkipGitIgnoredChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(input()).toHaveFocus();
  });

  it("keeps Escape and arrow keys to itself while open", () => {
    const { input } = renderMenu();
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });
      fireEvent.keyDown(input(), { key: "ArrowDown" });
      fireEvent.keyDown(input(), { key: "Escape" });
      expect(outer).not.toHaveBeenCalled();
      // Closed again: keys pass through as usual.
      fireEvent.keyDown(input(), { key: "Escape" });
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("closes on a click elsewhere", () => {
    renderMenu();
    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open in the toolbar's measuring copy", () => {
    renderMenu({ interactive: false });
    fireEvent.click(screen.getByRole("button", { name: "Search options" }), { detail: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens from a labeled Options button and hands the focus back to it", () => {
    const onRecursiveChange = vi.fn();
    render(
      <SearchOptionsMenu
        trigger="label"
        interactive
        patternMode="regex"
        onPatternModeChange={() => undefined}
        matchScope="name"
        onMatchScopeChange={() => undefined}
        recursive
        onRecursiveChange={onRecursiveChange}
        skipGitFolders
        onSkipGitFoldersChange={() => undefined}
        skipGitIgnored={false}
        onSkipGitIgnoredChange={() => undefined}
      />,
    );

    // Named by its text, so it cannot be confused with the magnifier in the search field.
    expect(screen.queryByRole("button", { name: "Search options" })).toBeNull();
    const button = screen.getByRole("button", { name: "Options" });
    fireEvent.click(button, { detail: 1 });
    expect(screen.getByRole("menuitemradio", { name: "Regex" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Search subfolders" }));
    expect(onRecursiveChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });
});
