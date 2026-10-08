// @vitest-environment jsdom

// Putting tabs in order by dragging them along the tab strip.

import type { IpcRequestInput } from "@filetrail/contracts";
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
  createAppHarness,
  expectNoRefusedRequests,
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

const tabLabels = () => screen.queryAllByRole("tab").map((tab) => tab.textContent);

// The tabs side by side, 100 px each, as the window lays them out.
function layOutTabs() {
  for (const [index, element] of screen.getAllByRole("tab").entries()) {
    element.getBoundingClientRect = () =>
      ({ left: index * 100, right: (index + 1) * 100, top: 0, bottom: 28 }) as DOMRect;
  }
}

describe("tabs dragged along the strip", () => {
  it("take the place they are dragged to, which is the order kept for next time", async () => {
    const harness = createAppHarness();
    renderApp(harness);
    await selectItem("/Users/demo/Folder");
    await act(async () => {
      harness.emitCommand({ type: "openSelectionInNewTab" });
    });
    await vi.waitFor(() => expect(tabLabels()).toEqual(["demo", "Folder"]));
    layOutTabs();

    const folderTab = screen.getAllByRole("tab")[1] as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(folderTab, { button: 0, clientX: 150, pointerId: 1 });
      fireEvent.pointerMove(folderTab, { clientX: 40, pointerId: 1 });
      fireEvent.pointerUp(folderTab, { pointerId: 1 });
    });

    expect(tabLabels()).toEqual(["Folder", "demo"]);
    // Dropped where it already is: nothing moves.
    layOutTabs();
    const demoTab = screen.getAllByRole("tab")[1] as HTMLElement;
    await act(async () => {
      fireEvent.pointerDown(demoTab, { button: 0, clientX: 150, pointerId: 2 });
      fireEvent.pointerMove(demoTab, { clientX: 160, pointerId: 2 });
      fireEvent.pointerUp(demoTab, { pointerId: 2 });
    });
    expect(tabLabels()).toEqual(["Folder", "demo"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    const savedTabs = harness.invocations
      .filter((call) => call.channel === "app:updatePreferences")
      .map((call) => (call.payload as IpcRequestInput<"app:updatePreferences">).preferences)
      .findLast((preferences) => preferences.openTabs !== undefined)?.openTabs;
    expect(savedTabs?.map((tab) => tab.path)).toEqual(["/Users/demo/Folder", "/Users/demo"]);
  });
});
