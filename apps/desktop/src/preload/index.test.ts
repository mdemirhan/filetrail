const electronMock = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: electronMock.exposeInMainWorld,
  },
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    removeListener: electronMock.removeListener,
  },
}));

async function importPreload() {
  await import("./index");
  const [, api] = electronMock.exposeInMainWorld.mock.calls[0] ?? [];
  return api as {
    invoke: (channel: string, payload: unknown) => Promise<unknown>;
    onCommand: (listener: (command: unknown) => void) => () => void;
    onCopyPasteProgress: (listener: (event: unknown) => void) => () => void;
  };
}

describe("preload bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    electronMock.exposeInMainWorld.mockReset();
    electronMock.invoke.mockReset();
    electronMock.on.mockReset();
    electronMock.removeListener.mockReset();
  });

  it("exposes a filetrail bridge in the renderer global", async () => {
    await importPreload();

    expect(electronMock.exposeInMainWorld).toHaveBeenCalledWith(
      "filetrail",
      expect.objectContaining({
        invoke: expect.any(Function),
        onCommand: expect.any(Function),
        onCopyPasteProgress: expect.any(Function),
      }),
    );
  });

  it("unwraps successful invoke responses", async () => {
    electronMock.invoke.mockResolvedValue({
      ok: true,
      payload: { path: "/Users/demo" },
    });
    const api = await importPreload();

    await expect(api.invoke("app:getHomeDirectory", {})).resolves.toEqual({
      path: "/Users/demo",
    });
    expect(electronMock.invoke).toHaveBeenCalledWith("app:getHomeDirectory", {});
  });

  it("throws the main-process error message for failed invokes", async () => {
    electronMock.invoke.mockResolvedValue({
      ok: false,
      error: "boom",
    });
    const api = await importPreload();

    await expect(api.invoke("app:getHomeDirectory", {})).rejects.toThrow("boom");
  });

  it("subscribes to renderer commands and unregisters the exact listener", async () => {
    const api = await importPreload();
    const listener = vi.fn();

    const unsubscribe = api.onCommand(listener);
    const [, registeredHandler] = electronMock.on.mock.calls[0] ?? [];
    expect(electronMock.on).toHaveBeenCalledWith("filetrail:command", expect.any(Function));

    (registeredHandler as (event: unknown, command: unknown) => void)(
      {},
      { type: "copyPath" },
    );
    expect(listener).toHaveBeenCalledWith({ type: "copyPath" });

    unsubscribe();
    expect(electronMock.removeListener).toHaveBeenCalledWith(
      "filetrail:command",
      registeredHandler,
    );
  });

  it("subscribes to copy/paste progress events and unregisters the exact listener", async () => {
    const api = await importPreload();
    const listener = vi.fn();

    const unsubscribe = api.onCopyPasteProgress(listener);
    const [, registeredHandler] = electronMock.on.mock.calls[0] ?? [];
    expect(electronMock.on).toHaveBeenCalledWith(
      "filetrail:copyPasteProgress",
      expect.any(Function),
    );

    (registeredHandler as (event: unknown, payload: unknown) => void)({}, { operationId: "op-1" });
    expect(listener).toHaveBeenCalledWith({ operationId: "op-1" });

    unsubscribe();
    expect(electronMock.removeListener).toHaveBeenCalledWith(
      "filetrail:copyPasteProgress",
      registeredHandler,
    );
  });
});
