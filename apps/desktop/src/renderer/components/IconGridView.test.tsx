// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { ICON_GRID_LAYOUT } from "../lib/iconGridLayout";
import { NameHighlightContext } from "../lib/nameHighlight";
import { PaneLayoutChangeContext } from "../lib/paneLayoutChange";
import { IconGridView } from "./IconGridView";

type Entry = ComponentProps<typeof IconGridView>["entries"][number];

function file(name: string): Entry {
  return {
    path: `/Users/demo/${name}`,
    name,
    extension: name.includes(".") ? (name.split(".").at(-1) ?? "") : "",
    kind: "file",
    isHidden: false,
    isSymlink: false,
  };
}

function folder(name: string): Entry {
  return { ...file(name), extension: "", kind: "directory" };
}

// jsdom measures nothing, so the grid takes its size from the pane's, passed in here.
function renderGrid(overrides: Partial<ComponentProps<typeof IconGridView>> = {}) {
  const props: ComponentProps<typeof IconGridView> = {
    entries: [folder("Drafts"), file("alpha.txt"), file("beta.txt")],
    isFocused: true,
    selectedPaths: [],
    selectionLeadPath: null,
    viewportWidth: 500,
    viewportHeight: 400,
    onSelectionGesture: () => undefined,
    onClearSelection: () => undefined,
    onActivateEntry: () => undefined,
    onLayoutColumnsChange: () => undefined,
    onVisiblePathsChange: () => undefined,
    inlineRename: null,
    onInlineRenameSubmit: () => undefined,
    onInlineRenameCancel: () => undefined,
    ...overrides,
  };
  return render(<IconGridView {...props} />);
}

