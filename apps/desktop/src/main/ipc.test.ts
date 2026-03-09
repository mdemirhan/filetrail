import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APP_PREFERENCES } from "../shared/appPreferences";

const TEST_PREFERENCES = {
  ...DEFAULT_APP_PREFERENCES,
  theme: "tomorrow-night" as const,
  accent: "gold" as const,
  uiFontFamily: "lexend" as const,
  uiFontWeight: 500 as const,
  searchPatternMode: "regex" as const,
  searchMatchScope: "name" as const,
  searchResultsSortBy: "path" as const,
  searchResultsSortDirection: "asc" as const,
  searchResultsFilterScope: "name" as const,
};

function createHandlersThatFailOnSnapshot() {
  return {
    "app:getHomeDirectory": async () => ({ path: "/Users/demo" }),
    "app:getPreferences": async () => ({
      preferences: TEST_PREFERENCES,
    }),
    "app:getLaunchContext": async () => ({
      startupFolderPath: null,
    }),
    "app:updatePreferences": async () => ({
      preferences: TEST_PREFERENCES,
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
        permissionMode: 0o755,
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
    "system:pickApplication": async () => ({
      canceled: false,
      appPath: "/Applications/Zed.app",
      appName: "Zed",
    }),
    "system:pickDirectory": async () => ({
      canceled: false,
      path: "/Users/demo/Folder",
    }),
    "system:openPathsWithApplication": async () => ({ ok: true, error: null }),
    "system:openInTerminal": async () => ({ ok: true, error: null }),
    "system:copyText": async () => ({ ok: true }),
    "system:performEditAction": async () => ({ ok: true }),
    "path:getSuggestions": async () => ({
      inputPath: "",
      basePath: null,
      suggestions: [],
    }),
    "path:resolve": async () => ({
      inputPath: "/tmp/link",
      resolvedPath: "/tmp/target",
    }),
    "search:start": async () => ({ jobId: "search-1", status: "running" as const }),
    "search:getUpdate": async () => ({
      jobId: "search-1",
      status: "complete" as const,
      items: [],
      nextCursor: 0,
      done: true,
      truncated: false,
      error: null,
    }),
    "search:cancel": async () => ({ ok: true }),
    "copyPaste:plan": async () => ({
      mode: "copy" as const,
      sourcePaths: ["/Users/demo/source.txt"],
      destinationDirectoryPath: "/Users/demo/target",
      conflictResolution: "error" as const,
      items: [],
      conflicts: [],
      issues: [],
      warnings: [],
      requiresConfirmation: {
        largeBatch: false,
        cutDelete: false,
      },
      summary: {
        topLevelItemCount: 1,
        totalItemCount: 1,
        totalBytes: 42,
        skippedConflictCount: 0,
      },
      canExecute: true,
    }),
    "copyPaste:start": async () => ({ operationId: "copy-op-1", status: "queued" as const }),
    "copyPaste:cancel": async () => ({ ok: true }),
    "writeOperation:rename": async () => ({ operationId: "write-op-1", status: "queued" as const }),
    "writeOperation:createFolder": async () => ({
      operationId: "write-op-2",
      status: "queued" as const,
    }),
    "writeOperation:trash": async () => ({ operationId: "write-op-3", status: "queued" as const }),
    "writeOperation:cancel": async () => ({ ok: true }),
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

  it("returns validated success envelopes for handlers with well-formed payloads", async () => {
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers(
      { handle },
      {
        ...createHandlersThatFailOnSnapshot(),
        "app:getHomeDirectory": async () => ({ path: "/Users/demo" }),
      },
    );

    const homeHandler = handle.mock.calls.find((call) => call[0] === "app:getHomeDirectory")?.[1];

    await expect(homeHandler?.({}, {})).resolves.toEqual({
      ok: true,
      payload: {
        path: "/Users/demo",
      },
    });
  });

  it("rejects invalid request payloads before invoking the channel handler", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const invalidHandler = vi.fn(async () => ({
      inputPath: "/Users/demo",
      basePath: null,
      suggestions: [],
    }));
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers(
      { handle },
      {
        ...createHandlersThatFailOnSnapshot(),
        "path:getSuggestions": invalidHandler,
      },
    );

    const suggestionHandler = handle.mock.calls.find(
      (call) => call[0] === "path:getSuggestions",
    )?.[1];

    await expect(
      suggestionHandler?.({}, { inputPath: "/Users/demo", includeHidden: false, limit: 0 }),
    ).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("Invalid payload for path:getSuggestions"),
    });
    expect(invalidHandler).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid native edit requests before invoking the channel handler", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const invalidHandler = vi.fn(async () => ({ ok: true as const }));
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers(
      { handle },
      {
        ...createHandlersThatFailOnSnapshot(),
        "system:performEditAction": invalidHandler,
      },
    );

    const actionHandler = handle.mock.calls.find(
      (call) => call[0] === "system:performEditAction",
    )?.[1];

    await expect(actionHandler?.({}, { action: "deleteAll" })).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("Invalid payload for system:performEditAction"),
    });
    expect(invalidHandler).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid response payloads returned by handlers", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers(
      { handle },
      {
        ...createHandlersThatFailOnSnapshot(),
        "app:getHomeDirectory": async () => ({ path: "" }),
      },
    );

    const homeHandler = handle.mock.calls.find((call) => call[0] === "app:getHomeDirectory")?.[1];

    await expect(homeHandler?.({}, {})).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("Invalid response for app:getHomeDirectory"),
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("stringifies non-Error throw values in failed responses", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handle = vi.fn();
    const { registerIpcHandlers } = await import("./ipc");

    registerIpcHandlers(
      { handle },
      {
        ...createHandlersThatFailOnSnapshot(),
        "app:getHomeDirectory": async () => {
          throw "boom";
        },
      },
    );

    const homeHandler = handle.mock.calls.find((call) => call[0] === "app:getHomeDirectory")?.[1];

    await expect(homeHandler?.({}, {})).resolves.toEqual({
      ok: false,
      error: "boom",
    });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
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
