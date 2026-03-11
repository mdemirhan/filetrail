import type { IpcMain, IpcMainInvokeEvent } from "electron";

import {
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  IpcValidationError,
  ipcChannels,
  ipcContractSchemas,
} from "@filetrail/contracts";

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
        const response = ipcContractSchemas[channel].response.safeParse(responsePayload);
        if (!response.success) {
          throw new IpcValidationError(
            `Invalid response for ${channel}: ${response.error.message}`,
          );
        }
        return {
          ok: true,
          payload: response.data,
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
          error: toErrorMessage(error),
        } satisfies IpcEnvelope;
      }
    });
  }
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
