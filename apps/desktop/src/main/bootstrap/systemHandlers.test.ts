import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  shell: {},
}));

import { emptyTrash } from "./systemHandlers";

describe("emptyTrash", () => {
  // AppleScript stops waiting for Finder after two minutes, which a large Trash takes
  // longer than; File Trail then said it failed while Finder went on emptying.
  it("asks Finder with a wait of a day, not AppleScript's two minutes", async () => {
    const run = vi.fn(async () => undefined);

    await expect(emptyTrash(run)).resolves.toEqual({ ok: true, error: null });
    expect(run).toHaveBeenCalledWith("osascript", [
      "-e",
      "with timeout of 86400 seconds",
      "-e",
      'tell application "Finder" to empty trash',
      "-e",
      "end timeout",
    ]);
  });

  it("reports osascript's own error line, not the command that ran", async () => {
    const run = vi.fn(async () => {
      throw Object.assign(new Error("Command failed: osascript -e with timeout …"), {
        stderr: "0:46: execution error: Not authorized to send Apple events to Finder. (-1743)\n",
      });
    });

    await expect(emptyTrash(run)).resolves.toEqual({
      ok: false,
      error: "0:46: execution error: Not authorized to send Apple events to Finder. (-1743)",
    });
  });
});
