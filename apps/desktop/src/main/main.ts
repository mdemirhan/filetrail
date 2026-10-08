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

import type { AppPreferences } from "../shared/appPreferences";
import { resolveShortcuts } from "../shared/shortcuts";
import { createAppLogger, isDebugLoggingEnabled, resolveAppLogFilePath } from "./appLog";
import { APP_MENU_NAME, createApplicationMenuTemplate } from "./appMenu";
import {
  type AppStateStore,
  type StoredExplorerWindow,
  createAppStateStore,
  resolveAppStatePath,
} from "./appStateStore";
import { ApplicationMenuSync } from "./applicationMenuSync";
import {
  bootstrapMainProcess,
  getActiveWriteOperation,
  getMainProcessStatus,
  shutdownMainProcess,
} from "./bootstrap";
import { ExplorerWindowController } from "./explorerWindowController";
import { resolveBundledFdBinaryPath } from "./fdBinary";
import { resolveStartupFolderPath } from "./launchContext";
import { loadPageWindow, pageWebPreferences } from "./pageWindows";
import { readSettingsTabFromUrl } from "./settingsWindowTab";
import { WindowTabsRequests } from "./windowIpcHandlers";

// The explorer windows: opening, closing, merging, and quitting.
let explorerWindowsRef: ExplorerWindowController<BrowserWindow> | null = null;
// What the application menu shows, for the explorer window it acts on.
let menuSyncRef: ApplicationMenuSync<BrowserWindow> | null = null;
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
let appLoggerRef: ReturnType<typeof createAppLogger> | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let processLoggingHandlersInstalled = false;
// Found while starting, before the window opened; shown once it has.
const pendingStartupNotices: string[] = [];
const PRELOAD_PATH = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

if (!hasSingleInstanceLock) {
  app.quit();
}

if (hasSingleInstanceLock) {
  // Electron installs a menu of its own (Reload, Force Reload, Speech…) unless one has been
  // set by the time the app is ready; ours is built with the window.
  Menu.setApplicationMenu(null);
  // While Settings has the keyboard the explorer's commands do not apply, and its Undo is
  // its text fields'.
  app.on("browser-window-focus", () => menuSyncRef?.refresh());

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
      const startupFolderPath = resolveStartupFolderPath(
        process.argv,
        resolveLaunchWorkingDirectory(),
        {
          appPath: app.getAppPath(),
          argvOffset: process.defaultApp ? 2 : 1,
        },
      );
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
        startupFolderPath,
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
      const tabsRequests = new WindowTabsRequests();
      const explorerWindows = createExplorerWindowController(appStateStore, tabsRequests);
      explorerWindowsRef = explorerWindows;
      menuSyncRef = new ApplicationMenuSync<BrowserWindow>({
        windows: explorerWindows.windows,
        focusedWindow: () => BrowserWindow.getFocusedWindow(),
        menu: () => Menu.getApplicationMenu(),
        build: () => buildApplicationMenu(),
      });
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
        {
          openSettingsWindow,
          openAcknowledgementsWindow,
          openHelpWindow,
          showStartupNotices: (notices) => {
            pendingStartupNotices.push(...notices);
          },
          showRecoveryNotices: (notices) => {
            const window = explorerWindows.frontWindow();
            const options = {
              type: "info" as const,
              message:
                notices.length === 1
                  ? "An item waiting for its disk is in place now"
                  : "Items waiting for their disk are in place now",
              detail: notices.join("\n\n"),
              buttons: ["OK"],
            };
            // With no window open it stands on its own.
            void (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));
          },
          setApplicationMenuState: (state, senderId) =>
            menuSyncRef?.setWindowState(senderId, state),
          onUndoHistoryChanged: (menu) => menuSyncRef?.setUndoHistory(menu),
          explorerWindowIdOf: (senderId) => explorerWindows.windowIdOf(senderId),
          launchContextFor: (senderId) => explorerWindows.launchContextFor(senderId),
          openExplorerWindow: (senderId, tabs, activeTabIndex) =>
            explorerWindows.openWindowFrom(senderId, tabs, activeTabIndex),
          mergeExplorerWindows: (senderId, tabCount) =>
            explorerWindows.mergeInto(senderId, tabCount),
          answerMergeRequest: (senderId, requestId, answer) =>
            tabsRequests.answer(senderId, requestId, answer),
          explorerWindowCount: () => explorerWindows.windows.count,
          closeExplorerWindow: (senderId) => explorerWindows.closeWindowOf(senderId),
          successorWindowOf: (senderId) => explorerWindows.successorOf(senderId),
          sendToOtherWindows: (senderId, channel, payload) => {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed() && window.webContents.id !== senderId) {
                window.webContents.send(channel, payload);
              }
            }
          },
        },
        (preferences, change) => {
          // Keep every open window (explorer and Settings) on the same preferences.
          for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed()) {
              continue;
            }
            // Setting the zoom, even to the value it has, makes Chromium rewrite its own
            // preferences file; most changes (the folder on screen, say) are not the zoom.
            if (change.patch.zoomPercent !== undefined) {
              window.webContents.setZoomFactor(preferences.zoomPercent / 100);
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
        appLogger,
      );
      // Before the windows open, so the menu bar never shows anything but the app's own menu.
      buildApplicationMenu();
      app.dock?.setMenu(
        Menu.buildFromTemplate([
          { label: "New Window", click: () => explorerWindows.openNewWindowFromFront() },
        ]),
      );
      explorerWindows.openStartupWindows(startupFolderPath);
      const frontWindow = explorerWindows.frontWindow();
      if (frontWindow) {
        showPendingStartupNotices(frontWindow);
      }

      app.on("activate", () => {
        appLogger.info("[filetrail] app activate", {
          openWindowCount: BrowserWindow.getAllWindows().length,
          explorerWindowCount: explorerWindows.windows.count,
        });
        explorerWindows.activate();
      });
    })
    .catch(async (error) => {
      appLoggerRef?.error("[filetrail] startup failed", error);
      await appLoggerRef?.flush();
      app.exit(1);
    });

  // The app always ends through the controller's quit, which ends in app.exit and doesn't
  // come back here. A second quit while it waits for an operation to stop must not cut
  // that wait short.
  app.on("before-quit", (event) => {
    event.preventDefault();
    const explorerWindows = explorerWindowsRef;
    if (!explorerWindows) {
      app.exit(0);
      return;
    }
    void explorerWindows.quit();
  });

  // Closing the last window leaves the app open, as Finder does: a click on the Dock icon,
  // New Window or a place in the Go menu opens a window again. (Without this listener
  // Electron would quit.)
  app.on("window-all-closed", () => undefined);

  app.on("second-instance", () => {
    appLoggerRef?.info("[filetrail] second instance activation", {
      hasWindow: BrowserWindow.getAllWindows().length > 0,
    });
    explorerWindowsRef?.bringToFront();
  });
}

