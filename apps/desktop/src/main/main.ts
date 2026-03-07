import { fileURLToPath, pathToFileURL } from "node:url";
import { BrowserWindow, app, nativeTheme, shell } from "electron";

import { type AppStateStore, createAppStateStore, resolveAppStatePath } from "./appStateStore";
import { bootstrapMainProcess, shutdownMainProcess } from "./bootstrap";

let mainWindowRef: BrowserWindow | null = null;
let appStateStoreRef: AppStateStore | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
const WINDOW_STATE_SAVE_DELAY_MS = 160;

if (!hasSingleInstanceLock) {
  app.quit();
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    const appStateStore = createAppStateStore(resolveAppStatePath(app.getPath("userData")), {
      defaultTheme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    });
    appStateStoreRef = appStateStore;
    await bootstrapMainProcess(appStateStore);
    mainWindowRef = createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindowRef = createWindow();
      }
    });
  });

  app.on("before-quit", () => {
    appStateStoreRef?.flush();
    void shutdownMainProcess();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("second-instance", () => {
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
  const mainWindow = new BrowserWindow({
    show: false,
    width: storedWindowState.width,
    height: storedWindowState.height,
    ...(typeof storedWindowState.x === "number" ? { x: storedWindowState.x } : {}),
    ...(typeof storedWindowState.y === "number" ? { y: storedWindowState.y } : {}),
    minWidth: 1080,
    minHeight: 720,
    title: "File Trail",
    backgroundColor: "#f4f5f8",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 16 },
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.cjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;

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

  const scheduleWindowStateSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveTimeout = null;
      persistWindowState();
    }, WINDOW_STATE_SAVE_DELAY_MS);
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => {
    if (storedWindowState.maximized) {
      mainWindow.maximize();
    }
    mainWindow.show();
  });

  const rendererUrl = process.env.FILETRAIL_RENDERER_URL;
  if (rendererUrl && rendererUrl.length > 0) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    const rendererPath = fileURLToPath(new URL("../renderer/index.html", import.meta.url));
    void mainWindow.loadURL(pathToFileURL(rendererPath).toString());
  }

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
  });

  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("maximize", scheduleWindowStateSave);
  mainWindow.on("unmaximize", scheduleWindowStateSave);
  mainWindow.on("close", persistWindowState);

  return mainWindow;
}
