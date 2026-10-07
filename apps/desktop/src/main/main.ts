import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  Menu,
  app,
  dialog,
  nativeImage,
  nativeTheme,
  screen,
  shell,
} from "electron";

import { type HelpTopic, type SettingsTab, helpTopicSchema } from "@filetrail/contracts";

import type { AppPreferences, OpenTabPreference } from "../shared/appPreferences";
import {
  type ApplicationMenuState,
  INITIAL_APPLICATION_MENU_STATE,
} from "../shared/applicationMenuState";
import { resolveShortcuts } from "../shared/shortcuts";
import { createAppLogger, isDebugLoggingEnabled, resolveAppLogFilePath } from "./appLog";
import {
  APP_MENU_NAME,
  type ExplorerCommandTarget,
  applyApplicationMenuItemStates,
  createApplicationMenuTemplate,
  resolveApplicationMenuItemStates,
  undoMenuLabels,
} from "./appMenu";
import {
  type AppStateStore,
  DEFAULT_WINDOW_STATE,
  type StoredExplorerWindow,
  type StoredWindowState,
  createAppStateStore,
  pickWindowSession,
  resolveAppStatePath,
} from "./appStateStore";
import {
  bootstrapMainProcess,
  getActiveWriteOperation,
  getMainProcessStatus,
  shutdownMainProcess,
} from "./bootstrap";
import { ExplorerWindowList, placeNewWindow } from "./explorerWindows";
import { resolveBundledFdBinaryPath } from "./fdBinary";
import { resolveStartupFolderPath } from "./launchContext";
import {
  KEEP_WORKING_BUTTON_INDEX,
  STOP_BUTTON_INDEX,
  type StopTrigger,
  describeQuitWhileBusy,
  shouldOpenWindowOnActivate,
  stopQuestionButtons,
} from "./quitWhileBusy";
import { readSettingsTabFromUrl } from "./settingsWindowTab";
// The explorer windows, front to back.
const explorerWindows = new ExplorerWindowList<BrowserWindow>();
let settingsWindowRef: BrowserWindow | null = null;
// The Settings tab that was on screen last, so the window opens where it was left. It is
// remembered only while the app runs: a fresh launch starts on General.
let lastSettingsTab: SettingsTab | null = null;
let helpWindowRef: BrowserWindow | null = null;
// The Help page on screen last, so Help opens where it was left while the app runs.
let lastHelpTopic: HelpTopic | null = null;
let aboutWindowRef: BrowserWindow | null = null;
let acknowledgementsWindowRef: BrowserWindow | null = null;
let appStateStoreRef: AppStateStore | null = null;
// Records each explorer window's size and position in the store, by window id.
const windowBoundsRecorders = new Map<string, () => void>();
let appLoggerRef: ReturnType<typeof createAppLogger> | null = null;
// What each explorer window last said the application menu should show, by web contents.
const applicationMenuStates = new Map<number, ApplicationMenuState>();
// What the history says Undo and Redo would do, and the words the menu was last built with.
let undoHistoryMenu: { undo: string | null; redo: string | null; cantUndo: boolean } = {
  undo: null,
  redo: null,
  cantUndo: false,
};
let builtUndoLabels = "";
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const WINDOW_STATE_SAVE_DELAY_MS = 160;
let shutdownInProgress = false;
// True while the "a copy is still in progress" question is on screen.
let stopQuestionOpen = false;
// Explorer windows that close without asking first: the person agreed to stop the running
// operation, or their tabs were merged into another window.
const windowsClosingWithoutAsking = new WeakSet<BrowserWindow>();
let processLoggingHandlersInstalled = false;
// Found while starting, before the window opened; shown once it has.
const pendingStartupNotices: string[] = [];

if (!hasSingleInstanceLock) {
  app.quit();
}

