import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";

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
            | "openInTerminal"
            | "copyPath"
            | "refreshOrApplySearchSort";
        }) => void,
      ): () => void;
    };
  }
}
