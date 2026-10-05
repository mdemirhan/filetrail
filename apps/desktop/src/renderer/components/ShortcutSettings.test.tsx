// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import type { ShortcutOverrides } from "../../shared/shortcuts";
import { ShortcutSettings } from "./ShortcutSettings";

// The settings window keeps the saved keys; this stands in for it.
function renderSettings(initial: ShortcutOverrides = {}) {
  const saved: ShortcutOverrides[] = [];
  function Harness() {
    const [overrides, setOverrides] = useState(initial);
    return (
      <ShortcutSettings
        overrides={overrides}
        returnKeyAction="rename"
        onChange={(next) => {
          saved.push(next);
          setOverrides(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { saved, lastSaved: () => saved.at(-1) };
}

function rowOf(label: string): HTMLElement {
  const row = screen
    .getAllByText(label)
    .map((element) => element.closest<HTMLElement>(".shortcut-row"))
    .find((candidate) => candidate !== null);
  if (!row) {
    throw new Error(`No row for ${label}.`);
  }
  return row;
}

// The keys a row shows, as written on its buttons ("+" is the empty place).
function keysOf(label: string): string[] {
  return Array.from(rowOf(label).querySelectorAll(".shortcut-slot-key")).map(
    (key) => key.textContent ?? "",
  );
}

function record(label: string, buttonName: RegExp | string, init: KeyboardEventInit) {
  const button = within(rowOf(label)).getByRole("button", { name: buttonName });
  fireEvent.click(button);
  expect(button).toHaveTextContent("Press keys…");
  fireEvent.keyDown(button, init);
  return button;
}

describe("ShortcutSettings", () => {
  it("lists every command with its keys, grouped, and the standard ones as fixed", () => {
    renderSettings();

    for (const title of ["Navigation", "Tabs", "Files", "Search", "View", "Standard shortcuts"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(keysOf("Back")).toEqual(["⌘[", "⌘←"]);
    expect(keysOf("Duplicate")).toEqual(["⌘D", "+"]);
    expect(keysOf("Show in Finder")).toEqual(["+"]);
    expect(keysOf("Quick Look")).toEqual(["Space", "+"]);
    // A fixed command shows its key, and nothing to press.
    expect(keysOf("Copy")).toEqual(["⌘C"]);
    expect(within(rowOf("Copy")).queryByRole("button")).toBeNull();
    expect(within(rowOf("Rename")).getByText(/Return renames too/)).toBeInTheDocument();
    // Nothing was changed, so there is nothing to reset.
    expect(screen.getByRole("button", { name: "Restore Default Shortcuts" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Reset (?!All)/ })).toBeNull();
  });

  it("records a new key for a command and saves only what differs from the defaults", () => {
    const { lastSaved } = renderSettings();

    record("Show in Finder", "Add a shortcut for Show in Finder", {
      key: "J",
      code: "KeyJ",
      metaKey: true,
      shiftKey: true,
    });

    expect(lastSaved()).toEqual({ showInFinder: ["Cmd+Shift+J"] });
    expect(keysOf("Show in Finder")).toEqual(["⇧⌘J", "+"]);
    expect(screen.getByRole("button", { name: "Restore Default Shortcuts" })).toBeEnabled();

    // The second place takes an alternate; the main key stays.
    record("Show in Finder", "Add an alternate shortcut for Show in Finder", { key: "F5" });
    expect(lastSaved()).toEqual({ showInFinder: ["Cmd+Shift+J", "F5"] });

    // Recording on the main key replaces it.
    record("Show in Finder", /shortcut: ⇧⌘J/, { key: "j", code: "KeyJ", metaKey: true });
    expect(lastSaved()).toEqual({ showInFinder: ["Cmd+J", "F5"] });
  });

  it("waits for a key while only modifiers are down, and Esc cancels", () => {
    const { saved } = renderSettings();

    const button = record("Duplicate", /shortcut: ⌘D/, { key: "Meta", metaKey: true });
    expect(button).toHaveTextContent("Press keys…");

    const escapeKey = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    try {
      fireEvent(button, escapeKey);
    } finally {
      window.removeEventListener("keydown", outer);
    }

    // Escape ended the recording and went no further: it must not close the window.
    expect(escapeKey.defaultPrevented).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    expect(keysOf("Duplicate")).toEqual(["⌘D", "+"]);
    expect(saved).toEqual([]);
  });

  it("says why a key can not be used, and goes on recording", () => {
    const { saved } = renderSettings();

    const button = record("Duplicate", /shortcut: ⌘D/, { key: "d" });
    expect(within(rowOf("Duplicate")).getByRole("status")).toHaveTextContent(
      "D on its own types into the file list. Add ⌘ or ⌃.",
    );
    expect(button).toHaveTextContent("Press keys…");

    fireEvent.keyDown(button, { key: "v", metaKey: true });
    expect(within(rowOf("Duplicate")).getByRole("status")).toHaveTextContent(
      "⌘V is Paste, which can not be changed.",
    );
    fireEvent.keyDown(button, { key: "ArrowDown", shiftKey: true });
    expect(within(rowOf("Duplicate")).getByRole("status")).toHaveTextContent(
      "⇧↓ on its own moves around the list. Add ⌘, ⌃ or ⌥.",
    );
    fireEvent.keyDown(button, { key: "Tab", metaKey: true });
    expect(within(rowOf("Duplicate")).getByRole("status")).toHaveTextContent(
      "macOS keeps ⌘⇥ for itself.",
    );
    fireEvent.keyDown(button, { key: ".", metaKey: true });
    expect(within(rowOf("Duplicate")).getByRole("status")).toHaveTextContent(
      "⌘. cancels a dialog, as Esc does.",
    );
    expect(saved).toEqual([]);

    // A usable key ends it.
    fireEvent.keyDown(button, { key: "D", metaKey: true, shiftKey: true });
    expect(saved).toEqual([{ duplicateSelection: ["Cmd+Shift+D"] }]);
    expect(within(rowOf("Duplicate")).queryByRole("status")).toBeNull();
  });

  it("asks before taking a key from another command", () => {
    const { saved, lastSaved } = renderSettings();

    record("New Folder", "Add an alternate shortcut for New Folder", { key: "d", metaKey: true });

    const question = within(rowOf("New Folder")).getByRole("status");
    expect(question).toHaveTextContent("⌘D is used by Duplicate.");
    expect(saved).toEqual([]);

    // Cancel leaves both commands as they were.
    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(within(rowOf("New Folder")).queryByRole("status")).toBeNull();
    expect(saved).toEqual([]);

    record("New Folder", "Add an alternate shortcut for New Folder", { key: "d", metaKey: true });
    fireEvent.click(
      within(within(rowOf("New Folder")).getByRole("status")).getByRole("button", {
        name: "Reassign",
      }),
    );

    expect(lastSaved()).toEqual({ newFolder: ["Cmd+Shift+N", "Cmd+D"], duplicateSelection: [] });
    expect(keysOf("New Folder")).toEqual(["⇧⌘N", "⌘D"]);
    expect(keysOf("Duplicate")).toEqual(["+"]);
  });

  it("removes a key with ⌫ or its ×, and the alternate becomes the main key", () => {
    const { lastSaved } = renderSettings();

    record("Back", /shortcut: ⌘\[/, { key: "Backspace" });
    expect(lastSaved()).toEqual({ goBack: ["Cmd+Left"] });
    expect(keysOf("Back")).toEqual(["⌘←", "+"]);

    fireEvent.click(within(rowOf("Back")).getByRole("button", { name: "Remove ⌘← from Back" }));
    expect(lastSaved()).toEqual({ goBack: [] });
    expect(keysOf("Back")).toEqual(["+"]);

    // ⌫ on a key that is not recording removes it too.
    fireEvent.keyDown(within(rowOf("Forward")).getByRole("button", { name: /shortcut: ⌘\]/ }), {
      key: "Backspace",
    });
    expect(lastSaved()).toEqual({ goBack: [], goForward: ["Cmd+Right"] });
  });

  it("resets one command, taking its default key back, or all of them", () => {
    const { lastSaved } = renderSettings({
      newFolder: ["Cmd+Shift+N", "Cmd+D"],
      duplicateSelection: [],
      showInFinder: ["F5"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Restore Default for Duplicate" }));

    expect(lastSaved()).toEqual({ showInFinder: ["F5"] });
    expect(within(rowOf("Duplicate")).getByRole("status")).toHaveTextContent(
      "Taken back from New Folder.",
    );
    expect(screen.queryByRole("button", { name: "Restore Default for Duplicate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restore Default for New Folder" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Restore Default Shortcuts" }));
    expect(lastSaved()).toEqual({});
    expect(keysOf("Show in Finder")).toEqual(["+"]);
  });

  it("warns when macOS may take the key first", () => {
    const { lastSaved } = renderSettings();

    record("Show Next Tab", /^Show Next Tab, shortcut: ⌃⇥/, { key: "ArrowRight", ctrlKey: true });

    expect(lastSaved()).toEqual({ selectNextTab: ["Ctrl+Right", "Cmd+Shift+]"] });
    expect(within(rowOf("Show Next Tab")).getByRole("status")).toHaveTextContent(
      /macOS may use ⌃→ itself, for Mission Control/,
    );
  });

  it("lets Quick Look have Space back, though no other command can have it", () => {
    const { lastSaved } = renderSettings({ quickLookSelection: ["Cmd+Y"] });

    record("New Tab", "Add an alternate shortcut for New Tab", { key: " ", code: "Space" });
    expect(within(rowOf("New Tab")).getByRole("status")).toHaveTextContent(
      "Space on its own types into the file list.",
    );

    record("Quick Look", "Add an alternate shortcut for Quick Look", { key: " ", code: "Space" });
    expect(lastSaved()).toEqual({ quickLookSelection: ["Cmd+Y", "Space"] });
  });

  it("finds commands by name or by key", () => {
    renderSettings();
    const search = screen.getByRole("textbox", { name: "Search shortcuts" });

    fireEvent.change(search, { target: { value: "trash" } });
    expect(screen.getByText("Move to Trash")).toBeInTheDocument();
    expect(screen.queryByText("Duplicate")).toBeNull();
    // Go > Trash is the one Navigation command that matches.
    expect(screen.getByText("Trash")).toBeInTheDocument();
    expect(screen.queryByText("Back")).toBeNull();

    fireEvent.change(search, { target: { value: "cmd+shift+n" } });
    expect(screen.getByText("New Folder")).toBeInTheDocument();
    expect(screen.queryByText("Move to Trash")).toBeNull();

    fireEvent.change(search, { target: { value: "⌘D" } });
    expect(screen.getByText("Duplicate")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "zzzz" } });
    expect(screen.getByText("No command or key matches “zzzz”.")).toBeInTheDocument();

    // Escape clears the search before it is left to close the window.
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    expect(screen.getByRole("heading", { name: "Navigation" })).toBeInTheDocument();
  });
});
