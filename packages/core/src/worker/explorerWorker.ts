import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

import { ipcContractSchemas } from "@filetrail/contracts";
import {
  type ExplorerFileSystem,
  getDirectoryMetadataBatch,
  getItemProperties,
  getPathSuggestions,
  listDirectorySnapshot,
  listTreeChildren,
  resolvePathTarget,
} from "../fs/explorerService";
import { FdSearchRuntime } from "../search/fdSearch";
import type { WorkerSupportedChannel } from "./explorerWorkerClient";

// Electron patches node:fs to treat .asar archives as virtual directories.
// When running inside Electron, use original-fs so directory listings show .asar
// files as regular files instead of phantom directories.
let originalExplorerFs: ExplorerFileSystem | undefined;
try {
  const req = createRequire(import.meta.url);
  const originalFs = req("original-fs") as typeof import("node:fs");
  const { stat, lstat, readdir, realpath } = originalFs.promises;
  originalExplorerFs = {
    readdir: ((path: string, options: { withFileTypes: true }) =>
      readdir(path, options)) as ExplorerFileSystem["readdir"],
    stat: ((path: string) => stat(path)) as ExplorerFileSystem["stat"],
    lstat: ((path: string) => lstat(path)) as ExplorerFileSystem["lstat"],
    realpath: (path: string) => realpath(path),
  };
} catch {
  // Not running inside Electron; functions will use default node:fs.
}

type ExplorerWorkerData = {
  fdBinaryPath?: string;
};

type WorkerRequest = {
  id: string;
  channel: WorkerSupportedChannel;
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

const { fdBinaryPath } = (workerData ?? {}) as ExplorerWorkerData;
if (!fdBinaryPath) {
  throw new Error("File Trail explorer worker requires a bundled fd binary path.");
}

const searchRuntime = new FdSearchRuntime(fdBinaryPath, {
  spawn: (file, args, options) => spawn(file, args, options),
});

const normalPriorityQueue: WorkerRequest[] = [];
const lowPriorityQueue: WorkerRequest[] = [];
let processing = false;

parentPort.on("message", (message: WorkerRequest) => {
  getQueue(message.channel).push(message);
  if (!processing) {
    void processQueue();
  }
});

async function processQueue(): Promise<void> {
  processing = true;
  try {
    while (normalPriorityQueue.length > 0 || lowPriorityQueue.length > 0) {
      const message = normalPriorityQueue.shift() ?? lowPriorityQueue.shift();
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
      payload: await listTreeChildren(payload.path, payload.includeHidden, originalExplorerFs),
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
        payload.foldersFirst,
        originalExplorerFs,
      ),
    };
  }
  if (message.channel === "directory:getMetadataBatch") {
    const payload = ipcContractSchemas["directory:getMetadataBatch"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await getDirectoryMetadataBatch(
        payload.directoryPath,
        payload.paths,
        originalExplorerFs,
      ),
    };
  }
  if (message.channel === "item:getProperties") {
    const payload = ipcContractSchemas["item:getProperties"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await getItemProperties(payload.path, originalExplorerFs),
    };
  }
  if (message.channel === "path:getSuggestions") {
    const payload = ipcContractSchemas["path:getSuggestions"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await getPathSuggestions(
        payload.inputPath,
        payload.includeHidden,
        payload.limit,
        originalExplorerFs,
      ),
    };
  }
  if (message.channel === "path:resolve") {
    const payload = ipcContractSchemas["path:resolve"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: await resolvePathTarget(payload.path, originalExplorerFs),
    };
  }
  if (message.channel === "search:start") {
    const payload = ipcContractSchemas["search:start"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: searchRuntime.startSearch(payload),
    };
  }
  if (message.channel === "search:getUpdate") {
    const payload = ipcContractSchemas["search:getUpdate"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: searchRuntime.getUpdate(payload.jobId, payload.cursor),
    };
  }
  if (message.channel === "search:cancel") {
    const payload = ipcContractSchemas["search:cancel"].request.parse(message.payload);
    return {
      id: message.id,
      ok: true,
      payload: searchRuntime.cancelSearch(payload.jobId),
    };
  }
  throw new Error(`Unsupported worker channel: ${message.channel}`);
}

function getQueue(channel: WorkerRequest["channel"]): WorkerRequest[] {
  if (channel === "directory:getMetadataBatch") {
    return lowPriorityQueue;
  }
  return normalPriorityQueue;
}
