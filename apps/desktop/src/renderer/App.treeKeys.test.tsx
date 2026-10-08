// @vitest-environment jsdom

// The sidebar from the keyboard: the arrow keys, Return, type-to-select and paging, through
// the folder tree and the separate Favorites list above it.

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

import type { IpcRequestInput } from "@filetrail/contracts";
import { getTreeRowHeight } from "./lib/layoutTokens";
import {
  createAppHarness,
  createDirectoryEntry,
  createTreeChild,
  expectNoRefusedRequests,
  focusTreePane,
  pressKey,
  renderApp,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

type Harness = ReturnType<typeof createAppHarness>;

const folder = (path: string, entries: string[] = []) => ({
  path,
  parentPath: path.slice(0, path.lastIndexOf("/")) || "/",
  entries: entries.map((entry) => createDirectoryEntry(entry, "directory")),
});

// Home holds Archive, Folder (with Inner in it) and Projects. Favorites, when they are
// apart from the tree, are Documents and Downloads.
function createHarness(
  preferences: NonNullable<Parameters<typeof createAppHarness>[0]>["preferences"] = {},
): Harness {
  return createAppHarness({
    preferences: {
      favoritesPlacement: "separate",
      favorites: [
        { path: "/Users/demo/Documents", icon: "documents" },
        { path: "/Users/demo/Downloads", icon: "downloads" },
      ],
      favoritesInitialized: true,
      locationsExpanded: false,
      ...preferences,
    },
    directorySnapshots: {
      "/Users/demo": folder("/Users/demo", [
        "/Users/demo/Archive",
        "/Users/demo/Folder",
        "/Users/demo/Projects",
      ]),
      "/Users/demo/Archive": folder("/Users/demo/Archive"),
      "/Users/demo/Folder": folder("/Users/demo/Folder", ["/Users/demo/Folder/Inner"]),
      "/Users/demo/Folder/Inner": folder("/Users/demo/Folder/Inner"),
      "/Users/demo/Projects": folder("/Users/demo/Projects"),
      "/Users/demo/Documents": folder("/Users/demo/Documents"),
      "/Users/demo/Downloads": folder("/Users/demo/Downloads"),
    },
    treeChildrenByPath: {
      "/Users/demo": [
        createTreeChild("/Users/demo/Archive", "directory"),
        createTreeChild("/Users/demo/Folder", "directory"),
        createTreeChild("/Users/demo/Projects", "directory"),
      ],
      "/Users/demo/Folder": [createTreeChild("/Users/demo/Folder/Inner", "directory")],
    },
  });
}

function treeSelection(): string {
  return screen.getByTestId("tree-selection").textContent ?? "";
}

async function expectTreeSelection(itemId: string, shownPath: string) {
  await vi.waitFor(() => {
    expect(treeSelection()).toBe(itemId);
    expect(screen.getByTestId("content-current-path")).toHaveTextContent(shownPath);
  });
}

async function key(name: string, init: KeyboardEventInit = {}) {
  await pressKey({ key: name, ...init });
}

function expanded(path: string): boolean {
  return screen.getByTitle(`tree:${path}`).getAttribute("data-expanded") === "true";
}

function childReads(harness: Harness, path: string): number {
  return harness.invocations.filter(
    (call) =>
      call.channel === "tree:getChildren" &&
      (call.payload as IpcRequestInput<"tree:getChildren">).path === path,
  ).length;
}

async function startInTree(harness: Harness) {
  renderApp(harness);
  await screen.findByTitle("tree:/Users/demo/Projects");
  await focusTreePane();
  await expectTreeSelection("fs:/Users/demo", "/Users/demo");
}

describe("the folder tree from the keyboard", () => {
  it("opens each folder the arrow keys, Home and End move to", async () => {
    const harness = createHarness();
    await startInTree(harness);

    await key("ArrowDown");
    await expectTreeSelection("fs:/Users/demo/Archive", "/Users/demo/Archive");
    await key("ArrowDown");
    await expectTreeSelection("fs:/Users/demo/Folder", "/Users/demo/Folder");
    await key("End");
    await expectTreeSelection("fs:/Users/demo/Projects", "/Users/demo/Projects");
    await key("ArrowDown");
    await expectTreeSelection("fs:/Users/demo/Projects", "/Users/demo/Projects");
    await key("ArrowUp");
    await expectTreeSelection("fs:/Users/demo/Folder", "/Users/demo/Folder");
    await key("Home");
    await expectTreeSelection("fs:/Users/demo", "/Users/demo");
  });

  it("opens a branch with →, goes into it, and comes back out with ←", async () => {
    const harness = createHarness();
    await startInTree(harness);
    await key("ArrowDown");
    await key("ArrowDown");
    await expectTreeSelection("fs:/Users/demo/Folder", "/Users/demo/Folder");

    // The folder's own subfolders are read, and shown.
    await key("ArrowRight");
    await vi.waitFor(() => expect(expanded("/Users/demo/Folder")).toBe(true));
    expect(childReads(harness, "/Users/demo/Folder")).toBeGreaterThan(0);
    await key("ArrowRight");
    await expectTreeSelection("fs:/Users/demo/Folder/Inner", "/Users/demo/Folder/Inner");
    // Inner holds no folders: → does nothing more.
    await key("ArrowRight");
    await expectTreeSelection("fs:/Users/demo/Folder/Inner", "/Users/demo/Folder/Inner");

    await key("ArrowLeft");
    await expectTreeSelection("fs:/Users/demo/Folder", "/Users/demo/Folder");
    await key("ArrowLeft");
    await vi.waitFor(() => expect(expanded("/Users/demo/Folder")).toBe(false));
    expect(treeSelection()).toBe("fs:/Users/demo/Folder");
    // Closed, the branch shows again with → without reading it again.
    const reads = childReads(harness, "/Users/demo/Folder");
    await key("ArrowRight");
    await vi.waitFor(() => expect(expanded("/Users/demo/Folder")).toBe(true));
    expect(childReads(harness, "/Users/demo/Folder")).toBe(reads);
    await key("ArrowLeft");
    await key("ArrowLeft");
    await expectTreeSelection("fs:/Users/demo", "/Users/demo");
  });

  it("closes the top folder's branch with ←, and goes no higher", async () => {
    const harness = createHarness();
    await startInTree(harness);

    await key("ArrowLeft");
    await vi.waitFor(() => expect(expanded("/Users/demo")).toBe(false));
    await key("ArrowLeft");
    await expectTreeSelection("fs:/Users/demo", "/Users/demo");
  });

  it("opens and closes the selected folder's branch with Return", async () => {
    const harness = createHarness();
    await startInTree(harness);
    await key("ArrowDown");
    await key("ArrowDown");
    await expectTreeSelection("fs:/Users/demo/Folder", "/Users/demo/Folder");

    await key("Enter");
    await vi.waitFor(() => expect(expanded("/Users/demo/Folder")).toBe(true));
    await key("Enter");
    await vi.waitFor(() => expect(expanded("/Users/demo/Folder")).toBe(false));
    await key("ArrowDown", { metaKey: true });
    await vi.waitFor(() => expect(expanded("/Users/demo/Folder")).toBe(true));
  });

  it("follows a link to a folder in the tree without opening its branch", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Linked": folder("/Users/demo/Linked"),
      },
      treeChildrenByPath: {
        "/Users/demo": [createTreeChild("/Users/demo/Linked", "directory", { isSymlink: true })],
      },
    });
    renderApp(harness);
    await screen.findByTitle("tree:/Users/demo/Linked");
    await focusTreePane();
    await key("ArrowDown");
    await key("ArrowDown");
    await vi.waitFor(() => expect(treeSelection()).toBe("fs:/Users/demo/Linked"));
    const reads = childReads(harness, "/Users/demo/Linked");

    await key("ArrowRight");
    await key("Enter");

    await vi.waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Linked"),
    );
    expect(childReads(harness, "/Users/demo/Linked")).toBe(reads);
    expect(treeSelection()).toBe("fs:/Users/demo/Linked");
  });

  it("selects the first folder whose name starts with what is typed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const harness = createHarness();
      await startInTree(harness);

      await key("p");
      await expectTreeSelection("fs:/Users/demo/Projects", "/Users/demo/Projects");
      // Typed on quickly, the letters make one name.
      await key("x");
      await expectTreeSelection("fs:/Users/demo/Projects", "/Users/demo/Projects");
      // A second later, a letter starts afresh.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      await key("F");
      await expectTreeSelection("fs:/Users/demo/Folder", "/Users/demo/Folder");
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves a page at a time with ⌃D and ⌃U", async () => {
    const harness = createHarness();
    await startInTree(harness);
    // Room for three rows: a page is two of them.
    Object.defineProperty(screen.getByTestId("tree-scroll"), "clientHeight", {
      configurable: true,
      value: getTreeRowHeight(false) * 3,
    });

    await key("d", { ctrlKey: true });
    await expectTreeSelection("fs:/Users/demo/Folder", "/Users/demo/Folder");
    await key("d", { ctrlKey: true });
    await expectTreeSelection("fs:/Users/demo/Projects", "/Users/demo/Projects");
    await key("u", { ctrlKey: true });
    await expectTreeSelection("fs:/Users/demo/Archive", "/Users/demo/Archive");
  });
});

