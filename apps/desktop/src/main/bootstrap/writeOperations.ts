import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  type IpcRequest,
  type UndoDirection,
  type WriteOperationAction,
  type WriteOperationProgressEvent,
  type WriteOperationResult,
  isAbortError,
  isInsideTrash,
  pathsChangedByWrite,
  withoutNestedPaths,
  writeOperationProgressEventSchema,
} from "@filetrail/contracts";
import {
  type CopyPasteProgressEvent,
  type ItemId,
  type ItemKind,
  NO_TRASH_ERROR_CODE,
  type UndoLog,
  type UndoStep,
  type UndoUnit,
  WRITE_OPERATION_BUSY_ERROR,
  type WriteService,
  describeCopyPasteError,
  fileIdOf,
  findLockedRefusal,
  readItemId,
  readItemRef,
  readItemStamp,
} from "@filetrail/core";
import { runBatchRename } from "./batchRenameExecution";
import type { ItemSize, RemovedItem } from "./folderSizeAdjust";
import { clearResponseCaches, noteWriteStarting } from "./responseCache";
import { runUndo } from "./undoExecution";
import type { UndoEntry, UndoHistory } from "./undoHistory";
import { findQuestions } from "./undoPlan";

type WriteOperationStats = { isDirectory(): boolean; dev?: number; ino?: number };

// Filesystem operations used by write operations (rename, mkdir, path checks).
// Callers inject an original-fs backed implementation to bypass Electron's ASAR
// patching, which would otherwise misreport .asar files as directories.
export type WriteOperationFs = {
  lstat: (path: string) => Promise<WriteOperationStats>;
  stat: (path: string) => Promise<WriteOperationStats>;
  mkdir: (path: string) => Promise<void>;
  // A folder's entry names as stored, to tell one item found under two spellings of a name
  // from two items whose names differ only in case.
  readdir?: (path: string) => Promise<string[]>;
  // Where a folder really is, symlinks followed: Delete Immediately checks that what it
  // deletes is really in the Trash.
  realpath?: (path: string) => Promise<string>;
  // Fails with EEXIST rather than replace an item already at the new path (renamex_np
  // with RENAME_EXCL). Every rename goes through this one...
  renameExclusive: (oldPath: string, newPath: string) => Promise<void>;
  // ...except one that only changes the case of a name ("notes" to "Notes") on a disk that
  // ignores case: there the new name already "exists", because it is the item itself.
  rename: (oldPath: string, newPath: string) => Promise<void>;
  rm: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
  // Moves an item to the Trash and resolves with the path it has there (createTrashItem in
  // the app).
  trash: (path: string) => Promise<string>;
  // The item's BSD flags, to tell a locked item from a lack of permission.
  getFlags?: (path: string) => Promise<number>;
  // An item as a folder's measurement counts it (nativeItemSize), read just before a delete
  // removes it, so the measured folders that held it can have it taken off their sizes.
  itemSize?: (path: string) => Promise<ItemSize>;
};

// What a finished operation did, for Undo: its steps (or why it can't be undone), and its
// items as the window hears of them, to name it in the Edit menu.
export type FinishedWrite = {
  action: WriteOperationAction | "empty_trash";
  log: UndoLog;
  items: ReadonlyArray<{
    sourcePath: string | null;
    destinationPath: string | null;
    status: WriteOperationResult["items"][number]["status"];
  }>;
};

// What kind of change the running operation is making, in the words a person would use.
export type WriteOperationKind =
  | "copy"
  | "move"
  | "trash"
  | "delete"
  | "rename"
  | "new_folder"
  | "undo";

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
// Tells a window that a running operation is its own now: the window that started it
// closed. Carries the operation's latest progress, so the window can show where it is.
const WRITE_OPERATION_ADOPTED_CHANNEL = "filetrail:writeOperationAdopted";

// Progress is reported once per item, which for a folder of small files is thousands of
// messages a second. The window only keeps a progress card current, so plain "running"
// updates are sent at most this often; the newest one always gets through.
export const PROGRESS_UPDATE_INTERVAL_MS = 100;

// How long quitting waits for a stopped operation to finish cleaning up.
export const SHUTDOWN_WAIT_LIMIT_MS = 15_000;

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

