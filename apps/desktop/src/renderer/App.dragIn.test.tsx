// @vitest-environment jsdom

// Files dragged in from Finder and other apps: read from the drag as it comes in, then
// dropped with the same targets and rules as the app's own drags.

import type { IpcResponse } from "@filetrail/contracts";
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
  type DragKeys,
  analyzeRequests,
  createAppHarness,
  createDirectoryEntry,
  createMockDataTransfer,
  finishedWriteEvent,
  installDragEventWithModifiers,
  openDirectory,
  openSearchResults,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

type Harness = ReturnType<typeof createAppHarness>;
type DraggedInItem = IpcResponse<"system:readDraggedIn">["items"][number];

const home = "/Users/demo";
const folder = "/Users/demo/Folder";
// Items in a folder the window isn't showing, on the same disk.
const elsewhere: DraggedInItem[] = [
  { path: "/Users/other/a.txt", kind: "file" },
  { path: "/Users/other/Photos", kind: "directory" },
];

let restoreDragEvent: () => void = () => undefined;
beforeEach(() => {
  restoreDragEvent = installDragEventWithModifiers();
});
afterEach(() => {
  restoreDragEvent();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// What the page sees of another app's drag: files, which it can't read until the drop, and
// what that app allows.
function dragFromOtherApp(effectAllowed = "all"): DataTransfer {
  return Object.assign(createMockDataTransfer(), { types: ["Files"], effectAllowed });
}

function draggedIn(harness: Harness, items: DraggedInItem[]) {
  harness.setDraggedIn({ changeCount: 1, items });
}

function readsOf(harness: Harness): number {
  return harness.invocations.filter((call) => call.channel === "system:readDraggedIn").length;
}

// The drag comes over `target`; the window reads what it carries.
async function enter(
  harness: Harness,
  target: HTMLElement,
  dataTransfer: DataTransfer,
  keys: DragKeys = {},
): Promise<void> {
  const reads = readsOf(harness);
  await act(async () => {
    fireEvent.dragEnter(target, { dataTransfer, ...keys });
  });
  await vi.waitFor(() => {
    expect(readsOf(harness)).toBeGreaterThan(reads);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Over `target`, then dropped there; returns the cursor the drag showed.
async function overAndDrop(
  target: HTMLElement,
  dataTransfer: DataTransfer,
  keys: DragKeys = {},
): Promise<string> {
  await act(async () => {
    fireEvent.dragOver(target, { dataTransfer, ...keys });
  });
  const cursor = dataTransfer.dropEffect;
  await act(async () => {
    fireEvent.drop(target, { dataTransfer, ...keys });
  });
  return cursor;
}

async function dropFromOtherApp(
  harness: Harness,
  target: HTMLElement,
  options: { effectAllowed?: string; keys?: DragKeys } = {},
): Promise<string> {
  const dataTransfer = dragFromOtherApp(options.effectAllowed);
  await enter(harness, target, dataTransfer, options.keys);
  return overAndDrop(target, dataTransfer, options.keys);
}

function currentPath(): string | null {
  return screen.getByTestId("content-current-path").textContent;
}

async function waitMs(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("dropping files from other apps", () => {
  it("moves them into the folder on screen, from anywhere on its empty space", async () => {
    const harness = createAppHarness();
    draggedIn(harness, elsewhere);
    renderApp(harness);
    const pane = await screen.findByTestId("content-pane");

    const cursor = await dropFromOtherApp(harness, pane);

    expect(cursor).toBe("move");
    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({
          mode: "cut",
          action: "move_to",
          sourcePaths: elsewhere.map((item) => item.path),
          destinationDirectoryPath: home,
        }),
      ]);
    });
  });

  it("drops on a file into the folder it's in", async () => {
    const harness = createAppHarness();
    draggedIn(harness, elsewhere);
    renderApp(harness);

    await dropFromOtherApp(harness, await screen.findByTitle("/Users/demo/source.txt"));

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({ destinationDirectoryPath: home }),
      ]);
    });
  });

  it("drops on a folder in the list into it", async () => {
    const harness = createAppHarness();
    draggedIn(harness, elsewhere);
    renderApp(harness);
    const row = await screen.findByTitle(folder);

    const dataTransfer = dragFromOtherApp();
    await enter(harness, row, dataTransfer);
    await act(async () => {
      fireEvent.dragOver(row, { dataTransfer });
    });
    expect(row).toHaveAttribute("data-drop-target-state", "valid");
    // The folder takes it, not the pane behind it.
    expect(screen.getByTestId("content-pane")).toHaveAttribute("data-drop-target-state", "none");
    await act(async () => {
      fireEvent.drop(row, { dataTransfer });
    });

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({ destinationDirectoryPath: folder }),
      ]);
    });
  });

  it("drops on a folder in the sidebar into it", async () => {
    const harness = createAppHarness();
    draggedIn(harness, elsewhere);
    renderApp(harness);

    await dropFromOtherApp(harness, await screen.findByTitle(`tree:${folder}`));

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({ destinationDirectoryPath: folder }),
      ]);
    });
  });

  it.each([
    {
      how: "from another disk",
      items: [{ path: "/Volumes/Backup/a.txt", kind: "file" as const }],
      effectAllowed: "all",
      keys: {},
    },
    { how: "with Option held", items: elsewhere, effectAllowed: "copy", keys: { altKey: true } },
    // Mail and some editors allow copies only: a move would be refused, so it copies.
    { how: "from an app that allows only copies", items: elsewhere, effectAllowed: "copyLink" },
  ])("copies them $how", async ({ items, effectAllowed, keys }) => {
    const harness = createAppHarness();
    draggedIn(harness, items);
    renderApp(harness);

    const cursor = await dropFromOtherApp(harness, await screen.findByTestId("content-pane"), {
      effectAllowed,
      keys: keys ?? {},
    });

    expect(cursor).toBe("copy");
    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({
          mode: "copy",
          action: "copy_to",
          destinationDirectoryPath: home,
        }),
      ]);
    });
  });

  it("refuses items dropped into the folder they're in, and a folder dropped into itself", async () => {
    const harness = createAppHarness();
    draggedIn(harness, [{ path: folder, kind: "directory" }]);
    renderApp(harness);
    const pane = await screen.findByTestId("content-pane");
    const row = screen.getByTitle(folder);
    const dataTransfer = dragFromOtherApp();

    await enter(harness, pane, dataTransfer);
    expect(await overAndDrop(pane, dataTransfer)).toBe("none");
    expect(await overAndDrop(row, dataTransfer)).toBe("none");
    expect(analyzeRequests(harness)).toEqual([]);
  });

  it("refuses a drag of promised files, text or links", async () => {
    const harness = createAppHarness();
    draggedIn(harness, []);
    renderApp(harness);
    const pane = await screen.findByTestId("content-pane");

    expect(await dropFromOtherApp(harness, pane)).toBe("none");
    expect(pane).toHaveAttribute("data-drop-target-state", "none");
    expect(analyzeRequests(harness)).toEqual([]);
  });

  it("refuses a drop on a folder in the Trash", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        [home]: {
          path: home,
          parentPath: "/Users",
          entries: [createDirectoryEntry("/Users/demo/.Trash", "directory")],
        },
        "/Users/demo/.Trash": {
          path: "/Users/demo/.Trash",
          parentPath: home,
          entries: [createDirectoryEntry("/Users/demo/.Trash/Old Folder", "directory")],
        },
      },
    });
    draggedIn(harness, elsewhere);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");

    const pane = screen.getByTestId("content-pane");
    const dataTransfer = dragFromOtherApp();
    await enter(harness, pane, dataTransfer);
    expect(
      await overAndDrop(await screen.findByTitle("/Users/demo/.Trash/Old Folder"), dataTransfer),
    ).toBe("none");
    expect(await overAndDrop(pane, dataTransfer)).toBe("none");
    expect(analyzeRequests(harness)).toEqual([]);
  });

  it("takes no files on a text field, where they would be typed in", async () => {
    const harness = createAppHarness();
    draggedIn(harness, elsewhere);
    renderApp(harness);
    const field = await screen.findByLabelText("Current folder path");

    expect(await dropFromOtherApp(harness, field)).toBe("none");
    expect(screen.getByTestId("content-pane")).toHaveAttribute("data-drop-target-state", "none");
    expect(analyzeRequests(harness)).toEqual([]);
  });

  it("reads the drag once, however long it is held over the window", async () => {
    const harness = createAppHarness();
    draggedIn(harness, elsewhere);
    renderApp(harness);
    const pane = await screen.findByTestId("content-pane");
    const dataTransfer = dragFromOtherApp();

    await enter(harness, pane, dataTransfer);
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        fireEvent.dragOver(pane, { dataTransfer });
      });
    }

    expect(readsOf(harness)).toBe(1);
    expect(pane).toHaveAttribute("data-drop-target-state", "valid");
  });
});

