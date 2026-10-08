import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { OpenTabPreference } from "../shared/appPreferences";
import {
  type AppStateStore,
  type StoredExplorerWindow,
  createAppStateStore,
  resolveAppStatePath,
} from "./appStateStore";
import type { WriteOperationKind } from "./bootstrap/writeOperations";
import {
  ExplorerWindowController,
  type ExplorerWindowHost,
  STARTUP_SHOW_TIMEOUT_MS,
  type StopQuestion,
  WINDOW_BOUNDS_SAVE_DELAY_MS,
} from "./explorerWindowController";
import { NEW_WINDOW_OFFSET } from "./explorerWindows";
import { KEEP_WORKING_BUTTON_INDEX, STOP_BUTTON_INDEX } from "./quitWhileBusy";

type Listener = (...args: never[]) => void;

let nextWebContentsId = 1;

// A stand-in for a BrowserWindow: its events are fired by hand, and closing it goes as
// Electron's does, "close" at once (which can be prevented) and "closed" a moment later.
class FakeWindow {
  readonly webContents = {
    id: nextWebContentsId++,
    send: vi.fn(),
  };
  destroyed = false;
  bounds = { x: 100, y: 80, width: 900, height: 600 };
  normalBounds = { x: 100, y: 80, width: 900, height: 600 };
  maximized = false;
  fullScreen = false;
  minimized = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly recordId: string,
    private readonly log: string[],
  ) {}

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  once(event: string, listener: Listener): this {
    const once = ((...args: never[]) => {
      this.listeners.set(
        event,
        (this.listeners.get(event) ?? []).filter((other) => other !== once),
      );
      listener(...args);
    }) as Listener;
    return this.on(event, once);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }

  close(): void {
    if (this.destroyed) {
      return;
    }
    let prevented = false;
    this.emit("close", {
      preventDefault: () => {
        prevented = true;
      },
    });
    if (prevented) {
      return;
    }
    this.log.push(`close ${this.recordId}`);
    queueMicrotask(() => {
      this.destroyed = true;
      this.emit("closed");
    });
  }

  isDestroyed = () => this.destroyed;
  show = () => this.log.push(`show ${this.recordId}`);
  showInactive = () => this.log.push(`showInactive ${this.recordId}`);
  focus = () => this.emit("focus");
  isMinimized = () => this.minimized;
  restore = () => {
    this.minimized = false;
  };
  maximize = () => {
    this.maximized = true;
    this.log.push(`maximize ${this.recordId}`);
  };
  isMaximized = () => this.maximized;
  isFullScreen = () => this.fullScreen;
  getBounds = () => this.bounds;
  getNormalBounds = () => this.normalBounds;
}

// Lets promise callbacks waiting on each other run.
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function tab(path: string): OpenTabPreference {
  return {
    path,
    treeRootPath: "/Users/demo",
    favoritePath: null,
    viewMode: "list",
    searchViewMode: "details",
    sortBy: "name",
    sortDirection: "asc",
    includeHidden: false,
    foldersFirst: true,
    favoritesExpanded: true,
    locationsExpanded: true,
  };
}

function storedWindow(
  store: AppStateStore,
  id: string,
  paths: string[],
  bounds: Partial<StoredExplorerWindow["bounds"]> = {},
): StoredExplorerWindow {
  return {
    id,
    bounds: { width: 900, height: 600, maximized: false, ...bounds },
    session: store.createWindowSession({ openTabs: paths.map(tab), activeTabIndex: 0 }),
  };
}

// A store on a file of its own, whose writes wait for flush().
function createStore(contents: unknown = { preferences: {}, windows: [] }): AppStateStore {
  const filePath = resolveAppStatePath(mkdtempSync(join(tmpdir(), "filetrail-windows-")));
  writeFileSync(filePath, JSON.stringify(contents), "utf8");
  return createAppStateStore(filePath, {
    defaultTheme: "dark",
    timer: {
      setTimeout: () => 0 as unknown as ReturnType<typeof setTimeout>,
      clearTimeout: () => undefined,
    },
  });
}

