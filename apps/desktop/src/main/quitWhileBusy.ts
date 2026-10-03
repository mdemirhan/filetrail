import type { WriteOperationKind } from "./bootstrap/writeOperations";

// The buttons of the question asked when quitting during a copy, in order: the first is
// the default and what Escape picks.
export const QUIT_WHILE_BUSY_BUTTONS = ["Keep Working", "Stop and Quit"] as const;
export const KEEP_WORKING_BUTTON_INDEX = 0;
export const STOP_AND_QUIT_BUTTON_INDEX = 1;

// What to ask before quitting stops a running operation. A rename or a new folder is over
// in a moment, so quitting simply waits for it: there is nothing to ask.
export function describeQuitWhileBusy(
  kind: WriteOperationKind,
): { message: string; detail: string } | null {
  const stops = "If you quit now, it stops after the current item.";
  switch (kind) {
    case "copy":
      return {
        message: "A copy is still in progress.",
        detail: `${stops} Items already copied stay where they are.`,
      };
    case "move":
      return {
        message: "A move is still in progress.",
        detail: `${stops} Items already moved stay in their new place; the rest stay where they were.`,
      };
    case "trash":
      return {
        message: "Items are still being moved to the Trash.",
        detail: `${stops} Items already in the Trash stay there.`,
      };
    case "delete":
      return {
        message: "Items are still being deleted.",
        detail: `${stops} Items already deleted can't be recovered.`,
      };
    case "rename":
    case "new_folder":
      return null;
  }
}
