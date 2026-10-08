import type {
  AppLogEntry,
  CopyPasteClipboard,
  DraggedAway,
  FolderChange,
  HelpTopic,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
  SettingsTab,
  Volume,
  WriteOperationAdoption,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";
import type { RendererCommand } from "../shared/rendererCommands";

declare global {
  interface Window {
    filetrail?: {
      invoke<C extends IpcChannel>(
        channel: C,
        payload: IpcRequestInput<C>,
      ): Promise<IpcResponse<C>>;
      log(entry: AppLogEntry): Promise<void>;
      onCommand(listener: (command: RendererCommand) => void): () => void;
      onWriteOperationProgress(listener: (event: WriteOperationProgressEvent) => void): () => void;
      onCopyPasteProgress(listener: (event: WriteOperationProgressEvent) => void): () => void;
      onPreferencesChanged?(
        listener: (patch: IpcRequestInput<"app:updatePreferences">["preferences"]) => void,
      ): () => void;
      onShowSettingsTab?(listener: (tab: SettingsTab) => void): () => void;
      onShowHelpTopic?(listener: (topic: HelpTopic) => void): () => void;
      // The disks mounted besides the startup disk, sent again whenever one comes or goes.
      onVolumesChanged?(listener: (volumes: Volume[]) => void): () => void;
      // Changes made outside the app to the folder asked for with `folder:watch`.
      onFolderChanged?(listener: (change: FolderChange) => void): () => void;
      // The app's clipboard, changed in another window.
      onClipboardChanged?(listener: (clipboard: CopyPasteClipboard) => void): () => void;
      // A running operation this window takes over from one that closed.
      onWriteOperationAdopted?(listener: (adoption: WriteOperationAdoption) => void): () => void;
      // Items a drag out of another window took away.
      onDraggedAway?(listener: (change: DraggedAway) => void): () => void;
    };
  }
}
