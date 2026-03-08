// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SearchResultsPane } from "./SearchResultsPane";

describe("SearchResultsPane", () => {
  it("renders empty-state copy after a completed search with no matches", () => {
    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="*.tsx"
        status="complete"
        results={[]}
        selectedPath=""
        error={null}
        truncated={false}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectPath={() => undefined}
        onActivateResult={() => undefined}
        onFocusChange={() => undefined}
      />,
    );

    expect(screen.getByText("No matching files")).toBeInTheDocument();
  });

  it("calls selection and activation handlers for result rows", () => {
    const handleSelect = vi.fn();
    const handleActivate = vi.fn();

    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="*.tsx"
        status="complete"
        results={[
          {
            path: "/Users/demo/project/src/App.tsx",
            name: "App.tsx",
            extension: "tsx",
            kind: "file",
            isHidden: false,
            isSymlink: false,
            parentPath: "/Users/demo/project/src",
            relativeParentPath: "src",
          },
        ]}
        selectedPath=""
        error={null}
        truncated={false}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectPath={handleSelect}
        onActivateResult={handleActivate}
        onFocusChange={() => undefined}
      />,
    );

    const row = screen.getByRole("button", { name: /App\.tsx/i });
    fireEvent.click(row);
    fireEvent.doubleClick(row);

    expect(handleSelect).toHaveBeenCalledWith("/Users/demo/project/src/App.tsx");
    expect(handleActivate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/Users/demo/project/src/App.tsx" }),
    );
  });

  it("shows a stop action while a search is running", () => {
    const handleStop = vi.fn();

    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="app"
        status="running"
        results={[]}
        selectedPath=""
        error={null}
        truncated={false}
        onStopSearch={handleStop}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectPath={() => undefined}
        onActivateResult={() => undefined}
        onFocusChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(handleStop).toHaveBeenCalledTimes(1);
  });

  it("forwards modifier selection and background context-menu events", () => {
    const handleSelectionGesture = vi.fn();
    const handleClearSelection = vi.fn();
    const handleContextMenu = vi.fn();

    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="*.tsx"
        status="complete"
        results={[
          {
            path: "/Users/demo/project/src/App.tsx",
            name: "App.tsx",
            extension: "tsx",
            kind: "file",
            isHidden: false,
            isSymlink: false,
            parentPath: "/Users/demo/project/src",
            relativeParentPath: "src",
          },
          {
            path: "/Users/demo/project/src/main.tsx",
            name: "main.tsx",
            extension: "tsx",
            kind: "file",
            isHidden: false,
            isSymlink: false,
            parentPath: "/Users/demo/project/src",
            relativeParentPath: "src",
          },
        ]}
        selectedPaths={[]}
        selectionLeadPath={null}
        error={null}
        truncated={false}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectionGesture={handleSelectionGesture}
        onClearSelection={handleClearSelection}
        onActivateResult={() => undefined}
        onItemContextMenu={handleContextMenu}
        onFocusChange={() => undefined}
      />,
    );

    const row = screen.getByRole("button", { name: /main\.tsx/i });
    const scroll = row.closest(".search-results-scroll");
    expect(scroll).not.toBeNull();
    if (!scroll) {
      throw new Error("Missing search results scroll container.");
    }

    fireEvent.click(row, { metaKey: true });
    fireEvent.mouseDown(scroll);
    fireEvent.contextMenu(scroll, { clientX: 24, clientY: 36 });

    expect(handleSelectionGesture).toHaveBeenCalledWith("/Users/demo/project/src/main.tsx", {
      metaKey: true,
      shiftKey: false,
    });
    expect(handleClearSelection).toHaveBeenCalledTimes(2);
    expect(handleContextMenu).toHaveBeenCalledWith(null, { x: 24, y: 36 });
  });
});
