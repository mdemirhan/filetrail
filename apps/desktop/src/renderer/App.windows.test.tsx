// @vitest-environment jsdom

// Several windows: opening one, moving tabs between them, and what they share (the
// clipboard, the one file operation that can run at a time).

import type { IpcRequestInput } from "@filetrail/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";

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
  type TestProgressEvent,
  clipboardButton,
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  finishedResultEvent,
  openDirectory,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

type Harness = ReturnType<typeof createAppHarness>;

const savedTab = (path: string) => ({
  path,
  treeRootPath: "/Users/demo",
  favoritePath: null,
  viewMode: "details" as const,
  searchViewMode: "details" as const,
  sortBy: "name" as const,
  sortDirection: "asc" as const,
  includeHidden: false,
  foldersFirst: true,
  favoritesExpanded: true,
  locationsExpanded: true,
});

const tabLabels = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);

function openWindowRequests(harness: Harness): Array<IpcRequestInput<"app:openWindow">> {
  return harness.invocations
    .filter((call) => call.channel === "app:openWindow")
    .map((call) => call.payload as IpcRequestInput<"app:openWindow">);
}

async function command(harness: Harness, type: Parameters<Harness["emitCommand"]>[0]["type"]) {
  await act(async () => {
    harness.emitCommand({ type });
  });
}

async function ready(harness: Harness) {
  renderApp(harness);
  await screen.findByRole("button", { name: "source.txt" });
}

// A copy another window started, partway through.
function otherWindowsCopy(status: "running" | "completed"): TestProgressEvent {
  const finished = finishedResultEvent("copy", "completed", [
    { sourcePath: "/Users/demo/elsewhere.txt", status: "completed", error: null },
  ]);
  return status === "completed"
    ? { ...finished, operationId: "other-op" }
    : {
        ...finished,
        operationId: "other-op",
        status: "running",
        completedItemCount: 0,
        currentSourcePath: "/Users/demo/elsewhere.txt",
        result: null,
      };
}

