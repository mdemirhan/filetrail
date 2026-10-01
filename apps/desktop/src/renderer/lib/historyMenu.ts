import { getFavoriteLabel } from "./favorites";
import { abbreviatePlacePath } from "./places";

// The folders offered when Back or Forward is held: where each step in that direction
// leads, nearest first.

export type HistoryMenuEntry = {
  /** Position in the history list, to jump to. */
  index: number;
  path: string;
  /** The folder's name, as the sidebar would show it. */
  label: string;
  /** The folder that contains it, with the home folder as "~". */
  detail: string;
};

export const HISTORY_MENU_LIMIT = 12;

export function getBackHistoryEntries(
  historyPaths: readonly string[],
  historyIndex: number,
  homePath: string,
): HistoryMenuEntry[] {
  const entries: HistoryMenuEntry[] = [];
  for (let index = historyIndex - 1; index >= 0 && entries.length < HISTORY_MENU_LIMIT; index--) {
    entries.push(toEntry(historyPaths[index] ?? "", index, homePath));
  }
  return entries;
}

export function getForwardHistoryEntries(
  historyPaths: readonly string[],
  historyIndex: number,
  homePath: string,
): HistoryMenuEntry[] {
  const entries: HistoryMenuEntry[] = [];
  for (
    let index = Math.max(0, historyIndex + 1);
    index < historyPaths.length && entries.length < HISTORY_MENU_LIMIT;
    index++
  ) {
    entries.push(toEntry(historyPaths[index] ?? "", index, homePath));
  }
  return entries;
}

function toEntry(path: string, index: number, homePath: string): HistoryMenuEntry {
  const parentPath = path.slice(0, Math.max(1, path.lastIndexOf("/")));
  return {
    index,
    path,
    label: getFavoriteLabel(path, homePath),
    detail: path === "/" ? "" : abbreviatePlacePath(parentPath, homePath),
  };
}
