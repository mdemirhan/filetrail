import { describe, expect, it } from "vitest";

import {
  KEEP_WORKING_BUTTON_INDEX,
  QUIT_WHILE_BUSY_BUTTONS,
  STOP_AND_QUIT_BUTTON_INDEX,
  describeQuitWhileBusy,
} from "./quitWhileBusy";

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
    expect(QUIT_WHILE_BUSY_BUTTONS[KEEP_WORKING_BUTTON_INDEX]).toBe("Keep Working");
    expect(QUIT_WHILE_BUSY_BUTTONS[STOP_AND_QUIT_BUTTON_INDEX]).toBe("Stop and Quit");
  });
});
