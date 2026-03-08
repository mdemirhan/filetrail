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
});
