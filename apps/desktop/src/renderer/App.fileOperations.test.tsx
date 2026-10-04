// @vitest-environment jsdom

// File operations as Finder does them: dialogs, destinations, what is shown when an
// operation ends, the Trash and New Folder.

import type { IpcRequestInput, WriteOperationProgressEvent } from "@filetrail/contracts";
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

import { App } from "./App";
import { FiletrailClientProvider } from "./lib/filetrailClient";
import {
  type TestProgressEvent,
  analyzeRequests,
  clearContentSelection,
  clipboardButton,
  createAppHarness,
  createDirectoryEntry,
  createNodeFingerprint,
  cutPlan,
  dragBetween,
  dragWithKeys,
  expectNoRefusedRequests,
  failedResultEvent,
  finishedResultEvent,
  finishedWriteEvent,
  folderConflictPlan,
  installDragEventWithModifiers,
  missingSourceIssue,
  openDirectory,
  openNewFolderFromFolderMenu,
  openSearchResults,
  pasteSourceIntoFolder,
  planForRequest,
  pressKey,
  renameSelectionTo,
  renderApp,
  sameFolderIssue,
  selectItem,
  toAnalysisReport,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

describe("App copy/paste dialogs and destinations", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const reviewSheetName = "“Folder” already exists in “demo”";

  async function openFolderReviewSheet(
    harnessArgs: Parameters<typeof createAppHarness>[0] = {},
  ): Promise<{ harness: ReturnType<typeof createAppHarness>; sheet: HTMLElement }> {
    const harness = createAppHarness({ planResponse: folderConflictPlan(), ...harnessArgs });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });
    const sheet = await screen.findByRole("dialog", { name: reviewSheetName });
    return { harness, sheet };
  }

  // fireEvent returns false when a listener called preventDefault.
  function expectKeysReachDialog(element: HTMLElement) {
    element.focus();
    expect(element).toHaveFocus();
    for (const key of ["Tab", "Enter", " "]) {
      expect(fireEvent.keyDown(element, { key })).toBe(true);
    }
  }

  it("lets Tab, Return and Space through inside the review sheet", async () => {
    const { sheet } = await openFolderReviewSheet();

    expectKeysReachDialog(within(sheet).getByRole("button", { name: "Cancel" }));
    // Keys aimed at the explorer behind the sheet are still swallowed.
    expect(fireEvent.keyDown(window, { key: "ArrowDown" })).toBe(false);
  });

  it("closes the review sheet with Escape while a button has focus", async () => {
    const { sheet, harness } = await openFolderReviewSheet();

    const startButton = within(sheet).getByRole("button", { name: "Duplicate" });
    startButton.focus();
    await act(async () => {
      fireEvent.keyDown(startButton, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog", { name: reviewSheetName })).not.toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("closes the review sheet with Cmd+. like Escape", async () => {
    const { sheet } = await openFolderReviewSheet();

    const cancelButton = within(sheet).getByRole("button", { name: "Cancel" });
    cancelButton.focus();
    await act(async () => {
      fireEvent.keyDown(cancelButton, { key: ".", metaKey: true });
    });

    expect(screen.queryByRole("dialog", { name: reviewSheetName })).not.toBeInTheDocument();
  });

  it("starts a reviewed operation once even when the start button is clicked twice", async () => {
    const { sheet, harness } = await openFolderReviewSheet({ deferCopyPasteStart: true });

    const startButton = within(sheet).getByRole("button", { name: "Duplicate" });
    await act(async () => {
      fireEvent.click(startButton);
      fireEvent.click(startButton);
    });
    await act(async () => {
      harness.resolveCopyPasteStart();
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: reviewSheetName })).not.toBeInTheDocument();
    });
    expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
      1,
    );
  });

  // Stop pressed while the start request was on its way did nothing, and the paste ran to
  // the end.
  it("stops an operation whose Stop came while it was being started", async () => {
    const { sheet, harness } = await openFolderReviewSheet({ deferCopyPasteStart: true });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Duplicate" }));
    });
    const card = await screen.findByRole("region", { name: /Duplicating/ }, { timeout: 2_000 });
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /Stop|Cancel/ }));
    });
    expect(harness.invocations.some((call) => call.channel === "writeOperation:cancel")).toBe(
      false,
    );

    await act(async () => {
      harness.resolveCopyPasteStart();
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:cancel")).toBe(
        true,
      );
    });
  });

  it("keeps the review sheet usable when the start fails", async () => {
    const { sheet } = await openFolderReviewSheet({
      copyPasteStartError: new Error("The analysis expired. Paste again to recheck."),
    });

    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Duplicate" }));
    });

    expect(await screen.findByText("Couldn’t Duplicate")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: reviewSheetName })).toBeInTheDocument();
    await vi.waitFor(() => {
      expect(within(sheet).getByRole("button", { name: "Duplicate" })).not.toBeDisabled();
    });
  });

  it("lets keys through inside the runtime conflict alert and sends apply-to-remaining", async () => {
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
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "paste",
        status: "awaiting_resolution",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/Folder",
        currentDestinationPath: "/Users/demo/Folder",
        runtimeConflict: {
          conflictId: "runtime-1",
          analysisId: "analysis-1",
          sourcePath: "/Users/demo/Folder",
          destinationPath: "/Users/demo/Folder",
          sourceKind: "directory",
          destinationKind: "directory",
          conflictClass: "directory_conflict",
          reason: "destination_changed",
          sourceFingerprint: createNodeFingerprint("directory"),
          destinationFingerprint: createNodeFingerprint("directory"),
          currentSourceFingerprint: createNodeFingerprint("directory"),
          currentDestinationFingerprint: createNodeFingerprint("directory"),
        },
        result: null,
      });
    });
    const alert = await screen.findByRole("dialog", {
      name: "“Folder” in “demo” changed while pasting",
    });

    expectKeysReachDialog(within(alert).getByRole("button", { name: "Stop Pasting" }));

    await act(async () => {
      fireEvent.click(within(alert).getByRole("checkbox"));
    });
    await act(async () => {
      fireEvent.click(within(alert).getByRole("button", { name: "Keep Both" }));
    });

    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:resolveConflict")?.payload,
    ).toEqual({
      operationId: "copy-op-1",
      conflictId: "runtime-1",
      resolution: "keep_both",
      applyToRemaining: true,
    });
  });

  it("lets keys through inside the result dialog", async () => {
    const harness = createAppHarness();
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await pasteSourceIntoFolder(harness, "c");
    await act(async () => {
      harness.emitProgress(
        failedResultEvent("copy", [
          { sourcePath: "/Users/demo/source.txt", status: "failed", error: "Disk full" },
        ]),
      );
    });

    const retryButton = await screen.findByRole("button", { name: /^Retry \d+ Items?$/ });
    expectKeysReachDialog(retryButton);
  });

  it("retries a failed folder copy without duplicating the files that already arrived", async () => {
    const harness = createAppHarness();
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await pasteSourceIntoFolder(harness, "c");
    await act(async () => {
      harness.emitProgress(
        failedResultEvent("copy", [
          { sourcePath: "/Users/demo/photos", status: "failed", error: "Disk full" },
          { sourcePath: "/Users/demo/photos/a.jpg", status: "completed", error: null },
          { sourcePath: "/Users/demo/photos/b.jpg", status: "failed", error: "Disk full" },
        ]),
      );
    });
    const startCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:start",
    ).length;

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
        startCallsBeforeRetry + 1,
      );
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
    ).toMatchObject({ sourcePaths: ["/Users/demo/photos"] });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({ policy: { file: "skip", directory: "merge", mismatch: "skip" } });
  });

  it("clears the cut items from the clipboard once a retried move moved them", async () => {
    const harness = createAppHarness({
      planResponse: cutPlan(["/Users/demo/source.txt"], "/Users/demo/Folder"),
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await pasteSourceIntoFolder(harness, "x");
    await act(async () => {
      harness.emitProgress(
        failedResultEvent("cut", [
          { sourcePath: "/Users/demo/source.txt", status: "failed", error: "Permission denied" },
        ]),
      );
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
        2,
      );
    });
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("cut", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expect(clipboardButton()).toBeNull();
  });

  it("pastes into the current folder when several items are selected", async () => {
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
    // The folder is the lead item of a two-item selection.
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
    });
  });

  it("never pastes into a symlinked folder, from the keyboard or the context menu", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
            createDirectoryEntry("/Users/demo/Linked", "symlink_directory", { isSymlink: true }),
          ],
        },
      },
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await selectItem("/Users/demo/Linked");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
    });

    // Let the first paste finish so the next one is not blocked as busy.
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("copy", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });
    const planCallCount = harness.invocations.filter(
      (call) => call.channel === "copyPaste:plan",
    ).length;
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/Linked"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallCount + 1,
      );
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:plan")?.payload,
    ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
  });

  it("does nothing, silently, when cut items are pasted into the folder they are in", async () => {
    const harness = createAppHarness({
      planResponse: cutPlan(["/Users/demo/source.txt"], "/Users/demo", [
        sameFolderIssue("/Users/demo/source.txt"),
      ]),
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await clearContentSelection();
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:plan")).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Couldn’t Move")).not.toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("still moves the other cut items when some are already in the destination folder", async () => {
    const harness = createAppHarness({
      analysisReportForRequest: (request) =>
        toAnalysisReport(
          request.sourcePaths.includes("/Users/demo/source.txt")
            ? cutPlan(request.sourcePaths, request.destinationDirectoryPath, [
                sameFolderIssue("/Users/demo/source.txt"),
              ])
            : cutPlan(request.sourcePaths, request.destinationDirectoryPath),
        ),
    });
    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await clearContentSelection();
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(
      harness.invocations
        .filter((call) => call.channel === "copyPaste:plan")
        .map((call) => (call.payload as { sourcePaths: string[] }).sourcePaths),
    ).toEqual([["/Users/demo/source.txt", "/Users/demo/Folder"], ["/Users/demo/Folder"]]);
    expect(screen.queryByText("Couldn’t Move")).not.toBeInTheDocument();
  });
});

