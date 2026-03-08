import { contextBridge, ipcRenderer } from "electron";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";

type RendererCommand = {
  type: "focusFileSearch" | "copyPath";
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

type InvokeApi = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
  onCommand(listener: (command: RendererCommand) => void): () => void;
};

const api: InvokeApi = {
  invoke: async <C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>) => {
    const envelope = (await ipcRenderer.invoke(channel, payload)) as IpcEnvelope;
    if (!envelope.ok) {
      throw new Error(envelope.error);
    }
    return envelope.payload as IpcResponse<C>;
  },
  onCommand: (listener) => {
    const handleCommand = (_event: unknown, command: RendererCommand) => {
      listener(command);
    };
    ipcRenderer.on("filetrail:command", handleCommand);
    return () => {
      ipcRenderer.removeListener("filetrail:command", handleCommand);
    };
  },
};

contextBridge.exposeInMainWorld("filetrail", api);
