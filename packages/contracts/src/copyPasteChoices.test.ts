import { getRuntimeConflictChoices, isChoiceAllowedForConflict } from "./copyPasteChoices";

describe("copy/paste choices", () => {
  it("offers Merge only for two folders", () => {
    expect(isChoiceAllowedForConflict("directory_conflict", "merge")).toBe(true);
    expect(isChoiceAllowedForConflict("file_conflict", "merge")).toBe(false);
    expect(isChoiceAllowedForConflict("type_mismatch", "merge")).toBe(false);
    expect(isChoiceAllowedForConflict("file_conflict", "overwrite")).toBe(true);
  });

  it("offers only Skip when the source disappeared", () => {
    expect(
      getRuntimeConflictChoices({ reason: "source_deleted", conflictClass: "directory_conflict" }),
    ).toEqual(["skip"]);
    expect(
      getRuntimeConflictChoices({
        reason: "destination_created",
        conflictClass: "directory_conflict",
      }),
    ).toEqual(["overwrite", "merge", "keep_both", "skip"]);
    expect(
      getRuntimeConflictChoices({ reason: "destination_changed", conflictClass: "file_conflict" }),
    ).toEqual(["overwrite", "keep_both", "skip"]);
  });
});