describe("App file operations like Finder", () => {
  describe("drag and drop moves on the same disk and copies to another", () => {
    let restoreDragEvent: () => void = () => undefined;
    beforeEach(() => {
      restoreDragEvent = installDragEventWithModifiers();
    });
    afterEach(() => {
      restoreDragEvent();
    });

    const backupFavorite: Parameters<typeof createAppHarness>[0] = {
      preferences: {
        favoritesInitialized: true,
        favorites: [{ path: "/Volumes/Backup", icon: "drive" }],
      },
    };

    it("moves to a folder on the same disk, showing the move cursor", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("tree:/Users/demo/Folder");
      const { dataTransfer, cursors } = await dragWithKeys(source, target, [{}]);

      expect(dataTransfer.effectAllowed).toBe("copyMove");
      expect(cursors).toEqual(["move"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "cut",
            action: "move_to",
            sourcePaths: ["/Users/demo/source.txt"],
            destinationDirectoryPath: "/Users/demo/Folder",
          }),
        ]);
      });
    });

    // Disks can be mounted anywhere: a network share under /net is another disk, and a
    // plain drag there must copy, not delete the originals once copied.
    it("copies to a disk mounted outside /Volumes, as the disk says", async () => {
      const harness = createAppHarness({
        preferences: {
          favoritesInitialized: true,
          favorites: [{ path: "/net/share", icon: "drive" }],
        },
        diskIds: { "/Users": 1, "/net/share": 7 },
      });
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/net/share");
      await dragWithKeys(source, target, [{}]);

      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "copy",
            action: "copy_to",
            destinationDirectoryPath: "/net/share",
          }),
        ]);
      });
    });

    // The startup disk can also be reached as /Volumes/Macintosh HD: still the same disk.
    it("moves to the startup disk reached through /Volumes, as the disk says", async () => {
      const harness = createAppHarness({
        preferences: {
          favoritesInitialized: true,
          favorites: [{ path: "/Volumes/Macintosh HD/Users/demo/Folder", icon: "folder" }],
        },
        diskIds: { "/Users": 1, "/Volumes/Macintosh HD": 1 },
      });
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/Volumes/Macintosh HD/Users/demo/Folder");
      await dragWithKeys(source, target, [{}]);

      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "cut",
            action: "move_to",
            destinationDirectoryPath: "/Volumes/Macintosh HD/Users/demo/Folder",
          }),
        ]);
      });
    });

    it("copies to a folder on another disk, showing the copy cursor", async () => {
      const harness = createAppHarness(backupFavorite);
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/Volumes/Backup");
      const { cursors } = await dragWithKeys(source, target, [{}]);

      expect(cursors).toEqual(["copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "copy",
            action: "copy_to",
            sourcePaths: ["/Users/demo/source.txt"],
            destinationDirectoryPath: "/Volumes/Backup",
          }),
        ]);
      });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });

      // Named for the copy it is, not for the paste it works like.
      await act(async () => {
        harness.emitProgress({
          operationId: "copy-op-1",
          action: "copy_to",
          mode: "copy",
          status: "completed",
          completedItemCount: 1,
          totalItemCount: 1,
          completedByteCount: 5,
          totalBytes: 5,
          currentSourcePath: null,
          currentDestinationPath: null,
          result: {
            operationId: "copy-op-1",
            mode: "copy",
            status: "completed",
            destinationDirectoryPath: "/Volumes/Backup",
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
                destinationPath: "/Volumes/Backup/source.txt",
                status: "completed",
                error: null,
              },
            ],
            error: null,
          },
        });
      });
      const toasts = await screen.findByTestId("toast-viewport");
      expect(within(toasts).getByText("Copied to Backup")).toBeInTheDocument();
      expect(within(toasts).queryByText(/Pasted/)).not.toBeInTheDocument();
    });

    it("copies on the same disk with Option held", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("tree:/Users/demo/Folder");
      const { cursors } = await dragWithKeys(source, target, [{ altKey: true }]);

      expect(cursors).toEqual(["copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({ mode: "copy", destinationDirectoryPath: "/Users/demo/Folder" }),
        ]);
      });
    });

    it("moves to another disk with Command held", async () => {
      const harness = createAppHarness(backupFavorite);
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("favorite:/Volumes/Backup");
      const { cursors } = await dragWithKeys(source, target, [{ metaKey: true }]);

      expect(cursors).toEqual(["move"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "cut",
            action: "move_to",
            destinationDirectoryPath: "/Volumes/Backup",
          }),
        ]);
      });
    });

    it("changes the cursor as Option is pressed and let go, and drops as it shows", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const target = await screen.findByTitle("tree:/Users/demo/Folder");
      const { cursors } = await dragWithKeys(source, target, [
        {},
        { altKey: true },
        {},
        {
          altKey: true,
        },
      ]);

      expect(cursors).toEqual(["move", "copy", "move", "copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([expect.objectContaining({ mode: "copy" })]);
      });
    });

    it("duplicates with Option onto the items' own folder, and does nothing without it", async () => {
      const harness = createAppHarness({
        preferences: {
          favoritesInitialized: true,
          favorites: [{ path: "/Users/demo", icon: "home" }],
        },
      });
      renderApp(harness);

      const source = await screen.findByTitle("/Users/demo/source.txt");
      const ownFolder = await screen.findByTitle("favorite:/Users/demo");

      const plain = await dragWithKeys(source, ownFolder, [{}]);
      expect(plain.cursors).toEqual(["none"]);
      expect(analyzeRequests(harness)).toEqual([]);

      const withOption = await dragWithKeys(source, ownFolder, [{ altKey: true }]);
      expect(withOption.cursors).toEqual(["copy"]);
      await vi.waitFor(() => {
        expect(analyzeRequests(harness)).toEqual([
          expect.objectContaining({
            mode: "copy",
            action: "copy_to",
            sourcePaths: ["/Users/demo/source.txt"],
            destinationDirectoryPath: "/Users/demo",
          }),
        ]);
      });
      expect(screen.queryByText(/couldn't start/)).not.toBeInTheDocument();
    });
  });

  it("moves the rest of a search selection when some items are already in the folder", async () => {
    const searchItem = (path: string, parentPath: string) => ({
      path,
      name: path.split("/").at(-1) ?? path,
      extension: "txt",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
      parentPath,
      relativeParentPath: parentPath === "/Users/demo" ? "." : "Folder",
    });
    const harness = createAppHarness({
      searchResultItems: [
        searchItem("/Users/demo/source.txt", "/Users/demo"),
        searchItem("/Users/demo/Folder/source-inside.txt", "/Users/demo/Folder"),
      ],
      analysisReportForRequest: (request) =>
        planForRequest(request, (path) =>
          path.startsWith(`${request.destinationDirectoryPath}/`) ? sameFolderIssue(path) : null,
        ),
    });
    renderApp(harness);

    await openSearchResults();
    const first = await screen.findByTitle("search:/Users/demo/source.txt");
    const second = await screen.findByTitle("search:/Users/demo/Folder/source-inside.txt");
    await act(async () => {
      fireEvent.click(first);
      fireEvent.click(second, { metaKey: true });
    });
    await dragBetween(first, await screen.findByTitle("tree:/Users/demo/Folder"));

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(analyzeRequests(harness).map((request) => [...request.sourcePaths].sort())).toEqual([
      ["/Users/demo/Folder/source-inside.txt", "/Users/demo/source.txt"],
      ["/Users/demo/source.txt"],
    ]);
    expect(screen.queryByText("Couldn’t Move")).not.toBeInTheDocument();
  });

  describe("the clipboard follows what the app does to its items", () => {
    it("follows a renamed item", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "c", metaKey: true });
      await renameSelectionTo("source.txt", "renamed.txt");
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
          true,
        );
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/renamed.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "write-op-rename",
            action: "rename",
            targetPath: "/Users/demo/renamed.txt",
            items: [
              { sourcePath: "/Users/demo/source.txt", destinationPath: "/Users/demo/renamed.txt" },
            ],
          }),
        );
      });
      await screen.findByTitle("/Users/demo/renamed.txt");

      await selectItem("/Users/demo/Folder");
      await pressKey({ key: "v", metaKey: true });

      await vi.waitFor(() => {
        expect(analyzeRequests(harness).at(-1)?.sourcePaths).toEqual(["/Users/demo/renamed.txt"]);
      });
    });

    it("follows an item moved by a drag", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "c", metaKey: true });
      await dragBetween(
        await screen.findByTitle("/Users/demo/source.txt"),
        await screen.findByTitle("tree:/Users/demo/Folder"),
      );
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "copy-op-1",
            action: "move_to",
            targetPath: "/Users/demo/Folder",
            items: [
              {
                sourcePath: "/Users/demo/source.txt",
                destinationPath: "/Users/demo/Folder/source.txt",
              },
            ],
          }),
        );
      });
      await vi.waitFor(() => {
        expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
      });

      await clearContentSelection();
      await pressKey({ key: "v", metaKey: true });

      await vi.waitFor(() => {
        expect(analyzeRequests(harness).at(-1)).toMatchObject({
          sourcePaths: ["/Users/demo/Folder/source.txt"],
          destinationDirectoryPath: "/Users/demo",
        });
      });
    });

    it("drops an item put in the Trash", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await act(async () => {
        fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
      });
      await pressKey({ key: "c", metaKey: true });
      expect(clipboardButton()).toHaveAccessibleName("Clipboard: 2 items copied");

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "Backspace", metaKey: true });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
          true,
        );
      });
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "write-op-trash",
            action: "trash",
            targetPath: null,
            items: [{ sourcePath: "/Users/demo/source.txt", destinationPath: null }],
          }),
        );
      });

      await vi.waitFor(() => {
        expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
      });
    });
  });

  describe("pasting items that no longer exist", () => {
    const withGoneFile = {
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/gone.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
      analysisReportForRequest: (request: IpcRequestInput<"copyPaste:analyzeStart">) =>
        planForRequest(request, (path) =>
          path === "/Users/demo/gone.txt" ? missingSourceIssue(path) : null,
        ),
    };

    async function copyThenPaste(paths: string[], key: "c" | "x"): Promise<void> {
      await selectItem(paths[0] as string);
      for (const path of paths.slice(1)) {
        await act(async () => {
          fireEvent.click(screen.getByTitle(path), { metaKey: true });
        });
      }
      await pressKey({ key, metaKey: true });
      await selectItem("/Users/demo/Folder");
      await pressKey({ key: "v", metaKey: true });
    }

    it.each([
      ["copied", "c"],
      ["cut", "x"],
    ] as const)("pastes the rest of %s items and names the one that is gone", async (_, key) => {
      const harness = createAppHarness(withGoneFile);
      renderApp(harness);

      await copyThenPaste(["/Users/demo/source.txt", "/Users/demo/gone.txt"], key);

      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      expect(analyzeRequests(harness).map((request) => request.sourcePaths)).toEqual([
        ["/Users/demo/source.txt", "/Users/demo/gone.txt"],
        ["/Users/demo/source.txt"],
      ]);
      // A cut is a move, and said as one.
      const verb = key === "x" ? "moved" : "pasted";
      const notice = await screen.findByRole("dialog", { name: `An item couldn’t be ${verb}` });
      expect(notice).toHaveTextContent(
        `“gone.txt” couldn’t be ${verb} because it no longer exists.`,
      );
      if (key === "c") {
        // What is gone is taken off the clipboard; the rest stays for more pastes.
        expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
      }
    });

    it("pastes nothing when every item is gone, and says so", async () => {
      const harness = createAppHarness(withGoneFile);
      renderApp(harness);

      await copyThenPaste(["/Users/demo/gone.txt"], "c");

      const notice = await screen.findByRole("dialog", { name: "Couldn’t Paste" });
      expect(notice).toHaveTextContent(
        "“gone.txt” couldn’t be pasted because it no longer exists.",
      );
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
      expect(clipboardButton()).toBeNull();
    });
  });

  describe("New Folder suggests a free name", () => {
    it("in another folder, not only the folder on screen", async () => {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo/Folder": {
            path: "/Users/demo/Folder",
            parentPath: "/Users/demo",
            entries: [createDirectoryEntry("/Users/demo/Folder/untitled folder", "directory")],
          },
        },
      });
      renderApp(harness);

      await openNewFolderFromFolderMenu("/Users/demo/Folder");

      expect(await screen.findByRole("dialog", { name: "New Folder" })).toHaveTextContent(
        "In “Folder”",
      );
      expect(screen.getByLabelText("Folder name")).toHaveValue("untitled folder 2");
    });

    it("comparing names without regard to case, as the disk does", async () => {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo": {
            path: "/Users/demo",
            parentPath: "/Users",
            entries: [
              createDirectoryEntry("/Users/demo/Untitled Folder", "directory"),
              createDirectoryEntry("/Users/demo/UNTITLED FOLDER 2", "directory"),
            ],
          },
        },
      });
      renderApp(harness);

      await clearContentSelection();
      await pressKey({ key: "n", metaKey: true, shiftKey: true });

      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:createFolder")
            ?.payload,
        ).toEqual({
          parentDirectoryPath: "/Users/demo",
          folderName: "untitled folder 3",
          nextFreeName: true,
        });
      });
    });
  });

  describe("another write running", () => {
    const busyError = () => new Error("Another write operation is already running.");

    async function startPasteThatKeepsRunning(
      harness: ReturnType<typeof createAppHarness>,
    ): Promise<void> {
      await pasteSourceIntoFolder(harness, "c");
      await screen.findByRole("region", { name: "Pasting…" });
    }

    async function expectBusyDialog(title: string): Promise<void> {
      const dialog = await screen.findByRole("dialog", { name: title });
      expect(dialog).toHaveTextContent(
        "Another file operation is running. Wait for it to finish, or stop it.",
      );
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
      });
    }

    it("says the same thing in a dialog for Trash, Duplicate and Paste", async () => {
      const harness = createAppHarness();
      renderApp(harness);
      await startPasteThatKeepsRunning(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "Backspace", metaKey: true });
      await expectBusyDialog("Couldn’t Move to Trash");
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        false,
      );

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "d", metaKey: true });
      await expectBusyDialog("Couldn’t Duplicate");

      await pressKey({ key: "v", metaKey: true });
      await expectBusyDialog("Couldn’t Paste");
      expect(screen.queryByTestId("toast-viewport")?.textContent ?? "").not.toContain(
        "Wait for the current write",
      );
    });

    it("says it in a dialog when the main process refuses a rename", async () => {
      const harness = createAppHarness({ renameErrors: [busyError()] });
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", "renamed.txt");

      await expectBusyDialog("Couldn’t Rename");
      // The name field does not stay open waiting.
      expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Renaming…" })).not.toBeInTheDocument();
    });

    it("says it in a dialog when the main process refuses a new folder", async () => {
      const harness = createAppHarness({ createFolderError: busyError() });
      renderApp(harness);

      await clearContentSelection();
      await pressKey({ key: "n", metaKey: true, shiftKey: true });

      await expectBusyDialog("Couldn’t Make a New Folder");
      expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
    });

    it("sends one Trash request for a quick double Command-Delete", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await act(async () => {
        fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
        fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
      });

      await expectBusyDialog("Couldn’t Move to Trash");
      expect(
        harness.invocations.filter((call) => call.channel === "writeOperation:trash"),
      ).toHaveLength(1);
    });
  });

  it("gives the rename field each refusal, even one that reads the same as the last", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await selectItem("/Users/demo/source.txt");
    await renameSelectionTo("source.txt", "a/b.txt");
    const refusal = await screen.findByTestId("inline-rename-refusal");
    const firstReason = refusal.textContent;
    expect(refusal).toHaveAttribute("data-refusal-count", "1");

    const renameInput = screen.getByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "c/d.txt" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
    });

    expect(screen.getByTestId("inline-rename-refusal")).toHaveTextContent(firstReason ?? "");
    expect(screen.getByTestId("inline-rename-refusal")).toHaveAttribute("data-refusal-count", "2");
    expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
      false,
    );
  });

  it("pastes into the folder on screen from the menu of a folder that is on the clipboard", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await selectItem("/Users/demo/Folder");
    await pressKey({ key: "c", metaKey: true });
    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });

    await vi.waitFor(() => {
      expect(analyzeRequests(harness).at(-1)).toMatchObject({
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
      });
    });
    expect(screen.queryByText(/couldn't start/)).not.toBeInTheDocument();
  });

  describe("names that begin with a dot", () => {
    const question = "Are you sure you want to use a name that begins with a dot (“.”)?";

    it("asks before a rename would hide the item, and renames on Use “.”", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", ".source.txt");

      const dialog = await screen.findByRole("dialog", { name: question });
      expect(dialog).toHaveTextContent(
        "These names are reserved for the system. If you continue, the item will be hidden.",
      );
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
      expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
        false,
      );

      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Use “.”" }));
      });
      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
        ).toEqual({ sourcePath: "/Users/demo/source.txt", destinationName: ".source.txt" });
      });
      expect(screen.queryByRole("dialog", { name: question })).not.toBeInTheDocument();
    });

    it("leaves the name as it was on Cancel", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", ".source.txt");
      const dialog = await screen.findByRole("dialog", { name: question });
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      });

      expect(screen.queryByRole("dialog", { name: question })).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
      expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
        false,
      );
    });

    it("asks before a new folder would be hidden", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      // Inside another folder, where the name is asked for before the folder is made.
      await openNewFolderFromFolderMenu("/Users/demo/Folder");
      await screen.findByRole("dialog", { name: "New Folder" });
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: ".config" } });
        fireEvent.click(screen.getByRole("button", { name: "Create Folder" }));
      });

      const dialog = await screen.findByRole("dialog", { name: question });
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(false);
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Use “.”" }));
      });
      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:createFolder")
            ?.payload,
        ).toEqual({ parentDirectoryPath: "/Users/demo/Folder", folderName: ".config" });
      });
    });

    it("does not ask while hidden files are shown", async () => {
      const harness = createAppHarness({ preferences: { includeHidden: true } });
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await renameSelectionTo("source.txt", ".source.txt");

      await vi.waitFor(() => {
        expect(
          harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
        ).toEqual({ sourcePath: "/Users/demo/source.txt", destinationName: ".source.txt" });
      });
      expect(screen.queryByRole("dialog", { name: question })).not.toBeInTheDocument();
    });
  });

  describe("selecting what Duplicate made", () => {
    it("selects the copy in the file list", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      await selectItem("/Users/demo/source.txt");
      await pressKey({ key: "d", metaKey: true });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/source copy.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "copy-op-1",
            action: "duplicate",
            targetPath: "/Users/demo",
            items: [
              {
                sourcePath: "/Users/demo/source.txt",
                destinationPath: "/Users/demo/source copy.txt",
              },
            ],
          }),
        );
      });

      await vi.waitFor(() => {
        expect(screen.getByTitle("/Users/demo/source copy.txt")).toHaveAttribute(
          "data-selected",
          "true",
        );
      });
      expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "false");
    });

    it("selects the copy in the tree when a tree folder is duplicated", async () => {
      const harness = createAppHarness();
      renderApp(harness);

      const treeFolder = await screen.findByTitle("tree:/Users/demo/Folder");
      await act(async () => {
        fireEvent.contextMenu(treeFolder);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Duplicate/ }));
      });
      await vi.waitFor(() => {
        expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
      });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
        createDirectoryEntry("/Users/demo/Folder copy", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          finishedWriteEvent({
            operationId: "copy-op-1",
            action: "duplicate",
            targetPath: "/Users/demo",
            items: [
              { sourcePath: "/Users/demo/Folder", destinationPath: "/Users/demo/Folder copy" },
            ],
          }),
        );
      });

      await vi.waitFor(() => {
        expect(screen.getByTestId("tree-selection")).toHaveTextContent(
          "fs:/Users/demo/Folder copy",
        );
      });
    });
  });

  it("keeps the conflict question when its answer cannot be sent", async () => {
    const harness = createAppHarness({ resolveConflictError: new Error("IPC closed") });
    renderApp(harness);

    await pasteSourceIntoFolder(harness, "c");
    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        action: "paste",
        status: "awaiting_resolution",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        runtimeConflict: {
          conflictId: "runtime-1",
          analysisId: "analysis-1",
          sourcePath: "/Users/demo/source.txt",
          destinationPath: "/Users/demo/Folder/source.txt",
          sourceKind: "file",
          destinationKind: "file",
          conflictClass: "file_conflict",
          reason: "destination_changed",
          sourceFingerprint: createNodeFingerprint("file"),
          destinationFingerprint: createNodeFingerprint("file"),
          currentSourceFingerprint: createNodeFingerprint("file"),
          currentDestinationFingerprint: createNodeFingerprint("file"),
        },
        result: null,
      });
    });
    const replaceButton = await screen.findByRole("button", { name: "Replace" });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await act(async () => {
        fireEvent.click(replaceButton);
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    } finally {
      process.off("unhandledRejection", unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:resolveConflict")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
  });

  it("still reads the folder again when the caches cannot be cleared", async () => {
    const harness = createAppHarness({ clearCachesError: new Error("IPC closed") });
    renderApp(harness);

    await screen.findByTitle("/Users/demo/source.txt");
    const snapshotReads = () =>
      harness.invocations.filter(
        (call) =>
          call.channel === "directory:getSnapshot" &&
          (call.payload as IpcRequestInput<"directory:getSnapshot">).path === "/Users/demo",
      ).length;
    const readsBefore = snapshotReads();
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/new.txt", "file"),
    ]);

    await act(async () => {
      harness.emitCommand({ type: "refreshOrApplySearchSort" });
    });

    await vi.waitFor(() => {
      expect(snapshotReads()).toBeGreaterThan(readsBefore);
    });
    expect(await screen.findByTitle("/Users/demo/new.txt")).toBeInTheDocument();
  });
});

