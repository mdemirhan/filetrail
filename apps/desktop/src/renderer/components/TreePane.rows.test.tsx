// @vitest-environment jsdom

// A sidebar row from the keyboard and with ⌘, a folder that is being read or couldn't be,
// and files dragged over the rows.

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { TreePane } from "./TreePane";

type Props = ComponentProps<typeof TreePane>;
type Node = Props["nodes"][string];

function folderNode(path: string, overrides: Partial<Node> = {}): Node {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    kind: "directory",
    isHidden: false,
    isSymlink: false,
    expanded: false,
    loading: false,
    loaded: false,
    error: null,
    childPaths: [],
    ...overrides,
  };
}

function renderPane(overrides: Partial<Props> = {}, nodes: Partial<Record<string, Node>> = {}) {
  const props = {
    isFocused: true,
    rootPath: "/Users/demo",
    homePath: "/Users/demo",
    selectedTreeItemId: "fs:/Users/demo" as Props["selectedTreeItemId"],
    compactTreeView: false,
    singleClickExpandTreeItems: false,
    favorites: [{ path: "/Users/demo/Desktop", icon: "desktop" as const }],
    favoritesPlacement: "separate" as const,
    activeLeftPaneSubview: "tree" as const,
    favoritesExpanded: true,
    locations: [{ path: "/Volumes/USB", label: "USB", icon: "drive" as const }],
    locationsExpanded: true,
    nodes: {
      "/Users/demo": folderNode("/Users/demo", {
        expanded: true,
        loaded: true,
        childPaths: ["/Users/demo/Documents", "/Users/demo/Music"],
      }),
      "/Users/demo/Documents": folderNode("/Users/demo/Documents"),
      "/Users/demo/Music": folderNode("/Users/demo/Music"),
      ...nodes,
    } as Props["nodes"],
    includeHidden: false,
    typeaheadQuery: "",
    onFocusChange: vi.fn(),
    onLeftPaneSubviewChange: vi.fn(),
    onClearSelection: vi.fn(),
    onToggleExpand: vi.fn(),
    onNavigate: vi.fn(),
    onNavigateFavorite: vi.fn(),
    onToggleFavoritesExpanded: vi.fn(),
    onToggleLocationsExpanded: vi.fn(),
    onOpenInNewTab: vi.fn(),
    onSelectItem: vi.fn(),
    onItemDragEnter: vi.fn(),
    onItemDragOver: vi.fn(),
    onItemDrop: vi.fn(),
  };
  const view = render(<TreePane {...props} {...overrides} />);
  return { ...view, props };
}

