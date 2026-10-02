// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./TreePane", () => ({
  TreePane: () => <div data-testid="tree-pane" />,
}));

vi.mock("./SearchWorkspace", () => ({
  SearchWorkspace: () => <div data-testid="search-workspace" />,
}));

vi.mock("./GetInfoPanel", () => ({
  InfoPanel: () => <div data-testid="info-panel" />,
}));

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
      navigateDownAction={() => undefined}
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
        "up",
        "refresh",
        "copySelection",
        "newFolder",
        "copyPath",
        "search",
      ] satisfies ComponentProps<typeof ExplorerWorkspace>["topToolbarItems"],
    };
    view.rerender(explorerWorkspaceElement({ preferencesReady: false, ...savedToolbar }));
    view.rerender(explorerWorkspaceElement({ preferencesReady: true, ...savedToolbar }));

    // A toolbar saved before the title could be moved has it after Back and Forward, and
    // View Options and search closing the row.
    expect(toolbarRowItems(view.container)).toEqual([
      "back",
      "forward",
      "title",
      "up",
      "refresh",
      "copySelection",
      "newFolder",
      "copyPath",
      "viewOptions",
      "search",
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

  it("leaves out the clipboard button with nothing on it and View Options beside the left rail", () => {
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

    const withRail = renderExplorerWorkspace({
      topToolbarItems,
      showSidebarRail: true,
      clipboardButton: <button type="button">Clipboard</button>,
    });
    expect(toolbarRowItems(withRail.container)).toEqual(["back", "title", "clipboard", "search"]);
  });

  it("hides the removable items nearest the end when the row is too narrow for them all", () => {
    // Room for the title and the search field at their narrowest, View Options, and three
    // of the five buttons.
    toolbarRowWidth = 96 + 110 + 4 * TOOLBAR_ITEM_WIDTH + 5 * 4;
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

  it("opens the sort menu and applies a selected sort option", () => {
    const handleSortChange = vi.fn();
    renderExplorerWorkspace({
      topToolbarItems: ["sort", "search"],
      onSortChange: handleSortChange,
    });

    fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Size" }));

    expect(handleSortChange).toHaveBeenCalledWith("size");
  });
});
