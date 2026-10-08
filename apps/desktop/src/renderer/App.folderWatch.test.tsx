// @vitest-environment jsdom

// Changes made outside the app to the folder on screen.

import { act, fireEvent, screen, waitFor } from "@testing-library/react";

// How many times the file list has been drawn, and the items it was last given.
const contentPaneDraws = vi.hoisted(() => ({
  count: 0,
  entries: [] as ReadonlyArray<{ path: string }>,
}));
vi.mock("./components/ContentPane", async () => {
  const { ContentPane } = (await import("./test/appMocks")).contentPaneMock();
  return {
    ContentPane: (props: Parameters<typeof ContentPane>[0]) => {
      contentPaneDraws.count += 1;
      contentPaneDraws.entries = props.entries;
      return ContentPane(props);
    },
  };
});
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
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  openDirectory,
  openSearchResults,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

const ARRIVED = createDirectoryEntry("/Users/demo/arrived.txt", "file");

function withArrived(harness: ReturnType<typeof createAppHarness>) {
  harness.setDirectoryEntries("/Users/demo", [
    createDirectoryEntry("/Users/demo/source.txt", "file"),
    ARRIVED,
    createDirectoryEntry("/Users/demo/Folder", "directory"),
  ]);
}

async function emitArrived(harness: ReturnType<typeof createAppHarness>) {
  await act(async () => {
    harness.emitFolderChange({ path: "/Users/demo", changedPaths: [ARRIVED.path] });
  });
}

function folderReads(harness: ReturnType<typeof createAppHarness>, path: string): number {
  return harness.invocations.filter(
    (call) =>
      call.channel === "directory:getSnapshot" && (call.payload as { path: string }).path === path,
  ).length;
}

// Moves the clock on, so what a finished read sets off (opening another folder, the Info
// panel asking after its pause) runs to its end.
async function settle(ms = 20) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const TRASH = "/Users/demo/.Trash";
const TRASH_REFUSED = `EPERM: operation not permitted, scandir '${TRASH}'`;