describe("what stays on screen when an operation finishes", () => {
  const sourceCopied = [
    { sourcePath: "/Users/demo/source.txt", status: "completed" as const, error: null },
  ];

  async function copySourceAndPasteHere(harness: ReturnType<typeof createAppHarness>) {
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await pressKey({ key: "v", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
  }

  function finishPasteOfCopy(harness: ReturnType<typeof createAppHarness>) {
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/source copy.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    return act(async () => {
      harness.emitProgress(
        finishedWriteEvent({
          operationId: "copy-op-1",
          action: "paste",
          targetPath: "/Users/demo",
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/source copy.txt",
            },
          ],
        }),
      );
    });
  }

  it("selects what a paste made when nothing else was picked meanwhile", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    await finishPasteOfCopy(harness);

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/source copy.txt")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
  });

  // Jumping to the copy would make the next ⌘⌫ trash an item the person never chose.
  it("keeps what the person picked while the paste ran, and acts on that next", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    await selectItem("/Users/demo/Folder");
    await finishPasteOfCopy(harness);
    await screen.findByTitle("/Users/demo/source copy.txt");

    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/source copy.txt")).not.toHaveAttribute(
      "data-selected",
      "true",
    );
    await pressKey({ key: "Backspace", metaKey: true });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({ paths: ["/Users/demo/Folder"] });
    });
  });

  it("keeps the selection when an operation into another folder finishes", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    // Pasted into Folder from its own menu, while source.txt stays selected here.
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    await selectItem("/Users/demo/source.txt");
    const readsBefore = harness.invocations.filter(
      (call) => call.channel === "directory:getSnapshot",
    ).length;

    await act(async () => {
      harness.emitProgress(finishedResultEvent("copy", "completed", sourceCopied));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "directory:getSnapshot").length,
      ).toBeGreaterThan(readsBefore);
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    });
  });

  it("keeps search results that were opened while a paste ran", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    await openSearchResults();
    await act(async () => {
      harness.emitProgress(finishedResultEvent("copy", "completed", sourceCopied));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("source");
  });

  it("keeps the search results a drag was made from", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await openSearchResults();
    const searchResult = await screen.findByTitle("search:/Users/demo/source.txt");
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(searchResult, treeTarget);
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    const searchesBefore = harness.invocations.filter(
      (call) => call.channel === "search:start",
    ).length;
    await act(async () => {
      harness.emitProgress(finishedResultEvent("cut", "completed", sourceCopied));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search")).toHaveValue("source");
    // Found again, so the moved item shows where it is now.
    expect(harness.invocations.filter((call) => call.channel === "search:start").length).toBe(
      searchesBefore + 1,
    );
  });

  it("selects a renamed item while the list is filtered", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const contentPane = await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.pointerDown(contentPane);
    });
    await pressKey({ key: "s" });
    await pressKey({ key: "o" });
    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");

    await renameSelectionTo("source.txt", "zeta.txt");
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
        true,
      );
    });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/zeta.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress(
        finishedWriteEvent({
          operationId: "write-op-rename",
          action: "rename",
          targetPath: "/Users/demo",
          items: [
            { sourcePath: "/Users/demo/source.txt", destinationPath: "/Users/demo/zeta.txt" },
          ],
        }),
      );
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/zeta.txt")).toHaveAttribute("data-selected", "true");
    });
  });

  // Reading the old folder again would replace the one being opened and send them back.
  it("lets a folder the person is opening win over reading the folder again", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await copySourceAndPasteHere(harness);
    const release = harness.holdDirectorySnapshot("/Users/demo/Folder");
    await act(async () => {
      fireEvent.doubleClick(screen.getByTitle("/Users/demo/Folder"));
    });
    await finishPasteOfCopy(harness);
    await act(async () => {
      release();
    });

    await vi.waitFor(() => {
      expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
  });
});

