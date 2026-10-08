// @vitest-environment jsdom

// Opening items (aliases, apps, files), the item menu's commands that hand items to other
// apps, and what is said when they fail.

import type { IpcRequestInput } from "@filetrail/contracts";
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

import {
  createAppHarness,
  createDirectoryEntry,
  expectNoRefusedRequests,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

type Harness = ReturnType<typeof createAppHarness>;
type HarnessArgs = NonNullable<Parameters<typeof createAppHarness>[0]>;

const LINKED_FOLDER = "/Users/demo/Linked";
const LINKED_FILE = "/Users/demo/notes-link.txt";
const APP = "/Users/demo/Tool.app";

function createHarness(args: HarnessArgs = {}): Harness {
  const harness = createAppHarness({
    resolvedPaths: {
      [LINKED_FOLDER]: "/Users/demo/Folder",
      [LINKED_FILE]: "/Users/demo/Documents/notes.txt",
    },
    ...args,
    directorySnapshots: {
      [APP]: { path: APP, parentPath: "/Users/demo", entries: [] },
      ...args.directorySnapshots,
    },
  });
  harness.setDirectoryEntries("/Users/demo", [
    createDirectoryEntry("/Users/demo/source.txt", "file"),
    createDirectoryEntry("/Users/demo/Folder", "directory"),
    createDirectoryEntry(LINKED_FOLDER, "symlink_directory", { isSymlink: true }),
    createDirectoryEntry(LINKED_FILE, "symlink_file", { isSymlink: true }),
    createDirectoryEntry(APP, "bundle"),
  ]);
  return harness;
}

function payloads<C extends "system:openPath" | "system:openPathsWithApplication">(
  harness: Harness,
  channel: C,
): IpcRequestInput<C>[] {
  return harness.invocations
    .filter((call) => call.channel === channel)
    .map((call) => call.payload as IpcRequestInput<C>);
}

async function doubleClick(path: string) {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.doubleClick(button);
  });
}

async function openMenu(path: string) {
  const button = await screen.findByTitle(path);
  await act(async () => {
    fireEvent.contextMenu(button);
  });
}

async function chooseInMenu(name: RegExp | string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

function shownFolder(): string {
  return screen.getByTestId("content-current-path").textContent ?? "";
}

describe("opening items", () => {
  it("opens the folder a folder alias points to", async () => {
    const harness = createHarness();
    renderApp(harness);

    await doubleClick(LINKED_FOLDER);

    await vi.waitFor(() => expect(shownFolder()).toBe("/Users/demo/Folder"));
  });

  it("opens the file a file alias points to, in its app", async () => {
    const harness = createHarness();
    renderApp(harness);

    await doubleClick(LINKED_FILE);

    await vi.waitFor(() =>
      expect(payloads(harness, "system:openPath")).toEqual([
        { path: "/Users/demo/Documents/notes.txt" },
      ]),
    );
  });

  it("opens nothing for an alias whose original can't be found", async () => {
    const harness = createHarness({
      resolvedPaths: {
        [LINKED_FOLDER]: new Error("ENOENT"),
        [LINKED_FILE]: new Error("ENOENT"),
      },
    });
    renderApp(harness);

    await doubleClick(LINKED_FOLDER);
    await doubleClick(LINKED_FILE);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(shownFolder()).toBe("/Users/demo");
    expect(payloads(harness, "system:openPath")).toEqual([]);
  });

  it("opens an app instead of going into it, and goes in with Show Package Contents", async () => {
    const harness = createHarness();
    renderApp(harness);

    await doubleClick(APP);
    await vi.waitFor(() => expect(payloads(harness, "system:openPath")).toEqual([{ path: APP }]));
    expect(shownFolder()).toBe("/Users/demo");

    await openMenu(APP);
    await chooseInMenu(/^Show Package Contents/);
    await vi.waitFor(() => expect(shownFolder()).toBe(APP));
  });

  it("opens several items each in its own app from the menu", async () => {
    const harness = createHarness();
    renderApp(harness);
    await selectItem("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle(LINKED_FILE), { metaKey: true });
    });

    await openMenu(LINKED_FILE);
    await chooseInMenu(/^Open(?! With| in)/);

    await vi.waitFor(() =>
      expect(payloads(harness, "system:openPath")).toEqual([
        { path: "/Users/demo/source.txt" },
        { path: LINKED_FILE },
      ]),
    );
  });

  it("opens a folder alias from its menu in a new tab at the folder it points to", async () => {
    const harness = createHarness();
    renderApp(harness);

    await openMenu(LINKED_FOLDER);
    await chooseInMenu(/^Open in New Tab/);

    await vi.waitFor(() =>
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        expect.stringContaining("demo"),
        expect.stringContaining("Folder"),
      ]),
    );
  });
});

describe("Open With", () => {
  async function chooseOther() {
    await openMenu("/Users/demo/source.txt");
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));
    await chooseInMenu("Other…");
  }

  it("opens nothing when no app is chosen", async () => {
    const harness = createHarness({
      pickApplicationResponse: { canceled: true, appPath: null, appName: null },
    });
    renderApp(harness);

    await chooseOther();

    await vi.waitFor(() =>
      expect(harness.invocations.some((call) => call.channel === "system:pickApplication")).toBe(
        true,
      ),
    );
    expect(payloads(harness, "system:openPathsWithApplication")).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says so when the window for choosing an app doesn't open", async () => {
    const harness = createHarness({ pickApplicationError: new Error("no window") });
    renderApp(harness);

    await chooseOther();

    const dialog = await screen.findByRole("dialog", { name: "Couldn’t Choose an App" });
    expect(dialog).toHaveTextContent("The window for choosing an app didn’t open.");
    expect(payloads(harness, "system:openPathsWithApplication")).toEqual([]);
  });
});

