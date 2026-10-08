// @vitest-environment jsdom

// The window's own drags, which the system drags: where they end, what the window does
// when it hears they have, and the tabs they spring into folders in.

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
  analyzeRequests,
  createAppHarness,
  createDirectoryEntry,
  createMockDataTransfer,
  installDragEventWithModifiers,
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
