// @vitest-environment jsdom

// Paging through the file list (half a page with ⌃D and ⌃U, a page with Page Down and Page
// Up), and the list's scroll position coming back with Back.

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
import { getFlowListColumnStep, getFlowListLayout } from "./lib/flowListLayout";
import { getIconGridLayout } from "./lib/iconGridLayout";
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

function createHarness(
  viewMode: "details" | "list" | "icons" = "details",
  shortcutOverrides: Record<string, string[]> = {},
) {
  const harness = createAppHarness({ preferences: { viewMode, shortcutOverrides } });
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

// The keys, as the window gets them.
const HALF_DOWN = { key: "d", ctrlKey: true };
const HALF_UP = { key: "u", ctrlKey: true };
const PAGE_DOWN = { key: "PageDown" };
const PAGE_UP = { key: "PageUp" };

describe("paging through the file list", () => {
  const rowHeight = getDetailsRowHeight(false);

  it("moves the selection half a page or a page in the List view, and the rows with it", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem(FILES[0] as string);
    // Four rows show: half a page is two rows, a page is three.
    const scroller = sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey(HALF_DOWN);
    expect(selectedPaths()).toEqual([FILES[2]]);
    expect(scroller.scrollTop).toBe(rowHeight * 2);
    await pressKey(PAGE_DOWN);
    expect(selectedPaths()).toEqual([FILES[5]]);
    expect(scroller.scrollTop).toBe(rowHeight * 5);
    await pressKey(PAGE_UP);
    expect(selectedPaths()).toEqual([FILES[2]]);
    expect(scroller.scrollTop).toBe(rowHeight * 2);
    await pressKey(HALF_UP);
    expect(selectedPaths()).toEqual([FILES[0]]);
    expect(scroller.scrollTop).toBe(0);
    // Already at the top: nothing to move to.
    await pressKey(HALF_UP);
    expect(selectedPaths()).toEqual([FILES[0]]);
  });

  it("scrolls only as far as the list goes, while the selection goes on", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem(FILES[6] as string);
    const scroller = sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });
    scroller.scrollTop = rowHeight * 6;

    await pressKey(PAGE_DOWN);
    expect(selectedPaths()).toEqual([FILES[9]]);
    expect(scroller.scrollTop).toBe(rowHeight * 7);
  });

  it("starts from the first item when nothing is selected", async () => {
    const harness = createHarness();
    renderApp(harness);
    await focusContentPane();
    const scroller = sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey(PAGE_DOWN);
    expect(selectedPaths()).toHaveLength(1);
    expect(scroller.scrollTop).toBe(0);
  });

  it("moves on from the last item clicked when several are selected, keeping one", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem(FILES[0] as string);
    await act(async () => {
      fireEvent.click(screen.getByTitle(FILES[1] as string), { metaKey: true });
    });
    sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey(HALF_DOWN);
    expect(selectedPaths()).toEqual([FILES[3]]);
  });

  it("extends the selection with ⇧ and any of the page keys", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem(FILES[0] as string);
    const scroller = sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey({ ...PAGE_DOWN, shiftKey: true });
    expect(selectedPaths()).toEqual(FILES.slice(0, 4));
    expect(scroller.scrollTop).toBe(rowHeight * 3);
    await pressKey({ key: "D", ctrlKey: true, shiftKey: true });
    expect(selectedPaths()).toEqual(FILES.slice(0, 6));
    await pressKey({ key: "U", ctrlKey: true, shiftKey: true });
    expect(selectedPaths()).toEqual(FILES.slice(0, 4));
  });

  it("keeps the rows still when they all fit", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem(FILES[0] as string);
    const scroller = sizeScroller({ clientHeight: rowHeight * 20, scrollHeight: rowHeight * 11 });

    await pressKey(HALF_DOWN);
    expect(selectedPaths()).not.toEqual([FILES[0]]);
    expect(scroller.scrollTop).toBe(0);
  });

  it("moves by whole rows of icons in the Icons view", async () => {
    const harness = createHarness("icons");
    renderApp(harness);
    await selectItem(FILES[0] as string);
    // Five rows show (one icon to a row here): half a page is two rows, a page is four.
    const iconRowHeight = getIconGridLayout(false).rowHeight;
    const scroller = sizeScroller({
      clientHeight: iconRowHeight * 5,
      scrollHeight: iconRowHeight * 11,
    });

    await pressKey(HALF_DOWN);
    expect(selectedPaths()).toEqual([FILES[2]]);
    expect(scroller.scrollTop).toBe(iconRowHeight * 2);
    await pressKey(PAGE_DOWN);
    expect(selectedPaths()).toEqual([FILES[6]]);
    expect(scroller.scrollTop).toBe(iconRowHeight * 6);
    await pressKey(PAGE_UP);
    await pressKey(HALF_UP);
    expect(selectedPaths()).toEqual([FILES[0]]);
    expect(scroller.scrollTop).toBe(0);
  });

  it("moves by whole columns in the Compact List, scrolling sideways", async () => {
    const harness = createHarness("list");
    renderApp(harness);
    await selectItem(FILES[0] as string);
    // Four columns show (one item to a column here): half a page is two, a page is three.
    const step = getFlowListColumnStep(false);
    const { paddingInline, columnGap } = getFlowListLayout(false);
    const scroller = sizeScroller({
      clientWidth: step * 4 + paddingInline * 2 - columnGap,
      scrollWidth: step * 12,
    });

    await pressKey(HALF_DOWN);
    expect(selectedPaths()).toEqual([FILES[2]]);
    expect(scroller.scrollLeft).toBe(step * 2);
    await pressKey(PAGE_DOWN);
    expect(selectedPaths()).toEqual([FILES[5]]);
    expect(scroller.scrollLeft).toBe(step * 5);
    await pressKey(PAGE_UP);
    await pressKey(HALF_UP);
    expect(selectedPaths()).toEqual([FILES[0]]);
    expect(scroller.scrollLeft).toBe(0);
  });

  it("takes the keys given in Settings", async () => {
    const harness = createHarness("details", { halfPageDown: ["Ctrl+J"], pageDown: ["F6"] });
    renderApp(harness);
    await selectItem(FILES[0] as string);
    sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey(HALF_DOWN);
    await pressKey(PAGE_DOWN);
    expect(selectedPaths()).toEqual([FILES[0]]);
    await pressKey({ key: "j", ctrlKey: true });
    expect(selectedPaths()).toEqual([FILES[2]]);
    await pressKey({ key: "F6" });
    expect(selectedPaths()).toEqual([FILES[5]]);
    await pressKey({ key: "F6", shiftKey: true });
    expect(selectedPaths()).toEqual(FILES.slice(5, 9));
  });

  it("leaves ⇧ with a page key to the command that has it", async () => {
    const harness = createHarness("details", { focusTreePane: ["Shift+PageDown"] });
    renderApp(harness);
    await selectItem(FILES[0] as string);
    sizeScroller({ clientHeight: rowHeight * 4, scrollHeight: rowHeight * 11 });

    await pressKey({ ...PAGE_DOWN, shiftKey: true });
    expect(selectedPaths()).toEqual([FILES[0]]);
    expect(screen.getByTestId("content-focused")).toHaveTextContent("false");
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
