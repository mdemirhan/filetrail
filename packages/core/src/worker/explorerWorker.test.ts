const workerModuleMock = vi.hoisted(() => {
  const handlers: Record<string, ((payload: unknown) => void) | undefined> = {};
  const parentPort = {
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      handlers[event] = listener;
    }),
    postMessage: vi.fn(),
  };

  return {
    handlers,
    parentPort,
    workerData: {
      fdBinaryPath: "/tmp/fd",
    },
  };
});

const explorerServiceMock = vi.hoisted(() => ({
  listTreeChildren: vi.fn(),
  listDirectorySnapshot: vi.fn(),
  getDirectoryMetadataBatch: vi.fn(),
  getItemProperties: vi.fn(),
  getPathSuggestions: vi.fn(),
  resolvePathTarget: vi.fn(),
}));

const searchRuntimeMock = vi.hoisted(() => {
  const instance = {
    startSearch: vi.fn(),
    getUpdate: vi.fn(),
    cancelSearch: vi.fn(),
  };
  return {
    FdSearchRuntime: vi.fn(() => instance),
    instance,
  };
});

const contractMock = vi.hoisted(() => {
  const identity = vi.fn((value: unknown) => value);
  return {
    identity,
    ipcContractSchemas: {
      "tree:getChildren": { request: { parse: identity } },
      "directory:getSnapshot": { request: { parse: identity } },
      "directory:getMetadataBatch": { request: { parse: identity } },
      "item:getProperties": { request: { parse: identity } },
      "path:getSuggestions": { request: { parse: identity } },
      "path:resolve": { request: { parse: identity } },
      "search:start": { request: { parse: identity } },
      "search:getUpdate": { request: { parse: identity } },
      "search:cancel": { request: { parse: identity } },
    },
  };
});

const childProcessMock = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("node:worker_threads", () => ({
  parentPort: workerModuleMock.parentPort,
  workerData: workerModuleMock.workerData,
}));

vi.mock("node:child_process", () => ({
  spawn: childProcessMock.spawn,
}));

vi.mock("@filetrail/contracts", () => ({
  ipcContractSchemas: contractMock.ipcContractSchemas,
}));

vi.mock("../fs/explorerService", () => explorerServiceMock);

vi.mock("../search/fdSearch", () => ({
  FdSearchRuntime: searchRuntimeMock.FdSearchRuntime,
}));

async function importWorkerModule() {
  await import("./explorerWorker");
  return workerModuleMock.handlers.message;
}

