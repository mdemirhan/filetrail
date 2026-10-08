// @vitest-environment jsdom

// The window's own drags, which the system drags: where they end, what the window does
// when it hears they have, and the tabs they spring into folders in.

import { act, fireEvent, render, screen } from "@testing-library/react";

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
  analyzeRequests,
  createAppHarness,
  createDirectoryEntry,
  createMockDataTransfer,
  dragBetween,
  installDragEventWithModifiers,
  openDirectory,
  pressKey,
  renderApp,
} from "./test/appHarness";

type Harness = ReturnType<typeof createAppHarness>;
type EndedOver = NonNullable<Parameters<Harness["endFileDrag"]>[1]>;

const home = "/Users/demo";
const source = "/Users/demo/source.txt";
const folder = "/Users/demo/Folder";
const other = "/Users/demo/Other";

let restoreDragEvent: () => void = () => undefined;
beforeEach(() => {
  restoreDragEvent = installDragEventWithModifiers();
});
afterEach(() => {
  restoreDragEvent();
  vi.useRealTimers();
});

function harnessWithFolders(): Harness {
  return createAppHarness({
    directorySnapshots: {
      [home]: {
        path: home,
        parentPath: "/Users",
        entries: [
          createDirectoryEntry(source, "file"),
          createDirectoryEntry(folder, "directory"),
          createDirectoryEntry(other, "directory"),
        ],
      },
      [folder]: {
        path: folder,
        parentPath: home,
        entries: [createDirectoryEntry(`${folder}/notes.txt`, "file")],
      },
      [other]: { path: other, parentPath: home, entries: [] },
    },
  });
}

// What the page sees of a drag of files, the window's own or another app's.
function fileDrag(): DataTransfer {
  return Object.assign(createMockDataTransfer(), { types: ["Files"] });
}

async function startDrag(path: string, dataTransfer = fileDrag()): Promise<DataTransfer> {
  const row = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.dragStart(row, { dataTransfer });
  });
  return dataTransfer;
}

// Drag-overs keep coming while a drag is held still: `ms` of them, a fifth of a second
// apart, with the pointer resting at `at`.
async function holdOver(
  target: HTMLElement | string,
  ms: number,
  dataTransfer: DataTransfer,
  at = { clientX: 10, clientY: 10 },
): Promise<void> {
  for (let held = 0; held <= ms; held += 200) {
    await act(async () => {
      fireEvent.dragOver(typeof target === "string" ? screen.getByTitle(target) : target, {
        dataTransfer,
        ...at,
      });
    });
    if (held < ms) {
      await waitMs(200);
    }
  }
}

async function springInto(
  path: string,
  dataTransfer: DataTransfer,
  at?: { clientX: number; clientY: number },
) {
  await holdOver(path, 1600, dataTransfer, at);
  await vi.waitFor(() => {
    expect(currentPath()).toBe(path);
  });
}

async function endDrag(
  harness: Harness,
  operation: Parameters<Harness["endFileDrag"]>[0],
  endedOver: EndedOver = "elsewhere",
): Promise<void> {
  await act(async () => {
    harness.endFileDrag(operation, endedOver);
  });
}

