import { parentPort } from "node:worker_threads";

import { type IpcChannel, ipcContractSchemas } from "@filetrail/contracts";
import {
  getDirectoryMetadataBatch,
  getItemProperties,
  getPathSuggestions,
  listDirectorySnapshot,
  listTreeChildren,
  resolvePathTarget,
} from "../fs/explorerService";

type WorkerRequest = {
  id: string;
  channel: Extract<
    IpcChannel,
    | "tree:getChildren"
    | "directory:getSnapshot"
    | "directory:getMetadataBatch"
    | "item:getProperties"
    | "path:getSuggestions"
    | "path:resolve"
  >;
  payload: unknown;
};

type WorkerResponse =
  | {
      id: string;
      ok: true;
      payload: unknown;
    }
  | {
      id: string;
      ok: false;
      error: string;
    };

if (!parentPort) {
  throw new Error("File Trail explorer worker requires a parent port.");
}

const queue: WorkerRequest[] = [];
let processing = false;

parentPort.on("message", (message: WorkerRequest) => {
  queue.push(message);
  queue.sort((left, right) => getPriority(left.channel) - getPriority(right.channel));
  if (!processing) {
    void processQueue();
  }
});

async function processQueue(): Promise<void> {
  processing = true;
  try {
    while (queue.length > 0) {
      const message = queue.shift();
      if (!message) {
        continue;
      }
      const response = await handleWorkerRequest(message).catch((error: unknown) => ({
        id: message.id,
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }));
      parentPort?.postMessage(response satisfies WorkerResponse);
    }
  } finally {
    processing = false;
  }
}

async function handleWorkerRequest(message: WorkerRequest): Promise<WorkerResponse> {
  if (message.channel === "tree:getChildren") {
    const payload = ipcContractSchemas["tree:getChildren"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await listTreeChildren(payload.path, payload.includeHidden),
    };
  }
  if (message.channel === "directory:getSnapshot") {
    const payload = ipcContractSchemas["directory:getSnapshot"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await listDirectorySnapshot(
        payload.path,
        payload.includeHidden,
        payload.sortBy,
        payload.sortDirection,
      ),
    };
  }
  if (message.channel === "directory:getMetadataBatch") {
    const payload = ipcContractSchemas["directory:getMetadataBatch"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await getDirectoryMetadataBatch(payload.directoryPath, payload.paths),
    };
  }
  if (message.channel === "item:getProperties") {
    const payload = ipcContractSchemas["item:getProperties"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await getItemProperties(payload.path),
    };
  }
  if (message.channel === "path:getSuggestions") {
    const payload = ipcContractSchemas["path:getSuggestions"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await getPathSuggestions(payload.inputPath, payload.includeHidden, payload.limit),
    };
  }
  if (message.channel === "path:resolve") {
    const payload = ipcContractSchemas["path:resolve"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await resolvePathTarget(payload.path),
    };
  }
  throw new Error(`Unsupported worker channel: ${message.channel}`);
}

function getPriority(channel: WorkerRequest["channel"]): number {
  if (channel === "directory:getMetadataBatch") {
    return 2;
  }
  return 1;
}