async function flushWorkerQueue() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("explorerWorker", () => {
  beforeEach(() => {
    vi.resetModules();
    workerModuleMock.parentPort.on.mockClear();
    workerModuleMock.parentPort.postMessage.mockReset();
    workerModuleMock.handlers.message = undefined;
    childProcessMock.spawn.mockReset();
    for (const mockFn of Object.values(explorerServiceMock)) {
      mockFn.mockReset();
    }
    searchRuntimeMock.FdSearchRuntime.mockClear();
    searchRuntimeMock.instance.startSearch.mockReset();
    searchRuntimeMock.instance.getUpdate.mockReset();
    searchRuntimeMock.instance.cancelSearch.mockReset();
  });

  it("registers the worker message loop and routes filesystem requests", async () => {
    explorerServiceMock.listTreeChildren.mockResolvedValue({
      path: "/Users/demo",
      children: [],
    });
    explorerServiceMock.resolvePathTarget.mockResolvedValue({
      path: "/Users/demo",
      exists: true,
      kind: "directory",
    });

    const onMessage = await importWorkerModule();
    expect(workerModuleMock.parentPort.on).toHaveBeenCalledWith("message", expect.any(Function));

    onMessage?.({
      id: "req-1",
      channel: "tree:getChildren",
      payload: { path: "/Users/demo", includeHidden: false },
    });
    await flushWorkerQueue();

    expect(explorerServiceMock.listTreeChildren).toHaveBeenCalledWith("/Users/demo", false);
    expect(workerModuleMock.parentPort.postMessage).toHaveBeenLastCalledWith({
      id: "req-1",
      ok: true,
      payload: {
        path: "/Users/demo",
        children: [],
      },
    });

    onMessage?.({
      id: "req-2",
      channel: "path:resolve",
      payload: { path: "/Users/demo" },
    });
    await flushWorkerQueue();

    expect(explorerServiceMock.resolvePathTarget).toHaveBeenCalledWith("/Users/demo");
    expect(workerModuleMock.parentPort.postMessage).toHaveBeenLastCalledWith({
      id: "req-2",
      ok: true,
      payload: {
        path: "/Users/demo",
        exists: true,
        kind: "directory",
      },
    });
  });

  it("routes search channels through the fd runtime", async () => {
    searchRuntimeMock.instance.startSearch.mockReturnValue({ jobId: "job-1" });
    searchRuntimeMock.instance.getUpdate.mockReturnValue({
      jobId: "job-1",
      status: "running",
      items: [],
      nextCursor: 0,
      done: false,
      truncated: false,
      error: null,
    });
    searchRuntimeMock.instance.cancelSearch.mockReturnValue({ ok: true });

    const onMessage = await importWorkerModule();

    onMessage?.({
      id: "req-1",
      channel: "search:start",
      payload: {
        rootPath: "/Users/demo",
        query: "*.ts",
        patternMode: "glob",
        matchScope: "name",
        recursive: true,
        includeHidden: false,
      },
    });
    await flushWorkerQueue();
    expect(searchRuntimeMock.instance.startSearch).toHaveBeenCalled();

    onMessage?.({
      id: "req-2",
      channel: "search:getUpdate",
      payload: { jobId: "job-1", cursor: 0 },
    });
    await flushWorkerQueue();
    expect(searchRuntimeMock.instance.getUpdate).toHaveBeenCalledWith("job-1", 0);

    onMessage?.({
      id: "req-3",
      channel: "search:cancel",
      payload: { jobId: "job-1" },
    });
    await flushWorkerQueue();
    expect(searchRuntimeMock.instance.cancelSearch).toHaveBeenCalledWith("job-1");
  });

  it("returns an error envelope when request handling throws", async () => {
    explorerServiceMock.getItemProperties.mockRejectedValue(new Error("permission denied"));
    const onMessage = await importWorkerModule();

    onMessage?.({
      id: "req-1",
      channel: "item:getProperties",
      payload: { path: "/Users/demo/secret.txt" },
    });
    await flushWorkerQueue();

    expect(workerModuleMock.parentPort.postMessage).toHaveBeenLastCalledWith({
      id: "req-1",
      ok: false,
      error: "permission denied",
    });
  });

  it("deprioritizes metadata requests behind other queued work", async () => {
    let releaseTree: () => void = () => {
      throw new Error("Expected tree request to be pending before releasing it.");
    };
    explorerServiceMock.listTreeChildren.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTree = () => resolve({ path: "/Users/demo", children: [] });
        }),
    );
    explorerServiceMock.resolvePathTarget.mockResolvedValue({
      path: "/Users/demo/project",
      exists: true,
      kind: "directory",
    });
    explorerServiceMock.getDirectoryMetadataBatch.mockResolvedValue({
      directoryPath: "/Users/demo",
      items: [],
    });

    const onMessage = await importWorkerModule();

    onMessage?.({
      id: "req-1",
      channel: "tree:getChildren",
      payload: { path: "/Users/demo", includeHidden: false },
    });
    onMessage?.({
      id: "req-2",
      channel: "directory:getMetadataBatch",
      payload: { directoryPath: "/Users/demo", paths: [] },
    });
    onMessage?.({
      id: "req-3",
      channel: "path:resolve",
      payload: { path: "/Users/demo/project" },
    });

    releaseTree();
    await flushWorkerQueue();

    expect(workerModuleMock.parentPort.postMessage.mock.calls.map(([message]) => message.id)).toEqual(
      ["req-1", "req-3", "req-2"],
    );
  });
});
