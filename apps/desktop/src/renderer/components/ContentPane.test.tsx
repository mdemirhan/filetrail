// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";

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
      />,
    );

    expect(screen.getByText("This folder is empty")).toBeInTheDocument();
  });

  it("shows the status summary at the end of the path bar", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
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
        statusSummary="0 items · 212 GB available"
      />,
    );

    const summary = screen.getByText("0 items · 212 GB available");
    expect(summary.closest(".content-pathbar-row")).not.toBeNull();
  });

  it("renders a selection-empty state when no folder is selected", () => {
    const { container } = render(
      <ContentPane
        isFocused
        currentPath=""
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
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
      />,
    );

    expect(
      screen.getByText("Select a folder or favorite to view its contents."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No folder selected" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
    expect(container.querySelector(".file-icon-folder-outline")).not.toBeNull();
    expect(container.querySelector(".file-icon-folder-cue")).not.toBeNull();
  });

  it("uses the open-folder empty-state icon when a selected folder has no items", () => {
    const { container } = render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
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
      />,
    );

    expect(container.querySelector(".file-icon-folder-open-fill")).not.toBeNull();
    expect(container.querySelector(".file-icon-folder-cue")).toBeNull();
  });

  it("opens the path editor when the no-folder-selected breadcrumb is double-clicked", async () => {
    render(
      <ContentPane
        isFocused
        currentPath=""
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
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
      />,
    );

    act(() => {
      fireEvent.doubleClick(screen.getByRole("button", { name: "No folder selected" }));
    });
    await act(async () => {});

    expect(screen.getByLabelText("Current folder path")).toHaveValue("");
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
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /date modified/i }));
    expect(handleSortChange).toHaveBeenCalledWith("modified");

    expect(screen.getByRole("grid")).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(screen.getByRole("columnheader", { name: /^Date Modified/ })).toHaveAttribute(
      "aria-sort",
      "none",
    );
  });

  it("forwards modifier selection gestures in details mode", () => {
    const handleSelectionGesture = vi.fn();

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
        selectedPaths={[]}
        selectionLeadPath={null}
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectionGesture={handleSelectionGesture}
        onClearSelection={() => undefined}
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
      />,
    );

    const row = screen.getByRole("row", { name: /alpha\.txt/i });
    expect(row).toHaveAttribute("aria-selected", "false");

    fireEvent.pointerDown(row, {
      button: 0,
      metaKey: true,
    });

    expect(handleSelectionGesture).toHaveBeenCalledWith("/Users/demo/alpha.txt", {
      metaKey: true,
      shiftKey: false,
    });
  });

  it("shows directory size as a dash and keeps unloaded metadata cells empty in details mode", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[
          {
            path: "/Users/demo/Folder",
            name: "Folder",
            extension: "",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
          },
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
        selectedPaths={[]}
        selectionLeadPath={null}
        metadataByPath={{
          "/Users/demo/alpha.txt": {
            path: "/Users/demo/alpha.txt",
            kindLabel: "TXT File",
            createdAt: null,
            modifiedAt: null,
            sizeBytes: null,
            sizeStatus: "unavailable",
            permissionMode: null,
          },
        }}
        detailColumns={{
          size: true,
          modified: true,
          permissions: false,
          kind: true,
          created: false,
        }}
        sortBy="name"
        sortDirection="asc"
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
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
      />,
    );

    expect(screen.getByRole("row", { name: /Folder/ })).toHaveTextContent("-");
    expect(screen.getByRole("row", { name: /alpha\.txt/ })).toHaveTextContent("Unavailable");
    expect(screen.queryByText("Not yet available")).not.toBeInTheDocument();
    expect(screen.queryByText("Not available")).not.toBeInTheDocument();
  });

  it("shows Kind and Date Created columns, sorting by Kind but not by Date Created", () => {
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
        selectedPaths={[]}
        selectionLeadPath={null}
        metadataByPath={{
          "/Users/demo/alpha.txt": {
            path: "/Users/demo/alpha.txt",
            kindLabel: "Plain Text Document",
            createdAt: "2026-03-02T10:30:00.000Z",
            modifiedAt: "2026-04-05T08:15:00.000Z",
            sizeBytes: 2048,
            sizeStatus: "ready",
            permissionMode: 0o644,
          },
        }}
        detailColumns={{
          modified: true,
          size: true,
          kind: true,
          created: true,
          permissions: false,
        }}
        sortBy="name"
        sortDirection="asc"
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
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
      />,
    );

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Name",
      "Date Modified",
      "Size",
      "Kind",
      "Date Created",
    ]);
    // The sorted column shows its direction with a chevron, and only that column does.
    expect(headers[0]?.querySelector(".sort-indicator")).toHaveAttribute("data-direction", "asc");
    expect(document.querySelectorAll(".sort-indicator")).toHaveLength(1);
    const row = screen.getByRole("row", { name: /alpha\.txt/ });
    expect(row).toHaveTextContent("Plain Text Document");
    // Both dates are shown: created in March, modified in April.
    expect(row).toHaveTextContent(/Mar 2/);
    expect(row).toHaveTextContent(/Apr 5/);

    fireEvent.click(screen.getByRole("button", { name: "Kind" }));
    expect(handleSortChange).toHaveBeenCalledWith("kind");
    // Date Created comes from lazily loaded metadata, so its header is a plain label.
    expect(screen.queryByRole("button", { name: "Date Created" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Date Created/ })).not.toHaveAttribute(
      "aria-sort",
    );
  });

  it.each(["list", "details"] as const)(
    "edits an item's name in its row in %s view",
    (viewMode) => {
      const handleSubmit = vi.fn();
      const handleCancel = vi.fn();
      const handleSelectionGesture = vi.fn();
      const handleActivate = vi.fn();

      render(
        <ContentPane
          isFocused={false}
          currentPath="/Users/demo"
          entries={["alpha.txt", "beta.txt"].map((name) => ({
            path: `/Users/demo/${name}`,
            name,
            extension: "txt",
            kind: "file" as const,
            isHidden: false,
            isSymlink: false,
          }))}
          viewMode={viewMode}
          loading={false}
          error={null}
          includeHidden={false}
          selectedPaths={["/Users/demo/alpha.txt"]}
          selectionLeadPath="/Users/demo/alpha.txt"
          metadataByPath={{}}
          sortBy="name"
          sortDirection="asc"
          onSelectionGesture={handleSelectionGesture}
          onClearSelection={() => undefined}
          onActivateEntry={handleActivate}
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
          inlineRename={{ path: "/Users/demo/alpha.txt", error: null }}
          onInlineRenameSubmit={handleSubmit}
          onInlineRenameCancel={handleCancel}
        />,
      );

      const role = viewMode === "list" ? "option" : "row";
      const input = screen.getByRole("textbox", { name: "Rename alpha.txt" });
      expect(input).toHaveFocus();
      // The row being renamed is not a button, so it cannot open or drag the item.
      const renamingRow = input.closest(`[role="${role}"]`);
      expect(renamingRow?.tagName).toBe("DIV");
      expect(renamingRow).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole(role, { name: /beta\.txt/ }).tagName).toBe("BUTTON");

      fireEvent.doubleClick(input);
      fireEvent.pointerDown(input, { button: 0 });
      expect(handleActivate).not.toHaveBeenCalled();
      expect(handleSelectionGesture).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: "gamma.txt" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(handleSubmit).toHaveBeenCalledWith("gamma.txt");
      expect(handleCancel).not.toHaveBeenCalled();
    },
  );

  it("shows permissions as the code, with the letters as the tooltip", () => {
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
        selectedPaths={[]}
        selectionLeadPath={null}
        metadataByPath={{
          "/Users/demo/alpha.txt": {
            path: "/Users/demo/alpha.txt",
            kindLabel: "Plain Text Document",
            createdAt: "2026-03-02T10:30:00.000Z",
            modifiedAt: "2026-04-05T08:15:00.000Z",
            sizeBytes: 2048,
            sizeStatus: "ready",
            permissionMode: 0o644,
          },
        }}
        detailColumns={{
          modified: true,
          size: true,
          kind: true,
          created: false,
          permissions: true,
        }}
        sortBy="name"
        sortDirection="asc"
        onSelectionGesture={() => undefined}
        onClearSelection={() => undefined}
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
      />,
    );

    const cell = within(screen.getByRole("row", { name: /alpha\.txt/ })).getByText("644");
    expect(cell).toHaveAttribute("title", "rw-r--r--");
    // The date reads relative to now and keeps the whole date as its tooltip.
    expect(
      within(screen.getByRole("row", { name: /alpha\.txt/ })).getByTitle(/April 5, 2026 at/),
    ).toHaveTextContent(/Apr 5/);
  });
  it("forwards typeahead keys from details view through the shared content handler", () => {
    const handleTypeaheadInput = vi.fn();

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
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
        onTypeaheadInput={handleTypeaheadInput}
      />,
    );

    fireEvent.keyDown(screen.getByRole("row", { name: /alpha\.txt/i }), { key: "a" });

    expect(handleTypeaheadInput).toHaveBeenCalledWith("a");
  });

  it("focuses the content pane when the path bar is clicked", () => {
    const handleFocusChange = vi.fn();
    const { container } = render(
      <ContentPane
        isFocused={false}
        currentPath="/Users/demo/projects"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
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
        onFocusChange={handleFocusChange}
      />,
    );

    const pane = container.querySelector<HTMLElement>(".content-pane");
    expect(pane).not.toBeNull();
    if (!pane) {
      throw new Error("Missing content pane.");
    }

    fireEvent.mouseDown(screen.getByRole("navigation", { name: "Folder path" }));

    expect(document.activeElement).toBe(pane);
    expect(handleFocusChange).toHaveBeenCalledWith(true);
  });

  it("focuses the content pane when the viewport background is clicked", () => {
    const handleFocusChange = vi.fn();
    const { container } = render(
      <ContentPane
        isFocused={false}
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
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
        onFocusChange={handleFocusChange}
      />,
    );

    const pane = container.querySelector<HTMLElement>(".content-pane");
    const viewport = container.querySelector<HTMLElement>(".content-viewport");
    expect(pane).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (!pane || !viewport) {
      throw new Error("Missing content viewport.");
    }

    fireEvent.mouseDown(viewport);

    expect(document.activeElement).toBe(pane);
    expect(handleFocusChange).toHaveBeenCalledWith(true);
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

  it("opens the path editor when a breadcrumb segment is double-clicked", async () => {
    vi.useFakeTimers();
    try {
      const handleNavigatePath = vi.fn();

      render(
        <ContentPane
          isFocused
          currentPath="/Users/demo/projects/filetrail"
          entries={[]}
          viewMode="list"
          loading={false}
          error={null}
          includeHidden={false}
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
        />,
      );

      const segment = screen.getByRole("button", { name: "filetrail" });
      act(() => {
        fireEvent.click(segment);
        vi.advanceTimersByTime(250);
        fireEvent.doubleClick(segment);
      });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });

      expect(screen.getByLabelText("Current folder path")).toHaveValue(
        "/Users/demo/projects/filetrail",
      );
      expect(handleNavigatePath).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
      />,
    );

    expect(screen.getByText("This directory is empty.")).toBeInTheDocument();
  });

  it("lists the folders at a level of the path from the separator before it", async () => {
    const handleNavigate = vi.fn();
    const handleRequestFolders = vi.fn().mockResolvedValue([
      { path: "/Users/demo/Documents", name: "Documents" },
      { path: "/Users/demo/src", name: "src" },
    ]);
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/src"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectPath={() => undefined}
        onActivateEntry={() => undefined}
        onSortChange={() => undefined}
        onLayoutColumnsChange={() => undefined}
        onVisiblePathsChange={() => undefined}
        onNavigatePath={handleNavigate}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onRequestFolderChildren={handleRequestFolders}
        onFocusChange={() => undefined}
      />,
    );

    // One separator per level below the top of the disk.
    expect(
      screen.getAllByRole("button", { name: /^Folders in / }).map((button) => button.title),
    ).toEqual(["Folders in Macintosh HD", "Folders in Users", "Folders in demo"]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Folders in demo" }));
    });
    expect(handleRequestFolders).toHaveBeenCalledWith("/Users/demo");
    expect(screen.getByRole("menuitemradio", { name: /src/u })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Documents" }));
    expect(handleNavigate).toHaveBeenCalledWith("/Users/demo/Documents");
  });

  it("draws a bar behind each known size, as a share of the largest", () => {
    const entry = (name: string, kind: "file" | "directory", sizeBytes?: number) => ({
      path: `/Users/demo/${name}`,
      name,
      extension: "",
      kind,
      isHidden: false,
      isSymlink: false,
      ...(sizeBytes === undefined ? {} : { sizeBytes }),
    });
    const entries = [
      entry("big", "directory"),
      entry("half.bin", "file", 500),
      entry("tiny.bin", "file", 1),
      entry("empty.bin", "file", 0),
      entry("unsized", "directory"),
    ];
    const folderSizes: Record<string, number> = { "/Users/demo/big": 1000 };
    const renderPane = (withBars: boolean) =>
      render(
        <ContentPane
          isFocused
          currentPath="/Users/demo"
          entries={entries}
          viewMode="details"
          loading={false}
          error={null}
          includeHidden={false}
          metadataByPath={{}}
          sortBy="size"
          sortDirection="desc"
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
          sizeBars={
            withBars
              ? {
                  maxBytes: 1000,
                  getSizeBytes: (item) =>
                    item.kind === "directory"
                      ? (folderSizes[item.path] ?? null)
                      : (item.sizeBytes ?? null),
                }
              : null
          }
        />,
      );
    const barWidth = (name: string) => {
      const row = screen.getByText(name).closest(".details-row");
      const bar = row?.querySelector<HTMLElement>(".details-size-bar");
      return bar ? bar.style.width : null;
    };

    const withBars = renderPane(true);
    expect(barWidth("big")).toBe("100%");
    expect(barWidth("half.bin")).toBe("50%");
    // Too small to see at this scale: still drawn (the stylesheet keeps it a sliver wide).
    expect(barWidth("tiny.bin")).toBe("0.1%");
    // Nothing for zero bytes, and nothing for a folder that has not been sized.
    expect(barWidth("empty.bin")).toBeNull();
    expect(barWidth("unsized")).toBeNull();
    withBars.unmount();

    renderPane(false);
    expect(document.querySelector(".details-size-bar")).toBeNull();
  });

  it("shows what was typed to filter the list, with a way to clear it", () => {
    const handleClearFilter = vi.fn();
    const entry = (name: string) => ({
      path: `/Users/demo/${name}`,
      name,
      extension: "txt",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
    });
    const renderPane = (entries: ReturnType<typeof entry>[], onSearchForFilter?: () => void) =>
      render(
        <ContentPane
          isFocused
          currentPath="/Users/demo"
          entries={entries}
          viewMode="list"
          loading={false}
          error={null}
          includeHidden={false}
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
          filterQuery="doc"
          filterTotalCount={12}
          onClearFilter={handleClearFilter}
          onSearchForFilter={onSearchForFilter}
        />,
      );

    const filtered = renderPane([entry("docs.txt"), entry("my doc.txt")]);
    expect(screen.getByText("Filter")).toBeInTheDocument();
    expect(screen.getByText("doc")).toBeInTheDocument();
    expect(screen.getByText("2 of 12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(handleClearFilter).toHaveBeenCalledTimes(1);
    filtered.unmount();

    // Nothing matches: say so, rather than calling the folder empty, and offer the search.
    const handleSearch = vi.fn();
    renderPane([], handleSearch);
    expect(screen.getByText("No items match “doc”")).toBeInTheDocument();
    expect(screen.queryByText("This folder is empty")).toBeNull();
    expect(screen.getByText("0 of 12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search subfolders" }));
    expect(handleSearch).toHaveBeenCalledTimes(1);
  });

  it("forwards modifier selection and background context-menu events in list view", () => {
    const handleSelectionGesture = vi.fn();
    const handleClearSelection = vi.fn();
    const handleContextMenu = vi.fn();

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
          {
            path: "/Users/demo/beta.txt",
            name: "beta.txt",
            extension: "txt",
            kind: "file",
            isHidden: false,
            isSymlink: false,
          },
        ]}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPaths={[]}
        selectionLeadPath={null}
        metadataByPath={{}}
        sortBy="name"
        sortDirection="asc"
        onSelectionGesture={handleSelectionGesture}
        onClearSelection={handleClearSelection}
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
        onItemContextMenu={handleContextMenu}
      />,
    );

    const row = screen.getByRole("option", { name: /beta\.txt/i });
    const list = row.closest(".flow-list");
    expect(list).not.toBeNull();
    if (!list) {
      throw new Error("Missing flow list container.");
    }

    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(row).toHaveAttribute("aria-selected", "false");

    fireEvent.pointerDown(row, { button: 0, shiftKey: true });
    fireEvent.mouseDown(list);
    fireEvent.contextMenu(list, { clientX: 12, clientY: 18 });

    expect(handleSelectionGesture).toHaveBeenCalledWith("/Users/demo/beta.txt", {
      metaKey: false,
      shiftKey: true,
    });
    expect(handleClearSelection).toHaveBeenCalledTimes(2);
    expect(handleContextMenu).toHaveBeenCalledWith(null, { x: 12, y: 18 });
  });

  it("keeps the selected list item horizontally visible when the lead selection changes", () => {
    const entries = Array.from({ length: 6 }, (_, index) => ({
      path: `/Users/demo/item-${index}.txt`,
      name: `item-${index}.txt`,
      extension: "txt",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
    }));

    const { container, rerender } = render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={entries}
        viewMode="list"
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
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
      />,
    );

    const list = container.querySelector(".flow-list");
    expect(list).not.toBeNull();
    if (!list) {
      throw new Error("Missing flow list container.");
    }

    Object.defineProperties(list, {
      clientWidth: { value: 980, configurable: true },
      scrollWidth: { value: 2400, configurable: true },
    });
    list.scrollLeft = 0;

    rerender(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={entries}
        viewMode="list"
        loading={false}
        error={null}
        includeHidden={false}
        selectedPaths={["/Users/demo/item-3.txt"]}
        selectionLeadPath="/Users/demo/item-3.txt"
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
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
        onFocusChange={() => undefined}
      />,
    );

    expect(list.scrollLeft).toBe(282);
  });

  it.each(["list", "details"] as const)(
    "narrows a multi-selection to the clicked item in %s view, but not on pointer down",
    (viewMode) => {
      const handleSelectionGesture = vi.fn();
      const entries = ["alpha.txt", "beta.txt", "gamma.txt"].map((name) => ({
        path: `/Users/demo/${name}`,
        name,
        extension: "txt",
        kind: "file" as const,
        isHidden: false,
        isSymlink: false,
      }));

      render(
        <ContentPane
          isFocused
          currentPath="/Users/demo"
          entries={entries}
          viewMode={viewMode}
          loading={false}
          error={null}
          includeHidden={false}
          selectedPaths={["/Users/demo/alpha.txt", "/Users/demo/beta.txt"]}
          selectionLeadPath="/Users/demo/beta.txt"
          metadataByPath={{}}
          sortBy="name"
          sortDirection="asc"
          onSelectionGesture={handleSelectionGesture}
          onClearSelection={() => undefined}
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
        />,
      );

      const role = viewMode === "list" ? "option" : "row";
      const selectedRow = screen.getByRole(role, { name: /alpha\.txt/i });

      // Pressing a selected item must leave the selection alone so it can be dragged.
      fireEvent.pointerDown(selectedRow, { button: 0 });
      expect(handleSelectionGesture).not.toHaveBeenCalled();

      fireEvent.click(selectedRow, { button: 0, detail: 1 });
      expect(handleSelectionGesture).toHaveBeenCalledTimes(1);
      expect(handleSelectionGesture).toHaveBeenCalledWith("/Users/demo/alpha.txt", {
        metaKey: false,
        shiftKey: false,
      });

      // A Cmd-click toggles on pointer down and must not narrow on the click that follows.
      fireEvent.click(selectedRow, { button: 0, detail: 1, metaKey: true });
      expect(handleSelectionGesture).toHaveBeenCalledTimes(1);
    },
  );
});
