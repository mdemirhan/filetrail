import { contextBridge, ipcRenderer, webUtils } from "electron";

import type {
  AppLogEntry,
  CopyPasteClipboard,
  DraggedAway,
  FolderChange,
  HelpTopic,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
  MergeRequest,
  SettingsTab,
  Volume,
  WriteOperationAdoption,
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
  onClipboardChanged(listener: (clipboard: CopyPasteClipboard) => void): () => void;
  onWriteOperationAdopted(listener: (adoption: WriteOperationAdoption) => void): () => void;
  onDraggedAway(listener: (change: DraggedAway) => void): () => void;
  onTrashEmptied(listener: () => void): () => void;
  onOpenRequestsWaiting(listener: () => void): () => void;
  onFolderSizeSettled(listener: (jobId: string) => void): () => void;
  onMergeRequest(listener: (request: MergeRequest) => void): () => void;
  getPathForFile(file: unknown): string;
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
  onClipboardChanged: (listener) => {
    const handleChange = (_event: unknown, clipboard: CopyPasteClipboard) => {
      listener(clipboard);
    };
    ipcRenderer.on("filetrail:clipboardChanged", handleChange);
    return () => {
      ipcRenderer.removeListener("filetrail:clipboardChanged", handleChange);
    };
  },
  onWriteOperationAdopted: (listener) => {
    const handleAdoption = (_event: unknown, adoption: WriteOperationAdoption) => {
      listener(adoption);
    };
    ipcRenderer.on("filetrail:writeOperationAdopted", handleAdoption);
    return () => {
      ipcRenderer.removeListener("filetrail:writeOperationAdopted", handleAdoption);
    };
  },
  onDraggedAway: (listener) => {
    const handleChange = (_event: unknown, change: DraggedAway) => {
      listener(change);
    };
    ipcRenderer.on("filetrail:draggedAway", handleChange);
    return () => {
      ipcRenderer.removeListener("filetrail:draggedAway", handleChange);
    };
  },
  onTrashEmptied: (listener) => {
    const handleEmptied = () => {
      listener();
    };
    ipcRenderer.on("filetrail:trashEmptied", handleEmptied);
    return () => {
      ipcRenderer.removeListener("filetrail:trashEmptied", handleEmptied);
    };
  },
  onOpenRequestsWaiting: (listener) => {
    const handleWaiting = () => {
      listener();
    };
    ipcRenderer.on("filetrail:openRequestsWaiting", handleWaiting);
    return () => {
      ipcRenderer.removeListener("filetrail:openRequestsWaiting", handleWaiting);
    };
  },
  onFolderSizeSettled: (listener) => {
    const handleSettled = (_event: unknown, jobId: unknown) => {
      if (typeof jobId === "string") {
        listener(jobId);
      }
    };
    ipcRenderer.on("filetrail:folderSizeSettled", handleSettled);
    return () => {
      ipcRenderer.removeListener("filetrail:folderSizeSettled", handleSettled);
    };
  },
  onMergeRequest: (listener) => {
    const handleRequest = (_event: unknown, request: MergeRequest) => {
      listener(request);
    };
    ipcRenderer.on("filetrail:mergeRequest", handleRequest);
    return () => {
      ipcRenderer.removeListener("filetrail:mergeRequest", handleRequest);
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
  // Where a file dropped on the page is on disk; "" for anything else (a file the page made
  // itself, or something that isn't a file).
  getPathForFile: (file) => {
    // Checked by Electron itself: a File from the page's own world needn't be one of this
    // world's.
    try {
      const path = webUtils.getPathForFile(file as File);
      return typeof path === "string" ? path : "";
    } catch {
      return "";
    }
  },
};

contextBridge.exposeInMainWorld("filetrail", api);
