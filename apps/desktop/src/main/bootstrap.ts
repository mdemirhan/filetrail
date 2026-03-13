import { dirname } from "node:path";
import { app, clipboard, ipcMain } from "electron";

import type { AppLogEntry } from "@filetrail/contracts";
import { ExplorerWorkerClient, createWriteService, getPathSuggestions } from "@filetrail/core";
import type { AppPreferences } from "../shared/appPreferences";
import {
  createActionLogRecorder,
  createActionLogStore,
  resolveActionLogFilePath,
} from "./actionLog";
import { type AppLogger, writeStructuredAppLogEntry } from "./appLog";
import type { AppStateStore } from "./appStateStore";
import { toPreferencePatch } from "./bootstrap/preferencesPatch";
import {
  clearResponseCaches,
  createFolderSizeHandlers,
  getCachedMetadataBatch,
  getCachedResponse,
  resetResponseCacheState,
  withTiming,
} from "./bootstrap/responseCache";
import {
  openInTerminal,
  emptyTrash,
  getFileIconHandler,
  openPath,
  openPathsWithApplication,
  performEditAction,
  pickApplication,
  pickDirectory,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
} from "./bootstrap/systemHandlers";
import { createWriteOperationCoordinator } from "./bootstrap/writeOperations";
import { resolveBundledFdBinaryPath } from "./fdBinary";
import { registerIpcHandlers } from "./ipc";

let activeWorkerClient: ExplorerWorkerClient | null = null;
let disposeWriteCoordinator: (() => void) | null = null;

