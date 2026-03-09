import { app, clipboard, ipcMain } from "electron";

import { ExplorerWorkerClient, createWriteService, getPathSuggestions } from "@filetrail/core";
import type { AppPreferences } from "../shared/appPreferences";
import type { AppStateStore } from "./appStateStore";
import { resolveBundledFdBinaryPath } from "./fdBinary";
import { registerIpcHandlers } from "./ipc";
import {
  clearResponseCaches,
  createFolderSizeHandlers,
  getCachedMetadataBatch,
  getCachedResponse,
  resetResponseCacheState,
  withTiming,
} from "./bootstrap/responseCache";
import { toPreferencePatch } from "./bootstrap/preferencesPatch";
import {
  openInTerminal,
  openPath,
  openPathsWithApplication,
  pickApplication,
  pickDirectory,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
} from "./bootstrap/systemHandlers";
import { createWriteOperationCoordinator } from "./bootstrap/writeOperations";

let activeWorkerClient: ExplorerWorkerClient | null = null;
let disposeWriteCoordinator: (() => void) | null = null;

export async function bootstrapMainProcess(
  appStateStore: AppStateStore,
  launchContext: { startupFolderPath: string | null } = { startupFolderPath: null },
  onPreferencesChanged?: (preferences: AppPreferences) => void,
): Promise<void> {
  // Main owns the worker client so the renderer only ever talks through the IPC contract.
  const workerClient = new ExplorerWorkerClient(resolveExplorerWorkerUrl(), {
    fdBinaryPath: resolveBundledFdBinaryPath(),
  });
  const writeService = createWriteService();
  const writeCoordinator = createWriteOperationCoordinator(writeService);
  const folderSizeHandlers = createFolderSizeHandlers();
  activeWorkerClient = workerClient;
  disposeWriteCoordinator?.();
  disposeWriteCoordinator = () => {
    writeCoordinator.shutdown();
  };

  registerIpcHandlers(ipcMain, {
    "app:getHomeDirectory": () => ({
      path: app.getPath("home"),
    }),
    "app:getPreferences": () => ({
      preferences: appStateStore.getPreferences(),
    }),
    "app:getLaunchContext": () => launchContext,
    "app:updatePreferences": (payload) => {
      const preferences = appStateStore.updatePreferences(toPreferencePatch(payload.preferences));
      onPreferencesChanged?.(preferences);
      return { preferences };
    },
    "app:clearCaches": () => {
      clearResponseCaches();
      return { ok: true };
    },
    "tree:getChildren": (payload) =>
      getCachedResponse("tree", payload, () =>
        withTiming("tree:getChildren", payload.path, () =>
          workerClient.request("tree:getChildren", payload),
        ),
      ),
    "directory:getSnapshot": (payload) =>
      getCachedResponse("directory", payload, () =>
        withTiming("directory:getSnapshot", payload.path, () =>
          workerClient.request("directory:getSnapshot", payload),
        ),
      ),
    "directory:getMetadataBatch": (payload) =>
      withTiming("directory:getMetadataBatch", payload.directoryPath, () =>
        getCachedMetadataBatch(workerClient, payload),
      ),
    "item:getProperties": (payload) =>
      withTiming("item:getProperties", payload.path, () =>
        workerClient.request("item:getProperties", payload),
      ),
    "path:getSuggestions": (payload) =>
      withTiming("path:getSuggestions", payload.inputPath, () =>
        getPathSuggestions(payload.inputPath, payload.includeHidden, payload.limit),
      ),
    "path:resolve": (payload) =>
      withTiming("path:resolve", payload.path, () => workerClient.request("path:resolve", payload)),
    "search:start": (payload) =>
      withTiming("search:start", payload.rootPath, () =>
        workerClient.request("search:start", payload),
      ),
    "search:getUpdate": (payload) => workerClient.request("search:getUpdate", payload),
    "search:cancel": (payload) => workerClient.request("search:cancel", payload),
    ...writeCoordinator.handlers,
    "folderSize:start": (payload) => folderSizeHandlers.start(payload),
    "folderSize:getStatus": (payload) => folderSizeHandlers.getStatus(payload),
    "folderSize:cancel": (payload) => folderSizeHandlers.cancel(payload),
    "system:openPath": (payload) => openPath(payload),
    "system:pickApplication": (_payload, event) => pickApplication(event),
    "system:pickDirectory": (payload, event) => pickDirectory(payload, event),
    "system:openPathsWithApplication": (payload) => openPathsWithApplication(payload),
    "system:openInTerminal": (payload) =>
      openInTerminal(payload, appStateStore.getPreferences().terminalApp),
    "system:copyText": (payload) => {
      clipboard.writeText(payload.text);
      return { ok: true };
    },
  });
}

export async function shutdownMainProcess(): Promise<void> {
  if (!activeWorkerClient) {
    return;
  }
  const workerClient = activeWorkerClient;
  activeWorkerClient = null;
  disposeWriteCoordinator?.();
  disposeWriteCoordinator = null;
  resetResponseCacheState();
  await workerClient.close();
}

function resolveExplorerWorkerUrl(): URL {
  return new URL("./explorerWorker.js", import.meta.url);
}

export {
  openPathsWithApplication,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
  toPreferencePatch,
};
