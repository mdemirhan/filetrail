// @vitest-environment jsdom

// Tabs, keyboard shortcuts and the harness itself.

import type { IpcRequestInput, WriteOperationProgressEvent } from "@filetrail/contracts";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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

import { App } from "./App";
import { FiletrailClientProvider } from "./lib/filetrailClient";
import {
  type TestProgressEvent,
  clearContentSelection,
  clipboardButton,
  createAppHarness,
  createDirectoryEntry,
  dragBetween,
  expectNoRefusedRequests,
  finishedResultEvent,
  focusTreePane,
  openDirectory,
  openSearchResults,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

describe("App tabs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const tabLabels = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);
  const activeTabLabel = () =>
    screen.queryAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")
      ?.textContent;

  async function renderApp(harness: ReturnType<typeof createAppHarness>) {
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByRole("button", { name: "source.txt" });
  }

  async function pressKey(init: KeyboardEventInit) {
    await act(async () => {
      fireEvent.keyDown(window, init);
    });
  }

  it("shows no tab strip with a single view, and one once a second tab opens", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    await pressKey({ key: "t", metaKey: true });

    expect(tabLabels()).toEqual(["demo", "demo"]);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");

    await pressKey({ key: "w", metaKey: true });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("closes the window with Cmd+W when a single view is left", async () => {
    const harness = createAppHarness();
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => undefined);
    await renderApp(harness);

    await pressKey({ key: "w", metaKey: true });

    expect(closeWindow).toHaveBeenCalledTimes(1);
    closeWindow.mockRestore();
  });

  it("gives each tab its own folder, selection and history", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "t", metaKey: true });
    // The new tab starts on the same folder with nothing selected and nowhere to go back to.
    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "false");
    await openDirectory("/Users/demo/Folder");
    expect(tabLabels()).toEqual(["demo", "Folder"]);

    await pressKey({ key: "Tab", ctrlKey: true });

    expect(activeTabLabel()).toBe("demo");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    expect(await screen.findByTitle("/Users/demo/source.txt")).toHaveAttribute(
      "data-selected",
      "true",
    );

    await pressKey({ key: "Tab", ctrlKey: true, shiftKey: true });

    expect(activeTabLabel()).toBe("Folder");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    // Back leads to the folder the tab was opened on.
    await pressKey({ key: "[", metaKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    expect(tabLabels()).toEqual(["demo", "demo"]);
  });

  it("gives the keyboard back to the pane each tab had it in", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    const focusedPane = () =>
      screen.getByTestId("tree-focused").textContent === "true"
        ? "tree"
        : screen.getByTestId("content-focused").textContent === "true"
          ? "content"
          : null;
    // The first tab is left with the keyboard in the folder tree, the second in the list.
    await focusTreePane();
    await pressKey({ key: "t", metaKey: true });
    await selectItem("/Users/demo/source.txt");
    expect(focusedPane()).toBe("content");

    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(focusedPane()).toBe("tree"));

    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(focusedPane()).toBe("content"));
  });

  it("keeps a navigation that is still filling in the tree out of a tab opened meanwhile", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/Folder/Deep", "directory")],
        },
        "/Users/demo/Folder/Deep": {
          path: "/Users/demo/Folder/Deep",
          parentPath: "/Users/demo/Folder",
          entries: [],
        },
      },
      holdTreeChildrenFor: "/Users/demo/Folder",
    });
    await renderApp(harness);
    const currentPath = () => screen.getByTestId("content-current-path").textContent;
    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder"));
    });
    await waitFor(() => expect(currentPath()).toBe("/Users/demo/Folder"));

    // The folder is on screen; the tree is still waiting for the folders above it.
    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder/Deep"));
    });
    await waitFor(() => expect(currentPath()).toBe("/Users/demo/Folder/Deep"));
    await pressKey({ key: "t", metaKey: true });
    await act(async () => {
      harness.releaseTreeChildren();
    });

    // The new tab has no history of its own to go back through.
    expect(tabLabels()).toEqual(["Deep", "Deep"]);
    await pressKey({ key: "[", metaKey: true });
    expect(currentPath()).toBe("/Users/demo/Folder/Deep");

    // The tab that navigated kept its history: Back leads to the folder it came from.
    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(activeTabLabel()).toBe("Deep"));
    await pressKey({ key: "[", metaKey: true });
    await waitFor(() => expect(currentPath()).toBe("/Users/demo/Folder"));
  });

  it("reads a tab's folder again when the tab comes back on screen", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");

    // Something else changes the first tab's folder while it is in the background.
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/arrived.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);
    });

    expect(await screen.findByTitle("/Users/demo/arrived.txt")).toBeInTheDocument();
  });

  it("keeps hidden files and Folders First for each tab", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    const folderReads = () =>
      harness.invocations
        .filter((call) => call.channel === "directory:getSnapshot")
        .map((call) => call.payload as IpcRequestInput<"directory:getSnapshot">);
    const treeReads = () =>
      harness.invocations
        .filter((call) => call.channel === "tree:getChildren")
        .map((call) => call.payload as IpcRequestInput<"tree:getChildren">);

    // The second tab shows hidden files; the first tab never did.
    await pressKey({ key: ".", metaKey: true, shiftKey: true });
    await waitFor(() =>
      expect(folderReads().at(-1)).toMatchObject({
        path: "/Users/demo/Folder",
        includeHidden: true,
      }),
    );
    const foldersBefore = folderReads().length;
    const treesBefore = treeReads().length;
    await pressKey({ key: "Tab", ctrlKey: true });

    await waitFor(() =>
      expect(folderReads().slice(foldersBefore)).toContainEqual(
        expect.objectContaining({ path: "/Users/demo", includeHidden: false }),
      ),
    );
    expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/);
    // Its tree was read without hidden files, and is not read again with them.
    expect(
      treeReads()
        .slice(treesBefore)
        .some((request) => request.includeHidden),
    ).toBe(false);

    // Back in the second tab, hidden files show again.
    const foldersAfter = folderReads().length;
    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() =>
      expect(folderReads().slice(foldersAfter)).toContainEqual(
        expect.objectContaining({ path: "/Users/demo/Folder", includeHidden: true }),
      ),
    );
  });

  it("starts a new tab with the hidden files and Folders First of the tab it came from", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: ".", metaKey: true, shiftKey: true });
    await waitFor(() =>
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "directory:getSnapshot" &&
            (call.payload as IpcRequestInput<"directory:getSnapshot">).includeHidden,
        ),
      ).toBe(true),
    );

    await pressKey({ key: "t", metaKey: true });
    const reads = harness.invocations.length;
    await openDirectory("/Users/demo/Folder");

    expect(
      harness.invocations
        .slice(reads)
        .filter((call) => call.channel === "directory:getSnapshot")
        .at(-1)?.payload,
    ).toMatchObject({ path: "/Users/demo/Folder", includeHidden: true, foldersFirst: true });
  });

  it("opens the nearest folder that still exists when a tab's folder is gone", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await openDirectory("/Users/demo/Folder");
    await pressKey({ key: "t", metaKey: true });
    await pressKey({ key: "ArrowUp", metaKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    expect(tabLabels()).toEqual(["Folder", "demo"]);

    // The first tab's folder is removed while the tab is in the background.
    harness.removeDirectory("/Users/demo/Folder");
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
    ]);
    await pressKey({ key: "Tab", ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    expect(tabLabels()).toEqual(["demo", "demo"]);
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("pastes into one tab what was copied in another", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    expect(clipboardButton()).toBeNull();
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });

    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    // The copied item is in the other tab; the toolbar still says it is there to paste.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    await clearContentSelection();
    await pressKey({ key: "v", metaKey: true });

    await waitFor(() =>
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
      }),
    );
  });

  it("shows a running operation in every tab and selects what arrived only where it started", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    // Two tabs on the same folder; the paste is started in the second.
    await pressKey({ key: "t", metaKey: true });
    await clearContentSelection();
    await pressKey({ key: "v", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await pressKey({ key: "Tab", ctrlKey: true });

    expect(activeTabLabel()).toBe("Folder");
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();

    harness.setDirectoryEntries("/Users/demo/Folder", [
      createDirectoryEntry("/Users/demo/Folder/source.txt", "file"),
    ]);
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("copy", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });

    // The tab on screen shows what arrived, but its selection is left alone.
    expect(await screen.findByTitle("/Users/demo/Folder/source.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
  });

  it("keeps a tab's search while another tab is in front", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await openSearchResults();
    await waitFor(() => expect(screen.getByTestId("search-results-pane")).toBeInTheDocument());

    await pressKey({ key: "t", metaKey: true });

    // The new tab shows the folder, with an empty search field.
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("");
    expect(tabLabels()).toEqual(["“source” in demo", "demo"]);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);
    });

    expect(await screen.findByTestId("search-results-pane")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("source");
    expect(harness.invocations.filter((call) => call.channel === "search:cancel")).toHaveLength(0);
  });

  it("notices when a search finishes in a background tab, and has its results on return", async () => {
    // Background searches are asked about once a second: the test moves the clock on.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let finished = false;
    const harness = createAppHarness({
      searchJobs: () =>
        finished ? { names: ["source.txt", "sonar.txt"] } : { names: [], running: true },
    });
    await renderApp(harness);
    await openSearchResults();
    await pressKey({ key: "t", metaKey: true });
    const searchingTabs = () => document.querySelectorAll(".tab-strip-search.searching").length;
    expect(tabLabels()).toEqual(["“source” in demo", "demo"]);
    expect(searchingTabs()).toBe(1);
    const updatesBefore = harness.invocations.filter(
      (call) => call.channel === "search:getUpdate",
    ).length;

    // The search ends while its tab is in the background.
    finished = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    await waitFor(() => expect(searchingTabs()).toBe(0));

    // Once it has ended there is nothing left to ask about.
    const updatesWhenDone = harness.invocations.filter(
      (call) => call.channel === "search:getUpdate",
    ).length;
    expect(updatesWhenDone).toBeGreaterThan(updatesBefore);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(harness.invocations.filter((call) => call.channel === "search:getUpdate")).toHaveLength(
      updatesWhenDone,
    );

    await pressKey({ key: "Tab", ctrlKey: true });
    await waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));
    expect(harness.invocations.filter((call) => call.channel === "search:start")).toHaveLength(1);
  });

  it("searches again when the last answer of a search was lost by leaving its tab", async () => {
    const harness = createAppHarness({
      searchJobs: () => ({ names: ["source.txt", "sonar.txt"] }),
      holdSearchUpdates: true,
    });
    await renderApp(harness);
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "so" } });
      fireEvent.submit(searchInput.closest("form") as HTMLFormElement);
    });
    await waitFor(() =>
      expect(harness.invocations.map((call) => call.channel)).toContain("search:getUpdate"),
    );

    // The tab is left while the answer that carries the results is on its way. The worker
    // has let go of them by the time the tab is back.
    await act(async () => {
      harness.emitCommand({ type: "newTab" });
    });
    await act(async () => {
      harness.releaseSearchUpdates();
    });
    await act(async () => {
      harness.emitCommand({ type: "selectNextTab" });
    });

    await waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));
    expect(harness.invocations.filter((call) => call.channel === "search:start")).toHaveLength(2);
  });

  it("searches for what was being typed when the tab was left, once the tab is back", async () => {
    // The search waits for the typing to rest: the test moves the clock on.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const harness = createAppHarness({
      searchJobs: () => ({ names: ["source.txt"] }),
    });
    await renderApp(harness);
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "sou" } });
    });

    // Another tab is opened before the keyboard has rested: nothing is searched there.
    await act(async () => {
      harness.emitCommand({ type: "newTab" });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(searchQueries()).toEqual([]);

    await act(async () => {
      harness.emitCommand({ type: "selectNextTab" });
    });
    expect(searchInput.value).toBe("sou");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    await waitFor(() => expect(searchQueries()).toEqual(["sou"]));
  });

  it("closes a background tab from its close button and keeps the tab on screen", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close demo" }));
    });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
  });

  const savedTab = (path: string) => ({
    path,
    treeRootPath: "/Users/demo",
    favoritePath: null,
    viewMode: "details" as const,
    searchViewMode: "details" as const,
    sortBy: "name" as const,
    sortDirection: "asc" as const,
    includeHidden: false,
    foldersFirst: true,
  });

  it("reopens the tabs that were open, reading each folder when its tab is shown", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Folder")],
        activeTabIndex: 0,
      },
    });
    await renderApp(harness);

    expect(tabLabels()).toEqual(["demo", "Folder"]);
    expect(activeTabLabel()).toBe("demo");
    // The tab in the background has not been read.
    const snapshotRequests = () =>
      harness.invocations
        .filter((call) => call.channel === "directory:getSnapshot")
        .map((call) => (call.payload as { path: string }).path);
    expect(snapshotRequests()).not.toContain("/Users/demo/Folder");

    await pressKey({ key: "Tab", ctrlKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    expect(snapshotRequests()).toContain("/Users/demo/Folder");
    // Restoring a tab is not a visit for the Go To box.
    expect(
      harness.invocations.filter((call) => call.channel === "places:recordVisit"),
    ).toHaveLength(0);
  });

  it("keeps the tab on screen until the window has read its first folder", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Folder")],
        activeTabIndex: 0,
      },
      holdTreeChildrenFor: "/Users/demo",
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await waitFor(() =>
      expect(harness.invocations.map((call) => call.channel)).toContain("tree:getChildren"),
    );

    // The startup is still filling in the first tab: the shortcut does nothing yet.
    await pressKey({ key: "Tab", ctrlKey: true });
    await act(async () => {
      harness.releaseTreeChildren();
    });

    await screen.findByRole("button", { name: "source.txt" });
    expect(activeTabLabel()).toBe("demo");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/);
    await pressKey({ key: "Tab", ctrlKey: true });
    expect(activeTabLabel()).toBe("Folder");
  });

  it("drops a restored tab whose folder no longer exists", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Gone")],
        activeTabIndex: 0,
      },
      itemPropertiesByPath: { "/Users/demo/Gone": "missing" },
    });
    await renderApp(harness);

    await waitFor(() => expect(screen.queryByRole("tablist")).not.toBeInTheDocument());
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("opens a single view at home when the last session is not reopened", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: false,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Folder")],
        activeTabIndex: 1,
      },
    });
    await renderApp(harness);

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("hands the open tabs over to be saved", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");

    await waitFor(() => {
      const saved: Record<string, unknown> = Object.assign(
        {},
        ...harness.invocations
          .filter((call) => call.channel === "app:updatePreferences")
          .map((call) => (call.payload as { preferences: Record<string, unknown> }).preferences),
      );
      expect(saved.activeTabIndex).toBe(1);
      expect(saved.openTabs).toEqual([
        { ...savedTab("/Users/demo") },
        { ...savedTab("/Users/demo/Folder") },
      ]);
    });
  });

  it("opens a folder in a new tab with Cmd-double-click and from its menu", async () => {
    const harness = createAppHarness();
    await renderApp(harness);

    // Tabs carry their folder as a tooltip too, so the folder is looked up in the list.
    const listItem = (path: string) => within(screen.getByTestId("content-pane")).getByTitle(path);
    await act(async () => {
      fireEvent.doubleClick(listItem("/Users/demo/Folder"), { metaKey: true });
    });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    expect(tabLabels()).toEqual(["demo", "Folder"]);
    expect(activeTabLabel()).toBe("Folder");

    // Back in the first tab, the folder's menu offers the same; a file's menu does not.
    await pressKey({ key: "Tab", ctrlKey: true });
    // A folder opened in a new tab is a visit like one opened in place: left again at
    // once, it was only passed through.
    expect(
      harness.invocations.findLast((call) => call.channel === "places:recordVisit")?.payload,
    ).toEqual({ path: "/Users/demo/Folder", kind: "passThrough" });
    await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.contextMenu(listItem("/Users/demo/source.txt"));
    });
    expect(screen.queryByRole("button", { name: "Open in New Tab" })).not.toBeInTheDocument();
    await pressKey({ key: "Escape" });
    await act(async () => {
      fireEvent.contextMenu(listItem("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Open in New Tab" }));
    });

    await waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder", "Folder"]));
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });

  it("reopens the tab that was closed last, at its folder", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    await pressKey({ key: "w", metaKey: true });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    await pressKey({ key: "T", metaKey: true, shiftKey: true });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    expect(tabLabels()).toEqual(["demo", "Folder"]);
    expect(activeTabLabel()).toBe("Folder");
    // There is nothing more to bring back.
    await pressKey({ key: "T", metaKey: true, shiftKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("closes the other tabs and duplicates a tab from the tab's menu", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    const openTabMenu = async (index: number) => {
      await act(async () => {
        fireEvent.contextMenu(screen.getAllByRole("tab")[index] as HTMLElement);
      });
    };

    await openTabMenu(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate Tab" }));
    });

    // The copy sits next to the tab it was made from and is on screen.
    await waitFor(() => expect(tabLabels()).toEqual(["demo", "demo", "Folder"]));
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );

    await openTabMenu(2);
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Close Other Tabs" }));
    });

    await waitFor(() => expect(screen.queryByRole("tablist")).not.toBeInTheDocument());
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
  });

  it("moves what is dropped on a tab into that tab's folder", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    await pressKey({ key: "Tab", ctrlKey: true });
    const source = await within(screen.getByTestId("content-pane")).findByTitle(
      "/Users/demo/source.txt",
    );
    const [ownTab, folderTab] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];

    // The tab of the folder the item is already in does not take it.
    await dragBetween(source, ownTab);
    expect(harness.invocations.map((call) => call.channel)).not.toContain("copyPaste:analyzeStart");

    await dragBetween(source, folderTab);

    await waitFor(() =>
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
      }),
    );
  });

  it("leaves the tab on screen alone while a dialog is open", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await pressKey({ key: "t", metaKey: true });
    await act(async () => {
      harness.emitCommand({ type: "openLocationSheet" });
    });

    await act(async () => {
      harness.emitCommand({ type: "selectNextTab" });
      harness.emitCommand({ type: "newTab" });
      harness.emitCommand({ type: "closeTab" });
    });

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getAllByRole("tab")[1]).toHaveAttribute("aria-selected", "true");
  });
});