if (hasSingleInstanceLock) {
  // Electron installs a menu of its own (Reload, Force Reload, Speech…) unless one has been
  // set by the time the app is ready; ours is built with the window.
  Menu.setApplicationMenu(null);
  // While Settings has the keyboard the explorer's commands do not apply, and its Undo is
  // its text fields'.
  app.on("browser-window-focus", () => refreshUndoMenu());

  app
    .whenReady()
    .then(async () => {
      const userDataPath = app.getPath("userData");
      const appLogPath = resolveAppLogFilePath(userDataPath);
      const debugEnabled = isDebugLoggingEnabled();
      const appLogger = createAppLogger(appLogPath, {
        debugEnabled,
      });
      appLoggerRef = appLogger;
      installProcessLoggingHandlers(appLogger);
      const launchContext = {
        startupFolderPath: resolveStartupFolderPath(process.argv, resolveLaunchWorkingDirectory(), {
          appPath: app.getAppPath(),
          argvOffset: process.defaultApp ? 2 : 1,
        }),
      };
      const fdStatus = resolveFdStartupStatus();
      appLogger.info("[filetrail] app start", {
        appVersion: app.getVersion(),
        electronVersion: process.versions.electron ?? null,
        chromeVersion: process.versions.chrome ?? null,
        nodeVersion: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        userDataPath,
        appLogPath,
        startupFolderPath: launchContext.startupFolderPath,
        debugEnabled,
        fdBinaryPath: fdStatus.path,
        fdBinaryError: fdStatus.error,
      });
      const appStateStore = createAppStateStore(resolveAppStatePath(userDataPath), {
        defaultTheme: "auto",
        onReadError: (error) => {
          appLogger.error("[filetrail] failed reading app state", error);
        },
        onPersistError: (error) => {
          appLogger.error("[filetrail] failed persisting app state", error);
        },
      });
      const iconPath = resolveAppIconPath();
      if (iconPath && process.platform === "darwin") {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          app.dock?.setIcon(icon);
        }
      }
      appStateStoreRef = appStateStore;
      applyNativeAppearance(appStateStore.getPreferences().theme);
      // "Auto" follows macOS: keep the window backgrounds in step when it switches.
      nativeTheme.on("updated", () => {
        const preferences = appStateStoreRef?.getPreferences();
        if (preferences?.theme === "auto") {
          applyNativeAppearance(preferences.theme);
        }
      });
      await bootstrapMainProcess(
        appStateStore,
        launchContext,
        appLogger,
        (preferences, change) => {
          // Keep every open window (explorer and Settings) on the same preferences.
          for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed()) {
              continue;
            }
            // Setting the zoom, even to the value it has, makes Chromium rewrite its own
            // preferences file; most changes (the folder on screen, say) are not the zoom.
            if (change.patch.zoomPercent !== undefined) {
              applyWindowZoom(window, preferences.zoomPercent);
              // About can not be resized by hand; it grows and shrinks with its text.
              if (window === aboutWindowRef) {
                window.setContentSize(...aboutWindowSize(preferences.zoomPercent));
              }
            }
            if (window.webContents.id !== change.senderId && Object.keys(change.patch).length > 0) {
              window.webContents.send("filetrail:preferencesChanged", change.patch);
            }
          }
          if (change.patch.theme !== undefined) {
            applyNativeAppearance(preferences.theme);
          }
          // The menu's keys and labels can not be changed in place: it is built again.
          if (
            change.patch.shortcutOverrides !== undefined ||
            change.patch.defaultTextEditor !== undefined
          ) {
            buildApplicationMenu();
          }
        },
        {
          openSettingsWindow,
          openAcknowledgementsWindow,
          showStartupNotices: (notices) => {
            pendingStartupNotices.push(...notices);
          },
          showRecoveryNotices: (notices) => {
            const window = explorerWindows.front()?.window;
            if (!window || window.isDestroyed()) {
              return;
            }
            void dialog.showMessageBox(window, {
              type: "info",
              message:
                notices.length === 1
                  ? "An item waiting for its disk is in place now"
                  : "Items waiting for their disk are in place now",
              detail: notices.join("\n\n"),
              buttons: ["OK"],
            });
          },
          openHelpWindow,
          setApplicationMenuState: (state, senderId) => {
            if (senderId === null || !explorerWindows.byWebContentsId(senderId)) {
              return;
            }
            applicationMenuStates.set(senderId, state);
            refreshUndoMenu();
          },
          explorerWindowIdOf: (senderId) => explorerWindows.byWebContentsId(senderId)?.id ?? null,
          launchContextFor: (senderId) => {
            const entry = explorerWindows.byWebContentsId(senderId);
            return {
              startupFolderPath: entry?.launchFolderPath ?? null,
              restoreTabs: entry?.restoreTabs ?? false,
            };
          },
          openExplorerWindow: (senderId, tabs, activeTabIndex) =>
            openExplorerWindowFrom(senderId, tabs, activeTabIndex),
          mergeExplorerWindows: (senderId) => mergeExplorerWindowsInto(senderId),
          explorerWindowCount: () => explorerWindows.count,
          successorWindowOf: (senderId) => {
            const successor = explorerWindows
              .all()
              .find((entry) => entry.webContentsId !== senderId && !entry.window.isDestroyed());
            return successor?.window.webContents ?? null;
          },
          onUndoHistoryChanged: (menu) => {
            undoHistoryMenu = menu;
            refreshUndoMenu();
          },
        },
      );
      // Before the windows open, so the menu bar never shows anything but the app's own menu.
      buildApplicationMenu();
      app.dock?.setMenu(
        Menu.buildFromTemplate([{ label: "New Window", click: () => openNewWindowFromFront() }]),
      );
      openStartupWindows(launchContext.startupFolderPath);
      const frontWindow = explorerWindows.front()?.window;
      if (frontWindow) {
        showPendingStartupNotices(frontWindow);
      }

      app.on("activate", () => {
        appLogger.info("[filetrail] app activate", {
          openWindowCount: BrowserWindow.getAllWindows().length,
        });
        if (
          shouldOpenWindowOnActivate({
            shutdownInProgress,
            openWindowCount: BrowserWindow.getAllWindows().length,
          })
        ) {
          openDefaultExplorerWindow();
        }
      });
    })
    .catch(async (error) => {
      appLoggerRef?.error("[filetrail] startup failed", error);
      await appLoggerRef?.flush();
      app.exit(1);
    });

  // The app always ends through finalizeShutdown's app.exit, which doesn't come back here.
  // A second quit while it waits for an operation to stop must not cut that wait short.
  app.on("before-quit", (event) => {
    event.preventDefault();
    if (shutdownInProgress || stopQuestionOpen) {
      return;
    }
    void confirmQuit();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("second-instance", () => {
    appLoggerRef?.info("[filetrail] second instance activation", {
      hasWindow: BrowserWindow.getAllWindows().length > 0,
    });
    const window = explorerWindows.front()?.window ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  });
}

// The windows the app opens with: every window that was open when it quit, front one in
// front, when the last folders and tabs are reopened; otherwise one window. The folder the
// app was launched with goes to the window in front.
function openStartupWindows(startupFolderPath: string | null): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    throw new Error("App state store was not initialized before creating the windows.");
  }
  const stored = appStateStore.getExplorerWindows();
  const records = appStateStore.getPreferences().restoreSessionOnStartup
    ? [...stored]
    : stored.slice(0, 1);
  // Windows not brought back now aren't brought back later either.
  for (const dropped of stored.slice(records.length)) {
    appStateStore.removeExplorerWindow(dropped.id);
  }
  if (records.length === 0) {
    const record = createExplorerWindowRecord(appStateStore, DEFAULT_WINDOW_STATE, {});
    appStateStore.addExplorerWindow(record);
    records.push(record);
  }
  const opened = records.map((record, index) => {
    const window = createExplorerWindow(record, {
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

// How long startup waits for a window's page before showing the windows anyway.
const STARTUP_SHOW_TIMEOUT_MS = 5_000;

function createExplorerWindowRecord(
  appStateStore: AppStateStore,
  bounds: StoredWindowState,
  session: Partial<StoredExplorerWindow["session"]>,
): StoredExplorerWindow {
  return {
    id: `window-${randomUUID()}`,
    bounds,
    session: appStateStore.createWindowSession(session),
  };
}

// A window opened with nothing to take after (the Dock icon clicked with no window open).
function openDefaultExplorerWindow(): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    return;
  }
  const record = createExplorerWindowRecord(appStateStore, DEFAULT_WINDOW_STATE, {});
  appStateStore.addExplorerWindow(record);
  createExplorerWindow(record, { launchFolderPath: null, restoreTabs: false, place: "front" });
}

// New Window from the Dock menu: the window in front opens it on its folder, as ⌘N does.
function openNewWindowFromFront(): void {
  const front = explorerWindows.front();
  if (!front || front.window.isDestroyed()) {
    openDefaultExplorerWindow();
    return;
  }
  front.window.webContents.send("filetrail:command", { type: "newWindow" });
}

// A window opened from another one (New Window, Open in New Window, Move Tab to New
// Window): it has the tabs it is given, and the other window's panels and size, a step
// down and to the right of it.
function openExplorerWindowFrom(
  senderId: number | null,
  tabs: OpenTabPreference[],
  activeTabIndex: number,
): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore || tabs.length === 0) {
    return;
  }
  const source = explorerWindows.byWebContentsId(senderId) ?? explorerWindows.front();
  const sourcePreferences = source
    ? appStateStore.getWindowPreferences(source.id)
    : appStateStore.getPreferences();
  const activeIndex = Math.min(Math.max(0, activeTabIndex), tabs.length - 1);
  const activeTab = tabs[activeIndex];
  const record = createExplorerWindowRecord(appStateStore, newWindowBounds(source?.window), {
    ...pickWindowSession(sourcePreferences),
    openTabs: tabs,
    activeTabIndex: activeIndex,
    lastVisitedPath: activeTab?.path ?? null,
    lastVisitedFavoritePath: activeTab?.favoritePath ?? null,
    treeRootPath: activeTab?.treeRootPath ?? null,
  });
  appStateStore.addExplorerWindow(record);
  createExplorerWindow(record, { launchFolderPath: null, restoreTabs: true, place: "front" });
}

