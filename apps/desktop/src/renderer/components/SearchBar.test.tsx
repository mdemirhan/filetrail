// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { SearchBar, SearchResultsState } from "./SearchBar";

describe("SearchBar", () => {
  const props = {
    isFocused: true,
    rootPath: "/Users/demo/project",
    scopeOptions: [
      { path: "/Users/demo/project", label: "“project”" },
      { path: "/Users/demo", label: "Home" },
    ],
    onScopeChange: () => undefined,
    status: "complete" as const,
    truncated: false,
    filterQuery: "",
    onFilterQueryChange: () => undefined,
    onFocusResults: () => undefined,
    onStopSearch: () => undefined,
    onCloseResults: () => undefined,
  };

  it("searches another place, and closes the results with Done", () => {
    const onScopeChange = vi.fn();
    const onCloseResults = vi.fn();
    render(<SearchBar {...props} onScopeChange={onScopeChange} onCloseResults={onCloseResults} />);
    fireEvent.click(screen.getByRole("button", { name: "“project”" }));
    expect(onScopeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onScopeChange).toHaveBeenCalledWith("/Users/demo");
    fireEvent.click(screen.getByRole("button", { name: "Close search results" }));
    expect(onCloseResults).toHaveBeenCalledTimes(1);
  });

  it("shows Stop only for a search that runs on", async () => {
    const onStopSearch = vi.fn();
    const { rerender } = render(<SearchBar {...props} onStopSearch={onStopSearch} />);
    expect(screen.queryByRole("button", { name: "Stop search" })).toBeNull();
    rerender(<SearchBar {...props} status="running" onStopSearch={onStopSearch} />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop search" }));
    expect(onStopSearch).toHaveBeenCalledTimes(1);
  });

  it("has a filter field that clears with Esc and gives the keyboard back to the results", () => {
    const onFilterQueryChange = vi.fn();
    const onFocusResults = vi.fn();
    const { rerender } = render(
      <SearchBar
        {...props}
        onFilterQueryChange={onFilterQueryChange}
        onFocusResults={onFocusResults}
      />,
    );
    const field = screen.getByLabelText("Filter results");
    fireEvent.change(field, { target: { value: "src" } });
    expect(onFilterQueryChange).toHaveBeenLastCalledWith("src");
    // With nothing to clear, Esc goes back to the results; so do Return and ↓.
    fireEvent.keyDown(field, { key: "Escape" });
    fireEvent.keyDown(field, { key: "Enter" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(onFocusResults).toHaveBeenCalledTimes(3);

    onFilterQueryChange.mockClear();
    rerender(
      <SearchBar
        {...props}
        filterQuery="zzz"
        onFilterQueryChange={onFilterQueryChange}
        onFocusResults={onFocusResults}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("Filter results"), { key: "Escape" });
    expect(onFilterQueryChange).toHaveBeenLastCalledWith("");
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(onFilterQueryChange).toHaveBeenCalledTimes(2);
    expect(onFocusResults).toHaveBeenCalledTimes(3);
  });

  it("says when only the first matches are shown", () => {
    render(<SearchBar {...props} truncated />);
    expect(screen.getByText("Showing the first 20,000 matches.")).toBeInTheDocument();
  });
});

describe("SearchResultsState", () => {
  const props = {
    status: "complete" as const,
    shownCount: 0,
    totalCount: 0,
    error: null,
    errorIsQuiet: false,
    filterQuery: "",
  };

  it("says how the search went while there is nothing to show", () => {
    const { rerender, container } = render(<SearchResultsState {...props} />);
    expect(screen.getByText("No matches")).toBeInTheDocument();
    rerender(<SearchResultsState {...props} status="running" />);
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    rerender(<SearchResultsState {...props} totalCount={3} filterQuery="zzz" />);
    expect(screen.getByText("No results match “zzz”")).toBeInTheDocument();
    rerender(<SearchResultsState {...props} shownCount={2} totalCount={3} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("treats a pattern that does not parse yet as unfinished while it is being typed", () => {
    const error = "regex parse error: unclosed group";
    const { rerender } = render(
      <SearchResultsState {...props} status="error" error={error} errorIsQuiet />,
    );
    expect(screen.getByText("Incomplete pattern")).toBeInTheDocument();
    expect(screen.queryByText(/unclosed group/u)).toBeNull();
    // After Return the same error is shown in full.
    rerender(<SearchResultsState {...props} status="error" error={error} />);
    expect(screen.getByText("Search failed")).toBeInTheDocument();
    expect(screen.getByText(/unclosed group/u)).toBeInTheDocument();
  });
});
