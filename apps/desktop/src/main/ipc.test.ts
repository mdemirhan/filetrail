import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createHandlersThatFailOnSnapshot() {
  return {
    "app:getHomeDirectory": async () => ({ path: "/Users/demo" }),
    "app:getPreferences": async () => ({
      preferences: {
        theme: "tomorrow-night" as const,
        uiFontFamily: "dm-sans" as const,
        uiFontSize: 13,
        uiFontWeight: 400 as const,
        textPrimaryOverride: null,
        textSecondaryOverride: null,
        textMutedOverride: null,
        viewMode: "list" as const,
        propertiesOpen: true,
        includeHidden: false,
        treeWidth: 280,
        inspectorWidth: 320,
        restoreLastVisitedFolderOnStartup: false,
        treeRootPath: null,
        lastVisitedPath: null,
      },
    }),
    "app:updatePreferences": async () => ({
      preferences: {
        theme: "tomorrow-night" as const,
        uiFontFamily: "dm-sans" as const,
        uiFontSize: 13,
        uiFontWeight: 400 as const,
        textPrimaryOverride: null,
        textSecondaryOverride: null,
        textMutedOverride: null,
        viewMode: "list" as const,
        propertiesOpen: true,
        includeHidden: false,
        treeWidth: 280,
        inspectorWidth: 320,
        restoreLastVisitedFolderOnStartup: false,
        treeRootPath: null,
        lastVisitedPath: null,
      },
    }),
    "app:clearCaches": async () => ({ ok: true as const }),
    "directory:getSnapshot": async () => {
      const error = new Error(
        "ENOENT: no such file or directory, stat '/Users/demo/missing-folder'",
      ) as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    },
    "directory:getMetadataBatch": async () => ({ directoryPath: "/Users/demo", items: [] }),
    "tree:getChildren": async () => ({ path: "/Users/demo", children: [] }),
    "item:getProperties": async () => ({
      item: {
        path: "/Users/demo",
        name: "demo",
        extension: "",
        kind: "directory" as const,
        kindLabel: "Folder",
        sizeBytes: null,
        sizeStatus: "unavailable" as const,
        modifiedAt: "2026-03-07T00:00:00.000Z",
        createdAt: "2026-03-07T00:00:00.000Z",
        isHidden: false,
        isSymlink: false,
      },
    }),
    "folderSize:start": async () => ({ jobId: "job-1", status: "deferred" as const }),
    "folderSize:getStatus": async () => ({
      jobId: "job-1",
      status: "deferred" as const,
      sizeBytes: null,
      error: null,
    }),
    "folderSize:cancel": async () => ({ ok: true }),
    "system:openPath": async () => ({ ok: true, error: null }),
    "path:getSuggestions": async () => ({
      inputPath: "",
      basePath: null,
      suggestions: [],
    }),
    "path:resolve": async () => ({
      inputPath: "/tmp/link",
      resolvedPath: "/tmp/target",
    }),
  } as const;
}

function createHandlersThatFailOnMetadataOutside() {
  return {
    ...createHandlersThatFailOnSnapshot(),
    "directory:getMetadataBatch": async () => {
      throw new Error("Path /Users/demo/Desktop is outside /Users/demo/Documents");
    },
  } as const;
}

describe("registerIpcHandlers", () => {
  const originalDebug = process.env.FILETRAIL_DEBUG;

  beforeEach(() => {
    vi.resetModules();
    process.env.FILETRAIL_DEBUG = undefined;
  });

  afterEach(() => {
    if (originalDebug === undefined) {
      process.env.FILETRAIL_DEBUG = undefined;
    } else {
      process.env.FILETRAIL_DEBUG = originalDebug;
    }
    vi.restoreAllMocks();
  });

  it("suppresses invalid-path IPC errors unless debug mode is enabled", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers({ handle }, createHandlersThatFailOnSnapshot());

    const snapshotHandler = handle.mock.calls.find(
      (call) => call[0] === "directory:getSnapshot",
    )?.[1];

    expect(snapshotHandler).toBeTypeOf("function");

    const response = await snapshotHandler?.({}, { path: "/Users/demo/missing-folder" });

    expect(response).toEqual({
      ok: false,
      error: "ENOENT: no such file or directory, stat '/Users/demo/missing-folder'",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs invalid-path IPC errors when debug mode is enabled", async () => {
    process.env.FILETRAIL_DEBUG = "1";
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers({ handle }, createHandlersThatFailOnSnapshot());

    const snapshotHandler = handle.mock.calls.find(
      (call) => call[0] === "directory:getSnapshot",
    )?.[1];

    await snapshotHandler?.({}, { path: "/Users/demo/missing-folder" });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain(
      "[filetrail] ipc directory:getSnapshot failed",
    );
  });

  it("suppresses outside-directory metadata errors unless debug mode is enabled", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers({ handle }, createHandlersThatFailOnMetadataOutside());

    const metadataHandler = handle.mock.calls.find(
      (call) => call[0] === "directory:getMetadataBatch",
    )?.[1];

    expect(metadataHandler).toBeTypeOf("function");

    const response = await metadataHandler?.(
      {},
      {
        directoryPath: "/Users/demo/Documents",
        paths: ["/Users/demo/Desktop"],
      },
    );

    expect(response).toEqual({
      ok: false,
      error: "Path /Users/demo/Desktop is outside /Users/demo/Documents",
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
