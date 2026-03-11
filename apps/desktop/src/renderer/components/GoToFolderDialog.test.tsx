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

  it("refocuses the input and places the cursor at the end when reopened", () => {
    const { rerender } = render(
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

    const input = screen.getByLabelText("Absolute path") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe("/Users/demo".length);
    expect(input.selectionEnd).toBe("/Users/demo".length);

    rerender(
      <GoToFolderDialog
        open={false}
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

    rerender(
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

    const reopenedInput = screen.getByLabelText("Absolute path") as HTMLInputElement;
    expect(reopenedInput).toHaveFocus();
    expect(reopenedInput.selectionStart).toBe("/Users/demo".length);
    expect(reopenedInput.selectionEnd).toBe("/Users/demo".length);
  });

  it("reclaims focus when it escapes outside the dialog", async () => {
    render(
      <>
        <button type="button">Outside</button>
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
        />
      </>,
    );

    const input = screen.getByLabelText("Absolute path") as HTMLInputElement;
    expect(input).toHaveFocus();

    const outsideButton = screen.getByRole("button", { name: "Outside" });
    await act(async () => {
      outsideButton.focus();
      fireEvent.focusIn(outsideButton);
    });

    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe("/Users/demo".length);
    expect(input.selectionEnd).toBe("/Users/demo".length);
  });

  it("keeps the input focused at the end when the seeded path changes while open", async () => {
    const { rerender } = render(
      <GoToFolderDialog
        open
        currentPath="/Users/demo/Folder"
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

    rerender(
      <GoToFolderDialog
        open
        currentPath="/Users/demo/Remembered"
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

    const input = screen.getByLabelText("Absolute path") as HTMLInputElement;
    expect(input).toHaveFocus();
    expect(input).toHaveValue("/Users/demo/Remembered");
    expect(input.selectionStart).toBe("/Users/demo/Remembered".length);
    expect(input.selectionEnd).toBe("/Users/demo/Remembered".length);
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
