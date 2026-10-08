// @vitest-environment jsdom

// Back, Forward and the enclosing folder: the history of the folders opened in a tab, and
// how a folder comes back as it was left.

import { act, fireEvent, screen, within } from "@testing-library/react";

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
  focusContentPane,
  focusTreePane,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

type Harness = ReturnType<typeof createAppHarness>;

function createHarness(args: Parameters<typeof createAppHarness>[0] = {}): Harness {
  return createAppHarness({
    ...args,
    directorySnapshots: {
      "/Users/demo/Folder": {
        path: "/Users/demo/Folder",
        parentPath: "/Users/demo",
        entries: [
          createDirectoryEntry("/Users/demo/Folder/Inner", "directory"),
          createDirectoryEntry("/Users/demo/Folder/notes.txt", "file"),
        ],
      },
      "/Users/demo/Folder/Inner": {
        path: "/Users/demo/Folder/Inner",
        parentPath: "/Users/demo/Folder",
        entries: [],
      },
      ...args.directorySnapshots,
    },
  });
}

function shownFolder(): string {
  return screen.getByTestId("content-current-path").textContent ?? "";
}

async function expectShownFolder(path: string) {
  await vi.waitFor(() => expect(shownFolder()).toBe(path));
}

// Opens a folder in the list on screen, as a double-click does.
async function open(path: string) {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.doubleClick(button);
  });
  await expectShownFolder(path);
}

async function command(harness: Harness, type: "goBack" | "goForward" | "goEnclosingFolder") {
  await act(async () => {
    harness.emitCommand({ type });
  });
}

function selectedPaths(): string[] {
  return Array.from(document.querySelectorAll('[data-selected="true"]'), (element) =>
    element.getAttribute("title"),
  ).filter((title): title is string => title !== null);
}

describe("Back and Forward", () => {
  it("go back and forward through the folders opened, with ⌘[ and ⌘]", async () => {
    const harness = createHarness();
    renderApp(harness);
    await expectShownFolder("/Users/demo");
    await open("/Users/demo/Folder");
    await open("/Users/demo/Folder/Inner");

    await pressKey({ key: "[", metaKey: true });
    await expectShownFolder("/Users/demo/Folder");
    await pressKey({ key: "[", metaKey: true });
    await expectShownFolder("/Users/demo");
    // Nothing further back.
    await pressKey({ key: "[", metaKey: true });
    await expectShownFolder("/Users/demo");

    await pressKey({ key: "]", metaKey: true });
    await expectShownFolder("/Users/demo/Folder");
    await command(harness, "goForward");
    await expectShownFolder("/Users/demo/Folder/Inner");
    // Nothing further forward.
    await command(harness, "goForward");
    await expectShownFolder("/Users/demo/Folder/Inner");
  });

  it("drops the folders ahead when another folder is opened from back in the history", async () => {
    const harness = createHarness();
    renderApp(harness);
    await expectShownFolder("/Users/demo");
    await open("/Users/demo/Folder");
    await open("/Users/demo/Folder/Inner");
    await command(harness, "goBack");
    await command(harness, "goBack");
    await expectShownFolder("/Users/demo");

    await open("/Users/demo/Folder");
    await command(harness, "goForward");
    await expectShownFolder("/Users/demo/Folder");
    await command(harness, "goBack");
    await expectShownFolder("/Users/demo");
  });

  it("brings a folder back with the items that were selected when it was left", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await open("/Users/demo/Folder");
    expect(selectedPaths()).toEqual([]);

    await command(harness, "goBack");
    await expectShownFolder("/Users/demo");
    await vi.waitFor(() => expect(selectedPaths()).toEqual(["/Users/demo/source.txt"]));

    // Opening it anew, not by Back, starts with nothing selected.
    await open("/Users/demo/Folder");
    await command(harness, "goEnclosingFolder");
    await expectShownFolder("/Users/demo");
    expect(selectedPaths()).toEqual([]);
  });

  it("leaves out of a restored selection the items that are gone", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await open("/Users/demo/Folder");
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);

    await command(harness, "goBack");
    await expectShownFolder("/Users/demo");
    await vi.waitFor(() =>
      expect(screen.getByTestId("content-entry-count")).toHaveTextContent("1"),
    );
    expect(selectedPaths()).toEqual([]);
  });

  it("jump straight to a folder from the list Back and Forward hold", async () => {
    const harness = createHarness();
    renderApp(harness);
    await expectShownFolder("/Users/demo");
    await open("/Users/demo/Folder");
    await open("/Users/demo/Folder/Inner");

    await act(async () => {
      fireEvent.contextMenu(screen.getByRole("button", { name: "Back" }));
    });
    const backMenu = screen.getByRole("menu", { name: "Back history" });
    const backItems = within(backMenu).getAllByRole("menuitem");
    // Nearest first.
    expect(backItems.map((item) => item.textContent)).toEqual(["Folder~", "Home/Users"]);
    await act(async () => {
      fireEvent.click(backItems[1] as HTMLElement);
    });
    await expectShownFolder("/Users/demo");

    // Both folders it passed are now ahead.
    await act(async () => {
      fireEvent.contextMenu(screen.getByRole("button", { name: "Forward" }));
    });
    const forwardItems = within(screen.getByRole("menu", { name: "Forward history" })).getAllByRole(
      "menuitem",
    );
    expect(forwardItems).toHaveLength(2);
    await act(async () => {
      fireEvent.click(forwardItems[1] as HTMLElement);
    });
    await expectShownFolder("/Users/demo/Folder/Inner");
    await command(harness, "goBack");
    await expectShownFolder("/Users/demo/Folder");
  });
});

