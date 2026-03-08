import type { IpcChannel, IpcRequestInput, IpcResponse } from "@filetrail/contracts";

import { type FiletrailClient, FiletrailClientProvider } from "../lib/filetrailClient";

export function createMockFiletrailClient(
  handlers: Partial<{
    [K in IpcChannel]: (payload: IpcRequestInput<K>) => Promise<IpcResponse<K>> | IpcResponse<K>;
  }>,
): FiletrailClient {
  return {
    async invoke(channel, payload) {
      const handler = handlers[channel];
      if (!handler) {
        throw new Error(`Missing mock handler for ${channel}`);
      }
      return await handler(payload as never);
    },
    onCommand: () => () => undefined,
  };
}

export function withMockFiletrailClient(
  client: FiletrailClient,
  children: React.ReactNode,
): React.ReactElement {
  return <FiletrailClientProvider value={client}>{children}</FiletrailClientProvider>;
}
