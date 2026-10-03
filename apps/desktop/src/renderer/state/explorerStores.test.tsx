// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";

import { useSelectionActions } from "./explorerStores";

function setUp() {
  const contentPane = document.createElement("div");
  contentPane.tabIndex = -1;
  const row = document.createElement("button");
  document.body.append(contentPane, row);
  const setFocusedPane = vi.fn();
  const navigation = {
    activeContentEntriesRef: { current: [] },
    selectedEntryRef: { current: null },
    selectedPathsInViewOrderRef: { current: [] },
    setContentSelection: vi.fn(),
    setFocusedPane,
    setTypeaheadPane: vi.fn(),
    setTypeaheadQuery: vi.fn(),
  };
  const services = {
    contentPaneRef: { current: contentPane },
    typeaheadPaneRef: { current: null },
    typeaheadQueryRef: { current: "" },
    typeaheadTimeoutRef: { current: null },
  };
  const { result } = renderHook(() =>
    useSelectionActions({ navigation, services } as unknown as Parameters<
      typeof useSelectionActions
    >[0]),
  );
  const frames: FrameRequestCallback[] = [];
  const requestFrame = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((callback) => frames.push(callback));
  const runFrames = () => {
    while (frames.length > 0) {
      frames.shift()?.(performance.now());
    }
  };
  const runOneFrame = () => {
    const pending = frames.splice(0);
    for (const callback of pending) {
      callback(performance.now());
    }
  };
  const tearDown = () => {
    requestFrame.mockRestore();
    contentPane.remove();
    row.remove();
  };
  return { actions: result.current, contentPane, row, runFrames, runOneFrame, tearDown };
}

describe("focusContentPane", () => {
  // The keyboard put back after a dialog arrives a frame or two later. A row clicked in
  // between keeps it: taking it back made ⌘C copy the tree's folder instead of the row.
  it("gives way to a focus given meanwhile when it is only putting the keyboard back", () => {
    const { actions, row, runFrames, tearDown } = setUp();
    try {
      actions.focusContentPane({ unlessFocusMoves: true });
      row.focus();
      runFrames();

      expect(row).toHaveFocus();
    } finally {
      tearDown();
    }
  });

  it("takes the keyboard when asked for it", () => {
    const { actions, contentPane, row, runFrames, tearDown } = setUp();
    try {
      row.focus();
      actions.focusContentPane();
      runFrames();

      expect(contentPane).toHaveFocus();
    } finally {
      tearDown();
    }
  });

  // The pane is focused on one frame and again on the next. A text field focused in
  // between, such as the search results' filter, keeps its caret.
  it("leaves a text field focused between its two frames with the keyboard", () => {
    const { actions, contentPane, runOneFrame, runFrames, tearDown } = setUp();
    const field = document.createElement("input");
    document.body.append(field);
    try {
      actions.focusContentPane();
      runOneFrame();
      expect(contentPane).toHaveFocus();

      field.focus();
      runFrames();

      expect(field).toHaveFocus();
    } finally {
      field.remove();
      tearDown();
    }
  });
});

describe("applyContentSelection", () => {
  // A paste of a large folder selects what it made: many thousands of items. Looking each
  // entry up in a list of them took long enough to freeze the window.
  it("selects tens of thousands of items at once without stalling", () => {
    const { actions, tearDown } = setUp();
    try {
      const entries = Array.from({ length: 60_000 }, (_, index) => ({
        path: `/Users/demo/big/file-${index}.txt`,
        name: `file-${index}.txt`,
        extension: "txt",
        kind: "file" as const,
        isHidden: false,
        isSymlink: false,
      }));
      const paths = entries.slice(0, 50_000).map((entry) => entry.path);

      const startedAt = performance.now();
      actions.applyContentSelection(
        { paths, leadPath: paths[0] ?? null, anchorPath: paths[0] ?? null },
        entries,
      );

      expect(performance.now() - startedAt).toBeLessThan(1_000);
    } finally {
      tearDown();
    }
  });
});
