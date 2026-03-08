// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { ContentPane } from "./ContentPane";

describe("ContentPane", () => {
  it("renders the empty state for an empty directory", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    expect(screen.getByText("This folder is empty")).toBeInTheDocument();
  });

  it("surfaces directory errors inline", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error="Permission denied"
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    expect(screen.getByText("Unable to open this folder")).toBeInTheDocument();
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
  });

  it("calls sort handlers in details mode", () => {
    const handleSortChange = vi.fn();
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[
          {
            path: "/Users/demo/alpha.txt",
            name: "alpha.txt",
            extension: "txt",
            kind: "file",
            isHidden: false,
            isSymlink: false,
          },
        ]}
        viewMode="details"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={handleSortChange}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /date modified/i }));
    expect(handleSortChange).toHaveBeenCalledWith("modified");
  });

  it("navigates when a path segment is clicked", () => {
    vi.useFakeTimers();
    const handleNavigatePath = vi.fn();

    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={handleNavigatePath}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Users" }));
    act(() => {
      vi.runAllTimers();
    });

    expect(handleNavigatePath).toHaveBeenCalledWith("/Users");
    vi.useRealTimers();
  });

  it("switches the path bar into edit mode on double click and cancels on escape", async () => {
    const handleNavigatePath = vi.fn();

    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={handleNavigatePath}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("navigation", { name: "Folder path" }));
    });
    await act(async () => {});
    const input = screen.getByLabelText("Current folder path");
    expect(input).toHaveValue("/Users/demo/projects");

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(screen.queryByLabelText("Current folder path")).not.toBeInTheDocument();
    expect(handleNavigatePath).not.toHaveBeenCalled();
  });

  it("submits an edited path from the path bar", async () => {
    const handleNavigatePath = vi.fn();

    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={handleNavigatePath}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("navigation", { name: "Folder path" }));
    });
    await act(async () => {});
    const input = screen.getByLabelText("Current folder path");
    fireEvent.change(input, { target: { value: "/tmp/project" } });
    await act(async () => {});
    const form = input.closest("form");
    expect(form).not.toBeNull();
    if (!form) {
      throw new Error("Missing path bar editor form.");
    }

    act(() => {
      fireEvent.submit(form);
    });

    expect(handleNavigatePath).toHaveBeenCalledWith("/tmp/project");
  });

  it("shows live path suggestions while editing", async () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "/Users/demo/Do",
          basePath: "/Users/demo",
          suggestions: [
            { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
            { path: "/Users/demo/Downloads", name: "Downloads", isDirectory: true },
          ],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("navigation", { name: "Folder path" }));
    });
    const input = screen.getByLabelText("Current folder path");
    fireEvent.change(input, { target: { value: "/Users/demo/Do" } });

    expect(await screen.findByText("Documents")).toBeInTheDocument();
    expect(screen.getByText("/Users/demo/Documents")).toBeInTheDocument();
  });

  it("previews the highlighted suggestion in the input when using arrow keys", async () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "/Users/demo/Do",
          basePath: "/Users/demo",
          suggestions: [
            { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
            { path: "/Users/demo/Downloads", name: "Downloads", isDirectory: true },
          ],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("navigation", { name: "Folder path" }));
    });
    const input = screen.getByLabelText("Current folder path");
    fireEvent.change(input, { target: { value: "/Users/demo/Do" } });

    await screen.findByText("Documents");

    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    expect(input).toHaveValue("/Users/demo/Documents/");

    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    expect(input).toHaveValue("/Users/demo/Downloads/");
  });

  it("navigates to the previewed suggestion on enter", async () => {
    const handleNavigatePath = vi.fn();

    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={handleNavigatePath}
        onRequestPathSuggestions={async () => ({
          inputPath: "/Users/demo/Do",
          basePath: "/Users/demo",
          suggestions: [
            { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
            { path: "/Users/demo/Downloads", name: "Downloads", isDirectory: true },
          ],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("navigation", { name: "Folder path" }));
    });
    const input = screen.getByLabelText("Current folder path");
    fireEvent.change(input, { target: { value: "/Users/demo/Do" } });

    await screen.findByText("Documents");

    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    expect(input).toHaveValue("/Users/demo/Documents/");

    const form = input.closest("form");
    expect(form).not.toBeNull();
    if (!form) {
      throw new Error("Missing path bar editor form.");
    }

    act(() => {
      fireEvent.submit(form);
    });

    expect(handleNavigatePath).toHaveBeenCalledWith("/Users/demo/Documents");
  });

  it("moves Tab focus between the path input and suggestions when pane tab switching is enabled", async () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "/Users/demo/Do",
          basePath: "/Users/demo",
          suggestions: [
            { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
            { path: "/Users/demo/Downloads", name: "Downloads", isDirectory: true },
          ],
        })}
        onFocusChange={() => undefined}
        tabSwitchesExplorerPanes
        typeaheadQuery=""
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("navigation", { name: "Folder path" }));
    });
    const input = screen.getByLabelText("Current folder path");
    fireEvent.change(input, { target: { value: "/Users/demo/Do" } });

    const suggestion = await screen.findByRole("button", { name: /Documents/i });
    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
    });
    expect(suggestion).toHaveFocus();

    act(() => {
      fireEvent.keyDown(suggestion, { key: "Tab", shiftKey: true });
    });
    expect(input).toHaveFocus();
  });

  it("clears the highlighted suggestion when a refreshed list arrives", async () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async (inputPath) => ({
          inputPath,
          basePath: "/Users/demo",
          suggestions:
            inputPath === "/Users/demo/Do"
              ? [
                  { path: "/Users/demo/Documents", name: "Documents", isDirectory: true },
                  { path: "/Users/demo/Downloads", name: "Downloads", isDirectory: true },
                ]
              : [{ path: "/Users/demo/Desktop", name: "Desktop", isDirectory: true }],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("navigation", { name: "Folder path" }));
    });
    const input = screen.getByLabelText("Current folder path");
    fireEvent.change(input, { target: { value: "/Users/demo/Do" } });

    await screen.findByText("Documents");

    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    expect(input).toHaveValue("/Users/demo/Documents/");

    fireEvent.change(input, { target: { value: "/Users/demo/De" } });
    await screen.findByText("Desktop");

    expect(input).toHaveValue("/Users/demo/De");
    expect(document.querySelector(".pathbar-suggestion.active")).toBeNull();
  });

  it("shows the shorter empty-state copy when hidden files are visible", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery=""
      />,
    );

    expect(screen.getByText("This directory is empty.")).toBeInTheDocument();
  });

  it("shows the transient typeahead query", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPath=""
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        typeaheadQuery="doc"
      />,
    );

    expect(screen.getByText("Select")).toBeInTheDocument();
    expect(screen.getByText("doc")).toBeInTheDocument();
  });
});
