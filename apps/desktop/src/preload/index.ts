import { contextBridge, ipcRenderer } from "electron";

import type {
  AppLogEntry,
  FolderChange,
  HelpTopic,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
  SettingsTab,
  Volume,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";
import type { RendererCommand } from "../shared/rendererCommands";

type PreferencesPatch = IpcRequestInput<"app:updatePreferences">["preferences"];

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
  log(entry: AppLogEntry): Promise<void>;
  onCommand(listener: (command: RendererCommand) => void): () => void;
  onWriteOperationProgress(listener: (event: WriteOperationProgressEvent) => void): () => void;
  onCopyPasteProgress(listener: (event: WriteOperationProgressEvent) => void): () => void;
  onPreferencesChanged(listener: (patch: PreferencesPatch) => void): () => void;
  onShowSettingsTab(listener: (tab: SettingsTab) => void): () => void;
  onShowHelpTopic(listener: (topic: HelpTopic) => void): () => void;
  onVolumesChanged(listener: (volumes: Volume[]) => void): () => void;
  onFolderChanged(listener: (change: FolderChange) => void): () => void;
};

const api: InvokeApi = {
  invoke: async <C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>) => {
    const envelope = (await ipcRenderer.invoke(channel, payload)) as IpcEnvelope;
    if (!envelope.ok) {
      throw new Error(envelope.error);
    }
    return envelope.payload as IpcResponse<C>;
  },
  log: async (entry) => {
    await api.invoke("app:writeLog", entry);
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
  onWriteOperationProgress: (listener) => {
    const handleProgress = (_event: unknown, event: WriteOperationProgressEvent) => {
      listener(event);
    };
    ipcRenderer.on("filetrail:writeOperationProgress", handleProgress);
    return () => {
      ipcRenderer.removeListener("filetrail:writeOperationProgress", handleProgress);
    };
  },
  onCopyPasteProgress: (listener) => api.onWriteOperationProgress(listener),
  onPreferencesChanged: (listener) => {
    const handleChange = (_event: unknown, patch: PreferencesPatch) => {
      listener(patch);
    };
    ipcRenderer.on("filetrail:preferencesChanged", handleChange);
    return () => {
      ipcRenderer.removeListener("filetrail:preferencesChanged", handleChange);
    };
  },
  onShowHelpTopic: (listener) => {
    const handleTopic = (_event: unknown, topic: HelpTopic) => {
      listener(topic);
    };
    ipcRenderer.on("filetrail:showHelpTopic", handleTopic);
    return () => {
      ipcRenderer.removeListener("filetrail:showHelpTopic", handleTopic);
    };
  },
  onVolumesChanged: (listener) => {
    const handleChange = (_event: unknown, volumes: Volume[]) => {
      listener(volumes);
    };
    ipcRenderer.on("filetrail:volumesChanged", handleChange);
    return () => {
      ipcRenderer.removeListener("filetrail:volumesChanged", handleChange);
    };
  },
  onFolderChanged: (listener) => {
    const handleChange = (_event: unknown, change: FolderChange) => {
      listener(change);
    };
    ipcRenderer.on("filetrail:folderChanged", handleChange);
    return () => {
      ipcRenderer.removeListener("filetrail:folderChanged", handleChange);
    };
  },
  onShowSettingsTab: (listener) => {
    const handleTab = (_event: unknown, tab: SettingsTab) => {
      listener(tab);
    };
    ipcRenderer.on("filetrail:showSettingsTab", handleTab);
    return () => {
      ipcRenderer.removeListener("filetrail:showSettingsTab", handleTab);
    };
  },
};

contextBridge.exposeInMainWorld("filetrail", api);
