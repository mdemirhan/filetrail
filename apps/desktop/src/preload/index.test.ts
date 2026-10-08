const electronMock = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(),
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
  webUtils: {
    getPathForFile: electronMock.getPathForFile,
  },
}));

async function importPreload() {
  await import("./index");
  const [, api] = electronMock.exposeInMainWorld.mock.calls[0] ?? [];
  return api as {
    invoke: (channel: string, payload: unknown) => Promise<unknown>;
    log: (entry: unknown) => Promise<void>;
    onCommand: (listener: (command: unknown) => void) => () => void;
    onWriteOperationProgress: (listener: (event: unknown) => void) => () => void;
    onCopyPasteProgress: (listener: (event: unknown) => void) => () => void;
    onPreferencesChanged: (listener: (patch: unknown) => void) => () => void;
    getPathForFile: (file: unknown) => string;
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
        log: expect.any(Function),
        onCommand: expect.any(Function),
        onWriteOperationProgress: expect.any(Function),
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

  it("forwards renderer log events through app:writeLog", async () => {
    electronMock.invoke.mockResolvedValue({
      ok: true,
      payload: { ok: true },
    });
    const api = await importPreload();

    await expect(
      api.log({
        level: "error",
        namespace: "filetrail.renderer",
        message: "boom",
        error: "disk full",
        context: { surface: "tree" },
      }),
    ).resolves.toBeUndefined();

    expect(electronMock.invoke).toHaveBeenCalledWith("app:writeLog", {
      level: "error",
      namespace: "filetrail.renderer",
      message: "boom",
      error: "disk full",
      context: { surface: "tree" },
    });
  });

  it("subscribes to renderer commands and unregisters the exact listener", async () => {
    const api = await importPreload();
    const listener = vi.fn();

    const unsubscribe = api.onCommand(listener);
    const [, registeredHandler] = electronMock.on.mock.calls[0] ?? [];
    expect(electronMock.on).toHaveBeenCalledWith("filetrail:command", expect.any(Function));

    (registeredHandler as (event: unknown, command: unknown) => void)({}, { type: "copyPath" });
    expect(listener).toHaveBeenCalledWith({ type: "copyPath" });

    unsubscribe();
    expect(electronMock.removeListener).toHaveBeenCalledWith(
      "filetrail:command",
      registeredHandler,
    );
  });

  it("subscribes to preference changes from other windows", async () => {
    const api = await importPreload();
    const listener = vi.fn();

    const unsubscribe = api.onPreferencesChanged(listener);
    const [, registeredHandler] = electronMock.on.mock.calls[0] ?? [];
    expect(electronMock.on).toHaveBeenCalledWith(
      "filetrail:preferencesChanged",
      expect.any(Function),
    );

    (registeredHandler as (event: unknown, patch: unknown) => void)({}, { theme: "auto" });
    expect(listener).toHaveBeenCalledWith({ theme: "auto" });

    unsubscribe();
    expect(electronMock.removeListener).toHaveBeenCalledWith(
      "filetrail:preferencesChanged",
      registeredHandler,
    );
  });

  it("subscribes to write-operation progress events and unregisters the exact listener", async () => {
    const api = await importPreload();
    const listener = vi.fn();

    const unsubscribe = api.onWriteOperationProgress(listener);
    const [, registeredHandler] = electronMock.on.mock.calls[0] ?? [];
    expect(electronMock.on).toHaveBeenCalledWith(
      "filetrail:writeOperationProgress",
      expect.any(Function),
    );

    (registeredHandler as (event: unknown, payload: unknown) => void)({}, { operationId: "op-1" });
    expect(listener).toHaveBeenCalledWith({ operationId: "op-1" });

    unsubscribe();
    expect(electronMock.removeListener).toHaveBeenCalledWith(
      "filetrail:writeOperationProgress",
      registeredHandler,
    );
  });

  it("tells where a dropped file is on disk, and nothing for what isn't a file", async () => {
    const api = await importPreload();
    const file = { name: "a.txt" };
    electronMock.getPathForFile.mockImplementation((candidate: unknown) => {
      if (candidate !== file) {
        throw new TypeError("not a File");
      }
      return "/Users/other/a.txt";
    });

    expect(api.getPathForFile(file)).toBe("/Users/other/a.txt");
    expect(api.getPathForFile("a.txt")).toBe("");
    electronMock.getPathForFile.mockReturnValue(undefined);
    expect(api.getPathForFile(file)).toBe("");
  });
});