describe("a rename refused after leaving its folder", () => {
  // Clicking another folder ends the name field (it is submitted) and opens that folder;
  // the refusal comes back with no field to show it under.
  it("says why in a dialog, and leaves the keyboard working", async () => {
    const harness = createAppHarness({
      renameErrors: [new Error("An item named “Folder” already exists.")],
    });
    renderApp(harness);

    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "F2" });
    const renameInput = await screen.findByLabelText("Rename source.txt");
    const treeFolder = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.change(renameInput, { target: { value: "Folder" } });
      fireEvent.keyDown(renameInput, { key: "Enter" });
      fireEvent.click(treeFolder);
    });

    const dialog = await screen.findByRole("dialog", { name: "Couldn’t Rename" });
    expect(dialog).toHaveTextContent("An item named “Folder” already exists.");
    expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });

    const tabsBefore = screen.queryAllByRole("tab").length;
    await pressKey({ key: "t", metaKey: true });
    await vi.waitFor(() => {
      expect(screen.queryAllByRole("tab").length).toBeGreaterThan(tabsBefore);
    });
  });

  it("closes the name field when another folder is opened, and the keyboard works there", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "F2" });
    await screen.findByLabelText("Rename source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("tree:/Users/demo/Folder"));
    });

    await vi.waitFor(() => {
      expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
    });
    expect(harness.invocations.some((call) => call.channel === "writeOperation:rename")).toBe(
      false,
    );
    const tabsBefore = screen.queryAllByRole("tab").length;
    await pressKey({ key: "t", metaKey: true });
    await vi.waitFor(() => {
      expect(screen.queryAllByRole("tab").length).toBeGreaterThan(tabsBefore);
    });
  });
});

