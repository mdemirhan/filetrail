import type { WriteOperationAction } from "@filetrail/contracts";

// What an Undo (or Redo) asks before it starts. Each question is all or nothing: the Undo
// goes ahead as a whole, or nothing happens, so it is never left half done by an answer.
export type UndoQuestion =
  // Items whose old names other items have taken since: they go back with a number.
  | { kind: "nameTaken"; names: string[] }
  // Items that changed since and would go to the Trash.
  | {
      kind: "changed";
      items: Array<{ name: string; putBack: boolean; replaced: boolean }>;
    };

export type UndoQuestionText = {
  title: string;
  message: string;
  // The button that goes ahead.
  confirmLabel: string;
  // Whether going ahead is the default (Return). Moving changed work to the Trash isn't:
  // a reflex Return then leaves everything as it is.
  confirmIsDefault: boolean;
};

// The question in the words of what it undoes: "“1 copy.kt” was changed after it was
// duplicated", rather than only "changed since".
export function describeUndoQuestion(
  question: UndoQuestion,
  direction: "undo" | "redo",
  action: WriteOperationAction | null,
): UndoQuestionText {
  const verb = direction === "undo" ? "Undo" : "Redo";
  if (question.kind === "nameTaken") {
    const one = question.names.length === 1 ? question.names[0] : null;
    return {
      title:
        one !== null
          ? `An item named “${one}” is already where it would go back.`
          : `${question.names.length} items have names that other items have taken where they would go back.`,
      message:
        one !== null
          ? `${verb} puts it back with a number added to its name.`
          : `${verb} puts them back with a number added to their names.`,
      confirmLabel: "Keep Both",
      confirmIsDefault: true,
    };
  }
  const { items } = question;
  const one = items.length === 1 ? (items[0]?.name ?? null) : null;
  const count = items.length;
  const text = (title: string, message: string): UndoQuestionText => ({
    title,
    message,
    confirmLabel: "Move to Trash",
    confirmIsDefault: false,
  });
  if (items.every((item) => item.putBack)) {
    return one !== null
      ? text(
          `“${one}” was changed after it was put back.`,
          `${verb} moves it to the Trash again, along with your changes.`,
        )
      : text(
          `${count} items were changed after they were put back.`,
          `${verb} moves them to the Trash again, along with your changes.`,
        );
  }
  if (items.every((item) => item.replaced)) {
    return one !== null
      ? text(
          `“${one}” was changed after it replaced the old one.`,
          `Undoing moves it to the Trash, along with your changes, and puts the old “${one}” back.`,
        )
      : text(
          `${count} items were changed after they replaced the old ones.`,
          "Undoing moves them to the Trash, along with your changes, and puts the old ones back.",
        );
  }
  const made = items.every((item) => !item.putBack && !item.replaced);
  if (made && action === "duplicate") {
    return one !== null
      ? text(
          `“${one}” was changed after it was duplicated.`,
          "Undoing the duplicate moves this copy to the Trash, along with your changes. The original isn’t affected.",
        )
      : text(
          `${count} copies were changed after they were duplicated.`,
          "Undoing the duplicate moves these copies to the Trash, along with your changes. The originals aren’t affected.",
        );
  }
  if (made && (action === "copy_to" || action === "paste")) {
    return one !== null
      ? text(
          `“${one}” was changed after it was copied.`,
          "Undoing the copy moves it to the Trash, along with your changes. The original isn’t affected.",
        )
      : text(
          `${count} copies were changed after they were copied.`,
          "Undoing the copy moves them to the Trash, along with your changes. The originals aren’t affected.",
        );
  }
  if (made && action === "new_folder" && one !== null) {
    return text(
      `“${one}” isn’t empty anymore.`,
      "Undoing New Folder moves it to the Trash, along with what you put in it.",
    );
  }
  return one !== null
    ? text(
        `“${one}” was changed after this was done.`,
        `${verb} moves it to the Trash, along with your changes.`,
      )
    : text(
        `${count} items were changed after this was done.`,
        `${verb} moves them to the Trash, along with your changes.`,
      );
}
