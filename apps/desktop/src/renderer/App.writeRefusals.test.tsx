// @vitest-environment jsdom

// What is said when the main process refuses to start a write: Move to Trash, Delete
// Immediately, a rename of several items, Undo and Redo, and a new folder.

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
  clearContentSelection,
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  openNewFolderFromFolderMenu,
  pressKey,
  renameSelectionTo,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

const BUSY_MESSAGE = "Another file operation is running. Wait for it to finish, or stop it.";
const busyError = () => new Error("Another write operation is already running.");

async function expectDialog(title: string, text: string) {
  const dialog = await screen.findByRole("dialog", { name: title });
  expect(dialog).toHaveTextContent(text);
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));
  });
  expect(screen.queryByRole("dialog", { name: title })).not.toBeInTheDocument();
}

async function run(harness: ReturnType<typeof createAppHarness>, type: "undo" | "redo") {
  await act(async () => {
    harness.emitCommand({ type });
  });
}

function progressCard(): HTMLElement | null {
  return screen.queryByRole("region", { name: /…$/u });
}

describe("Move to Trash", () => {
  it("says why it couldn't start, and leaves no progress behind", async () => {
    const harness = createAppHarness({ trashError: new Error("Operation not permitted") });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "Backspace", metaKey: true });

    await expectDialog("Couldn’t Move to Trash", "Operation not permitted");
    expect(progressCard()).toBeNull();
    // Nothing is held: the next one is sent.
    await selectItem("/Users/demo/source.txt");
    await pressKey({ key: "Backspace", metaKey: true });
    await vi.waitFor(() =>
      expect(
        harness.invocations.filter((call) => call.channel === "writeOperation:trash"),
      ).toHaveLength(2),
    );
  });

  it("says another operation is running when the main process finds one", async () => {
    const harness = createAppHarness({ trashError: busyError() });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await pressKey({ key: "Backspace", metaKey: true });

    await expectDialog("Couldn’t Move to Trash", BUSY_MESSAGE);
  });
});

describe("Delete Immediately", () => {
  it("says why it couldn't start", async () => {
    const harness = createAppHarness({
      deleteImmediatelyError: new Error("Read-only file system"),
      directorySnapshots: {
        "/Users/demo/.Trash": {
          path: "/Users/demo/.Trash",
          parentPath: "/Users/demo",
          entries: [createDirectoryEntry("/Users/demo/.Trash/old.txt", "file")],
        },
      },
    });
    renderApp(harness);
    const trash = await screen.findByTitle("location:/Users/demo/.Trash");
    await act(async () => {
      fireEvent.click(trash);
    });
    const item = await screen.findByTitle("/Users/demo/.Trash/old.txt");
    await act(async () => {
      fireEvent.contextMenu(item);
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

    await expectDialog("Couldn’t Delete", "Read-only file system");
    expect(screen.getByTitle("/Users/demo/.Trash/old.txt")).toBeInTheDocument();
  });
});

describe("renaming several items", () => {
  async function renameBoth(harness: ReturnType<typeof createAppHarness>) {
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/a.txt", "file"),
      createDirectoryEntry("/Users/demo/b.txt", "file"),
    ]);
    renderApp(harness);
    await selectItem("/Users/demo/a.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
    });
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
  }

  it("says why they couldn't be renamed", async () => {
    const harness = createAppHarness({ batchRenameError: new Error("The disk is locked.") });
    await renameBoth(harness);

    await expectDialog("Couldn’t Rename", "The disk is locked.");
    expect(progressCard()).toBeNull();
  });

  it("says another operation is running when the main process finds one", async () => {
    const harness = createAppHarness({ batchRenameError: busyError() });
    await renameBoth(harness);

    await expectDialog("Couldn’t Rename", BUSY_MESSAGE);
  });
});

describe("Undo and Redo", () => {
  it("say why they couldn't be prepared", async () => {
    const harness = createAppHarness({
      undoPrepareError: new Error("The Undo list couldn’t be read."),
    });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await run(harness, "undo");
    await expectDialog("Couldn’t Undo", "The Undo list couldn’t be read.");
    await run(harness, "redo");
    await expectDialog("Couldn’t Redo", "The Undo list couldn’t be read.");
  });

  it("say another operation is running when the main process finds one", async () => {
    const harness = createAppHarness({
      undoPrepareResponses: [
        {
          ticket: null,
          refusal: "busy",
          label: null,
          action: null,
          nameTaken: [],
          changed: [],
        },
      ],
    });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await run(harness, "undo");

    await expectDialog("Couldn’t Undo", BUSY_MESSAGE);
    expect(harness.invocations.some((call) => call.channel === "undo:start")).toBe(false);
  });

  it("say another operation is running when it starts one meanwhile", async () => {
    const harness = createAppHarness({ undoStartError: busyError() });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");

    await run(harness, "undo");

    await expectDialog("Couldn’t Undo", BUSY_MESSAGE);
  });
});

describe("New Folder", () => {
  it("says why the folder couldn't be made in the folder on screen", async () => {
    const harness = createAppHarness({ createFolderError: new Error("The disk is full.") });
    renderApp(harness);
    await clearContentSelection();

    await pressKey({ key: "n", metaKey: true, shiftKey: true });

    await expectDialog("The folder couldn’t be made", "The disk is full.");
    expect(screen.queryByLabelText(/^Rename /u)).not.toBeInTheDocument();
  });

  it("still offers a name for a folder whose items can't be read", async () => {
    const harness = createAppHarness();
    harness.refuseDirectory("/Users/demo/Folder", "EACCES: permission denied");
    renderApp(harness);

    await openNewFolderFromFolderMenu("/Users/demo/Folder");

    const dialog = await screen.findByRole("dialog", { name: "New Folder" });
    expect(within(dialog).getByLabelText("Folder name")).toHaveValue("untitled folder");
  });

  it("says why a hidden name couldn't be used once it was asked about", async () => {
    const harness = createAppHarness({
      renameErrors: [new Error("An item named “.source.txt” already exists.")],
    });
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await renameSelectionTo("source.txt", ".source.txt");
    const question = await screen.findByRole("dialog", { name: /begins with a dot/u });

    await act(async () => {
      fireEvent.click(within(question).getByRole("button", { name: "Use “.”" }));
    });

    await expectDialog("Couldn’t Rename", "An item named “.source.txt” already exists.");
  });
});
