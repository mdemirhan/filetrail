import { Worker } from "node:worker_threads";

import type { IpcChannel, IpcRequest, IpcResponse } from "@filetrail/contracts";

type WorkerSupportedChannel = Extract<
  IpcChannel,
  | "tree:getChildren"
  | "directory:getSnapshot"
  | "directory:getMetadataBatch"
  | "item:getProperties"
  | "path:getSuggestions"
>;

type WorkerRequest<C extends WorkerSupportedChannel> = {
  id: string;
  channel: C;
  payload: IpcRequest<C>;
};

type WorkerResponse<C extends WorkerSupportedChannel> =
  | {
      id: string;
      ok: true;
      payload: IpcResponse<C>;
    }
  | {
      id: string;
      ok: false;
      error: string;
    };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class ExplorerWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;

  constructor(workerUrl: URL) {
    this.worker = new Worker(workerUrl);
    this.worker.on("message", (message: WorkerResponse<WorkerSupportedChannel>) => {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message.payload);
        return;
      }
      pending.reject(new Error(message.error));
    });
    this.worker.on("error", (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });
    this.worker.on("exit", (code) => {
      if (code === 0) {
        return;
      }
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Explorer worker exited with code ${code}.`));
      }
      this.pending.clear();
    });
  }

  request<C extends WorkerSupportedChannel>(
    channel: C,
    payload: IpcRequest<C>,
  ): Promise<IpcResponse<C>> {
    const id = `worker-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as IpcResponse<C>),
        reject,
      });
      this.worker.postMessage({
        id,
        channel,
        payload,
      } satisfies WorkerRequest<C>);
    });
  }

  async close(): Promise<void> {
    await this.worker.terminate();
  }
}
