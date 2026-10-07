import type { WriteOperationKind } from "./bootstrap/writeOperations";

// What stops a running operation: quitting, or closing the last explorer window (the one
// it shows in; the app stays open).
export type StopTrigger = "quit" | "close";

// The buttons of the question, in order: the first is the default and what Escape picks.
export const KEEP_WORKING_BUTTON_INDEX = 0;
export const STOP_BUTTON_INDEX = 1;

export function stopQuestionButtons(trigger: StopTrigger): [string, string] {
  return ["Keep Working", trigger === "quit" ? "Stop and Quit" : "Stop and Close"];
}

// Clicking the Dock icon with no explorer window open opens one, as Finder does, even
// while Settings or Help is open; but not while quitting waits for an operation to stop:
// that window would be closed again moments later.
export function shouldOpenWindowOnActivate(state: {
  shutdownInProgress: boolean;
  explorerWindowCount: number;
}): boolean {
  return !state.shutdownInProgress && state.explorerWindowCount === 0;
}

// What to ask before quitting or closing the window stops a running operation. A rename or
// a new folder is over in a moment, so it is simply waited for: there is nothing to ask.
export function describeQuitWhileBusy(
  kind: WriteOperationKind,
  trigger: StopTrigger = "quit",
): { message: string; detail: string } | null {
  const stops =
    trigger === "quit"
      ? "If you quit now, it stops after the current item."
      : "If you close the window now, it stops after the current item.";
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
    case "undo":
      return {
        message: "An Undo is still in progress.",
        detail: `${stops} What was already undone stays undone.`,
      };
    case "rename":
    case "new_folder":
      return null;
  }
}
