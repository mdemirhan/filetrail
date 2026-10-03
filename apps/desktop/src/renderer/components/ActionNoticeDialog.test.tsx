// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { ActionNoticeDialog } from "./ActionNoticeDialog";

describe("ActionNoticeDialog", () => {
  it("focuses the confirmation button on mount", async () => {
    render(<ActionNoticeDialog title="Notice" message="Saved" onClose={() => undefined} />);

    await act(async () => {});
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
  });

  it("closes from its button, not from a click outside it, as a macOS alert does", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ActionNoticeDialog title="Notice" message="Saved" onClose={onClose} />,
    );

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Notice" }));
    const scrim = container.querySelector(".modal-scrim");
    if (!scrim) {
      throw new Error("Expected the alert's scrim");
    }
    fireEvent.mouseDown(scrim);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
