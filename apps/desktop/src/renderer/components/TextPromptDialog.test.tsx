// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { TextPromptDialog } from "./TextPromptDialog";

describe("TextPromptDialog", () => {
  it("preserves the user draft while open when the parent rerenders", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <TextPromptDialog
        open
        title="New Folder"
        label="Folder name"
        value="New Folder"
        submitLabel="Create Folder"
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    const input = screen.getByLabelText("Folder name");
    fireEvent.change(input, {
      target: { value: "Draft Folder" },
    });
    expect(screen.getByLabelText("Folder name")).toHaveValue("Draft Folder");

    rerender(
      <TextPromptDialog
        open
        title="New Folder"
        label="Folder name"
        value="New Folder 2"
        submitLabel="Create Folder"
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("Folder name")).toHaveValue("Draft Folder");
  });

  it("reseeds the draft when reopened", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <TextPromptDialog
        open
        title="Rename"
        label="New name"
        value="first.txt"
        submitLabel="Rename"
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("New name"), {
      target: { value: "edited.txt" },
    });

    rerender(
      <TextPromptDialog
        open={false}
        title="Rename"
        label="New name"
        value="second.txt"
        submitLabel="Rename"
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );
    rerender(
      <TextPromptDialog
        open
        title="Rename"
        label="New name"
        value="second.txt"
        submitLabel="Rename"
        error={null}
        onClose={onClose}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText("New name")).toHaveValue("second.txt");
  });

  it("traps Tab inside the dialog", async () => {
    render(
      <TextPromptDialog
        open
        title="Rename"
        label="New name"
        value="demo.txt"
        submitLabel="Rename"
        error={null}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    await act(async () => {});

    const input = screen.getByLabelText("New name");
    const cancelButton = screen.getByRole("button", { name: "Cancel" });
    const renameButton = screen.getByRole("button", { name: "Rename" });
    act(() => {
      input.focus();
    });

    act(() => {
      fireEvent.keyDown(input, { key: "Tab" });
    });
    expect(cancelButton).toHaveFocus();

    act(() => {
      renameButton.focus();
    });
    act(() => {
      fireEvent.keyDown(renameButton, { key: "Tab" });
    });
    expect(input).toHaveFocus();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();

    render(
      <TextPromptDialog
        open
        title="New Folder"
        label="Folder name"
        value="New Folder"
        submitLabel="Create Folder"
        error={null}
        onClose={onClose}
        onSubmit={() => undefined}
      />,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "Escape" });
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
