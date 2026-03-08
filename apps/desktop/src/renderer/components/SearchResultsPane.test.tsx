// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SearchResultsPane } from "./SearchResultsPane";

describe("SearchResultsPane", () => {
  const defaultSortProps = {
    sortBy: "path" as const,
    sortDirection: "asc" as const,
    onSortByChange: () => undefined,
    onSortDirectionToggle: () => undefined,
    onApplySort: () => undefined,
  };
  const defaultFilterProps = {
    filterQuery: "",
    filterScope: "name" as const,
    totalCount: 0,
    onFilterQueryChange: () => undefined,
    onFilterScopeChange: () => undefined,
  };

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
        {...defaultFilterProps}
        {...defaultSortProps}
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
        {...defaultFilterProps}
        {...defaultSortProps}
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
        {...defaultFilterProps}
        {...defaultSortProps}
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
        {...defaultFilterProps}
        {...defaultSortProps}
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

  it("forwards typeahead keys from search results through the shared content handler", () => {
    const handleTypeaheadInput = vi.fn();

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
        {...defaultFilterProps}
        {...defaultSortProps}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectPath={() => undefined}
        onActivateResult={() => undefined}
        onFocusChange={() => undefined}
        onTypeaheadInput={handleTypeaheadInput}
        typeaheadQuery=""
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: /App\.tsx/i }), { key: "a" });

    expect(handleTypeaheadInput).toHaveBeenCalledWith("a");
  });

  it("forwards manual sort controls and restores scroll position", () => {
    const handleSortByChange = vi.fn();
    const handleSortDirectionToggle = vi.fn();
    const handleApplySort = vi.fn();
    const handleScrollTopChange = vi.fn();
    const handleFilterQueryChange = vi.fn();
    const handleFilterScopeChange = vi.fn();

    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="app"
        status="running"
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
        selectedPaths={[]}
        selectionLeadPath={null}
        error={null}
        truncated={false}
        filterQuery="App"
        filterScope="name"
        totalCount={4}
        sortBy="path"
        sortDirection="asc"
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onFilterQueryChange={handleFilterQueryChange}
        onFilterScopeChange={handleFilterScopeChange}
        onSortByChange={handleSortByChange}
        onSortDirectionToggle={handleSortDirectionToggle}
        onApplySort={handleApplySort}
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
        onActivateResult={() => undefined}
        onItemContextMenu={() => undefined}
        onFocusChange={() => undefined}
        scrollTop={42}
        onScrollTopChange={handleScrollTopChange}
      />,
    );

    const sortSelect = screen.getByLabelText("Sort search results by");
    const filterInput = screen.getByLabelText("Filter search results");
    const filterScopeSelect = screen.getByLabelText("Filter search results by");
    const directionButton = screen.getByRole("button", { name: "Ascending sort" });
    const applySortButton = screen.getByRole("button", {
      name: "Apply the selected sort to the current search results",
    });
    const scroll = document.querySelector(".search-results-scroll");

    expect(scroll).toHaveProperty("scrollTop", 42);

    fireEvent.change(sortSelect, { target: { value: "name" } });
    fireEvent.change(filterInput, { target: { value: "main" } });
    fireEvent.change(filterScopeSelect, { target: { value: "path" } });
    fireEvent.click(directionButton);
    fireEvent.click(applySortButton);
    if (!scroll) {
      throw new Error("Missing search results scroll container.");
    }
    fireEvent.scroll(scroll, { target: { scrollTop: 96 } });

    expect(handleSortByChange).toHaveBeenCalledWith("name");
    expect(handleFilterQueryChange).toHaveBeenCalledWith("main");
    expect(handleFilterScopeChange).toHaveBeenCalledWith("path");
    expect(handleSortDirectionToggle).toHaveBeenCalledTimes(1);
    expect(handleApplySort).toHaveBeenCalledTimes(1);
    expect(handleScrollTopChange).toHaveBeenCalledWith(96);
    expect(applySortButton).toHaveAttribute(
      "title",
      "Apply the selected sort to the current search results (Cmd+R)",
    );
    expect(screen.getByRole("button", { name: "Close search results" })).toHaveAttribute(
      "title",
      "Close search results",
    );
    expect(screen.getByRole("button", { name: "Clear search results" })).toHaveAttribute(
      "title",
      "Clear search results",
    );
  });

  it("scrolls the selected lead result into view", () => {
    const handleScrollTopChange = vi.fn();
    const results = Array.from({ length: 5 }, (_, index) => ({
      path: `/Users/demo/project/src/item-${index}.tsx`,
      name: `item-${index}.tsx`,
      extension: "tsx",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
      parentPath: "/Users/demo/project/src",
      relativeParentPath: "src",
    }));

    const { rerender } = render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="app"
        status="complete"
        results={results}
        selectedPaths={[]}
        selectionLeadPath={null}
        error={null}
        truncated={false}
        {...defaultFilterProps}
        {...defaultSortProps}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
        onActivateResult={() => undefined}
        onItemContextMenu={() => undefined}
        onFocusChange={() => undefined}
        scrollTop={0}
        onScrollTopChange={handleScrollTopChange}
      />,
    );

    const scroll = document.querySelector(".search-results-scroll");
    if (!(scroll instanceof HTMLDivElement)) {
      throw new Error("Missing search results scroll container.");
    }
    Object.defineProperty(scroll, "clientHeight", {
      value: 104,
      configurable: true,
    });

    rerender(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="app"
        status="complete"
        results={results}
        selectedPaths={["/Users/demo/project/src/item-3.tsx"]}
        selectionLeadPath="/Users/demo/project/src/item-3.tsx"
        error={null}
        truncated={false}
        {...defaultFilterProps}
        {...defaultSortProps}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
        onActivateResult={() => undefined}
        onItemContextMenu={() => undefined}
        onFocusChange={() => undefined}
        scrollTop={0}
        onScrollTopChange={handleScrollTopChange}
      />,
    );

    expect(scroll.scrollTop).toBe(120);
    expect(handleScrollTopChange).toHaveBeenCalledWith(120);
  });

  it("returns focus to search results when escape is pressed in the filter input", () => {
    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="app"
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
        selectedPaths={[]}
        selectionLeadPath={null}
        error={null}
        truncated={false}
        filterQuery="app"
        filterScope="name"
        totalCount={1}
        {...defaultSortProps}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onFilterQueryChange={() => undefined}
        onFilterScopeChange={() => undefined}
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
        onActivateResult={() => undefined}
        onItemContextMenu={() => undefined}
        onFocusChange={() => undefined}
      />,
    );

    const filterInput = screen.getByLabelText("Filter search results");
    const scroll = document.querySelector(".search-results-scroll");
    if (!(scroll instanceof HTMLDivElement)) {
      throw new Error("Missing search results scroll container.");
    }

    filterInput.focus();
    fireEvent.keyDown(filterInput, { key: "Escape" });

    expect(document.activeElement).toBe(scroll);
  });
});
