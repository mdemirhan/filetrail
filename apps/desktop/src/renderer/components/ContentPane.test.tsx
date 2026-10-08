// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { FLOW_LIST_LAYOUT } from "../lib/flowListLayout";
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
        hiddenItemCount={0}
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

    expect(screen.getByText("Empty folder")).toBeInTheDocument();
  });

  it("names the path bar's … button for what it shows", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/src/filetrail/apps/desktop"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        hiddenItemCount={0}
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

    // A row with no room shows only the current folder, after "…".
    expect(screen.getByRole("button", { name: /^Show \d+ More Folders$/ })).toHaveTextContent("…");
  });

  // ⌘D, ⌘⌫, ⇧⌘N or ⌘O while typing a path must not act on the selected items, so the
  // path field takes the keyboard away from the list, as the search field does.
  it("gives up the keyboard while the path field is being typed in, and takes it back after", async () => {
    const onFocusChange = vi.fn();
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        hiddenItemCount={0}
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
        onFocusChange={onFocusChange}
      />,
    );

    await act(async () => {
      fireEvent.doubleClick(screen.getByLabelText("Folder path"));
    });
    const pathField = await screen.findByLabelText("Current folder path");
    await act(async () => {
      pathField.focus();
    });
    expect(onFocusChange).toHaveBeenLastCalledWith(false);

    await act(async () => {
      (document.querySelector(".content-pane") as HTMLElement).focus();
    });
    expect(onFocusChange).toHaveBeenLastCalledWith(true);
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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

    expect(screen.getByText("Select a folder to see what’s in it.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No folder selected" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("navigation", { name: "Folder path" })).toBeInTheDocument();
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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

    expect(screen.getByText("Couldn’t open this folder")).toBeInTheDocument();
    expect(screen.getByText("Permission denied")).toBeInTheDocument();
  });

  it("explains Full Disk Access when macOS refuses to list the Trash", () => {
    const handleOpenFullDiskAccess = vi.fn();
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo/.Trash"
        entries={[]}
        viewMode="list"
        loading={false}
        error="EPERM: operation not permitted, scandir '/Users/demo/.Trash'"
        onOpenFullDiskAccess={handleOpenFullDiskAccess}
        hiddenItemCount={0}
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
      screen.getByText("File Trail needs Full Disk Access to show the Trash"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Couldn’t open this folder")).not.toBeInTheDocument();
    expect(screen.queryByText(/EPERM/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Privacy Settings" }));
    expect(handleOpenFullDiskAccess).toHaveBeenCalledTimes(1);
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
        hiddenItemCount={0}
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

  it("shows search results under the search bar, with the folder each is in", () => {
    const handleSortChange = vi.fn();
    const handleWidthsChange = vi.fn();
    const result = {
      path: "/Users/demo/app/src/report.ts",
      name: "report.ts",
      extension: "ts",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
    };
    const props = {
      isFocused: true,
      currentPath: "/Users/demo",
      entries: [result],
      viewMode: "details" as const,
      loading: false,
      error: null,
      hiddenItemCount: 0,
      metadataByPath: {},
      sortBy: "name" as const,
      sortDirection: "asc" as const,
      selectedPaths: [result.path],
      selectionLeadPath: result.path,
      onActivateEntry: () => undefined,
      onSortChange: () => undefined,
      onLayoutColumnsChange: () => undefined,
      onVisiblePathsChange: () => undefined,
      onNavigatePath: () => undefined,
      onRequestPathSuggestions: async () => ({ inputPath: "", basePath: null, suggestions: [] }),
      onFocusChange: () => undefined,
      header: <div>Search bar</div>,
      pathbarPath: result.path,
      viewKey: "search:/Users/demo:report",
      listColumns: {
        keys: ["name", "folder", "modified", "size"] as const,
        widths: {
          name: 300,
          folder: 240,
          modified: 152,
          size: 108,
          kind: 148,
          created: 152,
          permissions: 108,
        },
        clampWidth: (_key: string, width: number) => width,
        onWidthsChange: handleWidthsChange,
        getSortKey: (key: string) => (key === "name" ? "name" : key === "folder" ? "path" : null),
        sortBy: "path",
        sortDirection: "asc" as const,
        onSortChange: handleSortChange,
        getFolderLabel: () => "app › src",
      },
      contentStateOverride: null,
      nameHighlight: /rep/i,
    };
    const { rerender } = render(<ContentPane {...props} />);

    expect(screen.getByText("Search bar")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Name",
      "Folder",
      "Date Modified",
      "Size",
    ]);
    expect(screen.getByRole("columnheader", { name: /^Folder/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    // Only Name and Folder order the results.
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(handleSortChange).toHaveBeenCalledWith("name");
    expect(screen.queryByRole("button", { name: "Date Modified" })).toBeNull();
    expect(screen.getByText("app › src")).toBeInTheDocument();
    expect(document.querySelector(".search-result-match")?.textContent).toBe("rep");
    // The path bar ends with the selected result.
    expect(document.querySelector(".pathbar-segment.active")?.textContent).toBe("report.ts");
    // The keyboard widens a column of the search's own.
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Folder column" }), {
      key: "ArrowRight",
    });
    expect(handleWidthsChange).toHaveBeenCalledWith(expect.objectContaining({ folder: 252 }));

    // With nothing to show, the search's own message replaces the folder's.
    rerender(<ContentPane {...props} entries={[]} contentStateOverride={<div>No matches</div>} />);
    expect(screen.getByText("No matches")).toBeInTheDocument();
    expect(screen.queryByText("Empty folder")).toBeNull();
  });

  it("fits a column to its title and its widest value on a double-click of its divider", () => {
    // jsdom draws no text: every character is 7 pixels wide here.
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      font: "",
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as unknown as CanvasRenderingContext2D);
    const handleWidthsChange = vi.fn();
    const file = (name: string) => ({
      path: `/Users/demo/${name}`,
      name,
      extension: name.split(".").pop() ?? "",
      kind: "file" as const,
      isHidden: false,
      isSymlink: false,
    });
    const metadata = (name: string, kindLabel: string) => ({
      path: `/Users/demo/${name}`,
      kindLabel,
      sizeBytes: 5,
      sizeStatus: "ready" as const,
      modifiedAt: null,
      createdAt: null,
      permissionMode: 0o644,
    });
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[file("a.txt"), file("a much longer name.pdf")]}
        viewMode="details"
        loading={false}
        error={null}
        hiddenItemCount={0}
        metadataByPath={{
          "/Users/demo/a.txt": metadata("a.txt", "Plain Text"),
          "/Users/demo/a much longer name.pdf": metadata("a much longer name.pdf", "PDF document"),
        }}
        detailColumns={{
          modified: false,
          size: true,
          kind: true,
          created: false,
          permissions: true,
        }}
        onDetailColumnWidthsChange={handleWidthsChange}
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

    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize Kind column" }));
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize Size column" }));
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize Name column" }));
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize Permissions column" }));
    getContext.mockRestore();

    // The widest value, plus 2 pixels so rounding never cuts it; the title when it is
    // wider ("Kind" is not), except in Permissions; never below the column's least width.
    const fitted = handleWidthsChange.mock.calls.map(([widths]) => widths);
    expect(fitted[0].kind).toBe(12 * 7 + 2);
    expect(fitted[1].size).toBe(60);
    expect(fitted[2].name).toBe(22 * 7 + 2);
    expect(fitted[3].permissions).toBe(36);
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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

    expect(screen.getByRole("row", { name: /Folder/ })).toHaveTextContent("--");
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
        hiddenItemCount={0}
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
          hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
          hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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

  it("says an empty folder has hidden items only when it has some", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Users/demo"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        hiddenItemCount={3}
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

    expect(screen.getByText("Empty folder · 3 hidden items")).toBeInTheDocument();
  });

  it("starts the path of a folder on another disk at that disk", () => {
    render(
      <ContentPane
        isFocused
        currentPath="/Volumes/Backup/Photos"
        entries={[]}
        viewMode="list"
        loading={false}
        error={null}
        hiddenItemCount={0}
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
        onRequestFolderChildren={async () => []}
        onFocusChange={() => undefined}
      />,
    );

    // Backup › Photos, not Macintosh HD › Volumes › Backup › Photos.
    expect(
      screen.getAllByRole("button", { name: /^Folders in / }).map((button) => button.title),
    ).toEqual(["Folders in Backup"]);
    expect(screen.queryByText("Volumes")).toBeNull();
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
        hiddenItemCount={0}
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
          hiddenItemCount={0}
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
          hiddenItemCount={0}
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
    expect(screen.queryByText("Empty folder")).toBeNull();
    expect(screen.getByText("0 of 12")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search Subfolders" }));
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
        hiddenItemCount={0}
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
    // One row high: each item stands in a column of its own.
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(
        FLOW_LIST_LAYOUT.paddingTop + FLOW_LIST_LAYOUT.rowHeight + FLOW_LIST_LAYOUT.paddingBottom,
      );
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
        hiddenItemCount={0}
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
        hiddenItemCount={0}
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
    clientHeight.mockRestore();
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
          hiddenItemCount={0}
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

  it.each(["details", "icons"] as const)(
    "stays where the %s view was scrolled when the folder is read again with an item more",
    (viewMode) => {
      const clientHeight = vi
        .spyOn(HTMLElement.prototype, "clientHeight", "get")
        .mockReturnValue(200);
      const clientWidth = vi
        .spyOn(HTMLElement.prototype, "clientWidth", "get")
        .mockReturnValue(800);
      const entryAt = (index: number) => ({
        path: `/Users/demo/item-${String(index).padStart(3, "0")}.txt`,
        name: `item-${String(index).padStart(3, "0")}.txt`,
        extension: "txt",
        kind: "file" as const,
        isHidden: false,
        isSymlink: false,
      });
      const entries = Array.from({ length: 200 }, (_, index) => entryAt(index));
      const pane = (shownEntries: typeof entries) => (
        <ContentPane
          isFocused
          currentPath="/Users/demo"
          entries={shownEntries}
          viewMode={viewMode}
          loading={false}
          error={null}
          hiddenItemCount={0}
          selectedPaths={[entries[0]?.path ?? ""]}
          selectionLeadPath={entries[0]?.path ?? null}
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
        />
      );
      const { container, rerender } = render(pane(entries));
      const scroller = container.querySelector<HTMLElement>(".content-scroll");
      if (!scroller) {
        throw new Error("Missing the list's scroll area.");
      }
      // Scrolled away from the selected item, at the top.
      scroller.scrollTop = 2_000;

      // Another app adds an item, and the folder is read again.
      rerender(pane([...entries, entryAt(200)]));

      expect(scroller.scrollTop).toBe(2_000);
      clientHeight.mockRestore();
      clientWidth.mockRestore();
    },
  );
});