function setUp(store: AppStateStore = createStore()) {
  const log: string[] = [];
  const windows: FakeWindow[] = [];
  const questions: Array<{
    question: StopQuestion;
    parent: FakeWindow | null;
    answer: (button: number) => void;
  }> = [];
  let operation: { kind: WriteOperationKind } | null = null;
  let windowCount = 0;
  const host = {
    store,
    createWindow: (record: StoredExplorerWindow) => {
      const window = new FakeWindow(record.id, log);
      windows.push(window);
      return window;
    },
    newWindowId: () => {
      windowCount += 1;
      return `window-new-${windowCount}`;
    },
    workAreaFor: () => ({ x: 0, y: 0, width: 1600, height: 1000 }),
    activeOperation: () => operation,
    showStopQuestion: (question: StopQuestion, parent: FakeWindow | null) =>
      new Promise<number>((resolve) => {
        questions.push({ question, parent, answer: resolve });
      }),
    anyWindowOpen: () => windows.some((window) => !window.destroyed),
    windowsChanged: vi.fn(),
    shutDown: vi.fn(async () => undefined),
    exit: vi.fn(),
    logger: { info: vi.fn() },
  } satisfies ExplorerWindowHost<FakeWindow>;
  const controller = new ExplorerWindowController<FakeWindow>(host);
  return {
    controller,
    store,
    host,
    log,
    windows,
    questions,
    runOperation: (kind: WriteOperationKind | null) => {
      operation = kind ? { kind } : null;
    },
    windowFor: (id: string) => {
      const window = windows.find((candidate) => candidate.recordId === id);
      if (!window) {
        throw new Error(`No window ${id}.`);
      }
      return window;
    },
  };
}

// The app with windows open: each opened from the one before, the last in front.
function setUpWithWindows(count: number) {
  const setup = setUp();
  setup.controller.openStartupWindows(null);
  for (let index = 1; index < count; index += 1) {
    setup.controller.openWindowFrom(null, [tab(`/Users/demo/${index}`)], 0);
  }
  return setup;
}

