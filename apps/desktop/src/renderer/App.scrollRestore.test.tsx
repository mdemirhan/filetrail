// @vitest-environment jsdom

// Back puts the list back where it was scrolled, with the real list views: each brings the
// selection into view as it is drawn, and the window then scrolls it back.

import { act, fireEvent, render, waitFor } from "@testing-library/react";

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
import { createAppHarness, createDirectoryEntry, expectNoRefusedRequests } from "./test/appHarness";

afterEach(expectNoRefusedRequests);

const itemPath = (index: number) => `/Users/demo/item-${String(index).padStart(3, "0")}.txt`;

describe("App scroll position on Back", () => {
  let restoreSize: () => void;
  beforeEach(() => {
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    // Room to scroll across the list's columns.
    const scrollWidth = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(100_000);
    restoreSize = () => {
      height.mockRestore();
      width.mockRestore();
      scrollWidth.mockRestore();
    };
  });
  afterEach(() => restoreSize());

  // List view brought the selection into view after the window had scrolled back.
  it.each([
    ["details", "scrollTop"],
    ["list", "scrollLeft"],
    ["icons", "scrollTop"],
  ] as const)("puts back where the %s view was scrolled", async (viewMode, scroll) => {
    const harness = createAppHarness({
      preferences: { viewMode },
      directorySnapshots: {
        "/Users/demo": {
          path: "/Users/demo",
          parentPath: "/Users",
          entries: Array.from({ length: 300 }, (_, index) =>
            createDirectoryEntry(itemPath(index), "file"),
          ),
        },
        "/Users": {
          path: "/Users",
          parentPath: "/",
          entries: [createDirectoryEntry("/Users/demo", "directory")],
        },
      },
    });
    const { container } = render(
      <FiletrailClientProvider value={harness.client}>
        <App />
      </FiletrailClientProvider>,
    );
    const item = (path: string) =>
      container.querySelector<HTMLElement>(`[data-selectable-entry-path="${path}"]`);
    const scroller = () => {
      const element = container.querySelector<HTMLElement>(".content-scroll");
      if (!element) {
        throw new Error("Missing the list's scroll area.");
      }
      return element;
    };
    await waitFor(() => expect(item(itemPath(1))).not.toBeNull());
    await act(async () => {
      fireEvent.pointerDown(item(itemPath(1)) as HTMLElement, { button: 0 });
    });
    expect(item(itemPath(1))).toHaveAttribute("aria-selected", "true");
    // Scrolled away from the selected item.
    await act(async () => {
      scroller()[scroll] = 3_000;
      fireEvent.scroll(scroller());
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowUp", metaKey: true });
    });
    await waitFor(() => expect(item("/Users/demo")).not.toBeNull());
    await act(async () => {
      fireEvent.keyDown(window, { key: "[", metaKey: true });
    });
    await waitFor(() => expect(item(itemPath(1))).not.toBeNull());

    expect(item(itemPath(1))).toHaveAttribute("aria-selected", "true");
    expect(scroller()[scroll]).toBe(3_000);
  });
});
