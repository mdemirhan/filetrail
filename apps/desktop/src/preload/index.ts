import { contextBridge, ipcRenderer } from "electron";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";

type InvokeApi = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
};

const api: InvokeApi = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
};

contextBridge.exposeInMainWorld("filetrail", api);
