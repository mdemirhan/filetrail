// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { LocationSheet } from "./LocationSheet";

describe("LocationSheet", () => {
  it("submits the edited path", () => {
    const handleSubmit = vi.fn();
    render(
      <LocationSheet
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
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

    fireEvent.change(screen.getByLabelText("Absolute path"), {
      target: { value: "/tmp/project" },
    });
    const submitButton = screen.getByRole("button", { name: "Open Folder" });
    const form = submitButton.closest("form");
    expect(form).not.toBeNull();
    if (!form) {
      throw new Error("Missing location sheet form.");
    }
    fireEvent.submit(form);

    expect(handleSubmit).toHaveBeenCalledWith("/tmp/project");
  });

  it("focuses the input when opened", async () => {
    render(
      <LocationSheet
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

    await act(async () => {});

    expect(screen.getByLabelText("Absolute path")).toHaveFocus();
  });

  it("shows live path suggestions and accepts the highlighted match", async () => {
    vi.useFakeTimers();
    const handleSubmit = vi.fn();
    const handleRequestPathSuggestions = vi.fn().mockResolvedValue({
      inputPath: "/Users/de",
      basePath: "/Users",
      suggestions: [
        { name: "demo", path: "/Users/demo" },
        { name: "desktop", path: "/Users/desktop" },
      ],
    });

    render(
      <LocationSheet
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

    expect(screen.getByRole("button", { name: /demo/i })).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    });
    act(() => {
      fireEvent.submit(input.closest("form") as HTMLFormElement);
    });

    expect(handleSubmit).toHaveBeenCalledWith("/Users/demo");
    vi.useRealTimers();
  });

  it("moves Tab focus between the location input and suggestions when pane tab switching is enabled", async () => {
    vi.useFakeTimers();
    const handleRequestPathSuggestions = vi.fn().mockResolvedValue({
      inputPath: "/Users/de",
      basePath: "/Users",
      suggestions: [
        { name: "demo", path: "/Users/demo" },
        { name: "desktop", path: "/Users/desktop" },
      ],
    });

    render(
      <LocationSheet
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes
        onClose={() => undefined}
        onSubmit={() => undefined}
        onRequestPathSuggestions={handleRequestPathSuggestions}
      />,
    );

    const input = screen.getByLabelText("Absolute path");
    fireEvent.change(input, { target: { value: "/Users/de" } });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {});

    const suggestion = screen.getByRole("button", { name: /demo/i });
    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
    });
    expect(suggestion).toHaveFocus();

    act(() => {
      fireEvent.keyDown(suggestion, { key: "Tab", shiftKey: true });
    });
    expect(input).toHaveFocus();
    vi.useRealTimers();
  });

  it("traps focus inside the dialog when pane tab switching is enabled", async () => {
    render(
      <LocationSheet
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes
        onClose={() => undefined}
        onSubmit={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
      />,
    );

    const closeButton = screen.getByRole("button", { name: "Close" });
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const openButton = screen.getByRole("button", { name: "Open Folder" });

    act(() => {
      cancelButton.focus();
    });
    act(() => {
      fireEvent.keyDown(cancelButton, { key: "Tab" });
    });
    expect(openButton).toHaveFocus();

    act(() => {
      fireEvent.keyDown(openButton, { key: "Tab" });
    });
    expect(closeButton).toHaveFocus();
  });

  it("closes suggestions before closing the dialog on escape", async () => {
    vi.useFakeTimers();
    const handleClose = vi.fn();
    const handleRequestPathSuggestions = vi.fn().mockResolvedValue({
      inputPath: "/Users/de",
      basePath: "/Users",
      suggestions: [{ name: "demo", path: "/Users/demo" }],
    });

    render(
      <LocationSheet
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        tabSwitchesExplorerPanes
        onClose={handleClose}
        onSubmit={() => undefined}
        onRequestPathSuggestions={handleRequestPathSuggestions}
      />,
    );

    const input = screen.getByLabelText("Absolute path");
    fireEvent.change(input, { target: { value: "/Users/de" } });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {});

    expect(screen.getByRole("button", { name: /demo/i })).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(screen.queryByRole("button", { name: /demo/i })).not.toBeInTheDocument();
    expect(handleClose).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(handleClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("fills the input from Browse when provided", async () => {
    const handleBrowse = vi.fn().mockResolvedValue("/Users/demo/Target");

    render(
      <LocationSheet
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        browseLabel="Browse"
        tabSwitchesExplorerPanes={false}
        onBrowse={handleBrowse}
        onClose={() => undefined}
        onSubmit={() => undefined}
        onRequestPathSuggestions={async () => ({
          inputPath: "",
          basePath: null,
          suggestions: [],
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));

    await screen.findByDisplayValue("/Users/demo/Target");
    expect(handleBrowse).toHaveBeenCalledWith("/Users/demo");
  });

  it("does not request or render suggestions when autocomplete is disabled", async () => {
    vi.useFakeTimers();
    const handleRequestPathSuggestions = vi.fn().mockResolvedValue({
      inputPath: "/Users/de",
      basePath: "/Users",
      suggestions: [{ name: "demo", path: "/Users/demo" }],
    });

    render(
      <LocationSheet
        open
        currentPath="/Users/demo"
        submitting={false}
        error={null}
        enableSuggestions={false}
        tabSwitchesExplorerPanes={false}
        onClose={() => undefined}
        onSubmit={() => undefined}
        onRequestPathSuggestions={handleRequestPathSuggestions}
      />,
    );

    fireEvent.change(screen.getByLabelText("Absolute path"), {
      target: { value: "/Users/de" },
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await act(async () => {});

    expect(handleRequestPathSuggestions).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /demo/i })).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