describe("App keyboard shortcuts", () => {
  async function renderApp(harness: ReturnType<typeof createAppHarness>) {
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByRole("button", { name: "source.txt" });
  }

  async function pressKey(init: KeyboardEventInit, target: Window | Element = window) {
    await act(async () => {
      fireEvent.keyDown(target, init);
    });
  }

  it("runs a command on the key it was given in Settings, and no longer on the old one", async () => {
    const harness = createAppHarness({
      preferences: { shortcutOverrides: { newTab: ["Cmd+Option+N"] } },
    });
    await renderApp(harness);

    await pressKey({ key: "t", metaKey: true });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    await pressKey({ key: "˜", code: "KeyN", metaKey: true, altKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // The button that does the same names the new key.
    expect(screen.getByRole("button", { name: "New Tab" })).toHaveAttribute(
      "title",
      "New Tab (⌥⌘N)",
    );
    expect(screen.getAllByTitle("Close Tab (⌘W)").length).toBe(2);
  });

  it("runs a command on a key given in Settings, and one on its alternate key", async () => {
    const harness = createAppHarness({
      preferences: {
        shortcutOverrides: { viewAsIcons: ["Cmd+4"], viewAsList: ["Cmd+J", "F6"] },
      },
    });
    await renderApp(harness);
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");

    await pressKey({ key: "4", metaKey: true });
    expect(screen.getByRole("button", { name: "View as Icons" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "View as Icons" })).toHaveAttribute(
      "title",
      "View as Icons (⌘4)",
    );

    await pressKey({ key: "F6" });
    expect(screen.getByRole("button", { name: "View as Compact List" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");
  });

  it("gives a reassigned key to its new command only", async () => {
    const harness = createAppHarness({
      preferences: {
        shortcutOverrides: { newFolder: ["Cmd+Shift+N", "Cmd+D"], duplicateSelection: [] },
      },
    });
    await renderApp(harness);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "source.txt" }));
    });

    await pressKey({ key: "d", metaKey: true });

    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(true);
    });
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "copyPaste:analyzeStart" &&
          (call.payload as IpcRequestInput<"copyPaste:analyzeStart">).action === "duplicate",
      ),
    ).toBe(false);
  });

  it("opens Help on the key it was given, and no longer on ?", async () => {
    const harness = createAppHarness({
      preferences: { shortcutOverrides: { openHelp: ["F1"] } },
    });
    await renderApp(harness);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "source.txt" }));
    });

    const helpOpened = () =>
      harness.invocations.filter((call) => call.channel === "app:openHelpWindow").length;
    await pressKey({ key: "?", shiftKey: true });
    expect(helpOpened()).toBe(0);

    await pressKey({ key: "F1" });
    expect(helpOpened()).toBe(1);
  });

  it("leaves a caret key to a text field when the menu hears it too", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    const opened = () =>
      harness.invocations.filter(
        (call) =>
          call.channel === "directory:getSnapshot" &&
          (call.payload as IpcRequestInput<"directory:getSnapshot">).path === "/Users",
      ).length;
    const searchField = screen.getByPlaceholderText("Search");
    await act(async () => {
      searchField.focus();
    });

    // ⌘↑ moves the caret; the menu's Enclosing Folder, sent for the same key press, waits.
    await pressKey({ key: "ArrowUp", metaKey: true }, searchField);
    await act(async () => {
      harness.emitCommand({ type: "goEnclosingFolder" });
    });
    expect(opened()).toBe(0);

    // Chosen from the menu with the pointer, it goes up.
    await pressKey({ key: "Shift", shiftKey: true }, searchField);
    await act(async () => {
      harness.emitCommand({ type: "goEnclosingFolder" });
    });
    await waitFor(() => expect(opened()).toBeGreaterThan(0));
  });
});

