// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import {
  type FiletrailClient,
  FiletrailClientProvider,
  isMissingFiletrailClient,
  useFiletrailClient,
} from "./filetrailClient";

function ClientProbe({
  onRender,
}: {
  onRender?: (client: FiletrailClient) => void;
}) {
  const client = useFiletrailClient();
  onRender?.(client);
  return <div data-testid="client-status">{isMissingFiletrailClient(client) ? "missing" : "ok"}</div>;
}

describe("filetrailClient", () => {
  const originalFiletrail = window.filetrail;

  afterEach(() => {
    if (originalFiletrail === undefined) {
      delete window.filetrail;
      return;
    }
    window.filetrail = originalFiletrail;
  });

  it("prefers an injected provider client over the preload bridge", () => {
    const providerClient: FiletrailClient = {
      invoke: vi.fn(),
      onCommand: vi.fn(() => () => undefined),
    };
    window.filetrail = {
      invoke: vi.fn(),
      onCommand: vi.fn(() => () => undefined),
    };

    render(
      <FiletrailClientProvider value={providerClient}>
        <ClientProbe />
      </FiletrailClientProvider>,
    );

    expect(screen.getByTestId("client-status")).toHaveTextContent("ok");
    expect(isMissingFiletrailClient(providerClient)).toBe(false);
  });

  it("falls back to the preload bridge and keeps that client stable across rerenders", () => {
    const bridgeClient: FiletrailClient = {
      invoke: vi.fn(),
      onCommand: vi.fn(() => () => undefined),
    };
    const seen: FiletrailClient[] = [];
    window.filetrail = bridgeClient;

    const { rerender } = render(<ClientProbe onRender={(client) => seen.push(client)} />);
    rerender(<ClientProbe onRender={(client) => seen.push(client)} />);

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(bridgeClient);
    expect(seen[1]).toBe(bridgeClient);
    expect(screen.getByTestId("client-status")).toHaveTextContent("ok");
  });

  it("uses a missing-client fallback when the preload bridge is absent or invalid", async () => {
    delete window.filetrail;
    const seen: FiletrailClient[] = [];
    render(<ClientProbe onRender={(client) => seen.push(client)} />);

    expect(screen.getByTestId("client-status")).toHaveTextContent("missing");
    expect(isMissingFiletrailClient(seen[0] as FiletrailClient)).toBe(true);
    await expect(seen[0]?.invoke("app:getPreferences", {})).rejects.toThrow(
      "File Trail preload bridge is unavailable",
    );

    window.filetrail = { invoke: vi.fn() } as unknown as FiletrailClient;
    render(<ClientProbe />);
    expect(screen.getAllByTestId("client-status")[1]).toHaveTextContent("missing");
  });
});