function createExplorerWindowController(
  appStateStore: AppStateStore,
  tabsRequests: WindowTabsRequests,
): ExplorerWindowController<BrowserWindow> {
  return new ExplorerWindowController<BrowserWindow>({
    store: appStateStore,
    createWindow: (record) => createExplorerBrowserWindow(record, appStateStore),
    newWindowId: () => `window-${randomUUID()}`,
    workAreaFor: (bounds) => screen.getDisplayMatching(bounds).workArea,
    activeOperation: () => getActiveWriteOperation(),
    showStopQuestion: async (question, parent) =>
      (parent
        ? await dialog.showMessageBox(parent, { type: "warning", ...question })
        : await dialog.showMessageBox({ type: "warning", ...question })
      ).response,
    requestTabs: (window) => tabsRequests.ask(window.webContents),
    anyWindowOpen: () => BrowserWindow.getAllWindows().length > 0,
    windowsChanged: () => menuSyncRef?.windowsChanged(),
    shutDown: async () => {
      const logger = appLoggerRef;
      const state = getMainProcessStatus();
      logger?.info("[filetrail] app stop", {
        phase: "before-quit",
        windowCount: BrowserWindow.getAllWindows().length,
        workerActive: state.workerActive,
        writeCoordinatorActive: state.writeCoordinatorActive,
      });
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
    },
    exit: () => app.exit(0),
    logger: { info: (message, details) => appLoggerRef?.info(message, details) },
  });
}

// An explorer window, hidden until its page is ready; the controller shows it.
function createExplorerBrowserWindow(
  record: StoredExplorerWindow,
  appStateStore: AppStateStore,
): BrowserWindow {
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
    webPreferences: pageWebPreferences(PRELOAD_PATH, appStateStore.getPreferences().zoomPercent),
    ...(iconPath ? { icon: iconPath } : {}),
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
  loadAppPage(explorerWindow, resolveRendererEntryUrl(), appStateStore);
  if (process.env.FILETRAIL_OPEN_DEVTOOLS === "1") {
    explorerWindow.webContents.openDevTools({ mode: "detach" });
  }
  return explorerWindow;
}

// Every window of the app shows a page of the renderer: links open in the browser, the page
// stays at its address, and the app's zoom holds.
function loadAppPage(window: BrowserWindow, url: string, appStateStore: AppStateStore): void {
  loadPageWindow(window, url, {
    zoomPercent: () => appStateStore.getPreferences().zoomPercent,
    openExternal: (externalUrl) => void shell.openExternal(externalUrl),
  });
}