function newWindowBounds(source: BrowserWindow | undefined): StoredWindowState {
  if (!source || source.isDestroyed()) {
    return DEFAULT_WINDOW_STATE;
  }
  const from = source.isMaximized() ? source.getNormalBounds() : source.getBounds();
  const bounds = placeNewWindow(from, screen.getDisplayMatching(from).workArea);
  return { ...bounds, maximized: false };
}

// Merge All Windows: the tabs of every other window, front to back, which close. The
// window asking adds the tabs after its own.
function mergeExplorerWindowsInto(senderId: number | null): OpenTabPreference[] {
  const appStateStore = appStateStoreRef;
  const target = explorerWindows.byWebContentsId(senderId);
  if (!appStateStore || !target) {
    return [];
  }
  const others = explorerWindows.all().filter((entry) => entry !== target);
  const tabs = others.flatMap((entry) => appStateStore.getWindowPreferences(entry.id).openTabs);
  for (const entry of others) {
    if (!entry.window.isDestroyed()) {
      windowsClosingWithoutAsking.add(entry.window);
      entry.window.close();
    }
  }
  return tabs;
}

function createExplorerWindow(
  record: StoredExplorerWindow,
  options: {
    launchFolderPath: string | null;
    restoreTabs: boolean;
    // "front": opened while the app runs, and shown as soon as it is ready. "back": one of
    // the windows the app opens with, shown by openStartupWindows.
    place: "front" | "back";
  },
): BrowserWindow {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    throw new Error("App state store was not initialized before creating the window.");
  }
  const storedBounds = record.bounds;
  const iconPath = resolveAppIconPath();
  const explorerWindow = new BrowserWindow({
    show: false,
    width: storedBounds.width,
    height: storedBounds.height,
    ...(typeof storedBounds.x === "number" ? { x: storedBounds.x } : {}),
    ...(typeof storedBounds.y === "number" ? { y: storedBounds.y } : {}),
    // Small enough to sit beside another window; the renderer adapts down to this size.
    minWidth: 760,
    minHeight: 480,
    title: "File Trail",
    // The window sits on the macOS sidebar material and the page paints everything except
    // the sidebar over it, which makes the sidebar translucent like Finder's. The material
    // follows the window (it goes flat when the window is inactive) and turns opaque by
    // itself when "Reduce transparency" is on in System Settings.
    vibrancy: "sidebar",
    visualEffectState: "followWindow",
    backgroundColor: TRANSPARENT_WINDOW_BACKGROUND,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: appStateStore.getPreferences().zoomPercent / 100,
    },
    ...(iconPath ? { icon: iconPath } : {}),
  });
  const windowId = record.id;
  const webContentsId = explorerWindow.webContents.id;
  explorerWindows.add(
    {
      id: windowId,
      window: explorerWindow,
      webContentsId,
      launchFolderPath: options.launchFolderPath,
      restoreTabs: options.restoreTabs,
    },
    options.place,
  );
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  keepWindowZoom(explorerWindow, appStateStore);

  const persistWindowBounds = () => {
    if (explorerWindow.isDestroyed()) {
      return;
    }
    const normalBounds = explorerWindow.isMaximized()
      ? explorerWindow.getNormalBounds()
      : explorerWindow.getBounds();
    appStateStore.setExplorerWindowBounds(windowId, {
      x: normalBounds.x,
      y: normalBounds.y,
      width: normalBounds.width,
      height: normalBounds.height,
      maximized: explorerWindow.isMaximized(),
    });
  };
  windowBoundsRecorders.set(windowId, persistWindowBounds);

  const scheduleWindowBoundsSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      persistWindowBounds();
    }, WINDOW_STATE_SAVE_DELAY_MS);
  };

  const rendererEntryUrl = resolveRendererEntryUrl();

  explorerWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  explorerWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== rendererEntryUrl) {
      event.preventDefault();
    }
  });
  explorerWindow.webContents.on("render-process-gone", (_event, details) => {
    appLoggerRef?.error("[filetrail] renderer process gone", {
      windowId: explorerWindow.id,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  explorerWindow.webContents.on("unresponsive", () => {
    appLoggerRef?.warn("[filetrail] renderer unresponsive", {
      windowId: explorerWindow.id,
    });
  });

  if (options.place === "front") {
    explorerWindow.once("ready-to-show", () => explorerWindow.show());
  }

  void explorerWindow.loadURL(rendererEntryUrl);

  if (process.env.FILETRAIL_OPEN_DEVTOOLS === "1") {
    explorerWindow.webContents.openDevTools({ mode: "detach" });
  }

  // The window used last is the one in front: New Window takes its folder from it, and
  // it is in front again at the next launch.
  explorerWindow.on("focus", () => {
    if (explorerWindows.moveToFront(windowId)) {
      appStateStore.moveExplorerWindowToFront(windowId);
    }
  });

  explorerWindow.on("closed", () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    explorerWindows.remove(windowId);
    applicationMenuStates.delete(webContentsId);
    windowBoundsRecorders.delete(windowId);
    if (!shutdownInProgress && explorerWindows.count > 0) {
      // Closed while others stay open: it doesn't come back at the next launch. The last
      // window closing quits the app, and comes back.
      appStateStore.removeExplorerWindow(windowId);
    }
    if (explorerWindows.count === 0) {
      // The other windows belong to the explorer windows; closing the last one quits.
      for (const window of [settingsWindowRef, aboutWindowRef, acknowledgementsWindowRef]) {
        if (window && !window.isDestroyed()) {
          window.close();
        }
      }
    }
    syncApplicationMenuItems();
  });

  explorerWindow.on("move", scheduleWindowBoundsSave);
  explorerWindow.on("resize", scheduleWindowBoundsSave);
  explorerWindow.on("maximize", scheduleWindowBoundsSave);
  explorerWindow.on("unmaximize", scheduleWindowBoundsSave);
  explorerWindow.on("close", persistWindowBounds);
  // Closing the last explorer window quits the app and stops a running copy, so it asks
  // first, as quitting does. With other windows open the copy goes on in one of them.
  explorerWindow.on("close", (event) => {
    if (shutdownInProgress || windowsClosingWithoutAsking.has(explorerWindow)) {
      return;
    }
    if (stopQuestionOpen) {
      event.preventDefault();
      return;
    }
    if (explorerWindows.count > 1) {
      return;
    }
    const operation = getActiveWriteOperation();
    if (!operation || !describeQuitWhileBusy(operation.kind, "close")) {
      return;
    }
    event.preventDefault();
    void askToStopOperation("close").then((stop) => {
      if (stop && !explorerWindow.isDestroyed()) {
        windowsClosingWithoutAsking.add(explorerWindow);
        explorerWindow.close();
      }
    });
  });

  syncApplicationMenuItems();
  return explorerWindow;
}

// Settings lives in its own window (⌘,), like a native macOS app. Preference edits there
// persist through the same IPC as the explorer window and are broadcast back to it.
function openSettingsWindow(tab?: SettingsTab): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    return;
  }
  if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
    if (tab) {
      settingsWindowRef.webContents.send("filetrail:showSettingsTab", tab);
    }
    settingsWindowRef.show();
    settingsWindowRef.focus();
    return;
  }
  const settingsWindow = new BrowserWindow({
    show: false,
    width: 720,
    height: 540,
    minWidth: 680,
    minHeight: 420,
    title: "Settings",
    backgroundColor: windowBackgroundColor(appStateStore.getPreferences().theme),
    titleBarStyle: "hiddenInset",
    // Placed as in the explorer window, whose sidebar and title row are as tall.
    trafficLightPosition: { x: 14, y: 16 },
    fullscreenable: false,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: appStateStore.getPreferences().zoomPercent / 100,
    },
  });
  settingsWindowRef = settingsWindow;
  keepWindowZoom(settingsWindow, appStateStore);
  const rendererEntryUrl = resolveRendererEntryUrl();
  // The tab to open on follows "#settings" in the address: the one asked for, or the one
  // Settings was left on.
  const openOnTab = tab ?? lastSettingsTab;
  const settingsUrl = `${rendererEntryUrl}#settings${openOnTab ? `/${openOnTab}` : ""}`;
  const rememberTab = (url: string) => {
    lastSettingsTab = readSettingsTabFromUrl(url) ?? lastSettingsTab;
  };
  settingsWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  settingsWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== settingsUrl) {
      event.preventDefault();
    }
  });
  // The window puts the tab on screen in its address (a change within the page, which the
  // guard above lets through).
  settingsWindow.webContents.on("did-navigate-in-page", (_event, url) => rememberTab(url));
  settingsWindow.on("close", () => rememberTab(settingsWindow.webContents.getURL()));
  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  settingsWindow.on("closed", () => {
    if (settingsWindowRef === settingsWindow) {
      settingsWindowRef = null;
    }
  });
  void settingsWindow.loadURL(settingsUrl);
}

