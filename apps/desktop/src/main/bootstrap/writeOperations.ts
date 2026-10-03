import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  type IpcRequest,
  type WriteOperationAction,
  type WriteOperationProgressEvent,
  type WriteOperationResult,
  isAbortError,
  writeOperationProgressEventSchema,
} from "@filetrail/contracts";
import {
  type CopyPasteProgressEvent,
  WRITE_OPERATION_BUSY_ERROR,
  type WriteService,
  describeCopyPasteError,
} from "@filetrail/core";
import { toErrorMessage } from "../ipc";
import { clearResponseCaches } from "./responseCache";

type WriteOperationStats = { isDirectory(): boolean; dev?: number; ino?: number };

// Filesystem operations used by write operations (rename, mkdir, path checks).
// Callers inject an original-fs backed implementation to bypass Electron's ASAR
// patching, which would otherwise misreport .asar files as directories.
type WriteOperationFs = {
  lstat: (path: string) => Promise<WriteOperationStats>;
  stat: (path: string) => Promise<WriteOperationStats>;
  mkdir: (path: string) => Promise<void>;
  // Fails with EEXIST rather than replace an item already at the new path (renamex_np
  // with RENAME_EXCL). Every rename goes through this one...
  renameExclusive: (oldPath: string, newPath: string) => Promise<void>;
  // ...except one that only changes the case of a name ("notes" to "Notes") on a disk that
  // ignores case: there the new name already "exists", because it is the item itself.
  rename: (oldPath: string, newPath: string) => Promise<void>;
  rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
  // Moves an item to the Trash (Electron's shell.trashItem in the app).
  trash: (path: string) => Promise<void>;
};

// What kind of change the running operation is making, in the words a person would use.
export type WriteOperationKind = "copy" | "move" | "trash" | "delete" | "rename" | "new_folder";

type WriteOperationSender = {
  send: (channel: string, payload: unknown) => void;
  isDestroyed?: () => boolean;
};

// The Electron WebContents events that mean the page that started an operation is gone:
// its renderer crashed, its window closed, or it was replaced by a reload. "did-navigate"
// only fires for a committed main-frame load (not in-page navigations, and not navigation
// attempts that will-navigate blocks), which is exactly when the old page disappears.
const SENDER_GONE_EVENTS = ["render-process-gone", "destroyed", "did-navigate"] as const;
type SenderGoneEvent = (typeof SENDER_GONE_EVENTS)[number];
type SenderLifecycleEvents = {
  on?: (event: SenderGoneEvent, listener: () => void) => unknown;
  removeListener?: (event: SenderGoneEvent, listener: () => void) => unknown;
};

const WRITE_OPERATION_PROGRESS_CHANNEL = "filetrail:writeOperationProgress";

// Progress is reported once per item, which for a folder of small files is thousands of
// messages a second. The window only keeps a progress card current, so plain "running"
// updates are sent at most this often; the newest one always gets through.
export const PROGRESS_UPDATE_INTERVAL_MS = 100;

// Answer returned to a request that isn't allowed to act on an operation (unknown id, or
// asked by a window other than the one that started it).
const REJECTED_REQUEST = { ok: false } as const;

// Holds the single write slot while a local operation is still being prepared.
const PREPARING_WRITE_OPERATION_ID = "preparing-write-operation";

type PreparedRenameOperation = {
  sourcePath: string;
  destinationPath: string;
  // The new name differs from the old one only in case (or in how an accented letter is
  // encoded), and the disk treats both as the same name.
  renamesItself: boolean;
};

type PreparedCreateFolderOperation = {
  destinationPath: string;
};

