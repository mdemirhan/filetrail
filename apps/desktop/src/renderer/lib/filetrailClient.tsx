import { createContext, useContext, useRef } from "react";

import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";

export type FiletrailClient = {
  invoke<C extends IpcChannel>(channel: C, payload: IpcRequestInput<C>): Promise<IpcResponse<C>>;
};

const MISSING_PRELOAD_ERROR =
  "File Trail preload bridge is unavailable. Ensure the preload script exposed window.filetrail.";

const MISSING_CLIENT: FiletrailClient = {
  invoke: async () => {
    throw new Error(MISSING_PRELOAD_ERROR);
  },
};

function isFiletrailClient(value: unknown): value is FiletrailClient {
  return (
    typeof value === "object" &&
    value !== null &&
    "invoke" in value &&
    typeof (value as { invoke?: unknown }).invoke === "function"
  );
}

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
