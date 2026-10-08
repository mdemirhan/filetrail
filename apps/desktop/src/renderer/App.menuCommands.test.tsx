// @vitest-environment jsdom

// Menu bar commands, as the main process sends them, on what is selected or on screen.

import type { IpcRequestInput } from "@filetrail/contracts";
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

import {
  type RendererCommand,
  clearContentSelection,
  clipboardButton,
  createAppHarness,
  expectNoRefusedRequests,
  focusTreePane,
  openSearchResults,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof createAppHarness>;

async function run(harness: Harness, type: RendererCommand["type"]) {
  await act(async () => {
    harness.emitCommand({ type });
  });
}

function payloadsOf<C extends Parameters<Harness["client"]["invoke"]>[0]>(
  harness: Harness,
  channel: C,
): IpcRequestInput<C>[] {
  return harness.invocations
    .filter((call) => call.channel === channel)
    .map((call) => call.payload as IpcRequestInput<C>);
}

async function savedPreferences(harness: Harness) {
  // The window saves its preferences a moment after they change.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  return payloadsOf(harness, "app:updatePreferences").reduce(
    (merged, { preferences }) => Object.assign(merged, preferences),
    {} as IpcRequestInput<"app:updatePreferences">["preferences"],
  );
}

const tabLabels = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);

describe("menu bar commands", () => {
  it("zoom in and out a step at a time, within bounds, and back to actual size", async () => {
    const harness = createAppHarness({ preferences: { zoomPercent: 140 } });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await run(harness, "zoomIn");
    await run(harness, "zoomIn");
    expect((await savedPreferences(harness)).zoomPercent).toBe(150);
    await run(harness, "zoomOut");
    expect((await savedPreferences(harness)).zoomPercent).toBe(140);
    await run(harness, "resetZoom");
    expect((await savedPreferences(harness)).zoomPercent).toBe(100);
  });

  it("hide and show the folder tree, and bring it back for Focus Folder Tree", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTestId("tree-pane");

    await run(harness, "toggleFolderTree");
    expect(screen.queryByTestId("tree-pane")).toBeNull();
    await run(harness, "focusTreePane");
    await vi.waitFor(() => expect(screen.getByTestId("tree-focused")).toHaveTextContent("true"));
  });

  it("open Terminal at the folder on screen when nothing is selected", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await clearContentSelection();

    await run(harness, "openInTerminal");

    await vi.waitFor(() =>
      expect(payloadsOf(harness, "system:openInTerminal")).toEqual([{ path: "/Users/demo" }]),
    );
  });

  it("show the selected items in Finder, and Quick Look the one selected", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await run(harness, "showInFinder");
    await run(harness, "quickLookSelection");

    await vi.waitFor(() => {
      expect(payloadsOf(harness, "system:openPathsWithApplication")).toEqual([
        {
          applicationPath: "/System/Library/CoreServices/Finder.app",
          paths: ["/Users/demo/source.txt"],
        },
      ]);
      expect(payloadsOf(harness, "system:quickLook")).toEqual([{ path: "/Users/demo/source.txt" }]);
    });
  });

  it("cut the selection and paste it, from the Edit menu's file commands", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await run(harness, "cutSelection");
    expect(clipboardButton()).not.toBeNull();
    await selectItem("/Users/demo/Folder");
    await run(harness, "pasteSelection");

    await vi.waitFor(() =>
      expect(payloadsOf(harness, "copyPaste:analyzeStart").at(-1)).toMatchObject({
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo",
      }),
    );
  });

  it("add the selected folder to Favorites, and take it away again", async () => {
    const harness = createAppHarness({
      preferences: { favoritesInitialized: true, favorites: [] },
    });
    renderApp(harness);
    await selectItem("/Users/demo/Folder");

    await run(harness, "toggleFavorite");
    expect(await screen.findByTitle("favorite:/Users/demo/Folder")).toBeInTheDocument();
    await run(harness, "toggleFavorite");
    expect(screen.queryByTitle("favorite:/Users/demo/Folder")).toBeNull();
  });

  it("open the selected folder in a new tab, and close and reopen the tab", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/Folder");

    await run(harness, "openSelectionInNewTab");
    await vi.waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));
    await run(harness, "selectPreviousTab");
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");

    await run(harness, "selectNextTab");
    await run(harness, "closeTab");
    expect(tabLabels()).toEqual([]);
    await run(harness, "reopenClosedTab");
    await vi.waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));
  });

  it("open a new window, and the selected folder in one", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/Folder");

    await run(harness, "newWindow");
    await run(harness, "openSelectionInNewWindow");

    await vi.waitFor(() => expect(payloadsOf(harness, "app:openWindow")).toHaveLength(2));
    expect(JSON.stringify(payloadsOf(harness, "app:openWindow")[1])).toContain(
      "/Users/demo/Folder",
    );
  });

  it("bring the last search results back", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await openSearchResults();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await vi.waitFor(() => expect(screen.queryByTestId("search-results-pane")).toBeNull());

    await run(harness, "showLastSearchResults");

    expect(await screen.findByTestId("search-results-pane")).toBeInTheDocument();
  });

  it("put the search field's caret in place for Find", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await focusTreePane();

    await run(harness, "focusFileSearch");

    await vi.waitFor(() => expect(screen.getByPlaceholderText("Search")).toHaveFocus());
  });

  it("open Settings and Help in their windows", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await run(harness, "openSettings");
    await run(harness, "openHelp");

    await vi.waitFor(() => {
      expect(payloadsOf(harness, "app:openSettingsWindow")).toHaveLength(1);
      expect(payloadsOf(harness, "app:openHelpWindow")).toEqual([{}]);
    });
  });
});