export function createWriteOperationCoordinator(writeService: WriteService, fs: WriteOperationFs) {
  const writeOperationSenders = new Map<string, WriteOperationSender>();
  const senderDetachers = new Map<string, () => void>();
  const copyPasteRequests = new Map<string, IpcRequest<"copyPaste:start">>();
  // Whether each running copy-paste copies or moves, from the write service's own events.
  const copyPasteModes = new Map<string, CopyPasteProgressEvent["mode"]>();
  const localWriteOperationControllers = new Map<string, AbortController>();
  const localWriteOperationActions = new Map<string, WriteOperationAction>();
  // The window that started each copy analysis: only it may read, cancel, or start it.
  const analysisOwners = new Map<string, WriteOperationSender>();
  const progressThrottles = new Map<
    string,
    {
      lastSentAt: number;
      pending: (() => void) | null;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();
  // Callers waiting for the write slot to be free (see whenIdle).
  const idleWaiters: Array<() => void> = [];
  // While a copy-paste is being started: the end of any operation that finished before
  // the start request could record it (see "copyPaste:start").
  let earlyTerminalEvents: Map<string, CopyPasteProgressEvent> | null = null;
  let activeWriteOperationId: string | null = null;
  let localWriteOperationSequence = 0;
  // Set once the app starts quitting; no new operation may begin after that.
  let closing = false;

  // ~/.Trash is a protected system directory — it must never be deleted, renamed,
  // moved, or trashed.  Items *inside* Trash are fine; this only guards the
  // top-level Trash folder itself. The comparison ignores case, as the disk does.
  const trashPath = resolve(homedir(), ".Trash").toLowerCase();
  function assertNotProtectedPath(paths: readonly string[]): void {
    for (const path of paths) {
      if (resolve(path).toLowerCase() === trashPath) {
        throw new Error("The Trash folder is a protected system directory and cannot be modified.");
      }
    }
  }

  const writeServiceUnsubscribe = writeService.subscribe((event) => {
    const request = copyPasteRequests.get(event.operationId);
    const action = request?.action ?? "paste";
    copyPasteModes.set(event.operationId, event.mode);
    if (isTerminalStatus(event.status)) {
      copyPasteRequests.delete(event.operationId);
      copyPasteModes.delete(event.operationId);
      // Folder listings read before the operation finished may show the old contents.
      clearResponseCaches();
      if (earlyTerminalEvents && !writeOperationSenders.has(event.operationId)) {
        earlyTerminalEvents.set(event.operationId, event);
      }
      freeWriteSlot(event.operationId);
    }
    const sender = writeOperationSenders.get(event.operationId);
    if (!sender) {
      forgetProgress(event.operationId);
      return;
    }
    try {
      deliverProgress(event.operationId, event.status, event.runtimeConflict != null, () =>
        sendProgress(sender, toProgressEvent(event, action)),
      );
    } finally {
      if (isTerminalStatus(event.status)) {
        detachSender(event.operationId);
      }
    }
  });

  function freeWriteSlot(operationId: string): void {
    if (activeWriteOperationId !== operationId) {
      return;
    }
    activeWriteOperationId = null;
    for (const resolveWaiter of idleWaiters.splice(0)) {
      resolveWaiter();
    }
  }

  // Resolves once no operation holds the write slot: at once if none does, otherwise when
  // the running one has finished (it has sent its last event by then).
  function whenIdle(): Promise<void> {
    if (activeWriteOperationId === null) {
      return Promise.resolve();
    }
    return new Promise((resolveIdle) => {
      idleWaiters.push(resolveIdle);
    });
  }

  function getActiveOperation(): { operationId: string; kind: WriteOperationKind } | null {
    const operationId = activeWriteOperationId;
    // A rename or new folder still being checked has changed nothing yet.
    if (operationId === null || operationId === PREPARING_WRITE_OPERATION_ID) {
      return null;
    }
    const localAction = localWriteOperationActions.get(operationId);
    if (localAction !== undefined) {
      return { operationId, kind: toWriteOperationKind(localAction) };
    }
    return { operationId, kind: copyPasteModes.get(operationId) === "cut" ? "move" : "copy" };
  }

  // Sends a progress update now, or holds it back if one went out a moment ago (see
  // PROGRESS_UPDATE_INTERVAL_MS). Only plain "running" updates wait: a question for the
  // user and the end of the operation go out at once, ahead of anything held back.
  function deliverProgress(
    operationId: string,
    status: WriteOperationProgressEvent["status"],
    asksUser: boolean,
    send: () => void,
  ): void {
    const throttle = progressThrottles.get(operationId) ?? {
      lastSentAt: Number.NEGATIVE_INFINITY,
      pending: null,
      timer: null,
    };
    if (status !== "running" || asksUser) {
      forgetProgress(operationId);
      if (!isTerminalStatus(status)) {
        progressThrottles.set(operationId, { lastSentAt: Date.now(), pending: null, timer: null });
      }
      send();
      return;
    }
    progressThrottles.set(operationId, throttle);
    const waitMs = throttle.lastSentAt + PROGRESS_UPDATE_INTERVAL_MS - Date.now();
    if (waitMs <= 0 && throttle.timer === null) {
      throttle.lastSentAt = Date.now();
      send();
      return;
    }
    throttle.pending = send;
    if (throttle.timer === null) {
      throttle.timer = setTimeout(
        () => {
          throttle.timer = null;
          const pending = throttle.pending;
          throttle.pending = null;
          throttle.lastSentAt = Date.now();
          pending?.();
        },
        Math.max(waitMs, 0),
      );
    }
  }

  function forgetProgress(operationId: string): void {
    const throttle = progressThrottles.get(operationId);
    if (throttle?.timer) {
      clearTimeout(throttle.timer);
    }
    progressThrottles.delete(operationId);
  }

  function createLocalWriteOperationId(): string {
    localWriteOperationSequence += 1;
    return `write-op-${localWriteOperationSequence}`;
  }

  function ensureNoWriteOperationInFlight(): void {
    if (closing) {
      throw new Error("File Trail is quitting.");
    }
    if (activeWriteOperationId !== null) {
      throw new Error("Another write operation is already running.");
    }
  }

  // Claims the write slot before async preparation so a second request arriving
  // meanwhile is rejected instead of running alongside this one.
  async function prepareWithReservedSlot<T>(prepare: () => Promise<T>): Promise<T> {
    ensureNoWriteOperationInFlight();
    activeWriteOperationId = PREPARING_WRITE_OPERATION_ID;
    try {
      return await prepare();
    } finally {
      freeWriteSlot(PREPARING_WRITE_OPERATION_ID);
    }
  }

  // An operation whose page crashed, closed, or reloaded can never be answered or finished
  // from the UI, so it is cancelled instead of holding the write slot forever. Listeners
  // are added only now, after the start request arrived, so a reload that happened before
  // this operation began can't reach it: an operation started by the reloaded page is safe.
  function attachSender(operationId: string, sender: WriteOperationSender): void {
    writeOperationSenders.set(operationId, sender);
    if (isSenderDestroyed(sender)) {
      // The window closed while the start request was in flight; nothing will ever
      // answer this operation.
      cancelWriteOperation(operationId);
      return;
    }
    const events = sender as SenderLifecycleEvents;
    if (typeof events.on !== "function" || typeof events.removeListener !== "function") {
      return;
    }
    const cancel = () => {
      cancelWriteOperation(operationId);
    };
    for (const eventName of SENDER_GONE_EVENTS) {
      events.on.call(sender, eventName, cancel);
    }
    senderDetachers.set(operationId, () => {
      for (const eventName of SENDER_GONE_EVENTS) {
        events.removeListener?.call(sender, eventName, cancel);
      }
    });
  }

  function detachSender(operationId: string): void {
    writeOperationSenders.delete(operationId);
    senderDetachers.get(operationId)?.();
    senderDetachers.delete(operationId);
  }

  // Cancel and conflict answers are only taken from the window that started the
  // operation; another window (such as Settings) shares the same preload API.
  function isOperationOwner(operationId: string, requester: unknown): boolean {
    const owner = writeOperationSenders.get(operationId);
    return owner !== undefined && owner === requester;
  }

  // A window can be destroyed between our check and the send, and Electron then throws
  // "Object has been destroyed". Losing a progress update for a window that's gone is fine;
  // letting the throw skip the operation's cleanup is not.
  function sendProgress(sender: WriteOperationSender, payload: WriteOperationProgressEvent): void {
    if (isSenderDestroyed(sender)) {
      return;
    }
    try {
      sender.send(WRITE_OPERATION_PROGRESS_CHANNEL, payload);
    } catch {
      // The window went away mid-send; there is no one left to tell.
    }
  }

  function queueLocalWriteOperation(args: {
    action: WriteOperationAction;
    sender: WriteOperationSender;
    execute: (operationId: string, controller: AbortController) => Promise<void>;
  }): { operationId: string; status: "queued" } {
    // The app may have started quitting while a rename was being checked.
    ensureNoWriteOperationInFlight();
    const operationId = createLocalWriteOperationId();
    const controller = new AbortController();
    activeWriteOperationId = operationId;
    localWriteOperationControllers.set(operationId, controller);
    localWriteOperationActions.set(operationId, args.action);
    attachSender(operationId, args.sender);
    emitLocalWriteOperationEvent({
      operationId,
      action: args.action,
      status: "queued",
      completedItemCount: 0,
      totalItemCount: 0,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      result: null,
    });
    void args
      .execute(operationId, controller)
      .catch((error: unknown) => {
        console.error("[filetrail] local write operation failed unexpectedly", error);
      })
      .finally(() => {
        // Normally the terminal event already released everything; this only matters if
        // the operation stopped without reaching one, which would otherwise lock writes.
        releaseLocalWriteOperation(operationId);
      });
    return {
      operationId,
      status: "queued",
    };
  }

  function releaseLocalWriteOperation(operationId: string): void {
    detachSender(operationId);
    localWriteOperationControllers.delete(operationId);
    localWriteOperationActions.delete(operationId);
    freeWriteSlot(operationId);
  }

  function emitLocalWriteOperationEvent(event: WriteOperationProgressEvent): void {
    const sender = writeOperationSenders.get(event.operationId);
    // Release the operation before telling the window, so a failed send can't leave the
    // write slot held and a renderer reacting to the final event can start the next write.
    if (isTerminalStatus(event.status)) {
      // Folder listings read before the operation finished may show the old contents.
      clearResponseCaches();
      releaseLocalWriteOperation(event.operationId);
    }
    if (sender) {
      deliverProgress(event.operationId, event.status, false, () =>
        sendProgress(sender, writeOperationProgressEventSchema.parse(event)),
      );
    } else {
      forgetProgress(event.operationId);
    }
  }

  function createLocalWriteOperationResult(args: {
    operationId: string;
    action: WriteOperationAction;
    targetPath: string | null;
    startedAt: string;
    finishedAt: string;
    totalItemCount: number;
    completedItemCount: number;
    items: WriteOperationResult["items"];
    status: "completed" | "failed" | "cancelled" | "partial";
    error: string | null;
  }): WriteOperationResult {
    return {
      operationId: args.operationId,
      action: args.action,
      status: args.status,
      targetPath: args.targetPath,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      summary: {
        topLevelItemCount: args.items.length,
        totalItemCount: args.totalItemCount,
        completedItemCount: args.completedItemCount,
        failedItemCount: args.items.filter((item) => item.status === "failed").length,
        skippedItemCount: args.items.filter((item) => item.status === "skipped").length,
        cancelledItemCount: args.items.filter((item) => item.status === "cancelled").length,
        completedByteCount: 0,
        totalBytes: null,
      },
      items: args.items,
      error: args.error,
    };
  }

  function resolveLocalTerminalStatus(args: {
    cancelled: boolean;
    completedItemCount: number;
    failedItemCount: number;
  }): "completed" | "failed" | "cancelled" | "partial" {
    if (args.cancelled) {
      return args.completedItemCount > 0 ? "partial" : "cancelled";
    }
    if (args.failedItemCount > 0) {
      return args.completedItemCount > 0 ? "partial" : "failed";
    }
    return "completed";
  }

  // Sends the end of a rename or new folder, which each change a single item.
  function emitSingleItemResult(args: {
    operationId: string;
    action: "rename" | "new_folder";
    startedAt: string;
    sourcePath: string | null;
    destinationPath: string;
    status: "completed" | "failed" | "cancelled";
    error: string | null;
  }): void {
    const completedItemCount = args.status === "completed" ? 1 : 0;
    const result = createLocalWriteOperationResult({
      operationId: args.operationId,
      action: args.action,
      targetPath: args.destinationPath,
      startedAt: args.startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: 1,
      completedItemCount,
      items: [
        {
          sourcePath: args.sourcePath,
          destinationPath: args.destinationPath,
          status: args.status,
          error: args.error,
          skipReason: null,
        },
      ],
      status: args.status,
      error: args.error,
    });
    emitLocalWriteOperationEvent({
      operationId: args.operationId,
      action: args.action,
      status: args.status,
      completedItemCount,
      totalItemCount: 1,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: args.sourcePath,
      currentDestinationPath: args.destinationPath,
      result,
    });
  }

  async function executeRenameOperation(
    operation: PreparedRenameOperation,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    const { sourcePath, destinationPath, renamesItself } = operation;
    const startedAt = new Date().toISOString();
    try {
      controller.signal.throwIfAborted();
      emitLocalWriteOperationEvent({
        operationId,
        action: "rename",
        status: "running",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: sourcePath,
        currentDestinationPath: destinationPath,
        result: null,
      });
      controller.signal.throwIfAborted();
      if (renamesItself) {
        await fs.rename(sourcePath, destinationPath);
      } else {
        // The name was free when it was checked, but something may have taken it since:
        // this fails then, instead of replacing that item.
        await fs.renameExclusive(sourcePath, destinationPath);
      }
    } catch (error) {
      const cancelled = isAbortError(error) || controller.signal.aborted;
      emitSingleItemResult({
        operationId,
        action: "rename",
        startedAt,
        sourcePath,
        destinationPath,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled
          ? "Operation cancelled."
          : describeWriteError(error, {
              missing: basename(sourcePath),
              existing: basename(destinationPath),
            }),
      });
      return;
    }
    // Outside the try: the item has been renamed, and nothing that goes wrong while
    // reporting it may turn that into a failure.
    emitSingleItemResult({
      operationId,
      action: "rename",
      startedAt,
      sourcePath,
      destinationPath,
      status: "completed",
      error: null,
    });
  }

  async function prepareRenameOperation(
    payload: IpcRequest<"writeOperation:rename">,
  ): Promise<PreparedRenameOperation> {
    const sourcePath = resolve(payload.sourcePath);
    assertNotProtectedPath([sourcePath]);
    const sourceName = basename(sourcePath);
    const destinationName = payload.destinationName.trim();
    const destinationPath = join(dirname(sourcePath), destinationName);
    let sourceStats: WriteOperationStats;
    try {
      sourceStats = await fs.lstat(sourcePath);
    } catch (error) {
      throw new Error(describeWriteError(error, { missing: sourceName }));
    }
    if (destinationPath === sourcePath) {
      throw new Error("Choose a different name.");
    }
    const destinationStats = await lstatOrNull(destinationPath, fs.lstat);
    // On a disk that ignores case, "notes.txt" finds "Notes.txt": the item itself, not
    // another one in the way. On a disk that minds case they are two different items.
    const renamesItself =
      destinationStats !== null &&
      isSameItem(sourceStats, destinationStats) &&
      namesMatchIgnoringCase(sourceName, destinationName);
    if (destinationStats !== null && !renamesItself) {
      throw new Error(`An item named “${destinationName}” already exists.`);
    }
    return {
      sourcePath,
      destinationPath,
      renamesItself,
    };
  }

  async function executeCreateFolderOperation(
    operation: PreparedCreateFolderOperation,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    const { destinationPath } = operation;
    const startedAt = new Date().toISOString();
    try {
      controller.signal.throwIfAborted();
      emitLocalWriteOperationEvent({
        operationId,
        action: "new_folder",
        status: "running",
        completedItemCount: 0,
        totalItemCount: 1,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: destinationPath,
        result: null,
      });
      controller.signal.throwIfAborted();
      await fs.mkdir(destinationPath);
    } catch (error) {
      const cancelled = isAbortError(error) || controller.signal.aborted;
      emitSingleItemResult({
        operationId,
        action: "new_folder",
        startedAt,
        sourcePath: null,
        destinationPath,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled
          ? "Operation cancelled."
          : describeWriteError(error, {
              missing: basename(dirname(destinationPath)),
              existing: basename(destinationPath),
            }),
      });
      return;
    }
    // Outside the try, for the same reason as a rename's.
    emitSingleItemResult({
      operationId,
      action: "new_folder",
      startedAt,
      sourcePath: null,
      destinationPath,
      status: "completed",
      error: null,
    });
  }

  async function prepareCreateFolderOperation(
    payload: IpcRequest<"writeOperation:createFolder">,
  ): Promise<PreparedCreateFolderOperation> {
    const parentDirectoryPath = resolve(payload.parentDirectoryPath);
    const folderName = payload.folderName.trim();
    const destinationPath = join(parentDirectoryPath, folderName);
    let parentStats: WriteOperationStats;
    try {
      parentStats = await fs.stat(parentDirectoryPath);
    } catch (error) {
      throw new Error(describeWriteError(error, { missing: basename(parentDirectoryPath) }));
    }
    if (!parentStats.isDirectory()) {
      throw new Error("Folder destination must be an existing directory.");
    }
    if ((await lstatOrNull(destinationPath, fs.lstat)) !== null) {
      throw new Error(`An item named “${folderName}” already exists.`);
    }
    return { destinationPath };
  }

  async function executeTrashOperation(
    payload: IpcRequest<"writeOperation:trash">,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    const paths = payload.paths.map((path) => resolve(path));
    const startedAt = new Date().toISOString();
    const items: WriteOperationResult["items"] = [];
    let completedItemCount = 0;
    let cancelled = false;
    // One item that can't go to the Trash doesn't keep the others from going; only
    // cancelling stops the rest.
    for (const path of paths) {
      if (controller.signal.aborted) {
        cancelled = true;
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "cancelled",
          error: "Operation cancelled.",
          skipReason: null,
        });
        break;
      }
      emitLocalWriteOperationEvent({
        operationId,
        action: "trash",
        status: "running",
        completedItemCount,
        totalItemCount: paths.length,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: path,
        currentDestinationPath: null,
        result: null,
      });
      try {
        // An item that is already gone (deleted or moved since it was chosen) has
        // nothing left to move: that counts as done, not as a failure.
        if (!(await isMissing(path, fs.lstat))) {
          await fs.trash(path);
        }
        completedItemCount += 1;
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "completed",
          error: null,
          skipReason: null,
        });
      } catch (error) {
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "failed",
          error: describeTrashError(error, path),
          skipReason: null,
        });
      }
    }
    const failedItemCount = items.filter((item) => item.status === "failed").length;
    const status = resolveLocalTerminalStatus({
      cancelled,
      completedItemCount,
      failedItemCount,
    });
    const result = createLocalWriteOperationResult({
      operationId,
      action: "trash",
      targetPath: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: paths.length,
      completedItemCount,
      items,
      status,
      error:
        status === "cancelled"
          ? "Operation cancelled."
          : failedItemCount > 0
            ? (items.find((item) => item.status === "failed")?.error ?? "Trash failed.")
            : null,
    });
    emitLocalWriteOperationEvent({
      operationId,
      action: "trash",
      status,
      completedItemCount,
      totalItemCount: paths.length,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      result,
    });
  }

  async function executeDeleteImmediatelyOperation(
    payload: IpcRequest<"writeOperation:deleteImmediately">,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    const paths = payload.paths.map((path) => resolve(path));
    const startedAt = new Date().toISOString();
    const items: WriteOperationResult["items"] = [];
    let completedItemCount = 0;
    let cancelled = false;
    for (const path of paths) {
      if (controller.signal.aborted) {
        cancelled = true;
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "cancelled",
          error: "Operation cancelled.",
          skipReason: null,
        });
        break;
      }
      emitLocalWriteOperationEvent({
        operationId,
        action: "delete_immediately",
        status: "running",
        completedItemCount,
        totalItemCount: paths.length,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: path,
        currentDestinationPath: null,
        result: null,
      });
      try {
        await fs.rm(path, { recursive: true, force: true });
        completedItemCount += 1;
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "completed",
          error: null,
          skipReason: null,
        });
      } catch (error) {
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "failed",
          error: describeCopyPasteError(error),
          skipReason: null,
        });
      }
    }
    const failedItemCount = items.filter((item) => item.status === "failed").length;
    // Items deleted before a cancel are gone for good, so that is "partial", as for Trash.
    const status = resolveLocalTerminalStatus({
      cancelled,
      completedItemCount,
      failedItemCount,
    });
    const result: WriteOperationResult = createLocalWriteOperationResult({
      operationId,
      action: "delete_immediately",
      targetPath: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: paths.length,
      completedItemCount,
      items,
      status,
      error:
        status === "cancelled"
          ? "Operation cancelled."
          : failedItemCount > 0
            ? (items.find((item) => item.status === "failed")?.error ?? "Delete failed.")
            : null,
    });
    emitLocalWriteOperationEvent({
      operationId,
      action: "delete_immediately",
      status,
      completedItemCount,
      totalItemCount: paths.length,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      result,
    });
  }

  function cancelWriteOperation(operationId: string): { ok: boolean } {
    const localController = localWriteOperationControllers.get(operationId);
    if (localController) {
      localController.abort();
      return { ok: true };
    }
    return writeService.cancelOperation(operationId);
  }

  // An analysis is read, cancelled, and started only by the window that asked for it;
  // another window (such as Settings) shares the same preload API.
  function assertAnalysisOwner(analysisId: string, requester: unknown): void {
    const owner = analysisOwners.get(analysisId);
    if (owner === undefined || owner !== requester) {
      throw new Error("This copy was set up in another window.");
    }
  }

  // Stops the running operation, if any, and waits until it has finished: an operation
  // stops after the item it is on and removes any partly copied file, which can take a
  // moment for a large file. No new operation can start afterwards.
  async function shutdown(): Promise<void> {
    closing = true;
    // The operation is being stopped anyway; a window closing now has nothing to add.
    // Its final event is still sent to the window if it is open.
    for (const detach of senderDetachers.values()) {
      detach();
    }
    senderDetachers.clear();
    const operationId = activeWriteOperationId;
    if (operationId !== null && operationId !== PREPARING_WRITE_OPERATION_ID) {
      cancelWriteOperation(operationId);
    }
    await whenIdle();
    writeServiceUnsubscribe();
    for (const progressOperationId of [...progressThrottles.keys()]) {
      forgetProgress(progressOperationId);
    }
    writeOperationSenders.clear();
    copyPasteRequests.clear();
    copyPasteModes.clear();
    analysisOwners.clear();
    localWriteOperationControllers.clear();
    localWriteOperationActions.clear();
  }

  return {
    handlers: {
      "copyPaste:analyzeStart": (
        payload: IpcRequest<"copyPaste:analyzeStart">,
        event: { sender: WriteOperationSender },
      ) => {
        if (payload.mode === "cut") {
          assertNotProtectedPath(payload.sourcePaths);
        }
        ensureNoWriteOperationInFlight();
        const handle = writeService.startCopyPasteAnalysis({
          mode: payload.mode,
          sourcePaths: payload.sourcePaths,
          destinationDirectoryPath: payload.destinationDirectoryPath,
        });
        // Starting an analysis drops the write service's finished ones, so only this one
        // can still be asked about.
        analysisOwners.clear();
        analysisOwners.set(handle.analysisId, event.sender);
        return handle;
      },
      "copyPaste:analyzeGetUpdate": (
        payload: IpcRequest<"copyPaste:analyzeGetUpdate">,
        event: { sender: WriteOperationSender },
      ) => {
        assertAnalysisOwner(payload.analysisId, event.sender);
        const update = writeService.getCopyPasteAnalysisUpdate(payload.analysisId);
        return update.report
          ? { ...update, report: trimAnalysisReportForWindow(update.report) }
          : update;
      },
      "copyPaste:analyzeCancel": (
        payload: IpcRequest<"copyPaste:analyzeCancel">,
        event: { sender: WriteOperationSender },
      ) =>
        analysisOwners.get(payload.analysisId) === event.sender
          ? writeService.cancelCopyPasteAnalysis(payload.analysisId)
          : REJECTED_REQUEST,
      "copyPaste:plan": (payload: IpcRequest<"copyPaste:plan">) => {
        if (payload.mode === "cut") {
          assertNotProtectedPath(payload.sourcePaths);
        }
        return writeService.planCopyPaste({
          mode: payload.mode,
          sourcePaths: payload.sourcePaths,
          destinationDirectoryPath: payload.destinationDirectoryPath,
          conflictResolution: payload.conflictResolution,
        });
      },
      "copyPaste:start": (
        payload: IpcRequest<"copyPaste:start">,
        event: { sender: WriteOperationSender },
      ) => {
        if ("sourcePaths" in payload && payload.mode === "cut") {
          assertNotProtectedPath(payload.sourcePaths);
        }
        ensureNoWriteOperationInFlight();
        if ("analysisId" in payload) {
          assertAnalysisOwner(payload.analysisId, event.sender);
        }
        // The write service can finish an operation before startCopyPaste returns (an
        // analysis that is no longer usable fails at once). Its end is caught here, so the
        // write slot isn't claimed for an operation that is already over.
        earlyTerminalEvents = new Map();
        let handle: ReturnType<WriteService["startCopyPaste"]>;
        let finishedEarly: CopyPasteProgressEvent | undefined;
        try {
          handle =
            "analysisId" in payload
              ? writeService.startCopyPaste({
                  analysisId: payload.analysisId,
                  policy: payload.policy,
                  ...(payload.overrides ? { overrides: payload.overrides } : {}),
                })
              : writeService.startCopyPaste({
                  mode: payload.mode,
                  sourcePaths: payload.sourcePaths,
                  destinationDirectoryPath: payload.destinationDirectoryPath,
                  conflictResolution: payload.conflictResolution,
                });
          finishedEarly = earlyTerminalEvents.get(handle.operationId);
        } finally {
          earlyTerminalEvents = null;
        }
        if (finishedEarly) {
          // The window learns the operation id from this reply, so its end is sent just
          // after it, when the window is listening for that id.
          const sender = event.sender;
          const progress = toProgressEvent(finishedEarly, payload.action);
          setTimeout(() => sendProgress(sender, progress), 0);
          return handle;
        }
        activeWriteOperationId = handle.operationId;
        copyPasteRequests.set(handle.operationId, payload);
        attachSender(handle.operationId, event.sender);
        return handle;
      },
      "copyPaste:cancel": (
        payload: IpcRequest<"copyPaste:cancel">,
        event: { sender: WriteOperationSender },
      ) =>
        isOperationOwner(payload.operationId, event.sender)
          ? cancelWriteOperation(payload.operationId)
          : REJECTED_REQUEST,
      "copyPaste:resolveConflict": (
        payload: IpcRequest<"copyPaste:resolveConflict">,
        event: { sender: WriteOperationSender },
      ) => {
        if (!isOperationOwner(payload.operationId, event.sender)) {
          return REJECTED_REQUEST;
        }
        return writeService.resolveRuntimeConflict(
          payload.operationId,
          payload.conflictId,
          payload.resolution,
          payload.applyToRemaining ?? false,
        );
      },
      "writeOperation:rename": async (
        payload: IpcRequest<"writeOperation:rename">,
        event: { sender: WriteOperationSender },
      ) => {
        const operation = await prepareWithReservedSlot(() => prepareRenameOperation(payload));
        return queueLocalWriteOperation({
          action: "rename",
          sender: event.sender,
          execute: (operationId, controller) =>
            executeRenameOperation(operation, operationId, controller),
        });
      },
      "writeOperation:createFolder": async (
        payload: IpcRequest<"writeOperation:createFolder">,
        event: { sender: WriteOperationSender },
      ) => {
        const operation = await prepareWithReservedSlot(() =>
          prepareCreateFolderOperation(payload),
        );
        return queueLocalWriteOperation({
          action: "new_folder",
          sender: event.sender,
          execute: (operationId, controller) =>
            executeCreateFolderOperation(operation, operationId, controller),
        });
      },
      "writeOperation:trash": (
        payload: IpcRequest<"writeOperation:trash">,
        event: { sender: WriteOperationSender },
      ) => {
        assertNotProtectedPath(payload.paths);
        assertNotSystemLocation(payload.paths, "moved to the Trash");
        ensureNoWriteOperationInFlight();
        return queueLocalWriteOperation({
          action: "trash",
          sender: event.sender,
          execute: (operationId, controller) =>
            executeTrashOperation(payload, operationId, controller),
        });
      },
      "writeOperation:deleteImmediately": (
        payload: IpcRequest<"writeOperation:deleteImmediately">,
        event: { sender: WriteOperationSender },
      ) => {
        assertNotProtectedPath(payload.paths);
        assertNotSystemLocation(payload.paths, "deleted");
        ensureNoWriteOperationInFlight();
        return queueLocalWriteOperation({
          action: "delete_immediately",
          sender: event.sender,
          execute: (operationId, controller) =>
            executeDeleteImmediatelyOperation(payload, operationId, controller),
        });
      },
      "writeOperation:cancel": (
        payload: IpcRequest<"writeOperation:cancel">,
        event: { sender: WriteOperationSender },
      ) =>
        isOperationOwner(payload.operationId, event.sender)
          ? cancelWriteOperation(payload.operationId)
          : REJECTED_REQUEST,
    },
    getActiveOperation,
    whenIdle,
    shutdown,
  };
}

