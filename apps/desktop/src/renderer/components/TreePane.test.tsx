// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";

import {
  DEFAULT_LEFT_TOOLBAR_ITEMS,
  type LeftToolbarItems,
  getToolbarItemsForLeftZone,
} from "../../shared/toolbarItems";
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
      activeLeftPaneSubview="tree"
      favoritesExpanded
      nodes={baseNodes}
      onFocusChange={() => undefined}
      onLeftPaneSubviewChange={() => undefined}
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
      leftToolbarItems={
        {
          main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
          utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
        } satisfies LeftToolbarItems
      }
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
      canRunRendererCommand={() => true}
      onRendererCommand={() => undefined}
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
      showRail: false,
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
    expect(container.querySelector(".sidebar-rail")).toBeNull();
    expect(container.querySelector('[data-tree-kind="favorites-root"]')).toBeNull();
  });

  it("shows Favorites as a root row of the folder tree when integrated", () => {
    const { container } = renderTreePane({
      showRail: false,
      favoritesPlacement: "integrated",
      favorites: [{ path: "/Users/demo/Documents", icon: "documents" }],
    });

    expect(screen.queryByRole("tree", { name: "Favorites" })).toBeNull();
    expect(container.querySelector(".sidebar-section-header")).toBeNull();
    expect(screen.queryByText("Folders")).toBeNull();
    expect(container.querySelector('[data-tree-kind="favorites-root"]')).not.toBeNull();
    expect(container.querySelector('[data-tree-kind="favorite"]')).toHaveTextContent("Documents");
    expect(container.querySelector(".sidebar-bottom-rail")).not.toBeNull();
  });

  it("collapses the Favorites section from its header", () => {
    const onToggleFavoritesExpanded = vi.fn();
    renderTreePane({
      showRail: false,
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

  it("renders theme options when the rail menu is open", () => {
    renderTreePane({
      showRail: true,
      theme: "dark",
      themeMenuOpen: true,
      favorites: [],
    });

    const darkThemeButton = screen.getByRole("button", { name: /^Dark/ });
    expect(darkThemeButton.closest(".sidebar-rail-menu-portal")?.parentElement).toBe(document.body);
    expect(screen.getByRole("button", { name: /^macOS Dark/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tomorrow Night/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Catppuccin Mocha/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Light/ })).toBeInTheDocument();
  });

  it("uses the rail theme button as a menu trigger", () => {
    const handleToggleThemeMenu = vi.fn();
    renderTreePane({ onToggleThemeMenu: handleToggleThemeMenu });

    fireEvent.click(screen.getByRole("button", { name: "Choose theme" }));

    expect(handleToggleThemeMenu).toHaveBeenCalledTimes(1);
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

  it("renders the configured utility items in the bottom rail", () => {
    const handleRendererCommand = vi.fn();
    const { container } = renderTreePane({
      leftToolbarItems: {
        main: ["home"],
        utility: ["leftSeparator", "newFolder", "duplicateSelection", "settings"],
      } as never,
      onRendererCommand: handleRendererCommand,
    });

    const bottomRail = container.querySelector(".sidebar-bottom-rail");
    if (!(bottomRail instanceof HTMLElement)) {
      throw new Error("Missing bottom rail.");
    }
    expect(
      within(bottomRail)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["New Folder", "Duplicate", "Open settings"]);
    expect(bottomRail.querySelector(".sidebar-rail-separator")).not.toBeNull();
    // The left rail is off, so its "main" items are not on screen.
    expect(container.querySelector(".sidebar-rail")).toBeNull();
    expect(screen.queryByRole("button", { name: "Quick access Home" })).toBeNull();

    fireEvent.click(within(bottomRail).getByRole("button", { name: "Duplicate" }));

    expect(handleRendererCommand).toHaveBeenCalledWith("duplicateSelection");
  });

  it("shows either rail, both or neither around the same sidebar", () => {
    const railCases = [
      { showRail: false, showBottomRail: false },
      { showRail: true, showBottomRail: false },
      { showRail: false, showBottomRail: true },
      { showRail: true, showBottomRail: true },
    ];
    for (const { showRail, showBottomRail } of railCases) {
      const { container, unmount } = renderTreePane({
        showRail,
        showBottomRail,
        favoritesPlacement: "separate",
      });

      expect(container.querySelector(".sidebar-rail") !== null).toBe(showRail);
      expect(container.querySelector(".sidebar-bottom-rail") !== null).toBe(showBottomRail);
      // The sidebar itself never changes: labeled Favorites section over the folder tree.
      expect(container.querySelector(".sidebar-main-native")).not.toBeNull();
      expect(container.querySelector(".sidebar-section-header")).not.toBeNull();
      expect(screen.getByRole("tree", { name: "Favorites" })).toBeInTheDocument();
      expect(screen.getByRole("tree", { name: "Folders" })).toBeInTheDocument();
      // Settings is reachable from whichever rail is showing.
      expect(screen.queryAllByRole("button", { name: "Open settings" })).toHaveLength(
        showRail || showBottomRail ? 1 : 0,
      );
      unmount();
    }
  });

  it("docks the utility items at the foot of the left rail when the bottom rail is off", () => {
    const { container } = renderTreePane({ showRail: true, showBottomRail: false });

    const leftRail = container.querySelector(".sidebar-rail");
    if (!(leftRail instanceof HTMLElement)) {
      throw new Error("Missing left rail.");
    }
    expect(within(leftRail).getByRole("button", { name: "Quick access Home" })).toBeInTheDocument();
    const utilityGroup = leftRail.querySelector(".sidebar-rail-group-utility");
    if (!(utilityGroup instanceof HTMLElement)) {
      throw new Error("Missing utility group.");
    }
    expect(within(utilityGroup).getByRole("button", { name: "Open help" })).toBeInTheDocument();
    expect(within(utilityGroup).getByRole("button", { name: "Open settings" })).toBeInTheDocument();
  });

  it("keeps the main items in the left rail and the utility items in the bottom rail", () => {
    const { container } = renderTreePane({ showRail: true, showBottomRail: true });

    const leftRail = container.querySelector(".sidebar-rail");
    const bottomRail = container.querySelector(".sidebar-bottom-rail");
    if (!(leftRail instanceof HTMLElement) || !(bottomRail instanceof HTMLElement)) {
      throw new Error("Missing rail.");
    }
    expect(within(leftRail).getByRole("button", { name: "Quick access Home" })).toBeInTheDocument();
    expect(within(leftRail).queryByRole("button", { name: "Open help" })).toBeNull();
    expect(leftRail.querySelector(".sidebar-rail-group-utility")).toBeNull();
    expect(within(bottomRail).getByRole("button", { name: "Open help" })).toBeInTheDocument();
    expect(within(bottomRail).getByRole("button", { name: "Choose theme" })).toBeInTheDocument();
  });

  it("renders a control for every item that can be added to a rail", () => {
    for (const zone of ["main", "utility"] as const) {
      const itemIds = getToolbarItemsForLeftZone(zone)
        .map((item) => item.id)
        .filter((itemId) => itemId !== "leftSeparator" && itemId !== "settings");
      const { container, unmount } = renderTreePane({
        showRail: true,
        showBottomRail: true,
        leftToolbarItems:
          zone === "main"
            ? { main: itemIds, utility: ["settings"] }
            : { main: [], utility: [...itemIds, "settings"] },
      });

      const rail = container.querySelector(
        zone === "main" ? ".sidebar-rail" : ".sidebar-bottom-rail",
      );
      if (!(rail instanceof HTMLElement)) {
        throw new Error("Missing rail.");
      }
      const expectedCount = zone === "main" ? itemIds.length : itemIds.length + 1;
      expect(within(rail).getAllByRole("button")).toHaveLength(expectedCount);
      unmount();
    }
  });

  it("leaves the action log button out while the action log is turned off", () => {
    renderTreePane({ actionLogEnabled: false });

    expect(screen.queryByRole("button", { name: "Open action log" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open help" })).toBeInTheDocument();
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
        leftToolbarItems={{
          main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
          utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
        }}
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
        canRunRendererCommand={() => true}
        onRendererCommand={() => undefined}
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
        leftToolbarItems={{
          main: [...DEFAULT_LEFT_TOOLBAR_ITEMS.main],
          utility: [...DEFAULT_LEFT_TOOLBAR_ITEMS.utility],
        }}
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
        canRunRendererCommand={() => true}
        onRendererCommand={() => undefined}
      />,
    );

    vi.runAllTimers();
    expect(scrollIntoViewSpy).toHaveBeenCalled();

    getBoundingClientRectSpy.mockRestore();
    scrollIntoViewSpy.mockRestore();
    vi.useRealTimers();
  });
});
