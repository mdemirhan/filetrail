// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { ICON_GRID_LAYOUT } from "../lib/iconGridLayout";
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
});