describe("what finished operations are called", () => {
  const withTrashFolder = {
    directorySnapshots: {
      "/Users/demo": {
        path: "/Users/demo",
        parentPath: "/Users",
        entries: [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/b.txt", "file"),
          createDirectoryEntry("/Users/demo/.Trash", "directory"),
        ],
      },
      "/Users/demo/.Trash": {
        path: "/Users/demo/.Trash",
        parentPath: "/Users/demo",
        entries: [createDirectoryEntry("/Users/demo/.Trash/old.txt", "file")],
      },
    },
  };

  it("calls a finished Delete Immediately “Deleted”, never “Pasted”", async () => {
    const harness = createAppHarness(withTrashFolder);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/old.txt"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Delete Immediately/ }));
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “old.txt”?",
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
      ).toBe(true);
    });

    await act(async () => {
      harness.emitProgress(
        finishedWriteEvent({
          operationId: "write-op-delete",
          action: "delete_immediately",
          targetPath: null,
          items: [{ sourcePath: "/Users/demo/.Trash/old.txt", destinationPath: null }],
        }),
      );
    });

    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent("Deleted");
    });
    expect(viewport).not.toHaveTextContent("Pasted");
  });

  it("never says a stopped Trash was done", async () => {
    const harness = createAppHarness(withTrashFolder);
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
    });
    await pressKey({ key: "Backspace", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        true,
      );
    });
    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-trash",
        action: "trash",
        status: "partial",
        completedItemCount: 1,
        totalItemCount: 2,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        runtimeConflict: null,
        result: {
          operationId: "write-op-trash",
          action: "trash",
          status: "partial",
          targetPath: null,
          startedAt: "2026-10-03T10:00:00.000Z",
          finishedAt: "2026-10-03T10:00:01.000Z",
          summary: {
            topLevelItemCount: 2,
            totalItemCount: 2,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 1,
            completedByteCount: 0,
            totalBytes: null,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: null,
              status: "completed",
              error: null,
              skipReason: null,
            },
            {
              sourcePath: "/Users/demo/b.txt",
              destinationPath: null,
              status: "cancelled",
              error: "Not started because the operation was stopped.",
              skipReason: null,
            },
          ],
          error: null,
        },
      } as WriteOperationProgressEvent);
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Stopped before every item was done.");
    expect(dialog).not.toHaveTextContent("Done.");
  });
});

