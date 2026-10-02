// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import { resolveShortcuts } from "../../shared/shortcuts";
import { HELP_TOPICS, listShortcuts } from "../lib/helpContent";
import { createShortcutDisplay } from "../lib/shortcutDisplay";
import { shortcutParts } from "../lib/shortcutLabels";
import { ShortcutDisplayProvider } from "../state/shortcutDisplayContext";
import { HelpView } from "./HelpView";

describe("HelpView", () => {
  it("exposes the selected layout mode on the root element", () => {
    const { container } = render(<HelpView layoutMode="compact" />);

    expect(container.querySelector(".help-view")).toHaveAttribute("data-layout", "compact");
  });

  it("lists every topic and opens on the first one", () => {
    render(<HelpView />);

    const topics = within(screen.getByRole("navigation", { name: "Help topics" }));
    for (const topic of HELP_TOPICS) {
      expect(topics.getByRole("button", { name: topic.title })).toBeInTheDocument();
    }
    expect(topics.getByRole("button", { name: "Getting around" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Getting around" })).toBeInTheDocument();
  });

  it("shows a topic's explanations followed by its shortcuts", () => {
    render(<HelpView />);

    fireEvent.click(screen.getByRole("button", { name: "Searching" }));

    expect(screen.getByRole("heading", { level: 1, name: "Searching" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Glob patterns" })).toBeInTheDocument();
    // Patterns are shown as code, with what they match beside them.
    expect(screen.getByText("*.{jpg,png,gif}").tagName).toBe("CODE");
    expect(screen.getByText("Any of several endings")).toBeInTheDocument();
    // Backticks in the text become inline code.
    expect(screen.getAllByText("**/").some((element) => element.tagName === "CODE")).toBe(true);
    // The topic's own shortcuts close the page; others stay on their topics.
    expect(screen.getByRole("heading", { level: 2, name: "Shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Find files")).toBeInTheDocument();
    expect(screen.queryByText("Move to Trash")).toBeNull();
  });

  it("lists every shortcut on the Keyboard shortcuts page, grouped by topic", () => {
    render(<HelpView initialTopic="shortcuts" />);

    for (const title of ["Getting around", "Working with files", "Searching", "Views and panels"]) {
      expect(screen.getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    }
    for (const item of listShortcuts()) {
      expect(screen.getAllByText(item.description).length).toBeGreaterThan(0);
    }
    // Nothing leads to Settings unless the window offers it.
    expect(screen.queryByRole("button", { name: "Customize…" })).toBeNull();
  });

  it("shows the keys chosen in Settings and leads there to change them", () => {
    const onCustomizeShortcuts = vi.fn();
    const shortcuts = createShortcutDisplay(
      resolveShortcuts({ duplicateSelection: ["Cmd+Shift+D"], newTab: [] }),
    );
    render(
      <ShortcutDisplayProvider value={shortcuts}>
        <HelpView initialTopic="shortcuts" onCustomizeShortcuts={onCustomizeShortcuts} />
      </ShortcutDisplayProvider>,
    );

    const keys = Array.from(
      screen.getByText("Duplicate").closest(".help-shortcut-row")?.querySelectorAll(".help-key") ??
        [],
    ).map((key) => key.textContent);
    expect(keys).toEqual(["⇧", "⌘", "D"]);
    expect(screen.queryByText("New tab, on the same folder")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Customize…" }));
    expect(onCustomizeShortcuts).toHaveBeenCalledTimes(1);

    // A sentence that named the key names the menu item instead.
    fireEvent.click(screen.getByRole("button", { name: "Getting around" }));
    expect(screen.getByText(/^File > New Tab opens a tab on the folder you are in/)).toBeVisible();
  });

  it("renders shortcut keys as separate keycaps and preserves trailing plus keys", () => {
    const { container } = render(<HelpView initialTopic="views" />);

    const row = screen.getByText("Zoom in").closest(".help-shortcut-row");
    expect(row).not.toBeNull();
    const keys = Array.from(row?.querySelectorAll(".help-key") ?? []).map((key) => key.textContent);
    expect(keys).toEqual(["⌘", "+"]);
    expect(container.querySelectorAll(".help-key").length).toBeGreaterThan(4);
    expect(shortcutParts("Cmd+Shift+G")).toEqual(["⇧", "⌘", "G"]);
    expect(shortcutParts("Cmd+Option+C")).toEqual(["⌥", "⌘", "C"]);
  });

  it("searches across all topics and shortcuts, and Escape clears the search", () => {
    render(<HelpView />);
    const input = screen.getByRole("textbox", { name: "Search help" });

    fireEvent.change(input, { target: { value: "trash" } });

    expect(screen.getByRole("heading", { level: 1, name: "Results for “trash”" })).toBeVisible();
    // A row and a shortcut from Working with files, nothing from other topics.
    expect(
      screen.getByRole("heading", { level: 2, name: "Working with files" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Move to Trash").length).toBe(2);
    expect(screen.queryByRole("heading", { level: 2, name: "Views and panels" })).toBeNull();
    // While searching, no topic is marked as the current page.
    expect(document.querySelector('.help-topic[aria-current="page"]')).toBeNull();

    // The shortcut as written also matches.
    fireEvent.change(input, { target: { value: "cmd+f" } });
    expect(screen.getByText("Find files")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "zzzz" } });
    expect(screen.getByText(/Nothing in Help matches/)).toBeInTheDocument();

    // Escape clears the search instead of leaving Help.
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      fireEvent.keyDown(input, { key: "Escape" });
      expect(input).toHaveValue("");
      expect(outer).not.toHaveBeenCalled();
      expect(screen.getByRole("heading", { level: 1, name: "Getting around" })).toBeVisible();
      // With nothing to clear, Escape passes through.
      fireEvent.keyDown(input, { key: "Escape" });
      expect(outer).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", outer);
    }
  });

  it("choosing a topic leaves search results", () => {
    render(<HelpView />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search help" }), {
      target: { value: "zoom" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Views and panels" }));

    expect(screen.getByRole("textbox", { name: "Search help" })).toHaveValue("");
    expect(screen.getByRole("heading", { level: 1, name: "Views and panels" })).toBeVisible();
  });
});