describe("ExplorerWindowController startup", () => {
  it("brings back every window, shown back to front once all are ready, the front one focused", async () => {
    const store = createStore();
    store.addExplorerWindow(
      storedWindow(store, "window-b", ["/Users/demo/b"], { maximized: true }),
    );
    store.addExplorerWindow(storedWindow(store, "window-a", ["/Users/demo/a"]));
    const { controller, log, windowFor } = setUp(store);

    controller.openStartupWindows("/Users/demo/launched");
    windowFor("window-a").emit("ready-to-show");
    await settle();
    expect(log).toEqual([]);
    windowFor("window-b").emit("ready-to-show");
    await settle();

    expect(log).toEqual(["maximize window-b", "showInactive window-b", "show window-a"]);
    expect(controller.windows.all().map((entry) => entry.id)).toEqual(["window-a", "window-b"]);
    // The folder File Trail was launched with goes to the window in front.
    expect(controller.launchContextFor(windowFor("window-a").webContents.id)).toEqual({
      startupFolderPath: "/Users/demo/launched",
      restoreTabs: false,
    });
    expect(controller.launchContextFor(windowFor("window-b").webContents.id)).toEqual({
      startupFolderPath: null,
      restoreTabs: false,
    });
  });

  it("shows the windows anyway when a page never gets ready", async () => {
    vi.useFakeTimers();
    try {
      const store = createStore();
      store.addExplorerWindow(storedWindow(store, "window-a", ["/Users/demo/a"]));
      const { controller, log } = setUp(store);

      controller.openStartupWindows(null);
      await vi.advanceTimersByTimeAsync(STARTUP_SHOW_TIMEOUT_MS);

      expect(log).toEqual(["show window-a"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens only the front window when the last folders aren't reopened, and forgets the rest", () => {
    const store = createStore({ preferences: { restoreSessionOnStartup: false }, windows: [] });
    store.addExplorerWindow(storedWindow(store, "window-b", ["/Users/demo/b"]));
    store.addExplorerWindow(storedWindow(store, "window-a", ["/Users/demo/a"]));
    const { controller, windows } = setUp(store);

    controller.openStartupWindows(null);

    expect(windows.map((window) => window.recordId)).toEqual(["window-a"]);
    expect(store.getExplorerWindows().map((window) => window.id)).toEqual(["window-a"]);
  });

  it("opens one window as the window closed last ended, when none was open at quit", () => {
    const store = createStore();
    store.addExplorerWindow(
      storedWindow(store, "window-old", ["/Users/demo/a", "/Users/demo/b"], { x: 40, y: 50 }),
    );
    store.rememberClosedWindow("window-old");
    store.removeExplorerWindow("window-old");
    const { controller, windows } = setUp(store);

    controller.openStartupWindows(null);

    expect(windows).toHaveLength(1);
    const [record] = store.getExplorerWindows();
    expect(record?.id).toBe("window-new-1");
    expect(record?.bounds).toMatchObject({ x: 40, y: 50 });
    expect(record?.session.openTabs.map((open) => open.path)).toEqual(["/Users/demo/a"]);
  });
});

describe("ExplorerWindowController opening windows", () => {
  it("opens a window from another with its tabs and panels, a step down and to the right", () => {
    const { controller, store, windows, log } = setUpWithWindows(1);
    const [first] = windows;
    if (!first) {
      throw new Error("No window.");
    }
    store.updateWindowPreferences(first.recordId, { propertiesOpen: true, treeWidth: 333 });

    expect(
      controller.openWindowFrom(
        first.webContents.id,
        [tab("/Users/demo/x"), tab("/Users/demo/y")],
        5,
      ),
    ).toBe(true);

    const opened = windows[1];
    const record = store.getExplorerWindows()[0];
    expect(record?.id).toBe(opened?.recordId);
    expect(record?.bounds).toEqual({
      x: 100 + NEW_WINDOW_OFFSET,
      y: 80 + NEW_WINDOW_OFFSET,
      width: 900,
      height: 600,
      maximized: false,
    });
    expect(record?.session).toMatchObject({
      activeTabIndex: 1,
      lastVisitedPath: "/Users/demo/y",
      propertiesOpen: true,
      treeWidth: 333,
    });
    expect(controller.launchContextFor(opened?.webContents.id ?? null).restoreTabs).toBe(true);
    // Shown once its page is ready.
    opened?.emit("ready-to-show");
    expect(log.at(-1)).toBe(`show ${opened?.recordId}`);
    expect(controller.openWindowFrom(first.webContents.id, [], 0)).toBe(false);
  });

  it("opens a window where the last one closed, to run a command chosen with none open", () => {
    const { controller, windows } = setUp();

    controller.openDefaultWindow("goDesktop");

    expect(controller.launchContextFor(windows[0]?.webContents.id ?? null)).toEqual({
      startupFolderPath: null,
      restoreTabs: false,
      initialCommand: "goDesktop",
    });
  });

  it("has the window in front open New Window from the Dock, or opens one with none open", () => {
    const { controller, windows } = setUp();

    controller.openNewWindowFromFront();
    expect(windows).toHaveLength(1);

    controller.openNewWindowFromFront();
    expect(windows[0]?.webContents.send).toHaveBeenCalledWith("filetrail:command", {
      type: "newWindow",
    });
  });

  it("brings the window in front forward for a second launch, or opens one", () => {
    const { controller, windows } = setUp();
    controller.bringToFront();
    expect(windows).toHaveLength(1);
    const [window] = windows;
    if (!window) {
      throw new Error("No window.");
    }
    window.minimized = true;
    const focused = vi.fn();
    window.on("focus", focused);

    controller.bringToFront();

    expect(window.minimized).toBe(false);
    expect(focused).toHaveBeenCalled();
    expect(windows).toHaveLength(1);
  });

  it("opens a window from the Dock icon only with none open", () => {
    const { controller, windows } = setUp();
    controller.activate();
    controller.activate();
    expect(windows).toHaveLength(1);
  });
});

describe("ExplorerWindowController order and bounds", () => {
  it("keeps the window focused last in front, in the store too", () => {
    const { controller, store, windows } = setUpWithWindows(3);
    const ids = () => store.getExplorerWindows().map((window) => window.id);
    expect(ids()).toEqual(controller.windows.all().map((entry) => entry.id));

    windows[0]?.focus();

    expect(controller.windows.front()?.window).toBe(windows[0]);
    expect(ids()).toEqual(controller.windows.all().map((entry) => entry.id));
    expect(ids()[0]).toBe(windows[0]?.recordId);
  });

  it("records where a window is once it stops moving, and as it closes", async () => {
    vi.useFakeTimers();
    try {
      const { store, windows } = setUpWithWindows(2);
      const [window] = windows;
      if (!window) {
        throw new Error("No window.");
      }
      const recorded = () => store.getExplorerWindows().find((w) => w.id === window.recordId);

      window.bounds = { x: 300, y: 200, width: 1000, height: 700 };
      window.emit("move");
      expect(recorded()?.bounds.x).not.toBe(300);
      await vi.advanceTimersByTimeAsync(WINDOW_BOUNDS_SAVE_DELAY_MS);
      expect(recorded()?.bounds).toEqual({
        x: 300,
        y: 200,
        width: 1000,
        height: 700,
        maximized: false,
      });

      window.maximized = true;
      window.bounds = { x: 0, y: 0, width: 1600, height: 1000 };
      window.emit("close", { preventDefault: () => undefined });
      expect(recorded()?.bounds).toEqual({
        x: 100,
        y: 80,
        width: 900,
        height: 600,
        maximized: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ExplorerWindowController closing", () => {
  it("forgets a window closed by hand and remembers it as the window closed last", async () => {
    const { controller, store, windows, host } = setUpWithWindows(2);
    const [window] = windows;
    host.windowsChanged.mockClear();

    window?.close();
    await settle();

    expect(controller.windows.count).toBe(1);
    expect(store.getExplorerWindows().map((record) => record.id)).not.toContain(window?.recordId);
    expect(store.getLastClosedWindow()?.id).toBe(window?.recordId);
    expect(host.windowsChanged).toHaveBeenCalled();
  });

  it("keeps a window closed while quitting, to bring it back at the next launch", async () => {
    const { controller, store, windows } = setUpWithWindows(2);
    void controller.quit();
    await settle();

    windows[1]?.close();
    await settle();

    expect(store.getExplorerWindows()).toHaveLength(2);
    expect(store.getLastClosedWindow()).toBeNull();
  });

  it("asks before closing the last window stops a copy, and keeps working when told to", async () => {
    const { controller, windows, questions, runOperation } = setUpWithWindows(1);
    runOperation("copy");
    const [window] = windows;

    window?.close();
    await settle();

    expect(questions).toHaveLength(1);
    expect(questions[0]?.question.buttons).toEqual(["Keep Working", "Stop and Close"]);
    expect(questions[0]?.parent).toBe(window);
    // ⌘W again while the question is up does nothing more.
    window?.close();
    expect(questions).toHaveLength(1);
    questions[0]?.answer(KEEP_WORKING_BUTTON_INDEX);
    await settle();
    expect(window?.destroyed).toBe(false);
    expect(controller.windows.count).toBe(1);

    window?.close();
    questions[1]?.answer(STOP_BUTTON_INDEX);
    await settle();
    expect(window?.destroyed).toBe(true);
    expect(controller.windows.count).toBe(0);
  });

  it("asks the same when ⌘W closes the last tab of the last window", async () => {
    vi.useFakeTimers();
    try {
      const { controller, windows, questions, runOperation, store } = setUpWithWindows(1);
      runOperation("copy");
      const [window] = windows;
      if (!window) {
        throw new Error("No window.");
      }
      // Moved just before ⌘W, before the place was recorded.
      window.bounds = { x: 321, y: 123, width: 1000, height: 700 };
      window.emit("move");

      expect(controller.closeWindowOf(window.webContents.id)).toBe(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(store.getExplorerWindows()[0]?.bounds).toMatchObject({ x: 321, y: 123 });
      expect(questions.map((asked) => asked.question.buttons)).toEqual([
        ["Keep Working", "Stop and Close"],
      ]);
      questions[0]?.answer(KEEP_WORKING_BUTTON_INDEX);
      await vi.advanceTimersByTimeAsync(0);
      // The window stays, and so the copy keeps running in it.
      expect(window.destroyed).toBe(false);
      expect(controller.closeWindowOf(12_345)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks once when the last two windows close together while one of them copies", async () => {
    const { controller, windows, questions, runOperation } = setUpWithWindows(2);
    runOperation("copy");
    const [first, second] = windows;

    // Close All, or ⌥-click on a close button: both in the same moment.
    first?.close();
    second?.close();
    await settle();

    expect(questions).toHaveLength(1);
    expect(first?.destroyed).toBe(true);
    // The copy is handed to the window still open, which asks before it goes too.
    expect(controller.successorOf(first?.webContents.id ?? 0)).toBe(second?.webContents);
    questions[0]?.answer(KEEP_WORKING_BUTTON_INDEX);
    await settle();
    expect(second?.destroyed).toBe(false);
  });

  it("doesn't hand a copy to a window that is closing too", async () => {
    const { controller, windows } = setUpWithWindows(3);
    const [first, second, third] = windows;

    third?.close();
    expect(controller.successorOf(first?.webContents.id ?? 0)).toBe(second?.webContents);
    second?.close();
    expect(controller.successorOf(first?.webContents.id ?? 0)).toBeNull();
    await settle();
  });

  it("closes the last window without asking when nothing worth asking about runs", async () => {
    const { windows, questions, runOperation } = setUpWithWindows(1);
    runOperation("rename");
    windows[0]?.close();
    await settle();
    expect(questions).toHaveLength(0);
    expect(windows[0]?.destroyed).toBe(true);
  });

  it("closes one of several windows without asking, and hands its copy to another", async () => {
    const { controller, windows, questions, runOperation } = setUpWithWindows(2);
    runOperation("copy");
    const [first, second] = windows;

    expect(controller.successorOf(second?.webContents.id ?? 0)).toBe(first?.webContents);
    second?.close();
    await settle();

    expect(questions).toHaveLength(0);
    expect(second?.destroyed).toBe(true);
    expect(controller.successorOf(first?.webContents.id ?? 0)).toBeNull();
  });
});

describe("ExplorerWindowController Merge All Windows", () => {
  it("hands over the other windows' tabs, front to back, and closes them", async () => {
    const { controller, store, windows } = setUpWithWindows(3);
    const [first, second, third] = windows;

    const tabs = controller.mergeInto(first?.webContents.id ?? null);
    await settle();

    expect(tabs.map((open) => open.path)).toEqual(["/Users/demo/2", "/Users/demo/1"]);
    expect(second?.destroyed).toBe(true);
    expect(third?.destroyed).toBe(true);
    // Merged windows weren't closed by hand.
    expect(store.getLastClosedWindow()).toBeNull();
    expect(controller.windows.count).toBe(1);
    expect(controller.mergeInto(12_345)).toEqual([]);
  });
});

describe("ExplorerWindowController quitting", () => {
  it("asks first while a copy runs, and keeps working when told to", async () => {
    const { controller, questions, runOperation, host } = setUpWithWindows(1);
    runOperation("copy");

    const quitting = controller.quit();
    await settle();
    // A second quit while the question is up is left alone.
    await controller.quit();
    expect(questions).toHaveLength(1);
    expect(questions[0]?.question.buttons).toEqual(["Keep Working", "Stop and Quit"]);
    questions[0]?.answer(KEEP_WORKING_BUTTON_INDEX);
    await quitting;

    expect(host.exit).not.toHaveBeenCalled();
    expect(controller.shutdownInProgress).toBe(false);
    expect(host.logger.info).toHaveBeenCalled();
  });

  it("records the windows, writes the store, waits for the work to stop, then exits", async () => {
    const { controller, questions, runOperation, host, store, windows } = setUpWithWindows(1);
    runOperation("copy");
    const flush = vi.spyOn(store, "flush");
    const [window] = windows;
    if (window) {
      window.bounds = { x: 5, y: 6, width: 1000, height: 700 };
    }

    const quitting = controller.quit();
    await settle();
    questions[0]?.answer(STOP_BUTTON_INDEX);
    await quitting;

    expect(flush).toHaveBeenCalled();
    expect(store.getExplorerWindows()[0]?.bounds).toMatchObject({ x: 5, y: 6 });
    expect(host.shutDown).toHaveBeenCalledTimes(1);
    expect(host.exit).toHaveBeenCalledTimes(1);
    // Not while quitting: a window would close again moments later.
    controller.activate();
    expect(windows).toHaveLength(1);
  });

  it("quits without asking with no window open", async () => {
    const { controller, questions, runOperation, host } = setUp();
    runOperation("copy");
    await controller.quit();
    expect(questions).toHaveLength(0);
    expect(host.exit).toHaveBeenCalledTimes(1);
  });
});