async function waitMs(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function currentPath(): string | null {
  return screen.getByTestId("content-current-path").textContent;
}

function tabs(): [HTMLElement, HTMLElement] {
  return screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
}

function readsOf(harness: Harness): number {
  return harness.invocations.filter((call) => call.channel === "system:readDraggedIn").length;
}

function checksFor(harness: Harness): unknown[] {
  return harness.invocations.filter((call) => call.channel === "system:findDraggedAway");
}

function goBackDisabled(harness: Harness): boolean {
  return harness.menuStates.at(-1)?.disabledCommands.includes("goBack") ?? false;
}

describe("springing in several tabs", () => {
  it("brings back every tab the drag sprang in, the one on screen and the one it left", async () => {
    const harness = harnessWithFolders();
    renderApp(harness);
    await screen.findByTitle(source);
    // Two tabs on the home folder; the first on screen.
    await pressKey({ key: "t", metaKey: true });
    await pressKey({ key: "Tab", ctrlKey: true });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const dataTransfer = await startDrag(source);
    await springInto(folder, dataTransfer);
    // Held over the second tab, it comes to the front.
    await holdOver(tabs()[1], 800, dataTransfer);
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    await vi.waitFor(() => {
      expect(currentPath()).toBe(home);
    });
    await springInto(other, dataTransfer, { clientX: 40, clientY: 30 });
    // Esc.
    await endDrag(harness, "none");

    await vi.waitFor(() => {
      expect(currentPath()).toBe(home);
    });
    await vi.waitFor(() => {
      expect(goBackDisabled(harness)).toBe(true);
    });
    await act(async () => {
      fireEvent.click(tabs()[0]);
    });
    await vi.waitFor(() => {
      expect(currentPath()).toBe(home);
    });
    await vi.waitFor(() => {
      expect(goBackDisabled(harness)).toBe(true);
    });
    expect(analyzeRequests(harness)).toEqual([]);
  });

  it("takes no drop on the empty space of a tab it came to without springing there", async () => {
    const harness = harnessWithFolders();
    renderApp(harness);
    await screen.findByTitle(source);
    await pressKey({ key: "t", metaKey: true });
    await pressKey({ key: "Tab", ctrlKey: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const dataTransfer = await startDrag(source);
    await springInto(folder, dataTransfer);
    await holdOver(tabs()[1], 800, dataTransfer);
    await vi.waitFor(() => {
      expect(currentPath()).toBe(home);
    });
    const pane = screen.getByTestId("content-pane");
    await act(async () => {
      fireEvent.dragOver(pane, { dataTransfer, altKey: true });
    });

    expect(pane).toHaveAttribute("data-drop-target-state", "none");
  });
});

describe("a folder that can't be sprung into", () => {
  it("leaves the drag as it was: the folder on screen still takes no drop on its empty space", async () => {
    const harness = harnessWithFolders();
    harness.removeDirectory(folder);
    renderApp(harness);
    await screen.findByTitle(source);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const dataTransfer = await startDrag(source);
    await holdOver(folder, 1600, dataTransfer);
    await waitMs(100);
    expect(currentPath()).toBe(home);
    const pane = screen.getByTestId("content-pane");
    await act(async () => {
      fireEvent.dragOver(pane, { dataTransfer, altKey: true });
      fireEvent.drop(pane, { dataTransfer, altKey: true });
    });
    await endDrag(harness, "copy", "this_window");
    await waitMs(1100);

    expect(pane).toHaveAttribute("data-drop-target-state", "none");
    expect(analyzeRequests(harness)).toEqual([]);
  });
});

describe("hearing a drag's end", () => {
  it("takes a drop on the window that comes after the drag's end", async () => {
    const harness = harnessWithFolders();
    renderApp(harness);
    await screen.findByTitle(source);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const dataTransfer = await startDrag(source);
    await springInto(folder, dataTransfer);
    await endDrag(harness, "move", "this_window");
    const pane = screen.getByTestId("content-pane");
    await act(async () => {
      fireEvent.dragOver(pane, { dataTransfer });
      fireEvent.drop(pane, { dataTransfer });
    });

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({ mode: "cut", destinationDirectoryPath: folder }),
      ]);
    });
    await waitMs(1100);
    expect(currentPath()).toBe(folder);
  });

  it("brings the tab back when the drop the drag's end spoke of never comes", async () => {
    const harness = harnessWithFolders();
    renderApp(harness);
    await screen.findByTitle(source);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const dataTransfer = await startDrag(source);
    await springInto(folder, dataTransfer);
    await endDrag(harness, "move", "this_window");
    await waitMs(1100);

    await vi.waitFor(() => {
      expect(currentPath()).toBe(home);
    });
    expect(analyzeRequests(harness)).toEqual([]);
  });

  it("lets go of a drag whose end is never heard once the pointer is pressed or moved free", async () => {
    const harness = harnessWithFolders();
    harness.setDraggedIn({ changeCount: 9, items: [{ path: "/Users/other/a.txt", kind: "file" }] });
    renderApp(harness);
    await screen.findByTitle(source);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const dataTransfer = await startDrag(source);
    await springInto(folder, dataTransfer);
    // Still going: the button is held, or drag-overs are still coming in.
    await act(async () => {
      fireEvent.pointerMove(window, { buttons: 1 });
    });
    await act(async () => {
      fireEvent.dragOver(screen.getByTestId("content-pane"), { dataTransfer });
      fireEvent.pointerMove(window, { buttons: 0 });
    });
    expect(currentPath()).toBe(folder);
    expect(harness.fileDragsGoing()).toBe(1);

    // The drag is over, though the system never said so.
    await waitMs(400);
    await act(async () => {
      fireEvent.pointerMove(window, { buttons: 0 });
    });
    await vi.waitFor(() => {
      expect(currentPath()).toBe(home);
    });

    // A drag from Finder is taken from then on.
    const fromFinder = fileDrag();
    const pane = screen.getByTestId("content-pane");
    await act(async () => {
      fireEvent.dragEnter(pane, { dataTransfer: fromFinder });
    });
    await vi.waitFor(() => {
      expect(readsOf(harness)).toBe(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      fireEvent.dragOver(pane, { dataTransfer: fromFinder });
      fireEvent.drop(pane, { dataTransfer: fromFinder });
    });
    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toEqual([
        expect.objectContaining({ sourcePaths: ["/Users/other/a.txt"] }),
      ]);
    });
  });
});