function row(itemId: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`.tree-row[data-tree-item-id="${itemId}"]`);
  if (!element) {
    throw new Error(`No row ${itemId}`);
  }
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a sidebar row", () => {
  it("opens with Return or Space, a moment later as a click does", () => {
    const { props } = renderPane();

    fireEvent.keyDown(row("fs:/Users/demo/Documents"), { key: "Enter" });
    fireEvent.keyDown(row("fs:/Users/demo/Music"), { key: "a" });
    expect(props.onNavigate).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.keyDown(row("location:/Volumes/USB"), { key: " " });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(props.onNavigate.mock.calls).toEqual([["/Users/demo/Documents"]]);
    expect(props.onSelectItem).toHaveBeenCalledWith("location:/Volumes/USB");
  });

  it("opens a folder in a new tab on a ⌘-click, without going to it", () => {
    const { props } = renderPane();

    fireEvent.pointerDown(row("fs:/Users/demo/Music"), { button: 0, metaKey: true });
    fireEvent.click(row("fs:/Users/demo/Music"), { metaKey: true });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(props.onOpenInNewTab).toHaveBeenCalledWith("/Users/demo/Music");
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(row("fs:/Users/demo")).toHaveAttribute("aria-selected", "true");
  });

  it("lets go of the folder on screen on a ⌘-click of it", () => {
    const { props } = renderPane();

    fireEvent.pointerDown(row("fs:/Users/demo"), { button: 0, metaKey: true });
    fireEvent.click(row("fs:/Users/demo"), { metaKey: true });

    expect(props.onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("shows itself selected at once, and not once its folder fails to open", async () => {
    const onNavigate = vi.fn(async () => false);
    renderPane({ onNavigate });

    fireEvent.pointerDown(row("fs:/Users/demo/Music"), { button: 0 });
    expect(row("fs:/Users/demo/Music")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(row("fs:/Users/demo/Music"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onNavigate).toHaveBeenCalledWith("/Users/demo/Music");
    expect(row("fs:/Users/demo/Music")).toHaveAttribute("aria-selected", "false");
  });

  it("says a folder is being read only when that takes a while, and why it couldn't be", () => {
    renderPane(
      {},
      {
        "/Users/demo/Documents": folderNode("/Users/demo/Documents", { loading: true }),
        "/Users/demo/Music": folderNode("/Users/demo/Music", {
          error: "EACCES: permission denied",
        }),
      },
    );

    expect(screen.queryByText("Loading folder…")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText("Loading folder…")).toBeInTheDocument();
    expect(screen.getByText("EACCES: permission denied")).toBeInTheDocument();
  });
});

describe("files dragged over the sidebar", () => {
  it("are offered to the folder, favorite or disk under them, and dropped there", () => {
    const { props } = renderPane();

    fireEvent.dragEnter(row("fs:/Users/demo/Music"));
    fireEvent.dragOver(row("favorite:/Users/demo/Desktop"));
    fireEvent.drop(row("location:/Volumes/USB"));

    expect(props.onItemDragEnter.mock.calls.map(([item, , subview]) => [item.id, subview])).toEqual(
      [["fs:/Users/demo/Music", "tree"]],
    );
    expect(props.onItemDragOver.mock.calls.map(([item, , subview]) => [item.id, subview])).toEqual([
      ["favorite:/Users/demo/Desktop", "favorites"],
    ]);
    expect(props.onItemDrop.mock.calls.map(([item, , subview]) => [item.id, subview])).toEqual([
      ["location:/Volumes/USB", "favorites"],
    ]);
  });

  it("are not offered to a heading or to empty space", () => {
    const { props, container } = renderPane();

    for (const selector of [".sidebar-favorites .sidebar-section-header", ".tree-scroll"]) {
      const target = container.querySelector(selector) as HTMLElement;
      expect(target).not.toBeNull();
      fireEvent.dragEnter(target);
      fireEvent.dragOver(target);
      fireEvent.drop(target);
    }

    expect(props.onItemDragEnter).not.toHaveBeenCalled();
    expect(props.onItemDragOver).not.toHaveBeenCalled();
    expect(props.onItemDrop).not.toHaveBeenCalled();
  });

  it("show where they can be dropped", () => {
    renderPane({
      getItemDropIndicator: (item) => (item.id === "fs:/Users/demo/Music" ? "valid" : null),
    });

    expect(row("fs:/Users/demo/Music").querySelector(".tree-drop-target-badge")).toHaveTextContent(
      "Drop here",
    );
    expect(row("fs:/Users/demo/Documents").querySelector(".tree-drop-target-badge")).toBeNull();
  });
});

describe("the sidebar's keyboard focus", () => {
  it("is told when it comes and goes", () => {
    const { props } = renderPane();
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      fireEvent.focus(row("fs:/Users/demo/Music"));
      fireEvent.blur(row("fs:/Users/demo/Music"), { relatedTarget: row("fs:/Users/demo") });
      expect(props.onFocusChange.mock.calls).toEqual([[true]]);
      fireEvent.blur(row("fs:/Users/demo/Music"), { relatedTarget: outside });
      expect(props.onFocusChange.mock.calls).toEqual([[true], [false]]);
    } finally {
      outside.remove();
    }
  });
});
