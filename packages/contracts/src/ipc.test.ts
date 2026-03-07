import { ipcContractSchemas } from "./ipc";

describe("ipc contracts", () => {
  it("validates the folder size placeholder channels", () => {
    expect(
      ipcContractSchemas["folderSize:start"].response.parse({
        jobId: "job-1",
        status: "deferred",
      }),
    ).toEqual({
      jobId: "job-1",
      status: "deferred",
    });

    expect(() =>
      ipcContractSchemas["folderSize:getStatus"].response.parse({
        jobId: "job-1",
        status: "unknown",
        sizeBytes: null,
        error: null,
      }),
    ).toThrow();
  });

  it("defaults directory snapshot sorting to name ascending", () => {
    const parsed = ipcContractSchemas["directory:getSnapshot"].request.parse({
      path: "/Users/demo",
    });
    expect(parsed.sortBy).toBe("name");
    expect(parsed.sortDirection).toBe("asc");
  });

  it("validates app preference payloads", () => {
    expect(
      ipcContractSchemas["app:getPreferences"].response.parse({
        preferences: {
          theme: "tomorrow-night",
          uiFontFamily: "lexend",
          uiFontSize: 13,
          uiFontWeight: 500,
          textPrimaryOverride: "#ffffff",
          textSecondaryOverride: "#cccccc",
          textMutedOverride: "#999999",
          viewMode: "list",
          propertiesOpen: true,
          includeHidden: false,
          treeWidth: 280,
          inspectorWidth: 320,
          restoreLastVisitedFolderOnStartup: false,
          treeRootPath: null,
          lastVisitedPath: null,
        },
      }),
    ).toEqual({
      preferences: {
        theme: "tomorrow-night",
        uiFontFamily: "lexend",
        uiFontSize: 13,
        uiFontWeight: 500,
        textPrimaryOverride: "#ffffff",
        textSecondaryOverride: "#cccccc",
        textMutedOverride: "#999999",
        viewMode: "list",
        propertiesOpen: true,
        includeHidden: false,
        treeWidth: 280,
        inspectorWidth: 320,
        restoreLastVisitedFolderOnStartup: false,
        treeRootPath: null,
        lastVisitedPath: null,
      },
    });

    expect(
      ipcContractSchemas["app:updatePreferences"].request.parse({
        preferences: {
          theme: "light",
          uiFontFamily: "fira-code",
          uiFontSize: 14,
          uiFontWeight: 400,
          textPrimaryOverride: null,
          includeHidden: true,
        },
      }),
    ).toEqual({
      preferences: {
        theme: "light",
        uiFontFamily: "fira-code",
        uiFontSize: 14,
        uiFontWeight: 400,
        textPrimaryOverride: null,
        includeHidden: true,
      },
    });
  });

  it("validates path suggestion responses", () => {
    expect(
      ipcContractSchemas["path:getSuggestions"].response.parse({
        inputPath: "/Users/demo/Do",
        basePath: "/Users/demo",
        suggestions: [{ path: "/Users/demo/Documents", name: "Documents", isDirectory: true }],
      }),
    ).toEqual({
      inputPath: "/Users/demo/Do",
      basePath: "/Users/demo",
      suggestions: [{ path: "/Users/demo/Documents", name: "Documents", isDirectory: true }],
    });
  });

  it("validates resolved path responses", () => {
    expect(
      ipcContractSchemas["path:resolve"].response.parse({
        inputPath: "/tmp/link",
        resolvedPath: "/tmp/target",
      }),
    ).toEqual({
      inputPath: "/tmp/link",
      resolvedPath: "/tmp/target",
    });
  });
});