// Help is a window of its own (⌘?), beside the files rather than in their place, like a
// Mac app's help. It opens on the page asked for, or the one it was left on.
function openHelpWindow(topic?: HelpTopic): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    return;
  }
  if (helpWindowRef && !helpWindowRef.isDestroyed()) {
    if (topic) {
      helpWindowRef.webContents.send("filetrail:showHelpTopic", topic);
    }
    helpWindowRef.show();
    helpWindowRef.focus();
    return;
  }
  const helpWindow = new BrowserWindow({
    show: false,
    width: 900,
    height: 680,
    minWidth: 560,
    minHeight: 420,
    title: "File Trail Help",
    backgroundColor: windowBackgroundColor(appStateStore.getPreferences().theme),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: appStateStore.getPreferences().zoomPercent / 100,
    },
  });
  helpWindowRef = helpWindow;
  keepWindowZoom(helpWindow, appStateStore);
  const openOnTopic = topic ?? lastHelpTopic;
  const helpUrl = `${resolveRendererEntryUrl()}#help${openOnTopic ? `/${openOnTopic}` : ""}`;
  const rememberTopic = (url: string) => {
    const hashIndex = url.indexOf("#");
    const match = hashIndex === -1 ? null : /^#help\/([a-z]+)$/u.exec(url.slice(hashIndex));
    const parsed = helpTopicSchema.safeParse(match?.[1]);
    if (parsed.success) {
      lastHelpTopic = parsed.data;
    }
  };
  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  helpWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== helpUrl) {
      event.preventDefault();
    }
  });
  // The window keeps its address in step with the page on screen.
  helpWindow.webContents.on("did-navigate-in-page", (_event, url) => rememberTopic(url));
  helpWindow.on("close", () => rememberTopic(helpWindow.webContents.getURL()));
  helpWindow.once("ready-to-show", () => helpWindow.show());
  helpWindow.on("closed", () => {
    if (helpWindowRef === helpWindow) {
      helpWindowRef = null;
    }
  });
  void helpWindow.loadURL(helpUrl);
}

