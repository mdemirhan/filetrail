import { createContext, useContext, useRef } from "react";

import type {
  AppLogEntry,
  IpcChannel,
  IpcRequestInput,
  IpcResponse,
  WriteOperationProgressEvent,
} from "@filetrail/contracts";
import type { RendererCommand } from "../../shared/rendererCommands";

export type FiletrailClient = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
  log(entry: AppLogEntry): Promise<void>;
  onCommand(listener: (command: RendererCommand) => void): () => void;
  onWriteOperationProgress(listener: (event: WriteOperationProgressEvent) => void): () => void;
  onCopyPasteProgress(listener: (event: WriteOperationProgressEvent) => void): () => void;
};

const MISSING_PRELOAD_ERROR =
  "File Trail preload bridge is unavailable. Ensure the preload script exposed window.filetrail.";

// Safe fallback used during tests or when the desktop preload bridge is missing.
const MISSING_CLIENT: FiletrailClient = {
  invoke: async () => {
    throw new Error(MISSING_PRELOAD_ERROR);
  },
  log: async () => {
    throw new Error(MISSING_PRELOAD_ERROR);
  },
  onCommand: () => () => undefined,
  onWriteOperationProgress: () => () => undefined,
  onCopyPasteProgress: () => () => undefined,
};

function isFiletrailClient(value: unknown): value is FiletrailClient {
  return (
    typeof value === "object" &&
    value !== null &&
    "invoke" in value &&
    typeof (value as { invoke?: unknown }).invoke === "function" &&
    "log" in value &&
    typeof (value as { log?: unknown }).log === "function" &&
    "onCommand" in value &&
    typeof (value as { onCommand?: unknown }).onCommand === "function" &&
    "onWriteOperationProgress" in value &&
    typeof (value as { onWriteOperationProgress?: unknown }).onWriteOperationProgress ===
      "function" &&
    "onCopyPasteProgress" in value &&
    typeof (value as { onCopyPasteProgress?: unknown }).onCopyPasteProgress === "function"
  );
}

// Prefer an injected provider client first, but fall back to the real preload bridge when
// mounted inside the desktop shell.
function getDefaultClient(): FiletrailClient {
  if (typeof window === "undefined") {
    return MISSING_CLIENT;
  }
  try {
    const candidate = window.filetrail as unknown;
    return isFiletrailClient(candidate) ? candidate : MISSING_CLIENT;
  } catch {
    return MISSING_CLIENT;
  }
}

const FiletrailClientContext = createContext<FiletrailClient | null>(null);

export function FiletrailClientProvider({
  value,
  children,
}: {
  value: FiletrailClient;
  children: React.ReactNode;
}) {
  return (
    <FiletrailClientContext.Provider value={value}>{children}</FiletrailClientContext.Provider>
  );
}

export function useFiletrailClient(): FiletrailClient {
  const value = useContext(FiletrailClientContext);
  const fallbackRef = useRef<FiletrailClient | null>(null);
  // Keep the fallback instance stable so hooks/components do not see a new client identity
  // on every render.
  if (value) {
    return value;
  }
  if (!fallbackRef.current) {
    fallbackRef.current = getDefaultClient();
  }
  return fallbackRef.current;
}

export function isMissingFiletrailClient(client: FiletrailClient): boolean {
  return client === MISSING_CLIENT;
}
