import type { IpcMain, IpcMainInvokeEvent } from "electron";

import {
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  IpcValidationError,
  ipcChannels,
  ipcContractSchemas,
} from "@filetrail/contracts";
import { describeCopyPasteError } from "@filetrail/core";

export type IpcHandlerMap = {
  [K in IpcChannel]: (
    payload: IpcRequest<K>,
    event: IpcMainInvokeEvent,
  ) => Promise<IpcResponse<K>> | IpcResponse<K>;
};

type IpcEnvelope =
  | {
      ok: true;
      payload: unknown;
    }
  | {
      ok: false;
      error: string;
    };

const debugIpcErrorsEnabled = process.env.FILETRAIL_DEBUG === "1";

// Folder listings, which can hold 100,000 items: the worker makes their items itself, typed
// from the same contract, so only the response around the list is checked on the way out.
// Checking every item took 5 ms per 10,000 and copied each one. What a window asks is
// still checked in full.
const LISTS_NOT_CHECKED_ITEM_BY_ITEM: Partial<Record<IpcChannel, string>> = {
  "directory:getSnapshot": "entries",
  "tree:getChildren": "children",
};

export function registerIpcHandlers(
  ipcMain: Pick<IpcMain, "handle">,
  handlers: IpcHandlerMap,
  logger: Pick<Console, "debug" | "error"> = console,
): void {
  // Every IPC channel is validated on both ingress and egress so renderer/main drift is
  // caught at runtime even when TypeScript boundaries are bypassed.
  for (const channel of ipcChannels) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const request = ipcContractSchemas[channel].request.safeParse(payload ?? {});
        if (!request.success) {
          throw new IpcValidationError(`Invalid payload for ${channel}: ${request.error.message}`);
        }
        const handler = handlers[channel];
        if (!handler) {
          throw new Error(`Missing IPC handler for ${channel}.`);
        }
        const responsePayload = await handler(request.data as never, event);
        const list = uncheckedList(channel, responsePayload);
        const response = ipcContractSchemas[channel].response.safeParse(
          list === null ? responsePayload : { ...responsePayload, [list.key]: [] },
        );
        if (!response.success) {
          throw new IpcValidationError(
            `Invalid response for ${channel}: ${response.error.message}`,
          );
        }
        return {
          ok: true,
          payload: list === null ? response.data : { ...response.data, [list.key]: list.items },
        } satisfies IpcEnvelope;
      } catch (error) {
        // Filesystem access failures are expected when the user navigates into protected or
        // disappearing locations, so we keep those quiet unless explicit debug logging is on.
        if (isExpectedAccessError(error)) {
          if (debugIpcErrorsEnabled) {
            logger.debug(`[filetrail] ipc ${channel} expected failure`, error);
          }
        } else {
          logger.error(`[filetrail] ipc ${channel} failed`, error);
        }
        return {
          ok: false,
          error: isWriteChannel(channel) ? describeCopyPasteError(error) : toErrorMessage(error),
        } satisfies IpcEnvelope;
      }
    });
  }
}

function uncheckedList(
  channel: IpcChannel,
  payload: unknown,
): { key: string; items: unknown[] } | null {
  const key = LISTS_NOT_CHECKED_ITEM_BY_ITEM[channel];
  const items =
    key !== undefined && typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)[key]
      : undefined;
  return key !== undefined && Array.isArray(items) ? { key, items } : null;
}

// A copy, rename, delete or Undo that can't start is explained to the person in a dialog, so
// a system error ("ENOENT: no such file or directory, lstat '/…'") becomes a plain sentence.
// Other channels keep the raw text, which the window only logs.
function isWriteChannel(channel: IpcChannel): boolean {
  return (
    channel.startsWith("copyPaste:") ||
    channel.startsWith("writeOperation:") ||
    channel.startsWith("undo:")
  );
}

function isExpectedAccessError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const nodeError = error as NodeJS.ErrnoException;
  return (
    nodeError.code === "EACCES" ||
    nodeError.code === "EPERM" ||
    nodeError.code === "ENOENT" ||
    nodeError.code === "ENOTDIR" ||
    message.includes(" is outside ") ||
    message.includes("permission denied") ||
    message.includes("operation not permitted") ||
    message.includes("no such file or directory") ||
    message.includes("not a directory")
  );
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