// Folders that hold the system, the apps, every user's files, or a whole disk. Deleting or
// trashing one is never what was meant, so it is refused whatever the window asks.
const SYSTEM_LOCATIONS = new Set(
  [
    "/",
    "/Users",
    "/Volumes",
    "/System",
    "/Applications",
    "/Library",
    "/private",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/var",
    "/opt",
  ].map((path) => path.toLowerCase()),
);

function assertNotSystemLocation(paths: readonly string[], verb: string): void {
  const home = resolve(homedir()).toLowerCase();
  for (const path of paths) {
    if (!path.startsWith("/")) {
      throw new Error("Expected an absolute path.");
    }
    // The disk ignores case, so "/users" is "/Users".
    const normalized = resolve(path).toLowerCase();
    if (normalized === "/") {
      throw new Error(`The startup disk can't be ${verb}.`);
    }
    if (
      SYSTEM_LOCATIONS.has(normalized) ||
      normalized === home ||
      /^\/volumes\/[^/]+$/.test(normalized)
    ) {
      throw new Error(`“${basename(resolve(path))}” can't be ${verb}.`);
    }
  }
}

type AnalysisReport = NonNullable<ReturnType<WriteService["getCopyPasteAnalysisUpdate"]>["report"]>;
type AnalysisNode = AnalysisReport["nodes"][number];