describe("IconGridView", () => {
  it("marks what a search matched in the names", () => {
    render(
      <NameHighlightContext.Provider value={/ph/i}>
        <IconGridView
          entries={[file("alpha.txt"), file("beta.txt")]}
          isFocused
          selectedPaths={[]}
          selectionLeadPath={null}
          viewportWidth={500}
          viewportHeight={400}
          onSelectionGesture={() => undefined}
          onClearSelection={() => undefined}
          onActivateEntry={() => undefined}
          onLayoutColumnsChange={() => undefined}
          onVisiblePathsChange={() => undefined}
          inlineRename={null}
          onInlineRenameSubmit={() => undefined}
          onInlineRenameCancel={() => undefined}
        />
      </NameHighlightContext.Provider>,
    );
    const marks = document.querySelectorAll(".icon-item-label mark");
    expect(Array.from(marks, (mark) => mark.textContent)).toEqual(["ph"]);
    expect(screen.getByRole("option", { name: "alpha.txt" })).toHaveTextContent("alpha.txt");
  });

  it("shows every item as an option with its name under its icon", () => {
    renderGrid();

    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Drafts",
      "alpha.txt",
      "beta.txt",
    ]);
    expect(screen.getByRole("option", { name: "alpha.txt" })).toHaveAttribute("title", "alpha.txt");
  });

  it("fits as many columns as the pane holds and reports them for keyboard movement", () => {
    const handleColumns = vi.fn();
    const { container } = renderGrid({ onLayoutColumnsChange: handleColumns });

    expect(handleColumns).toHaveBeenLastCalledWith(4);
    expect(screen.getByRole("listbox")).toHaveStyle({
      gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    });
    expect(container.querySelector(".icon-grid")).not.toHaveClass("compact");
  });

  it("fits more columns when compact", () => {
    const handleColumns = vi.fn();
    const { container } = renderGrid({
      compactIconView: true,
      onLayoutColumnsChange: handleColumns,
    });

    expect(handleColumns).toHaveBeenLastCalledWith(5);
    expect(container.querySelector(".icon-grid")).toHaveClass("compact");
  });

  it("mounts only the rows near the viewport and reports the items in them", () => {
    const handleVisiblePaths = vi.fn();
    const entries = Array.from({ length: 300 }, (_, index) => file(`item-${index}.txt`));
    renderGrid({
      entries,
      viewportHeight: ICON_GRID_LAYOUT.rowHeight * 2,
      onVisiblePathsChange: handleVisiblePaths,
    });

    // Two rows on screen and six more around them, four items each.
    expect(screen.getAllByRole("option")).toHaveLength(32);
    expect(handleVisiblePaths).toHaveBeenLastCalledWith(
      entries.slice(0, 32).map((entry) => entry.path),
    );
    // The rows that are not mounted still take their room, so the scrollbar is right.
    expect(screen.getByRole("listbox")).toHaveStyle({
      paddingBottom: `${(75 - 8) * ICON_GRID_LAYOUT.rowHeight}px`,
    });
  });

  it("marks the selection, and tells a selection in an unfocused pane apart", () => {
    const { rerender } = renderGrid({ selectedPaths: ["/Users/demo/beta.txt"] });
    const selected = screen.getByRole("option", { name: "beta.txt" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveClass("active");
    expect(selected).not.toHaveClass("inactive");
    expect(screen.getByRole("option", { name: "alpha.txt" })).toHaveAttribute(
      "aria-selected",
      "false",
    );

    rerender(
      <IconGridView
        entries={[file("beta.txt")]}
        isFocused={false}
        selectedPaths={["/Users/demo/beta.txt"]}
        selectionLeadPath={null}
        viewportWidth={500}
        viewportHeight={400}
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
        onActivateEntry={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        inlineRename={null}
        onInlineRenameSubmit={() => undefined}
        onInlineRenameCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("option", { name: "beta.txt" })).toHaveClass("active", "inactive");
  });

  it("forwards selection gestures, opening, and clicks on the empty space around items", () => {
    const handleSelectionGesture = vi.fn();
    const handleClearSelection = vi.fn();
    const handleContextMenu = vi.fn();
    const handleActivate = vi.fn();
    const { container } = renderGrid({
      onSelectionGesture: handleSelectionGesture,
      onClearSelection: handleClearSelection,
      onItemContextMenu: handleContextMenu,
      onActivateEntry: handleActivate,
    });
    const item = screen.getByRole("option", { name: "beta.txt" });
    const grid = container.querySelector(".icon-grid");
    if (!grid) {
      throw new Error("Missing icon grid container.");
    }

    fireEvent.pointerDown(item, { button: 0, metaKey: true });
    expect(handleSelectionGesture).toHaveBeenCalledWith("/Users/demo/beta.txt", {
      metaKey: true,
      shiftKey: false,
    });

    fireEvent.contextMenu(item, { clientX: 40, clientY: 50 });
    expect(handleContextMenu).toHaveBeenLastCalledWith("/Users/demo/beta.txt", { x: 40, y: 50 });

    fireEvent.doubleClick(item);
    expect(handleActivate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/Users/demo/beta.txt" }),
      false,
    );

    fireEvent.mouseDown(item);
    expect(handleClearSelection).not.toHaveBeenCalled();
    fireEvent.mouseDown(grid);
    fireEvent.contextMenu(grid, { clientX: 12, clientY: 18 });
    expect(handleClearSelection).toHaveBeenCalledTimes(2);
    expect(handleContextMenu).toHaveBeenLastCalledWith(null, { x: 12, y: 18 });
  });

  it("marks only folders as places to drop", () => {
    renderGrid({ getItemDropIndicator: () => "valid" });

    expect(screen.getByRole("option", { name: "Drafts" })).toHaveAttribute(
      "data-drop-target-state",
      "valid",
    );
    expect(screen.getByRole("option", { name: "alpha.txt" })).toHaveAttribute(
      "data-drop-target-state",
      "none",
    );
  });

  it("edits a name in place under its icon", () => {
    const handleSubmit = vi.fn();
    renderGrid({
      inlineRename: { path: "/Users/demo/alpha.txt", error: null },
      onInlineRenameSubmit: handleSubmit,
    });

    const field = screen.getByRole("textbox", { name: "Rename alpha.txt" });
    expect(field.closest(".icon-item")).toHaveClass("renaming");
    fireEvent.change(field, { target: { value: "gamma.txt" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(handleSubmit).toHaveBeenCalledWith("gamma.txt");
  });

  it("draws the loading or empty message it is given in place of items", () => {
    renderGrid({ entries: [], children: <div>This folder is empty</div> });

    expect(screen.getByText("This folder is empty")).toBeInTheDocument();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  describe("when the Info panel opens or closes", () => {
    // jsdom lays nothing out: the grid's width is what this says, and each item sits at its
    // column times 100 px and its row times the row height, by its place among the items.
    let gridWidth = 500;
    const descriptors = {
      rect: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect"),
      left: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetLeft"),
      top: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop"),
    };
    const animate = vi.fn();
    const columnsOf = (item: HTMLElement) =>
      Number(item.parentElement?.style.gridTemplateColumns.match(/repeat\((\d+)/)?.[1] ?? 1);
    const indexOf = (item: HTMLElement) =>
      Array.prototype.indexOf.call(item.parentElement?.children ?? [], item);

    beforeEach(() => {
      gridWidth = 500;
      animate.mockReset();
      Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
        configurable: true,
        value(this: HTMLElement) {
          const width = this.classList.contains("icon-grid") ? gridWidth : 0;
          return { left: 0, top: 0, right: width, bottom: 400, width, height: 400, x: 0, y: 0 };
        },
      });
      Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
        configurable: true,
        get(this: HTMLElement) {
          return (indexOf(this) % columnsOf(this)) * 100;
        },
      });
      Object.defineProperty(HTMLElement.prototype, "offsetTop", {
        configurable: true,
        get(this: HTMLElement) {
          return Math.floor(indexOf(this) / columnsOf(this)) * ICON_GRID_LAYOUT.rowHeight;
        },
      });
      Object.assign(HTMLElement.prototype, { animate, getAnimations: () => [] });
    });

    afterEach(() => {
      for (const [name, descriptor] of [
        ["getBoundingClientRect", descriptors.rect],
        ["offsetLeft", descriptors.left],
        ["offsetTop", descriptors.top],
      ] as const) {
        if (descriptor) {
          Object.defineProperty(HTMLElement.prototype, name, descriptor);
        }
      }
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
      Reflect.deleteProperty(HTMLElement.prototype, "getAnimations");
    });

    function gridAt(layoutChange: number) {
      return (
        <PaneLayoutChangeContext.Provider value={layoutChange}>
          <IconGridView
            entries={["a", "b", "c", "d", "e", "f"].map((name) => file(`${name}.txt`))}
            isFocused
            selectedPaths={[]}
            selectionLeadPath={null}
            viewportWidth={500}
            viewportHeight={400}
            onSelectionGesture={() => undefined}
            onClearSelection={() => undefined}
            onActivateEntry={() => undefined}
            onLayoutColumnsChange={() => undefined}
            onVisiblePathsChange={() => undefined}
            inlineRename={null}
            onInlineRenameSubmit={() => undefined}
            onInlineRenameCancel={() => undefined}
          />
        </PaneLayoutChangeContext.Provider>
      );
    }

    it("puts the items in their new columns at once and moves each from where it was", () => {
      const view = render(gridAt(0));
      expect(screen.getByRole("listbox").style.gridTemplateColumns).toMatch(/^repeat\(4,/);

      // The panel opened: the grid is narrower before it has been measured again.
      gridWidth = 300;
      act(() => view.rerender(gridAt(1)));

      expect(screen.getByRole("listbox").style.gridTemplateColumns).toMatch(/^repeat\(2,/);
      const moves = new Map(
        animate.mock.instances.map((item, call) => [
          (item as HTMLElement).dataset.selectableEntryPath?.split("/").at(-1),
          (animate.mock.calls[call]?.[0] as Keyframe[])[0]?.transform,
        ]),
      );
      // From four columns to two: a.txt and b.txt stay; c.txt and d.txt come from the right
      // end of the first row, e.txt and f.txt from the row above.
      const row = ICON_GRID_LAYOUT.rowHeight;
      expect(moves).toEqual(
        new Map([
          ["c.txt", `translate(200px, -${row}px)`],
          ["d.txt", `translate(200px, -${row}px)`],
          ["e.txt", `translate(0px, -${row}px)`],
          ["f.txt", `translate(0px, -${row}px)`],
        ]),
      );
    });

    it("doesn't animate items that move for any other reason", () => {
      const view = render(gridAt(0));
      gridWidth = 300;
      act(() => view.rerender(gridAt(0)));
      expect(animate).not.toHaveBeenCalled();
    });
  });
});
