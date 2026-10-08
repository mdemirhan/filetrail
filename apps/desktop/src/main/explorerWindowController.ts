import { OPEN_TABS_LIMIT, type OpenTabPreference } from "../shared/appPreferences";
import type { RendererCommandType } from "../shared/rendererCommands";
import {
  type AppStateStore,
  DEFAULT_WINDOW_STATE,
  type StoredExplorerWindow,
  type StoredWindowState,
  pickWindowSession,
} from "./appStateStore";
import type { WriteOperationKind } from "./bootstrap/writeOperations";
import {
  type ExplorerWindowEntry,
  ExplorerWindowList,
  type WindowBounds,
  placeNewWindow,
} from "./explorerWindows";
import {
  KEEP_WORKING_BUTTON_INDEX,
  STOP_BUTTON_INDEX,
  type StopTrigger,
  describeQuitWhileBusy,
  shouldOpenWindowOnActivate,
  stopQuestionButtons,
} from "./quitWhileBusy";

// The explorer windows' lives: opening them (at startup, from another window, with none
// open), what they remember of themselves, the question before closing the last one while
// an operation runs, Merge All Windows, and quitting. The windows themselves are made by
// the host, so all of this runs on stand-ins in the tests.

// The parts of a BrowserWindow this uses.
export type ExplorerWindowLike = {
  readonly webContents: {
    readonly id: number;
    send(channel: string, ...args: unknown[]): void;
  };
  isDestroyed(): boolean;
  close(): void;
  show(): void;
  showInactive(): void;
  focus(): void;
  isMinimized(): boolean;
  restore(): void;
  maximize(): void;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  getBounds(): WindowBounds;
  getNormalBounds(): WindowBounds;
  on(event: "close", listener: (event: { preventDefault(): void }) => void): unknown;
  on(
    event: "closed" | "focus" | "move" | "resize" | "maximize" | "unmaximize",
    listener: () => void,
  ): unknown;
  once(event: "ready-to-show", listener: () => void): unknown;
};

// What the controller keeps in the app state store.
export type ExplorerWindowStore = Pick<
  AppStateStore,
  | "getPreferences"
  | "getExplorerWindows"
  | "getWindowPreferences"
  | "getLastClosedWindow"
  | "createWindowSession"
  | "addExplorerWindow"
  | "removeExplorerWindow"
  | "setExplorerWindowOrder"
  | "rememberClosedWindow"
  | "setExplorerWindowBounds"
  | "flush"
>;

// The question asked before closing the last window or quitting stops an operation.
export type StopQuestion = {
  message: string;
  detail: string;
  buttons: [string, string];
  defaultId: number;
  cancelId: number;
};

export type ExplorerWindowHost<W extends ExplorerWindowLike> = {
  store: ExplorerWindowStore;
  // Makes a window for the record, hidden, and starts loading its page.
  createWindow: (record: StoredExplorerWindow) => W;
  // A new id for a window, kept between launches.
  newWindowId: () => string;
  // The usable area of the screen a window at `bounds` is on.
  workAreaFor: (bounds: WindowBounds) => WindowBounds;
  // The copy, move or delete running now, if any.
  activeOperation: () => { kind: WriteOperationKind } | null;
  // Shows the question, on `parent` when there is one; resolves with the button chosen.
  showStopQuestion: (question: StopQuestion, parent: W | null) => Promise<number>;
  // Asks the window for its tabs as they are now; null when it doesn't answer.
  requestTabs: (window: W) => Promise<{ tabs: OpenTabPreference[]; busy: boolean } | null>;
  // Whether any window of the app is open, explorer or not (Settings, Help, About).
  anyWindowOpen: () => boolean;
  // Something the menu shows changed: which windows are open, or which is in front.
  windowsChanged: () => void;
  // Stops the main process's work (waiting for a running operation to stop), then the
  // app ends with `exit`.
  shutDown: () => Promise<void>;
  exit: () => void;
  logger: { info: (message: string, details?: unknown) => void };
};