describe("dropping files from other apps on search results", () => {
  const searchHarness = () =>
    createAppHarness({
      searchResultItems: [
        {
          path: folder,
          name: "Folder",
          extension: "",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          parentPath: home,
          relativeParentPath: ".",
        },
        {
          path: "/Users/demo/source.txt",
          name: "source.txt",
          extension: "txt",
          kind: "file",
          isHidden: false,
          isSymlink: false,
          parentPath: home,
          relativeParentPath: ".",
        },
      ],
    });

  it("drops on a folder found into it", async () => {
    const harness = searchHarness();
    draggedIn(harness, elsewhere);
    renderApp(harness);
    await openSearchResults();

    await dropFromOtherApp(harness, await screen.findByTitle(`search:${folder}`));

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({ destinationDirectoryPath: folder }),
      ]);
    });
  });

  it("still takes none of the app's own drags of results", async () => {
    const harness = searchHarness();
    renderApp(harness);
    await openSearchResults();
    const result = await screen.findByTitle("search:/Users/demo/source.txt");
    const target = screen.getByTitle(`search:${folder}`);
    const dataTransfer = createMockDataTransfer();

    await act(async () => {
      fireEvent.dragStart(result, { dataTransfer });
      fireEvent.dragEnter(target, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer });
    });

    expect(target).toHaveAttribute("data-drop-target-state", "none");
    await act(async () => {
      fireEvent.drop(target, { dataTransfer });
    });
    expect(analyzeRequests(harness)).toEqual([]);
  });
});

