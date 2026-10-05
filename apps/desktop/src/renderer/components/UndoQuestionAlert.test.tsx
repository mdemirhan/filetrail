// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import { UndoQuestionAlert } from "./UndoQuestionAlert";

const changedCopy = {
  kind: "changed" as const,
  items: [{ name: "1 copy.kt", putBack: false, replaced: false }],
};

describe("UndoQuestionAlert", () => {
  it("asks before moving changed work to the Trash, with Cancel the default", () => {
    const onAnswer = vi.fn();
    render(
      <UndoQuestionAlert
        question={changedCopy}
        direction="undo"
        action="duplicate"
        onAnswer={onAnswer}
      />,
    );

    const dialog = screen.getByRole("dialog", {
      name: "“1 copy.kt” was changed after it was duplicated.",
    });
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Move to Trash", "Cancel"]);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
    expect(onAnswer.mock.calls).toEqual([[false], [true]]);
  });

  it("asks about a name taken with Keep Both the default", () => {
    const onAnswer = vi.fn();
    render(
      <UndoQuestionAlert
        question={{ kind: "nameTaken", names: ["a.txt"] }}
        direction="redo"
        action="trash"
        onAnswer={onAnswer}
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: "An item named “a.txt” is already where it would go back.",
    });

    expect(within(dialog).getByRole("button", { name: "Keep Both" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onAnswer.mock.calls).toEqual([[true], [false], [false]]);
  });

  it("lists the first names of several, and counts the rest", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    render(
      <UndoQuestionAlert
        question={{ kind: "nameTaken", names }}
        direction="undo"
        action="trash"
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "and 2 more",
    ]);
  });
});
