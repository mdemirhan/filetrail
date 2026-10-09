// @vitest-environment jsdom

// A paste from start to end: review, checking, progress, cancelling, the result, the
// clipboard afterwards, and moves by drag and drop.

import { act, fireEvent, render, screen, within } from "@testing-library/react";

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

import { App } from "./App";
import { FiletrailClientProvider } from "./lib/filetrailClient";
import {
  clipboardButton,
  createAppHarness,
  createDirectoryEntry,
  createNodeFingerprint,
  dragBetween,
  expectNoFileClipboardActions,
  expectNoRefusedRequests,
  finishedResultEvent,
  openDirectory,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

describe("App copy/paste integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires confirmation before starting Replace Folder from the review dialog", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
        items: [
          {
            sourcePath: "/Users/demo/Folder",
            destinationPath: "/Users/demo/Folder",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        issues: [],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: null,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });

    const sheet = await screen.findByRole("dialog", {
      name: "“Folder” already exists in “demo”",
    });
    await act(async () => {
      fireEvent.change(within(sheet).getByLabelText("Choice for Folder"), {
        target: { value: "overwrite" },
      });
    });
    // Return does not replace: that takes a click on the red button.
    await act(async () => {
      fireEvent.keyDown(sheet, { key: "Enter" });
    });
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: /^Replace 1 and / }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "duplicate",
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "overwrite" }],
    });
  });

  it("shows structured details for live directory conflicts", async () => {
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

    expect(
      await screen.findByRole("dialog", {
        name: "“Folder” in “demo” changed while pasting",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("In “demo” now")).toBeInTheDocument();
    expect(screen.getByText("Being pasted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Keep Both" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Pasting" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    });

    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:resolveConflict")?.payload,
    ).toEqual({
      operationId: "copy-op-1",
      conflictId: "runtime-1",
      resolution: "overwrite",
    });

    // Changed again while it was asked: the new question can be answered too.
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
          conflictId: "runtime-2",
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

    expect(screen.getByRole("button", { name: "Replace" })).toBeEnabled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:resolveConflict")?.payload,
    ).toEqual({
      operationId: "copy-op-1",
      conflictId: "runtime-2",
      resolution: "overwrite",
    });
  });

  it("offers only skip for runtime conflicts when the source item is missing", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
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
        action: "move_to",
        status: "awaiting_resolution",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        runtimeConflict: {
          conflictId: "runtime-missing",
          analysisId: "analysis-1",
          sourcePath: "/Users/demo/source.txt",
          destinationPath: "/Users/demo/Folder/source.txt",
          sourceKind: "file",
          destinationKind: "missing",
          conflictClass: "file_conflict",
          reason: "source_deleted",
          sourceFingerprint: createNodeFingerprint("file"),
          destinationFingerprint: createNodeFingerprint("missing"),
          currentSourceFingerprint: createNodeFingerprint("missing"),
          currentDestinationFingerprint: createNodeFingerprint("missing"),
        },
        result: null,
      });
    });

    expect(
      await screen.findByRole("dialog", { name: /is no longer available$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/so it can only be skipped/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop Moving" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Keep Both" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    });

    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:resolveConflict")?.payload,
    ).toEqual({
      operationId: "copy-op-1",
      conflictId: "runtime-missing",
      resolution: "skip",
    });
  });

  it("shows an immediate preparing progress card before the analysis finishes", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
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
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.getByText(/· Preparing…$/u)).toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("locks write actions immediately while paste planning is in flight, but not Copy and Cut", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
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
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();

    // Only the calls that start a write count: reads (icons, the analysis polling its
    // progress) can still arrive after this point on a slow machine.
    const writeInvocations = () =>
      harness.invocations.filter(
        (inv) =>
          inv.channel === "copyPaste:analyzeStart" ||
          inv.channel === "copyPaste:start" ||
          inv.channel === "system:emptyTrash" ||
          (inv.channel.startsWith("writeOperation:") && inv.channel !== "writeOperation:cancel"),
      );

    const invocationCountBeforeBlockedPaste = writeInvocations().length;
    // Cut only fills the clipboard, so the operation under way does not hold it back. (Not
    // the folder: one on the clipboard has no Paste into Folder of its own.)
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    expect(writeInvocations()).toHaveLength(invocationCountBeforeBlockedPaste);

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expect(writeInvocations()).toHaveLength(invocationCountBeforeBlockedPaste);

    const folderButton = await screen.findByRole("button", { name: "Folder" });
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });

    // Paste is dimmed (Apple allows it for Cut, Copy and Paste); the other file actions are
    // left out of the menu until the operation ends.
    expect(await screen.findByRole("button", { name: /^Paste into Folder/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    for (const name of [/^Rename/, /^Duplicate/, /^Move to…/, /^Move to Trash/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    for (const name of ["Copy", "Cut", "Copy Path"]) {
      expect(screen.getByRole("button", { name })).not.toHaveAttribute("aria-disabled", "true");
    }

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("cancels a planning-phase paste immediately and keeps the clipboard available", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
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
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length + 1);
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
      harness.resolveCopyPastePlan();
    });
  });

  it("stops the paste when Cancel is clicked while checking, even if the analysis then finishes", async () => {
    const harness = createAppHarness({
      deferCopyPastePlan: true,
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
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    });
    await act(async () => {
      harness.resolveCopyPastePlan();
    });

    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    });
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
  });

  it("keeps the clipboard when paste planning fails", async () => {
    const harness = createAppHarness({
      copyPastePlanError: new Error("planner unavailable"),
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
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Couldn’t Paste")).toBeInTheDocument();
    expect(screen.getByText("planner unavailable")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    await selectItem("/Users/demo/Folder");

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length + 1);
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("keeps the clipboard when paste planning returns issues", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        items: [],
        issues: [
          {
            code: "destination_missing",
            message: "Destination folder is unavailable.",
            sourcePath: null,
            destinationPath: "/Users/demo/Folder",
          },
        ],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
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
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Couldn’t Paste")).toBeInTheDocument();
    expect(screen.getByText("The folder “Folder” no longer exists.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "OK" }));
    });
    await selectItem("/Users/demo/Folder");

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length + 1);
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("shows a dialog when analysis finishes with an error before paste starts", async () => {
    const harness = createAppHarness({
      analysisUpdateResponse: {
        analysisId: "analysis-1",
        status: "error",
        done: true,
        report: null,
        error: "Planner unavailable.",
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
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Couldn’t Paste")).toBeInTheDocument();
    expect(screen.getByText("Planner unavailable.")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("does not show a failure notice when analysis is explicitly cancelled before paste starts", async () => {
    const harness = createAppHarness({
      analysisUpdateResponse: {
        analysisId: "analysis-1",
        status: "cancelled",
        done: true,
        report: null,
        error: null,
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
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.some((call) => call.channel === "copyPaste:analyzeGetUpdate"),
      ).toBe(true);
    });
    expect(screen.queryByText("Couldn’t Paste")).not.toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("keeps cut items on the clipboard when a cancelled move moved nothing", async () => {
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
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
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
      fireEvent.keyDown(window, { key: "x", metaKey: true });
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
        mode: "cut",
        status: "running",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        result: null,
      });
    });

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      fireEvent.click(stopButton);
    });

    await vi.waitFor(() => {
      expect(harness.invocations).toContainEqual({
        channel: "writeOperation:cancel",
        payload: { operationId: "copy-op-1" },
      });
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "cancelled",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "cancelled",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 1,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "cancelled",
              error: "User cancelled the operation.",
            },
          ],
          error: "User cancelled the operation.",
        },
      });
    });

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length + 1);
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("clears the starting progress card if copyPaste:start is rejected as busy", async () => {
    const harness = createAppHarness({
      copyPasteStartError: new Error("Another write operation is already running."),
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
    await selectItem("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Couldn’t Paste")).toBeInTheDocument();
    expect(
      screen.getByText("Another file operation is running. Try again when it has finished."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();
  });

  it("shows streamed progress and dispatches cancel requests", async () => {
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
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.queryByText("Pasting into Folder")).not.toBeInTheDocument();

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "running",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: "/Users/demo/source.txt",
        currentDestinationPath: "/Users/demo/Folder/source.txt",
        result: null,
      });
    });

    expect(screen.getByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Pasting…" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations).toContainEqual({
        channel: "writeOperation:cancel",
        payload: { operationId: "copy-op-1" },
      });
    });
  });

  it("selects pasted items in the current view after paste finishes", async () => {
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
    await openDirectory("/Users/demo/Folder");
    harness.setDirectoryEntries("/Users/demo/Folder", [
      createDirectoryEntry("/Users/demo/Folder/source.txt", "file"),
    ]);

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
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
    });

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/Folder/source.txt")).toHaveAttribute(
        "data-selected",
        "true",
      );
    });
  });

  it("shows copy-path success as a toast and failures as a modal dialog without changing focus", async () => {
    const successHarness = createAppHarness();

    const { unmount } = render(
      <FiletrailClientProvider value={successHarness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCopyPath = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true, altKey: true });
    });

    const toastViewport = await screen.findByTestId("toast-viewport");
    expect(within(toastViewport).getByText("Copied path")).toBeInTheDocument();
    expect(within(toastViewport).getByText("source.txt")).toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCopyPath);

    unmount();

    const failureHarness = createAppHarness({
      copyTextError: new Error("clipboard unavailable"),
    });

    render(
      <FiletrailClientProvider value={failureHarness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const failedSourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(failedSourceButton);
    });
    const activeElementBeforeCopyPathError = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyC", key: "c", metaKey: true, altKey: true });
    });

    const errorDialog = await screen.findByRole("dialog", { name: "Couldn’t Copy the Path" });
    expect(errorDialog).toBeInTheDocument();
    expect(document.activeElement).not.toBe(activeElementBeforeCopyPathError);
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
  });

  it("fills the clipboard without a notification", async () => {
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

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(document.querySelectorAll(".toast-card")).toHaveLength(0);
  });

  it("lists the clipboard from the menu command, and takes items off it there", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    // Nothing to show while the clipboard is empty.
    await screen.findByTestId("content-pane");
    await act(async () => {
      harness.emitCommand({ type: "showClipboard" });
    });
    expect(screen.queryByRole("menu", { name: "Clipboard" })).toBeNull();

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    // Copying does not open the list by itself.
    expect(screen.queryByRole("menu", { name: "Clipboard" })).toBeNull();

    await act(async () => {
      harness.emitCommand({ type: "showClipboard" });
    });
    const menu = screen.getByRole("menu", { name: "Clipboard" });
    expect(within(menu).getByRole("menuitem", { name: "source.txt" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("button", { name: "Remove source.txt from the clipboard" }),
      );
    });
    expect(clipboardButton()).toBeNull();
    expect(screen.queryByRole("menu", { name: "Clipboard" })).toBeNull();
  });

  it("empties the clipboard from the menu command", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");

    await act(async () => {
      harness.emitCommand({ type: "clearClipboard" });
    });
    expect(clipboardButton()).toBeNull();

    // With nothing left to paste, Paste does nothing.
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expectNoFileClipboardActions(harness);
  });

  it("suppresses notifications entirely when the preference is disabled", async () => {
    const harness = createAppHarness({
      preferences: {
        notificationsEnabled: false,
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

    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    expect(document.querySelectorAll(".toast-card")).toHaveLength(0);
  });

  it("copies on the first command press after selecting an item", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("/Users/demo/Folder"));
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("keeps copied items on the clipboard after a paste so it can be repeated", async () => {
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
    });

    const updatedToastViewport = await screen.findByTestId("toast-viewport");
    const pastedToastTitle = within(updatedToastViewport).getByText("Pasted into Folder");
    const pastedToast = pastedToastTitle.closest(".toast-card");
    expect(pastedToast).not.toBeNull();
    expect(within(pastedToast as HTMLElement).getByText("“source.txt”")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /^Pasted \d+ of/ })).not.toBeInTheDocument();

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length + 1);
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("keeps copied items on the clipboard after a skip-conflicts paste without opening a modal", async () => {
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
        mode: "copy",
        status: "partial",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "partial",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 0,
            skippedItemCount: 1,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "skipped",
              error: "Destination already exists.",
              skipReason: "planned_conflict_policy",
            },
          ],
          error: null,
        },
      });
    });
    const toastViewport = await screen.findByTestId("toast-viewport");
    const skipToastTitle = within(toastViewport).getByText("Nothing pasted");
    const skipToast = skipToastTitle.closest(".toast-card");
    expect(skipToast).not.toBeNull();
    expect(screen.queryByRole("dialog", { name: /^Pasted \d+ of/ })).not.toBeInTheDocument();
    expect(
      within(skipToast as HTMLElement).getByText("Skipped 1 item that already exists."),
    ).toBeInTheDocument();

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length + 1);
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("keeps cut items on the clipboard when a failed move moved nothing", async () => {
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
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
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
      fireEvent.keyDown(window, { key: "x", metaKey: true });
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
        mode: "cut",
        status: "failed",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "failed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 1,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "failed",
              error: "Permission denied",
            },
          ],
          error: "Permission denied",
        },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Done" }));
    });

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length + 1);
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("clears cut items from the clipboard once the move moved them", async () => {
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
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
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
      fireEvent.keyDown(window, { key: "x", metaKey: true });
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
        mode: "cut",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
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
            completedByteCount: 0,
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
    });

    const planCallsBeforeRetry = harness.invocations.filter(
      (call) => call.channel === "copyPaste:analyzeStart",
    );
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.filter((call) => call.channel === "copyPaste:analyzeStart"),
      ).toHaveLength(planCallsBeforeRetry.length);
    });
    expect(clipboardButton()).toBeNull();
  });
  it("offers retry for failed items from the result dialog", async () => {
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
    await openDirectory("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "failed",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "failed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 1,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "failed",
              error: "Disk full",
            },
          ],
          error: "Disk full",
        },
      });
    });

    expect(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });

    await vi.waitFor(() => {
      const retryPlanCalls = harness.invocations.filter(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(retryPlanCalls).toHaveLength(2);
      expect(retryPlanCalls[1]?.payload).toEqual({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        action: "paste",
      });
    });
  });

  it("lets retry planning be cancelled before the retry starts", async () => {
    const harness = createAppHarness({
      deferCopyPastePlanCalls: [2],
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
    await openDirectory("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "copy",
        status: "failed",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: 5,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "copy",
          status: "failed",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 1,
            completedItemCount: 0,
            failedItemCount: 1,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/source.txt",
              destinationPath: "/Users/demo/Folder/source.txt",
              status: "failed",
              error: "Disk full",
            },
          ],
          error: "Disk full",
        },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /^Retry \d+ Items?$/ }));
    });

    expect(await screen.findByRole("region", { name: "Pasting…" })).toBeInTheDocument();
    const startCallsBeforeCancel = harness.invocations.filter(
      (call) => call.channel === "copyPaste:start",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    });

    expect(screen.queryByRole("region", { name: "Pasting…" })).not.toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:start")).toHaveLength(
        startCallsBeforeCancel.length,
      );
    });
  });

  it("does not add a completion toast when the paste result dialog is shown", async () => {
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

    expect(screen.queryByText("Pasting into Folder")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(0);

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
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
    });

    expect(screen.queryByRole("dialog", { name: /^Pasted \d+ of/ })).not.toBeInTheDocument();
    const updatedToastViewport = await screen.findByTestId("toast-viewport");
    const pastedToastTitle = within(updatedToastViewport).getByText("Pasted into Folder");
    const pastedToast = pastedToastTitle.closest(".toast-card");
    expect(pastedToast).not.toBeNull();
    expect(within(pastedToast as HTMLElement).getByText("“source.txt”")).toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(1);
  });

  it("moves a content selection to the tree with drag and drop", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    const dataTransfer = await dragBetween(sourceButton, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
    });
    // The drag is the system's, so it can leave the window; the page's own was stopped.
    expect(
      harness.invocations.find((call) => call.channel === "system:startFileDrag")?.payload,
    ).toEqual({ paths: ["/Users/demo/source.txt"], directories: [false], images: [] });
    expect(dataTransfer.setDragImage).not.toHaveBeenCalled();
  });

  it("moves a content selection to a favorite with drag and drop", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesInitialized: true,
        favorites: [{ path: "/Users/demo/Folder", icon: "folder" }],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const favoriteTarget = await screen.findByTitle("favorite:/Users/demo/Folder");
    await dragBetween(sourceButton, favoriteTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
  });

  it("shows a toast when drag and drop move planning is blocked before start", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        items: [],
        issues: [
          {
            code: "source_missing",
            message: "Source does not exist: /Users/demo/source.txt",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
          },
        ],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(sourceButton, treeTarget);

    expect(await screen.findByText("Couldn’t Move")).toBeInTheDocument();
    expect(screen.getByText("“source.txt” no longer exists.")).toBeInTheDocument();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);
  });

  it("auto-starts drag moves when the only review signal is a large batch warning", async () => {
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
        warnings: [{ code: "large_batch", message: "This operation will write 200 items." }],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 200,
          totalBytes: 5,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");
    await dragBetween(sourceButton, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(screen.queryByRole("dialog", { name: /already exists? in/ })).not.toBeInTheDocument();
  });

  it("keeps the full content selection when dragging one selected item", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Users/demo/second.txt", "file"),
            createDirectoryEntry("/Users/demo/Folder", "directory"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const firstSource = await screen.findByRole("button", { name: "source.txt" });
    const secondSource = await screen.findByRole("button", { name: "second.txt" });
    const treeTarget = await screen.findByTitle("tree:/Users/demo/Folder");

    await act(async () => {
      fireEvent.click(firstSource);
      fireEvent.click(secondSource, { metaKey: true });
    });
    await dragBetween(firstSource, treeTarget);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt", "/Users/demo/second.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
  });

  it("moves a content selection onto another folder row in the content pane", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    const folderButton = await screen.findByRole("button", { name: "Folder" });
    await dragBetween(sourceButton, folderButton);

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
        true,
      );
    });
    expect(
      harness.invocations.find((call) => call.channel === "copyPaste:analyzeStart")?.payload,
    ).toMatchObject({
      mode: "cut",
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/Folder",
      action: "move_to",
    });
  });

  it("requires review for pure folder collisions during move drag and drop", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/test2", "directory"),
            createDirectoryEntry("/Users/demo/test3_1", "directory"),
          ],
        },
      },
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/test3_1"],
        destinationDirectoryPath: "/Users/demo/test2",
        items: [
          {
            sourcePath: "/Users/demo/test3_1",
            destinationPath: "/Users/demo/test2/test3_1",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        issues: [],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceFolder = await screen.findByRole("button", { name: "test3_1" });
    const targetFolder = await screen.findByRole("button", { name: "test2" });
    await dragBetween(sourceFolder, targetFolder);

    const sheet = await screen.findByRole("dialog", { name: /already exists? in/ });
    expect(screen.queryByLabelText("Move To")).toBeNull();
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    // One folder that already exists: the sheet, with no Add Missing for a move.
    expect(within(sheet).queryByRole("radio", { name: "Add Missing" })).toBeNull();
    await act(async () => {
      fireEvent.change(within(sheet).getByLabelText("Choice for test3_1"), {
        target: { value: "keep_both" },
      });
    });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Move" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/test3_1"],
      destinationDirectoryPath: "/Users/demo/test2",
      // The answer is for that one item; everything else stays safe.
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "keep_both" }],
    });
  });

  it("shows the same move review for cut/paste folder collisions", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/test3_1"],
        destinationDirectoryPath: "/Users/demo/test2",
        items: [
          {
            sourcePath: "/Users/demo/test3_1",
            destinationPath: "/Users/demo/test2/test3_1",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        issues: [],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
        },
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/test2", "directory"),
            createDirectoryEntry("/Users/demo/test3_1", "directory"),
          ],
        },
        "/Users/demo/test2": {
          path: "/Users/demo/test2",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/test3_1");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await openDirectory("/Users/demo/test2");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    const sheet = await screen.findByRole("dialog", { name: /already exists? in/ });
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    // One folder that already exists: the sheet, with no Add Missing for a move.
    expect(within(sheet).queryByRole("radio", { name: "Add Missing" })).toBeNull();
    await act(async () => {
      fireEvent.change(within(sheet).getByLabelText("Choice for test3_1"), {
        target: { value: "keep_both" },
      });
    });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Move" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/test3_1"],
      destinationDirectoryPath: "/Users/demo/test2",
      // The answer is for that one item; everything else stays safe.
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "keep_both" }],
    });
  });

  it("clears only the cut it pasted, not one made while the review sheet was open", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/test3_1"],
        destinationDirectoryPath: "/Users/demo/test2",
        items: [
          {
            sourcePath: "/Users/demo/test3_1",
            destinationPath: "/Users/demo/test2/test3_1",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        issues: [],
        warnings: [],
        summary: { topLevelItemCount: 1, totalItemCount: 1, totalBytes: 0 },
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/test2", "directory"),
            createDirectoryEntry("/Users/demo/test3_1", "directory"),
          ],
        },
        "/Users/demo/test2": { path: "/Users/demo/test2", parentPath: "/Users/demo", entries: [] },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/test3_1");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    const pasted = harness.invocations.findLast((call) => call.channel === "app:setClipboard")
      ?.payload as IpcRequestInput<"app:setClipboard">;
    const pastedCapturedAt = pasted.clipboard.type === "ready" ? pasted.clipboard.capturedAt : "";
    await openDirectory("/Users/demo/test2");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    const sheet = await screen.findByRole("dialog", { name: /already exists? in/ });

    // Another window cuts something else while the sheet is open.
    await act(async () => {
      harness.emitClipboardChanged({
        type: "ready",
        mode: "cut",
        sourcePaths: ["/Users/demo/other.txt"],
        sourceEntries: {},
        capturedAt: "2099-01-01T00:00:00.000Z",
      });
    });
    await act(async () => {
      fireEvent.change(within(sheet).getByLabelText("Choice for test3_1"), {
        target: { value: "keep_both" },
      });
    });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Move" }));
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
      ).toMatchObject({ clearsCutClipboard: pastedCapturedAt });
    });

    await act(async () => {
      harness.emitProgress(
        finishedResultEvent("cut", "completed", [
          { sourcePath: "/Users/demo/test3_1", status: "completed", error: null },
        ]),
      );
    });

    // The new cut is still there.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
  });

  it("shows the same move review for Move To folder collisions", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/test3_1"],
        destinationDirectoryPath: "/Users/demo/test2",
        items: [
          {
            sourcePath: "/Users/demo/test3_1",
            destinationPath: "/Users/demo/test2/test3_1",
            kind: "directory",
            status: "conflict",
            sizeBytes: null,
          },
        ],
        issues: [],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 0,
        },
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/test2", "directory"),
            createDirectoryEntry("/Users/demo/test3_1", "directory"),
          ],
        },
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/test3_1");
    await act(async () => {
      fireEvent.keyDown(window, { key: "m", metaKey: true, shiftKey: true });
    });

    await screen.findByText("Move");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Destination folder"), {
        target: { value: "/Users/demo/test2" },
      });
      fireEvent.click(screen.getByText("Move"));
    });

    const sheet = await screen.findByRole("dialog", { name: /already exists? in/ });
    expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(false);

    // One folder that already exists: the sheet, with no Add Missing for a move.
    expect(within(sheet).queryByRole("radio", { name: "Add Missing" })).toBeNull();
    await act(async () => {
      fireEvent.change(within(sheet).getByLabelText("Choice for test3_1"), {
        target: { value: "keep_both" },
      });
    });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Move" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true);
    });
    expect(
      harness.invocations.findLast((call) => call.channel === "copyPaste:start")?.payload,
    ).toMatchObject({
      action: "move_to",
      sourcePaths: ["/Users/demo/test3_1"],
      destinationDirectoryPath: "/Users/demo/test2",
      // The answer is for that one item; everything else stays safe.
      policy: {
        file: "skip",
        directory: "skip",
        mismatch: "skip",
      },
      overrides: [{ nodeId: expect.any(String), action: "keep_both" }],
    });
  });
});