// A window that is a page of the renderer other than the explorer (Settings, Help, About),
// hidden until its page is ready.
function createPageBrowserWindow(
  appStateStore: AppStateStore,
  options: BrowserWindowConstructorOptions,
): BrowserWindow {
  const preferences = appStateStore.getPreferences();
  return new BrowserWindow({
    show: false,
    backgroundColor: windowBackgroundColor(preferences.theme),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: pageWebPreferences(PRELOAD_PATH, preferences.zoomPercent),
    ...options,
  });
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
  const settingsWindow = createPageBrowserWindow(appStateStore, {
    width: 720,
    height: 540,
    minWidth: 680,
    minHeight: 420,
    title: "Settings",
    // Placed as in the explorer window, whose sidebar and title row are as tall.
    trafficLightPosition: { x: 14, y: 16 },
    fullscreenable: false,
  });
  settingsWindowRef = settingsWindow;
  // The tab to open on follows "#settings" in the address: the one asked for, or the one
  // Settings was left on.
  const openOnTab = tab ?? lastSettingsTab;
  const settingsUrl = `${resolveRendererEntryUrl()}#settings${openOnTab ? `/${openOnTab}` : ""}`;
  const rememberTab = (url: string) => {
    lastSettingsTab = readSettingsTabFromUrl(url) ?? lastSettingsTab;
  };
  // The window puts the tab on screen in its address (a change within the page, which the
  // navigation guard lets through).
  settingsWindow.webContents.on("did-navigate-in-page", (_event, url) => rememberTab(url));
  settingsWindow.on("close", () => rememberTab(settingsWindow.webContents.getURL()));
  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  settingsWindow.on("closed", () => {
    if (settingsWindowRef === settingsWindow) {
      settingsWindowRef = null;
    }
  });
  loadAppPage(settingsWindow, settingsUrl, appStateStore);
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
  const helpWindow = createPageBrowserWindow(appStateStore, {
    width: 900,
    height: 680,
    minWidth: 560,
    minHeight: 420,
    title: "File Trail Help",
  });
  helpWindowRef = helpWindow;
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
  // The window keeps its address in step with the page on screen.
  helpWindow.webContents.on("did-navigate-in-page", (_event, url) => rememberTopic(url));
  helpWindow.on("close", () => rememberTopic(helpWindow.webContents.getURL()));
  helpWindow.once("ready-to-show", () => helpWindow.show());
  helpWindow.on("closed", () => {
    if (helpWindowRef === helpWindow) {
      helpWindowRef = null;
    }
  });
  loadAppPage(helpWindow, helpUrl, appStateStore);
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
  const window = createPageBrowserWindow(appStateStore, { fullscreenable: false, ...options });
  window.once("ready-to-show", () => window.show());
  loadAppPage(window, `${resolveRendererEntryUrl()}#${page}`, appStateStore);
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

// Native parts of the window (title bar, scroll bars, pickers, the empty window before the
// page paints) follow the app's theme rather than the macOS appearance: Light or Dark pins
// them, "auto" follows the system as the page does.
function applyNativeAppearance(theme: AppPreferences["theme"]): void {
  nativeTheme.themeSource = theme === "auto" ? "system" : theme;
  const color = windowBackgroundColor(theme);
  for (const window of BrowserWindow.getAllWindows()) {
    // Explorer windows stay transparent: a color would cover their sidebar material.
    if (!window.isDestroyed() && !explorerWindowsRef?.windows.byWindow(window)) {
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

// Builds the menu with the shortcuts and the text editor chosen in Settings; called again
// when they change.
function buildApplicationMenu(): void {
  const menuSync = menuSyncRef;
  if (!menuSync) {
    return;
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate(
        { explorerFor: (focusedWindow) => menuSync.explorerFor(focusedWindow) },
        {
          onOpenAbout: () => openAboutWindow(),
          onOpenSettings: () => openSettingsWindow(),
          onOpenHelp: (topic) => openHelpWindow(topic),
          includeDeveloperTools: !app.isPackaged || process.env.FILETRAIL_OPEN_DEVTOOLS === "1",
          onCommandSent: () => menuSync.sync(),
          shortcuts: resolveShortcuts(appStateStoreRef?.getPreferences().shortcutOverrides)
            .bindings,
          textEditorName: appStateStoreRef?.getPreferences().defaultTextEditor.appName,
          undoLabels: menuSync.undoLabels(),
          // With no window open, New Window and the Go menu's places open one.
          onCommandWithoutExplorerWindow: (type) =>
            explorerWindowsRef?.openDefaultWindow(type === "newWindow" ? undefined : type),
          onNewWindowFromOtherWindow: () => explorerWindowsRef?.openNewWindowFromFront(),
        },
      ),
    ),
  );
  menuSync.menuBuilt();
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
