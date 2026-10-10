import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { BrowserWindow, type WebContents, app, clipboard, ipcMain, shell } from "electron";

import type { AppLogEntry, HelpTopic, SettingsTab } from "@filetrail/contracts";
import { ExplorerWorkerClient, createWriteService, getPathSuggestions } from "@filetrail/core";
import type { AppPreferences } from "../shared/appPreferences";
import { type ApplicationMenuState, toApplicationMenuState } from "../shared/applicationMenuState";
import {
  formatMacosVersion,
  readAcknowledgements,
  readBuildCommit,
  readBuildVersion,
  resolveDistDir,
  resolveNoticesPath,
} from "./aboutInfo";
import { type AppLogger, writeStructuredAppLogEntry } from "./appLog";
import type { AppStateStore } from "./appStateStore";
import { getDiskIds } from "./bootstrap/diskIds";
import {
  bringWindowToFront,
  findDraggedAway,
  readDragChangeCount,
  readDraggedIn,
  startFileDrag,
} from "./bootstrap/fileDrag";
import { toPreferencePatch } from "./bootstrap/preferencesPatch";
import { openWriteJournal, recoverWrites, retryRecovery } from "./bootstrap/writeJournal";

// How long a disk may take to answer while Replaces are recovered: a network share that
// doesn't answer is tried again later instead of holding up the window.
const RECOVERY_ANSWER_WITHIN_MS = 3_000;
import { inspectBatchRename } from "./bootstrap/batchRenameInspect";
import { createDiskHasTrash } from "./bootstrap/diskHasTrash";
import {
  clearResponseCaches,
  createFolderSizeHandlers,
  forgetFolderListings,
  getCachedMetadataBatch,
  getCachedResponse,
  resetResponseCacheState,
  withTiming,
} from "./bootstrap/responseCache";
import {
  emptyTrash,
  getFileIconHandler,
  getFileThumbnailHandler,
  getTrashState,
  getVolumeInfo,
  openFullDiskAccessSettings,
  openInTerminal,
  openPath,
  openPathsWithApplication,
  performEditAction,
  pickApplication,
  pickDirectory,
  quickLookPath,
  resolveApplicationDisplayName,
  resolveTerminalApplicationName,
} from "./bootstrap/systemHandlers";
import { createTrashItem } from "./bootstrap/trashItem";
import { createUndoHistory } from "./bootstrap/undoHistory";
import {
  type WriteOperationKind,
  assertNotSystemLocation,
  createWriteOperationCoordinator,
  sendToEachWindow,
} from "./bootstrap/writeOperations";
import { readBundledFdManifest, resolveBundledFdBinaryPath } from "./fdBinary";
import { type FolderWatches, createFolderWatches } from "./folderWatch";
import { registerIpcHandlers } from "./ipc";
import { type VolumeWatcher, createVolumeWatcher, ejectVolume } from "./volumes";
import {
  type PreferencesChange,
  type WindowHost,
  createWindowIpcHandlers,
} from "./windowIpcHandlers";

let activeWorkerClient: ExplorerWorkerClient | null = null;
let activeWriteCoordinator: ReturnType<typeof createWriteOperationCoordinator> | null = null;
let activeVolumeWatcher: VolumeWatcher | null = null;
let activeFolderWatches: FolderWatches | null = null;
let activeFolderSizeHandlers: ReturnType<typeof createFolderSizeHandlers> | null = null;

// The windows, as the main process's work sees them. The host (main.ts) makes and keeps
// them.
export type MainProcessWindows = WindowHost & {
  openSettingsWindow: (tab?: SettingsTab) => void;
  openAcknowledgementsWindow: () => void;
  openHelpWindow: (topic?: HelpTopic) => void;
  // The explorer window reporting what the application menu should show.
  setApplicationMenuState: (state: ApplicationMenuState, senderId: number | null) => void;
  // Things found at start that the person must be told about (a Replace a crash left
  // unfinished that couldn't be put right), shown once the window is open.
  showStartupNotices: (notices: string[]) => void;
  // Items such a Replace left waiting for their disk, put in place later.
  showRecoveryNotices: (notices: string[]) => void;
  // What Undo and Redo would do now, for the Edit menu; told at start and on each change.
  onUndoHistoryChanged: (menu: {
    undo: string | null;
    redo: string | null;
    cantUndo: boolean;
  }) => void;
  // The explorer window a running operation goes to when the one that started it closes.
  successorWindowOf: (senderId: number) => WebContents | null;
};