const ABOUT_WINDOW_WIDTH = 460;
const ABOUT_WINDOW_HEIGHT = 356;

// The About window's size at a zoom level: its text scales with the app's zoom.
function aboutWindowSize(zoomPercent: number): [number, number] {
  return [
    Math.round((ABOUT_WINDOW_WIDTH * zoomPercent) / 100),
    Math.round((ABOUT_WINDOW_HEIGHT * zoomPercent) / 100),
  ];
}

// About File Trail: a small fixed window in place of the standard macOS panel, which has
// room for a name and a version only.
function openAboutWindow(): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    return;
  }
  const [width, height] = aboutWindowSize(appStateStore.getPreferences().zoomPercent);
  aboutWindowRef = showPageWindow(aboutWindowRef, appStateStore, "about", {
    width,
    height,
    useContentSize: true,
    title: `About ${APP_MENU_NAME}`,
    resizable: false,
    minimizable: false,
    maximizable: false,
  });
}

// The open-source software inside the app and its licenses, opened from About.
function openAcknowledgementsWindow(): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    return;
  }
  acknowledgementsWindowRef = showPageWindow(
    acknowledgementsWindowRef,
    appStateStore,
    "acknowledgements",
    { width: 620, height: 640, minWidth: 460, minHeight: 360, title: "Acknowledgements" },
  );
}