describe("App windows", () => {
  it("opens a new window on the folder on screen, shown the same way", async () => {
    const harness = createAppHarness();
    await ready(harness);
    await openDirectory("/Users/demo/Folder");

    await command(harness, "newWindow");

    await waitFor(() =>
      expect(openWindowRequests(harness)).toEqual([
        {
          tabs: [
            expect.objectContaining({
              path: "/Users/demo/Folder",
              treeRootPath: "/Users/demo",
              viewMode: "details",
            }),
          ],
          activeTabIndex: 0,
        },
      ]),
    );
  });

  it("opens the selected folder in a new window", async () => {
    const harness = createAppHarness();
    await ready(harness);
    await selectItem("/Users/demo/Folder");

    await command(harness, "openSelectionInNewWindow");

    await waitFor(() =>
      expect(openWindowRequests(harness)[0]?.tabs[0]).toMatchObject({
        path: "/Users/demo/Folder",
        favoritePath: null,
      }),
    );
  });

  it("moves the tab on screen to a new window, and not into Reopen Closed Tab", async () => {
    const harness = createAppHarness();
    await ready(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    expect(tabLabels()).toEqual(["demo", "Folder"]);

    await command(harness, "moveTabToNewWindow");

    await waitFor(() => expect(tabLabels()).toEqual([]));
    expect(openWindowRequests(harness)[0]?.tabs[0]?.path).toBe("/Users/demo/Folder");
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    await pressKey({ key: "t", metaKey: true, shiftKey: true });
    expect(tabLabels()).toEqual([]);
  });

  describe("the tab's menu", () => {
    async function openTabMenu(index: number) {
      await act(async () => {
        fireEvent.contextMenu(screen.getAllByRole("tab")[index] as HTMLElement);
      });
    }

    it("moves the tab it was opened on to a new window, even one in the background", async () => {
      const harness = createAppHarness();
      await ready(harness);
      await pressKey({ key: "t", metaKey: true });
      await openDirectory("/Users/demo/Folder");

      // The first tab, in the background.
      await openTabMenu(0);
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Move Tab to New Window" }));
      });

      await waitFor(() => expect(tabLabels()).toEqual([]));
      expect(openWindowRequests(harness)[0]?.tabs[0]?.path).toBe("/Users/demo");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });

    it("merges the windows, offered only with another window open", async () => {
      const harness = createAppHarness({
        explorerWindowCount: 2,
        mergedTabs: [savedTab("/Users/demo/Folder")],
      });
      await ready(harness);
      await pressKey({ key: "t", metaKey: true });

      await openTabMenu(0);
      const merge = screen.getByRole("menuitem", { name: "Merge All Windows" });
      await waitFor(() => expect(merge).toBeEnabled());
      await act(async () => {
        fireEvent.click(merge);
      });

      await waitFor(() => expect(tabLabels()).toEqual(["demo", "demo", "Folder"]));
    });

    it("dims Merge All Windows with one window", async () => {
      const harness = createAppHarness();
      await ready(harness);
      await pressKey({ key: "t", metaKey: true });

      await openTabMenu(1);

      await waitFor(() =>
        expect(
          harness.invocations.some((call) => call.channel === "app:getExplorerWindowCount"),
        ).toBe(true),
      );
      expect(screen.getByRole("menuitem", { name: "Merge All Windows" })).toBeDisabled();
      expect(screen.getByRole("menuitem", { name: "Move Tab to New Window" })).toBeEnabled();
    });
  });

  it("doesn't move the only tab, which says so in the menu", async () => {
    const harness = createAppHarness();
    await ready(harness);

    await command(harness, "moveTabToNewWindow");

    expect(openWindowRequests(harness)).toEqual([]);
    expect(harness.menuStates.at(-1)?.disabledCommands).toContain("moveTabToNewWindow");
  });

  it("adds the other windows' tabs after its own when they are merged", async () => {
    const harness = createAppHarness({
      mergedTabs: [savedTab("/Users/demo/Folder"), savedTab("/Users/demo/Music")],
      itemPropertiesByPath: { "/Users/demo/Music": "missing" },
    });
    await ready(harness);

    await command(harness, "mergeAllWindows");

    // A merged tab whose folder is gone is dropped.
    await waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));
    expect(screen.getAllByRole("tab")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("opens the tabs it was given, whatever Reopen the last folder and tabs says", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreSessionOnStartup: false,
        openTabs: [savedTab("/Users/demo"), savedTab("/Users/demo/Folder")],
        activeTabIndex: 1,
      },
      launchContext: { startupFolderPath: null, restoreTabs: true },
    });
    renderApp(harness);

    await waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
    );
  });

  it("names the window after its front tab", async () => {
    const harness = createAppHarness();
    await ready(harness);
    await waitFor(() => expect(document.title).toBe("demo"));

    await openDirectory("/Users/demo/Folder");

    await waitFor(() => expect(document.title).toBe("Folder"));
  });

  it("closes an item's menu when another window or app is clicked", async () => {
    const harness = createAppHarness();
    await ready(harness);
    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    expect(screen.getByRole("button", { name: /^Open in New Window/ })).toBeInTheDocument();

    await act(async () => {
      fireEvent.blur(window);
    });

    expect(screen.queryByRole("button", { name: /^Open in New Window/ })).not.toBeInTheDocument();
  });

  describe("the clipboard", () => {
    it("tells the other windows what was copied", async () => {
      const harness = createAppHarness();
      await ready(harness);
      await selectItem("/Users/demo/source.txt");

      await pressKey({ key: "c", metaKey: true });

      await waitFor(() =>
        expect(
          harness.invocations.filter((call) => call.channel === "app:setClipboard").at(-1)?.payload,
        ).toMatchObject({
          clipboard: { type: "ready", mode: "copy", sourcePaths: ["/Users/demo/source.txt"] },
        }),
      );
    });

    it("pastes what was cut in another window", async () => {
      const harness = createAppHarness();
      await ready(harness);
      await openDirectory("/Users/demo/Folder");
      expect(clipboardButton()).toBeNull();

      await act(async () => {
        harness.emitClipboardChanged({
          type: "ready",
          mode: "cut",
          sourcePaths: ["/Users/demo/source.txt"],
          sourceEntries: {},
          capturedAt: "2026-10-07T10:00:00.000Z",
        });
      });
      expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
      await pressKey({ key: "v", metaKey: true });

      await waitFor(() =>
        expect(
          harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
        ).toMatchObject({
          mode: "cut",
          sourcePaths: ["/Users/demo/source.txt"],
          destinationDirectoryPath: "/Users/demo/Folder",
        }),
      );
      // A change made elsewhere isn't sent back.
      expect(harness.invocations.some((call) => call.channel === "app:setClipboard")).toBe(false);
    });

    it("opens with what was copied before the window opened", async () => {
      const harness = createAppHarness({
        clipboard: {
          type: "ready",
          mode: "copy",
          sourcePaths: ["/Users/demo/source.txt"],
          sourceEntries: {},
          capturedAt: "2026-10-07T10:00:00.000Z",
        },
      });
      await ready(harness);

      await waitFor(() =>
        expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied"),
      );
    });
  });

  describe("an operation another window runs", () => {
    it("keeps this window from starting another until it ends", async () => {
      const harness = createAppHarness();
      await ready(harness);
      await act(async () => {
        harness.emitProgress(otherWindowsCopy("running"));
      });
      // Its card is in the window that started it, not here.
      expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "Backspace", metaKey: true });
      const dialog = await screen.findByRole("dialog", { name: "Couldn’t Move to Trash" });
      expect(dialog).toHaveTextContent("Another file operation is running.");
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
      });
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        false,
      );
      expect(harness.menuStates.at(-1)?.disabledCommands).toContain("trashSelection");

      await act(async () => {
        harness.emitProgress(otherWindowsCopy("completed"));
      });
      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "Backspace", metaKey: true });
      await waitFor(() =>
        expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
          true,
        ),
      );
    });

    it("shows it here once this window takes it over, and leaves the selection alone", async () => {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo/Folder": {
            path: "/Users/demo/Folder",
            parentPath: "/Users/demo",
            entries: [createDirectoryEntry("/Users/demo/Folder/keep.txt", "file")],
          },
        },
      });
      await ready(harness);
      await openDirectory("/Users/demo/Folder");
      await act(async () => {
        harness.emitProgress(otherWindowsCopy("running"));
      });
      await selectItem("/Users/demo/Folder/keep.txt");

      await act(async () => {
        harness.emitWriteOperationAdopted({
          operationId: "other-op",
          event: {
            operationId: "other-op",
            action: "paste",
            status: "running",
            completedItemCount: 0,
            totalItemCount: 1,
            completedByteCount: 0,
            totalBytes: 5,
            currentSourcePath: "/Users/demo/elsewhere.txt",
            currentDestinationPath: null,
            result: null,
          },
        });
      });
      expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();

      // The copy arrives in the folder on screen.
      harness.setDirectoryEntries("/Users/demo/Folder", [
        createDirectoryEntry("/Users/demo/Folder/keep.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder/elsewhere.txt", "file"),
      ]);
      await act(async () => {
        harness.emitProgress(otherWindowsCopy("completed"));
      });

      await waitFor(() =>
        expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument(),
      );
      // What it would have selected belonged to the window that started it.
      expect(await screen.findByTitle("/Users/demo/Folder/elsewhere.txt")).toHaveAttribute(
        "data-selected",
        "false",
      );
      expect(screen.getByTitle("/Users/demo/Folder/keep.txt")).toHaveAttribute(
        "data-selected",
        "true",
      );
      // It is over: this window may start the next one.
      await pressKey({ key: "Backspace", metaKey: true });
      await waitFor(() =>
        expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
          true,
        ),
      );
    });
  });
});
