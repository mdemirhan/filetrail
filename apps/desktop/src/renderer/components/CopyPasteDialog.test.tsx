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
