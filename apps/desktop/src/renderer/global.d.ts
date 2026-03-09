import type {
  CopyPasteProgressEvent,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
} from "@filetrail/contracts";

declare global {
  interface Window {
    filetrail?: {
      invoke<C extends IpcChannel>(
        channel: C,
        payload: IpcRequestInput<C>,
      ): Promise<IpcResponse<C>>;
      onCommand(
        listener: (command: {
          type:
            | "focusFileSearch"
            | "toggleInfoPanel"
            | "toggleInfoRow"
            | "openLocationSheet"
            | "openSettings"
            | "zoomIn"
            | "zoomOut"
            | "resetZoom"
            | "openInTerminal"
            | "copySelection"
            | "cutSelection"
            | "pasteSelection"
            | "copyPath"
            | "refreshOrApplySearchSort";
        }) => void,
      ): () => void;
      onCopyPasteProgress(listener: (event: CopyPasteProgressEvent) => void): () => void;
    };
  }
}
