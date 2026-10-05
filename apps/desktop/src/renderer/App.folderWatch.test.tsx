// @vitest-environment jsdom

// Changes made outside the app to the folder on screen.

import { act, fireEvent, screen, waitFor } from "@testing-library/react";

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
});
