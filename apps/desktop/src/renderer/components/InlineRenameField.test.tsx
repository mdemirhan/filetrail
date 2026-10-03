// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";

import { InlineRenameField } from "./InlineRenameField";

function renderField(overrides: Partial<Parameters<typeof InlineRenameField>[0]> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  const props = {
    name: "report.final.pdf",
    extension: "pdf",
    error: null as string | null,
    refusalCount: 0,
    onSubmit,
    onCancel,
    ...overrides,
  };
  const view = render(<InlineRenameField {...props} />);
  const input = screen.getByRole("textbox", { name: `Rename ${props.name}` }) as HTMLInputElement;
  return {
    input,
    onSubmit,
    onCancel,
    rerender: (next: Partial<typeof props>) =>
      view.rerender(<InlineRenameField {...props} {...next} />),
  };
}

describe("InlineRenameField", () => {
  it("takes the focus and selects the name without its extension", () => {
    const { input } = renderField();

    expect(input).toHaveFocus();
    expect(input.value).toBe("report.final.pdf");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "report.final".length]);
  });

  it("selects the whole name of a folder", () => {
    const { input } = renderField({ name: "Projects", extension: "" });

    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Projects".length]);
  });

  it("submits the new name on Return, once", () => {
    const { input, onSubmit, onCancel } = renderField();

    fireEvent.change(input, { target: { value: "summary.pdf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The field loses the focus as the rename goes through; that must not submit again.
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("summary.pdf");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("submits a changed name when the field loses the focus", () => {
    const { input, onSubmit } = renderField();

    fireEvent.change(input, { target: { value: "summary.pdf" } });
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledWith("summary.pdf");
  });

  it("cancels on Escape, and when the name is unchanged or emptied", () => {
    const escaped = renderField();
    fireEvent.change(escaped.input, { target: { value: "summary.pdf" } });
    fireEvent.keyDown(escaped.input, { key: "Escape" });
    fireEvent.blur(escaped.input);
    expect(escaped.onCancel).toHaveBeenCalledTimes(1);
    expect(escaped.onSubmit).not.toHaveBeenCalled();

    const unchanged = renderField({ name: "notes.txt", extension: "txt" });
    fireEvent.keyDown(unchanged.input, { key: "Enter" });
    expect(unchanged.onCancel).toHaveBeenCalledTimes(1);
    expect(unchanged.onSubmit).not.toHaveBeenCalled();

    const emptied = renderField({ name: "todo.md", extension: "md" });
    fireEvent.change(emptied.input, { target: { value: "   " } });
    fireEvent.blur(emptied.input);
    expect(emptied.onCancel).toHaveBeenCalledTimes(1);
    expect(emptied.onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the field open on a refused name and does not send that name again", () => {
    const { input, onSubmit, onCancel, rerender } = renderField();

    fireEvent.change(input, { target: { value: "taken.pdf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    rerender({ error: "An item named “taken.pdf” already exists." });

    expect(screen.getByRole("alert")).toHaveTextContent("already exists");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveFocus();

    // Return again without a change keeps the field open and sends nothing.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    // An edited name is sent.
    fireEvent.change(input, { target: { value: "free.pdf" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith("free.pdf");
  });

  it("answers again after a second refusal that reads the same as the first", () => {
    const { input, onSubmit, onCancel, rerender } = renderField();
    const reason = "A name can't contain “/”.";

    fireEvent.change(input, { target: { value: "a/b.pdf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    rerender({ error: reason, refusalCount: 1 });

    // Another name, refused for the same reason.
    fireEvent.change(input, { target: { value: "c/d.pdf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith("c/d.pdf");
    rerender({ error: reason, refusalCount: 2 });
    expect(screen.getByRole("alert")).toHaveTextContent(reason);

    // The field still takes a fixed name, and Return is not swallowed.
    fireEvent.change(input, { target: { value: "fine.pdf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(3);
    expect(onSubmit).toHaveBeenLastCalledWith("fine.pdf");

    // And leaving it after the second refusal gives up rather than doing nothing.
    rerender({ error: reason, refusalCount: 3 });
    fireEvent.blur(input);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("gives up when the field with a refused name loses the focus", () => {
    const { input, onSubmit, onCancel, rerender } = renderField();

    fireEvent.change(input, { target: { value: "taken.pdf" } });
    fireEvent.keyDown(input, { key: "Enter" });
    rerender({ error: "An item named “taken.pdf” already exists." });
    fireEvent.blur(input);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps clicks and key presses away from the row underneath", () => {
    const onRowClick = vi.fn();
    const onRowPointerDown = vi.fn();
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: stands in for a list row in this test.
      <div onClick={onRowClick} onPointerDown={onRowPointerDown}>
        <InlineRenameField
          name="a.txt"
          extension="txt"
          error={null}
          onSubmit={() => undefined}
          onCancel={() => undefined}
        />
      </div>,
    );
    const input = screen.getByRole("textbox", { name: "Rename a.txt" });

    fireEvent.pointerDown(input);
    fireEvent.click(input);

    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowPointerDown).not.toHaveBeenCalled();
  });

  // The core reports "Photos 2026.10" as having the extension "10"; a folder has none.
  it("selects the whole name of a folder with dots in it", () => {
    const { input } = renderField({
      name: "Photos 2026.10.03",
      extension: "03",
      isFolder: true,
    });

    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "Photos 2026.10.03".length]);
  });

  // Return confirms the converted text, Escape cancels the conversion: neither is about
  // the rename while Japanese, Chinese or Korean text is being composed.
  it("leaves Return and Escape to text being composed", () => {
    const { input, onSubmit, onCancel } = renderField();
    fireEvent.change(input, { target: { value: "にほん.pdf" } });

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Escape", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("にほん.pdf");
  });
});