// The report of an analysis has a record for every file and folder to be copied. The window
// draws the review from it, and looks inside an item only when it is a folder that exists on
// both sides (the clashes inside are listed and can be answered one by one). What is inside
// an item that is new at the destination is never read there, so it is left out of what the
// window is sent: for a large copy that is nearly the whole report, tens of megabytes
// checked and sent for nothing.
// This returns a trimmed copy. The write service copies from its own report, which must
// stay whole.
export function trimAnalysisReportForWindow(report: AnalysisReport): AnalysisReport {
  return { ...report, nodes: report.nodes.map(trimAnalysisNodeForWindow) };
}

function trimAnalysisNodeForWindow(node: AnalysisNode): AnalysisNode {
  return {
    ...node,
    children:
      node.conflictClass === "directory_conflict"
        ? node.children.map(trimAnalysisNodeForWindow)
        : [],
  };
}

function isSenderDestroyed(sender: WriteOperationSender): boolean {
  try {
    return sender.isDestroyed?.() === true;
  } catch {
    return true;
  }
}

async function lstatOrNull(
  path: string,
  lstatFn: WriteOperationFs["lstat"],
): Promise<WriteOperationStats | null> {
  try {
    return await lstatFn(path);
  } catch {
    return null;
  }
}

// True only when the item is certainly gone; any other trouble reading it is left for
// the operation itself to report.
async function isMissing(path: string, lstatFn: WriteOperationFs["lstat"]): Promise<boolean> {
  try {
    await lstatFn(path);
    return false;
  } catch (error) {
    return errorCode(error) === "ENOENT";
  }
}

