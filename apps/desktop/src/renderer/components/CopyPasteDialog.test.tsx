// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { CopyPasteDialog } from "./CopyPasteDialog";

describe("CopyPasteDialog", () => {
  it("focuses the primary action on mount", async () => {
    render(
      <CopyPasteDialog
        title="Paste In Progress"
        message="Working"
        primaryAction={{ label: "Cancel Operation", onClick: () => undefined }}
      />,
    );

    await act(async () => {});
    expect(screen.getByRole("button", { name: "Cancel Operation" })).toHaveFocus();
  });

  it("makes the safe action the default for irreversible confirmations", async () => {
    const onDelete = vi.fn();
    const onCancel = vi.fn();
    render(
      <CopyPasteDialog
        title="Delete Immediately?"
        message="Permanently delete a.txt?"
        primaryAction={{
          label: "Delete",
          onClick: onDelete,
          destructive: true,
          irreversible: true,
        }}
        secondaryAction={{ label: "Cancel", onClick: onCancel }}
      />,
    );

    await act(async () => {});
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();
    // The default button is the one drawn in the accent, and the one Return presses.
    expect(cancel).toHaveClass("is-default");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("is-destructive");

    const dialog = screen.getByRole("dialog", { name: "Delete Immediately?" });
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onDelete).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("traps tab focus inside the dialog", async () => {
    render(
      <CopyPasteDialog
        title="Paste Result"
        message="Finished"
        secondaryAction={{ label: "Close", onClick: () => undefined }}
        primaryAction={{ label: "Retry Failed Items", onClick: () => undefined }}
      />,
    );

    const primaryButton = screen.getByRole("button", { name: "Retry Failed Items" });
    const secondaryButton = screen.getByRole("button", { name: "Close" });

    await act(async () => {});
    expect(primaryButton).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Paste Result" }), { key: "Tab" });
    expect(secondaryButton).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Paste Result" }), {
      key: "Tab",
      shiftKey: true,
    });
    expect(primaryButton).toHaveFocus();
  });

  it("activates the primary action when Enter is pressed on the dialog container", async () => {
    const onPrimaryAction = vi.fn();

    render(
      <CopyPasteDialog
        title="Paste Result"
        message="Finished"
        primaryAction={{ label: "Close", onClick: onPrimaryAction }}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Paste Result" });
    dialog.focus();
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(onPrimaryAction).toHaveBeenCalledTimes(1);
  });
});