// How long the place and size of a window that moves wait before they are recorded.
export const WINDOW_BOUNDS_SAVE_DELAY_MS = 160;
// How long startup waits for a window's page before showing the windows anyway.
export const STARTUP_SHOW_TIMEOUT_MS = 5_000;

type OpenOptions = {
  launchFolderPath: string | null;
  restoreTabs: boolean;
  // "front": opened while the app runs, and shown as soon as it is ready. "back": one of
  // the windows the app opens with, shown by openStartupWindows.
  place: "front" | "back";
  // A menu command the window runs once it has opened.
  initialCommand?: RendererCommandType;
};

export class ExplorerWindowController<W extends ExplorerWindowLike> {
  // The explorer windows, front to back.
  private readonly list = new ExplorerWindowList<W>();
  // Records each window's size and position in the store, by window id.
  private readonly boundsRecorders = new Map<string, () => void>();
  // Windows that close without asking first: the person agreed to stop the running
  // operation, or their tabs were merged into another window.
  private readonly closingWithoutAsking = new WeakSet<W>();
  // Windows closed by Merge All Windows: not remembered as the window closed last.
  private readonly merged = new WeakSet<W>();
  // Windows whose close went ahead, on their way out until "closed": two windows closed in
  // the same moment (Close All) aren't open for each other.
  private readonly closing = new WeakSet<W>();
  private shuttingDown = false;
  // True while the "a copy is still in progress" question is on screen.
  private stopQuestionOpen = false;

  constructor(private readonly host: ExplorerWindowHost<W>) {}

  /** The open explorer windows, front to back. */
  get windows(): Pick<
    ExplorerWindowList<W>,
    "front" | "byId" | "byWebContentsId" | "byWindow" | "all" | "count"
  > {
    return this.list;
  }

  get shutdownInProgress(): boolean {
    return this.shuttingDown;
  }

  /** The window in front, if one is open and not closing. */
  frontWindow(): W | null {
    return this.openWindows()[0]?.window ?? null;
  }

  /** The id of the explorer window a web contents belongs to; null for other windows. */
  windowIdOf(webContentsId: number | null): string | null {
    return this.list.byWebContentsId(webContentsId)?.id ?? null;
  }

  // The windows the app opens with: every window that was open when it quit, front one in
  // front, when the last folders and tabs are reopened; otherwise one window. The folder
  // the app was launched with goes to the window in front.
  openStartupWindows(startupFolderPath: string | null): void {
    const store = this.host.store;
    const stored = store.getExplorerWindows();
    const records = store.getPreferences().restoreSessionOnStartup
      ? [...stored]
      : stored.slice(0, 1);
    // Windows not brought back now aren't brought back later either.
    for (const dropped of stored.slice(records.length)) {
      store.removeExplorerWindow(dropped.id);
    }
    // No window was open at quit: one, as a window opened with none open starts.
    if (records.length === 0) {
      const record = this.recordFromLastClosed();
      store.addExplorerWindow(record);
      records.push(record);
    }
    const opened = records.map((record, index) => {
      const window = this.open(record, {
        launchFolderPath: index === 0 ? startupFolderPath : null,
        restoreTabs: false,
        place: "back",
      });
      return {
        window,
        maximized: record.bounds.maximized,
        ready: new Promise<void>((resolve) => {
          window.once("ready-to-show", () => resolve());
          // A window whose page never gets ready isn't waited for.
          setTimeout(resolve, STARTUP_SHOW_TIMEOUT_MS);
        }),
      };
    });
    // Shown back to front once all are ready, so they stack as they were.
    void Promise.all(opened.map((entry) => entry.ready)).then(() => {
      for (const [index, entry] of [...opened.entries()].reverse()) {
        if (entry.window.isDestroyed()) {
          continue;
        }
        if (entry.maximized) {
          entry.window.maximize();
        }
        if (index === 0) {
          entry.window.show();
        } else {
          entry.window.showInactive();
        }
      }
    });
  }

