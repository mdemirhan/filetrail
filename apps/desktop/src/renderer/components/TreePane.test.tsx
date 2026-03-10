// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";

import { TreePane } from "./TreePane";

const themeButtonRef = createRef<HTMLButtonElement>();
const themeMenuRef = createRef<HTMLDivElement>();

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

function renderTreePane(overrides: Partial<ComponentProps<typeof TreePane>> = {}) {
  return render(
    <TreePane
      isFocused
      rootPath="/Users/demo"
      homePath="/Users/demo"
      selectedTreeItemId="fs:/Users/demo"
      compactTreeView={false}
      singleClickExpandTreeItems={false}
      favorites={[
        { path: "/Users/demo/Desktop", icon: "desktop" },
        { path: "/Users/demo/Documents", icon: "documents" },
      ]}
      favoritesPlacement="integrated"
      favoritesPaneHeight={220}
      activeLeftPaneSubview="tree"
      favoritesExpanded
      nodes={baseNodes}
      onFocusChange={() => undefined}
      onLeftPaneSubviewChange={() => undefined}
      onFavoritesPaneHeightChange={() => undefined}
      onGoHome={() => undefined}
      onRerootHome={() => undefined}
      onOpenLocation={() => undefined}
      onQuickAccess={() => undefined}
      foldersFirst
      onToggleFoldersFirst={() => undefined}
      infoPanelOpen
      onToggleInfoPanel={() => undefined}
      infoRowOpen
      onToggleInfoRow={() => undefined}
      theme="tomorrow-night"
      themeMenuOpen={false}
      themeButtonRef={themeButtonRef}
      themeMenuRef={themeMenuRef}
      onToggleThemeMenu={() => undefined}
      onSelectTheme={() => undefined}
      actionLogEnabled
      onOpenActionLog={() => undefined}
      onClearSelection={() => undefined}
      onOpenHelp={() => undefined}
      onOpenSettings={() => undefined}
      includeHidden={false}
      onToggleHidden={() => undefined}
      onToggleExpand={() => undefined}
      onNavigate={() => undefined}
      onNavigateFavorite={() => undefined}
      onToggleFavoritesExpanded={() => undefined}
      typeaheadQuery=""
      {...overrides}
    />,
  );
}