// Shows a window that is one page of the renderer (`#about`): the one already open, or a
// new one.
function showPageWindow(
  openWindow: BrowserWindow | null,
  appStateStore: AppStateStore,
  page: string,
  options: BrowserWindowConstructorOptions,
): BrowserWindow {
  if (openWindow && !openWindow.isDestroyed()) {
    openWindow.show();
    openWindow.focus();
    return openWindow;
  }
  const window = new BrowserWindow({
    show: false,
    backgroundColor: windowBackgroundColor(appStateStore.getPreferences().theme),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    fullscreenable: false,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: appStateStore.getPreferences().zoomPercent / 100,
    },
    ...options,
  });
  keepWindowZoom(window, appStateStore);
  const pageUrl = `${resolveRendererEntryUrl()}#${page}`;
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== pageUrl) {
      event.preventDefault();
    }
  });
  window.once("ready-to-show", () => window.show());
  void window.loadURL(pageUrl);
  return window;
}

function resolveRendererEntryUrl(): string {
  const rendererUrl = process.env.FILETRAIL_RENDERER_URL;
  if (rendererUrl && rendererUrl.length > 0) {
    return rendererUrl;
  }
  const rendererPath = fileURLToPath(new URL("../renderer/index.html", import.meta.url));
  return pathToFileURL(rendererPath).toString();
}

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

// Native parts of the window (title bar, scroll bars, pickers, the empty window before the
// page paints) follow the app's theme rather than the macOS appearance: Light or Dark pins
// them, "auto" follows the system as the page does.
function applyNativeAppearance(theme: AppPreferences["theme"]): void {
  nativeTheme.themeSource = theme === "auto" ? "system" : theme;
  const color = windowBackgroundColor(theme);
  for (const window of BrowserWindow.getAllWindows()) {
    // Explorer windows stay transparent: a color would cover their sidebar material.
    if (!window.isDestroyed() && !explorerWindows.byWindow(window)) {
      window.setBackgroundColor(color);
    }
  }
}