  // A window opened with none open (the Dock icon, New Window, the second launch): it
  // starts where the window closed last was. `initialCommand` is run once it has opened (a
  // place in the Go menu, chosen with no window open).
  openDefaultWindow(initialCommand?: RendererCommandType): void {
    // Not while quitting: the window would close again moments later.
    if (this.shuttingDown) {
      return;
    }
    const record = this.recordFromLastClosed();
    this.host.store.addExplorerWindow(record);
    this.open(record, {
      launchFolderPath: null,
      restoreTabs: record.session.openTabs.length > 0,
      place: "front",
      ...(initialCommand ? { initialCommand } : {}),
    });
  }

  // New Window from the Dock menu: the window in front opens it on its folder, as ⌘N does.
  openNewWindowFromFront(): void {
    if (this.shuttingDown) {
      return;
    }
    const front = this.frontWindow();
    if (!front) {
      this.openDefaultWindow();
      return;
    }
    front.webContents.send("filetrail:command", { type: "newWindow" });
  }

  // A window opened from another one (New Window, Open in New Window, Move Tab to New
  // Window): it has the tabs it is given, and the other window's panels and size, a step
  // down and to the right of it.
  openWindowFrom(
    senderId: number | null,
    tabs: readonly OpenTabPreference[],
    activeTabIndex: number,
  ): boolean {
    if (tabs.length === 0 || this.shuttingDown) {
      return false;
    }
    const store = this.host.store;
    const source = this.list.byWebContentsId(senderId) ?? this.list.front();
    const sourcePreferences = source
      ? store.getWindowPreferences(source.id)
      : store.getPreferences();
    const activeIndex = Math.min(Math.max(0, activeTabIndex), tabs.length - 1);
    const activeTab = tabs[activeIndex];
    const record = this.createRecord(this.newWindowBounds(source?.window), {
      ...pickWindowSession(sourcePreferences),
      openTabs: [...tabs],
      activeTabIndex: activeIndex,
      lastVisitedPath: activeTab?.path ?? null,
      lastVisitedFavoritePath: activeTab?.favoritePath ?? null,
      treeRootPath: activeTab?.treeRootPath ?? null,
    });
    store.addExplorerWindow(record);
    this.open(record, { launchFolderPath: null, restoreTabs: true, place: "front" });
    return true;
  }

  // Merge All Windows: the tabs of every other window, front to back, which close. The
  // window asking adds the tabs after its own `tabCount`. Each window is asked for its tabs
  // as they are now. One stays open, its tabs where they are, when it doesn't answer, when
  // something is open in it that closing would lose (a sheet, a dialog, a name being
  // edited), or when its tabs don't fit in the window asking.
  async mergeInto(senderId: number | null, tabCount: number): Promise<OpenTabPreference[]> {
    const target = this.list.byWebContentsId(senderId);
    if (!target || this.shuttingDown) {
      return [];
    }
    const others = this.openWindows().filter((entry) => entry !== target);
    const answers = await Promise.all(others.map((entry) => this.host.requestTabs(entry.window)));
    let room = OPEN_TABS_LIMIT - tabCount;
    const tabs: OpenTabPreference[] = [];
    for (const [index, entry] of others.entries()) {
      const answer = answers[index];
      if (
        !answer ||
        answer.busy ||
        answer.tabs.length === 0 ||
        answer.tabs.length > room ||
        entry.window.isDestroyed() ||
        this.closing.has(entry.window) ||
        this.shuttingDown
      ) {
        continue;
      }
      room -= answer.tabs.length;
      tabs.push(...answer.tabs);
      this.closingWithoutAsking.add(entry.window);
      this.merged.add(entry.window);
      entry.window.close();
    }
    return tabs;
  }

  // What an explorer window opens with: the launch folder for the window in front at
  // startup, whether it opens the tabs it was given, and a command to run.
  launchContextFor(senderId: number | null): {
    startupFolderPath: string | null;
    restoreTabs: boolean;
    initialCommand?: string;
  } {
    const entry = this.list.byWebContentsId(senderId);
    return {
      startupFolderPath: entry?.launchFolderPath ?? null,
      restoreTabs: entry?.restoreTabs ?? false,
      ...(entry?.initialCommand ? { initialCommand: entry.initialCommand } : {}),
    };
  }

