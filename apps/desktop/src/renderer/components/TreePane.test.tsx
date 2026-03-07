// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { TreePane } from "./TreePane";

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
        onOpenNode={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={() => undefined}
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
        onOpenNode={() => undefined}
        onToggleExpand={() => undefined}
        onNavigate={handleNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Documents" }));
    vi.runAllTimers();
    expect(handleNavigate).toHaveBeenCalledWith("/Users/demo/Documents");
    vi.useRealTimers();
  });
});
