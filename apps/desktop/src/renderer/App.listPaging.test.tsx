// @vitest-environment jsdom

// Paging through the file list (⌃D, ⌃U), and the list's scroll position coming back with
// Back.

import { act, fireEvent, screen } from "@testing-library/react";

vi.mock("./components/ContentPane", async () =>
  (await import("./test/appMocks")).contentPaneMock(),
);
vi.mock("./components/TreePane", async () => (await import("./test/appMocks")).treePaneMock());
vi.mock("./components/GetInfoPanel", async () =>
  (await import("./test/appMocks")).getInfoPanelMock(),
);
vi.mock("./components/LocationSheet", async () =>
  (await import("./test/appMocks")).locationSheetMock(),
);
vi.mock("./components/GoToFolderDialog", async () =>
  (await import("./test/appMocks")).goToFolderDialogMock(),
);
vi.mock("./components/ToolbarIcon", async () =>
  (await import("./test/appMocks")).toolbarIconMock(),
);
vi.mock("./hooks/useElementSize", async () =>
  (await import("./test/appMocks")).useElementSizeMock(),
);
vi.mock("./hooks/useExplorerPaneLayout", async () =>
  (await import("./test/appMocks")).useExplorerPaneLayoutMock(),
);
vi.mock("./lib/progressCardDelay", async () =>
  (await import("./test/appMocks")).progressCardDelayMock(),
);

import { getDetailsRowHeight } from "./lib/detailsLayout";
import { getFlowListColumnStep } from "./lib/flowListLayout";
import {
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  focusContentPane,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

const FILES = Array.from({ length: 10 }, (_, index) => `/Users/demo/file-${index}.txt`);

function createHarness(viewMode: "details" | "list" | "icons" = "details") {
  const harness = createAppHarness({ preferences: { viewMode } });
  harness.setDirectoryEntries("/Users/demo", [
    ...FILES.map((path) => createDirectoryEntry(path, "file")),
    createDirectoryEntry("/Users/demo/Folder", "directory"),
  ]);
  return harness;
}

// The list's scroller, sized as the window would lay it out.
function sizeScroller(size: {
  clientHeight?: number;
  scrollHeight?: number;
  clientWidth?: number;
  scrollWidth?: number;
}) {
  const scroller = screen.getByTestId("content-scroll");
  for (const [name, value] of Object.entries({
    scrollTop: 0,
    scrollLeft: 0,
    clientHeight: 0,
    scrollHeight: 0,
    clientWidth: 0,
    scrollWidth: 0,
    ...size,
  })) {
    Object.defineProperty(scroller, name, { configurable: true, writable: true, value });
  }
  return scroller;
}

function selectedPaths(): string[] {
  return Array.from(document.querySelectorAll('[data-selected="true"]'), (element) =>
    element.getAttribute("title"),
  ).filter((title): title is string => title !== null);
}

describe("paging through the file list", () => {
  const rowHeight = getDetailsRowHeight(false);

  it("moves the selection down and up a page of rows in the Details view", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem(FILES[0] as string);
    // Four rows show: a page is three.
    const scroller = sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey({ key: "d", ctrlKey: true });
    expect(selectedPaths()).toEqual([FILES[3]]);
    expect(scroller.scrollTop).toBe(rowHeight * 4);
    await pressKey({ key: "d", ctrlKey: true });
    expect(selectedPaths()).toEqual([FILES[6]]);
    await pressKey({ key: "u", ctrlKey: true });
    await pressKey({ key: "u", ctrlKey: true });
    await pressKey({ key: "u", ctrlKey: true });
    expect(selectedPaths()).toEqual([FILES[0]]);
  });

  it("only scrolls a page when nothing, or several items, are selected", async () => {
    const harness = createHarness();
    renderApp(harness);
    await focusContentPane();
    const scroller = sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey({ key: "d", ctrlKey: true });
    expect(scroller.scrollTop).toBe(rowHeight * 4);
    expect(selectedPaths()).toEqual([]);

    await selectItem(FILES[0] as string);
    await act(async () => {
      fireEvent.click(screen.getByTitle(FILES[1] as string), { metaKey: true });
    });
    await pressKey({ key: "u", ctrlKey: true });
    expect(scroller.scrollTop).toBe(0);
    expect(selectedPaths()).toEqual([FILES[0], FILES[1]]);
  });

  it("does nothing in a list that fits", async () => {
    const harness = createHarness();
    renderApp(harness);
    await focusContentPane();
    const scroller = sizeScroller({ clientHeight: rowHeight * 20, scrollHeight: rowHeight * 11 });

    await pressKey({ key: "d", ctrlKey: true });
    expect(scroller.scrollTop).toBe(0);
  });

  it("moves the selection by whole rows of icons in the Icons view", async () => {
    const harness = createHarness("icons");
    renderApp(harness);
    await selectItem(FILES[0] as string);
    sizeScroller({ clientHeight: 1000, scrollHeight: 4000 });

    await pressKey({ key: "d", ctrlKey: true });
    const [paged] = selectedPaths();
    expect(paged).not.toBe(FILES[0]);
    await pressKey({ key: "u", ctrlKey: true });
    expect(selectedPaths()).toEqual([FILES[0]]);
  });

  it("scrolls the List view a column at a time, or moves the selection by a column", async () => {
    const harness = createHarness("list");
    renderApp(harness);
    await focusContentPane();
    const step = getFlowListColumnStep(false);
    const scroller = sizeScroller({ clientWidth: step * 2, scrollWidth: step * 6 });

    await pressKey({ key: "d", ctrlKey: true });
    expect(scroller.scrollLeft).toBe(step);
    await pressKey({ key: "u", ctrlKey: true });
    expect(scroller.scrollLeft).toBe(0);

    await selectItem(FILES[0] as string);
    await pressKey({ key: "d", ctrlKey: true });
    const [paged] = selectedPaths();
    expect(paged).not.toBe(FILES[0]);
    await pressKey({ key: "u", ctrlKey: true });
    expect(selectedPaths()).toEqual([FILES[0]]);
    // Already at the start: nothing to move to.
    await pressKey({ key: "u", ctrlKey: true });
    expect(selectedPaths()).toEqual([FILES[0]]);
  });
});

describe("the list's place in a folder", () => {
  it("comes back with Back, where it was left", async () => {
    const harness = createHarness();
    renderApp(harness);
    await screen.findByTitle(FILES[0] as string);
    const scroller = sizeScroller({ clientHeight: 100, scrollHeight: 1000 });
    scroller.scrollTop = 240;

    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder"));
    });
    await vi.waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    // The new folder is shown from its top.
    scroller.scrollTop = 0;

    await pressKey({ key: "[", metaKey: true });
    await vi.waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    await vi.waitFor(() => expect(scroller.scrollTop).toBe(240));
  });
});
