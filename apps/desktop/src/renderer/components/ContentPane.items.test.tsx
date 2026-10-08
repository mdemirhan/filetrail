// @vitest-environment jsdom

// What each view does with a press on an item: right-click, double-click, and files
// dragged from it or onto it; and a Details column made wider by dragging its divider.

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { DEFAULT_DETAIL_COLUMN_WIDTHS } from "../../shared/appPreferences";
import { ContentPane } from "./ContentPane";

type Props = ComponentProps<typeof ContentPane>;

const FILE = {
  path: "/Users/demo/notes.txt",
  name: "notes.txt",
  extension: "txt",
  kind: "file" as const,
  isHidden: false,
  isSymlink: false,
};
const FOLDER = {
  path: "/Users/demo/Projects",
  name: "Projects",
  extension: "",
  kind: "directory" as const,
  isHidden: false,
  isSymlink: false,
};

function renderPane(overrides: Partial<Props> = {}) {
  const handlers = {
    onItemContextMenu: vi.fn(),
    onActivateEntry: vi.fn(),
    onClearSelection: vi.fn(),
    onItemDragStart: vi.fn(),
    onItemDragEnd: vi.fn(),
    onItemDragEnter: vi.fn(),
    onItemDragOver: vi.fn(),
    onItemDragLeave: vi.fn(),
    onItemDrop: vi.fn(),
    onDetailColumnWidthsChange: vi.fn(),
  };
  const props: Props = {
    isFocused: true,
    currentPath: "/Users/demo",
    entries: [FILE, FOLDER],
    viewMode: "details",
    loading: false,
    error: null,
    hiddenItemCount: 0,
    selectedPaths: [],
    selectionLeadPath: null,
    metadataByPath: {},
    sortBy: "name",
    sortDirection: "asc",
    onSelectionGesture: () => undefined,
    onSortChange: () => undefined,
    onLayoutColumnsChange: () => undefined,
    onVisiblePathsChange: () => undefined,
    onNavigatePath: () => undefined,
    onRequestPathSuggestions: async () => ({ inputPath: "", basePath: null, suggestions: [] }),
    onFocusChange: () => undefined,
    ...handlers,
    ...overrides,
  };
  const view = render(<ContentPane {...props} />);
  return { ...view, handlers };
}

// An item as each view draws it.
function itemOf(viewMode: Props["viewMode"], name: string): HTMLElement {
  if (viewMode === "details") {
    return screen.getByRole("row", { name: new RegExp(name) });
  }
  if (viewMode === "list") {
    return screen.getByRole("option", { name: new RegExp(name) });
  }
  const item = document.querySelector<HTMLElement>(`[title="${name}"]`);
  if (!item) {
    throw new Error(`No item ${name}`);
  }
  return item;
}

describe.each(["details", "list", "icons"] as const)("an item in the %s view", (viewMode) => {
  it("opens its menu where it is right-clicked", () => {
    const { handlers } = renderPane({ viewMode });

    fireEvent.contextMenu(itemOf(viewMode, "notes.txt"), { clientX: 30, clientY: 40 });

    expect(handlers.onItemContextMenu).toHaveBeenCalledWith(FILE.path, { x: 30, y: 40 });
  });

  it("opens on a double-click, in a new tab with ⌘", () => {
    const { handlers } = renderPane({ viewMode });

    fireEvent.doubleClick(itemOf(viewMode, "Projects"));
    fireEvent.doubleClick(itemOf(viewMode, "Projects"), { metaKey: true });

    expect(handlers.onActivateEntry.mock.calls).toEqual([
      [FOLDER, false],
      [FOLDER, true],
    ]);
  });

  it("is dragged from, and a folder takes what is dropped on it", () => {
    const { handlers } = renderPane({ viewMode });
    const folder = itemOf(viewMode, "Projects");

    fireEvent.dragStart(itemOf(viewMode, "notes.txt"));
    fireEvent.dragEnter(folder);
    fireEvent.dragOver(folder);
    fireEvent.dragLeave(folder);
    fireEvent.drop(folder);
    fireEvent.dragEnd(itemOf(viewMode, "notes.txt"));

    expect(handlers.onItemDragStart.mock.calls[0]?.[0]).toEqual(FILE);
    for (const handler of [
      handlers.onItemDragEnter,
      handlers.onItemDragOver,
      handlers.onItemDragLeave,
      handlers.onItemDrop,
    ]) {
      expect(handler.mock.calls.map(([entry]) => entry)).toEqual([FOLDER]);
    }
    expect(handlers.onItemDragEnd).toHaveBeenCalledTimes(1);
  });

  it("takes nothing dropped on a file", () => {
    const { handlers } = renderPane({ viewMode });
    const file = itemOf(viewMode, "notes.txt");

    fireEvent.dragEnter(file);
    fireEvent.dragOver(file);
    fireEvent.drop(file);

    expect(handlers.onItemDragEnter).not.toHaveBeenCalled();
    expect(handlers.onItemDragOver).not.toHaveBeenCalled();
    expect(handlers.onItemDrop).not.toHaveBeenCalled();
  });
});