describe("the Preparing to Paste sheet", () => {
  async function startPasteThatIsBeingPrepared(harness: ReturnType<typeof createAppHarness>) {
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await selectItem("/Users/demo/Folder");
    await pressKey({ key: "v", metaKey: true });
    return screen.findByRole("dialog", { name: "Preparing to Paste…" });
  }

  it("starts with Cancel focused", async () => {
    const harness = createAppHarness({ deferCopyPastePlan: true });
    renderApp(harness);

    const sheet = await startPasteThatIsBeingPrepared(harness);

    expect(within(sheet).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  // Escape is the sheet's Cancel: the paste stops, and nothing behind it hears the key.
  it("cancels the paste on Escape, and the list behind doesn't take the key", async () => {
    const harness = createAppHarness({ deferCopyPastePlan: true });
    renderApp(harness);
    await startPasteThatIsBeingPrepared(harness);

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    await act(async () => {
      harness.resolveCopyPastePlan();
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Preparing to Paste…" })).not.toBeInTheDocument();
    });
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
  });
});

describe("dragging while an operation runs", () => {
  // One operation runs at a time, and a drag would start another: it doesn't start, and
  // a notification says why, so the rows don't just seem stuck.
  it("doesn't start the drag, and says why", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await pressKey({ key: "v", metaKey: true });
    await screen.findByRole("region", { name: "Pasting…" });

    const dataTransfer = await dragBetween(
      screen.getByTitle("/Users/demo/source.txt"),
      await screen.findByTitle("tree:/Users/demo/Folder"),
    );

    expect(dataTransfer.getData("text/plain")).toBe("");
    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent(/Can't drag while .* being copied/);
    });
    expect(analyzeRequests(harness)).toHaveLength(1);
  });
});

describe("acting on search results", () => {
  const result = (path: string) => {
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    return {
      path,
      name,
      extension: name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
      parentPath: path.slice(0, slash),
      relativeParentPath: path.slice("/Users/demo/".length, slash) || ".",
    };
  };

  async function selectResult(path: string, init: { metaKey?: boolean } = {}) {
    await act(async () => {
      fireEvent.click(await screen.findByTitle(`search:${path}`), init);
    });
  }

  function duplicateRequests(harness: ReturnType<typeof createAppHarness>) {
    return harness.invocations
      .filter(
        (call) => call.channel === "copyPaste:plan" || call.channel === "copyPaste:analyzeStart",
      )
      .map((call) => call.payload as { action?: string; destinationDirectoryPath?: string })
      .filter((payload) => payload.action === "duplicate");
  }

  it("moves a result to the Trash with Command-Delete", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/Folder/deep.txt");

    await pressKey({ key: "Backspace", metaKey: true });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({ paths: ["/Users/demo/Folder/deep.txt"] });
    });
  });

  it("duplicates a result next to it, in its own folder", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/Folder/deep.txt");

    await pressKey({ key: "d", metaKey: true });

    await vi.waitFor(() => {
      expect(duplicateRequests(harness).length).toBeGreaterThan(0);
    });
    for (const request of duplicateRequests(harness)) {
      expect(request.destinationDirectoryPath).toBe("/Users/demo/Folder");
    }
  });

  it("doesn't duplicate results from different folders at once, and says why", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/source.txt"), result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/source.txt");
    await selectResult("/Users/demo/Folder/deep.txt", { metaKey: true });

    await pressKey({ key: "d", metaKey: true });

    const viewport = await screen.findByTestId("toast-viewport");
    await vi.waitFor(() => {
      expect(viewport).toHaveTextContent("Duplicate items from one folder at a time");
    });
    expect(duplicateRequests(harness)).toEqual([]);
  });

  it("renames a result in its row", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/Folder/deep.txt");

    await pressKey({ key: "F2" });
    const field = await screen.findByLabelText("Rename result deep.txt");
    await act(async () => {
      fireEvent.change(field, { target: { value: "deeper.txt" } });
      fireEvent.keyDown(field, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:rename")?.payload,
      ).toEqual({ sourcePath: "/Users/demo/Folder/deep.txt", destinationName: "deeper.txt" });
    });
    expect(screen.queryByRole("dialog", { name: /Rename/ })).not.toBeInTheDocument();
  });

  it("offers Move to Trash, Rename and Duplicate in a result's menu", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("search:/Users/demo/Folder/deep.txt"));
    });

    for (const name of [/^Move to Trash/, /^Rename/, /^Duplicate/, /^Move to…/]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-disabled", "false");
    }
    expect(screen.queryByRole("button", { name: /^Delete Immediately/ })).not.toBeInTheDocument();
  });

  it("renames results from different folders together, but leaves Duplicate out", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/source.txt"), result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/source.txt");
    await selectResult("/Users/demo/Folder/deep.txt", { metaKey: true });
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("search:/Users/demo/source.txt"));
    });

    // Each is renamed in its own folder; a duplicate goes next to one original, which two
    // folders don't have, so Duplicate isn't listed.
    expect(screen.getByRole("button", { name: /^Move to Trash/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Rename 2 Items…/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Duplicate/ })).toBeNull();
  });

  it("renames results from different folders together, each in its own folder", async () => {
    const harness = createAppHarness({
      searchResultItems: [result("/Users/demo/source.txt"), result("/Users/demo/Folder/deep.txt")],
    });
    renderApp(harness);
    await openSearchResults();
    await selectResult("/Users/demo/source.txt");
    await selectResult("/Users/demo/Folder/deep.txt", { metaKey: true });
    await pressKey({ key: "F2" });

    const sheet = await screen.findByRole("dialog", { name: "Rename 2 Items" });
    await waitFor(() => expect(within(sheet).getAllByText("No change")).toHaveLength(2));
    await act(async () => {
      fireEvent.click(within(sheet).getByLabelText("Add Text"));
    });
    await act(async () => {
      fireEvent.change(within(sheet).getByLabelText("Text"), { target: { value: "-old" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename 2 Items" }));
    });

    // In the order the results are listed (by name), whatever order they were clicked in.
    expect(
      harness.invocations.find((call) => call.channel === "batchRename:inspect")?.payload,
    ).toMatchObject({ paths: ["/Users/demo/Folder/deep.txt", "/Users/demo/source.txt"] });
    expect(
      harness.invocations.find((call) => call.channel === "writeOperation:batchRename")?.payload,
    ).toEqual({
      items: [
        {
          sourcePath: "/Users/demo/Folder/deep.txt",
          destinationName: "deep-old.txt",
          isFolder: false,
        },
        {
          sourcePath: "/Users/demo/source.txt",
          destinationName: "source-old.txt",
          isFolder: false,
        },
      ],
      onConflict: "number",
      numberSeparator: " ",
    });
  });
});

describe("Delete Immediately and Empty Trash", () => {
  const emptyQuestion = "Are you sure you want to permanently erase the items in the Trash?";

  // Everything goes to the Trash; only what is already in it is deleted for good.
  it("has no Option-Command-Delete in the list", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "Backspace", metaKey: true, altKey: true });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
    ).toBe(false);
  });

  it("offers Delete Immediately in a tree folder's menu only inside the Trash", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const menuTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(menuTarget);
    });

    expect(screen.queryByRole("button", { name: /^Delete Immediately/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Move to Trash/ })).toBeInTheDocument();
  });

  it("empties the Trash from the menu bar, after asking, and not on Cancel", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "emptyTrash" });
    });
    let dialog = await screen.findByRole("dialog", { name: emptyQuestion });
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });
    expect(harness.invocations.some((call) => call.channel === "system:emptyTrash")).toBe(false);

    await pressKey({ key: "Backspace", metaKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: emptyQuestion });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Empty Trash" }));
    });
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "system:emptyTrash")).toBe(true);
    });
  });

  it("empties the Trash from the Trash favorite's menu", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const menuTarget = await screen.findByTitle("favorite:/Users/demo/.Trash");
    await act(async () => {
      fireEvent.contextMenu(menuTarget);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Empty Trash/ }));
    });

    expect(await screen.findByRole("dialog", { name: emptyQuestion })).toBeInTheDocument();
  });

  it("doesn't offer Empty Trash on other favorites", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesInitialized: true,
        favorites: [
          { path: "/Users/demo/Folder", icon: "folder" },
          { path: "/Users/demo/.Trash", icon: "trash" },
        ],
      },
    });
    renderApp(harness);
    const menuTarget = await screen.findByTitle("favorite:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(menuTarget);
    });

    expect(screen.queryByRole("button", { name: /^Empty Trash/ })).not.toBeInTheDocument();
  });
});

