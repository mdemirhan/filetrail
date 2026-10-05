// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";

import { UndoQuestionAlert } from "./UndoQuestionAlert";

describe("UndoQuestionAlert", () => {
  it("stacks its buttons with the default on top and Cancel at the bottom", () => {
    render(
      <UndoQuestionAlert question="changed" names={["1.kt"]} direction="undo" onAnswer={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog", { name: "“1.kt” has been modified." });
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Move to Trash", "Skip", "Cancel"]);
    expect(dialog.querySelector(".alert-buttons")).toHaveClass("is-stacked");
    expect(within(dialog).getByRole("button", { name: "Move to Trash" })).toHaveFocus();
  });

  it("answers with each button, Return and Escape", () => {
    const onAnswer = vi.fn();
    render(
      <UndoQuestionAlert
        question="nameTaken"
        names={["a.txt"]}
        direction="redo"
        onAnswer={onAnswer}
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: "An item named “a.txt” is already where it would go back.",
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "Keep Both" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onAnswer.mock.calls).toEqual([["keep_both"], ["skip"], [null], [null]]);
  });

  it("lists the first names of several, and counts the rest", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    render(
      <UndoQuestionAlert question="changed" names={names} direction="redo" onAnswer={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog", { name: "7 items have been modified." });
    expect(
      within(dialog).getByText(
        "Redo would move them to the Trash. Skip leaves them where they are.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["a", "b", "c", "d", "e", "and 2 more"]);
  });

  it("asks about several taken names at once", () => {
    render(
      <UndoQuestionAlert
        question="nameTaken"
        names={["a", "b"]}
        direction="undo"
        onAnswer={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("dialog", {
        name: "2 items have names that other items have taken where they would go back.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Keep Both puts them back with a number added to their names. Skip leaves them where they are.",
      ),
    ).toBeInTheDocument();
  });
});
