// @vitest-environment jsdom

// Selecting items in the file list with clicks and keys: ranges with ⇧, one more or one
// less with ⌘, both with ⌘⇧, and what a right-click selects.

import { act, fireEvent, screen } from "@testing-library/react";

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
  pressKey,
  renderApp,
  selectItem,
} from "./test/appHarness";

afterEach(expectNoRefusedRequests);

const NAMES = ["a", "b", "c", "d", "e", "f"];
const path = (name: string) => `/Users/demo/${name}.txt`;

async function setup() {
  const harness = createAppHarness();
  harness.setDirectoryEntries(
    "/Users/demo",
    NAMES.map((name) => createDirectoryEntry(path(name), "file")),
  );
  renderApp(harness);
  await screen.findByTitle(path("a"));
  return harness;
}

async function click(name: string, modifiers: { metaKey?: boolean; shiftKey?: boolean } = {}) {
  await act(async () => {
    fireEvent.click(screen.getByTitle(path(name)), modifiers);
  });
}

function selected(): string[] {
  return Array.from(document.querySelectorAll('[data-selected="true"]'), (element) =>
    (element.getAttribute("title") ?? "").replace(/^\/Users\/demo\/|\.txt$/gu, ""),
  );
}

describe("selecting in the file list", () => {
  it("selects a range with ⇧-click, from the item clicked first", async () => {
    await setup();
    await selectItem(path("b"));

    await click("d", { shiftKey: true });
    expect(selected()).toEqual(["b", "c", "d"]);
    // The range is from b still, now the other way.
    await click("a", { shiftKey: true });
    expect(selected()).toEqual(["a", "b"]);
  });

  it("adds and takes away one item with ⌘-click", async () => {
    await setup();
    await selectItem(path("a"));

    await click("c", { metaKey: true });
    expect(selected()).toEqual(["a", "c"]);
    await click("a", { metaKey: true });
    expect(selected()).toEqual(["c"]);
  });

  it("adds a range to what is selected with ⌘⇧-click", async () => {
    await setup();
    await selectItem(path("a"));
    await click("c", { metaKey: true });

    await click("e", { metaKey: true, shiftKey: true });

    expect(selected()).toEqual(["a", "c", "d", "e"]);
  });

  it("moves the selection with the arrow keys, and stretches it with ⇧", async () => {
    await setup();
    await selectItem(path("b"));

    await pressKey({ key: "ArrowDown" });
    expect(selected()).toEqual(["c"]);
    await pressKey({ key: "ArrowDown", shiftKey: true });
    await pressKey({ key: "ArrowDown", shiftKey: true });
    expect(selected()).toEqual(["c", "d", "e"]);
    await pressKey({ key: "ArrowUp", shiftKey: true });
    expect(selected()).toEqual(["c", "d"]);
    await pressKey({ key: "End" });
    expect(selected()).toEqual(["f"]);
    await pressKey({ key: "Home", shiftKey: true });
    expect(selected()).toEqual(NAMES);
  });

  it("selects everything with ⌘A, and nothing with a click on empty space", async () => {
    await setup();
    await selectItem(path("b"));

    await pressKey({ key: "a", metaKey: true });
    expect(selected()).toEqual(NAMES);
    await clearContentSelection();
    expect(selected()).toEqual([]);
  });

  it("keeps the selection for a right-click on one of it, and selects another item alone", async () => {
    await setup();
    await selectItem(path("a"));
    await click("b", { shiftKey: true });

    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle(path("b")));
    });
    expect(selected()).toEqual(["a", "b"]);
    await pressKey({ key: "Escape" });

    await act(async () => {
      fireEvent.contextMenu(screen.getByTitle(path("e")));
    });
    expect(selected()).toEqual(["e"]);
  });
});
