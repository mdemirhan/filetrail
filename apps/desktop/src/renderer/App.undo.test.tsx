// @vitest-environment jsdom

// Undo and Redo in the window: ⌘Z goes to a text field that has the keyboard and to the
// files otherwise, the questions asked first, what the menu is told, and what is shown and
// followed once an Undo has finished.

import type { IpcRequestInput, WriteOperationProgressEvent } from "@filetrail/contracts";
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
  createAppHarness,
  createDirectoryEntry,
  expectNativeEditActions,
  expectNoRefusedRequests,
  finishedWriteEvent,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

function undoRequests(harness: ReturnType<typeof createAppHarness>) {
  return harness.invocations.filter(
    (call) => call.channel === "undo:prepare" || call.channel === "undo:start",
  );
}

function startedWith(harness: ReturnType<typeof createAppHarness>) {
  return harness.invocations
    .filter((call) => call.channel === "undo:start")
    .map((call) => call.payload as IpcRequestInput<"undo:start">);
}

function undoEvent(
  items: Array<{
    sourcePath: string | null;
    destinationPath: string | null;
    status?: "completed" | "skipped" | "failed";
    error?: string;
  }>,
  action: "undo" | "redo" = "undo",
): WriteOperationProgressEvent {
  const event = finishedWriteEvent({
    operationId: "write-op-undo",
    action,
    targetPath: null,
    items: items.map(({ sourcePath, destinationPath }) => ({ sourcePath, destinationPath })),
  });
  const result = event.result;
  if (!result) {
    return event;
  }
  const resultItems = items.map((item) => ({
    sourcePath: item.sourcePath,
    destinationPath: item.destinationPath,
    status: item.status ?? ("completed" as const),
    error: item.error ?? null,
    skipReason: null,
  }));
  const problems = resultItems.filter((item) => item.status !== "completed").length;
  const completed = resultItems.length - problems;
  const status = problems === 0 ? "completed" : completed > 0 ? "partial" : "failed";
  return {
    ...event,
    status,
    completedItemCount: completed,
    result: {
      ...result,
      status,
      items: resultItems,
      summary: {
        ...result.summary,
        completedItemCount: completed,
        skippedItemCount: resultItems.filter((item) => item.status === "skipped").length,
        failedItemCount: resultItems.filter((item) => item.status === "failed").length,
      },
      error: resultItems.find((item) => item.error)?.error ?? null,
    },
  };
}

describe("⌘Z and ⇧⌘Z", () => {
  it("undo the last file operation when the files have the keyboard", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });

    await vi.waitFor(() => {
      expect(startedWith(harness)).toEqual([{ ticket: "undo:1:1" }]);
    });
    expectNativeEditActions(harness, []);
  });

  it("redo with ⇧⌘Z", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "redo" });
    });

    await vi.waitFor(() => {
      expect(startedWith(harness)).toEqual([{ ticket: "redo:1:1" }]);
    });
  });

  it("undo the typing in a text field that has the keyboard, never the files", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const searchInput = await screen.findByPlaceholderText("Search");

    await act(async () => {
      searchInput.focus();
      harness.emitCommand({ type: "undo" });
      harness.emitCommand({ type: "redo" });
    });

    expectNativeEditActions(harness, ["undo", "redo"]);
    expect(undoRequests(harness)).toEqual([]);
  });

  it("does nothing more for a key held down", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await act(async () => {
      fireEvent.keyDown(window, { key: "z", metaKey: true, repeat: true });
      harness.emitCommand({ type: "undo" });
    });

    expect(undoRequests(harness)).toEqual([]);
  });

  it("does nothing while another operation runs", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        true,
      );
    });

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });

    expect(undoRequests(harness)).toEqual([]);
  });
});

describe("what the menu is told", () => {
  it("says when a text field has the keyboard, so Undo stays its own", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    const searchInput = await screen.findByPlaceholderText("Search");
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)?.textEditing).toBe(false);
    });

    await act(async () => {
      searchInput.focus();
    });
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)?.textEditing).toBe(true);
    });
    expect(harness.menuStates.at(-1)?.disabledCommands).not.toContain("undo");

    await act(async () => {
      searchInput.blur();
    });
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)?.textEditing).toBe(false);
    });
  });

  it("turns the files' Undo off while an operation runs", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)?.disabledCommands).not.toContain("undo");
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.menuStates.at(-1)?.disabledCommands).toEqual(
        expect.arrayContaining(["undo", "redo"]),
      );
    });
  });
});

