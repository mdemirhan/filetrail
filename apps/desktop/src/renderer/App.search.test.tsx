// @vitest-environment jsdom

// Searching and filtering from the window.

import type { IpcRequestInput, WriteOperationProgressEvent } from "@filetrail/contracts";
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
  createAppHarness,
  createDirectoryEntry,
  createTreeChild,
  dragBetween,
  expectNoRefusedRequests,
  openDirectory,
  openSearchResults,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

describe("App copy/paste integration", () => {
  // The search waits for the typing to rest: the tests move the clock on instead of
  // waiting for it. It still runs on by itself, so waitFor and findBy go on working.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves a search selection to the tree and reruns the active search after completion", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    const searchResult = await screen.findByTitle("search:/Users/demo/source.txt");
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(searchResult, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 5,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 5,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });

      await vi.waitFor(() => {
        expect(harness.invocations.filter((call) => call.channel === "search:start")).toHaveLength(
          2,
        );
      });
    });
  });

  it("clears the search field when Escape hides results and restores it with the cached results", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    expect(searchInput.value).toBe("source");

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await vi.waitFor(() => {
      expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    });
    expect(searchInput.value).toBe("");

    await act(async () => {
      fireEvent.focus(searchInput);
    });
    await screen.findByTestId("search-results-pane");
    expect(searchInput.value).toBe("source");
  });

  it("filters the file list while typing and brings it back with Escape", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/Android", "directory"),
            createDirectoryEntry("/Users/demo/Documents", "directory"),
            createDirectoryEntry("/Users/demo/my doc.txt", "file"),
            createDirectoryEntry("/Users/demo/notes.txt", "file"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const contentPane = await screen.findByTestId("content-pane");
    const shownCount = () => screen.getByTestId("content-entry-count").textContent;
    const isSelected = (path: string) => screen.getByTitle(path).getAttribute("data-selected");
    const press = async (key: string) => {
      await act(async () => {
        fireEvent.keyDown(window, { key });
      });
    };
    await vi.waitFor(() => expect(shownCount()).toBe("4"));
    await act(async () => {
      fireEvent.pointerDown(contentPane);
    });

    // "d" is in three names; the one that starts with it is selected, not the first.
    await press("d");
    expect(shownCount()).toBe("3");
    expect(screen.queryByTitle("/Users/demo/notes.txt")).toBeNull();
    expect(isSelected("/Users/demo/Documents")).toBe("true");
    expect(isSelected("/Users/demo/Android")).toBe("false");

    await press("o");
    expect(shownCount()).toBe("2");
    // Space right after a character is part of the text ("my doc"), not Quick Look.
    await press("c");
    await press("Backspace");
    await press("Backspace");
    await press("Backspace");
    await press("y");
    await press(" ");
    await press("d");
    expect(shownCount()).toBe("1");
    expect(isSelected("/Users/demo/my doc.txt")).toBe("true");
    expect(harness.invocations.some((call) => call.channel === "system:quickLook")).toBe(false);

    // Text nothing matches empties the list; Backspace takes a character back.
    await press("z");
    expect(shownCount()).toBe("0");
    await press("Backspace");
    expect(shownCount()).toBe("1");

    // Escape shows the whole folder again and keeps what was found selected.
    await press("Escape");
    expect(shownCount()).toBe("4");
    expect(isSelected("/Users/demo/my doc.txt")).toBe("true");

    // With no filter, Space is Quick Look again and Backspace does nothing to the list.
    await press(" ");
    expect(harness.invocations.some((call) => call.channel === "system:quickLook")).toBe(true);
    await press("Backspace");
    expect(shownCount()).toBe("4");
  });

  it("carries the filter text into search with ⌘F", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const contentPane = await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.pointerDown(contentPane);
    });
    for (const key of ["s", "o", "u"]) {
      await act(async () => {
        fireEvent.keyDown(window, { key });
      });
    }
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", metaKey: true });
      await vi.advanceTimersByTimeAsync(60);
    });

    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    expect(searchInput.value).toBe("sou");
    await screen.findByTestId("search-results-pane");
    expect(
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query),
    ).toEqual(["sou"]);
  });

  it("searches as you type once the keyboard rests, from two characters", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    const type = async (value: string, restMs: number) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await vi.advanceTimersByTimeAsync(restMs);
      });
    };

    await act(async () => {
      searchInput.focus();
    });
    // One character is not searched on its own.
    await type("s", 480);
    expect(searchQueries()).toEqual([]);
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();

    // Keys in quick succession make one search, for the text the typing stopped at.
    await type("so", 60);
    await type("sou", 60);
    expect(searchQueries()).toEqual([]);
    await type("sour", 480);
    expect(searchQueries()).toEqual(["sour"]);
    await screen.findByTestId("search-results-pane");
    expect(
      (
        harness.invocations.find((call) => call.channel === "search:start")?.payload as
          | IpcRequestInput<"search:start">
          | undefined
      )?.patternMode,
    ).toBe("text");
    // The field keeps the keyboard, so typing can go on.
    expect(document.activeElement).toBe(searchInput);

    // Return keeps what typing found and moves into the results, starting at the first.
    const form = searchInput.closest("form");
    if (!form) {
      throw new Error("Missing search form.");
    }
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(searchQueries()).toEqual(["sour"]);
    await vi.waitFor(() => {
      expect(screen.getByTitle("search:/Users/demo/source.txt")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });

    // Text too short to search shows the folder again.
    await type("s", 60);
    await vi.waitFor(() => {
      expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    });
    expect(searchInput.value).toBe("s");
  });

  it("narrows what a search found as more is typed, without searching again", async () => {
    const harness = createAppHarness({
      searchJobs: (query) => ({
        names: ["source.txt", "sonar.txt", "notes.txt"].filter((name) => name.includes(query)),
      }),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    const resultNames = () =>
      screen
        .queryAllByTitle(/^search:/u)
        .map((row) => row.title.replace("search:/Users/demo/", ""));
    const type = async (value: string, restMs = 0) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await vi.advanceTimersByTimeAsync(restMs);
      });
    };

    await act(async () => {
      searchInput.focus();
    });
    await type("so", 480);
    expect(searchQueries()).toEqual(["so"]);
    await vi.waitFor(() => expect(resultNames()).toEqual(["sonar.txt", "source.txt"]));

    // Longer text is covered by the search that ran: it is applied at once, with no wait
    // and no new search.
    await type("sou");
    expect(resultNames()).toEqual(["source.txt"]);
    // Text with no match empties the list straight away.
    await type("soup");
    expect(resultNames()).toEqual([]);
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
    // Taking characters back, down to what was searched for, brings the results back.
    await type("so");
    expect(resultNames()).toEqual(["sonar.txt", "source.txt"]);
    await type("son", 480);
    expect(resultNames()).toEqual(["sonar.txt"]);
    expect(searchQueries()).toEqual(["so"]);

    // Text the search does not cover is searched for, once the typing stops.
    await type("on", 480);
    expect(searchQueries()).toEqual(["so", "on"]);
    await vi.waitFor(() => expect(resultNames()).toEqual(["sonar.txt"]));
  });

  it("never shows the results of one search under the text of another", async () => {
    const harness = createAppHarness({
      searchJobs: (query) =>
        // The second search finds nothing and takes its time over it.
        query === "zz" ? { names: [], running: true } : { names: ["source.txt", "sonar.txt"] },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const type = async (value: string, restMs = 0) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await vi.advanceTimersByTimeAsync(restMs);
      });
    };
    await act(async () => {
      searchInput.focus();
    });
    await type("so", 480);
    await vi.waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));

    // Unrelated text: once its search starts, the old results are gone, although the new
    // search is still running and has found nothing.
    await type("zz", 480);
    expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(0);
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();

    // Putting the results away stops the search that was still running.
    const cancelsBefore = harness.invocations.filter(
      (call) => call.channel === "search:cancel",
    ).length;
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Escape" });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "search:cancel").length,
      ).toBeGreaterThan(cancelsBefore);
    });
    expect(
      harness.invocations.filter((call) => call.channel === "search:cancel").at(-1)?.payload,
    ).toEqual({ jobId: "search-job-2" });
  });

  it("searches for the longer text itself when the search it would narrow stopped at its limit", async () => {
    const harness = createAppHarness({
      searchJobs: (query) =>
        query === "so"
          ? { names: ["source.txt", "sonar.txt"], truncated: true }
          : { names: ["source.txt", "sound.txt"] },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchQueries = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).query);
    const type = async (value: string, restMs = 0) => {
      await act(async () => {
        fireEvent.change(searchInput, { target: { value } });
        await vi.advanceTimersByTimeAsync(restMs);
      });
    };
    await act(async () => {
      searchInput.focus();
    });
    await type("so", 480);
    await vi.waitFor(() => expect(screen.queryAllByTitle(/^search:/u)).toHaveLength(2));

    // A search that stopped at its limit may have missed matches, so it cannot simply be
    // narrowed: the longer text is searched for, and found once each.
    await type("sou", 480);
    expect(searchQueries()).toEqual(["so", "sou"]);
    await vi.waitFor(() => {
      expect(screen.queryAllByTitle(/^search:/u).map((row) => row.title)).toEqual([
        "search:/Users/demo/sound.txt",
        "search:/Users/demo/source.txt",
      ]);
    });
  });

  it("forgets text typed in the search field when Escape or the ✕ is used before it is searched", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    const searchCount = () =>
      harness.invocations.filter((call) => call.channel === "search:start").length;

    // Escape while the search is still waiting for the typing to stop.
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "source" } });
      fireEvent.keyDown(searchInput, { key: "Escape" });
      await vi.advanceTimersByTimeAsync(480);
    });
    expect(searchCount()).toBe(0);
    expect(searchInput.value).toBe("");
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();

    // The ✕ after a search: the field empties and stays empty.
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "source" } });
      await vi.advanceTimersByTimeAsync(480);
    });
    await screen.findByTestId("search-results-pane");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear file search" }));
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(searchInput.value).toBe("");
    expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    expect(searchInput).toHaveFocus();
  });

  it("ends the search with Escape in the search field", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchInput = screen.getByPlaceholderText("Search") as HTMLInputElement;
    await act(async () => {
      searchInput.focus();
      fireEvent.change(searchInput, { target: { value: "source" } });
      await vi.advanceTimersByTimeAsync(480);
    });
    await screen.findByTestId("search-results-pane");

    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Escape" });
    });
    await vi.waitFor(() => {
      expect(screen.queryByTestId("search-results-pane")).not.toBeInTheDocument();
    });
    expect(searchInput.value).toBe("");
    expect(document.activeElement).not.toBe(searchInput);
  });

  it("keeps the caret in the results' filter after a search sent with Return", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    // Return gives the results the keyboard.
    const resultsPane = screen.getByTestId("search-results-pane");
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(resultsPane);
    });

    const filterInput = screen.getByRole("textbox", { name: "Filter results" });
    await act(async () => {
      filterInput.focus();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(document.activeElement).toBe(filterInput);
  });

  it("rejects dropping a search selection onto search results", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openSearchResults();
    const searchResult = await screen.findByTitle("search:/Users/demo/source.txt");
    await dragBetween(searchResult, searchResult);

    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("rejects invalid drag targets like symlink folders and the Trash under Locations", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
            createDirectoryEntry("/Users/demo/Link", "symlink_directory", { isSymlink: true }),
          ],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/Link", "symlink_directory"),
        ],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const symlinkTarget = await screen.findByRole("button", { name: "Link" });
    await dragBetween(sourceButton, symlinkTarget);
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );

    const trashFavorite = await screen.findByTitle("location:/Users/demo/.Trash");
    await dragBetween(sourceButton, trashFavorite);
    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
  });

  it("recursively reloads expanded source branches after a move remaps the current path", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/tmp", "directory"),
            createDirectoryEntry("/Users/demo/tmp2", "directory"),
          ],
        },
        "/Users/demo/tmp": {
          path: "/Users/demo/tmp",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/tmp/test1", "directory")],
        },
        "/Users/demo/tmp/test1": {
          path: "/Users/demo/tmp/test1",
          parentPath: "/Users/demo/tmp",
          entries: [createDirectoryEntry("/Users/demo/tmp/test1/kotlin", "directory")],
        },
        "/Users/demo/tmp/test1/kotlin": {
          path: "/Users/demo/tmp/test1/kotlin",
          parentPath: "/Users/demo/tmp/test1",
          entries: [
            createDirectoryEntry("/Users/demo/tmp/test1/kotlin/composetest1", "directory"),
            createDirectoryEntry("/Users/demo/tmp/test1/kotlin/eza", "directory"),
          ],
        },
        "/Users/demo/tmp/test1/kotlin/composetest1": {
          path: "/Users/demo/tmp/test1/kotlin/composetest1",
          parentPath: "/Users/demo/tmp/test1/kotlin",
          entries: [],
        },
        "/Users/demo/tmp2": {
          path: "/Users/demo/tmp2",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/tmp2/test1", "directory")],
        },
        "/Users/demo/tmp2/test1": {
          path: "/Users/demo/tmp2/test1",
          parentPath: "/Users/demo/tmp2",
          entries: [createDirectoryEntry("/Users/demo/tmp2/test1/kotlin", "directory")],
        },
        "/Users/demo/tmp2/test1/kotlin": {
          path: "/Users/demo/tmp2/test1/kotlin",
          parentPath: "/Users/demo/tmp2/test1",
          entries: [
            createDirectoryEntry("/Users/demo/tmp2/test1/kotlin/composetest1", "directory"),
          ],
        },
        "/Users/demo/tmp2/test1/kotlin/composetest1": {
          path: "/Users/demo/tmp2/test1/kotlin/composetest1",
          parentPath: "/Users/demo/tmp2/test1/kotlin",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/tmp", "directory"),
          createTreeChild("/Users/demo/tmp2", "directory"),
        ],
        "/Users/demo/tmp": [createTreeChild("/Users/demo/tmp/test1", "directory")],
        "/Users/demo/tmp/test1": [createTreeChild("/Users/demo/tmp/test1/kotlin", "directory")],
        "/Users/demo/tmp/test1/kotlin": [
          createTreeChild("/Users/demo/tmp/test1/kotlin/composetest1", "directory"),
          createTreeChild("/Users/demo/tmp/test1/kotlin/eza", "directory"),
        ],
        "/Users/demo/tmp2": [createTreeChild("/Users/demo/tmp2/test1", "directory")],
        "/Users/demo/tmp2/test1": [createTreeChild("/Users/demo/tmp2/test1/kotlin", "directory")],
        "/Users/demo/tmp2/test1/kotlin": [
          createTreeChild("/Users/demo/tmp2/test1/kotlin/composetest1", "directory"),
        ],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openDirectory("/Users/demo/tmp");
    await openDirectory("/Users/demo/tmp/test1");
    await openDirectory("/Users/demo/tmp/test1/kotlin");
    await openDirectory("/Users/demo/tmp/test1/kotlin/composetest1");

    expect(screen.getByTestId("content-current-path")).toHaveTextContent(
      "/Users/demo/tmp/test1/kotlin/composetest1",
    );

    const treeLoadCountBeforeMove = harness.invocations.filter(
      (call) => call.channel === "tree:getChildren",
    ).length;

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "move_to",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        runtimeConflict: null,
        result: {
          operationId: "copy-op-1",
          action: "move_to",
          status: "completed",
          targetPath: "/Users/demo/tmp2",
          startedAt: "2026-03-11T00:00:00.000Z",
          finishedAt: "2026-03-11T00:00:01.000Z",
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
              sourcePath: "/Users/demo/tmp/test1",
              destinationPath: "/Users/demo/tmp2/test1",
              status: "completed",
              error: null,
              skipReason: null,
            },
          ],
          error: null,
        },
      } satisfies WriteOperationProgressEvent);
    });

    await vi.waitFor(() => {
      const treeLoadsAfterMove = harness.invocations
        .slice(treeLoadCountBeforeMove)
        .filter((call) => call.channel === "tree:getChildren")
        .map((call) => (call.payload as IpcRequestInput<"tree:getChildren">).path);
      expect(treeLoadsAfterMove).toEqual(
        expect.arrayContaining([
          "/Users/demo/tmp",
          "/Users/demo/tmp/test1",
          "/Users/demo/tmp/test1/kotlin",
        ]),
      );
    });
  });
});
