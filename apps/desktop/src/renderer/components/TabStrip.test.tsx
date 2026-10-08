// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import type { ExplorerTabItem } from "../hooks/useExplorerTabs";
import { TabStrip } from "./TabStrip";

vi.mock("./ToolbarIcon", () => ({ ToolbarIcon: () => null }));

function tab(id: string, label: string, overrides: Partial<ExplorerTabItem> = {}): ExplorerTabItem {
  return {
    id,
    label,
    tooltip: `/Users/demo/${label}`,
    kind: "folder",
    searching: false,
    active: false,
    path: `/Users/demo/${label}`,
    ...overrides,
  };
}

const TABS = [tab("t1", "Documents", { active: true }), tab("t2", "Downloads"), tab("t3", "Music")];

function renderStrip(
  overrides: Partial<Parameters<typeof TabStrip>[0]> = {},
  tabs: readonly ExplorerTabItem[] = TABS,
) {
  const props = {
    tabs,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onDuplicateTab: vi.fn(),
    onMoveTabToNewWindow: vi.fn(),
    onMergeAllWindows: vi.fn(),
    countWindows: vi.fn(async () => 1),
    onMoveTab: vi.fn(),
    onNewTab: vi.fn(),
    onItemDragOver: vi.fn(),
    onItemDragLeave: vi.fn(),
    onItemDrop: vi.fn(),
    ...overrides,
  };
  const view = render(<TabStrip {...props} />);
  return { props, view };
}

function tabNamed(label: string): HTMLElement {
  const found = screen
    .getAllByRole("tab")
    .find((element) => element.querySelector(".tab-strip-label")?.textContent === label);
  if (!found) {
    throw new Error(`No tab ${label}`);
  }
  return found;
}

async function openMenu(label: string) {
  await act(async () => {
    fireEvent.contextMenu(tabNamed(label), { clientX: 40, clientY: 30 });
  });
  return screen.getByRole("menu", { name: "Tab" });
}

// Lays the tabs out side by side, 100 px each, as the window would.
function layOutTabs() {
  for (const [index, element] of screen.getAllByRole("tab").entries()) {
    element.getBoundingClientRect = () =>
      ({ left: index * 100, right: (index + 1) * 100, top: 0, bottom: 28 }) as DOMRect;
  }
}

