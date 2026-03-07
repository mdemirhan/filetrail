import type { IpcMain, IpcMainInvokeEvent } from "electron";

import {
  type IpcChannel,
  type IpcRequest,
  type IpcResponse,
  IpcValidationError,
  ipcChannels,
  ipcContractSchemas,
} from "@filetrail/contracts";

type IpcHandlerMap = {
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
): void {
  for (const channel of ipcChannels) {
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const request = ipcContractSchemas[channel].request.safeParse(payload ?? {});
        if (!request.success) {
          throw new IpcValidationError(`Invalid payload for ${channel}: ${request.error.message}`);
        }
        const responsePayload = await handlers[channel](request.data as never, event);
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
        if (!isExpectedAccessError(error) || debugIpcErrorsEnabled) {
          console.error(`[filetrail] ipc ${channel} failed`, error);
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
    message.includes("permission denied") ||
    message.includes("operation not permitted") ||
    message.includes("no such file or directory") ||
    message.includes("not a directory")
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
