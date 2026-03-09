// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";

import { ActionNoticeDialog } from "./ActionNoticeDialog";

describe("ActionNoticeDialog", () => {
  it("focuses the confirmation button on mount", async () => {
    render(<ActionNoticeDialog title="Notice" message="Saved" onClose={() => undefined} />);

    await act(async () => {});
    expect(screen.getByRole("button", { name: "OK" })).toHaveFocus();
  });

  it("closes from the backdrop and action button, but not from dialog clicks", () => {
    const onClose = vi.fn();
    render(<ActionNoticeDialog title="Notice" message="Saved" onClose={onClose} />);

    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Notice" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