describe("the separate Favorites list from the keyboard", () => {
  async function intoFavorites(harness: Harness) {
    await startInTree(harness);
    await key("ArrowUp");
    await expectTreeSelection("favorite:/Users/demo/Downloads", "/Users/demo/Downloads");
    expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");
  }

  it("goes up from the top of the tree into Favorites, and down again into the tree", async () => {
    const harness = createHarness();
    await intoFavorites(harness);

    await key("ArrowUp");
    await expectTreeSelection("favorite:/Users/demo/Documents", "/Users/demo/Documents");
    // Nothing above the first favorite, and nothing beside one.
    await key("ArrowUp");
    await key("ArrowRight");
    await key("ArrowLeft");
    await expectTreeSelection("favorite:/Users/demo/Documents", "/Users/demo/Documents");

    await key("ArrowDown");
    await expectTreeSelection("favorite:/Users/demo/Downloads", "/Users/demo/Downloads");
    await key("ArrowDown");
    await expectTreeSelection("fs:/Users/demo", "/Users/demo");
    expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("tree");
  });

  it("goes to the first and last favorite with Home and End", async () => {
    const harness = createHarness();
    await intoFavorites(harness);

    await key("Home");
    await expectTreeSelection("favorite:/Users/demo/Documents", "/Users/demo/Documents");
    await key("End");
    await expectTreeSelection("favorite:/Users/demo/Downloads", "/Users/demo/Downloads");
  });

  it("goes on into the disks below the favorites when they are shown", async () => {
    const harness = createHarness({ locationsExpanded: true });
    await startInTree(harness);
    // The last row above the tree is now a disk's.
    await key("ArrowUp");
    await vi.waitFor(() => expect(treeSelection()).toMatch(/^location:/));
    expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");

    await key("Home");
    await key("ArrowDown");
    await key("ArrowDown");
    await vi.waitFor(() => expect(treeSelection()).toMatch(/^location:/));
  });

  it("selects the favorite whose name starts with what is typed", async () => {
    const harness = createHarness();
    await intoFavorites(harness);

    await key("d");
    await key("o");
    await key("c");
    await expectTreeSelection("favorite:/Users/demo/Documents", "/Users/demo/Documents");
  });

  it("opens the selected favorite again with Return, and goes up nowhere with ⌘↑", async () => {
    const harness = createHarness();
    await intoFavorites(harness);
    const reads = () =>
      harness.invocations.filter(
        (call) =>
          call.channel === "directory:getSnapshot" &&
          (call.payload as IpcRequestInput<"directory:getSnapshot">).path ===
            "/Users/demo/Downloads" &&
          // The folder opened, not read for its size.
          (call.payload as IpcRequestInput<"directory:getSnapshot">).sortBy !== undefined,
      ).length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const before = reads();

    await key("Enter");
    await vi.waitFor(() => expect(reads()).toBe(before + 1));
    await key("ArrowUp", { metaKey: true });
    await expectTreeSelection("favorite:/Users/demo/Downloads", "/Users/demo/Downloads");
  });

  it("moves a page at a time through the favorites", async () => {
    const harness = createHarness();
    await intoFavorites(harness);

    await key("u", { ctrlKey: true });
    await expectTreeSelection("favorite:/Users/demo/Documents", "/Users/demo/Documents");
    await key("d", { ctrlKey: true });
    await expectTreeSelection("favorite:/Users/demo/Downloads", "/Users/demo/Downloads");
  });

  it("goes up into Favorites from an empty tree", async () => {
    const harness = createHarness();
    await startInTree(harness);
    await act(async () => {
      fireEvent.click(screen.getByTestId("tree-clear-selection"));
    });

    await key("ArrowUp");
    await vi.waitFor(() => expect(treeSelection()).toBe("favorite:/Users/demo/Downloads"));
  });
});
