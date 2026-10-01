// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./TreePane", () => ({
  TreePane: () => <div data-testid="tree-pane" />,
}));

vi.mock("./SearchWorkspace", () => ({
  SearchWorkspace: () => <div data-testid="search-workspace" />,
}));

vi.mock("./GetInfoPanel", () => ({
  InfoPanel: () => <div data-testid="info-panel" />,
}));

import {
  ExplorerWorkspace,
  normalizeTopToolbarItems,
  resolveVisibleTopToolbarCount,
} from "./ExplorerWorkspace";

const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      if (this instanceof HTMLElement && this.classList.contains("titlebar-actions-main")) {
        return 640;
      }
      return 240;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const width =
      this instanceof HTMLElement && this.hasAttribute("data-top-toolbar-item")
        ? 32
        : this instanceof HTMLElement && this.classList.contains("toolbar-search-slot")
          ? 220
          : 32;
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
      toolbarRef={createRef<HTMLElement>()}
      treePaneProps={{} as never}
      searchWorkspaceProps={{} as never}
      infoPanelProps={{} as never}
      currentPath="/Users/demo"
      topToolbarItems={["copySelection", "search"]}
      explorerToolbarLayout="full"
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

describe("resolveVisibleTopToolbarCount", () => {
  it("keeps all items when the available width fits the whole strip", () => {
    expect(resolveVisibleTopToolbarCount([32, 32, 32, 70], 178)).toBe(4);
  });

  it("drops trailing items when the strip runs out of width", () => {
    expect(resolveVisibleTopToolbarCount([32, 32, 70, 32], 141)).toBe(2);
  });

  it("keeps the whole strip when its items have not been laid out", () => {
    expect(resolveVisibleTopToolbarCount([0, 0, 0], 0)).toBe(3);
    expect(resolveVisibleTopToolbarCount([32, 0, 32], 40)).toBe(3);
  });

  it("returns zero when there is no available width", () => {
    expect(resolveVisibleTopToolbarCount([32, 32, 32], 0)).toBe(0);
  });
});

describe("normalizeTopToolbarItems", () => {
  it("removes leading, trailing, and repeated separators", () => {
    expect(
      normalizeTopToolbarItems([
        "topSeparator",
        "back",
        "topSeparator",
        "topSeparator",
        "forward",
        "topSeparator",
      ]),
    ).toEqual(["back", "topSeparator", "forward"]);
  });
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

    const visibleItems = Array.from(
      view.container.querySelectorAll(".titlebar-actions-main [data-top-toolbar-item]"),
      (item) => item.getAttribute("data-top-toolbar-item"),
    );
    expect(visibleItems).toEqual(["up", "refresh", "copySelection", "newFolder", "copyPath"]);
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
