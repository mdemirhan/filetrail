// @vitest-environment jsdom

// The window's commands from the keyboard and the menus: Move To, Rename, New Folder,
// favorites and the context menus.

import type { IpcRequestInput } from "@filetrail/contracts";
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
  clearContentSelection,
  clipboardButton,
  createAppHarness,
  createDirectoryEntry,
  createTreeChild,
  expectNativeEditActions,
  expectNoFileClipboardActions,
  expectNoRefusedRequests,
  focusTreePane,
  openDirectory,
  openNewFolderFromFolderMenu,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

describe("App copy/paste integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies on the first command press without a notification or a change of focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCopy = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCopy);
  });

  it("keeps showing the folder's info in the Info panel after the folder reloads", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Info Panel" }));
    });
    await waitFor(() => expect(screen.getByTestId("info-panel")).toHaveTextContent("demo"));
    const propertyRequests = () =>
      harness.invocations.filter((call) => call.channel === "item:getProperties").length;
    await waitFor(() => expect(propertyRequests()).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    const requestsBefore = propertyRequests();

    await act(async () => {
      harness.emitCommand({ type: "refreshOrApplySearchSort" });
    });

    // Asked again after the reload, rather than left blank until the selection changes.
    await waitFor(() => expect(propertyRequests()).toBeGreaterThan(requestsBefore));
    expect(screen.getByTestId("info-panel")).toHaveTextContent("demo");
  });

  it("clears the active content location when the tree selection is cleared", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    expect(screen.getByTestId("tree-selection")).not.toHaveTextContent("none");

    await act(async () => {
      fireEvent.click(screen.getByTestId("tree-clear-selection"));
    });

    expect(screen.getByTestId("tree-selection")).toHaveTextContent("none");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("");
    expect(screen.getByTestId("content-entry-count")).toHaveTextContent("0");
  });

  it("does not auto-select the first item after content navigation opens a folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [
            createDirectoryEntry("/Users/demo/Folder/inside-a.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder/inside-b.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "Folder" });
    await act(async () => {
      fireEvent.doubleClick(await screen.findByRole("button", { name: "Folder" }));
    });

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/Folder",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-a.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-b.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("does not auto-select the first item after tree navigation opens a folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [
            createDirectoryEntry("/Users/demo/Folder/inside-a.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder/inside-b.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "Folder" });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("tree:/Users/demo/Folder"));
    });

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/Folder",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-a.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.getByTitle("/Users/demo/Folder/inside-b.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("does not auto-select the first item after favorite navigation opens a folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [
            createDirectoryEntry("/Users/demo/Documents/inside-a.txt", "file"),
            createDirectoryEntry("/Users/demo/Documents/inside-b.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "Folder" });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("favorite:/Users/demo/Documents"));
    });

    expect(await screen.findByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/Documents",
    );
    expect(screen.getByTitle("/Users/demo/Documents/inside-a.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
    expect(screen.getByTitle("/Users/demo/Documents/inside-b.txt")).toHaveAttribute(
      "data-selected",
      "false",
    );
  });

  it("cuts without a notification or a change of focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCut = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCut);
  });

  it("counts the items on the clipboard button when several are copied", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source-a.txt", "file"),
            createDirectoryEntry("/Users/demo/source-b.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByRole("button", { name: "source-a.txt" });
    const sourceBButton = await screen.findByRole("button", { name: "source-b.txt" });
    await act(async () => {
      fireEvent.click(sourceAButton);
      fireEvent.click(sourceBButton, { metaKey: true });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 2 items copied");
  });

  it("switches to icon view from the View menu and back to the list from the toolbar", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByRole("button", { name: "source.txt" });
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");

    await act(async () => {
      harness.emitCommand({ type: "viewAsIcons" });
    });
    expect(screen.getByRole("button", { name: "View as Icons" })).toHaveClass("active");
    expect(screen.getByRole("button", { name: "View as List" })).not.toHaveClass("active");
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)).toMatchObject({ viewMode: "icons" });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "View as Compact List" }));
    });
    expect(screen.getByRole("button", { name: "View as Icons" })).not.toHaveClass("active");
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)).toMatchObject({ viewMode: "list" });
    });
  });

  it("tells the application menu which commands can run and what is shown", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByRole("button", { name: "source.txt" });
    const menuState = () => {
      const state = harness.menuStates.at(-1);
      if (!state) {
        throw new Error("No menu state reported.");
      }
      return state;
    };
    // Nothing selected, nowhere to go back to.
    await vi.waitFor(() => {
      expect(menuState().disabledCommands).toEqual(
        expect.arrayContaining(["renameSelection", "trashSelection", "goBack", "goForward"]),
      );
    });
    expect(menuState().disabledCommands).not.toContain("newTab");
    expect(menuState()).toMatchObject({ viewMode: "details", hiddenFilesShown: false });

    await selectItem("/Users/demo/source.txt");
    await vi.waitFor(() => {
      expect(menuState().disabledCommands).not.toContain("renameSelection");
    });
    // A file is not a folder to open in a tab or keep as a favorite.
    expect(menuState().disabledCommands).toEqual(
      expect.arrayContaining(["openSelectionInNewTab", "toggleFavorite"]),
    );

    await act(async () => {
      harness.emitCommand({ type: "viewAsList" });
      harness.emitCommand({ type: "toggleHiddenFiles" });
      harness.emitCommand({ type: "toggleInfoRow" });
    });
    await vi.waitFor(() => {
      expect(menuState()).toMatchObject({
        viewMode: "list",
        hiddenFilesShown: true,
        infoRowOpen: true,
      });
    });

    // Keyboard Shortcuts opens Help in its own window, on that page; the files stay usable.
    await act(async () => {
      harness.emitCommand({ type: "openKeyboardShortcuts" });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "app:openHelpWindow")?.payload,
      ).toEqual({ topic: "shortcuts" });
    });
    expect(menuState().disabledCommands).not.toContain("openHelp");
    expect(menuState().disabledCommands).not.toContain("newTab");
  });

  it("asks the main process to open the Settings window on Command-comma", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.keyDown(window, { key: ",", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:openSettingsWindow")).toBe(
        true,
      );
    });
    expect(screen.getByTestId("content-pane")).toBeInTheDocument();
  });

  it("routes generic edit menu commands to native text editing for the toolbar search input", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const searchInput = await screen.findByPlaceholderText("Search");
    await act(async () => {
      searchInput.focus();
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editCut" });
      harness.emitCommand({ type: "editPaste" });
      harness.emitCommand({ type: "editSelectAll" });
    });

    expectNativeEditActions(harness, ["copy", "cut", "paste", "selectAll"]);
    expectNoFileClipboardActions(harness);
    expect(clipboardButton()).toBeNull();
    expect(clipboardButton()).toBeNull();
  });

  it("does not trigger explorer file actions when keyboard copy, cut, or paste are pressed in a text input", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const searchInput = await screen.findByPlaceholderText("Search");
    await act(async () => {
      searchInput.focus();
      fireEvent.keyDown(searchInput, { key: "c", metaKey: true });
      fireEvent.keyDown(searchInput, { key: "x", metaKey: true });
      fireEvent.keyDown(searchInput, { key: "v", metaKey: true });
    });

    expectNoFileClipboardActions(harness);
    expect(clipboardButton()).toBeNull();
    expect(clipboardButton()).toBeNull();
  });

  it("does not treat the current folder as an implicit selection for copy or cut", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await clearContentSelection();

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    // Nothing happens, and nothing is said: the commands are greyed out then.
    expect(clipboardButton()).toBeNull();
    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expectNoFileClipboardActions(harness);

    await act(async () => {
      harness.emitCommand({ type: "editCut" });
    });

    expect(clipboardButton()).toBeNull();
    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expectNoFileClipboardActions(harness);
  });

  it("does nothing for selection commands when content has no selection", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await clearContentSelection();

    await act(async () => {
      harness.emitCommand({ type: "copyPath" });
      harness.emitCommand({ type: "openSelection" });
      harness.emitCommand({ type: "editSelection" });
      harness.emitCommand({ type: "moveSelection" });
      harness.emitCommand({ type: "renameSelection" });
      harness.emitCommand({ type: "duplicateSelection" });
      harness.emitCommand({ type: "trashSelection" });
    });

    expect(harness.invocations.some((call) => call.channel === "system:copyText")).toBe(false);
    expect(harness.invocations.some((call) => call.channel === "system:openPath")).toBe(false);
    expect(
      harness.invocations.some((call) => call.channel === "system:openPathsWithApplication"),
    ).toBe(false);
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
    expect(screen.queryByText("Move To")).not.toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Move")).not.toBeInTheDocument();
  });

  it("selects the first content item when arrow navigation starts with no selection", async () => {
    const harness = createAppHarness({
      preferences: {
        foldersFirst: false,
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/alpha.txt", "file"),
            createDirectoryEntry("/Users/demo/beta.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await clearContentSelection();

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowDown" });
    });

    expect(screen.getByTitle("/Users/demo/alpha.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/beta.txt")).toHaveAttribute("data-selected", "false");
  });

  it("routes generic edit commands to native editing for path, location, and rename inputs", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const pathInput = await screen.findByLabelText("Current folder path");
    await act(async () => {
      pathInput.focus();
      harness.emitCommand({ type: "editCopy" });
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });
    const locationInput = await screen.findByLabelText("Path");
    await act(async () => {
      locationInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });
    const locationDialog = document.querySelector('dialog[aria-label="Location"]');
    if (!(locationDialog instanceof HTMLDialogElement)) {
      throw new Error("Missing location dialog.");
    }
    await act(async () => {
      fireEvent.click(within(locationDialog).getByText("Cancel"));
    });

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      harness.emitCommand({ type: "renameSelection" });
    });
    // A list item is renamed in its row, not in a dialog.
    const renameInput = await screen.findByLabelText("Rename source.txt");
    expect(screen.queryByRole("dialog", { name: /^Rename “/u })).not.toBeInTheDocument();
    await act(async () => {
      renameInput.focus();
      harness.emitCommand({ type: "editSelectAll" });
    });
    await act(async () => {
      fireEvent.keyDown(renameInput, { key: "Escape" });
    });
    expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();

    expectNativeEditActions(harness, ["copy", "paste", "selectAll"]);
    expectNoFileClipboardActions(harness);
  });

  it("uses copy and select all for readonly text inputs but ignores cut and paste", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const readonlyInput = await screen.findByLabelText("Readonly value");
    await act(async () => {
      readonlyInput.focus();
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editSelectAll" });
      harness.emitCommand({ type: "editCut" });
      harness.emitCommand({ type: "editPaste" });
    });

    expectNativeEditActions(harness, ["copy", "selectAll"]);
    expectNoFileClipboardActions(harness);
  });

  it("does not treat non-text controls as native text editors", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchScopeSelect = await screen.findByLabelText("Help scope");
    const accentColorInput = await screen.findByLabelText("Help color");

    await act(async () => {
      searchScopeSelect.focus();
      harness.emitCommand({ type: "editCopy" });
      accentColorInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });

    // A menu or a color well has no text to copy or paste into; in the file browser the
    // commands are the files' own, so nothing is done natively.
    expectNativeEditActions(harness, []);
  });

  it("keeps generic edit commands working for text inputs beside the file list", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const helpInput = await screen.findByLabelText("Help notes");
    await act(async () => {
      helpInput.focus();
      harness.emitCommand({ type: "editCopy" });
    });

    await act(async () => {
      helpInput.focus();
      harness.emitCommand({ type: "editPaste" });
    });

    expectNativeEditActions(harness, ["copy", "paste"]);
    expectNoFileClipboardActions(harness);
  });

  it("falls back to explorer copy and select all when the content pane is focused", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      harness.emitCommand({ type: "editCopy" });
      harness.emitCommand({ type: "editSelectAll" });
    });

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
    expectNativeEditActions(harness, []);
  });

  it("falls back to explorer paste when the content pane is focused", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await openDirectory("/Users/demo/Folder");

    const invocationCountBeforePaste = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    ).length;

    await act(async () => {
      harness.emitCommand({ type: "editPaste" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(invocationCountBeforePaste + 1);
    });
    expectNativeEditActions(harness, []);
  });

  it("starts at home when the last session is not reopened", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: false,
        treeRootPath: "/Users/demo/projects",
        lastVisitedPath: "/Users/demo/projects/filetrail",
        lastVisitedFavoritePath: "/Users/demo/projects/filetrail",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    const startupSnapshotCall = harness.invocations.find(
      (call) => call.channel === "directory:getSnapshot",
    );
    expect(startupSnapshotCall?.payload).toMatchObject({
      path: "/Users/demo",
    });
  });

  it("restores the saved explorer sort on startup", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        lastVisitedPath: "/Users/demo",
        sortBy: "modified",
        sortDirection: "desc",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    const startupSnapshotCall = harness.invocations.find(
      (call) => call.channel === "directory:getSnapshot",
    );
    expect(startupSnapshotCall?.payload).toMatchObject({
      path: "/Users/demo",
      sortBy: "modified",
      sortDirection: "desc",
    });
  });

  it("restores favorite tree selection when the remembered location is a favorite root", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        treeRootPath: "/Users/demo",
        lastVisitedPath: "/Users/demo/Documents",
        lastVisitedFavoritePath: "/Users/demo/Documents",
        favorites: [
          { path: "/Users/demo", icon: "home" },
          { path: "/Users/demo/Documents", icon: "documents" },
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [createTreeChild("/Users/demo/Documents", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    expect(screen.getByTestId("tree-selection")).toHaveTextContent(
      "favorite:/Users/demo/Documents",
    );
    expect(screen.getByTitle("tree:/Users/demo/Documents")).toBeInTheDocument();
  });

  it("restores the favorites subview in separate placement when the remembered location is a favorite root", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        treeRootPath: "/",
        lastVisitedPath: "/Users/demo/Documents",
        lastVisitedFavoritePath: "/Users/demo/Documents",
        favoritesPlacement: "separate",
        favorites: [
          { path: "/Users/demo", icon: "home" },
          { path: "/Users/demo/Documents", icon: "documents" },
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/": [createTreeChild("/Users", "directory")],
        "/Users": [createTreeChild("/Users/demo", "directory")],
        "/Users/demo": [createTreeChild("/Users/demo/Documents", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    expect(screen.getByTestId("favorites-placement")).toHaveTextContent("separate");
    expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");
    expect(screen.getByTestId("tree-selection")).toHaveTextContent(
      "favorite:/Users/demo/Documents",
    );
    expect(screen.getByTitle("favorite:/Users/demo/Documents")).toBeInTheDocument();
    expect(screen.getByTitle("tree:/")).toBeInTheDocument();
  });

  it("keeps an app in the tree while its package contents are shown", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: true,
        treeRootPath: "/",
        lastVisitedPath: "/Applications/Foo.app/Contents",
      },
      directorySnapshots: {
        "/Applications/Foo.app/Contents": {
          path: "/Applications/Foo.app/Contents",
          parentPath: "/Applications/Foo.app",
          entries: [],
        },
        "/Applications/Utilities": {
          path: "/Applications/Utilities",
          parentPath: "/Applications",
          entries: [],
        },
      },
      // As the tree lists folders: never a package.
      treeChildrenByPath: {
        "/": [createTreeChild("/Applications", "directory")],
        "/Applications": [createTreeChild("/Applications/Utilities", "directory")],
        "/Applications/Foo.app": [createTreeChild("/Applications/Foo.app/Contents", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    expect(await screen.findByTitle("tree:/Applications/Foo.app/Contents")).toBeInTheDocument();
    expect(screen.getByTitle("tree:/Applications/Foo.app")).toHaveAttribute(
      "data-expanded",
      "true",
    );
    expect(screen.getByTestId("tree-selection")).toHaveTextContent(
      "fs:/Applications/Foo.app/Contents",
    );

    const applicationsChildren = () =>
      screen.getByTitle("tree:/Applications").getAttribute("data-children")?.split("\n");
    expect(applicationsChildren()).toEqual(["/Applications/Foo.app", "/Applications/Utilities"]);

    // Out of the package, the tree lists Applications as it is again.
    await act(async () => {
      fireEvent.click(screen.getByTitle("tree:/Applications/Utilities"));
    });
    await vi.waitFor(() => {
      expect(applicationsChildren()).toEqual(["/Applications/Utilities"]);
    });
  });

  it("reroots the tree at slash when tree navigation moves above home", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users": {
          path: "/Users",
          parentPath: "/",
          entries: [createDirectoryEntry("/Users/demo", "directory")],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [createTreeChild("/Users/demo/Folder", "directory")],
        "/": [createTreeChild("/Users", "directory")],
        "/Users": [createTreeChild("/Users/demo", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await focusTreePane();

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
    });

    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: {
          treeRootPath: "/",
          lastVisitedPath: "/Users",
        },
      });
    });
    expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users");
  });

  it("opens the selected item with a configured application from the context menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Visual Studio Code" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/Applications/Visual Studio Code.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("shows the selected item in Finder from the context menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Library/CoreServices/Finder.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("uses the Other menu item as a one-off picker without updating preferences", async () => {
    const harness = createAppHarness({
      pickApplicationResponse: {
        canceled: false,
        appPath: "/Applications/Ghostty.app",
        appName: "Ghostty",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    // Wait for the initial debounced preferences write so it cannot land
    // between the before/after counts below.
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:updatePreferences")).toBe(
        true,
      );
    });
    const preferenceUpdateCountBeforeAction = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    ).length;
    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Other…" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:pickApplication"),
      ).toBeTruthy();
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/Applications/Ghostty.app",
        paths: ["/Users/demo/source.txt"],
      });
    });

    const preferenceUpdateCountAfterAction = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    ).length;
    expect(preferenceUpdateCountAfterAction).toBe(preferenceUpdateCountBeforeAction);
  });

  it("edits files on double click when file activation is set to edit", async () => {
    const harness = createAppHarness({
      preferences: {
        fileActivationAction: "edit",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.doubleClick(sourceButton);
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Applications/TextEdit.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("runs the Edit command against the selected files only", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      harness.emitCommand({ type: "editSelection" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Applications/TextEdit.app",
        paths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("duplicates the selected files with Cmd+D", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo",
        action: "duplicate",
      });
    });
    expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
  });

  it("opens Move To and plans a move with Cmd+Shift+M", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    expect(await screen.findByText("Move")).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        action: "move_to",
      });
    });
  });

  it("fills the Move To path from Browse", async () => {
    const harness = createAppHarness({
      pickDirectoryResponse: {
        canceled: false,
        path: "/Users/demo/Folder",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.click(screen.getByText("Choose…"));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:pickDirectory")?.payload,
      ).toEqual({
        defaultPath: "/Users/demo",
      });
    });
    expect(screen.getByLabelText("Destination folder")).toHaveValue("/Users/demo/Folder");
  });

  it("expands ~ when submitting Move To", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "~/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("keeps Move To open and shows an inline error for an invalid destination path", async () => {
    const harness = createAppHarness({
      itemPropertiesByPath: {
        "/Users/demo/DoesNotExist": "missing",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/DoesNotExist" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(await screen.findByText("Destination must be an existing folder.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
  });

  it("keeps Move To open and shows an inline error when the destination is not a folder", async () => {
    const harness = createAppHarness({
      itemPropertiesByPath: {
        "/Users/demo/source.txt": {
          path: "/Users/demo/source.txt",
          name: "source.txt",
          extension: "txt",
          kind: "file",
          kindLabel: "File",
          isHidden: false,
          isSymlink: false,
          createdAt: null,
          modifiedAt: null,
          sizeBytes: null,
          sizeStatus: "ready",
          permissionMode: null,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/source.txt" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(await screen.findByText("Destination must be an existing folder.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
  });

  it("keeps Move To open when analysis reports same-path issues", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo",
        items: [],
        issues: [
          {
            code: "same_path",
            message: "Cannot paste /Users/demo/source.txt onto itself.",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/source.txt",
          },
        ],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.click(screen.getByText("Move"));
    });

    // Issues name the items they are about.
    expect(await screen.findByText("“source.txt” is already in “demo”.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps Move To open when analysis reports missing sources", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        items: [],
        issues: [
          {
            code: "source_missing",
            message: "Source does not exist: /Users/demo/source.txt",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
          },
        ],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(await screen.findByText("“source.txt” no longer exists.")).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps Move To open when analysis reports parent-into-child issues", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/testParent", "directory"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/testParent"],
        destinationDirectoryPath: "/Users/demo/Folder",
        items: [],
        issues: [
          {
            code: "parent_into_child",
            message: "Cannot paste /Users/demo/testParent into its own descendant.",
            sourcePath: "/Users/demo/testParent",
            destinationPath: "/Users/demo/testParent/child",
          },
        ],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceFolder = await screen.findByRole("button", { name: "testParent" });
    await act(async () => {
      fireEvent.click(sourceFolder);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(
      await screen.findByText("“testParent” can't be moved into a folder inside itself."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps Move To open and shows an inline error when start is rejected as busy", async () => {
    const harness = createAppHarness({
      copyPasteStartError: new Error("Another write operation is already running."),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/Folder" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    expect(
      await screen.findByText(
        "Another file operation is running. Wait for it to finish, or stop it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Move To")).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t Move")).not.toBeInTheDocument();
  });

  it("blocks content-pane shortcuts while Move To is open", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "copyPaste:analyzeStart" &&
          (call.payload as IpcRequestInput<"copyPaste:analyzeStart">).action === "duplicate",
      ),
    ).toBeUndefined();
  });

  it("blocks content-pane shortcuts while Rename is open", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "F2" });
    });

    await screen.findByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "copyPaste:analyzeStart" &&
          (call.payload as IpcRequestInput<"copyPaste:analyzeStart">).action === "duplicate",
      ),
    ).toBeUndefined();
  });

  it("blocks content-pane shortcuts while New Folder is open", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    // A folder made inside another folder (from that folder's menu) asks for its name first.
    await openNewFolderFromFolderMenu("/Users/demo/Folder");

    await screen.findByRole("dialog", { name: "New Folder" });
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "copyPaste:analyzeStart" &&
          (call.payload as IpcRequestInput<"copyPaste:analyzeStart">).action === "duplicate",
      ),
    ).toBeUndefined();
  });

  it("renames the selected item with F2", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "F2" });
    });

    const renameInput = await screen.findByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "renamed.txt" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
      ).toEqual({
        sourcePath: "/Users/demo/source.txt",
        destinationName: "renamed.txt",
      });
    });
  });

  it("selects the renamed item after rename completes in the current directory", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "F2" });
    });
    const renameInput = await screen.findByLabelText("Rename source.txt");

    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "renamed.txt" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/renamed.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    await act(async () => {
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
        result: {
          operationId: "write-op-rename",
          action: "rename",
          status: "completed",
          targetPath: "/Users/demo/renamed.txt",
          startedAt: "2026-03-09T10:00:00.000Z",
          finishedAt: "2026-03-09T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/renamed.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/renamed.txt")).toHaveAttribute("data-selected", "true");
    });
  });

  it("makes a new folder in the folder on screen at once with Cmd+Shift+N, as Finder does", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    // No name is asked for: the folder is made with a free name, then renamed in its row.
    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("selects the new folder once it is made, and edits its name in its row", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-folder",
        action: "new_folder",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: "/Users/demo/untitled folder",
        result: {
          operationId: "write-op-folder",
          action: "new_folder",
          status: "completed",
          targetPath: "/Users/demo/untitled folder",
          startedAt: "2026-03-09T10:00:00.000Z",
          finishedAt: "2026-03-09T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: null,
              destinationPath: "/Users/demo/untitled folder",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/untitled folder")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
    // Its name is then edited in its row.
    expect(await screen.findByLabelText("Rename untitled folder")).toBeInTheDocument();
  });

  // The second press was refused, and took the first folder's name field with it.
  it("still edits the first folder's name in its row after a second press is refused", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "writeOperation:createFolder"),
      ).toHaveLength(1);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });
    expect(
      await screen.findByText(
        "Another file operation is running. Wait for it to finish, or stop it.",
      ),
    ).toBeInTheDocument();
    expect(
      harness.invocations.filter((call) => call.channel === "writeOperation:createFolder"),
    ).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-folder",
        action: "new_folder",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: "/Users/demo/untitled folder",
        result: {
          operationId: "write-op-folder",
          action: "new_folder",
          status: "completed",
          targetPath: "/Users/demo/untitled folder",
          startedAt: "2026-03-09T10:00:00.000Z",
          finishedAt: "2026-03-09T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: null,
              destinationPath: "/Users/demo/untitled folder",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    expect(await screen.findByLabelText("Rename untitled folder")).toBeInTheDocument();
  });

  it("finishes a new folder whose completion arrives before its start request returns", async () => {
    const harness = createAppHarness();
    const invoke = harness.client.invoke.bind(harness.client);
    harness.client.invoke = (async (channel: string, payload: unknown) => {
      if (channel === "writeOperation:createFolder") {
        // The folder is made and announced before the reply to the request arrives.
        harness.setDirectoryEntries("/Users/demo", [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/Folder", "directory"),
          createDirectoryEntry("/Users/demo/untitled folder", "directory"),
        ]);
        harness.emitProgress({
          operationId: "write-op-folder",
          action: "new_folder",
          status: "completed",
          completedItemCount: 1,
          totalItemCount: 1,
          completedByteCount: 0,
          totalBytes: null,
          currentSourcePath: null,
          currentDestinationPath: "/Users/demo/untitled folder",
          result: {
            operationId: "write-op-folder",
            action: "new_folder",
            status: "completed",
            targetPath: "/Users/demo/untitled folder",
            startedAt: "2026-03-09T10:00:00.000Z",
            finishedAt: "2026-03-09T10:00:01.000Z",
            summary: {
              topLevelItemCount: 1,
              totalItemCount: 1,
              completedItemCount: 1,
              failedItemCount: 0,
              skippedItemCount: 0,
              cancelledItemCount: 0,
              completedByteCount: 0,
              totalBytes: null,
            },
            items: [
              {
                sourcePath: null,
                destinationPath: "/Users/demo/untitled folder",
                status: "completed",
                error: null,
              },
            ],
            error: null,
          },
        });
      }
      return invoke(channel as never, payload as never);
    }) as typeof harness.client.invoke;

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.click(backgroundButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/untitled folder")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
    // The operation is over, so the next one isn't refused as busy (once the new folder's
    // name, which opened for editing, is left as it is).
    const renameInput = await screen.findByLabelText("Rename untitled folder");
    await act(async () => {
      fireEvent.keyDown(renameInput, { key: "Escape" });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("content-pane-background"));
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "writeOperation:createFolder"),
      ).toHaveLength(2);
    });
  });

  // Like Finder: a selected folder isn't where ⇧⌘N goes, so two New Folders in a row
  // don't nest the second inside the first (which is selected once made).
  it("makes a new folder in the folder on screen with Cmd+Shift+N, even with a folder selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("makes a new folder inside a folder from that folder's menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openNewFolderFromFolderMenu("/Users/demo/Folder");

    expect(await screen.findByRole("dialog", { name: "New Folder" })).toHaveTextContent(
      "In “Folder”",
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Folder name"), {
        target: { value: "Nested Folder" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo/Folder",
        folderName: "Nested Folder",
      });
    });
  });

  it("enables New Folder on background context and targets the current directory", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.contextMenu(backgroundButton);
    });

    const newFolderButton = screen.getByRole("button", { name: "New Folder⇧⌘N" });
    expect(newFolderButton).toHaveAttribute("aria-disabled", "false");
    await act(async () => {
      fireEvent.click(newFolderButton);
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("offers only current-folder actions on background context, all of them enabled", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    await act(async () => {
      fireEvent.contextMenu(backgroundButton);
    });

    const menu = document.querySelector(".context-menu");
    expect(menu).not.toBeNull();
    const labels = Array.from(menu?.querySelectorAll(".context-menu-item-label") ?? []).map(
      (label) => label.textContent,
    );
    expect(labels).toEqual([
      "New Folder",
      "Show Info",
      "Calculate Size",
      "Paste",
      "Copy Path",
      "View As",
      "Sort By",
      "Open in Terminal",
      "Show in Finder",
    ]);
    // Nothing is on the clipboard, so Paste is the one item that cannot run.
    expect(
      Array.from(menu?.querySelectorAll(".context-menu-item.disabled") ?? []).map(
        (item) => item.querySelector(".context-menu-item-label")?.textContent,
      ),
    ).toEqual(["Paste"]);

    // View As ticks the view on screen, and switches to another.
    fireEvent.mouseEnter(screen.getByRole("button", { name: "View As" }));
    expect(screen.getByRole("menuitemradio", { name: "List" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitemradio", { name: "Icons" }));
    });
    expect(document.querySelector(".context-menu")).toBeNull();
    expect(screen.getByRole("button", { name: "View as Icons" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("runs background context actions on the current folder", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const backgroundButton = await screen.findByTestId("content-pane-background");
    const openBackgroundMenu = async () => {
      await act(async () => {
        fireEvent.contextMenu(backgroundButton);
      });
      const menu = document.querySelector(".context-menu");
      if (!(menu instanceof HTMLElement)) {
        throw new Error("Missing background context menu.");
      }
      return within(menu);
    };

    await act(async () => {
      fireEvent.click((await openBackgroundMenu()).getByRole("button", { name: /^Copy Path/ }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:copyText")?.payload,
      ).toEqual({ text: "/Users/demo" });
    });

    await act(async () => {
      fireEvent.click((await openBackgroundMenu()).getByRole("button", { name: "Show in Finder" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openPathsWithApplication")
          ?.payload,
      ).toEqual({
        applicationPath: "/System/Library/CoreServices/Finder.app",
        paths: ["/Users/demo"],
      });
    });

    await act(async () => {
      fireEvent.click(
        (await openBackgroundMenu()).getByRole("button", { name: /^Open in Terminal/ }),
      );
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
      ).toEqual(expect.objectContaining({ path: "/Users/demo" }));
    });

    await act(async () => {
      fireEvent.click((await openBackgroundMenu()).getByRole("button", { name: /^Show Info/ }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "item:getProperties" &&
            (call.payload as { path: string }).path === "/Users/demo",
        ),
      ).toBe(true);
    });
  });

  it("creates the folder in the folder on screen with Cmd+Shift+N when a file is selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    // A file cannot hold the new folder, so it goes next to it.
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("creates the folder in the folder on screen when several items are selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
    });
    expect(sourceButton).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
    // The menu bar command behaves like the shortcut.
    await act(async () => {
      harness.emitCommand({ type: "newFolder" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:createFolder")?.payload,
      ).toEqual({
        parentDirectoryPath: "/Users/demo",
        folderName: "untitled folder",
        nextFreeName: true,
      });
    });
  });

  it("shows Add to Favorites for non-favorite folders and persists the change", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });

    const addToFavoritesButton = screen.getByRole("button", { name: "Add to Favorites" });
    expect(addToFavoritesButton).toHaveAttribute("aria-disabled", "false");

    await act(async () => {
      fireEvent.click(addToFavoritesButton);
    });

    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: {
          favorites: expect.arrayContaining([{ path: "/Users/demo/Folder", icon: "folder" }]),
        },
      });
    });
  });

  it("shows Remove from Favorites for existing favorites and persists removal", async () => {
    const harness = createAppHarness({
      preferences: {
        favorites: [{ path: "/Users/demo/Folder", icon: "folder" }],
        favoritesExpanded: true,
        favoritesInitialized: true,
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });

    const removeFromFavoritesButton = screen.getByRole("button", {
      name: "Remove from Favorites",
    });
    expect(removeFromFavoritesButton).toHaveAttribute("aria-disabled", "false");

    await act(async () => {
      fireEvent.click(removeFromFavoritesButton);
    });

    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: {
          favorites: [],
        },
      });
    });
  });

  it("keeps a tree symlink selected until content navigation moves into a child", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Alias": {
          path: "/Volumes/Shared/RealFolder",
          parentPath: "/Volumes/Shared",
          entries: [createDirectoryEntry("/Volumes/Shared/RealFolder/Child", "directory")],
        },
        "/Volumes/Shared/RealFolder/Child": {
          path: "/Volumes/Shared/RealFolder/Child",
          parentPath: "/Volumes/Shared/RealFolder",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/Alias", "symlink_directory", { isSymlink: true }),
        ],
        "/": [createTreeChild("/Volumes", "directory")],
        "/Volumes": [createTreeChild("/Volumes/Shared", "directory")],
        "/Volumes/Shared": [createTreeChild("/Volumes/Shared/RealFolder", "directory")],
        "/Volumes/Shared/RealFolder": [
          createTreeChild("/Volumes/Shared/RealFolder/Child", "directory"),
        ],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    await act(async () => {
      fireEvent.click(await screen.findByTitle("tree:/Users/demo/Alias"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Alias");
    });
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "directory:getSnapshot" &&
          (call.payload as IpcRequestInput<"directory:getSnapshot">).path === "/Users/demo/Alias",
      ),
    ).toBe(true);
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "tree:getChildren" &&
          (call.payload as IpcRequestInput<"tree:getChildren">).path ===
            "/Volumes/Shared/RealFolder",
      ),
    ).toBe(false);

    await act(async () => {
      fireEvent.doubleClick(await screen.findByTitle("/Volumes/Shared/RealFolder/Child"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent(
        "fs:/Volumes/Shared/RealFolder/Child",
      );
    });
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "tree:getChildren" &&
          (call.payload as IpcRequestInput<"tree:getChildren">).path ===
            "/Volumes/Shared/RealFolder",
      ),
    ).toBe(true);
  });
});