describe("questions before an Undo", () => {
  it("asks about a name taken, and goes ahead with Keep Both", async () => {
    const harness = createAppHarness({
      undoPrepareResponses: [
        {
          ticket: "undo:4:9",
          refusal: null,
          label: "Move to Trash of “a.txt”",
          action: "trash",
          nameTaken: ["a.txt"],
          changed: [],
        },
      ],
    });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });
    const question = await screen.findByRole("dialog", {
      name: "An item named “a.txt” is already where it would go back.",
    });
    expect(
      within(question)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Cancel", "Keep Both"]);
    expect(startedWith(harness)).toEqual([]);
    await act(async () => {
      fireEvent.click(within(question).getByRole("button", { name: "Keep Both" }));
    });

    await vi.waitFor(() => {
      expect(startedWith(harness)).toEqual([{ ticket: "undo:4:9" }]);
    });
  });

  it("says why a duplicate that changed would go to the Trash, after asking about names", async () => {
    const harness = createAppHarness({
      undoPrepareResponses: [
        {
          ticket: "undo:4:9",
          refusal: null,
          label: "Duplicate of 3 Items",
          action: "duplicate",
          nameTaken: ["a.txt"],
          changed: [
            { name: "b copy.txt", putBack: false, replaced: false },
            { name: "c copy.txt", putBack: false, replaced: false },
          ],
        },
      ],
    });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });
    const names = await screen.findByRole("dialog", {
      name: "An item named “a.txt” is already where it would go back.",
    });
    await act(async () => {
      fireEvent.click(within(names).getByRole("button", { name: "Keep Both" }));
    });
    const changed = await screen.findByRole("dialog", {
      name: "2 copies were changed after they were duplicated.",
    });
    expect(within(changed).getByText("b copy.txt")).toBeInTheDocument();
    expect(
      within(changed).getByText(
        "Undoing the duplicate moves these copies to the Trash, along with your changes. The originals aren’t affected.",
      ),
    ).toBeInTheDocument();
    expect(
      within(changed)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Move to Trash", "Cancel"]);
    // Cancel is the default: Return leaves everything as it is.
    expect(within(changed).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await act(async () => {
      fireEvent.click(within(changed).getByRole("button", { name: "Move to Trash" }));
    });

    await vi.waitFor(() => {
      expect(startedWith(harness)).toEqual([{ ticket: "undo:4:9" }]);
    });
  });

  it("starts nothing when a question is cancelled, with its button or with Escape", async () => {
    const question = {
      ticket: "undo:4:9",
      refusal: null,
      label: "Duplicate of “b.txt”",
      action: "duplicate" as const,
      nameTaken: [],
      changed: [{ name: "b copy.txt", putBack: false, replaced: false }],
    };
    const harness = createAppHarness({ undoPrepareResponses: [question, question] });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    const title = "“b copy.txt” was changed after it was duplicated.";

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });
    const first = await screen.findByRole("dialog", { name: title });
    await act(async () => {
      fireEvent.click(within(first).getByRole("button", { name: "Cancel" }));
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });
    await screen.findByRole("dialog", { name: title });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(startedWith(harness)).toEqual([]);
  });

  it("starts nothing when there is nothing to undo", async () => {
    const harness = createAppHarness({
      undoPrepareResponses: [
        {
          ticket: null,
          refusal: "cant_undo",
          label: null,
          action: null,
          nameTaken: [],
          changed: [],
        },
      ],
    });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });

    await vi.waitFor(() => {
      expect(undoRequests(harness)).toHaveLength(1);
    });
    expect(startedWith(harness)).toEqual([]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("says why an Undo couldn't start", async () => {
    const harness = createAppHarness({
      undoStartError: new Error("Something changed since Undo was chosen. Choose it again."),
    });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });

    const notice = await screen.findByRole("dialog", { name: "Couldn’t Undo" });
    expect(
      within(notice).getByText("Something changed since Undo was chosen. Choose it again."),
    ).toBeInTheDocument();
  });
});

describe("after an Undo", () => {
  async function undoAndFinish(
    harness: ReturnType<typeof createAppHarness>,
    event: WriteOperationProgressEvent,
  ) {
    await act(async () => {
      harness.emitCommand({ type: "undo" });
    });
    await vi.waitFor(() => {
      expect(startedWith(harness)).toHaveLength(1);
    });
    await act(async () => {
      harness.emitProgress(event);
    });
  }

  it("selects what came back into the folder on screen, and says nothing", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source.txt", "file"),
      createDirectoryEntry("/Users/demo/back.txt", "file"),
      createDirectoryEntry("/Users/demo/Folder", "directory"),
    ]);

    await undoAndFinish(
      harness,
      undoEvent([
        { sourcePath: "/Users/demo/.Trash/back.txt", destinationPath: "/Users/demo/back.txt" },
      ]),
    );

    await vi.waitFor(() => {
      expect(screen.getByTitle("/Users/demo/back.txt")).toHaveAttribute("data-selected", "true");
    });
    expect(screen.queryByTestId("toast-viewport")?.textContent ?? "").not.toContain("Undone");
  });

  it("says what was undone when none of it is in the folder on screen", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await undoAndFinish(
      harness,
      undoEvent([{ sourcePath: "/Users/demo/Other/a.txt", destinationPath: "/Volumes/X/a.txt" }]),
    );

    const toasts = await screen.findByTestId("toast-viewport");
    expect(within(toasts).getByText("Undone")).toBeInTheDocument();
    expect(within(toasts).getByText("Move of “source.txt”")).toBeInTheDocument();
  });

  it("lists in a dialog what was left as it was, and why", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await undoAndFinish(
      harness,
      undoEvent([
        { sourcePath: "/Users/demo/.Trash/a.txt", destinationPath: "/Users/demo/a.txt" },
        {
          sourcePath: "/Users/demo/.Trash/b.txt",
          destinationPath: "/Users/demo/b.txt",
          status: "skipped",
          error: "“b.txt” is no longer in “.Trash”.",
        },
      ]),
    );

    const dialog = await screen.findByRole("dialog", { name: "Undid 1 of 2 items" });
    // What was done can be taken back.
    expect(
      within(dialog).getByText("1 item was left as it is. ⇧⌘Z redoes what was undone."),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Left as it is")).toBeInTheDocument();
    expect(within(dialog).getByText("b.txt")).toBeInTheDocument();
    expect(within(dialog).getByText("“b.txt” is no longer in “.Trash”.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Retry|Try Again/ })).toBeNull();
  });

  it("drops from the clipboard what an Undo moved to the Trash, and follows what it moved", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      harness.emitCommand({ type: "copySelection" });
    });
    await vi.waitFor(() => {
      expect(screen.getByRole("button", { name: /clipboard/i })).toBeInTheDocument();
    });

    await undoAndFinish(
      harness,
      undoEvent([{ sourcePath: "/Users/demo/source.txt", destinationPath: null }]),
    );

    await vi.waitFor(() => {
      expect(screen.queryByRole("button", { name: /clipboard/i })).toBeNull();
    });
  });
});
