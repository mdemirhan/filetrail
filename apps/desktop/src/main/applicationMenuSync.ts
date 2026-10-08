import type { Menu } from "electron";

import {
  type ApplicationMenuState,
  INITIAL_APPLICATION_MENU_STATE,
} from "../shared/applicationMenuState";
import {
  type ExplorerCommandTarget,
  applyApplicationMenuItemStates,
  resolveApplicationMenuItemStates,
  undoMenuLabels,
} from "./appMenu";
import type { ExplorerWindowList } from "./explorerWindows";

// What the application menu shows: the state of the explorer window it acts on (the
// focused one, or the one in front while another window has the keyboard), and what Undo
// and Redo would do. The menu is one for the whole app and is built by the host.

type MenuWindow = {
  readonly webContents: { send(channel: string, ...args: unknown[]): void };
  isDestroyed(): boolean;
};

export type UndoHistoryMenu = { undo: string | null; redo: string | null; cantUndo: boolean };

export class ApplicationMenuSync<W extends MenuWindow> {
  // What each explorer window last said the menu should show, by web contents.
  private readonly states = new Map<number, ApplicationMenuState>();
  // What the history says Undo and Redo would do.
  private undoHistory: UndoHistoryMenu = { undo: null, redo: null, cantUndo: false };
  // The words the menu was last built with.
  private builtUndoLabels = "";

  constructor(
    private readonly deps: {
      windows: Pick<ExplorerWindowList<W>, "front" | "byWindow" | "byWebContentsId" | "count">;
      // The window that has the keyboard, of any kind; null when the app has none.
      focusedWindow: () => unknown;
      // The menu as it is now, or none before it has been built.
      menu: () => Pick<Menu, "getMenuItemById"> | null;
      // Builds the menu again (its labels can't be changed in place), with `undoLabels`.
      build: () => void;
    },
  ) {}

  /** What an explorer window says the menu should show; other windows are not heard. */
  setWindowState(webContentsId: number | null, state: ApplicationMenuState): void {
    if (webContentsId === null || !this.deps.windows.byWebContentsId(webContentsId)) {
      return;
    }
    this.states.set(webContentsId, state);
    this.refresh();
  }

  /**
   * A window opened or closed: what a closed one said is let go of. With the last one
   * closed, Undo and Redo are no longer the files' and stop naming what they would do.
   */
  windowsChanged(): void {
    for (const webContentsId of [...this.states.keys()]) {
      if (!this.deps.windows.byWebContentsId(webContentsId)) {
        this.states.delete(webContentsId);
      }
    }
    this.refresh();
  }

  setUndoHistory(menu: UndoHistoryMenu): void {
    this.undoHistory = menu;
    this.refresh();
  }

  /** What Undo and Redo say, for the menu being built. */
  undoLabels(): { undo: string; redo: string } {
    const { state, explorerFocused } = this.currentExplorer();
    return undoMenuLabels(this.undoHistory, state.textEditing || !explorerFocused);
  }

  /** Called once the host has built and set the menu. */
  menuBuilt(): void {
    this.builtUndoLabels = JSON.stringify(this.undoLabels());
    this.sync();
  }

  // The explorer window a menu command goes to: the focused window when it is one, else
  // the one in front (while Settings has the keyboard, or no window has).
  explorerFor(focusedWindow: unknown): ExplorerCommandTarget | null {
    const focused = isLiveWindow(focusedWindow) ? focusedWindow : null;
    const focusedEntry = focused ? this.deps.windows.byWindow(focused as W) : null;
    if (focusedEntry) {
      return { contents: focusedEntry.window.webContents, focused: true };
    }
    const front = this.deps.windows.front();
    if (!front || front.window.isDestroyed()) {
      return null;
    }
    return { contents: front.window.webContents, focused: focused === null };
  }

  // A menu item's label can't be changed in place: the menu is built again when Undo or
  // Redo should say something else. Otherwise only what is on and off changes.
  refresh(): void {
    if (!this.deps.menu()) {
      return;
    }
    if (JSON.stringify(this.undoLabels()) !== this.builtUndoLabels) {
      this.deps.build();
      return;
    }
    this.sync();
  }

  // Dims, checks and shows the menu's items for the state the explorer window the menu
  // acts on last reported.
  sync(): void {
    const menu = this.deps.menu();
    if (!menu) {
      return;
    }
    const { state, explorerFocused, otherWindowFocused } = this.currentExplorer();
    applyApplicationMenuItemStates(
      menu,
      resolveApplicationMenuItemStates(state, {
        explorerFocused,
        otherWindowFocused,
        explorerWindowCount: this.deps.windows.count,
        undoAvailable: {
          undo: this.undoHistory.undo !== null,
          redo: this.undoHistory.redo !== null,
        },
      }),
    );
  }

  // The explorer window the menu shows, and whether it has the keyboard. With no window
  // focused (the app is in the background) the front window's state stays; with no
  // explorer window open there is none to show.
  private currentExplorer(): {
    state: ApplicationMenuState;
    explorerFocused: boolean;
    otherWindowFocused: boolean;
  } {
    const focusedWindow = this.deps.focusedWindow();
    const focused = isLiveWindow(focusedWindow) ? focusedWindow : null;
    const focusedEntry = focused ? this.deps.windows.byWindow(focused as W) : null;
    const entry = focusedEntry ?? this.deps.windows.front();
    return {
      state:
        (entry ? this.states.get(entry.webContentsId) : undefined) ??
        INITIAL_APPLICATION_MENU_STATE,
      explorerFocused: focusedEntry !== null || (focused === null && this.deps.windows.count > 0),
      otherWindowFocused: focused !== null && focusedEntry === null,
    };
  }
}

function isLiveWindow(value: unknown): value is { isDestroyed(): boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { isDestroyed?: unknown }).isDestroyed === "function" &&
    !(value as { isDestroyed(): boolean }).isDestroyed()
  );
}
