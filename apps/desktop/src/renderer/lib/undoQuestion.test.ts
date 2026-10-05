import { describeUndoQuestion } from "./undoQuestion";

const item = (name: string, kind: "made" | "putBack" | "replaced" = "made") => ({
  name,
  putBack: kind === "putBack",
  replaced: kind === "replaced",
});

describe("describeUndoQuestion", () => {
  it("names the operation an item that changed came from", () => {
    const changed = (items: ReturnType<typeof item>[]) => ({ kind: "changed" as const, items });
    const cases = [
      [changed([item("1 copy.kt")]), "undo", "duplicate"],
      [changed([item("a"), item("b")]), "undo", "duplicate"],
      [changed([item("a.txt")]), "undo", "copy_to"],
      [changed([item("a"), item("b")]), "undo", "paste"],
      [changed([item("untitled folder")]), "undo", "new_folder"],
      [changed([item("a.txt", "replaced")]), "undo", "paste"],
      [changed([item("a", "replaced"), item("b", "replaced")]), "undo", "paste"],
      [changed([item("a.txt", "putBack")]), "redo", "trash"],
      [changed([item("a", "putBack"), item("b", "putBack")]), "undo", "copy_to"],
      [changed([item("a"), item("b", "replaced")]), "undo", "paste"],
      [changed([item("a.txt")]), "redo", "rename"],
    ] as const;

    expect(
      cases.map(([question, direction, action]) => {
        const text = describeUndoQuestion(question, direction, action);
        return `${text.title} | ${text.message}`;
      }),
    ).toEqual([
      "“1 copy.kt” was changed after it was duplicated. | Undoing the duplicate moves this copy to the Trash, along with your changes. The original isn’t affected.",
      "2 copies were changed after they were duplicated. | Undoing the duplicate moves these copies to the Trash, along with your changes. The originals aren’t affected.",
      "“a.txt” was changed after it was copied. | Undoing the copy moves it to the Trash, along with your changes. The original isn’t affected.",
      "2 copies were changed after they were copied. | Undoing the copy moves them to the Trash, along with your changes. The originals aren’t affected.",
      "“untitled folder” isn’t empty anymore. | Undoing New Folder moves it to the Trash, along with what you put in it.",
      "“a.txt” was changed after it replaced the old one. | Undoing moves it to the Trash, along with your changes, and puts the old “a.txt” back.",
      "2 items were changed after they replaced the old ones. | Undoing moves them to the Trash, along with your changes, and puts the old ones back.",
      "“a.txt” was changed after it was put back. | Redo moves it to the Trash again, along with your changes.",
      "2 items were changed after they were put back. | Undo moves them to the Trash again, along with your changes.",
      "2 items were changed after this was done. | Undo moves them to the Trash, along with your changes.",
      "“a.txt” was changed after this was done. | Redo moves it to the Trash, along with your changes.",
    ]);
  });

  it("never goes ahead with changed work by default, and keeps both names by default", () => {
    expect(
      describeUndoQuestion({ kind: "changed", items: [item("a")] }, "undo", "duplicate"),
    ).toMatchObject({ confirmLabel: "Move to Trash", confirmIsDefault: false });
    expect(describeUndoQuestion({ kind: "nameTaken", names: ["a", "b"] }, "undo", "trash")).toEqual(
      {
        title: "2 items have names that other items have taken where they would go back.",
        message: "Undo puts them back with a number added to their names.",
        confirmLabel: "Keep Both",
        confirmIsDefault: true,
      },
    );
  });
});