// Empty Trash and Delete Immediately are operations too: while another runs they can't
// start, so they aren't asked about, and nothing about them touches the running one.
describe("Empty Trash and Delete Immediately while another operation runs", () => {
  const withTrash = {
    directorySnapshots: {
      "/Users/demo": {
        path: "/Users/demo",
        parentPath: "/Users",
        entries: [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/Folder", "directory"),
          createDirectoryEntry("/Users/demo/.Trash", "directory"),
        ],
      },
      "/Users/demo/.Trash": {
        path: "/Users/demo/.Trash",
        parentPath: "/Users/demo",
        entries: [createDirectoryEntry("/Users/demo/.Trash/old.txt", "file")],
      },
    },
  };

  async function expectBusyDialog(title: string): Promise<void> {
    const dialog = await screen.findByRole("dialog", { name: title });
    expect(dialog).toHaveTextContent(
      "Another file operation is running. Wait for it to finish, or stop it.",
    );
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });
  }

  it("refuses Empty Trash from the menu bar without asking, and the paste goes on", async () => {
    const harness = createAppHarness(withTrash);
    renderApp(harness);
    await pasteSourceIntoFolder(harness, "c");
    await screen.findByRole("region", { name: "Pasting…" });

    await act(async () => {
      harness.emitCommand({ type: "emptyTrash" });
    });

    await expectBusyDialog("Couldn’t Empty the Trash");
    expect(
      screen.queryByRole("dialog", {
        name: "Are you sure you want to permanently erase the items in the Trash?",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "system:emptyTrash")).toBe(false);
    expect(harness.invocations.some((call) => call.channel === "writeOperation:cancel")).toBe(
      false,
    );
  });

  it("leaves Empty Trash and Delete Immediately out of the menus", async () => {
    const harness = createAppHarness(withTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");
    // A Delete Immediately that keeps running.
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/old.txt"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Delete Immediately/ }));
    });
    const question = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “old.txt”?",
    });
    await act(async () => {
      fireEvent.click(within(question).getByRole("button", { name: "Delete" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
      ).toBe(true);
    });

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/old.txt"));
    });
    expect(screen.getByRole("button", { name: /^Show Info/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete Immediately/ })).toBeNull();
    await pressKey({ key: "Escape" });
    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });
    expect(screen.getByRole("button", { name: /^Show Info/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Empty Trash/ })).toBeNull();
  });
});

// In the Trash things are only taken out or deleted for good, as in Finder: nothing is
// pasted, dropped, made or duplicated there, and Move to Trash does nothing there.
describe("file commands in the Trash", () => {
  const inTrash = {
    directorySnapshots: {
      "/Users/demo": {
        path: "/Users/demo",
        parentPath: "/Users",
        entries: [
          createDirectoryEntry("/Users/demo/source.txt", "file"),
          createDirectoryEntry("/Users/demo/Folder", "directory"),
          createDirectoryEntry("/Users/demo/.Trash", "directory"),
        ],
      },
      "/Users/demo/.Trash": {
        path: "/Users/demo/.Trash",
        parentPath: "/Users/demo",
        entries: [
          createDirectoryEntry("/Users/demo/.Trash/old.txt", "file"),
          createDirectoryEntry("/Users/demo/.Trash/Old Folder", "directory"),
        ],
      },
      "/Users/demo/.Trash/Old Folder": {
        path: "/Users/demo/.Trash/Old Folder",
        parentPath: "/Users/demo/.Trash",
        entries: [],
      },
    },
  };

  function writeRequests(harness: ReturnType<typeof createAppHarness>) {
    return harness.invocations.filter(
      (call) =>
        call.channel === "copyPaste:analyzeStart" ||
        call.channel === "copyPaste:start" ||
        call.channel === "writeOperation:trash" ||
        call.channel === "writeOperation:createFolder",
    );
  }

  it("pastes nothing into the Trash", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });
    await openDirectory("/Users/demo/.Trash");

    await pressKey({ key: "v", metaKey: true });

    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expect(writeRequests(harness)).toEqual([]);
  });

  it("makes, duplicates and trashes nothing there from the keyboard", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");
    await selectItem("/Users/demo/.Trash/old.txt");

    await pressKey({ key: "Backspace", metaKey: true });
    await pressKey({ key: "d", metaKey: true });
    await pressKey({ key: "n", metaKey: true, shiftKey: true });

    expect(writeRequests(harness)).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers only taking items out or deleting them for good in an item's menu", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("/Users/demo/.Trash/Old Folder"));
    });

    expect(screen.getByRole("button", { name: /^Delete Immediately/ })).toBeInTheDocument();
    for (const name of [/^Paste/, /^New Folder/, /^Duplicate/, /^Move to Trash/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /^Move to…/ })).toBeInTheDocument();
  });

  it("offers no Paste or New Folder on the Trash favorite", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });

    expect(screen.getByRole("button", { name: /^Empty Trash/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Paste/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^New Folder/ })).not.toBeInTheDocument();
  });

  it("refuses a drop on a folder in the Trash", async () => {
    const harness = createAppHarness(inTrash);
    renderApp(harness);
    await openDirectory("/Users/demo/.Trash");

    await dragBetween(
      await screen.findByTitle("/Users/demo/.Trash/old.txt"),
      await screen.findByTitle("/Users/demo/.Trash/Old Folder"),
    );

    expect(writeRequests(harness)).toEqual([]);
  });
});

// On a disk with no Trash (a network share, some USB drives) items can't be moved to the
// Trash; as Finder does, the window offers to delete them immediately instead.
describe("moving to the Trash on a disk without a Trash", () => {
  function trashResult(items: Array<{ path: string; noTrash?: true; error?: string }>) {
    const failed = items.filter((item) => item.noTrash || item.error);
    return {
      operationId: "write-op-trash",
      action: "trash" as const,
      status: "failed" as const,
      completedItemCount: items.length - failed.length,
      totalItemCount: items.length,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      result: {
        operationId: "write-op-trash",
        action: "trash" as const,
        status: "failed" as const,
        targetPath: null,
        startedAt: "2026-10-03T10:00:00.000Z",
        finishedAt: "2026-10-03T10:00:01.000Z",
        summary: {
          topLevelItemCount: items.length,
          totalItemCount: items.length,
          completedItemCount: items.length - failed.length,
          failedItemCount: failed.length,
          skippedItemCount: 0,
          cancelledItemCount: 0,
          completedByteCount: 0,
          totalBytes: null,
        },
        items: items.map((item) => ({
          sourcePath: item.path,
          destinationPath: null,
          status: item.noTrash || item.error ? ("failed" as const) : ("completed" as const),
          error: item.noTrash
            ? `“${item.path.split("/").at(-1)}” couldn’t be moved to the Trash because its disk has no Trash.`
            : (item.error ?? null),
          ...(item.noTrash ? { noTrash: true as const } : {}),
        })),
        error: "failed",
      },
    };
  }

  async function trashSource(harness: ReturnType<typeof createAppHarness>) {
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "Backspace", metaKey: true });
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        true,
      );
    });
  }

  it("asks, with Cancel as the default, and deletes immediately on Delete", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await trashSource(harness);

    await act(async () => {
      harness.emitProgress(trashResult([{ path: "/Users/demo/source.txt", noTrash: true }]));
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “source.txt”?",
    });
    expect(dialog).toHaveTextContent(
      "Its disk has no Trash, so it will be deleted immediately. You can’t undo this action.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:deleteImmediately")
          ?.payload,
      ).toEqual({ paths: ["/Users/demo/source.txt"] });
    });
  });

  it("deletes nothing on Cancel", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await trashSource(harness);
    await act(async () => {
      harness.emitProgress(trashResult([{ path: "/Users/demo/source.txt", noTrash: true }]));
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Are you sure you want to delete “source.txt”?",
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      harness.invocations.some((call) => call.channel === "writeOperation:deleteImmediately"),
    ).toBe(false);
  });

  it("reports other failures as failures, without asking", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await trashSource(harness);

    await act(async () => {
      harness.emitProgress(
        trashResult([
          { path: "/Users/demo/source.txt", noTrash: true },
          { path: "/Users/demo/Folder", error: "You don't have permission to access this item." },
        ]),
      );
    });

    expect(
      screen.queryByRole("dialog", { name: /Are you sure you want to delete/ }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "You don't have permission to access this item.",
    );
  });
});

