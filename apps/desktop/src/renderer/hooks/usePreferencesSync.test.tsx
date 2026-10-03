// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import { createMockFiletrailClient } from "../test/mockFiletrailClient";
import {
  type PreferencesPatch,
  diffPreferencesPatch,
  usePreferencesSync,
} from "./usePreferencesSync";

describe("usePreferencesSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("diffs only keys whose values changed", () => {
    const favorites = [{ path: "/Users/demo", icon: "home" as const }];
    expect(
      diffPreferencesPatch(
        { theme: "auto", accent: "#d4845a", favorites },
        { theme: "dark", accent: "#d4845a", favorites },
      ),
    ).toEqual({ theme: "dark" });
  });

  it("writes only changed keys after the debounce and does not echo remote changes", async () => {
    const updateHandler = vi.fn(async () => ({ preferences: {} }));
    let remoteListener: ((patch: PreferencesPatch) => void) | null = null;
    const client = {
      ...createMockFiletrailClient({ "app:updatePreferences": updateHandler as never }),
      onPreferencesChanged: (listener: (patch: PreferencesPatch) => void) => {
        remoteListener = listener;
        return () => {
          remoteListener = null;
        };
      },
    };
    const onRemotePatch = vi.fn();

    const { result, rerender } = renderHook(
      ({ payload }: { payload: PreferencesPatch }) =>
        usePreferencesSync({ client, ready: true, payload, onRemotePatch }),
      { initialProps: { payload: { theme: "auto", accent: "#d4845a" } as PreferencesPatch } },
    );
    act(() => {
      result.current.markSynced({ theme: "auto", accent: "#d4845a" });
    });

    rerender({ payload: { theme: "dark", accent: "#d4845a" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateHandler).toHaveBeenCalledTimes(1);
    expect(updateHandler).toHaveBeenLastCalledWith({ preferences: { theme: "dark" } });

    // A change made in the Settings window is applied here and not written back.
    act(() => {
      remoteListener?.({ accent: "#4a9eff" });
    });
    expect(onRemotePatch).toHaveBeenCalledWith({ accent: "#4a9eff" });
    rerender({ payload: { theme: "dark", accent: "#4a9eff" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateHandler).toHaveBeenCalledTimes(1);
  });

  it("sends a value again with the next change when its write was refused", async () => {
    const updateHandler = vi
      .fn<(payload: { preferences: PreferencesPatch }) => Promise<{ preferences: object }>>()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValue({ preferences: {} });
    const client = createMockFiletrailClient({ "app:updatePreferences": updateHandler as never });

    const { result, rerender } = renderHook(
      ({ payload }: { payload: PreferencesPatch }) =>
        usePreferencesSync({ client, ready: true, payload, onRemotePatch: () => undefined }),
      { initialProps: { payload: { theme: "auto", accent: "#d4845a" } as PreferencesPatch } },
    );
    act(() => {
      result.current.markSynced({ theme: "auto", accent: "#d4845a" });
    });

    rerender({ payload: { theme: "dark", accent: "#d4845a" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateHandler).toHaveBeenCalledTimes(1);

    // The theme was not saved, so it goes out again with the accent that changes next.
    rerender({ payload: { theme: "dark", accent: "#007aff" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateHandler).toHaveBeenCalledTimes(2);
    expect(updateHandler).toHaveBeenLastCalledWith({
      preferences: { theme: "dark", accent: "#007aff" },
    });
  });
});
