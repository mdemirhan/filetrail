// @vitest-environment jsdom

// The notifications a finished operation leaves: what they say, that they go by themselves,
// and that none come when they are turned off.

import { act, fireEvent, screen, within } from "@testing-library/react";

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

import type { WriteOperationProgressEvent } from "@filetrail/contracts";
import {
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  finishedWriteEvent,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

type Harness = ReturnType<typeof createAppHarness>;

const A = "/Users/demo/a.txt";
const B = "/Users/demo/b.txt";

function createHarness(args: NonNullable<Parameters<typeof createAppHarness>[0]> = {}) {
  const harness = createAppHarness(args);
  harness.setDirectoryEntries("/Users/demo", [
    createDirectoryEntry(A, "file"),
    createDirectoryEntry(B, "file"),
    createDirectoryEntry("/Users/demo/Folder", "directory"),
  ]);
  return harness;
}

async function trashBoth(harness: Harness) {
  renderApp(harness);
  await selectItem(A);
  await act(async () => {
    fireEvent.click(screen.getByTitle(B), { metaKey: true });
  });
  await act(async () => {
    fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
  });
  await vi.waitFor(() =>
    expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(true),
  );
}

function trashEvent(status: "completed" | "cancelled"): WriteOperationProgressEvent {
  const event = finishedWriteEvent({
    operationId: "write-op-trash",
    action: "trash",
    targetPath: null,
    items: [
      { sourcePath: A, destinationPath: "/Users/demo/.Trash/a.txt" },
      { sourcePath: B, destinationPath: "/Users/demo/.Trash/b.txt" },
    ],
  });
  if (status === "completed" || !event.result) {
    return event;
  }
  return {
    ...event,
    status,
    result: {
      ...event.result,
      status,
      // Stopped before anything went: a stop part way says how far in a dialog instead.
      summary: { ...event.result.summary, completedItemCount: 0, cancelledItemCount: 2 },
      items: event.result.items.map((item) => ({
        ...item,
        destinationPath: null,
        status: "cancelled" as const,
      })),
    },
  };
}

function toastTexts(): string[] {
  return Array.from(document.querySelectorAll(".toast-card"), (toast) => toast.textContent ?? "");
}

describe("notifications", () => {
  it("tell of items moved to the Trash, naming the first and how many more", async () => {
    const harness = createHarness();
    await trashBoth(harness);

    await act(async () => {
      harness.emitProgress(trashEvent("completed"));
    });

    const viewport = await screen.findByTestId("toast-viewport");
    expect(within(viewport).getByText("Moved to Trash")).toBeInTheDocument();
    expect(within(viewport).getByText("“a.txt” and 1 more")).toBeInTheDocument();
  });

  it("go by themselves after a few seconds", async () => {
    const harness = createHarness();
    await trashBoth(harness);
    await act(async () => {
      harness.emitProgress(trashEvent("completed"));
    });
    await screen.findByTestId("toast-viewport");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.queryByTestId("toast-viewport")).toBeNull();
  });

  it("tell of a Move to Trash that was stopped", async () => {
    const harness = createHarness();
    await trashBoth(harness);

    await act(async () => {
      harness.emitProgress(trashEvent("cancelled"));
    });

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([expect.stringContaining("Move to Trash cancelled")]),
    );
  });

  it("don't come when they are turned off", async () => {
    const harness = createHarness({ preferences: { notificationsEnabled: false } });
    await trashBoth(harness);

    await act(async () => {
      harness.emitProgress(trashEvent("completed"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(toastTexts()).toEqual([]);
  });

  it("tell of a move that skipped items already there", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem(A);
    await act(async () => {
      fireEvent.click(screen.getByTitle(B), { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });
    await vi.waitFor(() =>
      expect(harness.invocations.some((call) => call.channel === "copyPaste:start")).toBe(true),
    );

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "partial",
        completedItemCount: 2,
        totalItemCount: 2,
        completedByteCount: 0,
        totalBytes: 0,
        currentSourcePath: null,
        currentDestinationPath: null,
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "partial",
          destinationDirectoryPath: "/Users/demo/Folder",
          startedAt: "2026-03-09T00:00:00.000Z",
          finishedAt: "2026-03-09T00:00:01.000Z",
          summary: {
            topLevelItemCount: 2,
            totalItemCount: 2,
            completedItemCount: 1,
            failedItemCount: 0,
            skippedItemCount: 1,
            cancelledItemCount: 0,
            completedByteCount: 0,
            totalBytes: 0,
          },
          items: [
            {
              sourcePath: A,
              destinationPath: "/Users/demo/Folder/a.txt",
              status: "completed",
              error: null,
            },
            {
              sourcePath: B,
              destinationPath: "/Users/demo/Folder/b.txt",
              status: "skipped",
              error: "Destination already exists.",
              skipReason: "planned_conflict_policy",
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() =>
      expect(toastTexts()).toEqual([expect.stringContaining("Move finished with skipped items")]),
    );
    expect(toastTexts()[0]).toContain("Moved 1 item. Skipped 1 item that already exists.");
  });
});