export async function bootstrapMainProcess(
  appStateStore: AppStateStore,
  windows: MainProcessWindows,
  onPreferencesChanged: (preferences: AppPreferences, change: PreferencesChange) => void,
  logger: Pick<AppLogger, "debug" | "info" | "warn" | "error"> = console,
): Promise<void> {
  // Main owns the worker client so the renderer only ever talks through the IPC contract.
  const workerClient = new ExplorerWorkerClient(resolveExplorerWorkerUrl(), {
    fdBinaryPath: resolveBundledFdBinaryPath(),
  });
  // Use Electron's original-fs to bypass ASAR archive patching, so .asar
  // files inside app bundles are copied as regular files instead of being
  // treated as virtual directories. This applies to copy/paste, rename,
  // mkdir, and all other filesystem operations that need the real filesystem.
  const {
    originalExplorerFileSystem,
    originalFileSystem,
    originalTrashItem,
    createOriginalWriteOperationFs,
    createOriginalBatchRenameInspectDeps,
    getFolderSize,
    cancelFolderSize,
    listVolumes,
    listMounts,
    ejectVolumeNow,
    realpathNow,
  } = await import("./originalFileSystem");
  // The disks mounted besides the startup disk; every window hears of each change.
  const volumeWatcher = createVolumeWatcher({
    listVolumes,
    watchVolumesFolder: (onChange) => {
      try {
        const watcher = watch("/Volumes", onChange);
        watcher.on("error", () => undefined);
        return () => watcher.close();
      } catch {
        return () => undefined;
      }
    },
    onVolumesChanged: (volumes) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send("filetrail:volumesChanged", volumes);
        }
      }
    },
  });
  activeVolumeWatcher?.stop();
  activeVolumeWatcher = volumeWatcher;
  // A disk mounted while the watch was not looking (it can miss one while the Mac sleeps)
  // shows up when the window comes back to the front.
  app.on("browser-window-focus", () => volumeWatcher.refresh());
  // The folder each window has on screen: a change made to it outside the app is sent to
  // the window, which reads the folder again.
  const folderWatches = createFolderWatches({
    watchFolder: (path, onChange, onFail) => {
      try {
        const watcher = watch(path, (_eventType, name) => onChange(name ?? null));
        // Node closes a watch on its first error (the folder gone, say).
        watcher.on("error", onFail);
        return () => watcher.close();
      } catch {
        return null;
      }
    },
    readModifiedTime: (path) =>
      stat(path).then(
        (stats) => stats.mtimeMs,
        () => null,
      ),
    forgetCachedListings: forgetFolderListings,
    onFolderChanged: (windowId, change) => {
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.webContents.id === windowId,
      );
      window?.webContents.send("filetrail:folderChanged", change);
    },
  });
  activeFolderWatches?.stopAll();
  activeFolderWatches = folderWatches;
  // The windows that have asked for a watch, so each is let go of when it closes.
  const watchedSenders = new WeakSet<WebContents>();
  app.on("browser-window-focus", (_event, window) =>
    folderWatches.checkForMissedChanges(window.webContents.id),
  );
  // What the Rename sheet checks for several items: the same folders are refused as for a
  // rename of one.
  const batchRenameInspectDeps = createOriginalBatchRenameInspectDeps({
    homePath: app.getPath("home"),
    assertRenamable: (path) =>
      assertNotSystemLocation([path], "renamed", originalFileSystem, app.getPath("home")),
  });
  // Read from the mount table each time: disks come and go.
  const diskHasTrash = createDiskHasTrash(listMounts, realpathNow);
  // Items replaced by a paste go to the Trash, so a replace can always be undone.
  const trashItem = createTrashItem({
    trash: originalTrashItem,
    fs: originalFileSystem,
    homePath: app.getPath("home"),
    diskHasTrash,
  });
  const writeFileSystem = { ...originalFileSystem, trash: trashItem };
  // A Replace cut short by a crash is finished or undone before anything else is written.
  const writeJournal = await openWriteJournal(
    join(app.getPath("userData"), "replace-journal.json"),
  );
  const recovery = await recoverWrites(writeJournal, writeFileSystem, logger, {
    answerWithinMs: RECOVERY_ANSWER_WITHIN_MS,
  });
  if (recovery.notices.length > 0) {
    windows.showStartupNotices(recovery.notices);
  }
  const writeService = createWriteService({ fileSystem: writeFileSystem, writeJournal });
  // What Undo and Redo work from, for as long as the app runs.
  const undoHistory = createUndoHistory();
  undoHistory.onChange(() => windows.onUndoHistoryChanged(undoHistory.menu()));
  windows.onUndoHistoryChanged(undoHistory.menu());
  const writeCoordinator = createWriteOperationCoordinator(
    writeService,
    createOriginalWriteOperationFs(trashItem),
    {
      diskHasTrash,
      recordUndo: undoHistory.record,
      undoHistory,
      writeJournal,
      broadcastProgress: (event, owner) =>
        sendToEachWindow(
          BrowserWindow.getAllWindows()
            .filter((window) => !window.isDestroyed())
            .map((window) => window.webContents)
            .filter(
              (contents) =>
                (contents as unknown) !== owner && windows.explorerWindowIdOf(contents.id),
            ),
          "filetrail:writeOperationProgress",
          event,
        ),
      successorOf: (sender) => {
        const senderId = (sender as Partial<WebContents>).id;
        return typeof senderId === "number" ? windows.successorWindowOf(senderId) : null;
      },
      onTrashEmptied: () => {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send("filetrail:trashEmptied");
          }
        }
      },
    },
  );
  // What couldn't be reached at start (its disk wasn't connected, or didn't answer) is
  // tried again now and then, while nothing else is being written, until it is done.
  retryRecovery({
    leftoverIds: new Set(writeJournal.entries().map((entry) => entry.id)),
    recover: (entryIds) =>
      recoverWrites(writeJournal, writeFileSystem, logger, {
        entryIds,
        answerWithinMs: RECOVERY_ANSWER_WITHIN_MS,
        retry: true,
        runWriteAlone: writeCoordinator.runWriteAlone,
      }),
    remainingIds: () => new Set(writeJournal.entries().map((entry) => entry.id)),
    isBusy: () => writeCoordinator.getActiveOperation() !== null,
    onFinished: (messages) => windows.showRecoveryNotices(messages),
  });
  const folderSizeHandlers = createFolderSizeHandlers({
    getFolderSize,
    cancelFolderSize,
    // The window that asked hears at once, rather than at its next look a moment later:
    // a run over many small folders isn't held up between them.
    onSettled: (owner, jobId) => {
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.webContents.id === owner,
      );
      window?.webContents.send("filetrail:folderSizeSettled", jobId);
    },
  });
  activeFolderSizeHandlers?.stopAll();
  activeFolderSizeHandlers = folderSizeHandlers;
  // The windows that have asked for a measurement, so each is let go of when it closes.
  const measuringSenders = new WeakSet<WebContents>();
  activeWorkerClient = workerClient;
  void activeWriteCoordinator?.shutdown();
  activeWriteCoordinator = writeCoordinator;

  registerIpcHandlers(
    ipcMain,
    {
      "app:getHomeDirectory": () => ({
        path: app.getPath("home"),
      }),
      ...createWindowIpcHandlers({
        store: appStateStore,
        windows,
        onPreferencesChanged,
      }),
      "places:list": () => ({
        folders: appStateStore.getVisitedFolders(),
      }),
      "places:recordVisit": (payload) => {
        appStateStore.recordFolderVisit(payload.path, payload.kind);
        return { ok: true };
      },
      "places:forget": (payload) => ({
        folders: appStateStore.forgetVisitedFolder(payload.path),
      }),
      "batchRename:inspect": (payload) => inspectBatchRename(payload, batchRenameInspectDeps),
      "app:openSettingsWindow": (payload) => {
        windows.openSettingsWindow(payload.tab);
        return { ok: true };
      },
      "app:getAboutInfo": () => ({
        version: readBuildVersion(resolveDistDir()) ?? app.getVersion(),
        commit: readBuildCommit(resolveDistDir()),
        macosVersion: formatMacosVersion(process.getSystemVersion()),
        architecture: process.arch === "arm64" ? "Apple silicon" : "Intel",
        electronVersion: process.versions.electron,
        fdVersion: readBundledFdManifest().version,
      }),
      "app:openHelpWindow": (payload) => {
        windows.openHelpWindow(payload.topic);
        return { ok: true };
      },
      "app:openAcknowledgementsWindow": () => {
        windows.openAcknowledgementsWindow();
        return { ok: true };
      },
      "app:getAcknowledgements": () => ({
        components: readAcknowledgements(resolveDistDir(), { chromium: process.versions.chrome }),
      }),
      // The renderer names the component; the file opened is always one the app ships.
      "app:openAcknowledgementNotices": async (payload) => {
        const noticesPath = resolveNoticesPath(payload.id);
        return { ok: noticesPath !== null && (await shell.openPath(noticesPath)).length === 0 };
      },
      "app:setMenuState": (payload, event) => {
        windows.setApplicationMenuState(
          toApplicationMenuState(payload.state),
          event?.sender?.id ?? null,
        );
        return { ok: true };
      },
      "app:clearCaches": () => {
        clearResponseCaches();
        return { ok: true };
      },
      "folder:watch": (payload, event) => {
        const sender = event.sender;
        if (!watchedSenders.has(sender)) {
          // A window closed, or loading its page again, stops watching with it.
          watchedSenders.add(sender);
          const stop = () => folderWatches.watch(sender.id, null);
          sender.once("destroyed", stop);
          sender.on("did-start-navigation", (details) => {
            if (details.isMainFrame && !details.isSameDocument) {
              stop();
            }
          });
        }
        folderWatches.watch(sender.id, payload.path);
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
      "folderSize:start": (payload, event) => {
        const sender = event?.sender;
        if (sender && !measuringSenders.has(sender)) {
          // A window closed, or loading its page again, stops its measurements with it.
          measuringSenders.add(sender);
          const senderId = sender.id;
          const stop = () => folderSizeHandlers.forgetOwner(senderId);
          sender.once("destroyed", stop);
          sender.on("did-start-navigation", (details) => {
            if (details.isMainFrame && !details.isSameDocument) {
              stop();
            }
          });
        }
        return folderSizeHandlers.start(payload, sender?.id ?? null);
      },
      "folderSize:getStatus": (payload) => folderSizeHandlers.getStatus(payload),
      "folderSize:cancel": (payload) => folderSizeHandlers.cancel(payload),
      "folderSize:probeMany": (payload) => folderSizeHandlers.probeMany(payload),
      "system:openPath": (payload) => openPath(payload),
      "system:quickLook": (payload, event) => quickLookPath(payload, event),
      "system:getVolumeInfo": (payload) => getVolumeInfo(payload),
      "system:getDiskIds": (payload) => getDiskIds(payload),
      "system:startFileDrag": (payload, event) => startFileDrag(payload, event),
      "system:findDraggedAway": (payload, event) =>
        findDraggedAway(payload, {
          tellOtherWindows: (change) => {
            for (const window of BrowserWindow.getAllWindows()) {
              if (!window.isDestroyed() && window.webContents !== event.sender) {
                window.webContents.send("filetrail:draggedAway", change);
              }
            }
          },
        }),
      "system:readDraggedIn": () => readDraggedIn(),
      "system:readDragChangeCount": () => readDragChangeCount(),
      "system:bringWindowToFront": (_payload, event) => bringWindowToFront(event),
      "system:pickApplication": (_payload, event) => pickApplication(event),
      "system:pickDirectory": (payload, event) => pickDirectory(payload, event),
      "system:openPathsWithApplication": (payload) => openPathsWithApplication(payload),
      "system:openInTerminal": async (payload) => {
        const response = await openInTerminal(payload, appStateStore.getPreferences().terminalApp);
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
      "system:emptyTrash": () => writeCoordinator.emptyTrash(emptyTrash),
      "system:listVolumes": () => ({ volumes: volumeWatcher.getVolumes() }),
      "system:ejectVolume": async (payload) => {
        const response = await ejectVolume(ejectVolumeNow, payload);
        if (response.status === "failed") {
          logger.error("eject failed", { ...payload, ...response });
        }
        // Volumes unmounted show as gone at once, not after the folder watch settles; a
        // refusal part way through a disk leaves some of them gone too.
        volumeWatcher.refresh();
        return response;
      },
      "system:getTrashState": () => getTrashState(app.getPath("home"), process.getuid?.() ?? 0),
      "system:openFullDiskAccessSettings": () => openFullDiskAccessSettings(),
      "system:getFileIcon": (payload) => getFileIconHandler(payload),
      "system:getFileThumbnail": (payload) => getFileThumbnailHandler(payload),
    },
    logger,
  );
}

export async function shutdownMainProcess(): Promise<void> {
  activeVolumeWatcher?.stop();
  activeVolumeWatcher = null;
  activeFolderWatches?.stopAll();
  activeFolderWatches = null;
  activeFolderSizeHandlers?.stopAll();
  activeFolderSizeHandlers = null;
  if (!activeWorkerClient) {
    return;
  }
  const workerClient = activeWorkerClient;
  activeWorkerClient = null;
  // Waits for a running copy or delete to stop cleanly before anything else closes.
  const writeCoordinator = activeWriteCoordinator;
  activeWriteCoordinator = null;
  await writeCoordinator?.shutdown();
  resetResponseCacheState();
  await workerClient.close();
}

export function getMainProcessStatus(): {
  workerActive: boolean;
  writeCoordinatorActive: boolean;
} {
  return {
    workerActive: activeWorkerClient !== null,
    writeCoordinatorActive: activeWriteCoordinator !== null,
  };
}

/** The copy, move, rename, or delete that is running now, if any. */
export function getActiveWriteOperation(): {
  operationId: string;
  kind: WriteOperationKind;
} | null {
  return activeWriteCoordinator?.getActiveOperation() ?? null;
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
