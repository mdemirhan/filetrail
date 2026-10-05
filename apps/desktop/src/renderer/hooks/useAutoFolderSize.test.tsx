// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";

import {
  AUTO_FOLDER_SIZE_DELAY_MS,
  getAutoFolderSizePath,
  useAutoFolderSize,
} from "./useAutoFolderSize";
import type { FolderSizeEntry } from "./useFolderSizeCache";

const HOME = "/Users/demo";

describe("getAutoFolderSizePath", () => {
  const folder = { path: `${HOME}/Projects`, kind: "directory" as const };
  const base = {
    infoPanelOpen: true,
    selectedPaths: [folder.path],
    selectedEntry: folder,
    homePath: HOME,
  };

  it("measures the one folder selected in the home folder", () => {
    expect(getAutoFolderSizePath(base)).toBe(folder.path);
    const app = { path: `${HOME}/Applications/Tool.app`, kind: "bundle" as const };
    expect(getAutoFolderSizePath({ ...base, selectedPaths: [app.path], selectedEntry: app })).toBe(
      app.path,
    );
  });

  it("measures nothing else", () => {
    expect(getAutoFolderSizePath({ ...base, infoPanelOpen: false })).toBeNull();
    expect(
      getAutoFolderSizePath({ ...base, selectedPaths: [folder.path, `${HOME}/Music`] }),
    ).toBeNull();
    expect(getAutoFolderSizePath({ ...base, selectedPaths: [], selectedEntry: null })).toBeNull();
    const file = { path: `${HOME}/notes.txt`, kind: "file" as const };
    expect(
      getAutoFolderSizePath({ ...base, selectedPaths: [file.path], selectedEntry: file }),
    ).toBeNull();
    const link = { path: `${HOME}/scripts`, kind: "symlink_directory" as const };
    expect(
      getAutoFolderSizePath({ ...base, selectedPaths: [link.path], selectedEntry: link }),
    ).toBeNull();
    // Home itself, and what is outside it.
    for (const path of [HOME, "/Applications", "/Users/demonstration/x", "/Volumes/Disk/x"]) {
      const entry = { path, kind: "directory" as const };
      expect(
        getAutoFolderSizePath({ ...base, selectedPaths: [path], selectedEntry: entry }),
      ).toBeNull();
    }
    expect(getAutoFolderSizePath({ ...base, homePath: "" })).toBeNull();
  });
});

describe("useAutoFolderSize", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createFolderSizes() {
    const entries = new Map<string, FolderSizeEntry>();
    let nextJob = 1;
    const sizes = {
      entries,
      getEntry: vi.fn((path: string) => entries.get(path) ?? { status: "idle" as const }),
      isCalculating: vi.fn(() =>
        [...entries.values()].some((entry) => entry.status === "calculating"),
      ),
      calculateFolderSize: vi.fn(async (path: string) => {
        entries.set(path, { status: "calculating", jobId: `job-${nextJob++}` });
      }),
      cancelFolderSize: vi.fn(async (path: string) => {
        entries.set(path, { status: "idle" });
      }),
    };
    return sizes;
  }

  async function waitOutDelay() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_FOLDER_SIZE_DELAY_MS);
    });
  }

  it("measures a folder that stays selected, and stops it when another is selected", async () => {
    const sizes = createFolderSizes();
    const { rerender } = renderHook(({ path }) => useAutoFolderSize(path, sizes), {
      initialProps: { path: "/Users/demo/a" as string | null },
    });
    await waitOutDelay();
    expect(sizes.calculateFolderSize).toHaveBeenCalledWith("/Users/demo/a");

    rerender({ path: "/Users/demo/b" });
    expect(sizes.cancelFolderSize).toHaveBeenCalledWith("/Users/demo/a");
    await waitOutDelay();
    expect(sizes.calculateFolderSize).toHaveBeenLastCalledWith("/Users/demo/b");

    // The Info panel closed.
    rerender({ path: null });
    expect(sizes.cancelFolderSize).toHaveBeenLastCalledWith("/Users/demo/b");
  });

  it("does not measure folders passed on the way", async () => {
    const sizes = createFolderSizes();
    const { rerender } = renderHook(({ path }) => useAutoFolderSize(path, sizes), {
      initialProps: { path: "/Users/demo/a" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_FOLDER_SIZE_DELAY_MS / 2);
    });
    rerender({ path: "/Users/demo/b" });
    await waitOutDelay();
    expect(sizes.calculateFolderSize.mock.calls).toEqual([["/Users/demo/b"]]);
  });

  it("leaves known sizes, failures and other calculations alone", async () => {
    const sizes = createFolderSizes();
    sizes.entries.set("/Users/demo/known", {
      status: "ready",
      sizeBytes: 1,
      diskBytes: 1,
      fileCount: 1,
      folderCount: 0,
    });
    sizes.entries.set("/Users/demo/failed", { status: "error", message: "no" });
    const { rerender } = renderHook(({ path }) => useAutoFolderSize(path, sizes), {
      initialProps: { path: "/Users/demo/known" },
    });
    await waitOutDelay();
    rerender({ path: "/Users/demo/failed" });
    await waitOutDelay();
    // Calculate Size is measuring another folder: a new calculation would stop it.
    sizes.entries.set("/Users/demo/other", { status: "calculating", jobId: "job-manual" });
    rerender({ path: "/Users/demo/c" });
    await waitOutDelay();
    expect(sizes.calculateFolderSize).not.toHaveBeenCalled();

    rerender({ path: "/Users/demo/d" });
    expect(sizes.cancelFolderSize).not.toHaveBeenCalled();
  });

  it("does not stop a calculation Calculate Size started over its own", async () => {
    const sizes = createFolderSizes();
    const { rerender } = renderHook(({ path }) => useAutoFolderSize(path, sizes), {
      initialProps: { path: "/Users/demo/a" as string | null },
    });
    await waitOutDelay();
    // Calculate Size on the same folder starts it again.
    sizes.entries.set("/Users/demo/a", { status: "calculating", jobId: "job-manual" });
    rerender({ path: null });
    expect(sizes.cancelFolderSize).not.toHaveBeenCalled();
  });
});