function isSameItem(left: WriteOperationStats, right: WriteOperationStats): boolean {
  return (
    left.dev !== undefined &&
    left.ino !== undefined &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

// Two names that differ only in case or in how an accented letter is encoded. Together with
// the same file id this tells a rename of the item to itself from two hard links to one file.
function namesMatchIgnoringCase(left: string, right: string): boolean {
  return left.normalize("NFC").toLowerCase() === right.normalize("NFC").toLowerCase();
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

// A plain sentence for a failed rename, new folder, or the checks before them. Where the
// error is about a particular item, it is named.
function describeWriteError(
  error: unknown,
  names: { missing?: string; existing?: string } = {},
): string {
  const code = errorCode(error);
  if (code === "ENOENT" && names.missing) {
    return `“${names.missing}” no longer exists.`;
  }
  if (code === "EEXIST" && names.existing) {
    return `An item named “${names.existing}” already exists.`;
  }
  return describeCopyPasteError(error);
}

// The Trash reports most failures in its own words, with no error code. The usual cause is
// a disk without a Trash (a network share, some USB drives), where only deleting works.
function describeTrashError(error: unknown, path: string): string {
  const described = describeCopyPasteError(error);
  if (described !== toErrorMessage(error)) {
    return described;
  }
  return `Couldn't move “${basename(path)}” to the Trash. This disk may not have a Trash; use Delete Immediately instead.`;
}

function toWriteOperationKind(action: WriteOperationAction): WriteOperationKind {
  switch (action) {
    case "trash":
      return "trash";
    case "delete_immediately":
      return "delete";
    case "rename":
      return "rename";
    case "new_folder":
      return "new_folder";
    default:
      return "copy";
  }
}

// The window's view of a write service event.
function toProgressEvent(
  event: CopyPasteProgressEvent,
  action: WriteOperationAction,
): WriteOperationProgressEvent {
  return writeOperationProgressEventSchema.parse({
    operationId: event.operationId,
    action,
    status: event.status,
    completedItemCount: event.completedItemCount,
    totalItemCount: event.totalItemCount,
    completedByteCount: event.completedByteCount,
    totalBytes: event.totalBytes,
    currentSourcePath: event.currentSourcePath,
    currentDestinationPath: event.currentDestinationPath,
    runtimeConflict: event.runtimeConflict,
    result: event.result
      ? {
          operationId: event.result.operationId,
          action,
          status: event.result.status,
          targetPath: event.result.destinationDirectoryPath,
          startedAt: event.result.startedAt,
          finishedAt: event.result.finishedAt,
          summary: event.result.summary,
          items: event.result.items,
          error: event.result.error,
        }
      : null,
  });
}

function isTerminalStatus(
  status: WriteOperationProgressEvent["status"] | WriteOperationResult["status"],
): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "partial"
  );
}
