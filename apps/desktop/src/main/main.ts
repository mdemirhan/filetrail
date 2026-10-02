import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, Menu, app, nativeImage, nativeTheme, shell } from "electron";

import { type AppPreferences, isThemeInGroup } from "../shared/appPreferences";
import {
  type ApplicationMenuState,
  INITIAL_APPLICATION_MENU_STATE,
} from "../shared/applicationMenuState";
import { createAppLogger, isDebugLoggingEnabled, resolveAppLogFilePath } from "./appLog";
import {
  APP_MENU_NAME,
  applyApplicationMenuItemStates,
  createApplicationMenuTemplate,
  resolveApplicationMenuItemStates,
} from "./appMenu";
import { type AppStateStore, createAppStateStore, resolveAppStatePath } from "./appStateStore";
import { bootstrapMainProcess, getMainProcessStatus, shutdownMainProcess } from "./bootstrap";
import { resolveBundledFdBinaryPath } from "./fdBinary";
import { resolveStartupFolderPath } from "./launchContext";
import { removeRetiredActionLogFiles } from "./logRotation";
let mainWindowRef: BrowserWindow | null = null;
let settingsWindowRef: BrowserWindow | null = null;
let appStateStoreRef: AppStateStore | null = null;
// Records the explorer window's size and position in the store; set while it is open.
let recordMainWindowState: (() => void) | null = null;
let appLoggerRef: ReturnType<typeof createAppLogger> | null = null;
// What the explorer window last said the application menu should show.
let applicationMenuState: ApplicationMenuState = INITIAL_APPLICATION_MENU_STATE;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const WINDOW_STATE_SAVE_DELAY_MS = 160;
let shutdownInProgress = false;
let processLoggingHandlersInstalled = false;

if (!hasSingleInstanceLock) {
  app.quit();
}

if (hasSingleInstanceLock) {
  // Electron installs a menu of its own (Reload, Force Reload, Speech…) unless one has been
  // set by the time the app is ready; ours is built with the window.
  Menu.setApplicationMenu(null);
  // The standard About panel reads the bundle, which names Electron in a development run.
  app.setAboutPanelOptions({
    applicationName: APP_MENU_NAME,
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
  });
  // While Settings has the keyboard the explorer's commands do not apply.
  app.on("browser-window-focus", () => syncApplicationMenuItems());

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
      void removeRetiredActionLogFiles(dirname(appLogPath));
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
            }
            if (window.webContents.id !== change.senderId) {
              window.webContents.send("filetrail:preferencesChanged", change.patch);
            }
          }
          if (change.patch.theme !== undefined) {
            applyNativeAppearance(preferences.theme);
          }
        },
        {
          openSettingsWindow,
          setApplicationMenuState: (state, senderId) => {
            if (senderId !== mainWindowRef?.webContents.id) {
              return;
            }
            applicationMenuState = state;
            syncApplicationMenuItems();
          },
        },
      );
      mainWindowRef = createWindow();

      app.on("activate", () => {
        appLogger.info("[filetrail] app activate", {
          openWindowCount: BrowserWindow.getAllWindows().length,
        });
        if (BrowserWindow.getAllWindows().length === 0) {
          mainWindowRef = createWindow();
        }
      });
    })
    .catch(async (error) => {
      appLoggerRef?.error("[filetrail] startup failed", error);
      await appLoggerRef?.flush();
      app.exit(1);
    });

  app.on("before-quit", (event) => {
    if (shutdownInProgress) {
      return;
    }
    shutdownInProgress = true;
    event.preventDefault();
    void finalizeShutdown();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("second-instance", () => {
    appLoggerRef?.info("[filetrail] second instance activation", {
      hasWindow: BrowserWindow.getAllWindows().length > 0,
    });
    const window = mainWindowRef ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!window) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.focus();
  });
}

function createWindow(): BrowserWindow {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    throw new Error("App state store was not initialized before creating the window.");
  }
  const storedWindowState = appStateStore.getWindowState();
  const iconPath = resolveAppIconPath();
  const mainWindow = new BrowserWindow({
    show: false,
    width: storedWindowState.width,
    height: storedWindowState.height,
    ...(typeof storedWindowState.x === "number" ? { x: storedWindowState.x } : {}),
    ...(typeof storedWindowState.y === "number" ? { y: storedWindowState.y } : {}),
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
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  keepWindowZoom(mainWindow, appStateStore);
  // Before the page loads, so the menu bar never shows anything but the app's own menu.
  applyApplicationMenu(mainWindow);
  mainWindow.on("enter-full-screen", () => syncApplicationMenuItems(mainWindow));
  mainWindow.on("leave-full-screen", () => syncApplicationMenuItems(mainWindow));

  const persistWindowState = () => {
    if (mainWindow.isDestroyed()) {
      return;
    }
    const normalBounds = mainWindow.isMaximized()
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds();
    appStateStore.setWindowState({
      x: normalBounds.x,
      y: normalBounds.y,
      width: normalBounds.width,
      height: normalBounds.height,
      maximized: mainWindow.isMaximized(),
    });
  };

  recordMainWindowState = persistWindowState;

  const scheduleWindowStateSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      persistWindowState();
    }, WINDOW_STATE_SAVE_DELAY_MS);
  };

  const rendererEntryUrl = resolveRendererEntryUrl();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== rendererEntryUrl) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    appLoggerRef?.error("[filetrail] renderer process gone", {
      windowId: mainWindow.id,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  mainWindow.webContents.on("unresponsive", () => {
    appLoggerRef?.warn("[filetrail] renderer unresponsive", {
      windowId: mainWindow.id,
    });
  });

  mainWindow.once("ready-to-show", () => {
    if (storedWindowState.maximized) {
      mainWindow.maximize();
    }
    mainWindow.show();
  });

  void mainWindow.loadURL(rendererEntryUrl);

  if (process.env.FILETRAIL_OPEN_DEVTOOLS === "1") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
    if (recordMainWindowState === persistWindowState) {
      recordMainWindowState = null;
    }
    // Settings belongs to the explorer window; closing the explorer still quits the app.
    if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
      settingsWindowRef.close();
    }
  });

  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("maximize", scheduleWindowStateSave);
  mainWindow.on("unmaximize", scheduleWindowStateSave);
  mainWindow.on("close", persistWindowState);

  return mainWindow;
}

