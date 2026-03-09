const workerThreadsMock = vi.hoisted(() => {
  class MockWorker {
    readonly listeners = new Map<string, Array<(payload: unknown) => void>>();
    readonly postMessage = vi.fn();
    readonly terminate = vi.fn().mockResolvedValue(0);

    on(event: string, listener: (payload: unknown) => void) {
      const existing = this.listeners.get(event) ?? [];
      existing.push(listener);
      this.listeners.set(event, existing);
      return this;
    }

    emit(event: string, payload: unknown) {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(payload);
      }
    }
  }

  const instances: MockWorker[] = [];
  const Worker = vi.fn().mockImplementation(() => {
    const worker = new MockWorker();
    instances.push(worker);
    return worker;
  });

  return {
    Worker,
    instances,
  };
});

vi.mock("node:worker_threads", () => ({
  Worker: workerThreadsMock.Worker,
}));

describe("ExplorerWorkerClient", () => {
  beforeEach(() => {
    vi.resetModules();
    workerThreadsMock.Worker.mockClear();
    workerThreadsMock.instances.length = 0;
  });

  it("posts requests to the worker and resolves successful responses", async () => {
    const { ExplorerWorkerClient } = await import("./explorerWorkerClient");
    const client = new ExplorerWorkerClient(new URL("file:///worker.js"), {
      fdBinaryPath: "/tmp/fd",
    });
    const worker = workerThreadsMock.instances[0];

    const promise = client.request("path:resolve", {
      path: "/Users/demo",
    });

    expect(worker?.postMessage).toHaveBeenCalledWith({
      id: "worker-1",
      channel: "path:resolve",
      payload: {
        path: "/Users/demo",
      },
    });

    worker?.emit("message", {
      id: "worker-1",
      ok: true,
      payload: { path: "/Users/demo", exists: true, kind: "directory" },
    });

    await expect(promise).resolves.toEqual({
      path: "/Users/demo",
      exists: true,
      kind: "directory",
    });
  });

  it("rejects individual requests when the worker replies with an error envelope", async () => {
    const { ExplorerWorkerClient } = await import("./explorerWorkerClient");
    const client = new ExplorerWorkerClient(new URL("file:///worker.js"));
    const worker = workerThreadsMock.instances[0];

    const promise = client.request("search:cancel", {
      jobId: "job-1",
    });
    worker?.emit("message", {
      id: "worker-1",
      ok: false,
      error: "search failed",
    });

    await expect(promise).rejects.toThrow("search failed");
  });

  it("rejects all pending requests when the worker emits an error or exits unexpectedly", async () => {
    const { ExplorerWorkerClient } = await import("./explorerWorkerClient");
    const client = new ExplorerWorkerClient(new URL("file:///worker.js"));
    const worker = workerThreadsMock.instances[0];

    const first = client.request("app:getHomeDirectory" as never, {} as never);
    const second = client.request("path:getSuggestions", {
      inputPath: "/Users",
      includeHidden: false,
      limit: 10,
    });
    worker?.emit("error", new Error("worker crashed"));

    await expect(first).rejects.toThrow("worker crashed");
    await expect(second).rejects.toThrow("worker crashed");

    const third = client.request("path:resolve", {
      path: "/Users/demo",
    });
    worker?.emit("exit", 2);

    await expect(third).rejects.toThrow("Explorer worker exited with code 2.");
  });

  it("terminates the worker during close", async () => {
    const { ExplorerWorkerClient } = await import("./explorerWorkerClient");
    const client = new ExplorerWorkerClient(new URL("file:///worker.js"));
    const worker = workerThreadsMock.instances[0];

    await client.close();

    expect(worker?.terminate).toHaveBeenCalledTimes(1);
  });
});
