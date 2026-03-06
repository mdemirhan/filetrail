// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

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
});
