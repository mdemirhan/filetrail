import {
  getRuntimeConflictChoices,
  getRuntimeConflictScope,
  isChoiceAllowedForConflict,
} from "./copyPasteChoices";

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

describe("runtime conflict choices", () => {
  it("offers only going ahead or skipping when nothing is at the destination any more", () => {
    expect(
      getRuntimeConflictChoices({
        reason: "destination_deleted",
        conflictClass: "directory_conflict",
        destinationExists: false,
      }),
    ).toEqual(["overwrite", "skip"]);
    expect(
      getRuntimeConflictChoices({ reason: "trash_unavailable", conflictClass: "file_conflict" }),
    ).toEqual(["overwrite", "skip"]);
  });

  it("scopes standing answers to the same kind of conflict", () => {
    const sourceChanged = getRuntimeConflictScope({
      reason: "source_changed",
      conflictClass: "file_conflict",
      destinationExists: false,
    });
    const destinationCreated = getRuntimeConflictScope({
      reason: "destination_created",
      conflictClass: "file_conflict",
    });
    const destinationChanged = getRuntimeConflictScope({
      reason: "destination_changed",
      conflictClass: "file_conflict",
    });
    expect(sourceChanged).not.toBe(destinationCreated);
    expect(destinationCreated).toBe(destinationChanged);
    expect(
      getRuntimeConflictScope({
        reason: "destination_created",
        conflictClass: "directory_conflict",
      }),
    ).not.toBe(destinationCreated);
  });
});