describe("TreePane", () => {
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

    fireEvent.click(screen.getAllByRole("button", { name: "Documents" })[1]!);
    vi.runAllTimers();

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

    fireEvent.click(screen.getAllByRole("button", { name: "Documents" })[1]!);
    vi.runAllTimers();

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

    fireEvent.click(screen.getAllByRole("button", { name: "Documents" })[0]!);
    vi.runAllTimers();

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
    vi.runAllTimers();

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
    if (!(favoritesPane instanceof HTMLDivElement)) {
      throw new Error("Missing favorites pane container.");
    }

    fireEvent.mouseDown(favoritesPane);

    expect(handleClearSelection).toHaveBeenCalledTimes(1);
  });

  it("clears favorites selection when pressing empty space inside the favorites scroll area", () => {
    const handleClearSelection = vi.fn();
    renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
      selectedTreeItemId: "favorite:/Users/demo/Documents",
      onClearSelection: handleClearSelection,
    });

    const scrollArea = document.querySelector(".favorites-scroll");
    if (!(scrollArea instanceof HTMLDivElement)) {
      throw new Error("Missing favorites scroll area.");
    }

    fireEvent.mouseDown(scrollArea, { clientX: 12, clientY: 12 });

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

    const scrollArea = document.querySelector(".favorites-scroll");
    if (!(scrollArea instanceof HTMLDivElement)) {
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

    fireEvent.mouseDown(scrollArea, { clientX: 186, clientY: 20 });

    expect(handleClearSelection).not.toHaveBeenCalled();
  });

  it("marks favorites rows with their tree kind for accent styling", () => {
    renderTreePane({ selectedTreeItemId: "favorites-root" });

    expect(screen.getByRole("button", { name: "Favorites" }).closest(".tree-row")).toHaveAttribute(
      "data-tree-kind",
      "favorites-root",
    );
    expect(
      screen.getAllByRole("button", { name: "Documents" })[0]!.closest(".tree-row"),
    ).toHaveAttribute("data-tree-kind", "favorite");
  });

  it("renders favorites separately from the filesystem tree when configured", () => {
    renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
      selectedTreeItemId: "favorite:/Users/demo/Documents",
    });

    expect(screen.queryByRole("button", { name: "Favorites" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Documents" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Documents" })[0]!.closest(".favorites-pane-section")).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "Documents" })[1]!.closest(".filesystem-tree-section")).not.toBeNull();
  });

  it("persists divider changes for the separate favorites pane", () => {
    const handleFavoritesPaneHeightChange = vi.fn();
    renderTreePane({
      favoritesPlacement: "separate",
      onFavoritesPaneHeightChange: handleFavoritesPaneHeightChange,
    });

    const splitPane = document.querySelector(".sidebar-split-pane");
    if (!(splitPane instanceof HTMLDivElement)) {
      throw new Error("Missing split pane container.");
    }
    Object.defineProperty(splitPane, "clientHeight", {
      configurable: true,
      value: 500,
    });

    const separator = screen.getByRole("separator", { name: /resize favorites pane/i });
    fireEvent.pointerDown(separator, { clientY: 200 });
    fireEvent.pointerMove(window, { clientY: 240 });
    fireEvent.pointerUp(window);

    expect(handleFavoritesPaneHeightChange).toHaveBeenCalledWith(260);
  });

  it("renders theme options when the rail menu is open", () => {
    renderTreePane({
      theme: "dark",
      themeMenuOpen: true,
      favorites: [],
    });

    expect(screen.getByRole("button", { name: /Dark/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tomorrow Night/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Catppuccin Mocha/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Light/i })).toBeInTheDocument();
  });

  it("shows the transient typeahead query", () => {
    renderTreePane({ typeaheadQuery: "doc" });

    expect(screen.getByText("Jump to")).toBeInTheDocument();
    expect(screen.getByText("doc")).toBeInTheDocument();
  });

  it("opens help from the rail button", () => {
    const handleOpenHelp = vi.fn();
    renderTreePane({ onOpenHelp: handleOpenHelp });

    fireEvent.click(screen.getByRole("button", { name: /open help/i }));
    expect(handleOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("highlights a folder immediately on pointer down before the click timeout", () => {
    vi.useFakeTimers();
    renderTreePane({ selectedTreeItemId: "favorites-root" });

    const row = screen.getAllByRole("button", { name: "Documents" })[1]!;
    const treeRow = row.closest(".tree-row")!;
    expect(treeRow).not.toHaveClass("active");

    fireEvent.pointerDown(row, { button: 0 });

    expect(treeRow).toHaveClass("active");
    vi.useRealTimers();
  });

  it("clears selection on Cmd-click when the clicked tree item is already selected", () => {
    vi.useFakeTimers();
    const handleClearSelection = vi.fn();
    const handleNavigate = vi.fn();
    renderTreePane({
      selectedTreeItemId: "fs:/Users/demo/Documents",
      onClearSelection: handleClearSelection,
      onNavigate: handleNavigate,
    });

    const row = screen.getAllByRole("button", { name: "Documents" })[1]!;
    fireEvent.pointerDown(row, { button: 0, metaKey: true });
    fireEvent.click(row, { metaKey: true });
    vi.runAllTimers();

    expect(handleClearSelection).toHaveBeenCalledTimes(1);
    expect(handleNavigate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("rolls back optimistic highlight when favorite navigation returns false", async () => {
    vi.useFakeTimers();
    let resolveNav!: (value: boolean) => void;
    const handleNavigateFavorite = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveNav = resolve;
        }),
    );

    renderTreePane({
      selectedTreeItemId: "favorites-root",
      onNavigateFavorite: handleNavigateFavorite,
    });

    const row = screen.getAllByRole("button", { name: "Documents" })[0]!;
    const treeRow = row.closest(".tree-row")!;

    fireEvent.pointerDown(row, { button: 0 });
    expect(treeRow).toHaveClass("active");

    fireEvent.click(row);
    vi.runAllTimers();
    expect(handleNavigateFavorite).toHaveBeenCalledWith("/Users/demo/Documents");

    await act(async () => resolveNav(false));

    expect(treeRow).not.toHaveClass("active");
    vi.useRealTimers();
  });

  it("reroots the tree at home from the rail button", () => {
    const handleRerootHome = vi.fn();
    renderTreePane({
      rootPath: "/",
      nodes: {
        "/": {
          path: "/",
          name: "/",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          expanded: true,
          loading: false,
          loaded: true,
          error: null,
          childPaths: [],
        },
      },
      selectedTreeItemId: "fs:/",
      onRerootHome: handleRerootHome,
    });

    fireEvent.click(screen.getByRole("button", { name: /root tree at home/i }));
    expect(handleRerootHome).toHaveBeenCalledTimes(1);
  });

  it("opens a folder context menu for filesystem tree rows", () => {
    const handleItemContextMenu = vi.fn();
    renderTreePane({ onItemContextMenu: handleItemContextMenu });

    fireEvent.contextMenu(screen.getAllByRole("button", { name: "Documents" })[1]!);

    expect(handleItemContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "filesystem",
        path: "/Users/demo/Documents",
      }),
      "tree",
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });

  it("opens a favorite context menu for integrated favorites inside the tree", () => {
    const handleItemContextMenu = vi.fn();
    renderTreePane({ onItemContextMenu: handleItemContextMenu });

    fireEvent.contextMenu(screen.getAllByRole("button", { name: "Documents" })[0]!);

    expect(handleItemContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "favorite",
        path: "/Users/demo/Documents",
      }),
      "tree",
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
  });

  it("opens a favorite context menu in the separate favorites subview", () => {
    const handleItemContextMenu = vi.fn();
    renderTreePane({
      favoritesPlacement: "separate",
      activeLeftPaneSubview: "favorites",
      onItemContextMenu: handleItemContextMenu,
      selectedTreeItemId: "favorite:/Users/demo/Documents",
    });

    fireEvent.contextMenu(screen.getAllByRole("button", { name: "Documents" })[0]!);

    expect(handleItemContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "favorite",
        path: "/Users/demo/Documents",
      }),
      "favorites",
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
    );
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
        if (this.getAttribute("title") === "/Users/demo/Documents") {
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
    vi.runAllTimers();

    expect(scrollIntoViewSpy).not.toHaveBeenCalled();

    getBoundingClientRectSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
    vi.useRealTimers();
  });
});