describe("the Details view's empty space", () => {
  it("clears the selection on a right-click, and opens the folder's menu", () => {
    const { container, handlers } = renderPane();

    fireEvent.contextMenu(container.querySelector(".details-scroll") as HTMLElement, {
      clientX: 5,
      clientY: 6,
    });

    expect(handlers.onClearSelection).toHaveBeenCalledTimes(1);
    expect(handlers.onItemContextMenu).toHaveBeenCalledWith(null, { x: 5, y: 6 });
  });

  it("moves the column titles along with the rows scrolled sideways", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderPane();
      const scroller = container.querySelector(".details-scroll") as HTMLElement;
      const header = container.querySelector(".details-header") as HTMLElement;

      scroller.scrollLeft = 120;
      fireEvent.scroll(scroller);
      act(() => {
        vi.runOnlyPendingTimers();
      });

      expect(header.style.transform).toBe("translateX(-120px)");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a Details column's divider", () => {
  const nameDivider = () => screen.getByRole("separator", { name: "Resize Name column" });

  it("makes the column wider as it is dragged, until let go", () => {
    const { handlers } = renderPane();
    const startWidth = DEFAULT_DETAIL_COLUMN_WIDTHS.name;

    fireEvent.pointerDown(nameDivider(), { button: 0, clientX: 100, pointerId: 7 });
    expect(document.body).toHaveClass("column-resize-active");
    fireEvent.pointerMove(window, { clientX: 140, pointerId: 7 });
    // Another pointer is not this drag.
    fireEvent.pointerMove(window, { clientX: 400, pointerId: 8 });
    fireEvent.pointerUp(window, { pointerId: 8 });
    fireEvent.pointerUp(window, { pointerId: 7 });
    fireEvent.pointerMove(window, { clientX: 200, pointerId: 7 });

    expect(handlers.onDetailColumnWidthsChange.mock.calls).toEqual([
      [{ ...DEFAULT_DETAIL_COLUMN_WIDTHS, name: startWidth + 40 }],
    ]);
    expect(document.body).not.toHaveClass("column-resize-active");
  });

  it("does nothing for a drag that leaves the width as it was, or a right button", () => {
    const { handlers } = renderPane();

    fireEvent.pointerDown(nameDivider(), { button: 2, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 160, pointerId: 1 });
    fireEvent.pointerDown(nameDivider(), { button: 0, clientX: 100, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 100, pointerId: 2 });
    fireEvent.pointerCancel(window, { pointerId: 2 });

    expect(handlers.onDetailColumnWidthsChange).not.toHaveBeenCalled();
  });

  it("stops a drag when the list goes away", () => {
    const { unmount } = renderPane();

    fireEvent.pointerDown(nameDivider(), { button: 0, clientX: 100, pointerId: 3 });
    unmount();

    expect(document.body).not.toHaveClass("column-resize-active");
  });
});