describe("a drag of the window's own while an operation starts", () => {
  it("is not taken for a drag from another app", async () => {
    const harness = harnessWithFolders();
    harness.setDraggedIn({ changeCount: 9, items: [{ path: source, kind: "file" }] });
    renderApp(harness);
    await screen.findByTitle(source);

    const dataTransfer = await startDrag(source);
    await act(async () => {
      harness.emitCommand({ type: "openLocationSheet" });
    });
    const pane = screen.getByTestId("content-pane");
    await act(async () => {
      fireEvent.dragEnter(pane, { dataTransfer });
      fireEvent.dragOver(pane, { dataTransfer });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(readsOf(harness)).toBe(0);
    await endDrag(harness, "none");
    expect(analyzeRequests(harness)).toEqual([]);
  });
});

describe("a drop the disks turn into a move", () => {
  it("is refused when the move would be into the items' own folder", async () => {
    // A disk in /Volumes dragged onto /Volumes: by their paths, a copy to another disk; by
    // the disks, a move onto the one /Volumes is on, into the folder it is in.
    const harness = createAppHarness({
      directorySnapshots: {
        [home]: {
          path: home,
          parentPath: "/Users",
          entries: [
            createDirectoryEntry(source, "file"),
            createDirectoryEntry("/Volumes", "directory"),
          ],
        },
        "/Volumes": {
          path: "/Volumes",
          parentPath: "/",
          entries: [createDirectoryEntry("/Volumes/Backup", "directory")],
        },
      },
    });
    renderApp(harness);
    await openDirectory("/Volumes");
    await pressKey({ key: "t", metaKey: true });

    await dragBetween(await screen.findByTitle("/Volumes/Backup"), tabs()[1]);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(analyzeRequests(harness)).toEqual([]);
  });
});

describe("a window closed with a drag still being followed", () => {
  it("leaves nothing waiting behind", async () => {
    const harness = harnessWithFolders();
    const { unmount } = render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTitle(source);
    await pressKey({ key: "t", metaKey: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Items another app moved away, still being looked for...
    await startDrag(source);
    harness.markGoneFromDisk([source]);
    await endDrag(harness, "move");
    // ...and a tab about to come forward under the next drag.
    const dataTransfer = await startDrag(source);
    await act(async () => {
      fireEvent.dragOver(tabs()[0], { dataTransfer });
    });
    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await waitMs(5000);
    expect(checksFor(harness)).toEqual([]);
  });
});