describe("TabStrip", () => {
  it("shows a tab for each, the one on screen selected, and its folder as its tooltip", () => {
    renderStrip();

    expect(screen.getAllByRole("tab").map((element) => element.textContent)).toEqual([
      "Documents",
      "Downloads",
      "Music",
    ]);
    expect(tabNamed("Documents")).toHaveAttribute("aria-selected", "true");
    expect(tabNamed("Music")).toHaveAttribute("title", "/Users/demo/Music");
  });

  it("marks a search tab, and a search still running", () => {
    renderStrip({}, [
      tab("t1", "Documents", { active: true }),
      tab("t2", "“notes”", { kind: "search", searching: true }),
    ]);

    const icon = tabNamed("“notes”").querySelector(".tab-strip-search");
    expect(icon).toHaveClass("searching");
    expect(tabNamed("Documents").querySelector(".tab-strip-search")).toBeNull();
  });

  it("selects a tab with a click, Return or Space", () => {
    const { props } = renderStrip();

    fireEvent.click(tabNamed("Downloads"));
    fireEvent.keyDown(tabNamed("Music"), { key: "Enter" });
    fireEvent.keyDown(tabNamed("Documents"), { key: " " });
    fireEvent.keyDown(tabNamed("Documents"), { key: "a" });

    expect(props.onSelectTab.mock.calls).toEqual([["t2"], ["t3"], ["t1"]]);
  });

  it("closes a tab with its close button or a middle click, without selecting it", () => {
    const { props } = renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "Close Downloads" }));
    fireEvent(tabNamed("Music"), new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    fireEvent(tabNamed("Music"), new MouseEvent("auxclick", { bubbles: true, button: 2 }));

    expect(props.onCloseTab.mock.calls).toEqual([["t2"], ["t3"]]);
    expect(props.onSelectTab).not.toHaveBeenCalled();
  });

  it("leaves the keyboard where it is when a tab, its buttons or its menu are pressed", async () => {
    renderStrip();

    // false: the press was kept from moving the focus.
    expect(fireEvent.mouseDown(tabNamed("Music"))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "Close Music" }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("button", { name: "New Tab" }))).toBe(false);
    const menu = await openMenu("Music");
    expect(fireEvent.mouseDown(within(menu).getByRole("menuitem", { name: "Close Tab" }))).toBe(
      false,
    );
  });

  it("opens a new tab from its button", () => {
    const { props } = renderStrip();

    fireEvent.click(screen.getByRole("button", { name: "New Tab" }));

    expect(props.onNewTab).toHaveBeenCalledTimes(1);
  });

  it("keeps the tab on screen in sight", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { props, view } = renderStrip();
      scrollIntoView.mockClear();

      view.rerender(
        <TabStrip
          {...props}
          tabs={[tab("t1", "Documents"), tab("t2", "Downloads", { active: true })]}
        />,
      );

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      expect(scrollIntoView.mock.contexts.at(-1)).toBe(tabNamed("Downloads"));
    } finally {
      (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = undefined;
    }
  });

  describe("its menu", () => {
    it("closes, closes the others, duplicates and moves the tab right-clicked", async () => {
      const { props } = renderStrip();

      for (const name of [
        "Close Tab",
        "Close Other Tabs",
        "Duplicate Tab",
        "Move Tab to New Window",
      ]) {
        const menu = await openMenu("Downloads");
        await act(async () => {
          fireEvent.click(within(menu).getByRole("menuitem", { name }));
        });
        expect(screen.queryByRole("menu")).toBeNull();
      }

      expect(props.onCloseTab).toHaveBeenCalledWith("t2");
      expect(props.onCloseOtherTabs).toHaveBeenCalledWith("t2");
      expect(props.onDuplicateTab).toHaveBeenCalledWith("t2");
      expect(props.onMoveTabToNewWindow).toHaveBeenCalledWith("t2");
    });

    it("offers Merge All Windows only when another window is open", async () => {
      const { props } = renderStrip();

      let menu = await openMenu("Music");
      expect(within(menu).getByRole("menuitem", { name: "Merge All Windows" })).toBeDisabled();
      await act(async () => {
        fireEvent.keyDown(window, { key: "Escape" });
      });

      props.countWindows.mockResolvedValue(2);
      menu = await openMenu("Music");
      const merge = within(menu).getByRole("menuitem", { name: "Merge All Windows" });
      expect(merge).toBeEnabled();
      await act(async () => {
        fireEvent.click(merge);
      });
      expect(props.onMergeAllWindows).toHaveBeenCalledTimes(1);
    });

    it("leaves Merge All Windows off when the windows can't be counted", async () => {
      renderStrip({ countWindows: vi.fn(async () => Promise.reject(new Error("gone"))) });

      const menu = await openMenu("Music");

      expect(within(menu).getByRole("menuitem", { name: "Merge All Windows" })).toBeDisabled();
    });

    it("closes on Escape, keeping the key from the window, and on any other key", async () => {
      renderStrip();
      const behind = vi.fn();
      window.addEventListener("keydown", behind);
      try {
        await openMenu("Music");
        await act(async () => {
          fireEvent.keyDown(window, { key: "Escape" });
        });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(behind).not.toHaveBeenCalled();

        await openMenu("Music");
        await act(async () => {
          fireEvent.keyDown(window, { key: "a" });
        });
        expect(screen.queryByRole("menu")).toBeNull();
        expect(behind).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener("keydown", behind);
      }
    });

    it("closes on a click outside it, a resize or the window going to the back", async () => {
      renderStrip();

      const menu = await openMenu("Music");
      await act(async () => {
        fireEvent.pointerDown(within(menu).getByRole("menuitem", { name: "Close Tab" }));
      });
      expect(screen.getByRole("menu")).toBeInTheDocument();
      await act(async () => {
        fireEvent.pointerDown(document.body);
      });
      expect(screen.queryByRole("menu")).toBeNull();

      await openMenu("Music");
      await act(async () => {
        fireEvent(window, new Event("resize"));
      });
      expect(screen.queryByRole("menu")).toBeNull();

      await openMenu("Music");
      await act(async () => {
        fireEvent(window, new Event("blur"));
      });
      expect(screen.queryByRole("menu")).toBeNull();
    });
  });

  describe("dragging a tab along the row", () => {
    it("moves it to the place the pointer is over, and the drag doesn't select it", () => {
      const { props } = renderStrip();
      layOutTabs();
      const documents = tabNamed("Documents");

      fireEvent.pointerDown(documents, { button: 0, clientX: 50, pointerId: 1 });
      // A small slip is still a click.
      fireEvent.pointerMove(documents, { clientX: 53 });
      expect(props.onMoveTab).not.toHaveBeenCalled();
      fireEvent.pointerMove(documents, { clientX: 150 });
      fireEvent.pointerMove(documents, { clientX: 250 });
      // Past the last tab, nowhere to go.
      fireEvent.pointerMove(documents, { clientX: 450 });
      fireEvent.pointerUp(documents);
      fireEvent.click(documents);

      expect(props.onMoveTab.mock.calls).toEqual([
        ["t1", 1],
        ["t1", 2],
      ]);
      expect(props.onSelectTab).not.toHaveBeenCalled();
      // The next click selects again.
      fireEvent.click(documents);
      expect(props.onSelectTab).toHaveBeenCalledWith("t1");
    });

    it("doesn't start from the close button, another button, or with one tab", () => {
      const { props, view } = renderStrip();
      layOutTabs();

      const close = screen.getByRole("button", { name: "Close Documents" });
      fireEvent.pointerDown(close, { button: 0, clientX: 50 });
      fireEvent.pointerMove(tabNamed("Documents"), { clientX: 150 });
      fireEvent.pointerDown(tabNamed("Documents"), { button: 2, clientX: 50 });
      fireEvent.pointerMove(tabNamed("Documents"), { clientX: 150 });
      expect(props.onMoveTab).not.toHaveBeenCalled();

      view.rerender(<TabStrip {...props} tabs={[tab("t1", "Documents", { active: true })]} />);
      fireEvent.pointerDown(tabNamed("Documents"), { button: 0, clientX: 50 });
      fireEvent.pointerMove(tabNamed("Documents"), { clientX: 150 });
      expect(props.onMoveTab).not.toHaveBeenCalled();
    });

    it("lets the click through after a drag the system cancelled", () => {
      const { props } = renderStrip();
      layOutTabs();
      const documents = tabNamed("Documents");

      fireEvent.pointerDown(documents, { button: 0, clientX: 50 });
      fireEvent.pointerMove(documents, { clientX: 150 });
      fireEvent.pointerCancel(documents);
      fireEvent.pointerMove(documents, { clientX: 250 });
      fireEvent.click(documents);

      expect(props.onMoveTab.mock.calls).toEqual([["t1", 1]]);
      expect(props.onSelectTab).toHaveBeenCalledWith("t1");
    });
  });

  describe("files dragged over a tab", () => {
    it("are offered to the tab, and dropped on it", () => {
      const { props } = renderStrip({
        getDropIndicator: (tabId) => (tabId === "t2" ? "valid" : null),
      });
      const downloads = tabNamed("Downloads");

      expect(downloads).toHaveAttribute("data-drop-target-state", "valid");
      expect(tabNamed("Music")).toHaveAttribute("data-drop-target-state", "none");
      fireEvent.dragEnter(downloads);
      fireEvent.dragOver(downloads);
      fireEvent.drop(downloads);

      expect(props.onItemDragOver).toHaveBeenCalledTimes(2);
      expect(props.onItemDragOver.mock.calls[0]?.[0]).toMatchObject({ id: "t2" });
      expect(props.onItemDrop.mock.calls[0]?.[0]).toMatchObject({ id: "t2" });
    });

    it("leave the tab only when they leave it, not when they move onto what is in it", () => {
      const { props } = renderStrip();
      const downloads = tabNamed("Downloads");
      const label = downloads.querySelector(".tab-strip-label") as HTMLElement;

      const leave = (relatedTarget: EventTarget) =>
        fireEvent(downloads, new MouseEvent("dragleave", { bubbles: true, relatedTarget }));

      leave(label);
      expect(props.onItemDragLeave).not.toHaveBeenCalled();
      leave(document.body);
      expect(props.onItemDragLeave).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }));
    });
  });
});
