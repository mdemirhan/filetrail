// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";

import { useFiletrailClient } from "../lib/filetrailClient";
import { createMockFiletrailClient, withMockFiletrailClient } from "./mockFiletrailClient";

function Probe() {
  const client = useFiletrailClient();
  return (
    <button
      type="button"
      onClick={() => {
        void client.invoke("app:getHomeDirectory", {});
      }}
    >
      invoke
    </button>
  );
}

describe("mockFiletrailClient helpers", () => {
  it("routes invoke calls to the supplied channel handlers", async () => {
    const handler = vi.fn().mockResolvedValue({ path: "/Users/demo" });
    const client = createMockFiletrailClient({
      "app:getHomeDirectory": handler,
    });

    await expect(client.invoke("app:getHomeDirectory", {})).resolves.toEqual({
      path: "/Users/demo",
    });
    expect(handler).toHaveBeenCalledWith({});
  });

  it("fails fast when a handler is missing", async () => {
    const client = createMockFiletrailClient({});

    await expect(client.invoke("app:getPreferences", {})).rejects.toThrow(
      "Missing mock handler for app:getPreferences",
    );
  });

  it("wraps children with a provider-backed mock client", async () => {
    const handler = vi.fn().mockResolvedValue({ path: "/Users/demo" });
    const client = createMockFiletrailClient({
      "app:getHomeDirectory": handler,
    });

    render(withMockFiletrailClient(client, <Probe />));
    screen.getByRole("button", { name: "invoke" }).click();

    await vi.waitFor(() => {
      expect(handler).toHaveBeenCalledWith({});
    });
  });
});