  // The window a running operation goes to when the one that started it closes.
  successorOf(senderId: number): W["webContents"] | null {
    const successor = this.openWindows().find((entry) => entry.webContentsId !== senderId);
    return successor?.window.webContents ?? null;
  }

  // ⌘W on a window's last tab: closed as its close button closes it, so the question
  // before stopping a copy is asked and its place is recorded.
  closeWindowOf(webContentsId: number | null): boolean {
    const entry = this.list.byWebContentsId(webContentsId);
    if (!entry || entry.window.isDestroyed()) {
      return false;
    }
    entry.window.close();
    return true;
  }

  // A second launch, or a click on the Dock icon with no explorer window open.
  bringToFront(): void {
    const window = this.list.front()?.window ?? null;
    if (!window) {
      this.openDefaultWindow();
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  }

  activate(): void {
    if (
      shouldOpenWindowOnActivate({
        shutdownInProgress: this.shuttingDown,
        explorerWindowCount: this.list.count,
      })
    ) {
      this.openDefaultWindow();
    }
  }

  // Quitting stops a running copy, move, or delete after the item it is on. While a window
  // is open the person is asked first, and may keep working instead. With every window
  // closed the operation was already told to stop; quitting waits for it either way.
  async quit(): Promise<void> {
    if (this.shuttingDown || this.stopQuestionOpen) {
      return;
    }
    if (this.host.anyWindowOpen() && !(await this.askToStopOperation("quit", this.frontWindow()))) {
      return;
    }
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    // The store is written now, with the windows as they are, in case stopping the work
    // never ends; and again once it has, with what changed in the open windows meanwhile.
    this.recordAllBounds();
    this.host.store.flush();
    await this.host.shutDown();
    this.recordAllBounds();
    this.host.store.flush();
    this.host.exit();
  }

  /** Records every window's place and size in the store. */
  recordAllBounds(): void {
    for (const recordBounds of this.boundsRecorders.values()) {
      recordBounds();
    }
  }

  // A window that starts as the window closed last ended: its place and size, panels and
  // column widths, and the tab that was in front. Before any window has closed, the app's
  // latest values at the default size.
  private recordFromLastClosed(): StoredExplorerWindow {
    const lastClosed = this.host.store.getLastClosedWindow();
    return this.createRecord(lastClosed?.bounds ?? DEFAULT_WINDOW_STATE, lastClosed?.session ?? {});
  }

  private createRecord(
    bounds: StoredWindowState,
    session: Partial<StoredExplorerWindow["session"]>,
  ): StoredExplorerWindow {
    return {
      id: this.host.newWindowId(),
      bounds,
      session: this.host.store.createWindowSession(session),
    };
  }

  private newWindowBounds(source: W | undefined): StoredWindowState {
    if (!source || source.isDestroyed()) {
      return DEFAULT_WINDOW_STATE;
    }
    const from = source.isMaximized() ? source.getNormalBounds() : source.getBounds();
    const bounds = placeNewWindow(from, this.host.workAreaFor(from));
    return { ...bounds, maximized: false };
  }

  private open(record: StoredExplorerWindow, options: OpenOptions): W {
    const store = this.host.store;
    const window = this.host.createWindow(record);
    const windowId = record.id;
    const webContentsId = window.webContents.id;
    const entry: ExplorerWindowEntry<W> = {
      id: windowId,
      window,
      webContentsId,
      launchFolderPath: options.launchFolderPath,
      restoreTabs: options.restoreTabs,
      initialCommand: options.initialCommand ?? null,
    };
    this.list.add(entry, options.place);
    this.saveWindowOrder();

    const recordBounds = () => {
      if (window.isDestroyed()) {
        return;
      }
      const normalBounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds();
      store.setExplorerWindowBounds(windowId, {
        x: normalBounds.x,
        y: normalBounds.y,
        width: normalBounds.width,
        height: normalBounds.height,
        maximized: window.isMaximized(),
      });
    };
    this.boundsRecorders.set(windowId, recordBounds);
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleBoundsSave = () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      saveTimeout = setTimeout(() => {
        saveTimeout = null;
        recordBounds();
      }, WINDOW_BOUNDS_SAVE_DELAY_MS);
    };

    if (options.place === "front") {
      window.once("ready-to-show", () => window.show());
    }

    // The window used last is the one in front: New Window takes its folder from it, and
    // it is in front again at the next launch.
    window.on("focus", () => {
      if (this.list.moveToFront(windowId)) {
        this.saveWindowOrder();
      }
    });

    window.on("closed", () => {
      if (saveTimeout) {
        clearTimeout(saveTimeout);
      }
      this.list.remove(windowId);
      this.closing.delete(window);
      this.boundsRecorders.delete(windowId);
      // Closed while the app runs: it doesn't come back at the next launch, but the next
      // window opened with none open starts as it ended. (Windows merged into another one
      // weren't closed by hand.) Quitting keeps the windows open then.
      if (!this.shuttingDown) {
        if (!this.merged.has(window)) {
          store.rememberClosedWindow(windowId);
        }
        store.removeExplorerWindow(windowId);
      }
      this.host.windowsChanged();
    });

    window.on("move", scheduleBoundsSave);
    window.on("resize", scheduleBoundsSave);
    window.on("maximize", scheduleBoundsSave);
    window.on("unmaximize", scheduleBoundsSave);
    window.on("close", recordBounds);
    window.on("close", (event) => {
      if (this.holdClose(window)) {
        event.preventDefault();
        return;
      }
      this.closing.add(window);
    });

    this.host.windowsChanged();
    return window;
  }

