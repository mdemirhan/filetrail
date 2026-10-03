// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { ContentPane } from "./ContentPane";

// The list shows only the rows in view; a pane 240 px tall shows about a dozen of 300.
vi.mock("../hooks/useElementSize", () => ({
  useElementSize: () => ({ width: 900, height: 240 }),
}));

const entries = Array.from({ length: 300 }, (_, index) => {
  const name = `file${String(index).padStart(3, "0")}.txt`;
  return {
    path: `/Users/demo/${name}`,
    name,
    extension: "txt",
    kind: "file" as const,
    isHidden: false,
    isSymlink: false,
  };
});

// Each test is a rename of its own, as each rename in the app is.
let sessionId = 0;

function renderPane(
  viewMode: "details" | "list" | "icons",
  props: {
    onInlineRenameSubmit?: (name: string) => void;
    onInlineRenameCancel?: () => void;
  } = {},
) {
  sessionId += 1;
  return render(
    <ContentPane
      isFocused={false}
      currentPath="/Users/demo"
      entries={entries}
      viewMode={viewMode}
      loading={false}
      error={null}
      includeHidden={false}
      selectedPaths={["/Users/demo/file250.txt"]}
      selectionLeadPath="/Users/demo/file250.txt"
      metadataByPath={{}}
      sortBy="name"
      sortDirection="asc"
      onSelectionGesture={() => undefined}
      onClearSelection={() => undefined}
      onActivateEntry={() => undefined}
      onSortChange={() => undefined}
      onLayoutColumnsChange={() => undefined}
      onVisiblePathsChange={() => undefined}
      onNavigatePath={() => undefined}
      onRequestPathSuggestions={async () => ({ inputPath: "", basePath: null, suggestions: [] })}
      onFocusChange={() => undefined}
      inlineRename={{ path: "/Users/demo/file250.txt", error: null, sessionId }}
      onInlineRenameSubmit={props.onInlineRenameSubmit ?? (() => undefined)}
      onInlineRenameCancel={props.onInlineRenameCancel ?? (() => undefined)}
    />,
  );
}

function renameField(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Rename file250.txt" }) as HTMLInputElement;
}

describe("renaming an item whose row isn't drawn", () => {
  for (const viewMode of ["details", "icons"] as const) {
    it(`keeps the name being edited, with the keyboard, in ${viewMode} view`, () => {
      const onInlineRenameSubmit = vi.fn();
      renderPane(viewMode, { onInlineRenameSubmit });

      // The row is far below the rows drawn; its name is still being edited, not lost.
      expect(
        document.querySelector('[data-selectable-entry-path="/Users/demo/file250.txt"]'),
      ).toBeNull();
      expect(renameField()).toHaveFocus();
      expect(renameField().value).toBe("file250.txt");
      expect(renameField().selectionEnd).toBe("file250".length);

      fireEvent.change(renameField(), { target: { value: "report.txt" } });
      fireEvent.keyDown(renameField(), { key: "Enter" });
      expect(onInlineRenameSubmit).toHaveBeenCalledWith("report.txt");
    });
  }

  it("carries on with what was typed when the row is scrolled back into view", () => {
    renderPane("details");
    const hidden = renameField();
    fireEvent.change(hidden, { target: { value: "half typed.txt" } });
    hidden.setSelectionRange(4, 4);
    fireEvent.select(hidden);

    const scroller = document.querySelector<HTMLElement>(".details-scroll, .content-scroll");
    expect(scroller).not.toBeNull();
    act(() => {
      if (scroller) {
        scroller.scrollTop = 250 * 28;
        fireEvent.scroll(scroller);
      }
    });

    return vi.waitFor(() => {
      const row = document.querySelector('[data-selectable-entry-path="/Users/demo/file250.txt"]');
      expect(row).not.toBeNull();
      const field = renameField();
      expect(row?.contains(field)).toBe(true);
      expect(field.value).toBe("half typed.txt");
      expect(field.selectionStart).toBe(4);
      expect(field).toHaveFocus();
    });
  });

  it("gives up the rename on Escape, as in its row", () => {
    const onInlineRenameCancel = vi.fn();
    renderPane("details", { onInlineRenameCancel });
    fireEvent.keyDown(renameField(), { key: "Escape" });
    expect(onInlineRenameCancel).toHaveBeenCalledTimes(1);
  });
});
