// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./TreePane", () => ({
  TreePane: () => <div data-testid="tree-pane" />,
}));

vi.mock("./SearchWorkspace", async () => {
  const { usePaneLayoutChange } = await import("../lib/paneLayoutChange");
  return {
    // Shows how many times the Info panel opened or closed, as the views below see it.
    SearchWorkspace: () => (
      <div data-testid="search-workspace" data-layout-change={usePaneLayoutChange()} />
    ),
  };
});

vi.mock("./GetInfoPanel", () => ({
  InfoPanel: () => <div data-testid="info-panel" />,
}));

import { PANE_LAYOUT_CHANGE_MS } from "../lib/paneLayoutChange";
import { TOP_TOOLBAR_LAYOUT } from "../lib/topToolbarLayout";
import { ExplorerWorkspace } from "./ExplorerWorkspace";

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = globalThis.ResizeObserver;
// The room the toolbar's row has, and how wide each of its buttons is.
const WIDE_TOOLBAR_ROW = 1200;
const TOOLBAR_ITEM_WIDTH = 32;
let toolbarRowWidth = WIDE_TOOLBAR_ROW;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      if (this instanceof HTMLElement && this.classList.contains("toolbar-row")) {
        return toolbarRowWidth;
      }
      return 240;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const width =
      this instanceof HTMLElement && this.classList.contains("toolbar-search-slot")
        ? 220
        : TOOLBAR_ITEM_WIDTH;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 30,
      width,
      height: 30,
      toJSON: () => ({}),
    } as DOMRect;
  };
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as typeof ResizeObserver;
});

afterAll(() => {
  if (originalClientWidth) {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  } else {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      value: undefined,
    });
  }
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  globalThis.ResizeObserver = originalResizeObserver;
});

function explorerWorkspaceElement(
  overrides: Partial<ComponentProps<typeof ExplorerWorkspace>> = {},
) {
  return (
    <ExplorerWorkspace
      preferencesReady
      restoredPaneWidths={null}
      treeWidth={280}
      inspectorWidth={320}
      beginResize={() => () => undefined}
      infoPanelOpen={false}
      treePaneProps={{} as never}
      searchWorkspaceProps={{} as never}
      infoPanelProps={{} as never}
      currentPath="/Users/demo"
      topToolbarItems={["copySelection", "search"]}
      canGoBack={false}
      canGoForward={false}
      focusedPane="content"
      selectedEntryExists
      goBack={() => undefined}
      goForward={() => undefined}
      navigateToParentFolder={() => undefined}
      refreshDirectory={async () => undefined}
      viewMode="list"
      onViewModeChange={() => undefined}
      sortBy="name"
      sortDirection="asc"
      onSortChange={() => undefined}
      searchShellRef={createRef<HTMLDivElement>()}
      searchPopoverOpen={false}
      onSearchShellBlur={() => undefined}
      searchPointerIntentRef={{ current: false }}
      onSearchShellPointerIntent={() => undefined}
      onSearchSubmit={() => undefined}
      searchInputRef={createRef<HTMLInputElement>()}
      searchDraftQuery=""
      onSearchInputFocus={() => undefined}
      onSearchDraftQueryChange={() => undefined}
      onSearchInputEscape={() => undefined}
      onSearchInputArrowDown={() => undefined}
      onClearSearchDraft={() => undefined}
      searchPatternMode="glob"
      onSearchPatternModeChange={() => undefined}
      searchMatchScope="name"
      onSearchMatchScopeChange={() => undefined}
      searchRecursive={false}
      onSearchRecursiveChange={() => undefined}
      searchSkipGitFolders
      onSearchSkipGitFoldersChange={() => undefined}
      searchSkipGitIgnored={false}
      onSearchSkipGitIgnoredChange={() => undefined}
      canRunRendererCommand={() => true}
      onRendererCommand={() => undefined}
      onCustomizeToolbar={() => undefined}
      onPaneResizeKey={() => undefined}
      {...overrides}
    />
  );
}

function renderExplorerWorkspace(
  overrides: Partial<ComponentProps<typeof ExplorerWorkspace>> = {},
) {
  return render(explorerWorkspaceElement(overrides));
}

// The items drawn in the toolbar, in order.
function toolbarRowItems(container: HTMLElement) {
  return Array.from(container.querySelectorAll(".toolbar-row > [data-top-toolbar-item]"), (item) =>
    item.getAttribute("data-top-toolbar-item"),
  );
}