describe("a drag from another app while an operation runs", () => {
  it("is refused, and says why once", async () => {
    const harness = createAppHarness({ deferCopyPasteStart: true });
    draggedIn(harness, elsewhere);
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await pressKey({ key: "v", metaKey: true });
    await screen.findByRole("region", { name: "Pasting…" });
    const pane = screen.getByTestId("content-pane");

    const dataTransfer = dragFromOtherApp();
    await enter(harness, pane, dataTransfer);
    const cursor = await overAndDrop(pane, dataTransfer);
    await act(async () => {
      fireEvent.dragOver(pane, { dataTransfer });
    });

    expect(cursor).toBe("none");
    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent(/Can't drop while .* being copied/);
    });
    expect(viewport.textContent?.match(/Can't drop/g)).toHaveLength(1);
    expect(analyzeRequests(harness)).toHaveLength(1);
  });
});

describe("springing into folders under a drag from another app", () => {
  function harnessWithInnerFolder(): Harness {
    const harness = createAppHarness({
      directorySnapshots: {
        [folder]: {
          path: folder,
          parentPath: home,
          entries: [createDirectoryEntry(`${folder}/Inner`, "directory")],
        },
        [`${folder}/Inner`]: { path: `${folder}/Inner`, parentPath: folder, entries: [] },
      },
    });
    draggedIn(harness, elsewhere);
    return harness;
  }

  // Drag-overs keep coming while a drag is held still: `ms` of them, a fifth of a second
  // apart, with the pointer resting.
  async function holdOver(path: string, ms: number, dataTransfer: DataTransfer): Promise<void> {
    for (let held = 0; held <= ms; held += 200) {
      await act(async () => {
        fireEvent.dragOver(screen.getByTitle(path), { dataTransfer, clientX: 10, clientY: 10 });
      });
      if (held < ms) {
        await waitMs(200);
      }
    }
  }

  it("brings the tab back when the drag leaves the window without a drop", async () => {
    const harness = harnessWithInnerFolder();
    renderApp(harness);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const dataTransfer = dragFromOtherApp();

    await enter(harness, await screen.findByTitle(folder), dataTransfer);
    await holdOver(folder, 1600, dataTransfer);
    await vi.waitFor(() => {
      expect(currentPath()).toBe(folder);
    });
    // No more drag-overs: it left, or was dropped elsewhere, or cancelled.
    await waitMs(600);

    await vi.waitFor(() => {
      expect(currentPath()).toBe(home);
    });
    expect(analyzeRequests(harness)).toEqual([]);
  });

  it("stays in the folder it sprang into once dropped there", async () => {
    const harness = harnessWithInnerFolder();
    renderApp(harness);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const dataTransfer = dragFromOtherApp();

    await enter(harness, await screen.findByTitle(folder), dataTransfer);
    await holdOver(folder, 1600, dataTransfer);
    await vi.waitFor(() => {
      expect(currentPath()).toBe(folder);
    });
    await overAndDrop(screen.getByTestId("content-pane"), dataTransfer);
    await waitMs(600);

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({ destinationDirectoryPath: folder }),
      ]);
    });
    expect(currentPath()).toBe(folder);
  });

  it("takes a new drag as new once one has left", async () => {
    const harness = harnessWithInnerFolder();
    renderApp(harness);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pane = await screen.findByTestId("content-pane");

    await enter(harness, pane, dragFromOtherApp());
    await waitMs(600);
    harness.setDraggedIn({
      changeCount: 2,
      items: [{ path: "/Volumes/Backup/b.txt", kind: "file" }],
    });
    const cursor = await dropFromOtherApp(harness, pane);

    expect(readsOf(harness)).toBe(2);
    expect(cursor).toBe("copy");
  });
});

