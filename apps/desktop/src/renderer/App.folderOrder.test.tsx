// @vitest-environment jsdom

// How the folder on screen is read: its sort, folders first, hidden files, and reading it
// again (⌘R).

import type { IpcRequestInput } from "@filetrail/contracts";
import { act, screen } from "@testing-library/react";

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
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  openSearchResults,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

type Harness = ReturnType<typeof createAppHarness>;

// The search waits for the typing to rest: the clock is moved on instead.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function folderReads(harness: Harness): IpcRequestInput<"directory:getSnapshot">[] {
  return harness.invocations
    .filter((call) => call.channel === "directory:getSnapshot")
    .map((call) => call.payload as IpcRequestInput<"directory:getSnapshot">);
}

function lastFolderRead(harness: Harness) {
  return folderReads(harness).at(-1);
}

async function run(harness: Harness, type: RendererCommand["type"]) {
  await act(async () => {
    harness.emitCommand({ type });
  });
}

async function loaded(harness: Harness) {
  await screen.findByTitle("/Users/demo/source.txt");
  await vi.waitFor(() => expect(folderReads(harness).length).toBeGreaterThan(0));
}

function selectedPaths(): string[] {
  return Array.from(document.querySelectorAll('[data-selected="true"]'), (element) =>
    element.getAttribute("title"),
  ).filter((title): title is string => title !== null);
}

function lastSavedPreferences(harness: Harness) {
  return harness.invocations
    .filter((call) => call.channel === "app:updatePreferences")
    .map((call) => (call.payload as IpcRequestInput<"app:updatePreferences">).preferences)
    .reduce((merged, patch) => Object.assign(merged, patch), {});
}

describe("sorting the folder", () => {
  it("reads the folder again in the order chosen, newest and largest first", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);

    await run(harness, "sortByModified");
    await vi.waitFor(() =>
      expect(lastFolderRead(harness)).toMatchObject({
        path: "/Users/demo",
        sortBy: "modified",
        sortDirection: "desc",
      }),
    );
    await run(harness, "sortBySize");
    await vi.waitFor(() =>
      expect(lastFolderRead(harness)).toMatchObject({ sortBy: "size", sortDirection: "desc" }),
    );
    await run(harness, "sortByKind");
    await vi.waitFor(() =>
      expect(lastFolderRead(harness)).toMatchObject({ sortBy: "kind", sortDirection: "asc" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    // Remembered for the tab, and for the tabs to come.
    const saved = lastSavedPreferences(harness);
    expect(saved.sortBy).toBe("kind");
    expect(saved.openTabs?.[0]).toMatchObject({ sortBy: "kind", sortDirection: "asc" });
  });

  it("turns the order around when the same sort is chosen again", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);

    await run(harness, "sortByName");
    await vi.waitFor(() =>
      expect(lastFolderRead(harness)).toMatchObject({ sortBy: "name", sortDirection: "desc" }),
    );
    await run(harness, "sortByName");
    await vi.waitFor(() =>
      expect(lastFolderRead(harness)).toMatchObject({ sortBy: "name", sortDirection: "asc" }),
    );
    // The folder stays on screen.
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("puts folders among the files, and back first", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);

    await run(harness, "toggleFoldersFirst");
    await vi.waitFor(() => expect(lastFolderRead(harness)).toMatchObject({ foldersFirst: false }));
    await run(harness, "toggleFoldersFirst");
    await vi.waitFor(() => expect(lastFolderRead(harness)).toMatchObject({ foldersFirst: true }));
  });

  it("leaves the folder alone while search results are on screen", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);
    await openSearchResults();
    const reads = folderReads(harness).length;

    await run(harness, "sortByModified");
    await run(harness, "toggleFoldersFirst");

    expect(folderReads(harness)).toHaveLength(reads);
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
  });
});

describe("hidden files", () => {
  it("reads the folder and the tree again with them, and without them", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);

    await pressKey({ key: ".", metaKey: true, shiftKey: true });
    await vi.waitFor(() =>
      expect(lastFolderRead(harness)).toMatchObject({ path: "/Users/demo", includeHidden: true }),
    );
    await vi.waitFor(() =>
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "tree:getChildren" &&
            (call.payload as IpcRequestInput<"tree:getChildren">).includeHidden,
        ),
      ).toBe(true),
    );

    await run(harness, "toggleHiddenFiles");
    await vi.waitFor(() => expect(lastFolderRead(harness)).toMatchObject({ includeHidden: false }));
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("keeps the search results on screen while the folder under them is read again", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);
    await openSearchResults();

    await run(harness, "toggleHiddenFiles");
    await vi.waitFor(() => expect(lastFolderRead(harness)).toMatchObject({ includeHidden: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
  });
});

describe("reading the folder again", () => {
  it("reads it afresh with ⌘R, keeping what is selected", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);
    await selectItem("/Users/demo/source.txt");
    const reads = folderReads(harness).length;
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/new.txt", "file"),
    ]);

    await pressKey({ key: "r", metaKey: true });

    await screen.findByTitle("/Users/demo/new.txt");
    expect(folderReads(harness).length).toBeGreaterThan(reads);
    expect(harness.invocations.some((call) => call.channel === "app:clearCaches")).toBe(true);
    expect(selectedPaths()).toEqual(["/Users/demo/source.txt"]);
  });

  it("still reads the folder when its caches can't be cleared", async () => {
    const harness = createAppHarness({ clearCachesError: new Error("cache busy") });
    renderApp(harness);
    await loaded(harness);
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/new.txt", "file"),
    ]);

    await run(harness, "refreshOrApplySearchSort");

    await screen.findByTitle("/Users/demo/new.txt");
  });

  it("runs the search again instead, while its results are on screen", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);
    await openSearchResults();
    const searches = () =>
      harness.invocations.filter((call) => call.channel === "search:start").length;
    const before = searches();

    await pressKey({ key: "r", metaKey: true });

    await vi.waitFor(() => expect(searches()).toBe(before + 1));
    expect(harness.invocations.some((call) => call.channel === "app:clearCaches")).toBe(false);
  });

  it("doesn't take the place of a folder being opened", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await loaded(harness);
    const release = harness.holdDirectorySnapshot("/Users/demo/Folder");
    await act(async () => {
      screen
        .getByTitle("/Users/demo/Folder")
        .dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    await run(harness, "refreshOrApplySearchSort");
    await vi.waitFor(() =>
      expect(harness.invocations.some((call) => call.channel === "app:clearCaches")).toBe(true),
    );
    await act(async () => {
      release();
    });

    await vi.waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    expect(folderReads(harness).filter((read) => read.path === "/Users/demo")).toHaveLength(1);
  });
});
