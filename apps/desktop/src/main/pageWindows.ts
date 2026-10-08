import type { WebPreferences } from "electron";

// What every window of the app (explorer, Settings, Help, About, Acknowledgements) shares:
// a page of the renderer, run with the preload bridge and nothing of Node, that never
// navigates away from its address, opens links to the web in the browser, and keeps the
// app's zoom.

export function pageWebPreferences(preloadPath: string, zoomPercent: number): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    zoomFactor: zoomPercent / 100,
  };
}

// Links the page may open, in the browser or the mail app.
export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

// The parts of a BrowserWindow the setup uses.
export type PageWindowLike = {
  readonly webContents: {
    setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" }): void;
    on(
      event: "will-navigate",
      listener: (event: { preventDefault(): void }, url: string) => void,
    ): unknown;
    on(event: "did-finish-load", listener: () => void): unknown;
    setZoomFactor(factor: number): void;
  };
  isDestroyed(): boolean;
  loadURL(url: string): Promise<unknown>;
};

/** Sets up the window's page and loads `url` in it. */
export function loadPageWindow(
  window: PageWindowLike,
  url: string,
  options: {
    // The app's zoom now; it can change while the window is open.
    zoomPercent: () => number;
    openExternal: (url: string) => void;
  },
): void {
  window.webContents.setWindowOpenHandler(({ url: openedUrl }) => {
    if (isAllowedExternalUrl(openedUrl)) {
      options.openExternal(openedUrl);
    }
    return { action: "deny" };
  });
  // A change within the page (its address's "#…") isn't a navigation and isn't stopped.
  window.webContents.on("will-navigate", (event, navigationUrl) => {
    if (navigationUrl !== url) {
      event.preventDefault();
    }
  });
  // A zoom factor set before the page loads does not always survive the load (Chromium
  // keeps zoom per page), so the saved zoom is applied again once each page has loaded;
  // otherwise a newly opened Settings window can show at 100% until the zoom next changes.
  window.webContents.setZoomFactor(options.zoomPercent() / 100);
  window.webContents.on("did-finish-load", () => {
    if (!window.isDestroyed()) {
      window.webContents.setZoomFactor(options.zoomPercent() / 100);
    }
  });
  void window.loadURL(url);
}