describe("handing items to other apps", () => {
  it("opens Terminal at an item's folder from its menu, and says when it can't", async () => {
    const harness = createHarness({ openInTerminalError: "LSOpenURLsWithRole() failed" });
    renderApp(harness);

    await openMenu("/Users/demo/Folder");
    await chooseInMenu(/^Open in Terminal/);

    const dialog = await screen.findByRole("dialog", { name: "Couldn’t Open Terminal" });
    expect(dialog).toHaveTextContent("couldn’t open the terminal app in this folder");
    expect(
      harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
    ).toEqual({ path: "/Users/demo/Folder" });
  });

  it("shows items in Finder from their menu, and says when Finder can't", async () => {
    const harness = createHarness({ openPathsWithApplicationError: new Error("Finder is busy") });
    renderApp(harness);

    await openMenu("/Users/demo/source.txt");
    await chooseInMenu(/^Show in Finder/);

    const dialog = await screen.findByRole("dialog", { name: "Couldn’t Show in Finder" });
    expect(dialog).toHaveTextContent("Finder couldn’t show it. Finder is busy");
    expect(payloads(harness, "system:openPathsWithApplication")).toEqual([
      {
        applicationPath: "/System/Library/CoreServices/Finder.app",
        paths: ["/Users/demo/source.txt"],
      },
    ]);
  });

  it("edits only as many files at once as the limit allows", async () => {
    const harness = createHarness({ preferences: { openItemLimit: 1 } });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/a.txt", "file"),
      createDirectoryEntry("/Users/demo/b.txt", "file"),
    ]);
    renderApp(harness);
    await selectItem("/Users/demo/a.txt");
    await act(async () => {
      fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
    });

    await openMenu("/Users/demo/b.txt");
    await chooseInMenu(/^Edit in TextEdit/);

    expect(await screen.findByRole("dialog", { name: "Too Many Items to Edit" })).toBeVisible();
    expect(payloads(harness, "system:openPathsWithApplication")).toEqual([]);
  });
});

describe("Empty Trash", () => {
  const question = "Are you sure you want to permanently erase the items in the Trash?";

  async function emptyTrashAfterAsking(harness: Harness) {
    await act(async () => {
      harness.emitCommand({ type: "emptyTrash" });
    });
    const dialog = await screen.findByRole("dialog", { name: question });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Empty Trash" }));
    });
  }

  it("says why Finder couldn't empty it", async () => {
    const harness = createHarness({
      emptyTrashError: "execution error: Not authorized to send Apple events to Finder. (-1743)",
    });
    renderApp(harness);
    await screen.findByTitle("/Users/demo/source.txt");

    await emptyTrashAfterAsking(harness);

    const dialog = await screen.findByRole("dialog", { name: "Couldn’t Empty the Trash" });
    expect(dialog).toHaveTextContent("File Trail needs permission to control Finder.");
  });

  it("reads the Trash again when it is on screen", async () => {
    const harness = createHarness({
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
    await screen.findByTitle("/Users/demo/.Trash/old.txt");
    harness.setDirectoryEntries("/Users/demo/.Trash", []);

    await emptyTrashAfterAsking(harness);

    await vi.waitFor(() =>
      expect(screen.queryByTitle("/Users/demo/.Trash/old.txt")).not.toBeInTheDocument(),
    );
  });
});

describe("the Info panel's buttons", () => {
  async function showInfoFor(harness: Harness, path: string) {
    renderApp(harness);
    await selectItem(path);
    await act(async () => {
      harness.emitCommand({ type: "toggleInfoPanel" });
    });
    await vi.waitFor(() =>
      expect(screen.getByTestId("info-panel")).toHaveTextContent(path.split("/").at(-1) ?? ""),
    );
  }

  function copiedTexts(harness: Harness): string[] {
    return harness.invocations
      .filter((call) => call.channel === "system:copyText")
      .map((call) => (call.payload as IpcRequestInput<"system:copyText">).text);
  }

  it("copy the item's path, quoted for a shell when it has spaces, and its name", async () => {
    const harness = createHarness();
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/my notes.txt", "file"),
    ]);
    await showInfoFor(harness, "/Users/demo/my notes.txt");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Info: Copy Path" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Info: Copy Name" }));
    });

    await vi.waitFor(() =>
      expect(copiedTexts(harness)).toEqual(["'/Users/demo/my notes.txt'", "my notes.txt"]),
    );
  });

  it("say so when the clipboard can't be written", async () => {
    const harness = createHarness({ copyTextError: new Error("pasteboard busy") });
    await showInfoFor(harness, "/Users/demo/source.txt");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Info: Copy Path" }));
    });
    expect(await screen.findByRole("dialog", { name: "Couldn’t Copy the Path" })).toBeVisible();
    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Info: Copy Name" }));
    });
    expect(await screen.findByRole("dialog", { name: "Couldn’t Copy the Name" })).toBeVisible();
  });

  it("edit a file in the text editor", async () => {
    const harness = createHarness({
      preferences: {
        defaultTextEditor: { appPath: "/Applications/Zed.app", appName: "Zed" },
      },
    });
    await showInfoFor(harness, "/Users/demo/source.txt");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Info: Edit" }));
    });

    await vi.waitFor(() =>
      expect(payloads(harness, "system:openPathsWithApplication")).toEqual([
        { applicationPath: "/Applications/Zed.app", paths: ["/Users/demo/source.txt"] },
      ]),
    );
  });
});
