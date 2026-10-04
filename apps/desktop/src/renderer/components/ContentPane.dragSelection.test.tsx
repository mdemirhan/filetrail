// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";

import { ContentPane } from "./ContentPane";

type Props = ComponentProps<typeof ContentPane>;

const entries = ["alpha.txt", "beta.txt", "gamma.txt", "delta.txt", "epsilon.txt"].map((name) => ({
  path: `/Users/demo/${name}`,
  name,
  extension: "txt",
  kind: "file" as const,
  isHidden: false,
  isSymlink: false,
}));

function renderPane(overrides: Partial<Props> = {}) {
  const props: Props = {
    isFocused: true,
    currentPath: "/Users/demo",
    entries,
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
    onClearSelection: () => undefined,
    onActivateEntry: () => undefined,
    onSortChange: () => undefined,
    onLayoutColumnsChange: () => undefined,
    onVisiblePathsChange: () => undefined,
    onNavigatePath: () => undefined,
    onRequestPathSuggestions: async () => ({ inputPath: "", basePath: null, suggestions: [] }),
    onFocusChange: () => undefined,
    ...overrides,
  };
  const view = render(<ContentPane {...props} />);
  // jsdom lays nothing out: every element is at 0,0, so the scroll area is given a size
  // and the items start at its corner.
  const scrollArea = view.container.querySelector<HTMLElement>(".content-scroll");
  if (!scrollArea) {
    throw new Error("Missing the scroll area.");
  }
  Object.defineProperties(scrollArea, {
    clientWidth: { value: 600, configurable: true },
    clientHeight: { value: 400, configurable: true },
  });
  const box = () => view.container.querySelector<HTMLElement>(".drag-select-box");
  return { ...view, scrollArea, box };
}

function drag(
  scrollArea: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
  modifiers: { metaKey?: boolean; shiftKey?: boolean } = {},
) {
  fireEvent.mouseDown(scrollArea, { button: 0, clientX: from.x, clientY: from.y, ...modifiers });
  fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y });
}

const names = (paths: string[]) => paths.map((path) => path.replace("/Users/demo/", ""));

describe("ContentPane drag-to-select", () => {
  it("selects the List view's rows under the box, and leads with the one at the pointer", () => {
    const onSelectPaths = vi.fn();
    const onClearSelection = vi.fn();
    const { scrollArea, box } = renderPane({ onSelectPaths, onClearSelection });

    // Rows are 28px high: the box from 10 to 70 touches the first three.
    drag(scrollArea, { x: 50, y: 10 }, { x: 80, y: 70 });

    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(box()).toBeVisible();
    expect(box()).toHaveStyle({ left: "50px", top: "10px", width: "30px", height: "60px" });
    expect(names(onSelectPaths.mock.lastCall?.[0])).toEqual(["alpha.txt", "beta.txt", "gamma.txt"]);
    // No lead while the box is drawn, so the view does not scroll to one.
    expect(onSelectPaths.mock.lastCall?.[1]).toBeNull();

    fireEvent.mouseUp(window, { clientX: 80, clientY: 70 });

    expect(box()).not.toBeVisible();
    expect(onSelectPaths).toHaveBeenLastCalledWith(
      ["/Users/demo/alpha.txt", "/Users/demo/beta.txt", "/Users/demo/gamma.txt"],
      "/Users/demo/gamma.txt",
    );
  });

  it("does nothing more than clear the selection when the pointer barely moves", () => {
    const onSelectPaths = vi.fn();
    const onClearSelection = vi.fn();
    const { scrollArea, box } = renderPane({ onSelectPaths, onClearSelection });

    drag(scrollArea, { x: 50, y: 10 }, { x: 52, y: 11 });
    fireEvent.mouseUp(window);

    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(onSelectPaths).not.toHaveBeenCalled();
    expect(box()).not.toBeVisible();
  });

  it("adds to the selection with ⇧ and flips it with ⌘", () => {
    const onSelectPaths = vi.fn();
    const onClearSelection = vi.fn();
    const selected = {
      selectedPaths: ["/Users/demo/alpha.txt", "/Users/demo/epsilon.txt"],
      selectionLeadPath: "/Users/demo/epsilon.txt",
    };
    const { scrollArea } = renderPane({ ...selected, onSelectPaths, onClearSelection });

    drag(scrollArea, { x: 50, y: 10 }, { x: 80, y: 40 }, { shiftKey: true });
    fireEvent.mouseUp(window);

    expect(onClearSelection).not.toHaveBeenCalled();
    // The app puts them back in the order they are shown.
    expect(onSelectPaths).toHaveBeenLastCalledWith(
      ["/Users/demo/epsilon.txt", "/Users/demo/alpha.txt", "/Users/demo/beta.txt"],
      "/Users/demo/epsilon.txt",
    );

    drag(scrollArea, { x: 50, y: 10 }, { x: 80, y: 40 }, { metaKey: true });
    fireEvent.mouseUp(window);

    expect(onClearSelection).not.toHaveBeenCalled();
    expect(onSelectPaths).toHaveBeenLastCalledWith(
      ["/Users/demo/epsilon.txt", "/Users/demo/beta.txt"],
      "/Users/demo/epsilon.txt",
    );
  });

  it("leaves a press on the scrollbar to scroll", () => {
    const onSelectPaths = vi.fn();
    const { scrollArea, box } = renderPane({ onSelectPaths });

    drag(scrollArea, { x: 605, y: 10 }, { x: 500, y: 100 });
    fireEvent.mouseUp(window);

    expect(onSelectPaths).not.toHaveBeenCalled();
    expect(box()).not.toBeVisible();
  });

  it("selects across the flow list's columns", () => {
    const onSelectPaths = vi.fn();
    const { scrollArea } = renderPane({ viewMode: "list", onSelectPaths });

    // Unmeasured, the flow list holds one row per column: columns 0 and 1 are 310px apart.
    drag(scrollArea, { x: 10, y: 5 }, { x: 400, y: 10 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 10 });

    expect(onSelectPaths).toHaveBeenLastCalledWith(
      ["/Users/demo/alpha.txt", "/Users/demo/beta.txt"],
      "/Users/demo/beta.txt",
    );
  });

  it("selects the Icon view's items under the box", () => {
    const onSelectPaths = vi.fn();
    const { container, scrollArea } = renderPane({ viewMode: "icons", onSelectPaths });
    const grid = container.querySelector<HTMLElement>(".icon-grid-items");
    if (!grid) {
      throw new Error("Missing the icon grid.");
    }
    Object.defineProperty(grid, "clientWidth", { value: 600, configurable: true });

    // Unmeasured, the grid has one column, its items 116px apart: the tiles span 264 to 336
    // across, the names at their widest 249 to 351.
    drag(scrollArea, { x: 200, y: 20 }, { x: 240, y: 130 });
    expect(onSelectPaths).not.toHaveBeenCalled();
    fireEvent.mouseMove(window, { clientX: 270, clientY: 130 });
    fireEvent.mouseUp(window, { clientX: 270, clientY: 130 });

    expect(onSelectPaths).toHaveBeenLastCalledWith(
      ["/Users/demo/alpha.txt", "/Users/demo/beta.txt"],
      "/Users/demo/beta.txt",
    );
  });
});
