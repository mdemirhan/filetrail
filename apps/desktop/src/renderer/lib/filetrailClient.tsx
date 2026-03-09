import { createContext, useContext, useRef } from "react";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";

export type FiletrailClient = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
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
        | "copyPath"
        | "refreshOrApplySearchSort";
    }) => void,
  ): () => void;
};

const MISSING_PRELOAD_ERROR =
  "File Trail preload bridge is unavailable. Ensure the preload script exposed window.filetrail.";

// Safe fallback used during tests or when the desktop preload bridge is missing.
const MISSING_CLIENT: FiletrailClient = {
  invoke: async () => {
    throw new Error(MISSING_PRELOAD_ERROR);
  },
  onCommand: () => () => undefined,
};

function isFiletrailClient(value: unknown): value is FiletrailClient {
  return (
    typeof value === "object" &&
    value !== null &&
    "invoke" in value &&
    typeof (value as { invoke?: unknown }).invoke === "function" &&
    "onCommand" in value &&
    typeof (value as { onCommand?: unknown }).onCommand === "function"
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