describe("App folder watch", () => {
  it("watches the folder on screen, following the window from folder to folder", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await waitFor(() => expect(harness.watchedPath()).toBe("/Users/demo"));

    await openDirectory("/Users/demo/Folder");
    await waitFor(() => expect(harness.watchedPath()).toBe("/Users/demo/Folder"));
  });

  it("shows an item made outside the app, keeping the selection and leaving the tree alone", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    const treeReads = () =>
      harness.invocations.filter((call) => call.channel === "tree:getChildren").length;
    const treeReadsBefore = treeReads();

    withArrived(harness);
    await emitArrived(harness);

    expect(await screen.findByTitle("/Users/demo/arrived.txt")).toBeInTheDocument();
    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    expect(treeReads()).toBe(treeReadsBefore);
  });

  it("ignores a change to a folder no longer on screen", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await openDirectory("/Users/demo/Folder");
    const folderReads = () =>
      harness.invocations.filter((call) => call.channel === "directory:getSnapshot").length;
    const readsBefore = folderReads();

    await emitArrived(harness);

    expect(folderReads()).toBe(readsBefore);
  });

  it("waits while a rename is being typed, and shows the change once it ends", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "F2" });
    const renameInput = await screen.findByLabelText("Rename source.txt");

    withArrived(harness);
    await emitArrived(harness);
    expect(screen.queryByTitle("/Users/demo/arrived.txt")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(renameInput, { key: "Escape" });
    });
    expect(await screen.findByTitle("/Users/demo/arrived.txt")).toBeInTheDocument();
  });

  it("keeps search results on screen", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await openSearchResults();
    const resultsBefore = screen.getByTestId("search-results-pane").textContent;

    withArrived(harness);
    await emitArrived(harness);

    await waitFor(() =>
      expect(
        harness.invocations.filter((call) => call.channel === "directory:getSnapshot").length,
      ).toBeGreaterThan(1),
    );
    expect(screen.getByTestId("search-results-pane").textContent).toBe(resultsBefore);
  });

  it("opens the nearest folder above when the folder on screen is removed", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await openDirectory("/Users/demo/Folder");

    harness.removeDirectory("/Users/demo/Folder");
    await act(async () => {
      harness.emitFolderChange({ path: "/Users/demo/Folder", changedPaths: null });
    });

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
    );
    await waitFor(() => expect(harness.watchedPath()).toBe("/Users/demo"));
  });

  it("stays on a folder it can't read when it changes, as the Trash without Full Disk Access", async () => {
    const harness = createAppHarness();
    harness.refuseDirectory(TRASH, TRASH_REFUSED);
    renderApp(harness);
    const trashRow = await screen.findByTitle(`location:${TRASH}`);
    await act(async () => {
      fireEvent.click(trashRow);
    });
    await waitFor(() => expect(screen.getByTestId("content-error")).toHaveTextContent("EPERM"));
    await waitFor(() => expect(harness.watchedPath()).toBe(TRASH));

    // Something is put in the Trash in Finder.
    await act(async () => {
      harness.emitFolderChange({ path: TRASH, changedPaths: [`${TRASH}/old.txt`] });
    });
    await waitFor(() => expect(folderReads(harness, TRASH)).toBe(2));
    await settle();

    expect(screen.getByTestId("content-current-path")).toHaveTextContent(TRASH);
    expect(screen.getByTestId("content-error")).toHaveTextContent(TRASH_REFUSED);
    expect(harness.watchedPath()).toBe(TRASH);
    expect(folderReads(harness, "/Users/demo")).toBe(1);
  });

  it("doesn't draw the list again when the folder read again lists the same items", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");
    await settle();
    const drawsBefore = contentPaneDraws.count;

    // A file in the folder is written to (a download, a log), and nothing else changes.
    await act(async () => {
      harness.emitFolderChange({ path: "/Users/demo", changedPaths: ["/Users/demo/source.txt"] });
    });
    await waitFor(() => expect(folderReads(harness, "/Users/demo")).toBe(2));
    await settle();

    expect(contentPaneDraws.count).toBe(drawsBefore);
  });

  it("keeps the items that didn't change when an item arrives, so only its row is new", async () => {
    const harness = createAppHarness();
    await renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");
    const shownSource = contentPaneDraws.entries.find(
      (entry) => entry.path === "/Users/demo/source.txt",
    );
    expect(shownSource).toBeDefined();

    withArrived(harness);
    await emitArrived(harness);
    await screen.findByTitle("/Users/demo/arrived.txt");

    expect(contentPaneDraws.entries.find((entry) => entry.path === "/Users/demo/source.txt")).toBe(
      shownSource,
    );
  });

  it("shows a file's new size when it grows, though the folder lists the same items", async () => {
    const harness = createAppHarness();
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/notes.txt", "file"),
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    harness.setFileSize("/Users/demo/notes.txt", 10);
    harness.setFileSize("/Users/demo/source.txt", 5);
    renderApp(harness);
    // Several files selected: their sizes are added up.
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/notes.txt"), { metaKey: true });
    });
    await waitFor(() => expect(screen.getByTestId("content-status")).toHaveTextContent("15 B"));

    harness.setFileSize("/Users/demo/source.txt", 20);
    await act(async () => {
      harness.emitFolderChange({ path: "/Users/demo", changedPaths: ["/Users/demo/source.txt"] });
    });

    await waitFor(() => expect(screen.getByTestId("content-status")).toHaveTextContent("30 B"));
  });

  it("asks the Info panel again only when what it shows changed", async () => {
    const harness = createAppHarness({ preferences: { propertiesOpen: true } });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    const propertyReads = () =>
      harness.invocations.filter(
        (call) =>
          call.channel === "item:getProperties" &&
          (call.payload as { path: string }).path === "/Users/demo/source.txt",
      ).length;
    await waitFor(() => expect(propertyReads()).toBe(1));

    withArrived(harness);
    await emitArrived(harness);
    await waitFor(() => expect(folderReads(harness, "/Users/demo")).toBe(2));
    await settle(500);
    expect(propertyReads()).toBe(1);

    await act(async () => {
      harness.emitFolderChange({ path: "/Users/demo", changedPaths: ["/Users/demo/source.txt"] });
    });
    await waitFor(() => expect(propertyReads()).toBe(2));
  });

  it("drops a selected item removed outside the app from the selection", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await waitFor(() => expect(screen.getByTestId("content-status")).toHaveTextContent("selected"));

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    await act(async () => {
      harness.emitFolderChange({ path: "/Users/demo", changedPaths: ["/Users/demo/source.txt"] });
    });

    await waitFor(() => expect(screen.queryByTitle("/Users/demo/source.txt")).toBeNull());
    expect(screen.getByTestId("content-status")).not.toHaveTextContent("selected");
  });

  it("stays in the folder the user went to while the one left was being read again", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTitle("/Users/demo/Folder");
    const release = harness.holdDirectorySnapshot("/Users/demo");

    withArrived(harness);
    await emitArrived(harness);
    await waitFor(() => expect(folderReads(harness, "/Users/demo")).toBe(2));
    // The user opens a folder before the read ends.
    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder"));
    });
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
    await act(async () => {
      release();
    });
    await settle();

    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    expect(harness.watchedPath()).toBe("/Users/demo/Folder");
  });
});
