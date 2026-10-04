// @vitest-environment jsdom

// Context menus on items and the tree, pasting into a chosen folder, Calculate Size, the
// tree's own commands and Go to Folder.

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";
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
vi.mock("./lib/progressCardDelay", async () =>
  (await import("./test/appMocks")).progressCardDelayMock(),
);

import { App } from "./App";
import { type FiletrailClient, FiletrailClientProvider } from "./lib/filetrailClient";
import {
  type RendererCommand,
  batchRenameEvent,
  clipboardButton,
  createAppHarness,
  createDirectoryEntry,
  createTreeChild,
  expectClipboardListing,
  expectNativeEditActions,
  expectNoRefusedRequests,
  focusTreePane,
  openDirectory,
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

describe("App copy/paste integration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("moves the selected items to Trash with Cmd+Backspace", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.click(folderButton, { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Backspace", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/source.txt", "/Users/demo/Folder"],
      });
    });
  });

  it("renames the single selected item on Return like Finder", async () => {
    const harness = createAppHarness();
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source-a.txt", "file"),
    ]);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByTitle("/Users/demo/source-a.txt");
    await act(async () => {
      fireEvent.click(sourceAButton);
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    await screen.findByLabelText("Rename source-a.txt");
    expect(harness.invocations.some((call) => call.channel === "system:openPath")).toBe(false);
  });

  it("opens the selected paths on Return when the Return key is set to open", async () => {
    const harness = createAppHarness({ preferences: { returnKeyAction: "open" } });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source-a.txt", "file"),
      createDirectoryEntry("/Users/demo/source-b.txt", "file"),
    ]);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByTitle("/Users/demo/source-a.txt");
    const sourceBButton = await screen.findByTitle("/Users/demo/source-b.txt");
    await act(async () => {
      fireEvent.click(sourceAButton);
      fireEvent.click(sourceBButton, { metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });

    const openPathCalls = harness.invocations.filter((call) => call.channel === "system:openPath");
    expect(openPathCalls.slice(-2).map((call) => call.payload)).toEqual([
      { path: "/Users/demo/source-a.txt" },
      { path: "/Users/demo/source-b.txt" },
    ]);
  });

  it("names the editor in Edit, and leaves Edit out for folders and mixed selections", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    const folderButton = await screen.findByTitle("/Users/demo/Folder");

    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });
    expect(screen.getByRole("button", { name: /^Edit in TextEdit/ })).toHaveAttribute(
      "aria-disabled",
      "false",
    );

    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    await act(async () => {
      fireEvent.click(folderButton);
      fireEvent.contextMenu(folderButton);
    });
    expect(screen.queryByRole("button", { name: /^Edit in/ })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.mouseDown(document.body);
    });
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.click(folderButton, { metaKey: true });
      fireEvent.contextMenu(folderButton);
    });
    expect(screen.queryByRole("button", { name: /^Edit in/ })).not.toBeInTheDocument();
  });

  it("quick-looks an item from its menu, which has no Paste for a file", async () => {
    const harness = createAppHarness();
    renderApp(harness);

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.contextMenu(sourceButton);
    });
    expect(screen.queryByRole("button", { name: /^Paste/ })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quick Look/ }));
    });

    expect(harness.invocations.findLast((call) => call.channel === "system:quickLook")).toEqual(
      expect.objectContaining({ payload: { path: "/Users/demo/source.txt" } }),
    );
  });

  it("shows a notice when Open exceeds the configured item limit", async () => {
    const harness = createAppHarness({
      preferences: {
        openItemLimit: 1,
      },
    });
    harness.setDirectoryEntries("/Users/demo", [
      createDirectoryEntry("/Users/demo/source-a.txt", "file"),
      createDirectoryEntry("/Users/demo/source-b.txt", "file"),
    ]);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceAButton = await screen.findByTitle("/Users/demo/source-a.txt");
    const sourceBButton = await screen.findByTitle("/Users/demo/source-b.txt");
    await act(async () => {
      fireEvent.click(sourceAButton);
      fireEvent.click(sourceBButton, { metaKey: true });
    });
    await act(async () => {
      harness.emitCommand({ type: "openSelection" });
    });

    expect(await screen.findByRole("dialog", { name: "Too Many Items to Open" })).toHaveTextContent(
      "File Trail opens up to 1 item at a time, and 2 are selected.",
    );
    expect(
      harness.invocations.find(
        (call) =>
          call.channel === "system:openPath" &&
          (call.payload as IpcRequestInput<"system:openPath">).path === "/Users/demo/source-a.txt",
      ),
    ).toBeUndefined();
  });

  it("shows an action notice when open with launch fails", async () => {
    const harness = createAppHarness({
      openPathsWithApplicationError: new Error("Application not found"),
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const sourceButton = await screen.findByTitle("/Users/demo/source.txt");
    await act(async () => {
      fireEvent.click(sourceButton);
      fireEvent.contextMenu(sourceButton);
    });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Open With" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Visual Studio Code" }));
    });

    expect(
      await screen.findByRole("dialog", { name: "Couldn’t Open in Visual Studio Code" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Application not found/)).toBeInTheDocument();
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
      const planCall = harness.invocations.find(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  // Like Finder: ⌘V goes into the folder on screen, never out of sight into a selected
  // folder (often the one just pasted). A folder's own menu pastes into it.
  it("pastes into the folder on screen with Cmd+V, even with a folder selected", async () => {
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
      const planCall = harness.invocations.find(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo",
      });
    });
  });

  it("pastes into a folder from that folder's menu", async () => {
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
    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Paste/ }));
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.find(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  // The status bar shows a size as it comes in: the selection's, which a right-clicked item
  // is part of, or the folder on screen's. The Info panel opens only for a folder in the
  // sidebar that nothing else on screen shows.
  describe("Calculate Size", () => {
    const folderSizes = { "/Users/demo": 9_000_000, "/Users/demo/Folder": 4_000 };

    async function renderApp(
      preferences: Partial<IpcResponse<"app:getPreferences">["preferences"]> = {},
    ) {
      const harness = createAppHarness({ preferences, folderSizes });
      render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );
      await screen.findByTitle("/Users/demo/Folder");
      return harness;
    }
    async function chooseCalculateSize(target: HTMLElement) {
      await act(async () => {
        fireEvent.contextMenu(target);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Calculate Size" }));
      });
    }
    const calculated = (harness: ReturnType<typeof createAppHarness>) =>
      harness.invocations
        .filter(
          (call) =>
            call.channel === "folderSize:start" &&
            !(call.payload as { probeOnly?: boolean }).probeOnly,
        )
        .map((call) => call.payload);

    it("shows a folder's size in the status bar, in a view without a Size column", async () => {
      const harness = await renderApp({ viewMode: "icons" });
      await chooseCalculateSize(screen.getByTitle("/Users/demo/Folder"));

      await waitFor(() =>
        expect(screen.getByTestId("content-status")).toHaveTextContent(/selected · 4\.0 KB$/),
      );
      expect(calculated(harness)).toEqual([{ path: "/Users/demo/Folder", recalculate: true }]);
      expect(screen.queryByTestId("info-panel")).toBeNull();
    });

    it("shows the size of the folder on screen in the status bar, from empty space", async () => {
      const harness = await renderApp({ viewMode: "icons" });
      await chooseCalculateSize(screen.getByTestId("content-pane-background"));

      await waitFor(() =>
        expect(screen.getByTestId("content-status")).toHaveTextContent(/items · 9\.0 MB$/),
      );
      expect(calculated(harness)).toEqual([{ path: "/Users/demo", recalculate: true }]);
      expect(screen.queryByTestId("info-panel")).toBeNull();
    });

    it("leaves the Info panel closed for the sidebar's folder on screen", async () => {
      await renderApp({ viewMode: "icons" });
      await chooseCalculateSize(await screen.findByTitle("tree:/Users/demo"));

      await waitFor(() =>
        expect(screen.getByTestId("content-status")).toHaveTextContent(/9\.0 MB$/),
      );
      expect(screen.queryByTestId("info-panel")).toBeNull();
    });

    it("leaves the Info panel closed for a sidebar folder in the Details view's Size column", async () => {
      const harness = await renderApp({ viewMode: "details" });
      await chooseCalculateSize(await screen.findByTitle("tree:/Users/demo/Folder"));

      await vi.waitFor(() =>
        expect(calculated(harness)).toEqual([{ path: "/Users/demo/Folder", recalculate: true }]),
      );
      expect(screen.queryByTestId("info-panel")).toBeNull();
    });

    it("shows the Info of a sidebar folder that nothing else on screen shows", async () => {
      await renderApp({ viewMode: "icons" });
      await chooseCalculateSize(await screen.findByTitle("tree:/Users/demo/Folder"));

      await waitFor(() => expect(screen.getByTestId("info-panel")).toHaveTextContent("Folder"));
    });
  });

  describe("Calculate Size for several items", () => {
    async function rightClickSelection(paths: string[]) {
      const harness = createAppHarness({ preferences: { viewMode: "icons" } });
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/Folder", "directory"),
        createDirectoryEntry("/Users/demo/Other", "directory"),
        createDirectoryEntry("/Users/demo/source.txt", "file"),
        createDirectoryEntry("/Users/demo/notes.txt", "file"),
      ]);
      render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );
      const [first, ...rest] = paths;
      await selectItem(first ?? "");
      await act(async () => {
        for (const path of rest) {
          fireEvent.click(screen.getByTitle(path), { metaKey: true });
        }
      });
      await act(async () => {
        fireEvent.contextMenu(screen.getByTitle(first ?? ""));
      });
      return harness;
    }
    const measured = (harness: ReturnType<typeof createAppHarness>) =>
      harness.invocations
        .filter(
          (call) =>
            call.channel === "folderSize:start" &&
            !(call.payload as { probeOnly?: boolean }).probeOnly,
        )
        .map((call) => (call.payload as { path: string }).path);

    it("measures the folders among them, for the status bar to sum up", async () => {
      const harness = await rightClickSelection([
        "/Users/demo/source.txt",
        "/Users/demo/Folder",
        "/Users/demo/Other",
      ]);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Calculate Size" }));
      });

      await vi.waitFor(() =>
        expect(measured(harness)).toEqual(["/Users/demo/Folder", "/Users/demo/Other"]),
      );
      expect(screen.queryByTestId("info-panel")).toBeNull();
    });

    it("asks for the sizes of selected files in a view that doesn't show them", async () => {
      const harness = await rightClickSelection([
        "/Users/demo/source.txt",
        "/Users/demo/notes.txt",
      ]);

      await vi.waitFor(() =>
        expect(
          harness.invocations
            .filter((call) => call.channel === "directory:getMetadataBatch")
            .flatMap((call) => (call.payload as { paths: string[] }).paths),
        ).toEqual(expect.arrayContaining(["/Users/demo/source.txt", "/Users/demo/notes.txt"])),
      );
    });

    it("is not offered for files alone, whose sizes are known", async () => {
      await rightClickSelection(["/Users/demo/source.txt", "/Users/demo/notes.txt"]);
      // Two items are renamed together, in the Rename sheet.
      expect(screen.getByRole("button", { name: /^Rename 2 Items…/ })).toBeInTheDocument();

      expect(screen.getByRole("button", { name: /^Duplicate/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Calculate Size" })).toBeNull();
    });
  });

  describe("renaming several items", () => {
    function setup(overrides: Parameters<typeof createAppHarness>[0] = {}) {
      const harness = createAppHarness(overrides);
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a.txt", "file"),
        createDirectoryEntry("/Users/demo/b.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      renderApp(harness);
      return harness;
    }
    async function selectBoth() {
      await selectItem("/Users/demo/a.txt");
      await act(async () => {
        fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
      });
    }
    const sheet = () => screen.queryByRole("dialog", { name: /^Rename \d+ Items?$/u });
    const batchRequests = (harness: ReturnType<typeof createAppHarness>) =>
      harness.invocations
        .filter((call) => call.channel === "writeOperation:batchRename")
        .map((call) => call.payload);

    it("renames them from the menu, showing every new name first", async () => {
      const harness = setup();
      await selectBoth();
      await act(async () => {
        fireEvent.contextMenu(screen.getByTitle("/Users/demo/a.txt"));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^Rename 2 Items…/ }));
      });
      await waitFor(() => expect(sheet()).toBeInTheDocument());
      // The checks have come back once the items are listed with no change.
      await waitFor(() =>
        expect(within(sheet() as HTMLElement).getAllByText("No change")).toHaveLength(2),
      );
      await act(async () => {
        fireEvent.click(within(sheet() as HTMLElement).getByLabelText("Add Text"));
      });
      await act(async () => {
        fireEvent.change(within(sheet() as HTMLElement).getByLabelText("Text"), {
          target: { value: "-old" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Rename 2 Items" }));
      });
      expect(batchRequests(harness)).toEqual([
        {
          items: [
            { sourcePath: "/Users/demo/a.txt", destinationName: "a-old.txt", isFolder: false },
            { sourcePath: "/Users/demo/b.txt", destinationName: "b-old.txt", isFolder: false },
          ],
          onConflict: "number",
          numberSeparator: " ",
        },
      ]);
      expect(sheet()).toBeNull();
      // What was typed is kept for next time.
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "app:updatePreferences" &&
            (call.payload as { preferences: { batchRenameSettings?: { addText?: string } } })
              .preferences.batchRenameSettings?.addText === "-old",
        ),
      ).toBe(true);

      // Once done, the renamed items are selected, as a renamed item is.
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a-old.txt", "file"),
        createDirectoryEntry("/Users/demo/b-old.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("completed", [
            ["/Users/demo/a.txt", "/Users/demo/a-old.txt", "completed"],
            ["/Users/demo/b.txt", "/Users/demo/b-old.txt", "completed"],
          ]),
        );
      });
      await vi.waitFor(() => {
        expect(screen.getByTitle("/Users/demo/a-old.txt")).toHaveAttribute("data-selected", "true");
        expect(screen.getByTitle("/Users/demo/b-old.txt")).toHaveAttribute("data-selected", "true");
      });
      // The new names are in sight: no notification says so again.
      expect(document.querySelectorAll(".toast-card")).toHaveLength(0);
    });

    it("opens with F2, Return and the menu bar's Rename, and closes with Escape", async () => {
      const harness = setup();
      await selectBoth();
      await pressKey({ key: "F2" });
      await waitFor(() => expect(sheet()).toBeInTheDocument());
      await act(async () => {
        fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Escape" });
      });
      expect(sheet()).toBeNull();
      await act(async () => {
        harness.emitCommand({ type: "renameSelection" });
      });
      await waitFor(() => expect(sheet()).toBeInTheDocument());
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      });
      expect(sheet()).toBeNull();
      // Escape closes it wherever the keyboard is, even outside it.
      await pressKey({ key: "F2" });
      await waitFor(() => expect(sheet()).toBeInTheDocument());
      (document.activeElement as HTMLElement | null)?.blur();
      await pressKey({ key: "Escape" });
      expect(sheet()).toBeNull();
      // Return renames, as Finder's does (Settings can make it open instead).
      await act(async () => {
        fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
        fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
      });
      await pressKey({ key: "Enter" });
      await waitFor(() => expect(sheet()).toBeInTheDocument());
    });

    it("keeps the list's shortcuts from acting while it is open", async () => {
      const harness = setup();
      await selectBoth();
      await pressKey({ key: "F2" });
      await waitFor(() => expect(sheet()).toBeInTheDocument());
      await act(async () => {
        fireEvent.keyDown(screen.getByLabelText("Find"), { key: "Backspace", metaKey: true });
      });
      await pressKey({ key: "Backspace", metaKey: true });
      expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
        false,
      );
      expect(sheet()).toBeInTheDocument();
    });

    // Selects both items and renames them by adding "-old", as far as the request.
    async function startAddingOld() {
      await selectBoth();
      await pressKey({ key: "F2" });
      await waitFor(() =>
        expect(within(sheet() as HTMLElement).getAllByText("No change")).toHaveLength(2),
      );
      await act(async () => {
        fireEvent.click(within(sheet() as HTMLElement).getByLabelText("Add Text"));
      });
      await act(async () => {
        fireEvent.change(within(sheet() as HTMLElement).getByLabelText("Text"), {
          target: { value: "-old" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Rename 2 Items" }));
      });
    }

    it("lists what wasn't renamed, and tries it again from the sheet", async () => {
      const harness = setup();
      await startAddingOld();
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("partial", [
            ["/Users/demo/a.txt", "/Users/demo/a-old.txt", "completed"],
            ["/Users/demo/b.txt", null, "failed"],
          ]),
        );
      });
      const result = await screen.findByRole("dialog", { name: "Renamed 1 of 2 items in “demo”" });
      expect(within(result).getByText("Couldn’t rename")).toBeInTheDocument();
      expect(within(result).getByText("“b.txt” is locked.")).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(within(result).getByRole("button", { name: "Try Again…" }));
      });
      await waitFor(() =>
        expect(screen.getByRole("dialog", { name: "Rename 1 Item" })).toBeInTheDocument(),
      );
      expect(screen.queryByRole("dialog", { name: /^Renamed/u })).toBeNull();
    });

    it("says another operation is running instead of opening", async () => {
      setup();
      await startAddingOld();
      // The rename just started is still running.
      await pressKey({ key: "F2" });
      expect(sheet()).toBeNull();
      expect(
        await screen.findByText(
          "Another file operation is running. Wait for it to finish, or stop it.",
        ),
      ).toBeInTheDocument();
    });

    // a.txt, b.txt and c.txt, all selected and renamed by adding "-old", as far as the
    // request.
    async function renameThreeAddingOld() {
      const harness = createAppHarness();
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a.txt", "file"),
        createDirectoryEntry("/Users/demo/b.txt", "file"),
        createDirectoryEntry("/Users/demo/c.txt", "file"),
      ]);
      renderApp(harness);
      await selectItem("/Users/demo/a.txt");
      await act(async () => {
        fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
        fireEvent.click(screen.getByTitle("/Users/demo/c.txt"), { metaKey: true });
      });
      await pressKey({ key: "F2" });
      await waitFor(() =>
        expect(within(sheet() as HTMLElement).getAllByText("No change")).toHaveLength(3),
      );
      await act(async () => {
        fireEvent.click(within(sheet() as HTMLElement).getByLabelText("Add Text"));
      });
      await act(async () => {
        fireEvent.change(within(sheet() as HTMLElement).getByLabelText("Text"), {
          target: { value: "-old" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Rename 3 Items" }));
      });
      return harness;
    }

    async function tryAgain(result: HTMLElement) {
      await act(async () => {
        fireEvent.click(within(result).getByRole("button", { name: "Try Again…" }));
      });
    }

    it("tries again only the items that weren't renamed", async () => {
      const harness = await renameThreeAddingOld();
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a-old.txt", "file"),
        createDirectoryEntry("/Users/demo/b.txt", "file"),
        createDirectoryEntry("/Users/demo/c.txt", "file"),
      ]);
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("partial", [
            ["/Users/demo/a.txt", "/Users/demo/a-old.txt", "completed"],
            ["/Users/demo/b.txt", null, "failed"],
            ["/Users/demo/c.txt", null, "failed"],
          ]),
        );
      });
      const result = await screen.findByRole("dialog", { name: "Renamed 1 of 3 items in “demo”" });
      await tryAgain(result);

      // The sheet has the two left, with what was typed before.
      expect(await screen.findByRole("dialog", { name: "Rename 2 Items" })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Rename 2 Items" }));
      });
      expect(batchRequests(harness).at(-1)).toEqual({
        items: [
          { sourcePath: "/Users/demo/b.txt", destinationName: "b-old.txt", isFolder: false },
          { sourcePath: "/Users/demo/c.txt", destinationName: "c-old.txt", isFolder: false },
        ],
        onConflict: "number",
        numberSeparator: " ",
      });
    });

    it("tells of items skipped because their new names were taken, and tries them again", async () => {
      const harness = setup();
      await startAddingOld();
      // Nothing failed, so the rename counts as done; the skipped items are still told.
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("completed", [
            ["/Users/demo/a.txt", null, "skipped", "An item named “a-old.txt” already exists."],
            ["/Users/demo/b.txt", null, "skipped", "An item named “b-old.txt” already exists."],
          ]),
        );
      });
      const result = await screen.findByRole("dialog", { name: "Renamed 0 of 2 items in “demo”" });
      expect(result).toHaveAccessibleDescription("2 items were skipped.");
      const skipped = within(result).getByRole("region", { name: "Skipped" });
      expect(within(skipped).getByText("a.txt")).toBeInTheDocument();
      expect(
        within(skipped).getByText("An item named “a-old.txt” already exists."),
      ).toBeInTheDocument();
      expect(
        within(skipped).getByText("An item named “b-old.txt” already exists."),
      ).toBeInTheDocument();

      await tryAgain(result);
      expect(await screen.findByRole("dialog", { name: "Rename 2 Items" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: /^Renamed/u })).toBeNull();
    });

    it("says which items weren't started when the rename was stopped, and tries them again", async () => {
      const harness = await renameThreeAddingOld();
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a-old.txt", "file"),
        createDirectoryEntry("/Users/demo/b.txt", "file"),
        createDirectoryEntry("/Users/demo/c.txt", "file"),
      ]);
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("partial", [
            ["/Users/demo/a.txt", "/Users/demo/a-old.txt", "completed"],
            ["/Users/demo/b.txt", null, "cancelled"],
            ["/Users/demo/c.txt", null, "cancelled"],
          ]),
        );
      });
      const result = await screen.findByRole("dialog", { name: "Renamed 1 of 3 items in “demo”" });
      expect(result).toHaveAccessibleDescription(
        "2 items weren't started because the operation was stopped.",
      );
      const notStarted = within(result).getByRole("region", { name: "Not started" });
      expect(within(notStarted).getByText("b.txt")).toBeInTheDocument();
      expect(within(notStarted).getByText("c.txt")).toBeInTheDocument();

      await tryAgain(result);
      expect(await screen.findByRole("dialog", { name: "Rename 2 Items" })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Rename 2 Items" }));
      });
      expect(
        (batchRequests(harness).at(-1) as { items: Array<{ sourcePath: string }> }).items.map(
          (item) => item.sourcePath,
        ),
      ).toEqual(["/Users/demo/b.txt", "/Users/demo/c.txt"]);
    });

    it("tries again an item put back under its old name with a number", async () => {
      const harness = setup();
      await startAddingOld();
      // Another item took "b.txt" while b.txt waited under a hidden name.
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a-old.txt", "file"),
        createDirectoryEntry("/Users/demo/b.txt", "file"),
        createDirectoryEntry("/Users/demo/b 2.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      const reason =
        "“b.txt” is locked. Another item has its old name now, so it is named “b 2.txt”.";
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("partial", [
            ["/Users/demo/a.txt", "/Users/demo/a-old.txt", "completed"],
            ["/Users/demo/b.txt", "/Users/demo/b 2.txt", "failed", reason],
          ]),
        );
      });
      const result = await screen.findByRole("dialog", { name: "Renamed 1 of 2 items in “demo”" });
      const failed = within(result).getByRole("region", { name: "Couldn’t rename" });
      expect(within(failed).getByText("b.txt")).toBeInTheDocument();
      expect(within(failed).getByText(reason)).toBeInTheDocument();

      // It is tried again where it is now, under the name it has now.
      await tryAgain(result);
      expect(await screen.findByRole("dialog", { name: "Rename 1 Item" })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Rename 1 Item" }));
      });
      expect(batchRequests(harness).at(-1)).toMatchObject({
        items: [
          { sourcePath: "/Users/demo/b 2.txt", destinationName: "b 2-old.txt", isFolder: false },
        ],
      });
    });

    // An item left under a hidden temporary name isn't listed (hidden files are off): Try
    // Again takes it from the result, not the list.
    it("tries again an item left under a hidden temporary name", async () => {
      const harness = setup();
      await startAddingOld();
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a-old.txt", "file"),
        createDirectoryEntry("/Users/demo/Folder", "directory"),
      ]);
      const reason =
        "“b.txt” is locked. Another item has its old name now, so it is named “.filetrail-rename-abc123” (hidden).";
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("partial", [
            ["/Users/demo/a.txt", "/Users/demo/a-old.txt", "completed"],
            ["/Users/demo/b.txt", "/Users/demo/.filetrail-rename-abc123", "failed", reason],
          ]),
        );
      });
      const result = await screen.findByRole("dialog", { name: "Renamed 1 of 2 items in “demo”" });
      expect(within(result).getByText(reason)).toBeInTheDocument();

      await tryAgain(result);
      expect(await screen.findByRole("dialog", { name: "Rename 1 Item" })).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Rename 1 Item" }));
      });
      expect(batchRequests(harness).at(-1)).toMatchObject({
        items: [{ sourcePath: "/Users/demo/.filetrail-rename-abc123", isFolder: false }],
      });
    });

    it("tries again a folder put back under another name as a folder, though it isn't listed", async () => {
      const harness = setup();
      await selectItem("/Users/demo/b.txt");
      await act(async () => {
        fireEvent.click(screen.getByTitle("/Users/demo/Folder"), { metaKey: true });
      });
      await pressKey({ key: "F2" });
      await waitFor(() =>
        expect(within(sheet() as HTMLElement).getAllByText("No change")).toHaveLength(2),
      );
      await act(async () => {
        fireEvent.click(within(sheet() as HTMLElement).getByLabelText("Add Text"));
      });
      await act(async () => {
        fireEvent.change(within(sheet() as HTMLElement).getByLabelText("Text"), {
          target: { value: "-old" },
        });
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Rename 2 Items" }));
      });
      // The listing isn't read again before Try Again: "Folder 2" isn't in it.
      await act(async () => {
        harness.emitProgress(
          batchRenameEvent("partial", [
            ["/Users/demo/b.txt", "/Users/demo/b-old.txt", "completed"],
            [
              "/Users/demo/Folder",
              "/Users/demo/Folder 2",
              "failed",
              "“Folder” is locked. Another item has its old name now, so it is named “Folder 2”.",
            ],
          ]),
        );
      });
      const result = await screen.findByRole("dialog", { name: "Renamed 1 of 2 items in “demo”" });

      await tryAgain(result);
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Rename 1 Item" }));
      });
      // A folder's whole name is its name: "-old" goes at the end, not before an extension.
      expect(batchRequests(harness).at(-1)).toMatchObject({
        items: [
          { sourcePath: "/Users/demo/Folder 2", destinationName: "Folder 2-old", isFolder: true },
        ],
      });
    });

    it("numbers the items in the order the list shows them, not the order they were clicked", async () => {
      const harness = createAppHarness();
      harness.setDirectoryEntries("/Users/demo", [
        createDirectoryEntry("/Users/demo/a.txt", "file"),
        createDirectoryEntry("/Users/demo/b.txt", "file"),
        createDirectoryEntry("/Users/demo/c.txt", "file"),
      ]);
      renderApp(harness);
      await selectItem("/Users/demo/c.txt");
      await act(async () => {
        fireEvent.click(screen.getByTitle("/Users/demo/a.txt"), { metaKey: true });
        fireEvent.click(screen.getByTitle("/Users/demo/b.txt"), { metaKey: true });
      });
      await pressKey({ key: "F2" });
      await waitFor(() => expect(sheet()).toBeInTheDocument());
      // Format, as it opens: "File" and the index after it.
      await act(async () => {
        fireEvent.click(within(sheet() as HTMLElement).getByLabelText("Format"));
      });
      await act(async () => {
        fireEvent.click(await screen.findByRole("button", { name: "Rename 3 Items" }));
      });
      expect(batchRequests(harness)).toEqual([
        {
          items: [
            { sourcePath: "/Users/demo/a.txt", destinationName: "File 1.txt", isFolder: false },
            { sourcePath: "/Users/demo/b.txt", destinationName: "File 2.txt", isFolder: false },
            { sourcePath: "/Users/demo/c.txt", destinationName: "File 3.txt", isFolder: false },
          ],
          onConflict: "number",
          numberSeparator: " ",
        },
      ]);
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
      const planCall = harness.invocations.find(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
      });
    });
    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(screen.queryByText("Clipboard is empty")).not.toBeInTheDocument();
  });

  it("pastes into the right-clicked tree folder target", async () => {
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

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Paste into Folder" }));
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.findLast(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(planCall?.payload).toMatchObject({
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("pastes a copied folder back into the current directory when it is selected in content", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
        items: [
          {
            sourcePath: "/Users/demo/Folder",
            destinationPath: "/Users/demo/Folder copy",
            kind: "directory",
            status: "ready",
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
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      const planCall = harness.invocations.findLast(
        (call) => call.channel === "copyPaste:analyzeStart",
      );
      expect(planCall?.payload).toMatchObject({
        sourcePaths: ["/Users/demo/Folder"],
        destinationDirectoryPath: "/Users/demo",
      });
    });
  });

  it("pastes into the right-clicked favorite target in both integrated and separate layouts", async () => {
    for (const favoritesPlacement of ["integrated", "separate"] as const) {
      const harness = createAppHarness({
        preferences: {
          favoritesPlacement,
        },
        directorySnapshots: {
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            parentPath: "/Users/demo",
            entries: [],
          },
        },
      });

      const { unmount } = render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );

      await selectItem("/Users/demo/source.txt");
      await act(async () => {
        fireEvent.keyDown(window, { key: "c", metaKey: true });
      });

      const favoriteButton = await screen.findByTitle("favorite:/Users/demo/Documents");
      await act(async () => {
        fireEvent.contextMenu(favoriteButton);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Paste into Folder" }));
      });

      await vi.waitFor(() => {
        const planCall = harness.invocations.findLast(
          (call) => call.channel === "copyPaste:analyzeStart",
        );
        expect(planCall?.payload).toMatchObject({
          destinationDirectoryPath: "/Users/demo/Documents",
        });
      });

      unmount();
    }
  });

  it("shows tree-safe shortcut badges for right-clicked tree and favorite targets even when Favorites is selected", async () => {
    for (const targetTitle of ["tree:/Users/demo/Folder", "favorite:/Users/demo/Documents"]) {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            parentPath: "/Users/demo",
            entries: [],
          },
        },
      });

      const { unmount } = render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );

      const favoritesRootButton = await screen.findByTestId("favorites-root");
      await act(async () => {
        fireEvent.click(favoritesRootButton);
      });
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");

      const targetButton = await screen.findByTitle(targetTitle);
      await act(async () => {
        fireEvent.contextMenu(targetButton);
      });

      expect(screen.getByRole("button", { name: "Open in Terminal⌥⌘T" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();

      unmount();
    }
  });

  it("keeps tree and favorite context menus on tree-safe shortcut badges after a disabled menu click", async () => {
    for (const targetTitle of ["tree:/Users/demo/Folder", "favorite:/Users/demo/Documents"]) {
      const harness = createAppHarness({
        directorySnapshots: {
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            parentPath: "/Users/demo",
            entries: [],
          },
        },
      });

      const { unmount } = render(
        <FiletrailClientProvider value={harness.client}>
          <App />
        </FiletrailClientProvider>,
      );

      const targetButton = await screen.findByTitle(targetTitle);
      await act(async () => {
        fireEvent.contextMenu(targetButton);
      });

      const disabledButton = screen.queryByRole("button", { name: "Paste into Folder" });
      expect(disabledButton).not.toBeNull();
      if (!disabledButton) {
        throw new Error("Disabled Paste button missing.");
      }

      await act(async () => {
        fireEvent.click(disabledButton);
      });

      expect(screen.getByRole("button", { name: "Open in Terminal⌥⌘T" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy Path⌥⌘C" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show Info⌘I" })).toBeInTheDocument();
      if (targetTitle.startsWith("tree:")) {
        expect(screen.getByRole("button", { name: "Copy⌘C" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Cut⌘X" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "RenameF2" })).toBeNull();
      } else {
        expect(screen.getByRole("button", { name: "Paste into Folder" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Paste into Folder⌘V" })).toBeNull();
        expect(screen.getByRole("button", { name: "New Folder" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "New Folder⇧⌘N" })).toBeNull();
      }

      unmount();
    }
  });

  it("asks for confirmation before trashing a tree folder from the context menu", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    expect(
      await screen.findByRole("dialog", { name: "Move “Folder” to the Trash?" }),
    ).toHaveTextContent("It stays in the Trash until the Trash is emptied.");
    expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/Folder"],
      });
    });
  });

  it("closes the tree trash confirmation dialog immediately after confirming with the button", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Move to Trash" }));
    });

    const dialog = await screen.findByRole("dialog", { name: "Move “Folder” to the Trash?" });
    expect(dialog).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Move “Folder” to the Trash?" }),
      ).not.toBeInTheDocument();
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/Folder"],
      });
    });
  });

  it("closes the tree trash confirmation dialog immediately after confirming with Enter", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Move to Trash" }));
    });

    const dialog = await screen.findByRole("dialog", { name: "Move “Folder” to the Trash?" });
    await act(async () => {
      fireEvent.keyDown(dialog, { key: "Enter" });
    });

    await vi.waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Move “Folder” to the Trash?" }),
      ).not.toBeInTheDocument();
      expect(
        harness.invocations.find((call) => call.channel === "writeOperation:trash")?.payload,
      ).toEqual({
        paths: ["/Users/demo/Folder"],
      });
    });
  });

  it("reselects the parent tree folder after trashing the selected filesystem node", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(treeFolderButton);
    });
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
      fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
    });

    await act(async () => {
      harness.emitProgress({
        operationId: "write-op-trash",
        action: "trash",
        status: "completed",
        completedItemCount: 1,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: "/Users/demo/Folder",
        currentDestinationPath: null,
        result: {
          operationId: "write-op-trash",
          action: "trash",
          status: "completed",
          targetPath: null,
          startedAt: "2026-03-10T10:00:00.000Z",
          finishedAt: "2026-03-10T10:00:01.000Z",
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
              destinationPath: null,
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo");
    });
  });

  it("reselects the renamed filesystem tree folder after the write completes", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Renamed Folder": {
          path: "/Users/demo/Renamed Folder",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Folder", "directory"),
          createTreeChild("/Users/demo/Renamed Folder", "directory"),
        ],
        "/Users/demo/Renamed Folder": [],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const treeFolderButton = await screen.findByTitle("tree:/Users/demo/Folder");
    await act(async () => {
      fireEvent.click(treeFolderButton);
    });
    await act(async () => {
      fireEvent.contextMenu(treeFolderButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    });

    expect(await screen.findByRole("dialog", { name: /^Rename “/u })).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("New name"), {
        target: { value: "Renamed Folder" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
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
        currentSourcePath: "/Users/demo/Folder",
        currentDestinationPath: "/Users/demo/Renamed Folder",
        result: {
          operationId: "write-op-rename",
          action: "rename",
          status: "completed",
          targetPath: "/Users/demo/Renamed Folder",
          startedAt: "2026-03-10T10:00:00.000Z",
          finishedAt: "2026-03-10T10:00:01.000Z",
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
              destinationPath: "/Users/demo/Renamed Folder",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent(
        "fs:/Users/demo/Renamed Folder",
      );
    });
  });

  it("reveals a separate favorite in the filesystem tree", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesPlacement: "separate",
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Documents", "directory"),
          createTreeChild("/Users/demo/Folder", "directory"),
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
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

    const favoriteButton = await screen.findByTitle("favorite:/Users/demo/Documents");
    await act(async () => {
      fireEvent.contextMenu(favoriteButton);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal in Tree" }));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("tree");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Documents");
    });
  });

  it("goes Home and roots the tree there with Cmd+Shift+H", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/source.txt", "file"),
            createDirectoryEntry("/Volumes/Shared/Project", "directory"),
          ],
        },
        "/Volumes/Shared/Project": {
          path: "/Volumes/Shared/Project",
          parentPath: "/Volumes/Shared",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/": [createTreeChild("/Users", "directory"), createTreeChild("/Volumes", "directory")],
        "/Volumes": [createTreeChild("/Volumes/Shared", "directory")],
        "/Volumes/Shared": [createTreeChild("/Volumes/Shared/Project", "directory")],
        "/Users/demo": [createTreeChild("/Users/demo/Folder", "directory")],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openDirectory("/Volumes/Shared/Project");
    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/");
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "H", metaKey: true, shiftKey: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
      expect(screen.getByTitle("/Users/demo/source.txt")).toBeInTheDocument();
    });
  });

  it("roots the tree at the folder on screen, then falls back once a folder outside it opens", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      harness.emitCommand({ type: "rootTreeAtSelection" });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo/Folder");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Folder");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
    await vi.waitFor(() => {
      const lastUpdate = [...harness.invocations]
        .reverse()
        .find((call) => call.channel === "app:updatePreferences");
      expect(lastUpdate?.payload).toMatchObject({
        preferences: { treeRootPath: "/Users/demo/Folder" },
      });
    });

    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    });
  });

  it("roots the tree from a tree folder's menu, and not from the file list's", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    const folderButton = await screen.findByTitle("/Users/demo/Folder");
    await act(async () => {
      fireEvent.contextMenu(folderButton);
    });
    expect(screen.getByRole("button", { name: /^Copy Path/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Use as Tree Root/ })).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle("tree:/Users/demo/Folder"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Use as Tree Root/ }));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-root")).toHaveTextContent("/Users/demo/Folder");
    });
  });

  it("clears the content pane when the integrated Favorites root is selected", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    expect(screen.getByTitle("/Users/demo/source.txt")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("favorites-root"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("");
      expect(screen.getByTestId("content-entry-count")).toHaveTextContent("0");
      expect(screen.queryByTitle("/Users/demo/source.txt")).not.toBeInTheDocument();
    });
  });

  it("keeps the separate favorites subview active and clears content when Favorites is selected", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesPlacement: "separate",
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorites-root"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");
      expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("");
      expect(screen.getByTestId("content-entry-count")).toHaveTextContent("0");
    });
  });

  it("copies the tree's folder with Cmd+C in tree focus, not a stale selection in the list", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "c", metaKey: true });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("cuts the tree's folder with Cmd+X in tree focus, not a stale selection in the list", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("pastes into the tree's selected folder with Cmd+V in tree focus", async () => {
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
    await focusTreePane();
    expect(screen.getByTestId("tree-selection")).toHaveTextContent("fs:/Users/demo/Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
      });
    });
  });

  it("does not paste from the tree when the Favorites root is selected", async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByTestId("favorites-root"));
    });
    expect(screen.getByTestId("tree-selection")).toHaveTextContent("favorites-root");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
      harness.emitCommand({ type: "editPaste" });
    });

    expect(harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart")).toBe(
      false,
    );
  });

  it("pastes into the folder on screen when no pane has focus, even with a folder selected", async () => {
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
    // Focusing the search field takes focus away from both panes.
    await act(async () => {
      fireEvent.focus(screen.getByPlaceholderText("Search"));
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo" });
    });
  });

  it("blocks Cmd+Shift+N in tree focus even when content still has a stale selection", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Folder");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    });

    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
  });

  it("allows Cmd+Option+C in tree focus for the selected tree folder", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyC", metaKey: true, altKey: true });
    });

    expect(harness.invocations.find((call) => call.channel === "system:copyText")?.payload).toEqual(
      { text: "/Users/demo" },
    );
  });

  it("copies the tree's folder from the Copy menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "editCopy" });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item copied");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("cuts the tree's folder from the Cut menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "editCut" });
    });

    // The folder the tree is on, never the selection left behind in the list.
    expect(clipboardButton()).toHaveAccessibleName("Clipboard: 1 item cut");
    await expectClipboardListing(harness, ["demo"]);
  });

  it("pastes into the tree's selected folder from the Paste menu command in tree focus", async () => {
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
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "editPaste" });
    });

    await vi.waitFor(() => {
      expect(
        harness.invocations.findLast((call) => call.channel === "copyPaste:analyzeStart")?.payload,
      ).toMatchObject({ destinationDirectoryPath: "/Users/demo/Folder" });
    });
    expectNativeEditActions(harness, []);
  });

  it("blocks the New Folder menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "newFolder" });
    });

    expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
  });

  it("allows the Copy Path menu command in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      harness.emitCommand({ type: "copyPath" });
    });

    expect(harness.invocations.find((call) => call.channel === "system:copyText")?.payload).toEqual(
      { text: "/Users/demo" },
    );
  });

  it("keeps dangerous renderer commands blocked in tree focus", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();

    const commands: Array<{
      command: RendererCommand["type"];
      assertNoSideEffect: () => void;
    }> = [
      {
        command: "editSelection",
        assertNoSideEffect: () => {
          expect(
            harness.invocations.some((call) => call.channel === "system:openPathsWithApplication"),
          ).toBe(false);
        },
      },
      {
        command: "moveSelection",
        assertNoSideEffect: () => {
          expect(screen.queryByText("Move")).not.toBeInTheDocument();
        },
      },
      {
        command: "renameSelection",
        assertNoSideEffect: () => {
          expect(screen.queryByRole("dialog", { name: /^Rename “/u })).not.toBeInTheDocument();
        },
      },
      {
        command: "duplicateSelection",
        assertNoSideEffect: () => {
          expect(
            harness.invocations.some((call) => call.channel === "copyPaste:analyzeStart"),
          ).toBe(false);
        },
      },
      {
        command: "newFolder",
        assertNoSideEffect: () => {
          expect(screen.queryByRole("dialog", { name: "New Folder" })).not.toBeInTheDocument();
        },
      },
      {
        command: "trashSelection",
        assertNoSideEffect: () => {
          expect(harness.invocations.some((call) => call.channel === "writeOperation:trash")).toBe(
            false,
          );
        },
      },
    ];

    for (const { command, assertNoSideEffect } of commands) {
      await act(async () => {
        harness.emitCommand({ type: command });
      });
      assertNoSideEffect();
    }
  });

  it("keeps global tree-focus shortcuts working", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "f", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(screen.getByPlaceholderText("Search")).toBe(document.activeElement);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });
    expect(await screen.findByLabelText("Path")).toBeInTheDocument();
  });

  it("remembers the folders that are opened and offers them in the Go To box", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      visitedFolders: [{ path: "/Users/demo/Old", visits: [{ at: 1, kind: "stay" }] }],
    });
    const visits = () =>
      harness.invocations
        .filter((call) => call.channel === "places:recordVisit")
        .map((call) => call.payload as IpcRequestInput<"places:recordVisit">);

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");

    // ⌘K opens the box with the folders opened before.
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    await screen.findByTitle("place:/Users/demo/Old");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Path"), { target: { value: "/Users/demo/Folder" } });
      fireEvent.click(screen.getByText("Open Folder"));
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
    // Going there through the box counted at once, as the strongest kind of visit.
    expect(visits()).toContainEqual({ path: "/Users/demo/Folder", kind: "goTo" });
    const visitsAfterGoing = visits().length;

    // Back does not count, and neither does the folder shown at launch.
    await act(async () => {
      fireEvent.keyDown(window, { key: "[", metaKey: true });
    });
    await vi.waitFor(() => {
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
    });
    expect(visits()).toHaveLength(visitsAfterGoing);

    // ⇧⌘G opens the same box; the folder just visited is now offered, the one on screen
    // is not, and a folder can be taken off the list.
    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });
    await screen.findByTitle("place:/Users/demo/Folder");
    expect(screen.queryByTitle("place:/Users/demo")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByTitle("forget:/Users/demo/Old"));
    });
    expect(screen.queryByTitle("place:/Users/demo/Old")).toBeNull();
    expect(
      harness.invocations.some(
        (call) =>
          call.channel === "places:forget" &&
          (call.payload as IpcRequestInput<"places:forget">).path === "/Users/demo/Old",
      ),
    ).toBe(true);
  });

  it("drops a remembered folder that can no longer be opened", async () => {
    const harness = createAppHarness({
      visitedFolders: [{ path: "/Users/demo/Gone", visits: [{ at: 1, kind: "stay" }] }],
      itemPropertiesByPath: { "/Users/demo/Gone": "missing" },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    await screen.findByTestId("content-pane");
    await act(async () => {
      fireEvent.keyDown(window, { key: "k", metaKey: true });
    });
    await act(async () => {
      fireEvent.click(await screen.findByTitle("place:/Users/demo/Gone"));
    });

    await vi.waitFor(() => {
      expect(screen.queryByTitle("place:/Users/demo/Gone")).toBeNull();
    });
    // The box stays open, on the folder that was on screen.
    expect(screen.getByLabelText("Path")).toBeInTheDocument();
    expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo");
  });

  it("expands ~ when submitting Go to Folder", async () => {
    const harness = createAppHarness({
      directorySnapshots: {
        "/Users/demo/Folder": {
          path: "/Users/demo/Folder",
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

    await act(async () => {
      fireEvent.keyDown(window, { key: "g", metaKey: true, shiftKey: true });
    });

    const input = await screen.findByLabelText("Path");
    await act(async () => {
      fireEvent.change(input, { target: { value: "~/Folder" } });
      fireEvent.click(screen.getByText("Open Folder"));
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId("content-current-path")).toHaveTextContent("/Users/demo/Folder");
    });
  });

  it("allows Cmd+Option+T in tree focus for the selected tree folder", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyT", metaKey: true, altKey: true });
    });

    expect(
      harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
    ).toEqual({ path: "/Users/demo" });
  });

  it("allows Cmd+Option+T and Cmd+Option+C for favorites in the separate favorites pane", async () => {
    const harness = createAppHarness({
      preferences: {
        favoritesPlacement: "separate",
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Documents", "directory"),
          createTreeChild("/Users/demo/Folder", "directory"),
        ],
      },
      directorySnapshots: {
        "/Users/demo/Documents": {
          path: "/Users/demo/Documents",
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

    const favoriteButton = await screen.findByTitle("favorite:/Users/demo/Documents");
    await act(async () => {
      fireEvent.click(favoriteButton);
    });

    await act(async () => {
      fireEvent.keyDown(window, { code: "KeyT", metaKey: true, altKey: true });
      fireEvent.keyDown(window, { code: "KeyC", metaKey: true, altKey: true });
    });

    expect(screen.getByTestId("left-pane-subview")).toHaveTextContent("favorites");
    expect(
      harness.invocations.find((call) => call.channel === "system:openInTerminal")?.payload,
    ).toEqual({ path: "/Users/demo/Documents" });
    expect(
      harness.invocations.findLast((call) => call.channel === "system:copyText")?.payload,
    ).toEqual({ text: "/Users/demo/Documents" });
  });

  it("moves to the file list on a key given to Focus File List", async () => {
    // Tab is the way between the panes; the focus commands have no key until one is given.
    const harness = createAppHarness({
      preferences: { shortcutOverrides: { focusContentPane: ["Cmd+Option+2"] } },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    await act(async () => {
      fireEvent.keyDown(window, { key: "2", code: "Digit2", metaKey: true, altKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "a", metaKey: true });
    });

    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
  });

  it("switches from tree to content with Tab through the raw shortcut registry", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/source.txt");
    await focusTreePane();
    const activeElement = document.activeElement;
    expect(activeElement).not.toBeNull();
    if (!activeElement) {
      throw new Error("Missing active element for pane tab switch.");
    }

    await act(async () => {
      fireEvent.keyDown(activeElement, { key: "Tab" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "a", metaKey: true });
    });

    expect(screen.getByTitle("/Users/demo/source.txt")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTitle("/Users/demo/Folder")).toHaveAttribute("data-selected", "true");
  });

  it("starts non-conflicting cut/paste without a confirmation dialog", async () => {
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
    await openDirectory("/Users/demo/Folder");

    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });
    expect(screen.queryByRole("dialog", { name: "Confirm Cut/Paste" })).not.toBeInTheDocument();
  });

  it("reloads the visible source tree branch after a folder move completes", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "cut",
        sourcePaths: ["/Users/demo/Source Folder"],
        destinationDirectoryPath: "/Users/demo/Target",
        items: [
          {
            sourcePath: "/Users/demo/Source Folder",
            destinationPath: "/Users/demo/Target/Source Folder",
            kind: "directory",
            status: "ready",
            sizeBytes: 0,
          },
          {
            sourcePath: "/Users/demo/Source Folder/nested.txt",
            destinationPath: "/Users/demo/Target/Source Folder/nested.txt",
            kind: "file",
            status: "ready",
            sizeBytes: 5,
          },
        ],
        issues: [],
        warnings: [{ code: "cut_requires_delete", message: "Cut will remove the source item." }],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 2,
          totalBytes: 5,
        },
      },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: [
            createDirectoryEntry("/Users/demo/Source Folder", "directory"),
            createDirectoryEntry("/Users/demo/Target", "directory"),
          ],
        },
        "/Users/demo/Target": {
          path: "/Users/demo/Target",
          parentPath: "/Users/demo",
          entries: [],
        },
      },
      treeChildrenByPath: {
        "/Users/demo": [
          createTreeChild("/Users/demo/Source Folder", "directory"),
          createTreeChild("/Users/demo/Target", "directory"),
        ],
        "/Users/demo/Target": [],
      },
    });

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await selectItem("/Users/demo/Source Folder");
    await act(async () => {
      fireEvent.keyDown(window, { key: "x", metaKey: true });
    });
    await openDirectory("/Users/demo/Target");
    await act(async () => {
      fireEvent.keyDown(window, { key: "v", metaKey: true });
    });

    await vi.waitFor(() => {
      expect(harness.invocations.map((call) => call.channel)).toContain("copyPaste:start");
    });

    const sourceParentReloadCountBeforeCompletion = harness.invocations.filter(
      (call) =>
        call.channel === "tree:getChildren" &&
        (call.payload as IpcRequestInput<"tree:getChildren">).path === "/Users/demo",
    ).length;

    await act(async () => {
      harness.emitProgress({
        operationId: "copy-op-1",
        mode: "cut",
        status: "completed",
        completedItemCount: 2,
        totalItemCount: 2,
        completedByteCount: 5,
        totalBytes: 5,
        currentSourcePath: "/Users/demo/Source Folder",
        currentDestinationPath: "/Users/demo/Target/Source Folder",
        result: {
          operationId: "copy-op-1",
          mode: "cut",
          status: "completed",
          destinationDirectoryPath: "/Users/demo/Target",
          startedAt: "2026-03-11T10:00:00.000Z",
          finishedAt: "2026-03-11T10:00:01.000Z",
          summary: {
            topLevelItemCount: 1,
            totalItemCount: 2,
            completedItemCount: 2,
            failedItemCount: 0,
            skippedItemCount: 0,
            cancelledItemCount: 0,
            completedByteCount: 5,
            totalBytes: 5,
          },
          items: [
            {
              sourcePath: "/Users/demo/Source Folder",
              destinationPath: "/Users/demo/Target/Source Folder",
              status: "completed",
              error: null,
            },
            {
              sourcePath: "/Users/demo/Source Folder/nested.txt",
              destinationPath: "/Users/demo/Target/Source Folder/nested.txt",
              status: "completed",
              error: null,
            },
          ],
          error: null,
        },
      });
    });

    await vi.waitFor(() => {
      const sourceParentReloadCountAfterCompletion = harness.invocations.filter(
        (call) =>
          call.channel === "tree:getChildren" &&
          (call.payload as IpcRequestInput<"tree:getChildren">).path === "/Users/demo",
      ).length;
      expect(sourceParentReloadCountAfterCompletion).toBeGreaterThan(
        sourceParentReloadCountBeforeCompletion,
      );
    });
  });

  it("shows a modal dialog for non-recoverable planning issues", async () => {
    const harness = createAppHarness({
      planResponse: {
        mode: "copy",
        sourcePaths: ["/Users/demo/source.txt"],
        destinationDirectoryPath: "/Users/demo/Folder",
        items: [],
        issues: [
          {
            code: "same_path",
            message: "Cannot paste an item onto itself.",
            sourcePath: "/Users/demo/source.txt",
            destinationPath: "/Users/demo/Folder/source.txt",
          },
        ],
        warnings: [],
        summary: {
          topLevelItemCount: 1,
          totalItemCount: 0,
          totalBytes: 0,
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
    expect(screen.getByText("“source.txt” is already in “Folder”.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Paste Requires Review" })).not.toBeInTheDocument();
  });

  it("does nothing on Paste with an empty clipboard, as the greyed-out command says", async () => {
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

    expect(screen.queryByTestId("toast-viewport")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Paste/ })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(activeElementBeforePasteWarning);
  });

  it("keeps search options for the session without saving them over the Settings defaults", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:updatePreferences")).toBe(
        true,
      );
    });
    const optionsButton = screen.getAllByRole("button", { name: "Search options" })[0];
    if (!optionsButton) {
      throw new Error("Search options button not found.");
    }
    const subfoldersItem = () =>
      screen.getByRole("menuitemcheckbox", { name: "Search Subfolders" });

    fireEvent.click(optionsButton, { detail: 1 });
    const before = subfoldersItem().getAttribute("aria-checked");
    fireEvent.click(subfoldersItem());
    // Reopening the menu later in the same run shows what was chosen.
    fireEvent.click(optionsButton, { detail: 1 });
    expect(subfoldersItem().getAttribute("aria-checked")).toBe(
      before === "true" ? "false" : "true",
    );
    fireEvent.keyDown(window, { key: "Escape" });

    // Another preference change forces a save; the search options are not part of any save.
    await act(async () => {
      fireEvent.keyDown(window, { key: "i", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(
        harness.invocations.some(
          (call) =>
            call.channel === "app:updatePreferences" &&
            (call.payload as IpcRequestInput<"app:updatePreferences">).preferences.detailRowOpen !==
              undefined,
        ),
      ).toBe(true);
    });
    for (const call of harness.invocations.filter(
      (entry) => entry.channel === "app:updatePreferences",
    )) {
      const saved = (call.payload as IpcRequestInput<"app:updatePreferences">).preferences;
      for (const key of [
        "searchPatternMode",
        "searchMatchScope",
        "searchRecursive",
        "searchSkipGitFolders",
        "searchSkipGitIgnored",
      ] as const) {
        expect(saved[key]).toBeUndefined();
      }
    }
  });

  it("searches hidden files exactly when the file list shows them, and again when that changes", async () => {
    const harness = createAppHarness();
    // The folder reload that follows ⇧⌘. arrives after the search has restarted, as it
    // does in the app (a real listing is slower than starting a search).
    let delaySnapshots = false;
    const client: FiletrailClient = {
      ...harness.client,
      invoke: (async (channel: IpcChannel, payload: unknown) => {
        if (delaySnapshots && channel === "directory:getSnapshot") {
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return harness.client.invoke(channel as never, payload as never);
      }) as FiletrailClient["invoke"],
    };

    render(
      <FiletrailClientProvider value={client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    const searchInput = screen.getAllByPlaceholderText("Search")[0];
    if (!searchInput) {
      throw new Error("Search field not found.");
    }
    const searchStarts = () =>
      harness.invocations
        .filter((call) => call.channel === "search:start")
        .map((call) => (call.payload as IpcRequestInput<"search:start">).includeHidden);
    const snapshotCount = () =>
      harness.invocations.filter((call) => call.channel === "directory:getSnapshot").length;

    await act(async () => {
      fireEvent.focus(searchInput);
      fireEvent.change(searchInput, { target: { value: "source" } });
      fireEvent.submit(searchInput);
    });
    await vi.waitFor(() => {
      expect(searchStarts()).toEqual([false]);
    });
    await screen.findByTestId("search-results-pane");

    // ⇧⌘. shows hidden files in the list; the results on screen are searched again with them.
    const snapshotsBefore = snapshotCount();
    delaySnapshots = true;
    await act(async () => {
      fireEvent.keyDown(window, { key: ".", metaKey: true, shiftKey: true });
    });
    await vi.waitFor(() => {
      expect(searchStarts()).toEqual([false, true]);
    });
    // The folder reloads underneath, but the results stay on screen.
    await vi.waitFor(() => {
      expect(snapshotCount()).toBeGreaterThan(snapshotsBefore);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId("search-results-pane")).toBeInTheDocument();
  });

  it("debounces preference persists so a burst of changes writes one latest snapshot", async () => {
    const harness = createAppHarness();

    render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );

    await screen.findByTestId("content-pane");
    // Let the initial post-hydration persist settle before counting writes.
    await vi.waitFor(() => {
      expect(harness.invocations.some((call) => call.channel === "app:updatePreferences")).toBe(
        true,
      );
    });
    const baselinePersistCount = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    ).length;

    vi.useFakeTimers();
    for (let press = 0; press < 3; press += 1) {
      await act(async () => {
        fireEvent.keyDown(window, { key: "i", metaKey: true, shiftKey: true });
      });
    }

    // No write is issued while the debounce window is still open.
    expect(
      harness.invocations.filter((call) => call.channel === "app:updatePreferences").length,
    ).toBe(baselinePersistCount);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    const persistCalls = harness.invocations.filter(
      (call) => call.channel === "app:updatePreferences",
    );
    expect(persistCalls.length).toBe(baselinePersistCount + 1);
    // Three toggles collapse into a single write carrying the final value.
    expect(
      (persistCalls.at(-1)?.payload as IpcRequestInput<"app:updatePreferences">).preferences
        .detailRowOpen,
    ).toBe(true);
  });
});