export async function bootstrapMainProcess(
  appStateStore: AppStateStore,
  launchContext: { startupFolderPath: string | null } = { startupFolderPath: null },
  logger: Pick<AppLogger, "debug" | "info" | "warn" | "error"> = console,
  onPreferencesChanged?: (preferences: AppPreferences) => void,
): Promise<void> {
  // Main owns the worker client so the renderer only ever talks through the IPC contract.
  const workerClient = new ExplorerWorkerClient(resolveExplorerWorkerUrl(), {
    fdBinaryPath: resolveBundledFdBinaryPath(),
  });
  // Use Electron's original-fs to bypass ASAR archive patching, so .asar
  // files inside app bundles are copied as regular files instead of being
  // treated as virtual directories. This applies to copy/paste, rename,
  // mkdir, and all other filesystem operations that need the real filesystem.
  const { originalExplorerFileSystem, originalFileSystem, originalRename, getFolderSize, cancelFolderSize } = await import(
    "./originalFileSystem"
  );
  const writeService = createWriteService({ fileSystem: originalFileSystem });
  const actionLogStore = createActionLogStore(
    resolveActionLogFilePath(dirname(appStateStore.getFilePath())),
    {
      onError: (error) => {
        logger.error("[filetrail] action log failed", error);
      },
    },
  );
  const actionLogRecorder = createActionLogRecorder(actionLogStore);
  const writeCoordinator = createWriteOperationCoordinator(
    writeService,
    {
      lstat: originalFileSystem.lstat,
      stat: originalFileSystem.stat,
      mkdir: (path) => originalFileSystem.mkdir(path),
      rename: originalRename,
      rm: (path, options) => originalFileSystem.rm(path, options),
    },
    {
      recordWriteOperation: (args) =>
        appStateStore.getPreferences().actionLogEnabled
          ? actionLogRecorder.recordWriteOperation(args)
          : Promise.resolve(),
    },
  );
  const folderSizeHandlers = createFolderSizeHandlers({ getFolderSize, cancelFolderSize });
  activeWorkerClient = workerClient;
  disposeWriteCoordinator?.();
  disposeWriteCoordinator = () => {
    writeCoordinator.shutdown();
  };

  registerIpcHandlers(
    ipcMain,
    {
      "app:getHomeDirectory": () => ({
        path: app.getPath("home"),
      }),
      "app:getPreferences": () => ({
        preferences: appStateStore.getPreferences(),
      }),
      "actionLog:list": async () => ({
        items: await actionLogStore.list(),
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
      "app:writeLog": (payload) => {
        writeStructuredAppLogEntry(logger, payload as AppLogEntry);
        return { ok: true };
      },
      "tree:getChildren": (payload) =>
        getCachedResponse("tree", payload, () =>
          withTiming(
            "tree:getChildren",
            payload.path,
            () => workerClient.request("tree:getChildren", payload),
            logger,
          ),
        ),
      "directory:getSnapshot": (payload) =>
        getCachedResponse("directory", payload, () =>
          withTiming(
            "directory:getSnapshot",
            payload.path,
            () => workerClient.request("directory:getSnapshot", payload),
            logger,
          ),
        ),
      "directory:getMetadataBatch": (payload) =>
        withTiming(
          "directory:getMetadataBatch",
          payload.directoryPath,
          () => getCachedMetadataBatch(workerClient, payload),
          logger,
        ),
      "item:getProperties": (payload) =>
        withTiming(
          "item:getProperties",
          payload.path,
          () => workerClient.request("item:getProperties", payload),
          logger,
        ),
      "path:getSuggestions": (payload) =>
        withTiming(
          "path:getSuggestions",
          payload.inputPath,
          () =>
            getPathSuggestions(
              payload.inputPath,
              payload.includeHidden,
              payload.limit,
              originalExplorerFileSystem,
            ),
          logger,
        ),
      "path:resolve": (payload) =>
        withTiming(
          "path:resolve",
          payload.path,
          () => workerClient.request("path:resolve", payload),
          logger,
        ),
      "search:start": (payload) =>
        withTiming(
          "search:start",
          payload.rootPath,
          () => workerClient.request("search:start", payload),
          logger,
        ),
      "search:getUpdate": (payload) => workerClient.request("search:getUpdate", payload),
      "search:cancel": (payload) => workerClient.request("search:cancel", payload),
      ...writeCoordinator.handlers,
      "folderSize:start": (payload) => folderSizeHandlers.start(payload),
      "folderSize:getStatus": (payload) => folderSizeHandlers.getStatus(payload),
      "folderSize:cancel": (payload) => folderSizeHandlers.cancel(payload),
      "system:openPath": async (payload) => {
        const startedAtMs = Date.now();
        const response = await openPath(payload);
        if (appStateStore.getPreferences().actionLogEnabled) {
          void actionLogRecorder.recordOpenPath({
            path: payload.path,
            ok: response.ok,
            error: response.error,
            startedAtMs,
            finishedAtMs: Date.now(),
          });
        }
        return response;
      },
      "system:pickApplication": (_payload, event) => pickApplication(event),
      "system:pickDirectory": (payload, event) => pickDirectory(payload, event),
      "system:openPathsWithApplication": async (payload) => {
        const startedAtMs = Date.now();
        const response = await openPathsWithApplication(payload);
        if (appStateStore.getPreferences().actionLogEnabled) {
          void actionLogRecorder.recordOpenWithApplication({
            applicationPath: payload.applicationPath,
            applicationName: resolveApplicationDisplayName(payload.applicationPath),
            paths: payload.paths,
            ok: response.ok,
            error: response.error,
            startedAtMs,
            finishedAtMs: Date.now(),
          });
        }
        return response;
      },
      "system:openInTerminal": async (payload) => {
        const startedAtMs = Date.now();
        const terminalApp = appStateStore.getPreferences().terminalApp;
        const terminalName = resolveTerminalApplicationName(terminalApp);
        const response = await openInTerminal(payload, terminalApp);
        if (appStateStore.getPreferences().actionLogEnabled) {
          void actionLogRecorder.recordOpenInTerminal({
            requestedPath: payload.path,
            targetPath: response.targetPath,
            terminalName: response.terminalName ?? terminalName,
            ok: response.ok,
            error: response.error,
            startedAtMs,
            finishedAtMs: Date.now(),
          });
        }
        return {
          ok: response.ok,
          error: response.error,
        };
      },
      "system:copyText": (payload) => {
        clipboard.writeText(payload.text);
        return { ok: true };
      },
      "system:performEditAction": (payload, event) => performEditAction(payload, event.sender),
      "system:emptyTrash": () => emptyTrash(),
      "system:getFileIcon": (payload) => getFileIconHandler(payload),
    },
    logger,
  );
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

export function getMainProcessStatus(): {
  workerActive: boolean;
  writeCoordinatorActive: boolean;
} {
  return {
    workerActive: activeWorkerClient !== null,
    writeCoordinatorActive: disposeWriteCoordinator !== null,
  };
}

function resolveExplorerWorkerUrl(): URL {
  return new URL("./explorerWorker.js", import.meta.url);
}

export {
  openPathsWithApplication,
  performEditAction,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
  toPreferencePatch,
};
