import { describe, expect, it } from "vitest";

import {
  KEEP_WORKING_BUTTON_INDEX,
  STOP_BUTTON_INDEX,
  describeQuitWhileBusy,
  shouldOpenWindowOnActivate,
  stopQuestionButtons,
} from "./quitWhileBusy";

describe("shouldOpenWindowOnActivate", () => {
  it("opens a window from the Dock when none is open", () => {
    expect(shouldOpenWindowOnActivate({ shutdownInProgress: false, openWindowCount: 0 })).toBe(
      true,
    );
    expect(shouldOpenWindowOnActivate({ shutdownInProgress: false, openWindowCount: 1 })).toBe(
      false,
    );
  });

  // After "Stop and Close" the app waits for the operation to stop, then quits.
  it("doesn't open one while quitting waits for an operation to stop", () => {
    expect(shouldOpenWindowOnActivate({ shutdownInProgress: true, openWindowCount: 0 })).toBe(
      false,
    );
  });
});

describe("describeQuitWhileBusy", () => {
  it("asks about a copy, a move, a Trash, and a delete in their own words", () => {
    expect(describeQuitWhileBusy("copy")).toEqual({
      message: "A copy is still in progress.",
      detail:
        "If you quit now, it stops after the current item. Items already copied stay where they are.",
    });
    expect(describeQuitWhileBusy("move")?.message).toBe("A move is still in progress.");
    expect(describeQuitWhileBusy("trash")?.message).toBe(
      "Items are still being moved to the Trash.",
    );
    expect(describeQuitWhileBusy("delete")?.detail).toContain("can't be recovered");
  });

  it("doesn't ask about a rename or a new folder, which are over in a moment", () => {
    expect(describeQuitWhileBusy("rename")).toBeNull();
    expect(describeQuitWhileBusy("new_folder")).toBeNull();
  });

  it("makes Keep Working the default and Stop and Quit the second button", () => {
    expect(stopQuestionButtons("quit")[KEEP_WORKING_BUTTON_INDEX]).toBe("Keep Working");
    expect(stopQuestionButtons("quit")[STOP_BUTTON_INDEX]).toBe("Stop and Quit");
  });

  it("asks in its own words when the window is being closed", () => {
    expect(stopQuestionButtons("close")).toEqual(["Keep Working", "Stop and Close"]);
    expect(describeQuitWhileBusy("copy", "close")).toEqual({
      message: "A copy is still in progress.",
      detail:
        "If you close the window now, it stops after the current item and File Trail quits. Items already copied stay where they are.",
    });
    expect(describeQuitWhileBusy("rename", "close")).toBeNull();
  });
});
