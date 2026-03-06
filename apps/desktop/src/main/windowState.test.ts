import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readWindowState, resolveWindowStatePath, writeWindowState } from "./windowState";

describe("windowState", () => {
  it("returns defaults when no state file exists", () => {
    const statePath = resolveWindowStatePath(
      mkdtempSync(join(tmpdir(), "filetrail-window-state-")),
    );
    expect(readWindowState(statePath)).toEqual({
      width: 1480,
      height: 920,
      maximized: false,
    });
  });

  it("writes and restores saved bounds and maximized state", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "filetrail-window-state-"));
    const statePath = resolveWindowStatePath(userDataPath);
    writeWindowState(statePath, {
      x: 120,
      y: 140,
      width: 1600,
      height: 1000,
      maximized: true,
    });

    expect(readWindowState(statePath)).toEqual({
      x: 120,
      y: 140,
      width: 1600,
      height: 1000,
      maximized: true,
    });
  });
});