const TRANSPARENT_WINDOW_BACKGROUND = "#00000000";

// Shown only before the page paints (opening, resizing), so light or dark is enough.
function windowBackgroundColor(theme: AppPreferences["theme"]): string {
  const dark = theme === "auto" ? nativeTheme.shouldUseDarkColors : theme === "dark";
  return dark ? "#161618" : "#f4f5f8";
}

function applyWindowZoom(window: BrowserWindow, zoomPercent: number): void {
  window.webContents.setZoomFactor(zoomPercent / 100);
}

// A zoom factor set before the page loads does not always survive the load (Chromium keeps
// zoom per page), so the saved zoom is applied again once each page has loaded; otherwise a
// newly opened Settings window can show at 100% until the zoom next changes.
function keepWindowZoom(window: BrowserWindow, appStateStore: AppStateStore): void {
  applyWindowZoom(window, appStateStore.getPreferences().zoomPercent);
  window.webContents.on("did-finish-load", () => {
    if (!window.isDestroyed()) {
      applyWindowZoom(window, appStateStore.getPreferences().zoomPercent);
    }
  });
}

// Builds the menu with the shortcuts and the text editor chosen in Settings; called again
// when they change.
function buildApplicationMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate(
        { explorerFor: menuExplorerFor },
        {
          onOpenAbout: () => openAboutWindow(),
          onOpenSettings: () => openSettingsWindow(),
          onOpenHelp: (topic) => openHelpWindow(topic),
          includeDeveloperTools: !app.isPackaged || process.env.FILETRAIL_OPEN_DEVTOOLS === "1",
          onCommandSent: () => syncApplicationMenuItems(),
          shortcuts: resolveShortcuts(appStateStoreRef?.getPreferences().shortcutOverrides)
            .bindings,
          textEditorName: appStateStoreRef?.getPreferences().defaultTextEditor.appName,
          undoLabels: currentUndoLabels(),
        },
      ),
    ),
  );
  builtUndoLabels = JSON.stringify(currentUndoLabels());
  syncApplicationMenuItems();
}

// The explorer window a menu command goes to: the focused window when it is one, else the
// one in front (while Settings has the keyboard, or no window has).
function menuExplorerFor(focusedWindow: unknown): ExplorerCommandTarget | null {
  const focused =
    focusedWindow instanceof BrowserWindow && !focusedWindow.isDestroyed() ? focusedWindow : null;
  const focusedEntry = focused ? explorerWindows.byWindow(focused) : null;
  if (focusedEntry) {
    return { contents: focusedEntry.window.webContents, focused: true };
  }
  const front = explorerWindows.front();
  if (!front || front.window.isDestroyed()) {
    return null;
  }
  return { contents: front.window.webContents, focused: focused === null };
}

// The explorer window the menu shows, and whether it has the keyboard. With no window
// focused (the app is in the background) the front window's state stays.
function currentMenuExplorer(): { state: ApplicationMenuState; explorerFocused: boolean } {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  const focusedEntry = focusedWindow ? explorerWindows.byWindow(focusedWindow) : null;
  const entry = focusedEntry ?? explorerWindows.front();
  return {
    state:
      (entry ? applicationMenuStates.get(entry.webContentsId) : undefined) ??
      INITIAL_APPLICATION_MENU_STATE,
    explorerFocused: focusedWindow === null || focusedEntry !== null,
  };
}

function currentUndoLabels(): { undo: string; redo: string } {
  const { state, explorerFocused } = currentMenuExplorer();
  return undoMenuLabels(undoHistoryMenu, state.textEditing || !explorerFocused);
}

// A menu item's label can't be changed in place: the menu is built again when Undo or Redo
// should say something else. Otherwise only what is on and off changes.
function refreshUndoMenu(): void {
  if (!Menu.getApplicationMenu()) {
    return;
  }
  if (JSON.stringify(currentUndoLabels()) !== builtUndoLabels) {
    buildApplicationMenu();
    return;
  }
  syncApplicationMenuItems();
}

// Dims, checks and shows the menu's items for the state the explorer window the menu acts
// on last reported.
function syncApplicationMenuItems(): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    return;
  }
  const { state, explorerFocused } = currentMenuExplorer();
  applyApplicationMenuItemStates(
    menu,
    resolveApplicationMenuItemStates(state, {
      explorerFocused,
      explorerWindowCount: explorerWindows.count,
      undoAvailable: { undo: undoHistoryMenu.undo !== null, redo: undoHistoryMenu.redo !== null },
    }),
  );
}

