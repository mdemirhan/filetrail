// @vitest-environment jsdom

// Several windows: opening one, moving tabs between them, and what they share (the
// clipboard, the one file operation that can run at a time).

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";
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

import { OPEN_TABS_LIMIT } from "../shared/appPreferences";
import {
  type TestProgressEvent,
  clipboardButton,
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  finishedResultEvent,
  openDirectory,
  pasteSourceIntoFolder,
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

function mergeAnswers(harness: Harness): Array<IpcRequestInput<"app:answerMergeRequest">> {
  return harness.invocations
    .filter((call) => call.channel === "app:answerMergeRequest")
    .map((call) => call.payload as IpcRequestInput<"app:answerMergeRequest">);
}

// Holds the window's requests on `channel`, each until it is answered or refused by hand.
function holdRequests<C extends IpcChannel>(harness: Harness, channel: C) {
  const held: Array<{
    answer: (response: IpcResponse<C>) => void;
    refuse: (error: Error) => void;
  }> = [];
  const invoke = harness.client.invoke.bind(harness.client);
  harness.client.invoke = ((requested: IpcChannel, payload: never) =>
    requested === channel
      ? new Promise((answer, refuse) => {
          held.push({ answer, refuse });
        })
      : invoke(requested, payload)) as Harness["client"]["invoke"];
  return held;
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

  it("asks only for as many tabs as fit beside its own", async () => {
    const harness = createAppHarness({ explorerWindowCount: 2 });
    await ready(harness);
    await pressKey({ key: "t", metaKey: true });

    await command(harness, "mergeAllWindows");

    await waitFor(() =>
      expect(
        harness.invocations.find((call) => call.channel === "app:mergeAllWindows")?.payload,
      ).toEqual({ tabCount: 2 }),
    );
  });

  it("gives Merge All Windows in another window its tabs as they are now", async () => {
    const harness = createAppHarness();
    await ready(harness);
    // Not saved yet: the tabs are written a moment after each change.
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      harness.emitMergeRequest("merge-1");
    });

    const answers = () =>
      harness.invocations
        .filter((call) => call.channel === "app:answerMergeRequest")
        .map((call) => call.payload as IpcRequestInput<"app:answerMergeRequest">);
    await waitFor(() => expect(answers()).toHaveLength(1));
    expect(answers()[0]?.requestId).toBe("merge-1");
    expect(answers()[0]?.busy).toBe(false);
    expect(answers()[0]?.tabs.map((tab) => tab.path)).toEqual(["/Users/demo/Folder"]);

    // With a sheet open, the window stays open rather than lose it.
    await command(harness, "openLocationSheet");
    await act(async () => {
      harness.emitMergeRequest("merge-2");
    });
    await waitFor(() => expect(answers()).toHaveLength(2));
    expect(answers()[1]).toMatchObject({ requestId: "merge-2", busy: true });
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

  it("goes to the Go menu's place it was opened for, once", async () => {
    const harness = createAppHarness({
      launchContext: { startupFolderPath: null, initialCommand: "goDocuments" },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
    });
    renderApp(harness);

    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Documents"),
    );
    // Back goes to where the window opened.
    await pressKey({ key: "[", metaKey: true });
    await waitFor(() =>
      expect(screen.getByTestId("content-current-path")).toHaveTextContent(/^\/Users\/demo$/),
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

    it("tells main which cut a paste clears, for the window that may take it over", async () => {
      const harness = createAppHarness({
        planResponse: {
          mode: "cut",
          sourcePaths: ["/Users/demo/source.txt"],
          destinationDirectoryPath: "/Users/demo/Folder",
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              kind: "file",
              status: "ready",
              sizeBytes: 5,
            },
          ],
          issues: [],
          warnings: [],
          summary: { topLevelItemCount: 1, totalItemCount: 1, totalBytes: 5 },
        },
      });
      await ready(harness);

      await pasteSourceIntoFolder(harness, "x");

      const cut = harness.invocations.find((call) => call.channel === "app:setClipboard")
        ?.payload as IpcRequestInput<"app:setClipboard">;
      expect(cut.clipboard).toMatchObject({ type: "ready", mode: "cut" });
      expect(
        harness.invocations.find((call) => call.channel === "copyPaste:start")?.payload,
      ).toMatchObject({
        clearsCutClipboard: cut.clipboard.type === "ready" ? cut.clipboard.capturedAt : "",
      });
    });

    it("clears a cut once a paste of it, taken over here, has moved it", async () => {
      const harness = createAppHarness();
      await ready(harness);
      await act(async () => {
        harness.emitClipboardChanged({
          type: "ready",
          mode: "cut",
          sourcePaths: ["/Users/demo/elsewhere.txt"],
          sourceEntries: {},
          capturedAt: "2026-10-07T10:00:00.000Z",
        });
        harness.emitProgress({ ...otherWindowsCopy("running"), action: "paste" });
      });
      expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");

      // The window that started it closed.
      await act(async () => {
        harness.emitWriteOperationAdopted({
          operationId: "other-op",
          event: null,
          clearsCutClipboard: "2026-10-07T10:00:00.000Z",
        });
      });
      await act(async () => {
        harness.emitProgress({ ...otherWindowsCopy("completed"), action: "paste" });
      });

      await waitFor(() => expect(clipboardButton()).toBeNull());
      expect(
        harness.invocations.filter((call) => call.channel === "app:setClipboard").at(-1)?.payload,
      ).toEqual({ clipboard: { type: "empty" } });
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
  describe("Merge All Windows under way", () => {
    it("merges once at a time, and answers another window's merge as busy meanwhile", async () => {
      const harness = createAppHarness({
        explorerWindowCount: 2,
        mergedTabs: [savedTab("/Users/demo/Folder")],
      });
      const merges = holdRequests(harness, "app:mergeAllWindows");
      await ready(harness);

      await command(harness, "mergeAllWindows");
      await command(harness, "mergeAllWindows");
      expect(merges).toHaveLength(1);
      // Chosen in another window at the same moment: this window stays open.
      await act(async () => {
        harness.emitMergeRequest("merge-1");
      });
      await waitFor(() => expect(mergeAnswers(harness)).toHaveLength(1));
      expect(mergeAnswers(harness)[0]).toMatchObject({ requestId: "merge-1", busy: true });

      await act(async () => {
        merges[0]?.answer({ tabs: [savedTab("/Users/demo/Folder")] });
      });
      await waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));
      await act(async () => {
        harness.emitMergeRequest("merge-2");
      });
      await waitFor(() => expect(mergeAnswers(harness)).toHaveLength(2));
      expect(mergeAnswers(harness)[1]).toMatchObject({ requestId: "merge-2", busy: false });
      // Over, even when the merge failed: another may start.
      await command(harness, "mergeAllWindows");
      expect(merges).toHaveLength(2);
      await act(async () => {
        merges[1]?.refuse(new Error("No window."));
      });
      await command(harness, "mergeAllWindows");
      expect(merges).toHaveLength(3);
    });

    it("doesn't merge before the window has opened its first folder", async () => {
      const harness = createAppHarness({ explorerWindowCount: 2 });
      const merges = holdRequests(harness, "app:mergeAllWindows");
      const launches = holdRequests(harness, "app:getLaunchContext");
      renderApp(harness);
      await waitFor(() => expect(launches).toHaveLength(1));

      await command(harness, "mergeAllWindows");

      expect(merges).toEqual([]);
      await act(async () => {
        launches[0]?.answer({ startupFolderPath: null });
      });
      await screen.findByRole("button", { name: "source.txt" });
    });

    it("brings back a merged tab with Reopen Closed Tab once it is closed", async () => {
      const harness = createAppHarness({ mergedTabs: [savedTab("/Users/demo/Folder")] });
      await ready(harness);
      await command(harness, "mergeAllWindows");
      await waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));

      await act(async () => {
        fireEvent.contextMenu(screen.getAllByRole("tab")[1] as HTMLElement);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Close Tab" }));
      });
      expect(tabLabels()).toEqual([]);
      await pressKey({ key: "T", metaKey: true, shiftKey: true });

      await waitFor(() =>
        expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder"),
      );
      expect(tabLabels()).toEqual(["demo", "Folder"]);
    });
  });

  describe("Move Tab to New Window under way", () => {
    async function twoTabs(harness: Harness) {
      await ready(harness);
      await pressKey({ key: "t", metaKey: true });
      await openDirectory("/Users/demo/Folder");
      expect(tabLabels()).toEqual(["demo", "Folder"]);
    }

    it("keeps the tab when the new window doesn't open", async () => {
      const harness = createAppHarness();
      const opens = holdRequests(harness, "app:openWindow");
      await twoTabs(harness);

      await command(harness, "moveTabToNewWindow");
      await act(async () => {
        opens[0]?.answer({ ok: false });
      });
      expect(tabLabels()).toEqual(["demo", "Folder"]);
      await command(harness, "moveTabToNewWindow");
      await act(async () => {
        opens[1]?.refuse(new Error("Quitting."));
      });

      expect(tabLabels()).toEqual(["demo", "Folder"]);
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });

    it("moves a tab once when Move is chosen again before the window opens", async () => {
      const harness = createAppHarness();
      const opens = holdRequests(harness, "app:openWindow");
      await twoTabs(harness);
      await pressKey({ key: "t", metaKey: true });

      await command(harness, "moveTabToNewWindow");
      await command(harness, "moveTabToNewWindow");
      expect(opens).toHaveLength(1);
      await act(async () => {
        opens[0]?.answer({ ok: true });
      });

      await waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));
    });

    it("doesn't close the window when another tab closed while the window opened", async () => {
      const harness = createAppHarness();
      const opens = holdRequests(harness, "app:openWindow");
      await twoTabs(harness);

      await command(harness, "moveTabToNewWindow");
      await act(async () => {
        fireEvent.contextMenu(screen.getAllByRole("tab")[0] as HTMLElement);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Close Tab" }));
      });
      await act(async () => {
        opens[0]?.answer({ ok: true });
      });

      expect(harness.invocations.some((call) => call.channel === "app:closeWindow")).toBe(false);
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
  });

  describe("a window full of tabs", () => {
    const fullWindow = () =>
      createAppHarness({
        explorerWindowCount: 2,
        preferences: {
          openTabs: Array.from({ length: OPEN_TABS_LIMIT }, () => savedTab("/Users/demo")),
          activeTabIndex: 0,
        },
      });

    it("opens no more tabs than it can hand over, and says why", async () => {
      const harness = fullWindow();
      await ready(harness);
      await waitFor(() => expect(tabLabels()).toHaveLength(OPEN_TABS_LIMIT));

      await pressKey({ key: "t", metaKey: true });
      await selectItem("/Users/demo/Folder");
      await command(harness, "openSelectionInNewTab");

      const viewport = await screen.findByTestId("toast-viewport");
      await vi.waitFor(() => {
        expect(viewport).toHaveTextContent(`A window can have up to ${OPEN_TABS_LIMIT} tabs`);
      });
      expect(tabLabels()).toHaveLength(OPEN_TABS_LIMIT);
      // Merged away into another window, it loses none of them.
      await act(async () => {
        harness.emitMergeRequest("merge-1");
      });
      await waitFor(() => expect(mergeAnswers(harness)).toHaveLength(1));
      expect(mergeAnswers(harness)[0]?.tabs).toHaveLength(OPEN_TABS_LIMIT);
      expect(mergeAnswers(harness)[0]?.busy).toBe(false);
    });

    it("duplicates and reopens no tab past the limit", async () => {
      const harness = fullWindow();
      await ready(harness);
      await waitFor(() => expect(tabLabels()).toHaveLength(OPEN_TABS_LIMIT));
      await pressKey({ key: "w", metaKey: true });
      await waitFor(() => expect(tabLabels()).toHaveLength(OPEN_TABS_LIMIT - 1));
      await act(async () => {
        fireEvent.contextMenu(screen.getAllByRole("tab")[0] as HTMLElement);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate Tab" }));
      });
      await waitFor(() => expect(tabLabels()).toHaveLength(OPEN_TABS_LIMIT));

      await act(async () => {
        fireEvent.contextMenu(screen.getAllByRole("tab")[0] as HTMLElement);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate Tab" }));
      });
      await pressKey({ key: "T", metaKey: true, shiftKey: true });

      expect(tabLabels()).toHaveLength(OPEN_TABS_LIMIT);
    });
  });

  it("marks its background tabs out of date when another window's operation ends", async () => {
    const harness = createAppHarness();
    await ready(harness);
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    await act(async () => {
      harness.emitProgress(otherWindowsCopy("running"));
    });
    await act(async () => {
      harness.emitProgress(otherWindowsCopy("completed"));
    });
    const readsBefore = harness.invocations.length;
    const treeReads = () =>
      harness.invocations
        .slice(readsBefore)
        .filter(
          (call) =>
            call.channel === "tree:getChildren" &&
            (call.payload as { path: string }).path === "/Users/demo",
        ).length;

    await act(async () => {
      fireEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);
    });

    // The tree the tab shows is read again, as well as the folder's place in it.
    await waitFor(() => expect(treeReads()).toBe(2));
  });
});