// Settings lives in its own window (⌘,), like a native macOS app. Preference edits there
// persist through the same IPC as the explorer window and are broadcast back to it.
function openSettingsWindow(): void {
  const appStateStore = appStateStoreRef;
  if (!appStateStore) {
    return;
  }
  if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
    settingsWindowRef.show();
    settingsWindowRef.focus();
    return;
  }
  const settingsWindow = new BrowserWindow({
    show: false,
    width: 780,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    title: "Settings",
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
  });
  settingsWindowRef = settingsWindow;
  keepWindowZoom(settingsWindow, appStateStore);
  const rendererEntryUrl = resolveRendererEntryUrl();
  const settingsUrl = `${rendererEntryUrl}#settings`;
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
  settingsWindow.once("ready-to-show", () => settingsWindow.show());
  settingsWindow.on("closed", () => {
    if (settingsWindowRef === settingsWindow) {
      settingsWindowRef = null;
    }
  });
  void settingsWindow.loadURL(settingsUrl);
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
// page paints) follow the app's theme rather than the macOS appearance: an explicit
// theme pins them to its light or dark side, "auto" follows the system as the page does.
function applyNativeAppearance(theme: AppPreferences["theme"]): void {
  nativeTheme.themeSource =
    theme === "auto" ? "system" : isThemeInGroup(theme, "dark") ? "dark" : "light";
  const color = windowBackgroundColor(theme);
  for (const window of BrowserWindow.getAllWindows()) {
    // The explorer window stays transparent: a color would cover its sidebar material.
    if (!window.isDestroyed() && window !== mainWindowRef) {
      window.setBackgroundColor(color);
    }
  }
}

const TRANSPARENT_WINDOW_BACKGROUND = "#00000000";

// Shown only before the page paints (opening, resizing), so light or dark is enough.
function windowBackgroundColor(theme: AppPreferences["theme"]): string {
  const dark = theme === "auto" ? nativeTheme.shouldUseDarkColors : isThemeInGroup(theme, "dark");
  return dark ? "#161618" : "#f4f5f8";
}

function applyWindowZoom(mainWindow: BrowserWindow, zoomPercent: number): void {
  mainWindow.webContents.setZoomFactor(zoomPercent / 100);
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

function applyApplicationMenu(mainWindow: BrowserWindow): void {
  // A new window has not reported yet.
  applicationMenuState = INITIAL_APPLICATION_MENU_STATE;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      createApplicationMenuTemplate(mainWindow.webContents, {
        onOpenSettings: openSettingsWindow,
        includeDeveloperTools: !app.isPackaged || process.env.FILETRAIL_OPEN_DEVTOOLS === "1",
        onCommandSent: () => syncApplicationMenuItems(mainWindow),
      }),
    ),
  );
  syncApplicationMenuItems(mainWindow);
}

// Dims, checks and shows the menu's items for the state the explorer window last reported.
function syncApplicationMenuItems(mainWindow: BrowserWindow | null = mainWindowRef): void {
  const menu = Menu.getApplicationMenu();
  if (!menu || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const focusedWindow = BrowserWindow.getFocusedWindow();
  applyApplicationMenuItemStates(
    menu,
    resolveApplicationMenuItemStates(applicationMenuState, {
      // With no window focused (the app is in the background) the explorer's state stays.
      explorerFocused: focusedWindow === null || focusedWindow === mainWindow,
      fullScreen: mainWindow.isFullScreen(),
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

async function finalizeShutdown(): Promise<void> {
  const logger = appLoggerRef;
  const state = getMainProcessStatus();
  logger?.info("[filetrail] app stop", {
    phase: "before-quit",
    windowCount: BrowserWindow.getAllWindows().length,
    workerActive: state.workerActive,
    writeCoordinatorActive: state.writeCoordinatorActive,
  });
  // The store is written here, once, with the window as it is now.
  recordMainWindowState?.();
  appStateStoreRef?.flush();
  try {
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