describe("New Folder in the folder on screen", () => {
  function folderMadeEvent(path: string): TestProgressEvent {
    return {
      operationId: "write-op-folder",
      action: "new_folder",
      status: "completed",
      completedItemCount: 1,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: path,
      result: {
        operationId: "write-op-folder",
        action: "new_folder",
        status: "completed",
        targetPath: path,
        startedAt: "2026-10-03T10:00:00.000Z",
        finishedAt: "2026-10-03T10:00:01.000Z",
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
        items: [{ sourcePath: null, destinationPath: path, status: "completed", error: null }],
        error: null,
      },
    };
  }

  // An "untitled folder" made in Finder meanwhile isn't listed yet: the main process takes the
  // next free name, and that is the folder whose name is edited.
  it("edits the name of the folder actually made when it got the next free name", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await clearContentSelection();
    await pressKey({ key: "n", metaKey: true, shiftKey: true });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(true);
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder 2", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress(folderMadeEvent("/Users/demo/untitled folder 2"));
    });

    expect(await screen.findByLabelText("Rename untitled folder 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rename untitled folder")).not.toBeInTheDocument();
  });

  // Refused while a paste runs, the folder isn't made: an "untitled folder" that turns up later
  // (renamed or pasted) mustn't open a rename field by surprise.
  it("doesn't rename a later “untitled folder” after one was refused while busy", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await pasteSourceIntoFolder(harness, "c");
    await screen.findByRole("region", { name: "Pasting…" });
    await clearContentSelection();
    await pressKey({ key: "n", metaKey: true, shiftKey: true });
    const busy = await screen.findByRole("dialog", { name: "Couldn’t Make a New Folder" });
    await act(async () => {
      fireEvent.click(within(busy).getByRole("button", { name: "OK" }));
    });

    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
      createDirectoryEntry("/Users/demo/untitled folder", "directory"),
    ]);
    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("copy", "completed", [
          { sourcePath: "/Users/demo/source.txt", status: "completed", error: null },
        ]),
      );
    });

    await screen.findByTitle("/Users/demo/untitled folder");
    expect(screen.queryByLabelText("Rename untitled folder")).not.toBeInTheDocument();
  });
});

describe("file commands from the keyboard, in more states", () => {
  it("pastes once for a held ⌘V, without a refusal for the repeats", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "c", metaKey: true });

    await pressKey({ key: "v", metaKey: true });
    await pressKey({ key: "v", metaKey: true, repeat: true });
    await pressKey({ key: "v", metaKey: true, repeat: true });

    await vi.waitFor(() => {
      expect(analyzeRequests(harness)).toHaveLength(1);
    });
    expect(screen.queryByRole("dialog", { name: "Couldn’t Paste" })).not.toBeInTheDocument();
  });

  it("says at once that Rename and Move To wait for a running operation", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await pasteSourceIntoFolder(harness, "c");
    await screen.findByRole("region", { name: "Pasting…" });
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "F2" });
    let dialog = await screen.findByRole("dialog", { name: "Couldn’t Rename" });
    expect(screen.queryByLabelText("Rename source.txt")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    });

    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "m", metaKey: true, shiftKey: true });
    dialog = await screen.findByRole("dialog", { name: "Couldn’t Move" });
    expect(dialog).toBeInTheDocument();
  });

  it("names a new folder in its row while the list is filtered", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "s" });
    await pressKey({ key: "o" });
    await vi.waitFor(() => {
      expect(screen.queryByTitle("/Users/demo/Folder")).not.toBeInTheDocument();
    });

    await pressKey({ key: "n", metaKey: true, shiftKey: true });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "writeOperation:createFolder"),
      ).toBe(true);
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
          startedAt: "2026-10-03T10:00:00.000Z",
          finishedAt: "2026-10-03T10:00:01.000Z",
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
    expect(screen.queryByRole("dialog", { name: "Rename “New Folder”" })).not.toBeInTheDocument();
  });

  // Search results show no folder of their own: New Folder has nowhere to go.
  it("offers no New Folder on a folder in the search results", async () => {
    const harness = createAppHarness({
      searchResultItems: [
        {
          path: "/Users/demo/Folder",
          name: "Folder",
          extension: "",
          kind: "directory",
          isHidden: false,
          isSymlink: false,
          parentPath: "/Users/demo",
          relativeParentPath: ".",
        },
      ],
    });
    renderApp(harness);
    await openSearchResults();

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("search:/Users/demo/Folder"));
    });

    expect(screen.getByRole("button", { name: /^Rename/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^New Folder/ })).not.toBeInTheDocument();
  });

  // A search tab shows results, not the folder behind them: like Paste there, a drop on
  // it would put the items somewhere out of sight.
  it("takes no drop on a tab showing search results", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");
    await pressKey({ key: "t", metaKey: true });
    await vi.waitFor(() => {
      expect(screen.getAllByRole("tab")).toHaveLength(2);
    });
    // The search runs in another folder than the item dragged, so a drop would move it.
    await openDirectory("/Users/demo/Folder");
    await openSearchResults();
    const [folderTab, searchTab] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
    await act(async () => {
      fireEvent.click(folderTab);
    });
    const source = await within(await screen.findByTestId("content-pane")).findByTitle(
      "/Users/demo/source.txt",
    );

    await dragBetween(source, searchTab);

    expect(harness.invocations.map((call) => call.channel)).not.toContain("copyPaste:analyzeStart");
  });
});

describe("tabs on a folder that was renamed", () => {
  it("follow it to its new name, as a Finder window does", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Work": { path: "/Users/demo/Work", parentPath: "/Users/demo", entries: [] },
      },
    });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");
    await pressKey({ key: "t", metaKey: true });
    await openDirectory("/Users/demo/Folder");
    const [firstTab] = screen.getAllByRole("tab") as [HTMLElement, HTMLElement];
    await act(async () => {
      fireEvent.click(firstTab);
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-rename",
        action: "rename",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "write-op-rename",
          action: "rename",
          status: "completed",
          targetPath: null,
          startedAt: "2026-10-03T10:00:00.000Z",
          finishedAt: "2026-10-03T10:00:01.000Z",
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
              sourcePath: "/Users/demo/Folder",
              destinationPath: "/Users/demo/Work",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getAllByRole("tab")[1]).toHaveTextContent("Work");
    });
  });
});

describe("Empty Trash with nothing in the Trash", () => {
  // As in Finder, there is nothing to empty, so nothing to ask about.
  it("is left out of the right-click menu, and greyed out in the menu bar", async () => {
    const harness = createAppHarness({ trashEmpty: true });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });

    expect(screen.getByRole("button", { name: /^Show Info/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Empty Trash/ })).toBeNull();
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)?.disabledCommands).toContain("emptyTrash");
    });
  });

  it("stays available when what the Trash holds can't be told", async () => {
    const harness = createAppHarness({ trashEmpty: null });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await act(async () => {
      fireEvent.contextMenu(await screen.findByTitle("favorite:/Users/demo/.Trash"));
    });

    expect(screen.getByRole("button", { name: /^Empty Trash/ })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});