export function createWriteOperationCoordinator(
  writeService: WriteService,
  fs: WriteOperationFs,
  options: {
    // Where the home folder and its Trash are (tests use their own).
    homePath?: string;
    // Told what each operation did, before the next one can start, so they are kept in
    // the order they happened. Operations that changed nothing aren't told.
    recordUndo?: (finished: FinishedWrite) => void;
    // Whether the disk holding `path` has a Trash. Copies onto one that hasn't can't be
    // undone: that would mean deleting them for good.
    diskHasTrash?: (path: string) => boolean;
    // What Undo and Redo work from. Without it there is nothing to undo.
    undoHistory?: UndoHistory;
    // Every window hears how the running operation is doing, so the others know one is
    // running (and refuse to start another) and can follow what it changed. Called with
    // each progress event and the window it was sent to.
    broadcastProgress?: (event: WriteOperationProgressEvent, owner: WriteOperationSender) => void;
    // The window an operation goes to when the one that started it closes or its page
    // goes away; null when there is none (the app is quitting), and it is cancelled.
    successorOf?: (sender: WriteOperationSender) => WriteOperationSender | null;
  } = {},
) {
  const writeOperationSenders = new Map<string, WriteOperationSender>();
  const senderDetachers = new Map<string, () => void>();
  // The last progress sent for each running operation, for a window that takes it over.
  const latestProgress = new Map<string, WriteOperationProgressEvent>();
  const copyPasteRequests = new Map<string, IpcRequest<"copyPaste:start">>();
  // Whether each running copy-paste copies or moves, from the write service's own events.
  const copyPasteModes = new Map<string, CopyPasteProgressEvent["mode"]>();
  const localWriteOperationControllers = new Map<string, AbortController>();
  const localWriteOperationActions = new Map<string, WriteOperationAction>();
  // The window that started each copy analysis: only it may read, cancel, or start it.
  // Each window has at most one, its newest, kept until it pastes from it or goes away.
  const analysisOwners = new Map<string, WriteOperationSender>();
  // Stops listening for the window of an analysis going away.
  const analysisDetachers = new Map<string, () => void>();
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
  const homePath = options.homePath ?? homedir();

  // A mistake in keeping the history must never keep the write slot from being freed.
  function recordFinishedWrite(finished: FinishedWrite): void {
    try {
      options.recordUndo?.(finished);
    } catch (error) {
      console.error("[filetrail] couldn't record an operation for Undo", error);
    }
  }

  // A paste's own log, except that copies onto a disk without a Trash can't be undone.
  function pasteUndoLog(event: CopyPasteProgressEvent): UndoLog | null {
    const log = event.result?.undoLog;
    if (!log) {
      return null;
    }
    if (!log.undoable) {
      return log;
    }
    if (log.units.length === 0) {
      return null;
    }
    const { diskHasTrash } = options;
    if (diskHasTrash === undefined) {
      return log;
    }
    // Asked once per folder: each answer reads the mount table, and a paste's copies are
    // all in one folder or a few.
    const answers = new Map<string, boolean>();
    const hasTrash = (folder: string) => {
      const known = answers.get(folder);
      if (known !== undefined) {
        return known;
      }
      const answer = diskHasTrash(folder);
      answers.set(folder, answer);
      return answer;
    };
    const copiedOntoDiskWithoutTrash = log.units.some((unit) =>
      unit.steps.some((step) => step.kind === "created" && !hasTrash(dirname(step.path))),
    );
    return copiedOntoDiskWithoutTrash ? { undoable: false, reason: "no_trash" } : log;
  }
  const trashPath = resolve(homePath, ".Trash").toLowerCase();
  function assertNotProtectedPath(paths: readonly string[]): void {
    for (const path of paths) {
      if (resolve(path).toLowerCase() === trashPath) {
        throw new Error("The Trash folder is a protected system directory and cannot be modified.");
      }
    }
  }

  // Nothing is pasted, dropped, duplicated or made in the Trash: Move to Trash puts items
  // there, where they can be put back from. The window offers none of it; this holds
  // whatever it asks.
  function assertNotIntoTrash(destinationDirectoryPath: string, verb: string): void {
    if (isInsideTrash(resolve(destinationDirectoryPath), homePath)) {
      throw new Error(`Nothing can be ${verb} the Trash.`);
    }
  }

  function assertNotAlreadyInTrash(paths: readonly string[]): void {
    for (const path of paths) {
      if (isInsideTrash(resolve(path), homePath)) {
        throw new Error(`“${basename(path)}” is already in the Trash.`);
      }
    }
  }

  // Items that just couldn't go to the Trash because their disk has none, by the window
  // that tried. After asking, that window may delete exactly these immediately (as Finder
  // does on such a disk), whatever another window sends to the Trash meanwhile.
  const itemsWithoutTrash = new WeakMap<WriteOperationSender, Set<string>>();

  // Delete Immediately deletes only what is in a Trash, or what was just found to have no
  // Trash to go to. The folder an item is in is looked up through any symlinks, so a link
  // inside the Trash can't lead the deletion out of it.
  async function assertDeletableImmediately(
    paths: readonly string[],
    sender: WriteOperationSender,
  ): Promise<void> {
    // The home folder as it really is, to compare real paths with.
    const realHomePath = fs.realpath ? await fs.realpath(homePath).catch(() => homePath) : homePath;
    for (const path of paths) {
      const resolved = resolve(path);
      if (itemsWithoutTrash.get(sender)?.has(resolved)) {
        continue;
      }
      const folder = fs.realpath
        ? await fs.realpath(dirname(resolved)).catch(() => null)
        : dirname(resolved);
      const realPath = folder === null ? null : join(folder, basename(resolved));
      if (
        realPath === null ||
        !isInsideTrash(resolved, homePath) ||
        !isInsideTrash(realPath, realHomePath)
      ) {
        throw new Error(
          `“${basename(resolved)}” isn't in the Trash, so it can't be deleted immediately.`,
        );
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
      clearResponseCaches(event.result ? pathsChangedByWrite(event.result) : []);
      const undoLog = pasteUndoLog(event);
      if (undoLog !== null) {
        recordFinishedWrite({ action, log: undoLog, items: event.result?.items ?? [] });
      }
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
      const progress = toDeliverableProgressEvent(event, action);
      deliverProgress(event.operationId, event.status, event.runtimeConflict != null, () =>
        sendProgress(sender, progress),
      );
    } finally {
      if (isTerminalStatus(event.status)) {
        detachSender(event.operationId);
      }
    }
  });

  // The window's view of an event, even when part of it can't be sent (it fails the
  // checks every message to the window goes through). A question the window would never
  // see is answered "skip", which changes nothing; the end of the operation always goes out.
  function toDeliverableProgressEvent(
    event: CopyPasteProgressEvent,
    action: WriteOperationAction,
  ): WriteOperationProgressEvent {
    try {
      return toProgressEvent(event, action);
    } catch (error) {
      console.error("[filetrail] couldn't send an operation update to the window", error);
      if (event.status === "awaiting_resolution" && event.runtimeConflict) {
        writeService.resolveRuntimeConflict(
          event.operationId,
          event.runtimeConflict.conflictId,
          "skip",
          false,
        );
      }
      return toProgressEvent(
        {
          ...event,
          status: event.status === "awaiting_resolution" ? "running" : event.status,
          runtimeConflict: null,
          result: null,
        },
        action,
      );
    }
  }

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

  // Runs a write that isn't one of the person's operations (finishing a Replace a crash
  // cut short) only when the slot is free, holding it meanwhile, so the two never write at
  // the same time. When the slot is taken, or the app is quitting, it doesn't run at all.
  async function runWriteAlone<T>(
    write: () => Promise<T>,
  ): Promise<{ ran: true; value: T } | { ran: false }> {
    if (closing || activeWriteOperationId !== null) {
      return { ran: false };
    }
    return { ran: true, value: await prepareWithReservedSlot(write) };
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
    // With another window open, the operation goes on there instead.
    const handOverOrCancel = () => {
      const successor = options.successorOf?.(sender) ?? null;
      if (successor && successor !== sender && !isSenderDestroyed(successor)) {
        handOver(operationId, successor);
        return;
      }
      cancelWriteOperation(operationId);
    };
    for (const eventName of SENDER_GONE_EVENTS) {
      events.on.call(sender, eventName, handOverOrCancel);
    }
    senderDetachers.set(operationId, () => {
      for (const eventName of SENDER_GONE_EVENTS) {
        events.removeListener?.call(sender, eventName, handOverOrCancel);
      }
    });
  }

  // Makes `successor` the window an operation answers to: its progress, Stop and conflict
  // questions go there from now on.
  function handOver(operationId: string, successor: WriteOperationSender): void {
    senderDetachers.get(operationId)?.();
    senderDetachers.delete(operationId);
    attachSender(operationId, successor);
    const clearsCutClipboard = copyPasteRequests.get(operationId)?.clearsCutClipboard;
    try {
      successor.send(WRITE_OPERATION_ADOPTED_CHANNEL, {
        operationId,
        event: latestProgress.get(operationId) ?? null,
        ...(clearsCutClipboard ? { clearsCutClipboard } : {}),
      });
    } catch {
      // The window went away mid-send; its own close hands the operation on again.
    }
  }

  function detachSender(operationId: string): void {
    writeOperationSenders.delete(operationId);
    senderDetachers.get(operationId)?.();
    senderDetachers.delete(operationId);
    latestProgress.delete(operationId);
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
    if (!isTerminalStatus(payload.status) && writeOperationSenders.has(payload.operationId)) {
      latestProgress.set(payload.operationId, payload);
    }
    try {
      options.broadcastProgress?.(payload, sender);
    } catch (error) {
      // The other windows miss this update; the operation, and its own window, go on.
      console.error("[filetrail] couldn't tell the other windows about an operation", error);
    }
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
    noteWriteStarting();
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
        // Normally the operation's end was sent already. Should it have stopped before,
        // every window is told it failed: each would otherwise wait for it, refusing to
        // start anything else.
        if (localWriteOperationActions.has(operationId)) {
          emitUnexpectedEnd(operationId, args.action, error);
        }
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

  function emitUnexpectedEnd(
    operationId: string,
    action: WriteOperationAction,
    error: unknown,
  ): void {
    const now = new Date().toISOString();
    const message = `The operation stopped unexpectedly: ${
      error instanceof Error ? error.message : String(error)
    }`;
    emitLocalWriteOperationEvent({
      operationId,
      action,
      status: "failed",
      completedItemCount: 0,
      totalItemCount: 0,
      completedByteCount: 0,
      totalBytes: null,
      currentSourcePath: null,
      currentDestinationPath: null,
      result: createLocalWriteOperationResult({
        operationId,
        action,
        targetPath: null,
        startedAt: now,
        finishedAt: now,
        totalItemCount: 0,
        completedItemCount: 0,
        items: [],
        status: "failed",
        error: message,
      }),
    });
  }

  function releaseLocalWriteOperation(operationId: string): void {
    detachSender(operationId);
    localWriteOperationControllers.delete(operationId);
    localWriteOperationActions.delete(operationId);
    freeWriteSlot(operationId);
  }

  function emitLocalWriteOperationEvent(
    event: WriteOperationProgressEvent,
    // What a delete removed, read just before: taken off the sizes of measured folders
    // rather than having them measured again.
    removedItems: readonly RemovedItem[] = [],
    // What the operation did, for Undo; left out when it changed nothing.
    undoLog?: UndoLog,
  ): void {
    const sender = writeOperationSenders.get(event.operationId);
    // Release the operation before telling the window, so a failed send can't leave the
    // write slot held and a renderer reacting to the final event can start the next write.
    if (isTerminalStatus(event.status)) {
      // Folder listings read before the operation finished may show the old contents.
      const removedPaths = new Set(removedItems.map((removed) => removed.path));
      clearResponseCaches(
        event.result
          ? pathsChangedByWrite(event.result).filter((path) => !removedPaths.has(path))
          : [],
        removedItems,
      );
      if (undoLog !== undefined) {
        recordFinishedWrite({
          action: event.action,
          log: undoLog,
          items: event.result?.items ?? [],
        });
      }
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
    undoLog?: UndoLog;
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
    emitLocalWriteOperationEvent(
      {
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
      },
      [],
      args.undoLog,
    );
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
      const locked = cancelled
        ? null
        : await findLockedRefusal(fs, error, [sourcePath, dirname(sourcePath)]);
      emitSingleItemResult({
        operationId,
        action: "rename",
        startedAt,
        sourcePath,
        destinationPath,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled
          ? "Operation cancelled."
          : (locked?.message ??
            describeWriteError(error, {
              missing: basename(sourcePath),
              existing: basename(destinationPath),
            })),
      });
      return;
    }
    // Outside the try: the item has been renamed, and nothing that goes wrong while
    // reporting it may turn that into a failure (reading its id never throws).
    const renamedItem = await readItemRef(fs.lstat, destinationPath);
    const renamed: UndoStep = {
      kind: "moved",
      from: sourcePath,
      to: destinationPath,
      id: renamedItem.id,
      itemKind: renamedItem.kind,
      parentId: await readItemId(fs.lstat, dirname(sourcePath)),
    };
    emitSingleItemResult({
      operationId,
      action: "rename",
      startedAt,
      sourcePath,
      destinationPath,
      status: "completed",
      error: null,
      undoLog: { undoable: true, units: [{ steps: [renamed] }] },
    });
  }

  async function prepareRenameOperation(
    payload: IpcRequest<"writeOperation:rename">,
  ): Promise<PreparedRenameOperation> {
    const sourcePath = resolve(payload.sourcePath);
    assertNotProtectedPath([sourcePath]);
    await assertNotSystemLocation([sourcePath], "renamed", fs);
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
    // another one in the way. On a disk that minds case they are two different items, even
    // two hard links to one file (renaming one onto the other would do nothing at all).
    const renamesItself =
      destinationStats !== null &&
      namesMatchIgnoringCase(sourceName, destinationName) &&
      (isSameItem(sourceStats, destinationStats) ||
        !hasFileId(sourceStats) ||
        !hasFileId(destinationStats)) &&
      !(await listsSeparateEntry(dirname(sourcePath), destinationName));
    if (destinationStats !== null && !renamesItself) {
      throw new Error(`An item named “${destinationName}” already exists.`);
    }
    return {
      sourcePath,
      destinationPath,
      renamesItself,
    };
  }

  // Several items renamed at once. What the request asks is checked before the write slot is
  // taken: nothing protected, no item twice. An item asked to keep its own name is left out.
  async function prepareBatchRenameOperation(
    payload: IpcRequest<"writeOperation:batchRename">,
  ): Promise<IpcRequest<"writeOperation:batchRename">> {
    const items = payload.items
      .map((item) => ({ ...item, sourcePath: resolve(item.sourcePath) }))
      .filter((item) => basename(item.sourcePath) !== item.destinationName.trim());
    if (items.length === 0) {
      throw new Error("Nothing would be renamed.");
    }
    const sources = new Set<string>();
    for (const item of items) {
      if (sources.has(item.sourcePath)) {
        throw new Error(`“${basename(item.sourcePath)}” is in the list twice.`);
      }
      sources.add(item.sourcePath);
    }
    const sourcePaths = items.map((item) => item.sourcePath);
    assertNotProtectedPath(sourcePaths);
    await assertNotSystemLocation(sourcePaths, "renamed", fs, homePath);
    return { ...payload, items };
  }

  async function executeBatchRenameOperation(
    request: IpcRequest<"writeOperation:batchRename">,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    const totalItemCount = request.items.length;
    let run: Awaited<ReturnType<typeof runBatchRename>>;
    try {
      run = await runBatchRename({
        request,
        fs,
        signal: controller.signal,
        onItemStart: (item, completedItemCount) =>
          emitLocalWriteOperationEvent({
            operationId,
            action: "batch_rename",
            status: "running",
            completedItemCount,
            totalItemCount,
            completedByteCount: 0,
            totalBytes: null,
            currentSourcePath: item.sourcePath,
            currentDestinationPath: item.destinationPath,
            result: null,
          }),
      });
    } catch (error) {
      // Nothing expected gets here: every item's failure is in its result. Should something
      // else go wrong, the window still hears the end, so it isn't left waiting.
      run = {
        items: request.items.map((item) => ({
          sourcePath: resolve(item.sourcePath),
          destinationPath: null,
          status: "failed" as const,
          error: `The rename stopped unexpectedly: ${
            error instanceof Error ? error.message : String(error)
          }`,
          skipReason: null,
        })),
        completedItemCount: 0,
        cancelled: false,
      };
    }
    const failedItemCount = run.items.filter((item) => item.status === "failed").length;
    const status = resolveLocalTerminalStatus({
      cancelled: run.cancelled,
      completedItemCount: run.completedItemCount,
      failedItemCount,
    });
    // One folder when all the items are in it, for the window to look at.
    const folders = new Set(request.items.map((item) => dirname(resolve(item.sourcePath))));
    const result = createLocalWriteOperationResult({
      operationId,
      action: "batch_rename",
      targetPath: folders.size === 1 ? ([...folders][0] ?? null) : null,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount,
      completedItemCount: run.completedItemCount,
      items: run.items,
      status,
      error: run.cancelled
        ? stoppedMessage(run.completedItemCount, "renamed")
        : failedItemCount > 0
          ? (run.items.find((item) => item.status === "failed")?.error ?? "Rename failed.")
          : null,
    });
    const renamedItems: Array<{
      from: string;
      to: string;
      id: ItemId | null;
      itemKind: ItemKind | null;
    }> = [];
    for (const item of run.items) {
      if (
        item.status === "completed" &&
        item.sourcePath !== null &&
        item.destinationPath !== null &&
        item.destinationPath !== item.sourcePath
      ) {
        const renamedItem = await readItemRef(fs.lstat, item.destinationPath);
        renamedItems.push({
          from: item.sourcePath,
          to: item.destinationPath,
          id: renamedItem.id,
          itemKind: renamedItem.kind,
        });
      }
    }
    const batchStep: UndoStep = { kind: "batchRenamed", items: renamedItems };
    emitLocalWriteOperationEvent(
      {
        operationId,
        action: "batch_rename",
        status,
        completedItemCount: run.completedItemCount,
        totalItemCount,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        result,
      },
      [],
      renamedItems.length > 0 ? { undoable: true, units: [{ steps: [batchStep] }] } : undefined,
    );
  }

  // Whether the folder holds an entry spelled exactly like `name` (another item, since the
  // item being renamed is spelled differently). Unknown when the folder can't be read.
  async function listsSeparateEntry(folder: string, name: string): Promise<boolean> {
    if (!fs.readdir) {
      return false;
    }
    const entries = await fs.readdir(folder).catch(() => null);
    return entries?.includes(name) ?? false;
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
    const created: UndoStep = {
      kind: "created",
      path: destinationPath,
      id: await readItemId(fs.lstat, destinationPath),
      stamp: await readItemStamp(fs, destinationPath),
    };
    emitSingleItemResult({
      operationId,
      action: "new_folder",
      startedAt,
      sourcePath: null,
      destinationPath,
      status: "completed",
      error: null,
      undoLog: { undoable: true, units: [{ steps: [created] }] },
    });
  }

  async function prepareCreateFolderOperation(
    payload: IpcRequest<"writeOperation:createFolder">,
  ): Promise<PreparedCreateFolderOperation> {
    const parentDirectoryPath = resolve(payload.parentDirectoryPath);
    assertNotIntoTrash(parentDirectoryPath, "made in");
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
      if (payload.nextFreeName) {
        return { destinationPath: await nextFreeFolderPath(parentDirectoryPath, folderName) };
      }
      throw new Error(`An item named “${folderName}” already exists.`);
    }
    return { destinationPath };
  }

  // "untitled folder" taken: "untitled folder 2", "untitled folder 3"… (from
  // "untitled folder 3", the next).
  async function nextFreeFolderPath(parentDirectoryPath: string, name: string): Promise<string> {
    const match = /^(.*?) (\d+)$/u.exec(name);
    const base = match?.[1] ?? name;
    const first = match?.[2] ? Number(match[2]) + 1 : 2;
    for (let number = first; number < first + 10_000; number += 1) {
      const candidate = join(parentDirectoryPath, `${base} ${number}`);
      if ((await lstatOrNull(candidate, fs.lstat)) === null) {
        return candidate;
      }
    }
    throw new Error(`An item named “${name}” already exists.`);
  }

  async function executeTrashOperation(
    payload: IpcRequest<"writeOperation:trash">,
    sender: WriteOperationSender,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    // A folder and an item inside it are one item to remove (the folder takes the item).
    const paths = withoutNestedPaths(payload.paths.map((path) => resolve(path)));
    const startedAt = new Date().toISOString();
    const items: WriteOperationResult["items"] = [];
    let completedItemCount = 0;
    let cancelled = false;
    // Only what this Trash finds without a Trash may be deleted next.
    const withoutTrash = new Set<string>();
    itemsWithoutTrash.set(sender, withoutTrash);
    const removedItems: RemovedItem[] = [];
    // One unit per item, so an item put back from the Trash doesn't depend on the others.
    const trashedUnits: UndoUnit[] = [];
    // What's on the home folder's disk goes to the home folder's Trash.
    const home = fs.itemSize ? await readItemSize(fs.itemSize, homePath) : null;
    const homeDev = home && home !== "missing" ? home.dev : null;
    // One item that can't go to the Trash doesn't keep the others from going; only
    // cancelling stops the rest.
    for (const [index, path] of paths.entries()) {
      if (controller.signal.aborted) {
        cancelled = true;
        items.push(...notStartedItems(paths.slice(index)));
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
        const before = fs.itemSize ? await readItemSize(fs.itemSize, path) : undefined;
        // An item that is already gone (deleted or moved since it was chosen) has
        // nothing left to move: that counts as done, not as a failure.
        if (!(await isMissing(path, fs.lstat))) {
          const id = await readItemId(fs.lstat, path);
          const parentId = await readItemId(fs.lstat, dirname(path));
          const trashPath = await fs.trash(path);
          trashedUnits.push({ steps: [{ kind: "trashed", from: path, trashPath, id, parentId }] });
        }
        if (before !== undefined) {
          removedItems.push(
            before === "missing"
              ? { path, item: null, intoHomeTrash: false }
              : {
                  path,
                  item: before,
                  intoHomeTrash:
                    before === null || homeDev === null ? null : before.dev === homeDev,
                },
          );
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
        const noTrash = errorCode(error) === NO_TRASH_ERROR_CODE;
        if (noTrash) {
          withoutTrash.add(path);
        }
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "failed",
          error: describeTrashError(error, path),
          skipReason: null,
          ...(noTrash ? { noTrash: true as const } : {}),
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
      // Stopped part way is said as such, never as a success.
      error: cancelled
        ? stoppedMessage(completedItemCount, "moved to the Trash")
        : failedItemCount > 0
          ? (items.find((item) => item.status === "failed")?.error ?? "Trash failed.")
          : null,
    });
    emitLocalWriteOperationEvent(
      {
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
      },
      removedItems,
      trashedUnits.length > 0 ? { undoable: true, units: trashedUnits } : undefined,
    );
  }

  async function executeDeleteImmediatelyOperation(
    payload: IpcRequest<"writeOperation:deleteImmediately">,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    // A folder and an item inside it are one item to remove (the folder takes the item).
    const paths = withoutNestedPaths(payload.paths.map((path) => resolve(path)));
    const startedAt = new Date().toISOString();
    const items: WriteOperationResult["items"] = [];
    let completedItemCount = 0;
    let cancelled = false;
    const removedItems: RemovedItem[] = [];
    for (const [index, path] of paths.entries()) {
      if (controller.signal.aborted) {
        cancelled = true;
        items.push(...notStartedItems(paths.slice(index)));
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
        const before = fs.itemSize ? await readItemSize(fs.itemSize, path) : undefined;
        await fs.rm(path, { recursive: true, force: true });
        if (before !== undefined) {
          removedItems.push({
            path,
            item: before === "missing" ? null : before,
            intoHomeTrash: false,
          });
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
        // What couldn't be deleted may be an item inside the folder (Node names it).
        const failedPath = (error as NodeJS.ErrnoException | null)?.path;
        const locked = await findLockedRefusal(fs, error, [
          ...(failedPath ? [failedPath, dirname(failedPath)] : []),
          path,
          dirname(path),
        ]);
        items.push({
          sourcePath: path,
          destinationPath: null,
          status: "failed",
          error: locked?.message ?? describeCopyPasteError(error),
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
      error: cancelled
        ? stoppedMessage(completedItemCount, "deleted")
        : failedItemCount > 0
          ? (items.find((item) => item.status === "failed")?.error ?? "Delete failed.")
          : null,
    });
    emitLocalWriteOperationEvent(
      {
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
      },
      removedItems,
      // Anything it began to delete may be gone for good, even an item that then failed.
      items.some((item) => item.status === "completed" || item.status === "failed")
        ? { undoable: false, reason: "deleted_for_good" }
        : undefined,
    );
  }

  async function executeUndoOperation(
    history: UndoHistory,
    direction: UndoDirection,
    entry: UndoEntry,
    operationId: string,
    controller: AbortController,
  ): Promise<void> {
    const startedAt = new Date().toISOString();
    const totalItemCount = entry.units.length;
    const home = fs.itemSize ? await readItemSize(fs.itemSize, homePath) : null;
    let run: Awaited<ReturnType<typeof runUndo>>;
    try {
      run = await runUndo({
        direction,
        units: entry.units,
        fs,
        signal: controller.signal,
        homeDev: home && home !== "missing" ? home.dev : null,
        onStepStart: (path, completedItemCount) =>
          emitLocalWriteOperationEvent({
            operationId,
            action: direction,
            status: "running",
            completedItemCount,
            totalItemCount,
            completedByteCount: 0,
            totalBytes: null,
            currentSourcePath: path,
            currentDestinationPath: null,
            result: null,
          }),
      });
    } catch (error) {
      // Nothing expected gets here. What it did is unknown, so it can't be redone, and is
      // not tried again either.
      console.error("[filetrail] an Undo stopped unexpectedly", error);
      run = {
        items: [],
        done: [],
        leftover: [],
        removedItems: [],
        completedItemCount: 0,
        cancelled: false,
      };
      run.items.push({
        sourcePath: null,
        destinationPath: null,
        status: "failed",
        error: `The ${direction === "undo" ? "Undo" : "Redo"} stopped unexpectedly: ${
          error instanceof Error ? error.message : String(error)
        }`,
        skipReason: null,
      });
    }
    // Before the write slot is freed, so the next operation is recorded after this one.
    // A mistake in keeping the history (or in the menu rebuilt from it) must not keep the
    // end of the Undo from being sent.
    try {
      history.finish(direction, entry.id, { done: run.done, leftover: run.leftover });
    } catch (error) {
      console.error("[filetrail] couldn't record an Undo in the history", error);
    }
    const problems = run.items.filter(
      (item) => item.status === "failed" || (item.status === "skipped" && item.error !== null),
    );
    const status = run.cancelled
      ? run.completedItemCount > 0
        ? "partial"
        : "cancelled"
      : problems.length > 0
        ? run.completedItemCount > 0
          ? "partial"
          : "failed"
        : "completed";
    const result = createLocalWriteOperationResult({
      operationId,
      action: direction,
      targetPath: null,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalItemCount: run.items.length,
      completedItemCount: run.completedItemCount,
      items: run.items,
      status,
      error: run.cancelled
        ? stoppedMessage(run.completedItemCount, direction === "undo" ? "undone" : "redone")
        : (problems[0]?.error ?? null),
    });
    emitLocalWriteOperationEvent(
      {
        operationId,
        action: direction,
        status,
        completedItemCount: run.completedItemCount,
        totalItemCount: run.items.length,
        completedByteCount: 0,
        totalBytes: null,
        currentSourcePath: null,
        currentDestinationPath: null,
        result,
      },
      run.removedItems,
    );
  }

  function cancelWriteOperation(operationId: string): { ok: boolean } {
    const localController = localWriteOperationControllers.get(operationId);
    if (localController) {
      localController.abort();
      return { ok: true };
    }
    return writeService.cancelOperation(operationId);
  }

  // An analysis whose window crashed, closed or reloaded is cancelled: nobody can answer
  // its review, and one still running (a network folder that stopped answering) would keep
  // every other window from setting up a copy.
  function watchAnalysisOwner(analysisId: string, owner: WriteOperationSender): void {
    analysisOwners.set(analysisId, owner);
    const abandon = () => {
      forgetAnalysis(analysisId);
      writeService.cancelCopyPasteAnalysis(analysisId);
    };
    if (isSenderDestroyed(owner)) {
      abandon();
      return;
    }
    const events = owner as SenderLifecycleEvents;
    if (typeof events.on !== "function" || typeof events.removeListener !== "function") {
      return;
    }
    for (const eventName of SENDER_GONE_EVENTS) {
      events.on.call(owner, eventName, abandon);
    }
    analysisDetachers.set(analysisId, () => {
      for (const eventName of SENDER_GONE_EVENTS) {
        events.removeListener?.call(owner, eventName, abandon);
      }
    });
  }

  function forgetAnalysis(analysisId: string): void {
    analysisDetachers.get(analysisId)?.();
    analysisDetachers.delete(analysisId);
    analysisOwners.delete(analysisId);
  }

  // The analyses of windows other than `sender`: their reviews may still be open, so the
  // write service keeps them when it drops finished ones.
  function analysesOfOtherWindows(sender: WriteOperationSender): Set<string> {
    const ids = new Set<string>();
    for (const [analysisId, owner] of analysisOwners) {
      if (owner !== sender) {
        ids.add(analysisId);
      }
    }
    return ids;
  }

  // An analysis is read, cancelled, and started only by the window that asked for it;
  // another window (such as Settings) shares the same preload API.
  function assertAnalysisOwner(analysisId: string, requester: unknown): void {
    const owner = analysisOwners.get(analysisId);
    if (owner === undefined || owner !== requester) {
      throw new Error("This copy was set up in another window.");
    }
  }

  // Emptying the Trash while a paste is replacing items would delete the replaced items
  // for good as they arrive there, so it waits its turn like any other write.
  async function emptyTrash(
    empty: () => Promise<{ ok: boolean; error: string | null }>,
  ): Promise<{ ok: boolean; error: string | null }> {
    try {
      ensureNoWriteOperationInFlight();
    } catch {
      return {
        ok: false,
        error: closing
          ? "File Trail is quitting."
          : "The Trash can't be emptied while another operation is running. Try again when it has finished.",
      };
    }
    try {
      return await prepareWithReservedSlot(async () => {
        try {
          return await empty();
        } finally {
          // Whatever it managed to empty is gone for good, even when it then failed.
          recordFinishedWrite({
            action: "empty_trash",
            log: { undoable: false, reason: "deleted_for_good" },
            items: [],
          });
        }
      });
    } finally {
      // The Trash's listing (and anything shown from it) is out of date now.
      clearResponseCaches([resolve(homePath, ".Trash")]);
    }
  }

  // Stops the running operation, if any, and waits until it has finished: an operation
  // stops after the item it is on and removes any partly copied file, which can take a
  // moment for a large file. No new operation can start afterwards.
  async function shutdown(maxWaitMs: number = SHUTDOWN_WAIT_LIMIT_MS): Promise<void> {
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
    // A stopped copy ends within moments; only a disk that stops answering (a network
    // share gone away) could hold quitting up, and then it goes ahead anyway. No original
    // is lost by that: a move removes one only once its copy is complete, a file being
    // copied is written under a hidden name until it is whole, and a Replace cut short is
    // finished at the next start. A Delete Immediately (inside the Trash, and asked for)
    // may be left part done.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      whenIdle().then(() => false),
      new Promise<boolean>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(true), maxWaitMs);
      }),
    ]);
    clearTimeout(timer);
    if (timedOut) {
      console.error("[filetrail] quitting without waiting longer for an operation to stop", {
        operationId,
      });
    }
    writeServiceUnsubscribe();
    for (const progressOperationId of [...progressThrottles.keys()]) {
      forgetProgress(progressOperationId);
    }
    writeOperationSenders.clear();
    copyPasteRequests.clear();
    copyPasteModes.clear();
    for (const analysisId of [...analysisOwners.keys()]) {
      forgetAnalysis(analysisId);
    }
    localWriteOperationControllers.clear();
    localWriteOperationActions.clear();
  }

  return {
    handlers: {
      "copyPaste:analyzeStart": async (
        payload: IpcRequest<"copyPaste:analyzeStart">,
        event: { sender: WriteOperationSender },
      ) => {
        assertNotIntoTrash(payload.destinationDirectoryPath, "pasted into");
        if (payload.mode === "cut") {
          assertNotProtectedPath(payload.sourcePaths);
          // Moving to another disk copies, then deletes the originals: as final as deleting.
          await assertNotSystemLocation(payload.sourcePaths, "moved", fs);
        }
        ensureNoWriteOperationInFlight();
        const handle = writeService.startCopyPasteAnalysis(
          {
            mode: payload.mode,
            sourcePaths: payload.sourcePaths,
            destinationDirectoryPath: payload.destinationDirectoryPath,
          },
          analysesOfOtherWindows(event.sender),
        );
        // The write service dropped this window's earlier analysis: only the newest can
        // be pasted from.
        for (const [analysisId, owner] of [...analysisOwners]) {
          if (owner === event.sender) {
            forgetAnalysis(analysisId);
          }
        }
        watchAnalysisOwner(handle.analysisId, event.sender);
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
      "copyPaste:start": async (
        payload: IpcRequest<"copyPaste:start">,
        event: { sender: WriteOperationSender },
      ) => {
        ensureNoWriteOperationInFlight();
        assertAnalysisOwner(payload.analysisId, event.sender);
        // The write service can finish an operation before startCopyPaste returns (an
        // analysis that is no longer usable fails at once). Its end is caught here, so the
        // write slot isn't claimed for an operation that is already over.
        noteWriteStarting();
        earlyTerminalEvents = new Map();
        let handle: ReturnType<WriteService["startCopyPaste"]>;
        let finishedEarly: CopyPasteProgressEvent | undefined;
        try {
          handle = writeService.startCopyPaste(
            {
              analysisId: payload.analysisId,
              policy: payload.policy,
              ...(payload.overrides ? { overrides: payload.overrides } : {}),
            },
            analysesOfOtherWindows(event.sender),
          );
          finishedEarly = earlyTerminalEvents.get(handle.operationId);
        } finally {
          earlyTerminalEvents = null;
        }
        // The paste has it now; the window going away stops the paste instead.
        forgetAnalysis(payload.analysisId);
        if (finishedEarly) {
          // The window learns the operation id from this reply, so its end is sent just
          // after it, when the window is listening for that id.
          const sender = event.sender;
          const progress = toDeliverableProgressEvent(finishedEarly, payload.action);
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
        const answer = writeService.resolveRuntimeConflict(
          payload.operationId,
          payload.conflictId,
          payload.resolution,
          payload.applyToRemaining ?? false,
        );
        // The question is answered: a window taking the operation over before its next
        // update must not be shown it again.
        const latest = latestProgress.get(payload.operationId);
        if (answer.ok && latest?.runtimeConflict) {
          latestProgress.set(payload.operationId, {
            ...latest,
            status: "running",
            runtimeConflict: null,
          });
        }
        return answer;
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
      "writeOperation:batchRename": async (
        payload: IpcRequest<"writeOperation:batchRename">,
        event: { sender: WriteOperationSender },
      ) => {
        const request = await prepareWithReservedSlot(() => prepareBatchRenameOperation(payload));
        return queueLocalWriteOperation({
          action: "batch_rename",
          sender: event.sender,
          execute: (operationId, controller) =>
            executeBatchRenameOperation(request, operationId, controller),
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
      "writeOperation:trash": async (
        payload: IpcRequest<"writeOperation:trash">,
        event: { sender: WriteOperationSender },
      ) => {
        assertNotProtectedPath(payload.paths);
        assertNotAlreadyInTrash(payload.paths);
        await prepareWithReservedSlot(() =>
          assertNotSystemLocation(payload.paths, "moved to the Trash", fs),
        );
        return queueLocalWriteOperation({
          action: "trash",
          sender: event.sender,
          execute: (operationId, controller) =>
            executeTrashOperation(payload, event.sender, operationId, controller),
        });
      },
      "writeOperation:deleteImmediately": async (
        payload: IpcRequest<"writeOperation:deleteImmediately">,
        event: { sender: WriteOperationSender },
      ) => {
        assertNotProtectedPath(payload.paths);
        await prepareWithReservedSlot(async () => {
          await assertNotSystemLocation(payload.paths, "deleted", fs);
          await assertDeletableImmediately(payload.paths, event.sender);
        });
        return queueLocalWriteOperation({
          action: "delete_immediately",
          sender: event.sender,
          execute: (operationId, controller) =>
            executeDeleteImmediatelyOperation(payload, operationId, controller),
        });
      },
      // What undoing (or redoing) the last operation would ask, without changing anything.
      "undo:prepare": async (payload: IpcRequest<"undo:prepare">) => {
        const history = options.undoHistory;
        const refused = (refusal: "busy" | "nothing" | "cant_undo") => ({
          ticket: null,
          refusal,
          label: null,
          action: null,
          nameTaken: [],
          changed: [],
        });
        if (closing || activeWriteOperationId !== null) {
          return refused("busy");
        }
        const entry = history?.top(payload.direction) ?? null;
        if (!history || !entry) {
          return refused(
            payload.direction === "undo" && history?.menu().cantUndo ? "cant_undo" : "nothing",
          );
        }
        const ticket = `${payload.direction}:${entry.id}:${history.generation()}`;
        return {
          ticket,
          refusal: null,
          label: history.menu()[payload.direction],
          action: entry.action === "empty_trash" ? null : entry.action,
          ...(await findQuestions(fs, entry.units)),
        };
      },
      "undo:start": (
        payload: IpcRequest<"undo:start">,
        event: { sender: WriteOperationSender },
      ) => {
        const [direction, entryId, generation] = payload.ticket.split(":");
        const history = options.undoHistory;
        const entry =
          direction === "undo" || direction === "redo" ? (history?.top(direction) ?? null) : null;
        // Another operation, or another Undo, came in between: what was asked about may not
        // be what would be done now.
        if (
          !history ||
          !entry ||
          (direction !== "undo" && direction !== "redo") ||
          String(entry.id) !== entryId ||
          String(history.generation()) !== generation
        ) {
          throw new Error("Something changed since Undo was chosen. Choose it again.");
        }
        return queueLocalWriteOperation({
          action: direction,
          sender: event.sender,
          execute: (operationId, controller) =>
            executeUndoOperation(history, direction, entry, operationId, controller),
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
    emptyTrash,
    runWriteAlone,
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
    // The startup disk's data volume, where /Users and /Applications really are. Its id,
    // like those of the system's own folders, is too large to compare (see fileIdOf).
    "/System/Volumes/Data",
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

// The home folder's own folders, which Finder won't let go either.
const HOME_FOLDERS = [
  "",
  "Desktop",
  "Documents",
  "Downloads",
  "Library",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  ".Trash",
];

// Refuses to delete, trash, move or rename the startup disk, a folder that holds the system,
// the apps or everyone's files, the home folder and its own folders, or a whole disk.
// The same folder can be reached by other paths ("/System/Volumes/Data/Users/me" is the
// home folder, "/USERS" is "/Users"), so besides the path, what is on disk is compared:
// the item's identity, and whether it is where a disk is mounted.
export async function assertNotSystemLocation(
  paths: readonly string[],
  verb: string,
  fs: Pick<WriteOperationFs, "lstat" | "stat">,
  home: string = homedir(),
): Promise<void> {
  const homePath = resolve(home);
  const protectedPaths = [...SYSTEM_LOCATIONS, ...HOME_FOLDERS.map((name) => join(homePath, name))];
  const protectedKeys = protectedPaths.map((path) => path.toLowerCase());
  let protectedIds: Set<string> | null = null;
  for (const path of paths) {
    if (!path.startsWith("/")) {
      throw new Error("Expected an absolute path.");
    }
    const resolved = resolve(path);
    // The disk ignores case, so "/users" is "/Users".
    const normalized = resolved.toLowerCase();
    if (normalized === "/") {
      throw new Error(`The startup disk can't be ${verb}.`);
    }
    const refusal = new Error(`“${basename(resolved)}” can't be ${verb}.`);
    if (protectedKeys.includes(normalized) || /^\/volumes\/[^/]+$/.test(normalized)) {
      throw refusal;
    }
    const stats = await lstatOrNull(resolved, fs.lstat);
    if (!stats?.isDirectory()) {
      // Only folders are protected; a file or a link is never one of them.
      continue;
    }
    protectedIds ??= await identitiesOf(protectedPaths, fs.stat);
    const id = identityOf(stats);
    if (id !== null && protectedIds.has(id)) {
      throw refusal;
    }
    // A disk is mounted here when the folder is on a different disk than its parent.
    const parent = await lstatOrNull(dirname(resolved), fs.lstat);
    if (parent && stats.dev !== undefined && parent.dev !== undefined && parent.dev !== stats.dev) {
      throw new Error(`“${basename(resolved)}” is a disk, so it can't be ${verb}.`);
    }
  }
}

async function identitiesOf(
  paths: readonly string[],
  statFn: WriteOperationFs["stat"],
): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const path of paths) {
    const stats = await lstatOrNull(path, statFn);
    const id = stats ? identityOf(stats) : null;
    if (id !== null) {
      ids.add(id);
    }
  }
  return ids;
}

function identityOf(stats: WriteOperationStats): string | null {
  return stats.dev === undefined || !hasFileId(stats) ? null : `${stats.dev}:${stats.ino}`;
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

function stoppedMessage(doneCount: number, done: string): string {
  if (doneCount === 0) {
    return "Operation cancelled.";
  }
  return `Stopped after ${doneCount === 1 ? "1 item was" : `${doneCount} items were`} ${done}.`;
}

// The items a stopped Trash or delete never reached: each is listed, so the result counts
// everything that was left alone.
function notStartedItems(paths: readonly string[]): WriteOperationResult["items"] {
  return paths.map((path) => ({
    sourcePath: path,
    destinationPath: null,
    status: "cancelled" as const,
    error: "Not started because the operation was stopped.",
    skipReason: null,
  }));
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
// An item as a measurement counts it; "missing" when it is gone, null when it can't be read.
async function readItemSize(
  itemSize: NonNullable<WriteOperationFs["itemSize"]>,
  path: string,
): Promise<ItemSize | "missing" | null> {
  try {
    return await itemSize(path);
  } catch (error) {
    return errorCode(error) === "ENOENT" ? "missing" : null;
  }
}

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
    left.dev !== undefined && hasFileId(left) && left.dev === right.dev && left.ino === right.ino
  );
}

// FAT and exFAT give empty files ids too large to compare (see fileIdOf).
function hasFileId(stats: WriteOperationStats): boolean {
  return fileIdOf(stats.ino) !== null;
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

// The Trash gives its reasons as sentences (see createTrashItem). On a disk with no Trash
// the window then offers to delete the item immediately, as Finder does.
function describeTrashError(error: unknown, path: string): string {
  if (errorCode(error) === NO_TRASH_ERROR_CODE) {
    return `“${basename(path)}” couldn’t be moved to the Trash because its disk has no Trash.`;
  }
  const described = describeCopyPasteError(error);
  return described || `“${basename(path)}” couldn’t be moved to the Trash.`;
}

function toWriteOperationKind(action: WriteOperationAction): WriteOperationKind {
  switch (action) {
    case "trash":
      return "trash";
    case "delete_immediately":
      return "delete";
    case "rename":
    case "batch_rename":
      return "rename";
    case "new_folder":
      return "new_folder";
    case "undo":
    case "redo":
      return "undo";
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
