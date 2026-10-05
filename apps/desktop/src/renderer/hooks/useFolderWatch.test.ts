// @vitest-environment jsdom

import type { FolderChange } from "@filetrail/contracts";
import { act, renderHook } from "@testing-library/react";

import type { FiletrailClient } from "../lib/filetrailClient";
import { useFolderWatch } from "./useFolderWatch";

function createClient() {
  const listeners = new Set<(change: FolderChange) => void>();
  const watched: Array<string | null> = [];
  const client = {
    invoke: vi.fn(async (_channel: string, payload: { path: string | null }) => {
      watched.push(payload.path);
      return { ok: true };
    }),
    onFolderChanged: (listener: (change: FolderChange) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as FiletrailClient;
  return {
    client,
    watched,
    emit: (change: FolderChange) => {
      for (const listener of listeners) {
        listener(change);
      }
    },
  };
}

describe("useFolderWatch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the folder on screen and lets go of it when unmounted", () => {
    const { client, watched } = createClient();
    const reload = vi.fn(async () => true);
    const { rerender, unmount } = renderHook(
      ({ path }) => useFolderWatch({ client, path, held: false, reload }),
      { initialProps: { path: "/a" as string | null } },
    );
    rerender({ path: "/b" });
    unmount();
    expect(watched).toEqual(["/a", "/b", null]);
  });

  it("gathers changes while held and reads them once when let go", async () => {
    const { client, emit } = createClient();
    const reload = vi.fn(async () => true);
    const { rerender } = renderHook(
      ({ held }) => useFolderWatch({ client, path: "/a", held, reload }),
      { initialProps: { held: true } },
    );
    await act(async () => {
      emit({ path: "/a", changedPaths: ["/a/one"] });
      emit({ path: "/a", changedPaths: ["/a/two"] });
    });
    expect(reload).not.toHaveBeenCalled();

    await act(async () => rerender({ held: false }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(["/a/one", "/a/two"]);
  });

  it("asks again shortly when the folder can't be read yet", async () => {
    const { client, emit } = createClient();
    const reload = vi.fn(async () => true).mockResolvedValueOnce(false);
    renderHook(() => useFolderWatch({ client, path: "/a", held: false, reload }));
    await act(async () => emit({ path: "/a", changedPaths: null }));
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenLastCalledWith(null);
  });

  it("reads once more for changes that arrive while it reads", async () => {
    const { client, emit } = createClient();
    let finishRead: (done: boolean) => void = () => undefined;
    const reload = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishRead = resolve;
        }),
    );
    renderHook(() => useFolderWatch({ client, path: "/a", held: false, reload }));
    await act(async () => emit({ path: "/a", changedPaths: ["/a/one"] }));
    await act(async () => emit({ path: "/a", changedPaths: ["/a/two"] }));
    expect(reload).toHaveBeenCalledTimes(1);

    await act(async () => finishRead(true));
    expect(reload).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenLastCalledWith(["/a/two"]);
  });

  it("ignores changes to another folder", async () => {
    const { client, emit } = createClient();
    const reload = vi.fn(async () => true);
    renderHook(() => useFolderWatch({ client, path: "/a", held: false, reload }));
    await act(async () => emit({ path: "/b", changedPaths: null }));
    expect(reload).not.toHaveBeenCalled();
  });
});