describe("the enclosing folder", () => {
  it("opens with ⌘↑ from the file list, and Back returns from it", async () => {
    const harness = createHarness();
    renderApp(harness);
    await expectShownFolder("/Users/demo");
    await open("/Users/demo/Folder");
    await open("/Users/demo/Folder/Inner");
    await focusContentPane();

    await pressKey({ key: "ArrowUp", metaKey: true });
    await expectShownFolder("/Users/demo/Folder");
    await command(harness, "goBack");
    await expectShownFolder("/Users/demo/Folder/Inner");
  });

  it("opens from the toolbar's Enclosing Folder button", async () => {
    const harness = createHarness({
      preferences: { topToolbarItems: ["back", "forward", "up", "title", "search"] },
    });
    renderApp(harness);
    await expectShownFolder("/Users/demo");
    await open("/Users/demo/Folder");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Enclosing Folder" }));
    });
    await expectShownFolder("/Users/demo");
  });

  it("selects the tree's parent folder with ⌘↑ in the tree, and stops at its top", async () => {
    const harness = createHarness({
      preferences: { treeRootPath: "/" },
      treeChildrenByPath: {
        "/": [{ ...treeChild("/Users") }],
        "/Users": [treeChild("/Users/demo")],
        "/Users/demo": [treeChild("/Users/demo/Folder")],
      },
      directorySnapshots: {
        "/Users": { path: "/Users", parentPath: "/", entries: [] },
        "/": { path: "/", parentPath: null, entries: [] },
      },
    });
    renderApp(harness);
    await open("/Users/demo/Folder");
    await focusTreePane();

    await pressKey({ key: "ArrowUp", metaKey: true });
    await expectShownFolder("/Users/demo");
    expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo");
    await command(harness, "goEnclosingFolder");
    await expectShownFolder("/Users");
    await pressKey({ key: "ArrowUp", metaKey: true });
    await expectShownFolder("/");
    await pressKey({ key: "ArrowUp", metaKey: true });
    await expectShownFolder("/");
  });
});

function treeChild(path: string) {
  return {
    path,
    name: path.split("/").at(-1) || "/",
    kind: "directory" as const,
    isHidden: false,
    isSymlink: false,
  };
}
