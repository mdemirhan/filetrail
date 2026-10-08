import { isAllowedExternalUrl, loadPageWindow, pageWebPreferences } from "./pageWindows";

function fakePageWindow() {
  const listeners = new Map<string, (...args: never[]) => void>();
  let openHandler: ((details: { url: string }) => { action: "deny" }) | null = null;
  const window = {
    destroyed: false,
    zoomFactors: [] as number[],
    loaded: [] as string[],
    webContents: {
      setWindowOpenHandler: (handler: (details: { url: string }) => { action: "deny" }) => {
        openHandler = handler;
      },
      on: (event: string, listener: (...args: never[]) => void) => {
        listeners.set(event, listener);
      },
      setZoomFactor: (factor: number) => {
        window.zoomFactors.push(factor);
      },
    },
    isDestroyed: () => window.destroyed,
    loadURL: async (url: string) => {
      window.loaded.push(url);
    },
  };
  return {
    window,
    open: (url: string) => openHandler?.({ url }),
    navigate: (url: string) => {
      let prevented = false;
      (listeners.get("will-navigate") as (event: unknown, url: string) => void)(
        {
          preventDefault: () => {
            prevented = true;
          },
        },
        url,
      );
      return prevented;
    },
    finishLoad: () => (listeners.get("did-finish-load") as () => void)(),
  };
}

describe("pageWindows", () => {
  it("runs the page with the preload bridge and nothing of Node, at the app's zoom", () => {
    expect(pageWebPreferences("/app/preload.cjs", 125)).toEqual({
      preload: "/app/preload.cjs",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: 1.25,
    });
  });

  it("opens only web and mail links outside the app", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("mailto:someone@example.com")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(false);
    expect(isAllowedExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedExternalUrl("not a url")).toBe(false);
  });

  it("keeps the page at its address, opens links in the browser, and keeps the zoom", () => {
    const page = fakePageWindow();
    const openExternal = vi.fn();
    let zoomPercent = 110;

    loadPageWindow(page.window, "file:///app/index.html#settings", {
      zoomPercent: () => zoomPercent,
      openExternal,
    });

    expect(page.window.loaded).toEqual(["file:///app/index.html#settings"]);
    expect(page.navigate("https://example.com")).toBe(true);
    expect(page.navigate("file:///app/index.html#settings")).toBe(false);
    expect(page.open("https://example.com/help")).toEqual({ action: "deny" });
    expect(page.open("file:///etc/passwd")).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://example.com/help");
    zoomPercent = 90;
    page.finishLoad();
    page.window.destroyed = true;
    page.finishLoad();
    expect(page.window.zoomFactors).toEqual([1.1, 0.9]);
  });
});
