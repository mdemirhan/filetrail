export type CopyPasteChoice = "overwrite" | "merge" | "keep_both" | "skip";
type ConflictClass = "file_conflict" | "directory_conflict" | "type_mismatch";
type RuntimeConflictReason =
  | "destination_changed"
  | "destination_created"
  | "destination_deleted"
  | "source_changed"
  | "source_deleted"
  | "trash_unavailable";

// The choices that make sense for a conflict of this kind ("merge" needs two folders).
export function isChoiceAllowedForConflict(
  conflictClass: ConflictClass,
  choice: CopyPasteChoice,
): boolean {
  return choice !== "merge" || conflictClass === "directory_conflict";
}

// What the paste does with a conflict: the item's own choice from the review, when it made
// one that fits, or else the choice for all conflicts of its kind. Replace can't take an item
// that isn't replaceable (the folder holding what is pasted, or another item being pasted):
// that item gets the safe choice instead, Merge for a folder and Keep Both otherwise. The
// review sheet and the paste both decide here, so the sheet says what the paste will do.
export function choiceForConflict(
  node: { conflictClass: ConflictClass; replaceBlockedReason: string | null },
  policy: { file: CopyPasteChoice; directory: CopyPasteChoice; mismatch: CopyPasteChoice },
  override: CopyPasteChoice | undefined,
): CopyPasteChoice {
  const choice =
    override !== undefined && isChoiceAllowedForConflict(node.conflictClass, override)
      ? override
      : node.conflictClass === "directory_conflict"
        ? policy.directory
        : node.conflictClass === "type_mismatch"
          ? policy.mismatch
          : policy.file;
  if (choice === "overwrite" && node.replaceBlockedReason !== null) {
    return node.conflictClass === "directory_conflict" ? "merge" : "keep_both";
  }
  return choice;
}

// The answers offered when something changed during an operation.
// - A missing source can only be skipped.
// - With nothing at the destination any more, there is nothing to keep or merge with:
//   the item can go ahead ("overwrite" just writes it) or be skipped.
// - When the Trash is unavailable, "overwrite" means deleting the existing item permanently.
export function getRuntimeConflictChoices(conflict: {
  reason: RuntimeConflictReason;
  conflictClass: ConflictClass;
  destinationExists?: boolean;
}): CopyPasteChoice[] {
  if (conflict.reason === "source_deleted") {
    return ["skip"];
  }
  if (conflict.reason === "trash_unavailable" || conflict.destinationExists === false) {
    return ["overwrite", "skip"];
  }
  return conflict.conflictClass === "directory_conflict"
    ? ["overwrite", "merge", "keep_both", "skip"]
    : ["overwrite", "keep_both", "skip"];
}

// "Do the same for any other changes" only carries over to conflicts of the same kind: an
// answer about a changed source says nothing about a file someone else put at the
// destination, and a folder answer says nothing about a file.
export function getRuntimeConflictScope(conflict: {
  reason: RuntimeConflictReason;
  conflictClass: ConflictClass;
  destinationExists?: boolean;
}): string {
  if (conflict.reason === "trash_unavailable") {
    return "trash_unavailable";
  }
  const side = conflict.reason.startsWith("source_") ? "source" : "destination";
  const destination = conflict.destinationExists === false ? "missing" : conflict.conflictClass;
  return `${side}:${destination}`;
}
