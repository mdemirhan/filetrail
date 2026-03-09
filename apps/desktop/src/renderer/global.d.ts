import type {
  CopyPasteProgressEvent,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
} from "@filetrail/contracts";
import type { RendererCommand } from "../shared/rendererCommands";

declare global {
  interface Window {
    filetrail?: {
      invoke<C extends IpcChannel>(
        channel: C,
        payload: IpcRequestInput<C>,
      ): Promise<IpcResponse<C>>;
      onCommand(listener: (command: RendererCommand) => void): () => void;
      onCopyPasteProgress(listener: (event: CopyPasteProgressEvent) => void): () => void;
    };
  }
}