describe("App test harness", () => {
  it("routes write and copy-paste progress to their matching listeners only", () => {
    const harness = createAppHarness();
    const handleWriteProgress = vi.fn<(event: WriteOperationProgressEvent) => void>();
    const handleCopyPasteProgress = vi.fn<(event: WriteOperationProgressEvent) => void>();

    harness.client.onWriteOperationProgress(handleWriteProgress);
    harness.client.onCopyPasteProgress(handleCopyPasteProgress);

    harness.emitProgress({
      operationId: "copy-op-1",
      mode: "copy",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 5,
      totalBytes: 5,
      currentSourcePath: "/Users/demo/source.txt",
      currentDestinationPath: "/Users/demo/Folder/source.txt",
      result: null,
    } satisfies TestProgressEvent);

    expect(handleCopyPasteProgress).toHaveBeenCalledTimes(1);
    expect(handleWriteProgress).toHaveBeenCalledTimes(1);

    harness.emitProgress({
      operationId: "write-op-rename",
      action: "rename",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: "/Users/demo/source.txt",
      currentDestinationPath: "/Users/demo/renamed.txt",
      result: null,
    } satisfies WriteOperationProgressEvent);

    expect(handleWriteProgress).toHaveBeenCalledTimes(2);
    expect(handleCopyPasteProgress).toHaveBeenCalledTimes(1);
  });
});
