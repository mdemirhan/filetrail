// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import {
  type CopyPasteClipboardState,
  describeClipboard,
  removeClipboardItem,
  setCopyPasteClipboard,
} from "../lib/copyPasteClipboard";
import { ClipboardButton } from "./ClipboardButton";

const NOW = "2026-10-02T00:00:00.000Z";

function clipboardOf(paths: string[], mode: "copy" | "cut" = "copy"): CopyPasteClipboardState {
  return setCopyPasteClipboard(
    mode,
    paths,
    NOW,
    Object.fromEntries(
      paths.map((path) => [
        path,
        { kind: path.includes(".") ? ("file" as const) : ("directory" as const), isSymlink: false },
      ]),
    ),
  );
}

// The button as the app holds it: the clipboard lives outside, and so does whether the list
// is open.
function Harness({
  initial,
  onRevealItem,
  onClear,
}: {
  initial: CopyPasteClipboardState;
  onRevealItem: (path: string) => void;
  onClear: () => void;
}) {
  const [clipboard, setClipboard] = useState(initial);
  const [open, setOpen] = useState(false);
  const summary = describeClipboard(clipboard);
  if (!summary) {
    return <output data-testid="empty">empty</output>;
  }
  return (
    <ClipboardButton
      summary={summary}
      open={open}
      onOpenChange={setOpen}
      onRevealItem={onRevealItem}
      onRemoveItem={(path) => setClipboard((current) => removeClipboardItem(current, path))}
      onClear={() => {
        onClear();
        setClipboard({ type: "empty" });
      }}
    />
  );
}

function renderButton(paths: string[], mode: "copy" | "cut" = "copy") {
  const onRevealItem = vi.fn();
  const onClear = vi.fn();
  render(
    <Harness initial={clipboardOf(paths, mode)} onRevealItem={onRevealItem} onClear={onClear} />,
  );
  return { onRevealItem, onClear };
}

const button = () => screen.getByRole("button", { name: /^Clipboard: / });
const itemNames = () => Array.from(screen.getAllByRole("menuitem"), (item) => item.textContent);

async function openList() {
  await act(async () => {
    fireEvent.click(button());
  });
}

async function pressKey(key: string) {
  await act(async () => {
    fireEvent.keyDown(window, { key });
  });
}