  // Closing the last explorer window stops a running copy, so it asks first, as quitting
  // does, and the window waits for the answer. With other windows open the copy goes on in
  // one of them.
  private holdClose(window: W): boolean {
    if (this.shuttingDown || this.closingWithoutAsking.has(window)) {
      return false;
    }
    if (this.stopQuestionOpen) {
      return true;
    }
    if (this.openWindows().some((entry) => entry.window !== window)) {
      return false;
    }
    const operation = this.host.activeOperation();
    if (!operation || !describeQuitWhileBusy(operation.kind, "close")) {
      return false;
    }
    void this.askToStopOperation("close", window).then((stop) => {
      if (stop && !window.isDestroyed()) {
        this.closingWithoutAsking.add(window);
        window.close();
      }
    });
    return true;
  }

  // The windows open and staying open, front to back.
  private openWindows(): ExplorerWindowEntry<W>[] {
    return this.list
      .all()
      .filter((entry) => !entry.window.isDestroyed() && !this.closing.has(entry.window));
  }

  // The list of open windows is what says which is in front; the store keeps its order.
  private saveWindowOrder(): void {
    this.host.store.setExplorerWindowOrder(this.list.all().map((entry) => entry.id));
  }

  // Asks whether to stop the running operation, when there is one worth asking about.
  // Resolves true when it may be stopped (or nothing needs asking), false to keep working.
  private async askToStopOperation(trigger: StopTrigger, parent: W | null): Promise<boolean> {
    const operation = this.host.activeOperation();
    const question = operation ? describeQuitWhileBusy(operation.kind, trigger) : null;
    if (!question) {
      return true;
    }
    this.stopQuestionOpen = true;
    let response: number;
    try {
      response = await this.host.showStopQuestion(
        {
          message: question.message,
          detail: question.detail,
          buttons: stopQuestionButtons(trigger),
          defaultId: KEEP_WORKING_BUTTON_INDEX,
          cancelId: KEEP_WORKING_BUTTON_INDEX,
        },
        parent,
      );
    } finally {
      this.stopQuestionOpen = false;
    }
    if (response !== STOP_BUTTON_INDEX) {
      this.host.logger.info("[filetrail] kept an operation running instead of stopping it", {
        trigger,
        kind: operation?.kind ?? null,
      });
      return false;
    }
    return true;
  }
}
