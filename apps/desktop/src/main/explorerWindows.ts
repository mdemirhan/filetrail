// The open explorer windows, front to back. A window moves to the front when it gets the
// focus, so the first one is the one the person used last: where New Window takes its
// folder from, where the menu sends commands while Settings has the keyboard, and where a
// running operation goes when the window that started it closes.

export type ExplorerWindowEntry<W> = {
  // Kept between launches, with the window's tabs and place on screen.
  id: string;
  window: W;
  webContentsId: number;
  // The folder File Trail was launched with, given to the window in front at startup.
  launchFolderPath: string | null;
  // Opened while the app runs: it opens the tabs it was given, whatever the restore
  // setting says.
  restoreTabs: boolean;
  // A menu command the window runs once it has opened: a place in the Go menu chosen while
  // no window was open.
  initialCommand?: string | null;
};

export class ExplorerWindowList<W> {
  private entries: ExplorerWindowEntry<W>[] = [];

  /** Adds a window in front, or behind the others (windows brought back at startup). */
  add(entry: ExplorerWindowEntry<W>, place: "front" | "back" = "front"): void {
    const others = this.entries.filter((other) => other.id !== entry.id);
    this.entries = place === "front" ? [entry, ...others] : [...others, entry];
  }

  remove(id: string): void {
    this.entries = this.entries.filter((entry) => entry.id !== id);
  }

  /** Returns whether the order changed. */
  moveToFront(id: string): boolean {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (!entry || this.entries[0] === entry) {
      return false;
    }
    this.entries = [entry, ...this.entries.filter((other) => other !== entry)];
    return true;
  }

  front(): ExplorerWindowEntry<W> | null {
    return this.entries[0] ?? null;
  }

  byId(id: string): ExplorerWindowEntry<W> | null {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  byWebContentsId(webContentsId: number | null | undefined): ExplorerWindowEntry<W> | null {
    if (webContentsId === null || webContentsId === undefined) {
      return null;
    }
    return this.entries.find((entry) => entry.webContentsId === webContentsId) ?? null;
  }

  byWindow(window: W): ExplorerWindowEntry<W> | null {
    return this.entries.find((entry) => entry.window === window) ?? null;
  }

  /** Front to back. */
  all(): readonly ExplorerWindowEntry<W>[] {
    return this.entries;
  }

  get count(): number {
    return this.entries.length;
  }
}

export type WindowBounds = { x: number; y: number; width: number; height: number };

// How far a new window sits down and to the right of the one it comes from, as Finder's.
export const NEW_WINDOW_OFFSET = 22;

// Where a window opened from `from` goes: a step down and to the right of it, the same
// size. A window that would reach past the bottom or right of the screen's usable area
// starts again from its top left, as Finder's do.
export function placeNewWindow(from: WindowBounds, workArea: WindowBounds): WindowBounds {
  const width = Math.min(from.width, workArea.width);
  const height = Math.min(from.height, workArea.height);
  let x = from.x + NEW_WINDOW_OFFSET;
  let y = from.y + NEW_WINDOW_OFFSET;
  if (x + width > workArea.x + workArea.width || y + height > workArea.y + workArea.height) {
    x = workArea.x;
    y = workArea.y;
  }
  return { x, y, width, height };
}
