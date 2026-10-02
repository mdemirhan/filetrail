// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

import {
  type ClipboardMarks,
  ClipboardMarksProvider,
  clipboardMarkClassName,
} from "../lib/clipboardMarks";
import { ContentPane } from "./ContentPane";
import { IconGridView } from "./IconGridView";
import { SearchResultsPane } from "./SearchResultsPane";

type Entry = ComponentProps<typeof ContentPane>["entries"][number];

function file(name: string): Entry {
  return {
    path: `/Users/demo/${name}`,
    name,
    extension: name.split(".").at(-1) ?? "",
    kind: "file",
    isHidden: false,
    isSymlink: false,
  };
}

const ENTRIES = [file("alpha.txt"), file("beta.txt")];

function marksOf(overrides: Partial<ClipboardMarks> = {}): ClipboardMarks {
  return {
    paths: new Set(["/Users/demo/alpha.txt"]),
    mode: "copy",
    flashing: false,
    ...overrides,
  };
}

// The file list's marks; the tree's are switched on and off on their own.
function withContentMarks(marks: ClipboardMarks | null, children: ReactNode) {
  return (
    <ClipboardMarksProvider value={{ tree: null, content: marks }}>
      {children}
    </ClipboardMarksProvider>
  );
}

function contentPane(viewMode: "list" | "details") {
  return (
    <ContentPane
      isFocused
      currentPath="/Users/demo"
      entries={ENTRIES}
      viewMode={viewMode}
      loading={false}
      error={null}
      includeHidden={false}
      selectedPaths={[]}
      selectionLeadPath={null}
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
    />
  );
}

function iconGrid() {
  return (
    <IconGridView
      entries={ENTRIES}
      isFocused
      selectedPaths={[]}
      selectionLeadPath={null}
      viewportWidth={500}
      viewportHeight={400}
      onSelectionGesture={() => undefined}
      onClearSelection={() => undefined}
      onActivateEntry={() => undefined}
      onLayoutColumnsChange={() => undefined}
      onVisiblePathsChange={() => undefined}
      inlineRename={null}
      onInlineRenameSubmit={() => undefined}
      onInlineRenameCancel={() => undefined}
    />
  );
}

function searchResults() {
  return (
    <SearchResultsPane
      isFocused
      rootPath="/Users/demo"
      query="txt"
      status="complete"
      results={ENTRIES.map((entry) => ({
        ...entry,
        parentPath: "/Users/demo",
        relativeParentPath: "",
      }))}
      totalCount={ENTRIES.length}
      error={null}
      truncated={false}
      sortBy="path"
      sortDirection="asc"
      onSortColumn={() => undefined}
      onStopSearch={() => undefined}
      onClearResults={() => undefined}
      onCloseResults={() => undefined}
      onSelectPath={() => undefined}
      onActivateResult={() => undefined}
      onFocusChange={() => undefined}
    />
  );
}

function rowOf(name: string): HTMLElement {
  const row = document.querySelector(`[data-selectable-entry-path="/Users/demo/${name}"]`);
  if (!(row instanceof HTMLElement)) {
    throw new Error(`Missing the row of ${name}`);
  }
  return row;
}

describe("clipboardMarkClassName", () => {
  it("marks only the items on the clipboard", () => {
    expect(clipboardMarkClassName(null, "/Users/demo/alpha.txt")).toBe("");
    expect(clipboardMarkClassName(marksOf(), null)).toBe("");
    expect(clipboardMarkClassName(marksOf(), "/Users/demo/beta.txt")).toBe("");
    expect(clipboardMarkClassName(marksOf(), "/Users/demo/alpha.txt")).toBe(" clipboard-marked");
    expect(
      clipboardMarkClassName(marksOf({ mode: "cut", flashing: true }), "/Users/demo/alpha.txt"),
    ).toBe(" clipboard-marked clipboard-cut clipboard-flash");
  });
});

describe("clipboard marks in the file list", () => {
  it.each([
    ["list", () => contentPane("list")],
    ["details", () => contentPane("details")],
    ["search results", searchResults],
  ])(
    "puts the copy icon after the copied item's name in %s view, and on no other",
    (_view, pane) => {
      render(withContentMarks(marksOf(), pane()));

      expect(rowOf("alpha.txt")).toHaveClass("clipboard-marked");
      expect(rowOf("alpha.txt")).not.toHaveClass("clipboard-cut", "clipboard-flash");
      const icon = rowOf("alpha.txt").querySelector(".clipboard-mark-icon");
      expect(icon).toHaveAttribute("data-clipboard-mode", "copy");
      // No word, and the name comes right before it.
      expect(icon).toHaveTextContent("");
      expect(icon?.previousElementSibling).toHaveTextContent("alpha.txt");
      expect(rowOf("beta.txt")).not.toHaveClass("clipboard-marked");
      expect(rowOf("beta.txt").querySelector(".clipboard-mark-icon")).toBeNull();
    },
  );

  it("shows the cut icon on a cut item, and flashes it at the moment it is cut", () => {
    render(withContentMarks(marksOf({ mode: "cut", flashing: true }), contentPane("details")));

    expect(rowOf("alpha.txt")).toHaveClass("clipboard-marked", "clipboard-cut", "clipboard-flash");
    expect(rowOf("alpha.txt").querySelector(".clipboard-mark-icon")).toHaveAttribute(
      "data-clipboard-mode",
      "cut",
    );
  });

  it("puts the icon on the picture as a badge in icon view", () => {
    render(withContentMarks(marksOf(), iconGrid()));

    expect(rowOf("alpha.txt")).toHaveClass("clipboard-marked");
    expect(
      rowOf("alpha.txt").querySelector(".icon-item-image .clipboard-mark-badge"),
    ).not.toBeNull();
    // The name the item is read by stays its own.
    expect(screen.getByRole("option", { name: "alpha.txt" })).toBe(rowOf("alpha.txt"));
    expect(rowOf("beta.txt").querySelector(".clipboard-mark-badge")).toBeNull();
  });

  it.each([
    ["list", () => contentPane("list")],
    ["details", () => contentPane("details")],
    ["icon", iconGrid],
    ["search results", searchResults],
  ])("marks nothing in %s view when the file list's highlight is switched off", (_view, pane) => {
    render(withContentMarks(null, pane()));

    expect(document.querySelector(".clipboard-marked")).toBeNull();
    expect(document.querySelector(".clipboard-mark-icon, .clipboard-mark-badge")).toBeNull();
  });
});
