// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SearchResultsPane, buildHighlightPattern } from "./SearchResultsPane";

describe("SearchResultsPane", () => {
  const defaultSortProps = {
    sortBy: "path" as const,
    sortDirection: "asc" as const,
    onSortColumn: () => undefined,
  };
  const defaultFilterProps = {
    totalCount: 0,
  };

  it("renders empty-state copy after a completed search with no matches", () => {
    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="*.tsx"
        status="complete"
        results={[]}
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

    expect(screen.getByText("No matches")).toBeInTheDocument();
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
    fireEvent.pointerDown(row, { button: 0 });
    fireEvent.doubleClick(row);

    expect(handleSelect).toHaveBeenCalledWith("/Users/demo/project/src/App.tsx");
    expect(handleActivate).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/Users/demo/project/src/App.tsx" }),
    );
  });

  it("narrows a multi-selection to the clicked result", () => {
    const handleSelectionGesture = vi.fn();
    const results = ["App.tsx", "main.tsx"].map((name) => ({
      path: `/Users/demo/project/src/${name}`,
      name,
      extension: "tsx",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
      parentPath: "/Users/demo/project/src",
      relativeParentPath: "src",
    }));

    render(
      <SearchResultsPane
        isFocused
        rootPath="/Users/demo/project"
        query="tsx"
        status="complete"
        results={results}
        selectedPaths={results.map((result) => result.path)}
        error={null}
        truncated={false}
        {...defaultFilterProps}
        {...defaultSortProps}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSelectionGesture={handleSelectionGesture}
        onActivateResult={() => undefined}
        onFocusChange={() => undefined}
      />,
    );

    const row = screen.getByRole("button", { name: /App\.tsx/i });
    fireEvent.pointerDown(row, { button: 0 });
    expect(handleSelectionGesture).not.toHaveBeenCalled();

    fireEvent.click(row, { button: 0, detail: 1 });
    expect(handleSelectionGesture).toHaveBeenCalledWith("/Users/demo/project/src/App.tsx", {
      metaKey: false,
      shiftKey: false,
    });
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

    fireEvent.pointerDown(row, { button: 0, metaKey: true });
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
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: /App\.tsx/i }), { key: "a" });

    expect(handleTypeaheadInput).toHaveBeenCalledWith("a");
  });

  it("sorts by clicked columns, forwards scope bar changes, and restores scroll position", () => {
    const handleSortColumn = vi.fn();
    const handleScopeChange = vi.fn();
    const handlePatternModeChange = vi.fn();
    const handleMatchScopeChange = vi.fn();
    const handleRecursiveChange = vi.fn();
    const handleSkipGitFoldersChange = vi.fn();
    const handleSkipGitIgnoredChange = vi.fn();
    const handleScrollTopChange = vi.fn();

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
            relativeParentPath: "src/components",
          },
        ]}
        selectedPaths={[]}
        selectionLeadPath={null}
        error={null}
        truncated={false}
        totalCount={4}
        sortBy="path"
        sortDirection="asc"
        elapsedMs={38}
        scopeOptions={[
          { path: "/Users/demo/project", label: "“project”" },
          { path: "/Users/demo", label: "Home" },
          { path: "/", label: "Macintosh HD" },
        ]}
        onScopeChange={handleScopeChange}
        patternMode="regex"
        onPatternModeChange={handlePatternModeChange}
        matchScope="name"
        onMatchScopeChange={handleMatchScopeChange}
        recursive
        onRecursiveChange={handleRecursiveChange}
        skipGitFolders
        onSkipGitFoldersChange={handleSkipGitFoldersChange}
        skipGitIgnored={false}
        onSkipGitIgnoredChange={handleSkipGitIgnoredChange}
        onStopSearch={() => undefined}
        onClearResults={() => undefined}
        onCloseResults={() => undefined}
        onSortColumn={handleSortColumn}
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
        onActivateResult={() => undefined}
        onItemContextMenu={() => undefined}
        onFocusChange={() => undefined}
        scrollTop={42}
        onScrollTopChange={handleScrollTopChange}
      />,
    );

    const scroll = document.querySelector(".search-results-scroll");
    expect(scroll).toHaveProperty("scrollTop", 42);
    expect(screen.getByText("Date Modified")).toBeInTheDocument();
    expect(screen.getByText("src › components")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "“project”" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Sort by folder" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Sort by name" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    fireEvent.click(screen.getByRole("button", { name: "“project”" }));
    // The search options live behind one Options button, so the bar stays on one line.
    const chooseOption = (role: "menuitemradio" | "menuitemcheckbox", name: string) => {
      fireEvent.click(screen.getByRole("button", { name: "Options" }), { detail: 1 });
      fireEvent.click(screen.getByRole(role, { name }));
    };
    chooseOption("menuitemradio", "Glob");
    chooseOption("menuitemradio", "Full path");
    chooseOption("menuitemcheckbox", "Search subfolders");
    // Hidden files follow the file list, so the menu has no option for them.
    fireEvent.click(screen.getByRole("button", { name: "Options" }), { detail: 1 });
    expect(screen.queryByRole("menuitemcheckbox", { name: /hidden/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Options" }), { detail: 1 });
    expect(screen.queryByRole("menu")).toBeNull();
    if (!scroll) {
      throw new Error("Missing search results scroll container.");
    }
    fireEvent.scroll(scroll, { target: { scrollTop: 96 } });

    expect(handleSortColumn).toHaveBeenCalledWith("name");
    expect(handleScopeChange).toHaveBeenCalledTimes(1);
    expect(handleScopeChange).toHaveBeenCalledWith("/Users/demo");
    expect(handlePatternModeChange).toHaveBeenCalledWith("glob");
    expect(handleMatchScopeChange).toHaveBeenCalledWith("path");
    expect(handleRecursiveChange).toHaveBeenCalledWith(false);
    chooseOption("menuitemcheckbox", "Skip .git folders");
    chooseOption("menuitemcheckbox", "Skip files ignored by Git");
    expect(handleSkipGitFoldersChange).toHaveBeenCalledWith(false);
    expect(handleSkipGitIgnoredChange).toHaveBeenCalledWith(true);
    expect(handleScrollTopChange).toHaveBeenCalledWith(96);
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

    expect(scroll.scrollTop).toBe(8);
    expect(handleScrollTopChange).toHaveBeenCalledWith(8);
  });

  it("treats a pattern that does not parse yet as unfinished while it is being typed", () => {
    const renderPane = (errorIsQuiet: boolean) =>
      render(
        <SearchResultsPane
          isFocused
          rootPath="/Users/demo/project"
          query="no(te"
          status="error"
          results={[]}
          error="regex parse error: unclosed group"
          errorIsQuiet={errorIsQuiet}
          truncated={false}
          totalCount={0}
          {...defaultSortProps}
          onStopSearch={() => undefined}
          onClearResults={() => undefined}
          onCloseResults={() => undefined}
          onActivateResult={() => undefined}
          onFocusChange={() => undefined}
        />,
      );

    const typed = renderPane(true);
    expect(screen.getByText("Incomplete pattern")).toBeInTheDocument();
    expect(screen.queryByText("Search failed")).toBeNull();
    expect(screen.queryByText(/unclosed group/u)).toBeNull();
    typed.unmount();

    // After Return the same error is shown in full.
    renderPane(false);
    expect(screen.getByText("Search failed")).toBeInTheDocument();
    expect(screen.getByText(/unclosed group/u)).toBeInTheDocument();
    // The bar has no second text field: typing in the search field refines the search.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("highlights the matched part of names for plain regex name searches", () => {
    expect(buildHighlightPattern("app", "regex", "name")?.exec("MyApp.tsx")?.[0]).toBe("App");
    expect(buildHighlightPattern("App", "regex", "name")?.exec("MyApp.tsx")?.[0]).toBe("App");
    expect(buildHighlightPattern("App", "regex", "name")?.exec("myapp.tsx")).toBeNull();
    expect(buildHighlightPattern("*.ts", "glob", "name")).toBeNull();
    expect(buildHighlightPattern("src/app", "regex", "path")).toBeNull();
    expect(buildHighlightPattern("(", "regex", "name")).toBeNull();
    // Plain text is found as typed, with the same smart case.
    expect(buildHighlightPattern("(1).pdf", "text", "name")?.exec("report (1).pdf")?.[0]).toBe(
      "(1).pdf",
    );
    expect(buildHighlightPattern("c++", "text", "name")?.exec("My C++ notes")?.[0]).toBe("C++");
    expect(buildHighlightPattern("C++", "text", "name")?.exec("my c++ notes")).toBeNull();
    expect(buildHighlightPattern("a.c", "text", "name")?.exec("abc")).toBeNull();
  });
});
