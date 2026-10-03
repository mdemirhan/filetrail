// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { useFiletrailClient } from "../lib/filetrailClient";
import { useHiddenItemCount } from "./useHiddenItemCount";

type Client = ReturnType<typeof useFiletrailClient>;

function clientListing(names: string[]) {
  const invoke = vi.fn().mockResolvedValue({
    path: "/Users/demo/empty",
    parentPath: "/Users/demo",
    entries: names.map((name) => ({ path: `/Users/demo/empty/${name}`, name })),
  });
  return { client: { invoke } as unknown as Client, invoke };
}

describe("useHiddenItemCount", () => {
  it("counts the hidden items of a folder that lists nothing", async () => {
    const { client, invoke } = clientListing([".DS_Store", ".git"]);
    const { result } = renderHook(() => useHiddenItemCount(client, "/Users/demo/empty", true));

    await waitFor(() => expect(result.current).toBe(2));
    expect(invoke).toHaveBeenCalledWith("directory:getSnapshot", {
      path: "/Users/demo/empty",
      includeHidden: true,
    });
  });

  it("asks nothing, and says none, when the folder is not to be counted", () => {
    const { client, invoke } = clientListing([".DS_Store"]);
    const { result } = renderHook(() => useHiddenItemCount(client, "/Users/demo/empty", false));

    expect(result.current).toBe(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not carry a count over to another folder", async () => {
    const { client } = clientListing([".DS_Store"]);
    const { result, rerender } = renderHook(({ path }) => useHiddenItemCount(client, path, true), {
      initialProps: { path: "/Users/demo/empty" },
    });
    await waitFor(() => expect(result.current).toBe(1));

    rerender({ path: "/Users/demo/other" });
    expect(result.current).toBe(0);
  });
});