describe("what a finished drop from another app says", () => {
  async function finishDrop(harness: Harness, targetPath: string): Promise<void> {
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    await act(async () => {
      harness.emitProgress(
        finishedWriteEvent({
          operationId: "copy-op-1",
          action: "move_to",
          targetPath,
          items: [
            {
              sourcePath: "/Users/other/a.txt",
              destinationPath: `${targetPath}/a.txt`,
            },
          ],
        }),
      );
    });
  }

  it("nothing, when the items went into the folder on screen", async () => {
    const harness = createAppHarness();
    draggedIn(harness, [elsewhere[0] as DraggedInItem]);
    renderApp(harness);

    await dropFromOtherApp(harness, await screen.findByTestId("content-pane"));
    await finishDrop(harness, home);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.queryByTestId("toast-viewport")?.textContent ?? "").not.toMatch(/Moved/);
  });

  it("where they went, when that folder isn't on screen", async () => {
    const harness = createAppHarness();
    draggedIn(harness, [elsewhere[0] as DraggedInItem]);
    renderApp(harness);

    await dropFromOtherApp(harness, await screen.findByTitle(folder));
    await finishDrop(harness, folder);

    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent("Moved to Folder");
    });
  });
});

describe("a question about a drop from another app", () => {
  // The drop is made while the other app is in front.
  function conflictHarness(): Harness {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/other/Folder"],
        destinationDirectoryPath: home,
        items: [
          {
            sourcePath: "/Users/other/Folder",
            destinationPath: folder,
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        issues: [],
        warnings: [],
        summary: { topLevelItemCount: 1, totalItemCount: 1, totalBytes: 0 },
      },
    });
    draggedIn(harness, [{ path: "/Users/other/Folder", kind: "directory" }]);
    return harness;
  }

  function broughtForward(harness: Harness): number {
    return harness.invocations.filter((call) => call.channel === "system:bringWindowToFront")
      .length;
  }

  it("brings the window forward", async () => {
    const harness = conflictHarness();
    renderApp(harness);
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    await dropFromOtherApp(harness, await screen.findByTestId("content-pane"));

    await screen.findByRole("dialog");
    await vi.waitFor(() => {
      expect(broughtForward(harness)).toBe(1);
    });
  });

  it("leaves a window already in front where it is", async () => {
    const harness = conflictHarness();
    renderApp(harness);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    await dropFromOtherApp(harness, await screen.findByTestId("content-pane"));

    await screen.findByRole("dialog");
    expect(broughtForward(harness)).toBe(0);
  });

  it("is not about drops of the app's own", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        [home]: {
          path: home,
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/Folder", "directory"),
            createDirectoryEntry("/Users/demo/Other", "directory"),
          ],
        },
      },
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/Other"],
        destinationDirectoryPath: folder,
        items: [
          {
            sourcePath: "/Users/demo/Other",
            destinationPath: `${folder}/Other`,
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        issues: [],
        warnings: [],
        summary: { topLevelItemCount: 1, totalItemCount: 1, totalBytes: 0 },
      },
    });
    renderApp(harness);
    const other = await screen.findByTitle("/Users/demo/Other");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const dataTransfer = createMockDataTransfer();

    await act(async () => {
      fireEvent.dragStart(other, { dataTransfer });
    });
    await overAndDrop(screen.getByTitle(folder), dataTransfer);

    await screen.findByRole("dialog");
    expect(broughtForward(harness)).toBe(0);
  });
});