describe("ClipboardButton", () => {
  it("says how many items wait to be pasted, and lists them only when clicked", async () => {
    renderButton(["/Users/demo/Projects", "/Users/demo/notes.md", "/Users/demo/report.pdf"]);

    expect(button()).toHaveAccessibleName("Clipboard: 3 items copied");
    expect(button()).toHaveTextContent("3");
    expect(screen.queryByRole("menu")).toBeNull();

    await openList();
    const menu = screen.getByRole("menu", { name: "Clipboard" });
    expect(menu).toHaveTextContent("3 items copied");
    expect(menu).toHaveTextContent("1 folder and 2 files");
    expect(menu).toHaveTextContent("Paste with ⌘V");
    expect(itemNames()).toEqual(["Projects", "notes.md", "report.pdf", "Clear Clipboard"]);

    await act(async () => {
      fireEvent.click(button());
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("names a single item in its tooltip", () => {
    renderButton(["/Users/demo/notes.md"], "cut");
    expect(button()).toHaveAttribute("title", "notes.md cut");
    expect(button()).toHaveAccessibleName("Clipboard: 1 item cut");
  });

  it("lists the items under the folders they came from", async () => {
    renderButton(["/Users/demo/a.txt", "/Users/demo/b.txt", "/Volumes/Backup/c.txt"]);
    await openList();

    const headings = Array.from(
      document.querySelectorAll(".clipboard-menu-list .clipboard-menu-heading"),
      (heading) => [heading.textContent, heading.getAttribute("title")],
    );
    expect(headings).toEqual([
      ["demo", "/Users/demo"],
      ["Backup", "/Volumes/Backup"],
    ]);
    // The folder of the items at the top stays in view over the list.
    expect(document.querySelector(".clipboard-menu-pinned-heading")).toHaveTextContent("demo");
  });

  it("shows an item in its folder when it is clicked, and closes", async () => {
    const { onRevealItem } = renderButton(["/Users/demo/a.txt", "/Users/demo/b.txt"]);
    await openList();

    fireEvent.click(screen.getByRole("menuitem", { name: "b.txt" }));
    expect(onRevealItem).toHaveBeenCalledWith("/Users/demo/b.txt");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("takes one item off the clipboard and stays open", async () => {
    const { onRevealItem } = renderButton(["/Users/demo/a.txt", "/Users/demo/b.txt"]);
    await openList();

    fireEvent.click(screen.getByRole("button", { name: "Remove a.txt from the clipboard" }));
    expect(itemNames()).toEqual(["b.txt", "Clear Clipboard"]);
    expect(button()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(onRevealItem).not.toHaveBeenCalled();

    // Removing the last one empties the clipboard, and the button goes with it.
    fireEvent.click(screen.getByRole("button", { name: "Remove b.txt from the clipboard" }));
    expect(screen.getByTestId("empty")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("empties the clipboard", async () => {
    const { onClear } = renderButton(["/Users/demo/a.txt", "/Users/demo/b.txt"]);
    await openList();

    fireEvent.click(screen.getByRole("menuitem", { name: "Clear Clipboard" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("empty")).toBeInTheDocument();
  });

  it("is worked with the arrow keys, Return, Delete and Escape", async () => {
    const { onRevealItem, onClear } = renderButton([
      "/Users/demo/a.txt",
      "/Users/demo/b.txt",
      "/Users/demo/c.txt",
    ]);
    await openList();

    await pressKey("ArrowDown");
    await pressKey("ArrowDown");
    expect(screen.getByRole("menuitem", { current: true })).toHaveTextContent("b.txt");

    // Delete takes the item under the keys off; the next one moves up under them.
    await pressKey("Backspace");
    expect(itemNames()).toEqual(["a.txt", "c.txt", "Clear Clipboard"]);
    expect(screen.getByRole("menuitem", { current: true })).toHaveTextContent("c.txt");

    await pressKey("Enter");
    expect(onRevealItem).toHaveBeenCalledWith("/Users/demo/c.txt");
    expect(screen.queryByRole("menu")).toBeNull();

    await openList();
    await pressKey("End");
    expect(document.querySelector(".clipboard-menu-clear")).toHaveClass("active");
    await pressKey("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("closes when something outside it is pressed", async () => {
    renderButton(["/Users/demo/a.txt"]);
    await openList();

    await act(async () => {
      fireEvent.pointerDown(document.body);
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("draws only the rows in view of a clipboard that holds hundreds of items", async () => {
    renderButton(Array.from({ length: 500 }, (_, index) => `/Users/demo/IMG_${index}.jpg`));
    expect(button()).toHaveTextContent("500");

    await openList();
    expect(screen.getByRole("menu")).toHaveTextContent("500 items copied");
    // The items, plus Clear Clipboard.
    expect(screen.getAllByRole("menuitem").length).toBeLessThan(30);
    expect(screen.getByRole("menuitem", { name: "IMG_0.jpg" })).toBeInTheDocument();

    const list = document.querySelector(".clipboard-menu-list");
    if (!(list instanceof HTMLElement)) {
      throw new Error("Expected the clipboard list");
    }
    await act(async () => {
      list.scrollTop = 24 * 300;
      fireEvent.scroll(list);
    });
    expect(screen.queryByRole("menuitem", { name: "IMG_0.jpg" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "IMG_300.jpg" })).toBeInTheDocument();
  });

  it("keeps the remove buttons clear of the scrollbar in a list long enough to scroll", async () => {
    renderButton(["/Users/demo/a.txt", "/Users/demo/b.txt"]);
    await openList();
    expect(document.querySelector(".clipboard-menu-list")).not.toHaveClass(
      "clipboard-menu-list-scrolls",
    );
    cleanup();

    renderButton(Array.from({ length: 40 }, (_, index) => `/Users/demo/IMG_${index}.jpg`));
    await openList();
    expect(document.querySelector(".clipboard-menu-list")).toHaveClass(
      "clipboard-menu-list-scrolls",
    );
  });
});
