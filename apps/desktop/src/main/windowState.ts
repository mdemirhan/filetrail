import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type StoredWindowState = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
};

const DEFAULT_WINDOW_STATE: StoredWindowState = {
  width: 1480,
  height: 920,
  maximized: false,
};

export function resolveWindowStatePath(userDataPath: string): string {
  return join(userDataPath, "window-state.json");
}

export function readWindowState(statePath: string): StoredWindowState {
  if (!existsSync(statePath)) {
    return DEFAULT_WINDOW_STATE;
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<StoredWindowState>;
    return {
      width: typeof parsed.width === "number" ? parsed.width : DEFAULT_WINDOW_STATE.width,
      height: typeof parsed.height === "number" ? parsed.height : DEFAULT_WINDOW_STATE.height,
      maximized: parsed.maximized === true,
      ...(typeof parsed.x === "number" ? { x: parsed.x } : {}),
      ...(typeof parsed.y === "number" ? { y: parsed.y } : {}),
    };
  } catch {
    return DEFAULT_WINDOW_STATE;
  }
}

export function writeWindowState(statePath: string, state: StoredWindowState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}