afterEach(() => {
  toolbarRowWidth = WIDE_TOOLBAR_ROW;
});

describe("ExplorerWorkspace", () => {
  it("slides the Info panel in, and tells the views its width changed", () => {
    vi.useFakeTimers();
    const view = renderExplorerWorkspace();
    expect(screen.getByTestId("search-workspace")).toHaveAttribute("data-layout-change", "0");

    view.rerender(explorerWorkspaceElement({ infoPanelOpen: true }));
    const cell = () => view.container.querySelector(".workspace-inspector-cell");
    expect(screen.getByTestId("info-panel")).toBeInTheDocument();
    expect(cell()).toHaveClass("is-sliding-in");
    expect(screen.getByTestId("search-workspace")).toHaveAttribute("data-layout-change", "1");

    act(() => vi.advanceTimersByTime(PANE_LAYOUT_CHANGE_MS));
    expect(cell()).not.toHaveClass("is-sliding-in");
    vi.useRealTimers();
  });

  it("slides a closing Info panel out over the content, out of reach, then removes it", () => {
    vi.useFakeTimers();
    const view = renderExplorerWorkspace({ infoPanelOpen: true });
    view.rerender(explorerWorkspaceElement({ infoPanelOpen: false }));

    // The content has the whole width at once; the panel lies over its right edge.
    const body = view.container.querySelector(".workspace-body") as HTMLElement;
    expect(body.style.gridTemplateColumns).not.toContain("320px");
    const cell = view.container.querySelector(".workspace-inspector-cell") as HTMLElement;
    expect(cell).toHaveClass("is-sliding-out");
    expect(cell).toHaveAttribute("inert");
    expect(cell.style.gridColumn).toBe("3");
    expect(screen.queryByRole("separator", { name: "Resize Info Panel pane" })).toBeNull();
    expect(screen.getByTestId("search-workspace")).toHaveAttribute("data-layout-change", "1");

    act(() => vi.advanceTimersByTime(PANE_LAYOUT_CHANGE_MS));
    expect(screen.queryByTestId("info-panel")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("hides the folder tree, giving its room to the list and the toolbar", () => {
    const onToggleFolderTree = vi.fn();
    const view = renderExplorerWorkspace({
      folderTreeOpen: false,
      onToggleFolderTree,
      topToolbarItems: ["folderTree", "back", "title", "search"],
    });

    expect(view.container.querySelector(".workspace-sidebar-cell")).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize folders pane" })).toBeNull();
    const body = view.container.querySelector(".workspace-body") as HTMLElement;
    expect(body.style.gridTemplateColumns.startsWith("0px 0px")).toBe(true);
    // The toolbar reaches the window's corner, clear of the traffic lights.
    expect(view.container.querySelector(".window-toolbar")).toHaveAttribute(
      "data-under-traffic-lights",
    );

    const button = screen.getByRole("button", { name: "Folder Tree" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("title", "Show Folder Tree (⌃⌘S)");
    fireEvent.click(button);
    expect(onToggleFolderTree).toHaveBeenCalledTimes(1);

    view.rerender(
      explorerWorkspaceElement({
        folderTreeOpen: true,
        topToolbarItems: ["folderTree", "back", "title", "search"],
      }),
    );
    expect(view.container.querySelector(".workspace-sidebar-cell")).not.toBeNull();
    expect(view.container.querySelector(".window-toolbar")).not.toHaveAttribute(
      "data-under-traffic-lights",
    );
  });

  it("doesn't slide a panel that is open when the window is restored", () => {
    const view = renderExplorerWorkspace({ preferencesReady: false });
    view.rerender(explorerWorkspaceElement({ preferencesReady: false, infoPanelOpen: true }));
    view.rerender(explorerWorkspaceElement({ preferencesReady: true, infoPanelOpen: true }));

    expect(screen.getByTestId("info-panel")).toBeInTheDocument();
    expect(view.container.querySelector(".workspace-inspector-cell")).not.toHaveClass(
      "is-sliding-in",
    );
  });

  it("shows every button of a saved toolbar that loads before the toolbar appears", () => {
    // Before preferences are ready the toolbar is not on screen and holds the default items.
    const view = renderExplorerWorkspace({
      preferencesReady: false,
      topToolbarItems: ["back", "forward", "view", "sort", "infoPanel", "search"],
    });
    const savedToolbar = {
      topToolbarItems: [
        "back",
        "forward",
        "title",
        "up",
        "refresh",
        "copySelection",
        "newFolder",
        "copyPath",
        "clipboard",
        "search",
        "viewOptions",
      ] satisfies ComponentProps<typeof ExplorerWorkspace>["topToolbarItems"],
    };
    view.rerender(explorerWorkspaceElement({ preferencesReady: false, ...savedToolbar }));
    view.rerender(explorerWorkspaceElement({ preferencesReady: true, ...savedToolbar }));

    // The clipboard button is drawn only once something is copied.
    expect(toolbarRowItems(view.container)).toEqual([
      "back",
      "forward",
      "title",
      "up",
      "refresh",
      "copySelection",
      "newFolder",
      "copyPath",
      "search",
      "viewOptions",
    ]);
  });

  it("draws the items in their saved order, wherever the fixed ones are put", () => {
    const view = renderExplorerWorkspace({
      topToolbarItems: ["search", "viewOptions", "back", "clipboard", "sort", "title", "view"],
      clipboardButton: <button type="button">Clipboard</button>,
      toolbarTitle: "Documents",
    });

    expect(toolbarRowItems(view.container)).toEqual([
      "search",
      "viewOptions",
      "back",
      "clipboard",
      "sort",
      "title",
      "view",
    ]);
    expect(view.container.querySelector(".toolbar-title")).toHaveTextContent("Documents");
    expect(view.container.querySelectorAll(".toolbar-row .toolbar-search-input")).toHaveLength(1);
  });

  it("leaves out the clipboard button while nothing is on it, and always shows View Options", () => {
    const topToolbarItems = [
      "back",
      "title",
      "clipboard",
      "viewOptions",
      "search",
    ] satisfies ComponentProps<typeof ExplorerWorkspace>["topToolbarItems"];

    const empty = renderExplorerWorkspace({ topToolbarItems });
    expect(toolbarRowItems(empty.container)).toEqual(["back", "title", "viewOptions", "search"]);
    empty.unmount();

    const copied = renderExplorerWorkspace({
      topToolbarItems,
      clipboardButton: <button type="button">Clipboard</button>,
    });
    expect(toolbarRowItems(copied.container)).toEqual([
      "back",
      "title",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("runs the app's own buttons and the file actions as commands", () => {
    const onRendererCommand = vi.fn();
    renderExplorerWorkspace({
      topToolbarItems: [
        "title",
        "newTab",
        "quickLook",
        "showInFinder",
        "settings",
        "help",
        "clipboard",
        "viewOptions",
        "search",
      ],
      // Nothing is selected: Quick Look has nothing to show.
      canRunRendererCommand: (command) => command !== "quickLookSelection",
      onRendererCommand,
    });

    expect(screen.getByRole("button", { name: "Quick Look" })).toBeDisabled();
    for (const name of ["New Tab", "Show in Finder", "Settings", "Help"]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    expect(onRendererCommand.mock.calls.map(([command]) => command)).toEqual([
      "newTab",
      "showInFinder",
      "openSettings",
      "openHelp",
    ]);
    // Each says the command and its key.
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "title",
      "Settings (⌘,)",
    );
    expect(screen.getByRole("button", { name: "Help" })).toHaveAttribute(
      "title",
      "File Trail Help (?)",
    );
  });

  it("chooses Auto, Light or Dark from the Theme button's menu", () => {
    const onSelectTheme = vi.fn();
    renderExplorerWorkspace({
      topToolbarItems: ["title", "theme", "clipboard", "viewOptions", "search"],
      theme: "dark",
      onSelectTheme,
    });

    const button = screen.getByRole("button", { name: "Choose theme" });
    expect(button).toHaveAttribute("title", "Theme: Dark");
    expect(screen.queryByRole("menu", { name: "Theme" })).toBeNull();

    fireEvent.click(button);
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent?.trim())).toEqual([
      "Auto",
      "Light",
      "Dark",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Light" }));

    expect(onSelectTheme).toHaveBeenCalledWith("light");
    expect(screen.queryByRole("menu", { name: "Theme" })).toBeNull();
  });

  it("hides the removable items nearest the end when the row is too narrow for them all", () => {
    // Room for the title and the search field at their narrowest, View Options, and three
    // of the five buttons, with the ends of their two capsules (Back and Forward, and View
    // Options on its own), and the » button that lists the rest, on a capsule of its own.
    toolbarRowWidth =
      TOP_TOOLBAR_LAYOUT.titleMinWidth +
      TOP_TOOLBAR_LAYOUT.searchMinWidth +
      2 * TOP_TOOLBAR_LAYOUT.edgedItemInset +
      4 * (TOP_TOOLBAR_LAYOUT.capsulePadding + TOP_TOOLBAR_LAYOUT.edgedItemInset) +
      4 * TOOLBAR_ITEM_WIDTH +
      5 * TOP_TOOLBAR_LAYOUT.itemGap +
      TOP_TOOLBAR_LAYOUT.itemGap +
      TOP_TOOLBAR_LAYOUT.overflowButtonWidth +
      2 * (TOP_TOOLBAR_LAYOUT.capsulePadding + TOP_TOOLBAR_LAYOUT.edgedItemInset);
    const view = renderExplorerWorkspace({
      topToolbarItems: [
        "back",
        "forward",
        "title",
        "view",
        "sort",
        "infoPanel",
        "clipboard",
        "viewOptions",
        "search",
      ],
    });

    expect(toolbarRowItems(view.container)).toEqual([
      "back",
      "forward",
      "title",
      "view",
      "viewOptions",
      "search",
    ]);
    // The » lists what is left out, worded as in the menu bar.
    fireEvent.click(screen.getByRole("button", { name: "More Toolbar Items" }));
    const menu = screen.getByRole("menu", { name: "More Toolbar Items" });
    expect(
      Array.from(menu.querySelectorAll(".toolbar-menu-label")).map((label) => label.textContent),
    ).toEqual([
      "Sort by Name",
      "Sort by Kind",
      "Sort by Date Modified",
      "Sort by Size",
      "Info Panel",
    ]);
  });

  it("keeps the items that always stay when there is room for nothing else", () => {
    toolbarRowWidth = 120;
    const view = renderExplorerWorkspace({
      topToolbarItems: ["back", "forward", "title", "view", "clipboard", "viewOptions", "search"],
      clipboardButton: <button type="button">Clipboard</button>,
    });

    expect(toolbarRowItems(view.container)).toEqual([
      "title",
      "clipboard",
      "viewOptions",
      "search",
    ]);
  });

  it("disables content-only toolbar commands when content focus is lost", () => {
    renderExplorerWorkspace({
      focusedPane: null,
      canRunRendererCommand: (command) => command !== "copySelection",
    });

    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
  });

  it("keeps content-only toolbar commands enabled when content is focused", () => {
    renderExplorerWorkspace({
      focusedPane: "content",
      canRunRendererCommand: () => true,
    });

    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
  });

  it("lists the view options with their keys, and the way to customize the toolbar", () => {
    const onCustomizeToolbar = vi.fn();
    renderExplorerWorkspace({ onCustomizeToolbar });

    fireEvent.click(screen.getByRole("button", { name: "View Options" }));
    const menu = screen.getByRole("menu", { name: "View Options" });
    const rows = Array.from(menu.querySelectorAll(".toolbar-menu-item"), (row) => [
      row.querySelector(".toolbar-menu-label")?.textContent,
      row.querySelector(".toolbar-menu-shortcut")?.textContent ?? null,
    ]);
    expect(rows).toEqual([
      // Folders First has no key until one is chosen in Settings.
      ["Folders First", null],
      ["Hidden Files", "⇧⌘."],
      ["Info Panel", "⌘I"],
      ["Info Row", "⇧⌘I"],
      ["Customize Toolbar…", null],
    ]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Customize Toolbar…" }));
    expect(onCustomizeToolbar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "View Options" })).toBeNull();
  });

  it("opens the sort menu and applies a selected sort option", () => {
    const handleSortChange = vi.fn();
    renderExplorerWorkspace({
      topToolbarItems: ["sort", "search"],
      onSortChange: handleSortChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Sort By" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Size" }));

    expect(handleSortChange).toHaveBeenCalledWith("size");
  });
});

describe("ExplorerWorkspace customizing the toolbar", () => {
  const DEFAULT_ITEMS = [
    "folderTree",
    "topSeparator",
    "back",
    "forward",
    "title",
    "clipboard",
    "view",
    "sort",
    "search",
    "viewOptions",
    "infoPanel",
  ] as const;

  function renderCustomizing(overrides: Partial<ComponentProps<typeof ExplorerWorkspace>> = {}) {
    const onTopToolbarItemsChange = vi.fn();
    const onFinishCustomizingToolbar = vi.fn();
    const view = renderExplorerWorkspace({
      topToolbarItems: [...DEFAULT_ITEMS],
      customizingToolbar: true,
      onTopToolbarItemsChange,
      onFinishCustomizingToolbar,
      ...overrides,
    });
    return { ...view, onTopToolbarItemsChange, onFinishCustomizingToolbar };
  }

  it("edits the toolbar in place: the row does nothing, the rest of the window waits", () => {
    const { container } = renderCustomizing();

    expect(container.querySelector(".toolbar-row")).toHaveAttribute("inert");
    expect(container.querySelector(".workspace-main-cell")).toHaveAttribute("inert");
    expect(container.querySelector(".toolbar-customize-scrim")).not.toBeNull();
    expect(screen.getByRole("dialog", { name: "Drag items into the toolbar" })).toBeVisible();
    // The clipboard button shows, faint, so that it can be moved with nothing copied.
    expect(container.querySelector(".toolbar-clipboard-stand-in")).not.toBeNull();
    // A handle over every item, the four that always stay included.
    expect(
      Array.from(container.querySelectorAll<HTMLElement>("[data-toolbar-handle]"), (handle) =>
        handle.getAttribute("data-toolbar-handle"),
      ),
    ).toEqual([...DEFAULT_ITEMS]);
  });

  it("offers what the toolbar does not hold, and the space", () => {
    renderCustomizing();

    expect(screen.getByRole("button", { name: "Add Space to the toolbar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Refresh to the toolbar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Sort to the toolbar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Search to the toolbar" })).toBeNull();
  });

  it("adds a clicked item at the far right", () => {
    const { onTopToolbarItemsChange } = renderCustomizing();

    fireEvent.click(screen.getByRole("button", { name: "Add New Folder to the toolbar" }));

    expect(onTopToolbarItemsChange).toHaveBeenCalledWith([...DEFAULT_ITEMS, "newFolder"]);
  });

  it("moves an item with ⌥← and ⌥→, and takes it off with Delete, from the keyboard", () => {
    const { container, onTopToolbarItemsChange } = renderCustomizing();
    const handle = (key: string) =>
      container.querySelector<HTMLElement>(`[data-toolbar-handle="${key}"]`) as HTMLElement;

    fireEvent.keyDown(handle("sort"), { key: "ArrowRight", altKey: true });
    expect(onTopToolbarItemsChange).toHaveBeenLastCalledWith([
      "folderTree",
      "topSeparator",
      "back",
      "forward",
      "title",
      "clipboard",
      "view",
      "search",
      "sort",
      "viewOptions",
      "infoPanel",
    ]);

    fireEvent.keyDown(handle("sort"), { key: "Delete" });
    expect(onTopToolbarItemsChange).toHaveBeenLastCalledWith(
      DEFAULT_ITEMS.filter((itemId) => itemId !== "sort"),
    );

    // The four that always stay are not taken off.
    onTopToolbarItemsChange.mockClear();
    fireEvent.keyDown(handle("search"), { key: "Backspace" });
    expect(onTopToolbarItemsChange).not.toHaveBeenCalled();
  });

  it("puts back the default toolbar, and ends with Done or Escape", () => {
    const { onFinishCustomizingToolbar, unmount } = renderCustomizing();
    expect(screen.getByRole("button", { name: "Restore Defaults" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFinishCustomizingToolbar).toHaveBeenCalledTimes(2);
    unmount();

    const { onTopToolbarItemsChange } = renderCustomizing({
      topToolbarItems: ["title", "clipboard", "search", "viewOptions"],
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore Defaults" }));
    expect(onTopToolbarItemsChange).toHaveBeenCalledWith([...DEFAULT_ITEMS]);
  });

  it("offers Customize Toolbar… on a right-click of the title, not of a button", () => {
    const onCustomizeToolbar = vi.fn();
    const { container } = renderExplorerWorkspace({
      topToolbarItems: [...DEFAULT_ITEMS],
      onCustomizeToolbar,
    });

    fireEvent.contextMenu(screen.getByRole("button", { name: "Sort By" }));
    expect(screen.queryByRole("menu", { name: "Toolbar" })).toBeNull();

    fireEvent.contextMenu(container.querySelector(".toolbar-title") as HTMLElement);
    fireEvent.click(screen.getByRole("menuitem", { name: "Customize Toolbar…" }));
    expect(onCustomizeToolbar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Toolbar" })).toBeNull();
  });
});
