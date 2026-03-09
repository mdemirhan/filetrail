// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import type {
  CopyPasteProgressEvent,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
} from "@filetrail/contracts";

import { DEFAULT_APP_PREFERENCES } from "../shared/appPreferences";
vi.mock("./components/ContentPane", () => ({
  ContentPane: ({
    entries,
    onFocusChange,
    onItemContextMenu,
    onSelectionGesture,
    onActivateEntry,
    selectedPaths,
  }: {
    entries: Array<{ path: string; name: string }>;
    onFocusChange: (focused: boolean) => void;
    onItemContextMenu?: (path: string | null, position: { x: number; y: number }) => void;
    selectedPaths: string[];
    onSelectionGesture: (
      path: string,
      modifiers: {
        metaKey: boolean;
        shiftKey: boolean;
      },
    ) => void;
    onActivateEntry: (entry: { path: string; name: string }) => void;
  }) => (
    <div data-testid="content-pane" onClick={() => onFocusChange(true)}>
      {entries.map((entry) => (
        <button
          key={entry.path}
          type="button"
          title={entry.path}
          data-selected={selectedPaths.includes(entry.path) ? "true" : "false"}
          onClick={() => {
            onFocusChange(true);
            onSelectionGesture(entry.path, { metaKey: false, shiftKey: false });
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onItemContextMenu?.(entry.path, { x: 120, y: 140 });
          }}
          onDoubleClick={() => onActivateEntry(entry)}
        >
          {entry.name}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./components/TreePane", () => ({
  TreePane: ({ onFocusChange }: { onFocusChange: (focused: boolean) => void }) => (
    <button type="button" data-testid="tree-pane" onClick={() => onFocusChange(true)}>
      Tree
    </button>
  ),
}));
vi.mock("./components/SearchResultsPane", () => ({
  SEARCH_RESULT_ROW_HEIGHT: 32,
  SearchResultsPane: () => <div data-testid="search-results-pane" />,
}));
vi.mock("./components/GetInfoPanel", () => ({
  InfoPanel: () => null,
}));
vi.mock("./components/LocationSheet", () => ({
  LocationSheet: () => null,
}));
vi.mock("./components/HelpView", () => ({
  HelpView: () => <div data-testid="help-view" />,
}));
vi.mock("./components/SettingsView", () => ({
  SettingsView: () => <div data-testid="settings-view" />,
}));
vi.mock("./components/ToolbarIcon", () => ({
  ToolbarIcon: () => null,
}));
vi.mock("./hooks/useElementSize", () => ({
  useElementSize: () => ({ width: 1200, height: 800 }),
}));
const paneLayoutMock = {
  treeWidth: 280,
  inspectorWidth: 320,
  beginResize: () => () => undefined,
  setTreeWidth: () => undefined,
  setInspectorWidth: () => undefined,
};
vi.mock("./hooks/useExplorerPaneLayout", () => ({
  useExplorerPaneLayout: () => paneLayoutMock,
}));

import { App } from "./App";
import { type FiletrailClient, FiletrailClientProvider } from "./lib/filetrailClient";

describe("App copy/paste integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a copy toast on the first command press without changing focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCopy = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    expect(await screen.findByText("Ready to paste 1 item")).toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCopy);
  });

  it("shows a cut toast without changing focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.click(sourceButton);
    });
    const activeElementBeforeCut = document.activeElement;

    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });

    expect(await screen.findByText("Ready to move 1 item")).toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforeCut);
  });

  it("starts at home when restore last visited is disabled", async () => {
    const harness = createAppHarness({
      preferences: {
        restoreLastVisitedFolderOnStartup: false,
        treeRootPath: "/Users/demo/projects",
        lastVisitedPath: "/Users/demo/projects/filetrail",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");

    const startupSnapshotCall = harness.invocations.find(
      (call) => call.channel === "directory:getSnapshot",
    );
    expect(startupSnapshotCall?.payload).toMatchObject({
      path: "/Users/demo",
    });
  });

  it("pastes into the right-clicked folder in the content pane", async () => {
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

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("uses the selected folder in the content pane as the keyboard paste target", async () => {
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
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("pastes immediately after copy without reading an empty clipboard state", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    const folderButton = await screen.findByTitle("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
      fireEvent.click(folderButton);
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
      });
    });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("uses the selected tree folder as the keyboard paste target", async () => {
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
      fireEvent.keyDown(window, { key: "1", metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("starts non-conflicting cut/paste without a confirmation dialog", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
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
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(screen.queryByRole("dialog", { name: "Confirm Cut/Paste" })).not.toBeInTheDocument();
  });

  it("shows a modal dialog for non-recoverable planning issues", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [],
        conflicts: [],
        issues: [
          {
            code: "same_path",
            message: "Cannot paste an item onto itself.",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
          },
        ],
        warnings: [],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: false,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 0,
          totalBytes: 0,
          skippedConflictCount: 0,
        },
        canExecute: false,
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

    expect(await screen.findByRole("dialog", { name: "Paste cannot continue" })).toBeInTheDocument();
    expect(screen.getByText("Cannot paste an item onto itself.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Paste Requires Review" })).not.toBeInTheDocument();
  });

  it("shows a warning toast for empty clipboard without opening a paste dialog", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(folderButton);
    });
    const activeElementBeforePasteWarning = document.activeElement;
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Paste/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforePasteWarning);
  });

  it("shows an immediate preparing progress card before copyPaste:plan resolves", async () => {
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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    expect(screen.getByText("Preparing write plan")).toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("locks write actions immediately while paste planning is in flight", async () => {
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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    const invocationCountBeforeBlockedCopy = harness.invocations.length;
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    expect(await screen.findByText("Wait for the current write to finish")).toBeInTheDocument();
    expect(harness.invocations).toHaveLength(invocationCountBeforeBlockedCopy);

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    expect(harness.invocations).toHaveLength(invocationCountBeforeBlockedCopy);

    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true, altKey: true });
    });
    expect(harness.invocations).toHaveLength(invocationCountBeforeBlockedCopy);

    const sourceButton = await screen.findByRole("button", { name: "source.txt" });
    await act(async () => {
      fireEvent.contextMenu(sourceButton);
    });

    expect(await screen.findByRole("button", { name: "Copy⌘C" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Cut⌘X" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Paste⌘V" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("cancels a planning-phase paste immediately and keeps the clipboard cleared", async () => {
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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    expect(screen.queryByRole("region", { name: "Paste In Progress" })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();

    await act(async () => {
      harness.resolveCopyPastePlan();
    });
  });

  it("keeps the cut clipboard cleared after a cancelled cut/paste operation", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations).toContainEqual({
        channel: "copyPaste:cancel",
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

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
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

    expect(await screen.findByText("Wait for the current write to finish")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Paste In Progress" })).not.toBeInTheDocument();
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

    expect(await screen.findByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
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

    expect(screen.getByRole("region", { name: "Paste In Progress" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Paste In Progress" })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await vi.waitFor(() => {
      expect(harness.invocations).toContainEqual({
        channel: "copyPaste:cancel",
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
      expect(screen.getByTitle("/Users/demo/Folder/source.txt")).toHaveAttribute("data-selected", "true");
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

    expect(await screen.findByText("Copied path")).toBeInTheDocument();
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

    const errorDialog = await screen.findByRole("dialog", {
      name: "Unable to copy the selected path(s)",
    });
    expect(errorDialog).toBeInTheDocument();
    expect(document.activeElement).not.toBe(activeElementBeforeCopyPathError);
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
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

    expect(screen.queryByText("Ready to paste 1 item")).not.toBeInTheDocument();
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
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("/Users/demo/Folder"));
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find((call) => call.channel === "copyPaste:plan");
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
      });
    });
  });

  it("clears the clipboard after a successful paste so it cannot be repeated", async () => {
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

    expect(await screen.findByText("Pasted 1 item into Folder")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Paste Result" })).not.toBeInTheDocument();

    const planCallsBeforeRetry = harness.invocations.filter((call) => call.channel === "copyPaste:plan");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length,
      );
    });
    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
  });

  it("clears the clipboard after a skip-conflicts paste result", async () => {
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
            },
          ],
          error: null,
        },
      });
    });

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    });

    const planCallsBeforeRetry = harness.invocations.filter((call) => call.channel === "copyPaste:plan");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length,
      );
    });
    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
  });

  it("clears the cut clipboard after a failed cut/paste result", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
        items: [
          {
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        conflicts: [],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        requiresConfirmation: {
          largeBatch: false,
          cutDelete: true,
        },
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 1,
          totalBytes: 5,
          skippedConflictCount: 0,
        },
        canExecute: true,
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
      fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    });

    const planCallsBeforeRetry = harness.invocations.filter((call) => call.channel === "copyPaste:plan");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.filter((call) => call.channel === "copyPaste:plan")).toHaveLength(
        planCallsBeforeRetry.length,
      );
    });
    expect(await screen.findByText("Clipboard is empty")).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "Retry Failed Items" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry Failed Items" }));
    });

    await vi.waitFor(() => {
      const retryPlanCalls = harness.invocations.filter((call) => call.channel === "copyPaste:plan");
      expect(retryPlanCalls).toHaveLength(2);
      expect(retryPlanCalls[1]?.payload).toEqual({
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        conflictResolution: "error",
      });
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

    expect(await screen.findByText("Ready to paste 1 item")).toBeInTheDocument();
    expect(screen.queryByText("Pasting into Folder")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(1);

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

    expect(screen.queryByRole("dialog", { name: "Paste Result" })).not.toBeInTheDocument();
    expect(await screen.findByText("Pasted 1 item into Folder")).toBeInTheDocument();
    expect(document.querySelectorAll(".toast-card")).toHaveLength(2);
  });
});

