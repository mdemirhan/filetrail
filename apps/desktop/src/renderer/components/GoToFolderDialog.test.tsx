// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { GoToFolderDialog } from "./GoToFolderDialog";

describe("GoToFolderDialog", () => {
  it("focuses the input and loads suggestions into the persistent panel", async () => {
    vi.useFakeTimers();
    const handleRequestPathSuggestions = vi.fn().mockResolvedValue({
      inputPath: "/Users/demo",
      basePath: "/Users",
      suggestions: [
        { name: "demo", path: "/Users/demo", isDirectory: true },
        { name: "desktop", path: "/Users/desktop", isDirectory: true },
      ],
    });

    render(
      <GoToFolderDialog
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes={false}
        onClose={() => undefined}
        onSubmit={() => undefined}
        onRequestPathSuggestions={handleRequestPathSuggestions}
      />,
    );

    expect(screen.getByLabelText("Absolute path")).toHaveFocus();

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {});

    expect(screen.getByText("2 matches")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /demo/i })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("accepts the highlighted suggestion first, then submits the accepted path", async () => {
    vi.useFakeTimers();
    const handleSubmit = vi.fn();
    const handleRequestPathSuggestions = vi.fn().mockResolvedValue({
      inputPath: "/Users/de",
      basePath: "/Users",
      suggestions: [
        { name: "demo", path: "/Users/demo", isDirectory: true },
        { name: "desktop", path: "/Users/desktop", isDirectory: true },
      ],
    });

    render(
      <GoToFolderDialog
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes={false}
        onClose={() => undefined}
        onSubmit={handleSubmit}
        onRequestPathSuggestions={handleRequestPathSuggestions}
      />,
    );

    const input = screen.getByLabelText("Absolute path");
    fireEvent.change(input, { target: { value: "/Users/de" } });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {});

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("/Users/desktop");

    fireEvent.click(screen.getByRole("button", { name: "Open Folder" }));
    expect(handleSubmit).toHaveBeenCalledWith("/Users/desktop");
    vi.useRealTimers();
  });

  it("submits the typed path when suggestions are visible but not explicitly selected", async () => {
    vi.useFakeTimers();
    const handleSubmit = vi.fn();
    const handleRequestPathSuggestions = vi.fn().mockResolvedValue({
      inputPath: "/Users/de",
      basePath: "/Users",
      suggestions: [{ name: "demo", path: "/Users/demo", isDirectory: true }],
    });

    render(
      <GoToFolderDialog
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes={false}
        onClose={() => undefined}
        onSubmit={handleSubmit}
        onRequestPathSuggestions={handleRequestPathSuggestions}
      />,
    );

    const input = screen.getByLabelText("Absolute path");
    fireEvent.change(input, { target: { value: "/Users/de" } });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {});

    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("/Users/de");

    fireEvent.click(screen.getByRole("button", { name: "Open Folder" }));
    expect(handleSubmit).toHaveBeenCalledWith("/Users/de");
    vi.useRealTimers();
  });

  it("keeps the suggestions area visible with the empty state when cleared", async () => {
    render(
      <GoToFolderDialog
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes={false}
        onClose={() => undefined}
        onSubmit={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear path" }));

    expect(screen.getByText("Type a path to search")).toBeInTheDocument();
    expect(screen.getByLabelText("Absolute path")).toHaveValue("");
  });

  it("closes on escape", () => {
    const handleClose = vi.fn();

    render(
      <GoToFolderDialog
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes={false}
        onClose={handleClose}
        onSubmit={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Absolute path"), { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("supports the Move To variant with Browse and custom submit text", async () => {
    const handleBrowse = vi.fn().mockResolvedValue("/Users/demo/Target");
    const handleSubmit = vi.fn();

    render(
      <GoToFolderDialog
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        title="Move To"
        submitLabel="Move"
        browseLabel="Browse"
        onBrowse={handleBrowse}
        tabSwitchesExplorerPanes={false}
        onClose={() => undefined}
        onSubmit={handleSubmit}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Move To" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));

    await screen.findByDisplayValue("/Users/demo/Target");
    expect(handleBrowse).toHaveBeenCalledWith("/Users/demo");

    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(handleSubmit).toHaveBeenCalledWith("/Users/demo/Target");
  });
});
