// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";

import { type ClipboardMarks, ClipboardMarksProvider } from "../lib/clipboardMarks";
import { TreePane } from "./TreePane";

const baseNodes: ComponentProps<typeof TreePane>["nodes"] = {
  "/Users/demo": {
    path: "/Users/demo",
    name: "demo",
    kind: "directory",
    isHidden: false,
    isSymlink: false,
    expanded: true,
    loading: false,
    loaded: true,
    error: null,
    childPaths: ["/Users/demo/Documents"],
  },
  "/Users/demo/Documents": {
    path: "/Users/demo/Documents",
    name: "Documents",
    kind: "directory",
    isHidden: false,
    isSymlink: false,
    expanded: false,
    loading: false,
    loaded: false,
    error: null,
    childPaths: [],
  },
};

function getNamedButton(name: string, index: number) {
  const button = screen.getAllByRole("button", { name })[index];
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button "${name}" at index ${index}.`);
  }
  return button;
}

function getTreeRow(button: HTMLButtonElement) {
  const row = button.closest(".tree-row");
  if (!(row instanceof HTMLDivElement)) {
    throw new Error("Missing tree row wrapper.");
  }
  return row;
}

function treePaneDefaults(): ComponentProps<typeof TreePane> {
  return {
    isFocused: true,
    rootPath: "/Users/demo",
    homePath: "/Users/demo",
    selectedTreeItemId: "fs:/Users/demo",
    compactTreeView: false,
    singleClickExpandTreeItems: false,
    favorites: [
      { path: "/Users/demo/Desktop", icon: "desktop" },
      { path: "/Users/demo/Documents", icon: "documents" },
    ],
    favoritesPlacement: "integrated",
    activeLeftPaneSubview: "tree",
    favoritesExpanded: true,
    nodes: baseNodes,
    onFocusChange: () => undefined,
    onLeftPaneSubviewChange: () => undefined,
    onClearSelection: () => undefined,
    includeHidden: false,
    onToggleExpand: () => undefined,
    onNavigate: () => undefined,
    onNavigateFavorite: () => undefined,
    onToggleFavoritesExpanded: () => undefined,
    typeaheadQuery: "",
  };
}

function renderTreePane(
  overrides: Partial<ComponentProps<typeof TreePane>> = {},
  treeMarks: ClipboardMarks | null = null,
) {
  return render(<TreePane {...treePaneDefaults()} {...overrides} />, {
    wrapper: ({ children }) => (
      <ClipboardMarksProvider value={{ tree: treeMarks, content: null }}>
        {children}
      </ClipboardMarksProvider>
    ),
  });
}

describe("TreePane", () => {
  it("marks the folder that is on the clipboard, and not a favorite that points at it", () => {
    renderTreePane(
      { favorites: [{ path: "/Users/demo/Documents", icon: "documents" }] },
      { paths: new Set(["/Users/demo/Documents"]), mode: "copy", flashing: true },
    );

    const rows = Array.from(document.querySelectorAll<HTMLElement>(".tree-row")).filter((row) =>
      row.textContent?.includes("Documents"),
    );
    const favoriteRow = rows.find((row) => row.dataset.treeKind === "favorite");
    const folderRow = rows.find((row) => row.dataset.treeKind === "filesystem");
    expect(folderRow).toHaveClass("clipboard-marked", "clipboard-flash");
    // The icon follows the name, inside the label.
    const icon = folderRow?.querySelector(".clipboard-mark-icon");
    expect(icon).toHaveAttribute("data-clipboard-mode", "copy");
    expect(icon?.parentElement).toHaveClass("tree-label");
    expect(icon?.previousElementSibling).toHaveClass("tree-label-text");
    expect(favoriteRow).toBeDefined();
    expect(favoriteRow).not.toHaveClass("clipboard-marked");
    expect(favoriteRow?.querySelector(".clipboard-mark-icon")).toBeNull();
  });

  it("marks nothing in the tree when its highlight is switched off", () => {
    renderTreePane();
    expect(document.querySelector(".clipboard-marked, .clipboard-mark-icon")).toBeNull();
  });

  it("renders alias folders as non-expandable", () => {
    renderTreePane({
      nodes: {
        "/Users/demo": {
          path: "/Users/demo",
          name: "demo",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: true,
          loading: false,
          loaded: true,
          error: null,
          childPaths: ["/Users/demo/Alias"],
        },
        "/Users/demo/Alias": {
          path: "/Users/demo/Alias",
          name: "Alias",
          kind: "symlink_directory",
          isHidden: false,
          isSymlink: true,
          expanded: false,
          loading: false,
          loaded: false,
          error: null,
          childPaths: [],
        },
      },
    });

    expect(screen.getAllByText("Alias")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "AliasAlias" })).not.toBeDisabled();
    expect(screen.getAllByLabelText(/expand folder/i).at(-1)).toBeDisabled();
  });

  it("navigates when a filesystem folder row is clicked", () => {
    vi.useFakeTimers();
    const handleNavigate = vi.fn();
    const handleToggleExpand = vi.fn();
    renderTreePane({ onNavigate: handleNavigate, onToggleExpand: handleToggleExpand });

    fireEvent.click(getNamedButton("Documents", 1));
    act(() => {
      vi.runAllTimers();
    });

    expect(handleNavigate).toHaveBeenCalledWith("/Users/demo/Documents");
    expect(handleToggleExpand).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("optionally expands a filesystem folder on single click before navigating", () => {
    vi.useFakeTimers();
    const handleNavigate = vi.fn();
    const handleToggleExpand = vi.fn();
    renderTreePane({
      onNavigate: handleNavigate,
      onToggleExpand: handleToggleExpand,
      singleClickExpandTreeItems: true,
    });

    fireEvent.click(getNamedButton("Documents", 1));
    act(() => {
      vi.runAllTimers();
    });

    expect(handleToggleExpand).toHaveBeenCalledWith("/Users/demo/Documents");
    expect(handleNavigate).toHaveBeenCalledWith("/Users/demo/Documents");
    vi.useRealTimers();
  });

  it("navigates through favorite items separately from the filesystem tree", () => {
    vi.useFakeTimers();
    const handleNavigateFavorite = vi.fn();
    renderTreePane({
      selectedTreeItemId: "favorite:/Users/demo/Documents",
      onNavigateFavorite: handleNavigateFavorite,
    });

    fireEvent.click(getNamedButton("Documents", 0));
    act(() => {
      vi.runAllTimers();
    });

    expect(handleNavigateFavorite).toHaveBeenCalledWith("/Users/demo/Documents");
    vi.useRealTimers();
  });

  it("navigates when a filesystem folder row is double clicked", () => {
    vi.useFakeTimers();
    const handleNavigate = vi.fn();
    const handleToggleExpand = vi.fn();
    renderTreePane({ onNavigate: handleNavigate, onToggleExpand: handleToggleExpand });

    fireEvent.doubleClick(getNamedButton("Documents", 1));
    act(() => {
      vi.runAllTimers();
    });

    expect(handleNavigate).toHaveBeenCalledTimes(1);
    expect(handleNavigate).toHaveBeenCalledWith("/Users/demo/Documents");
    expect(handleToggleExpand).toHaveBeenCalledWith("/Users/demo/Documents");
    vi.useRealTimers();
  });

  it("navigates when a favorite item is double clicked", () => {
    vi.useFakeTimers();
    const handleNavigateFavorite = vi.fn();
    renderTreePane({
      selectedTreeItemId: "favorite:/Users/demo/Documents",
      onNavigateFavorite: handleNavigateFavorite,
    });

    fireEvent.doubleClick(getNamedButton("Documents", 0));
    act(() => {
      vi.runAllTimers();
    });

    expect(handleNavigateFavorite).toHaveBeenCalledTimes(1);
    expect(handleNavigateFavorite).toHaveBeenCalledWith("/Users/demo/Documents");
    vi.useRealTimers();
  });

  it("toggles the favorites section from the expand affordance", () => {
    const handleToggleFavoritesExpanded = vi.fn();
    renderTreePane({ onToggleFavoritesExpanded: handleToggleFavoritesExpanded });

    fireEvent.click(screen.getByLabelText(/collapse favorites/i));

    expect(handleToggleFavoritesExpanded).toHaveBeenCalledTimes(1);
  });

  it("notifies the app when the Favorites root label is selected", () => {
    const handleSelectFavoritesRoot = vi.fn();
    renderTreePane({ onSelectFavoritesRoot: handleSelectFavoritesRoot });

    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));

    expect(handleSelectFavoritesRoot).toHaveBeenCalledTimes(1);
  });

  it("clears tree selection when pressing empty space in the tree pane", () => {
    const handleClearSelection = vi.fn();
    renderTreePane({
      onClearSelection: handleClearSelection,
      selectedTreeItemId: "fs:/Users/demo/Documents",
    });

    const treePane = document.querySelector(".sidebar-tree");
    if (!(treePane instanceof HTMLDivElement)) {
      throw new Error("Missing tree pane container.");
    }

    fireEvent.mouseDown(treePane);

    expect(handleClearSelection).toHaveBeenCalledTimes(1);
  });

  it("clears tree selection when pressing empty space inside the tree scroll area", () => {
    const handleClearSelection = vi.fn();
    renderTreePane({
      onClearSelection: handleClearSelection,
      selectedTreeItemId: "fs:/Users/demo/Documents",
    });

    const scrollArea = document.querySelector(".tree-scroll");
    if (!(scrollArea instanceof HTMLDivElement)) {
      throw new Error("Missing tree scroll area.");
    }

    fireEvent.mouseDown(scrollArea, { clientX: 12, clientY: 12 });

    expect(handleClearSelection).toHaveBeenCalledTimes(1);
  });

  it("does not clear tree selection when pressing the tree scrollbar gutter", () => {
    const handleClearSelection = vi.fn();
    renderTreePane({
      onClearSelection: handleClearSelection,
      selectedTreeItemId: "fs:/Users/demo/Documents",
    });

    const scrollArea = document.querySelector(".tree-scroll");
    if (!(scrollArea instanceof HTMLDivElement)) {
      throw new Error("Missing tree scroll area.");
    }
    Object.defineProperty(scrollArea, "clientWidth", { configurable: true, value: 180 });
    Object.defineProperty(scrollArea, "offsetWidth", { configurable: true, value: 188 });
    Object.defineProperty(scrollArea, "clientHeight", { configurable: true, value: 240 });
    Object.defineProperty(scrollArea, "offsetHeight", { configurable: true, value: 248 });
    vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 188,
      bottom: 248,
      width: 188,
      height: 248,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseDown(scrollArea, { clientX: 186, clientY: 20 });

    expect(handleClearSelection).not.toHaveBeenCalled();
  });

  it("leaves the selection on the folder being shown when a row is right-clicked", () => {
    const handleContextMenu = vi.fn();
    renderTreePane({ onItemContextMenu: handleContextMenu });
    const documents = getNamedButton("Documents", 1);

    fireEvent.pointerDown(documents, { button: 2 });
    fireEvent.contextMenu(documents, { clientX: 40, clientY: 50 });

    expect(handleContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/Users/demo/Documents" }),
      "tree",
      { x: 40, y: 50 },
    );
    expect(getTreeRow(documents)).not.toHaveClass("active");
    expect(getTreeRow(getNamedButton("demo", 0))).toHaveClass("active");
  });

  it("leaves the selection alone on Control-click, which opens the context menu", () => {
    renderTreePane();
    const documents = getNamedButton("Documents", 1);

    fireEvent.pointerDown(documents, { button: 0, ctrlKey: true });

    expect(getTreeRow(documents)).not.toHaveClass("active");
  });

  it("rings the row whose context menu is open, and only that row", () => {
    const target = { path: "/Users/demo/Documents", subview: "tree" as const };
    const { rerender } = renderTreePane({ contextMenuTarget: { ...target, kind: "treeFolder" } });
    const favoriteRow = () => getTreeRow(getNamedButton("Documents", 0));
    const folderRow = () => getTreeRow(getNamedButton("Documents", 1));

    expect(folderRow()).toHaveClass("menu-target");
    expect(favoriteRow()).not.toHaveClass("menu-target");

    rerender(
      <ClipboardMarksProvider value={{ tree: null, content: null }}>
        <TreePane {...treePaneDefaults()} contextMenuTarget={{ ...target, kind: "favorite" }} />
      </ClipboardMarksProvider>,
    );
    expect(favoriteRow()).toHaveClass("menu-target");
    expect(folderRow()).not.toHaveClass("menu-target");

    // The menu closed.
    rerender(
      <ClipboardMarksProvider value={{ tree: null, content: null }}>
        <TreePane {...treePaneDefaults()} contextMenuTarget={null} />
      </ClipboardMarksProvider>,
    );
    expect(document.querySelector(".menu-target")).toBeNull();
  });

  it("selects the row when pressing row whitespace outside the tree controls", () => {
    vi.useFakeTimers();
    const handleClearSelection = vi.fn();
    const handleNavigate = vi.fn();
    renderTreePane({
      onClearSelection: handleClearSelection,
      selectedTreeItemId: "fs:/Users/demo/Documents",
      onNavigate: handleNavigate,
    });

    const row = screen.getAllByRole("button", { name: "Documents" })[1]?.closest(".tree-row");
    if (!(row instanceof HTMLDivElement)) {
      throw new Error("Missing tree row.");
    }

    fireEvent.mouseDown(row);
    fireEvent.click(row);
    act(() => {
      vi.runAllTimers();
    });

    expect(handleClearSelection).not.toHaveBeenCalled();
    expect(handleNavigate).toHaveBeenCalledWith("/Users/demo/Documents");
    vi.useRealTimers();
  });

  it("clears favorites selection when pressing empty space in the separate favorites pane", () => {
    const handleClearSelection = vi.fn();
    renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
      selectedTreeItemId: "favorite:/Users/demo/Documents",
      onClearSelection: handleClearSelection,
    });

    const favoritesPane = document.querySelector(".favorites-pane-section");
    if (!(favoritesPane instanceof HTMLElement)) {
      throw new Error("Missing favorites pane container.");
    }

    fireEvent.mouseDown(favoritesPane);

    expect(handleClearSelection).toHaveBeenCalledTimes(1);
  });

  it("clears favorites selection when pressing empty space inside the favorites list", () => {
    const handleClearSelection = vi.fn();
    renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
      selectedTreeItemId: "favorite:/Users/demo/Documents",
      onClearSelection: handleClearSelection,
    });

    const favoritesList = document.querySelector(".favorites-list");
    if (!(favoritesList instanceof HTMLDivElement)) {
      throw new Error("Missing favorites list.");
    }

    fireEvent.mouseDown(favoritesList, { clientX: 12, clientY: 12 });

    expect(handleClearSelection).toHaveBeenCalledTimes(1);
  });

  it("does not clear favorites selection when pressing the favorites scrollbar gutter", () => {
    const handleClearSelection = vi.fn();
    renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
      selectedTreeItemId: "favorite:/Users/demo/Documents",
      onClearSelection: handleClearSelection,
    });

    const scrollArea = document.querySelector(".sidebar-sections");
    const favoritesPane = document.querySelector(".favorites-pane-section");
    if (!(scrollArea instanceof HTMLDivElement) || !(favoritesPane instanceof HTMLElement)) {
      throw new Error("Missing favorites scroll area.");
    }
    Object.defineProperty(scrollArea, "clientWidth", { configurable: true, value: 180 });
    Object.defineProperty(scrollArea, "offsetWidth", { configurable: true, value: 188 });
    Object.defineProperty(scrollArea, "clientHeight", { configurable: true, value: 240 });
    Object.defineProperty(scrollArea, "offsetHeight", { configurable: true, value: 248 });
    vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 188,
      bottom: 248,
      width: 188,
      height: 248,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.mouseDown(favoritesPane, { clientX: 186, clientY: 20 });

    expect(handleClearSelection).not.toHaveBeenCalled();
  });

  it("marks favorites rows with their tree kind for accent styling", () => {
    renderTreePane({ selectedTreeItemId: "favorites-root" });

    expect(screen.getByRole("button", { name: "Favorites" }).closest(".tree-row")).toHaveAttribute(
      "data-tree-kind",
      "favorites-root",
    );
    expect(
      screen.getAllByRole("button", { name: "Documents" })[0]?.closest(".tree-row"),
    ).toHaveAttribute("data-tree-kind", "favorite");
  });

  it("exposes the ARIA tree pattern on tree containers and rows", () => {
    renderTreePane({ selectedTreeItemId: "favorites-root" });

    expect(screen.getByRole("tree", { name: "Folders" })).toBeInTheDocument();

    const favoritesRoot = screen.getByRole("treeitem", { name: /Favorites/ });
    expect(favoritesRoot).toHaveAttribute("aria-selected", "true");
    expect(favoritesRoot).toHaveAttribute("aria-expanded", "true");
    expect(favoritesRoot).toHaveAttribute("aria-level", "1");

    const desktopFavorite = screen.getByRole("treeitem", { name: /Desktop/ });
    expect(desktopFavorite).toHaveAttribute("aria-selected", "false");
    expect(desktopFavorite).not.toHaveAttribute("aria-expanded");
    expect(desktopFavorite).toHaveAttribute("aria-level", "2");
  });

  it("exposes separate favorites and folders trees when configured", () => {
    renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
    });

    expect(screen.getByRole("tree", { name: "Favorites" })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "Folders" })).toBeInTheDocument();
  });

  it("renders favorites separately from the filesystem tree when configured", () => {
    const { container } = renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
      selectedTreeItemId: "favorite:/Users/demo/Documents",
    });

    expect(container.querySelector('[data-tree-kind="favorites-root"]')).toBeNull();
    expect(screen.getAllByRole("button", { name: "Documents" })).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "Documents" })[0]?.closest(".favorites-pane-section"),
    ).not.toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Documents" })[1]?.closest(".filesystem-tree-section"),
    ).not.toBeNull();
  });

  it("shows Favorites as a labeled section above the folder tree", () => {
    const { container } = renderTreePane({
      favoritesPlacement: "separate",
      favorites: [
        { path: "/Users/demo", icon: "home" },
        { path: "/", icon: "drive" },
        { path: "/Users/demo/Documents", icon: "documents" },
      ],
    });

    const favorites = screen.getByRole("tree", { name: "Favorites" });
    expect(within(favorites).getByText("Documents")).toBeInTheDocument();
    expect(within(favorites).getByText("Macintosh HD")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Locations" })).toBeNull();
    expect(screen.getByText("Folders")).toBeInTheDocument();
    expect(container.querySelector('[data-tree-kind="favorites-root"]')).toBeNull();
  });

  it("shows Favorites as a root row of the folder tree when integrated", () => {
    const { container } = renderTreePane({
      favoritesPlacement: "integrated",
      favorites: [{ path: "/Users/demo/Documents", icon: "documents" }],
    });

    expect(screen.queryByRole("tree", { name: "Favorites" })).toBeNull();
    expect(container.querySelector(".sidebar-section-header")).toBeNull();
    expect(screen.queryByText("Folders")).toBeNull();
    expect(container.querySelector('[data-tree-kind="favorites-root"]')).not.toBeNull();
    expect(container.querySelector('[data-tree-kind="favorite"]')).toHaveTextContent("Documents");
    // Nothing but the favorites and the folders: the sidebar has no buttons of its own.
    expect(
      container.querySelector(".sidebar-shell")?.querySelectorAll("footer, aside"),
    ).toHaveLength(0);
  });

  it("collapses the Favorites section from its header", () => {
    const onToggleFavoritesExpanded = vi.fn();
    renderTreePane({
      favoritesPlacement: "separate",
      favoritesExpanded: false,
      onToggleFavoritesExpanded,
    });

    const favoritesHeader = screen.getByRole("button", { name: /Favorites/ });
    expect(favoritesHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("tree", { name: "Favorites" })).toBeNull();

    fireEvent.click(favoritesHeader);
    expect(onToggleFavoritesExpanded).toHaveBeenCalledTimes(1);
  });

  it("shows the transient typeahead query", () => {
    renderTreePane({ typeaheadQuery: "doc" });

    expect(screen.getByText("Jump to")).toBeInTheDocument();
    expect(screen.getByText("doc")).toBeInTheDocument();
  });

  it("does not scroll the selected row into view when it is already fully visible", () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const scrollIntoViewSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function mockRect(this: HTMLElement) {
        if (this.classList.contains("tree-scroll")) {
          return {
            top: 0,
            bottom: 400,
            left: 0,
            right: 240,
            width: 240,
            height: 400,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        if (this.getAttribute("data-tree-path") === "/Users/demo/Documents") {
          return {
            top: 80,
            bottom: 112,
            left: 0,
            right: 240,
            width: 240,
            height: 32,
            x: 0,
            y: 80,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

    renderTreePane({ selectedTreeItemId: "fs:/Users/demo/Documents" });
    act(() => {
      vi.runAllTimers();
    });

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    getBoundingClientRectSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
    vi.useRealTimers();
  });

  it("scrolls the selected row into view when hidden-file visibility changes move it off screen", () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const scrollIntoViewSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    let selectedRowTop = 80;
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function mockRect(this: HTMLElement) {
        if (this.classList.contains("tree-scroll")) {
          return {
            top: 0,
            bottom: 160,
            left: 0,
            right: 240,
            width: 240,
            height: 160,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        if (this.getAttribute("data-tree-path") === "/Users/demo/Documents") {
          return {
            top: selectedRowTop,
            bottom: selectedRowTop + 32,
            left: 0,
            right: 240,
            width: 240,
            height: 32,
            x: 0,
            y: selectedRowTop,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

    const { rerender } = renderTreePane({
      includeHidden: true,
      selectedTreeItemId: "fs:/Users/demo/Documents",
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    selectedRowTop = -36;
    rerender(
      <TreePane
        isFocused
        rootPath="/Users/demo"
        homePath="/Users/demo"
        selectedTreeItemId="fs:/Users/demo/Documents"
        compactTreeView={false}
        singleClickExpandTreeItems={false}
        favorites={[
          { path: "/Users/demo/Desktop", icon: "desktop" },
          { path: "/Users/demo/Documents", icon: "documents" },
        ]}
        favoritesPlacement="integrated"
        activeLeftPaneSubview="tree"
        favoritesExpanded
        nodes={baseNodes}
        onFocusChange={() => undefined}
        onLeftPaneSubviewChange={() => undefined}
        onClearSelection={() => undefined}
        includeHidden={false}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
        onNavigateFavorite={() => undefined}
        onToggleFavoritesExpanded={() => undefined}
        typeaheadQuery=""
      />,
    );

    act(() => {
      vi.runAllTimers();
    });

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: "nearest" });

    getBoundingClientRectSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
    vi.useRealTimers();
  });

  it("scrolls the selected row into view when that row mounts after selection", () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    const scrollIntoViewSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function mockRect(this: HTMLElement) {
        if (this.classList.contains("tree-scroll")) {
          return {
            top: 0,
            bottom: 160,
            left: 0,
            right: 240,
            width: 240,
            height: 160,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          } as DOMRect;
        }
        if (this.getAttribute("data-tree-path") === "/Users/demo/Documents") {
          return {
            top: 220,
            bottom: 252,
            left: 0,
            right: 240,
            width: 240,
            height: 32,
            x: 0,
            y: 220,
            toJSON: () => ({}),
          } as DOMRect;
        }
        return {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      });

    const { rerender } = renderTreePane({
      selectedTreeItemId: "fs:/Users/demo/Documents",
      nodes: {
        "/Users/demo": {
          path: "/Users/demo",
          name: "demo",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: false,
          loading: false,
          loaded: true,
          error: null,
          childPaths: ["/Users/demo/Documents"],
        },
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          name: "Documents",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: false,
          loading: false,
          loaded: false,
          error: null,
          childPaths: [],
        },
      },
    });

    act(() => {
      vi.runAllTimers();
    });
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    rerender(
      <TreePane
        isFocused
        rootPath="/Users/demo"
        homePath="/Users/demo"
        selectedTreeItemId="fs:/Users/demo/Documents"
        compactTreeView={false}
        singleClickExpandTreeItems={false}
        favorites={[
          { path: "/Users/demo/Desktop", icon: "desktop" },
          { path: "/Users/demo/Documents", icon: "documents" },
        ]}
        favoritesPlacement="integrated"
        activeLeftPaneSubview="tree"
        favoritesExpanded
        nodes={baseNodes}
        onFocusChange={() => undefined}
        onLeftPaneSubviewChange={() => undefined}
        onClearSelection={() => undefined}
        includeHidden={false}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
        onNavigateFavorite={() => undefined}
        onToggleFavoritesExpanded={() => undefined}
        typeaheadQuery=""
      />,
    );

    vi.runAllTimers();
    expect(scrollIntoViewSpy).toHaveBeenCalled();

    getBoundingClientRectSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
    vi.useRealTimers();
  });
});
