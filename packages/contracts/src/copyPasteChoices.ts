export type CopyPasteChoice = "overwrite" | "merge" | "keep_both" | "skip";
type ConflictClass = "file_conflict" | "directory_conflict" | "type_mismatch";
type RuntimeConflictReason =
  | "destination_changed"
  | "destination_created"
  | "destination_deleted"
  | "source_changed"
  | "source_deleted";

// The choices that make sense for a conflict of this kind ("merge" needs two folders).
export function isChoiceAllowedForConflict(
  conflictClass: ConflictClass,
  choice: CopyPasteChoice,
): boolean {
  return choice !== "merge" || conflictClass === "directory_conflict";
}

// The answers offered when something changed during an operation. A missing source can
// only be skipped.
export function getRuntimeConflictChoices(conflict: {
  reason: RuntimeConflictReason;
  conflictClass: ConflictClass;
}): CopyPasteChoice[] {
  if (conflict.reason === "source_deleted") {
    return ["skip"];
  }
  return conflict.conflictClass === "directory_conflict"
    ? ["overwrite", "merge", "keep_both", "skip"]
    : ["overwrite", "keep_both", "skip"];
}
