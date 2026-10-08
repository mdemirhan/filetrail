// @vitest-environment jsdom

// Back puts the list back where it was scrolled, with the real list views: each brings the
// selection into view as it is drawn, and the window then scrolls it back.

import { act, fireEvent, render, waitFor } from "@testing-library/react";

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
import { createAppHarness, createDirectoryEntry, expectNoRefusedRequests } from "./test/appHarness";

afterEach(expectNoRefusedRequests);

const itemPath = (index: number) => `/Users/demo/item-${String(index).padStart(3, "0")}.txt`;

describe("App scroll position on Back", () => {
  let restoreSize: () => void;
  beforeEach(() => {
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    // Room to scroll across the list's columns.
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(100_000);
    restoreSize = () => {
      height.mockRestore();
      width.mockRestore();
      scrollWidth.mockRestore();
    };
  });
  afterEach(() => restoreSize());

  // List view brought the selection into view after the window had scrolled back.
  it.each([
    ["details", "scrollTop"],
    ["list", "scrollLeft"],
    ["icons", "scrollTop"],
  ] as const)("puts back where the %s view was scrolled", async (viewMode, scroll) => {
    const harness = createAppHarness({
      preferences: { viewMode },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: Array.from({ length: 300 }, (_, index) =>
            createDirectoryEntry(itemPath(index), "file"),
          ),
        },
        "/Users": {
          path: "/Users",
          parentPath: "/",
          entries: [createDirectoryEntry("/Users/demo", "directory")],
        },
      },
    });
    const { container } = render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    const item = (path: string) =>
      container.querySelector<HTMLElement>(`[data-selectable-entry-path="${path}"]`);
    const scroller = () => {
      const element = container.querySelector<HTMLElement>(".content-scroll");
      if (!element) {
        throw new Error("Missing the list's scroll area.");
      }
      return element;
    };
    await waitFor(() => expect(item(itemPath(1))).not.toBeNull());
    await act(async () => {
      fireEvent.pointerDown(item(itemPath(1)) as HTMLElement, { button: 0 });
    });
    expect(item(itemPath(1))).toHaveAttribute("aria-selected", "true");
    // Scrolled away from the selected item.
    await act(async () => {
      scroller()[scroll] = 3_000;
      fireEvent.scroll(scroller());
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
    });
    await waitFor(() => expect(item("/Users/demo")).not.toBeNull());
    await act(async () => {
      fireEvent.keyDown(window, { key: "[", metaKey: true });
    });
    await waitFor(() => expect(item(itemPath(1))).not.toBeNull());

    expect(item(itemPath(1))).toHaveAttribute("aria-selected", "true");
    expect(scroller()[scroll]).toBe(3_000);
  });
});

describe("App scroll position when an item leaves", () => {
  let restoreSize: () => void;
  beforeEach(() => {
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    restoreSize = () => {
      height.mockRestore();
      width.mockRestore();
    };
  });
  afterEach(() => {
    restoreSize();
    vi.useRealTimers();
  });

  const folderPath = (index: number) => `/Users/demo/dir-${String(index).padStart(3, "0")}`;

  // Sorted by size, the folder moved to the Trash has its size forgotten as the Trash ends,
  // while the folder is still listed until it is read again: it sorted last, and the list
  // followed it there, as it follows a selected item that sizes coming in move.
  it("stays at the top of a list sorted by size when its first folder goes to the Trash", async () => {
    const folders = Array.from({ length: 60 }, (_, index) => folderPath(index));
    const harness = createAppHarness({
      preferences: { viewMode: "details", sortBy: "size", sortDirection: "desc" },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: folders.map((path) => createDirectoryEntry(path, "directory")),
        },
      },
    });
    // The main process knows each folder's size, but no longer the trashed one's.
    const forgotten = new Set<string>();
    const invoke = harness.client.invoke.bind(harness.client);
    harness.client.invoke = ((channel, payload) => {
      if (channel === "folderSize:probeMany") {
        const { paths } = payload as { paths: string[] };
        return Promise.resolve({
          sizes: paths
            .filter((path) => folders.includes(path) && !forgotten.has(path))
            .map((path) => {
              const sizeBytes = (folders.indexOf(path) + 1) * 1_000;
              return { path, sizeBytes, diskBytes: sizeBytes, fileCount: 1, folderCount: 0 };
            }),
        });
      }
      return invoke(channel, payload);
    }) as typeof harness.client.invoke;
    const { container } = render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    const largest = folderPath(59);
    const row = (path: string) =>
      container.querySelector<HTMLElement>(`[data-selectable-entry-path="${path}"]`);
    const scroller = () => container.querySelector<HTMLElement>(".content-scroll") as HTMLElement;
    // Sorted by the sizes: the largest folder is the first row.
    await waitFor(() => {
      const first = container.querySelector("[data-selectable-entry-path]");
      expect(first?.getAttribute("data-selectable-entry-path")).toBe(largest);
    });
    await act(async () => {
      fireEvent.pointerDown(row(largest) as HTMLElement, { button: 0 });
    });
    expect(scroller().scrollTop).toBe(0);

    await act(async () => {
      fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    });
    // Sizes are drawn again a moment after they change.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The folder is read again only after the Trash has ended.
    const release = harness.holdDirectorySnapshot("/Users/demo");
    forgotten.add(largest);
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-trash",
        action: "trash",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        runtimeConflict: null,
        result: {
          operationId: "write-op-trash",
          action: "trash",
          status: "completed",
          targetPath: null,
          startedAt: "2026-10-08T10:00:00.000Z",
          finishedAt: "2026-10-08T10:00:01.000Z",
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
              sourcePath: largest,
              destinationPath: null,
              status: "completed",
              error: null,
              skipReason: null,
            },
          ],
          error: null,
        },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(scroller().scrollTop).toBe(0);

    harness.setDirectoryEntries(
      "/Users/demo",
      folders.slice(0, 59).map((path) => createDirectoryEntry(path, "directory")),
    );
    await act(async () => {
      release();
    });
    await waitFor(() => expect(row(largest)).toBeNull());
    expect(scroller().scrollTop).toBe(0);
  });
});
