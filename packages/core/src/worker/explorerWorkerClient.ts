import { Worker } from "node:worker_threads";

import type { IpcChannel, IpcRequest, IpcResponse } from "@filetrail/contracts";

export type WorkerSupportedChannel = Extract<
  IpcChannel,
  | "tree:getChildren"
  | "directory:getSnapshot"
  | "directory:getMetadataBatch"
  | "item:getProperties"
  | "path:getSuggestions"
  | "path:resolve"
  | "search:start"
  | "search:getUpdate"
  | "search:cancel"
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

// The worker's answer once it has stopped its searches, before it is ended.
type WorkerClosed = { closed: true };

// How long ending the worker waits for it to stop its searches: a worker busy in a
// synchronous call answers late, and is ended anyway.
export const WORKER_CLOSE_ANSWER_WITHIN_MS = 1_000;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class ExplorerWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();
  private sequence = 0;
  private onClosed: (() => void) | null = null;
  private exited = false;

  constructor(workerUrl: URL, workerData?: unknown) {
    this.worker = new Worker(workerUrl, workerData === undefined ? undefined : { workerData });
    this.worker.on("message", (message: WorkerResponse<WorkerSupportedChannel> | WorkerClosed) => {
      if ("closed" in message) {
        this.onClosed?.();
        return;
      }
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
      this.exited = true;
      this.onClosed?.();
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

  // The worker stops its searches first: their fd processes aren't ended with it, and
  // would go on searching the disk after the app has quit.
  async close(): Promise<void> {
    if (!this.exited) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, WORKER_CLOSE_ANSWER_WITHIN_MS);
        function done(): void {
          clearTimeout(timer);
          resolve();
        }
        this.onClosed = done;
        this.worker.postMessage({ close: true });
      });
      this.onClosed = null;
    }
    await this.worker.terminate();
  }
}