function resolveAppIconPath(): string | null {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "assets", "icons", "build", "filetrail-1024.png"),
    join(moduleDir, "..", "assets", "icons", "filetrail.svg"),
    join(process.resourcesPath, "app", "dist", "assets", "icons", "build", "filetrail-1024.png"),
    join(process.resourcesPath, "app", "dist", "assets", "icons", "filetrail.svg"),
    join(process.cwd(), "dist", "assets", "icons", "build", "filetrail-1024.png"),
    join(process.cwd(), "dist", "assets", "icons", "filetrail.svg"),
    join(process.cwd(), "assets", "icons", "build", "filetrail-1024.png"),
    join(process.cwd(), "assets", "icons", "filetrail.svg"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function resolveLaunchWorkingDirectory(): string {
  const envPwd = process.env.PWD;
  if (envPwd && isAbsolute(envPwd)) {
    return envPwd;
  }
  return process.cwd();
}

function installProcessLoggingHandlers(logger: ReturnType<typeof createAppLogger>): void {
  if (processLoggingHandlersInstalled) {
    return;
  }
  processLoggingHandlersInstalled = true;
  process.on("uncaughtException", (error) => {
    logger.error("[filetrail] uncaught exception", error);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("[filetrail] unhandled rejection", normalizeUnknownError(reason));
  });
}

// Quitting stops a running copy, move, or delete after the item it is on. While a window
// is open the person is asked first, and may keep working instead. With every window
// closed the operation was already told to stop; quitting waits for it either way.
async function confirmQuit(): Promise<void> {
  if (BrowserWindow.getAllWindows().length > 0 && !(await askToStopOperation("quit"))) {
    return;
  }
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;
  await finalizeShutdown();
}

// Asks whether to stop the running operation, when there is one worth asking about.
// Resolves true when it may be stopped (or nothing needs asking), false to keep working.
async function askToStopOperation(trigger: StopTrigger): Promise<boolean> {
  const operation = getActiveWriteOperation();
  const question = operation ? describeQuitWhileBusy(operation.kind, trigger) : null;
  if (!question) {
    return true;
  }
  stopQuestionOpen = true;
  let response: number;
  try {
    const options = {
      type: "warning" as const,
      message: question.message,
      detail: question.detail,
      buttons: stopQuestionButtons(trigger),
      defaultId: KEEP_WORKING_BUTTON_INDEX,
      cancelId: KEEP_WORKING_BUTTON_INDEX,
    };
    const front = explorerWindows.front()?.window;
    const window = front && !front.isDestroyed() ? front : null;
    ({ response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options));
  } finally {
    stopQuestionOpen = false;
  }
  if (response !== STOP_BUTTON_INDEX) {
    appLoggerRef?.info("[filetrail] kept an operation running instead of stopping it", {
      trigger,
      kind: operation?.kind ?? null,
    });
    return false;
  }
  return true;
}

// Items a crash left half replaced that couldn't be put right: the person is told where
// they are, once the window is on screen.
function showPendingStartupNotices(window: BrowserWindow): void {
  if (pendingStartupNotices.length === 0) {
    return;
  }
  const notices = pendingStartupNotices.splice(0);
  const show = () => {
    if (window.isDestroyed()) {
      return;
    }
    void dialog.showMessageBox(window, {
      type: "warning",
      message:
        notices.length === 1
          ? "An item replaced before File Trail last quit isn't in place yet"
          : "Some items replaced before File Trail last quit aren't in place yet",
      detail: notices.join("\n\n"),
      buttons: ["OK"],
    });
  };
  if (window.webContents.isLoading()) {
    window.webContents.once("did-finish-load", show);
  } else {
    show();
  }
}

async function finalizeShutdown(): Promise<void> {
  const logger = appLoggerRef;
  const state = getMainProcessStatus();
  logger?.info("[filetrail] app stop", {
    phase: "before-quit",
    windowCount: BrowserWindow.getAllWindows().length,
    workerActive: state.workerActive,
    writeCoordinatorActive: state.writeCoordinatorActive,
  });
  // The store is written here, once, with the windows as they are now.
  for (const recordWindowBounds of windowBoundsRecorders.values()) {
    recordWindowBounds();
  }
  appStateStoreRef?.flush();
  try {
    // Stops a running operation and waits until it has cleaned up after itself.
    await shutdownMainProcess();
  } catch (error) {
    logger?.error("[filetrail] shutdown failed", error);
  }
  try {
    await logger?.flush();
  } catch (error) {
    logger?.error("[filetrail] final log flush failed", error);
  }
  app.exit(0);
}

function resolveFdStartupStatus(): { path: string | null; error: string | null } {
  try {
    return {
      path: resolveBundledFdBinaryPath(),
      error: null,
    };
  } catch (error) {
    return {
      path: null,
      error: normalizeUnknownError(error),
    };
  }
}

function normalizeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}
