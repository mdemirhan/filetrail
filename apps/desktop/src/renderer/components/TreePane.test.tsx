// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";

import { TreePane } from "./TreePane";

const themeButtonRef = createRef<HTMLButtonElement>();
const themeMenuRef = createRef<HTMLDivElement>();

describe("TreePane", () => {
  it("renders alias folders as non-expandable", () => {
    render(
      <TreePane
        isFocused
        rootPath="/Users/demo"
        homePath="/Users/demo"
        currentPath="/Users/demo"
        nodes={{
          "/Users/demo": {
            path: "/Users/demo",
            name: "demo",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: true,
            loading: false,
            loaded: true,
            error: null,
            childPaths: ["/Users/demo/Alias"],
          },
          "/Users/demo/Alias": {
            path: "/Users/demo/Alias",
            name: "Alias",
            kind: "symlink_directory",
            isHidden: false,
            isSymlink: true,
            expanded: false,
            loading: false,
            loaded: false,
            error: null,
            childPaths: [],
          },
        }}
        onFocusChange={() => undefined}
        onGoHome={() => undefined}
        onRerootHome={() => undefined}
        onQuickAccess={() => undefined}
        foldersFirst
        onToggleFoldersFirst={() => undefined}
        detailRowOpen
        onToggleDetailRow={() => undefined}
        theme="tomorrow-night"
        themeMenuOpen={false}
        themeButtonRef={themeButtonRef}
        themeMenuRef={themeMenuRef}
        onToggleThemeMenu={() => undefined}
        onSelectTheme={() => undefined}
        onOpenHelp={() => undefined}
        onOpenSettings={() => undefined}
        includeHidden={false}
        onToggleHidden={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
        typeaheadQuery=""
      />,
    );

    const aliasLabels = screen.getAllByText("Alias");
    expect(aliasLabels.length).toBe(2);
    expect(screen.getByRole("button", { name: "AliasAlias" })).not.toBeDisabled();
    expect(screen.getAllByLabelText(/expand folder/i).at(-1)).toBeDisabled();
  });

  it("navigates when a folder row is clicked", () => {
    vi.useFakeTimers();
    const handleNavigate = vi.fn();
    render(
      <TreePane
        isFocused
        rootPath="/Users/demo"
        homePath="/Users/demo"
        currentPath="/Users/demo"
        nodes={{
          "/Users/demo": {
            path: "/Users/demo",
            name: "demo",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: true,
            loading: false,
            loaded: true,
            error: null,
            childPaths: ["/Users/demo/Documents"],
          },
          "/Users/demo/Documents": {
            path: "/Users/demo/Documents",
            name: "Documents",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: false,
            loading: false,
            loaded: false,
            error: null,
            childPaths: [],
          },
        }}
        onFocusChange={() => undefined}
        onGoHome={() => undefined}
        onRerootHome={() => undefined}
        onQuickAccess={() => undefined}
        foldersFirst
        onToggleFoldersFirst={() => undefined}
        detailRowOpen
        onToggleDetailRow={() => undefined}
        theme="tomorrow-night"
        themeMenuOpen={false}
        themeButtonRef={themeButtonRef}
        themeMenuRef={themeMenuRef}
        onToggleThemeMenu={() => undefined}
        onSelectTheme={() => undefined}
        onOpenHelp={() => undefined}
        onOpenSettings={() => undefined}
        includeHidden={false}
        onToggleHidden={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={handleNavigate}
        typeaheadQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    vi.runAllTimers();
    expect(handleNavigate).toHaveBeenCalledWith("/Users/demo/Documents");
    vi.useRealTimers();
  });

  it("renders theme options when the rail menu is open", () => {
    render(
      <TreePane
        isFocused
        rootPath="/Users/demo"
        homePath="/Users/demo"
        currentPath="/Users/demo"
        nodes={{
          "/Users/demo": {
            path: "/Users/demo",
            name: "demo",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: true,
            loading: false,
            loaded: true,
            error: null,
            childPaths: [],
          },
        }}
        onFocusChange={() => undefined}
        onGoHome={() => undefined}
        onRerootHome={() => undefined}
        onQuickAccess={() => undefined}
        foldersFirst
        onToggleFoldersFirst={() => undefined}
        detailRowOpen
        onToggleDetailRow={() => undefined}
        theme="dark"
        themeMenuOpen
        themeButtonRef={themeButtonRef}
        themeMenuRef={themeMenuRef}
        onToggleThemeMenu={() => undefined}
        onSelectTheme={() => undefined}
        onOpenHelp={() => undefined}
        onOpenSettings={() => undefined}
        includeHidden={false}
        onToggleHidden={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
        typeaheadQuery=""
      />,
    );

    expect(screen.getByRole("button", { name: /Dark/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tomorrow Night/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Catppuccin Mocha/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Light/i })).toBeInTheDocument();
  });

  it("shows the transient typeahead query", () => {
    render(
      <TreePane
        isFocused
        rootPath="/Users/demo"
        homePath="/Users/demo"
        currentPath="/Users/demo"
        nodes={{
          "/Users/demo": {
            path: "/Users/demo",
            name: "demo",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: true,
            loading: false,
            loaded: true,
            error: null,
            childPaths: [],
          },
        }}
        onFocusChange={() => undefined}
        onGoHome={() => undefined}
        onRerootHome={() => undefined}
        onQuickAccess={() => undefined}
        foldersFirst
        onToggleFoldersFirst={() => undefined}
        detailRowOpen
        onToggleDetailRow={() => undefined}
        theme="dark"
        themeMenuOpen={false}
        themeButtonRef={themeButtonRef}
        themeMenuRef={themeMenuRef}
        onToggleThemeMenu={() => undefined}
        onSelectTheme={() => undefined}
        onOpenHelp={() => undefined}
        onOpenSettings={() => undefined}
        includeHidden={false}
        onToggleHidden={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
        typeaheadQuery="doc"
      />,
    );

    expect(screen.getByText("Jump to")).toBeInTheDocument();
    expect(screen.getByText("doc")).toBeInTheDocument();
  });

  it("opens help from the rail button", () => {
    const handleOpenHelp = vi.fn();
    render(
      <TreePane
        isFocused
        rootPath="/Users/demo"
        homePath="/Users/demo"
        currentPath="/Users/demo"
        nodes={{
          "/Users/demo": {
            path: "/Users/demo",
            name: "demo",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: true,
            loading: false,
            loaded: true,
            error: null,
            childPaths: [],
          },
        }}
        onFocusChange={() => undefined}
        onGoHome={() => undefined}
        onRerootHome={() => undefined}
        onQuickAccess={() => undefined}
        foldersFirst
        onToggleFoldersFirst={() => undefined}
        detailRowOpen
        onToggleDetailRow={() => undefined}
        theme="dark"
        themeMenuOpen={false}
        themeButtonRef={themeButtonRef}
        themeMenuRef={themeMenuRef}
        onToggleThemeMenu={() => undefined}
        onSelectTheme={() => undefined}
        onOpenHelp={handleOpenHelp}
        onOpenSettings={() => undefined}
        includeHidden={false}
        onToggleHidden={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
        typeaheadQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /open help/i }));
    expect(handleOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("reroots the tree at home from the rail button", () => {
    const handleRerootHome = vi.fn();
    render(
      <TreePane
        isFocused
        rootPath="/"
        homePath="/Users/demo"
        currentPath="/Users/demo/Documents"
        nodes={{
          "/": {
            path: "/",
            name: "/",
            kind: "directory",
            isHidden: false,
            isSymlink: false,
            expanded: true,
            loading: false,
            loaded: true,
            error: null,
            childPaths: [],
          },
        }}
        onFocusChange={() => undefined}
        onGoHome={() => undefined}
        onRerootHome={handleRerootHome}
        onQuickAccess={() => undefined}
        foldersFirst
        onToggleFoldersFirst={() => undefined}
        detailRowOpen
        onToggleDetailRow={() => undefined}
        theme="dark"
        themeMenuOpen={false}
        themeButtonRef={themeButtonRef}
        themeMenuRef={themeMenuRef}
        onToggleThemeMenu={() => undefined}
        onSelectTheme={() => undefined}
        onOpenHelp={() => undefined}
        onOpenSettings={() => undefined}
        includeHidden={false}
        onToggleHidden={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
        typeaheadQuery=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /root tree at home/i }));
    expect(handleRerootHome).toHaveBeenCalledTimes(1);
  });
});