function createAppHarness(args: {
  planResponse?: IpcResponse<"copyPaste:plan">;
  preferences?: Partial<IpcResponse<"app:getPreferences">["preferences"]>;
  copyTextError?: Error;
  deferCopyPastePlan?: boolean;
  deferCopyPasteStart?: boolean;
  copyPasteStartError?: Error;
} = {}): {
  client: FiletrailClient;
  invocations: Array<{ channel: IpcChannel; payload: unknown }>;
  emitProgress: (event: CopyPasteProgressEvent) => void;
  setDirectoryEntries: (
    path: string,
    entries: IpcResponse<"directory:getSnapshot">["entries"],
  ) => void;
  resolveCopyPastePlan: () => void;
  resolveCopyPasteStart: () => void;
} {
  let preferences = {
    ...DEFAULT_APP_PREFERENCES,
    viewMode: "details" as const,
    propertiesOpen: false,
    detailRowOpen: false,
    treeRootPath: "/Users/demo",
    lastVisitedPath: "/Users/demo",
    ...args.preferences,
  } as IpcResponse<"app:getPreferences">["preferences"];
  const directorySnapshots: Record<string, IpcResponse<"directory:getSnapshot">> = {
    "/Users/demo": {
      path: "/Users/demo",
      parentPath: "/Users",
      entries: [
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ],
    },
    "/Users/demo/Folder": {
      path: "/Users/demo/Folder",
      parentPath: "/Users/demo",
      entries: [],
    },
  };
  const invocations: Array<{ channel: IpcChannel; payload: unknown }> = [];
  let progressListener: ((event: CopyPasteProgressEvent) => void) | null = null;
  let resolveCopyPastePlanPromise: (() => void) | null = null;
  const copyPastePlanPromise =
    args.deferCopyPastePlan === true
      ? new Promise<void>((resolve) => {
          resolveCopyPastePlanPromise = resolve;
        })
      : null;
  let resolveCopyPasteStartPromise: (() => void) | null = null;
  const copyPasteStartPromise =
    args.deferCopyPasteStart === true
      ? new Promise<void>((resolve) => {
          resolveCopyPasteStartPromise = resolve;
        })
      : null;

  const client: FiletrailClient = {
    async invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>) {
      invocations.push({ channel, payload });
      if (channel === "app:getPreferences") {
        return { preferences } as IpcResponse<C>;
      }
      if (channel === "app:getHomeDirectory") {
        return { path: "/Users/demo" } as IpcResponse<C>;
      }
      if (channel === "app:getLaunchContext") {
        return { startupFolderPath: null } as IpcResponse<C>;
      }
      if (channel === "app:updatePreferences") {
        preferences = mergePreferences(
          preferences,
          (payload as IpcRequestInput<"app:updatePreferences">).preferences,
        );
        return { preferences } as IpcResponse<C>;
      }
      if (channel === "tree:getChildren") {
        return ({
          path: "/Users/demo",
          children: [
            {
              path: "/Users/demo/Folder",
              name: "Folder",
              kind: "directory",
              isHidden: false,
              isSymlink: false,
            },
          ],
        } satisfies IpcResponse<"tree:getChildren">) as IpcResponse<C>;
      }
      if (channel === "directory:getSnapshot") {
        return directorySnapshots[(payload as IpcRequestInput<"directory:getSnapshot">).path] as IpcResponse<C>;
      }
      if (channel === "directory:getMetadataBatch") {
        return ({
          directoryPath: (payload as IpcRequestInput<"directory:getMetadataBatch">).directoryPath,
          items: [],
        } satisfies IpcResponse<"directory:getMetadataBatch">) as IpcResponse<C>;
      }
      if (channel === "copyPaste:plan") {
        if (copyPastePlanPromise) {
          await copyPastePlanPromise;
        }
        return (
          args.planResponse ?? {
            mode: "copy",
            sourcePaths: ["/Users/demo/source.txt"],
            destinationDirectoryPath: "/Users/demo/Folder",
            conflictResolution: "error",
            items: [
              {
                sourcePath: "/Users/demo/source.txt",
                destinationPath: "/Users/demo/Folder/source.txt",
                kind: "file",
                status: "ready",
                sizeBytes: 5,
              },
            ],
            conflicts: [],
            issues: [],
            warnings: [],
            requiresConfirmation: {
              largeBatch: false,
              cutDelete: false,
            },
            summary: {
              topLevelItemCount: 1,
              totalItemCount: 1,
              totalBytes: 5,
              skippedConflictCount: 0,
            },
            canExecute: true,
          }
        ) as IpcResponse<C>;
      }
      if (channel === "copyPaste:start") {
        if (copyPasteStartPromise) {
          await copyPasteStartPromise;
        }
        if (args.copyPasteStartError) {
          throw args.copyPasteStartError;
        }
        return { operationId: "copy-op-1", status: "queued" } as IpcResponse<C>;
      }
      if (channel === "copyPaste:cancel") {
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "path:resolve") {
        return ({
          inputPath: (payload as IpcRequestInput<"path:resolve">).path,
          resolvedPath: (payload as IpcRequestInput<"path:resolve">).path,
        } satisfies IpcResponse<"path:resolve">) as IpcResponse<C>;
      }
      if (channel === "system:openPath") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:openInTerminal") {
        return { ok: true, error: null } as IpcResponse<C>;
      }
      if (channel === "system:copyText") {
        if (args.copyTextError) {
          throw args.copyTextError;
        }
        return { ok: true } as IpcResponse<C>;
      }
      if (channel === "app:clearCaches") {
        return { ok: true } as IpcResponse<C>;
      }
      throw new Error(`Unhandled channel in test harness: ${channel}`);
    },
    onCommand: () => () => undefined,
    onCopyPasteProgress(listener) {
      progressListener = listener;
      return () => {
        if (progressListener === listener) {
          progressListener = null;
        }
      };
    },
  };

  return {
    client,
    invocations,
    emitProgress(event) {
      progressListener?.(event);
    },
    setDirectoryEntries(path, entries) {
      const snapshot = directorySnapshots[path];
      if (!snapshot) {
        throw new Error(`Unknown directory snapshot path: ${path}`);
      }
      directorySnapshots[path] = {
        ...snapshot,
        entries,
      };
    },
    resolveCopyPastePlan() {
      resolveCopyPastePlanPromise?.();
    },
    resolveCopyPasteStart() {
      resolveCopyPasteStartPromise?.();
    },
  };
}

async function selectItem(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.click(button);
  });
}

async function openDirectory(path: string): Promise<void> {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.doubleClick(button);
  });
  await vi.waitFor(() => {
    expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
  });
}

function createDirectoryEntry(
  path: string,
  kind: IpcResponse<"directory:getSnapshot">["entries"][number]["kind"],
): IpcResponse<"directory:getSnapshot">["entries"][number] {
  return {
    path,
    name: path.split("/").at(-1) ?? path,
    extension: kind === "file" ? "txt" : "",
    kind,
    isHidden: false,
    isSymlink: false,
  };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function mergePreferences(
  current: IpcResponse<"app:getPreferences">["preferences"],
  patch: IpcRequestInput<"app:updatePreferences">["preferences"],
): IpcResponse<"app:getPreferences">["preferences"] {
  return Object.assign({}, current, stripUndefined(patch)) as IpcResponse<
    "app:getPreferences"
  >["preferences"];
}
